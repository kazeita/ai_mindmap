// Team balancing. Deterministic code owns every decision here; a seed makes
// each result reproducible.
//
// Objective (lower is better):
//   skill gap between strongest and weakest team (in rating-noise units)
//   + keep-apart / keep-together violations (effectively hard rules)
//   + role coverage (e.g. one keeper per team)
//   + newcomers spread across teams
//   + teammates repeated from the last session
// Two teams with up to ~20 players are searched exhaustively; anything bigger
// uses random restarts plus swap-based local search. Among near-optimal splits
// one is picked at random, so "shuffle again" gives a different fair split.

import { BETA, MU, muToTier, winProbability } from "./rating.js";
import { makeRng, partitionKey, shuffleInPlace } from "./util.js";

export const WEIGHTS = { gap: 1, hard: 100, role: 8, newcomer: 3, repeat: 0.15 };
export const TOLERANCE = 0.25; // ≈ one skill point of extra gap
const EXHAUSTIVE_LIMIT = 30_000; // ≈ 18 players; keeps phones under ~100 ms

export function teamSizes(n, k) {
  const base = Math.floor(n / k);
  const extra = n % k;
  return Array.from({ length: k }, (_, t) => base + (t < extra ? 1 : 0));
}

function binom(n, r) {
  if (r < 0 || r > n) return 0;
  r = Math.min(r, n - r);
  let c = 1;
  for (let i = 1; i <= r; i++) c = (c * (n - r + i)) / i;
  return Math.round(c);
}

// mode "balanced": full objective. mode "random": the blind-test control,
// which keeps team sizes, rules and roles but ignores skill, newcomers and
// teammate rotation.
function prepare(input, mode) {
  const { players, rules = {}, roles = [], lastTeams = null, spreadNew = false, avoidRepeat = false } = input;
  const n = players.length;
  const k = Math.max(1, Math.min(input.teamCount || 2, n));
  const index = new Map(players.map((p, i) => [p.id, i]));
  const pairs = (list = []) =>
    list
      .map(([x, y]) => [index.get(x), index.get(y)])
      .filter(([i, j]) => i !== undefined && j !== undefined && i !== j);
  const groups = [];
  for (const role of roles) {
    const idx = [];
    players.forEach((p, i) => p.roles?.includes(role) && idx.push(i));
    if (idx.length) groups.push({ idx, weight: WEIGHTS.role });
  }
  const balanced = mode !== "random";
  if (balanced && spreadNew) {
    const idx = [];
    players.forEach((p, i) => p.isNew && idx.push(i));
    if (idx.length) groups.push({ idx, weight: WEIGHTS.newcomer });
  }
  // Teammates repeated from last time are counted per (old team, new team)
  // cell: c players in one cell share c·(c−1)/2 repeated pairs.
  const lastOf = new Array(n).fill(-1);
  const lastCount = balanced && avoidRepeat && lastTeams ? lastTeams.length : 0;
  if (lastCount) {
    lastTeams.forEach((team, L) => team.forEach((id) => index.has(id) && (lastOf[index.get(id)] = L)));
  }
  let excludeAssign = null;
  let excludeKey = null;
  if (input.exclude?.length === k) {
    excludeAssign = new Array(n).fill(-1);
    input.exclude.forEach((team, t) => team.forEach((id) => index.has(id) && (excludeAssign[index.get(id)] = t)));
    if (excludeAssign.includes(-1)) excludeAssign = null; // roster changed: nothing to avoid
    else excludeKey = partitionKey(input.exclude.map((team) => team.filter((id) => index.has(id))));
  }
  return {
    n,
    k,
    excludeAssign,
    excludeKey,
    ids: players.map((p) => p.id),
    mu: players.map((p) => (Number.isFinite(p.mu) ? p.mu : MU)),
    apart: pairs(rules.apart),
    together: pairs(rules.together),
    groups,
    lastOf,
    lastCount,
    lastCells: new Array(lastCount * k),
    gapWeight: balanced ? WEIGHTS.gap : 0,
    counts: new Array(k),
    strengths: new Array(k),
  };
}

function costOf(assign, P) {
  const { n, k, mu } = P;
  let c = 0;
  if (P.gapWeight) {
    const s = P.strengths.fill(0);
    for (let i = 0; i < n; i++) s[assign[i]] += mu[i];
    let max = -Infinity;
    let min = Infinity;
    let mean = 0;
    for (let t = 0; t < k; t++) {
      if (s[t] > max) max = s[t];
      if (s[t] < min) min = s[t];
      mean += s[t];
    }
    mean /= k;
    let dev = 0;
    for (let t = 0; t < k; t++) dev += Math.abs(s[t] - mean);
    // The small deviation term breaks ties between splits with the same
    // max–min gap when there are more than two teams.
    c += (P.gapWeight * (max - min + 0.1 * dev)) / BETA;
  }
  for (const [i, j] of P.apart) if (assign[i] === assign[j]) c += WEIGHTS.hard;
  for (const [i, j] of P.together) if (assign[i] !== assign[j]) c += WEIGHTS.hard;
  for (const g of P.groups) {
    const counts = P.counts.fill(0);
    for (const i of g.idx) counts[assign[i]]++;
    const lo = Math.floor(g.idx.length / k);
    const hi = Math.ceil(g.idx.length / k);
    for (let t = 0; t < k; t++) {
      if (counts[t] < lo) c += (lo - counts[t]) * g.weight;
      else if (counts[t] > hi) c += (counts[t] - hi) * g.weight;
    }
  }
  if (P.lastCount) {
    const cells = P.lastCells.fill(0);
    for (let i = 0; i < n; i++) if (P.lastOf[i] >= 0) cells[P.lastOf[i] * k + assign[i]]++;
    let repeats = 0;
    for (const x of cells) repeats += (x * (x - 1)) / 2;
    c += repeats * WEIGHTS.repeat;
  }
  return c;
}

function toTeams(assign, P) {
  const teams = Array.from({ length: P.k }, () => []);
  assign.forEach((t, i) => teams[t].push(P.ids[i]));
  return teams;
}

const keyOf = (assign, P) => partitionKey(toTeams(assign, P));

// Visits every split of n players into two teams (sizes differ by at most one).
function forEachTwoSplit(n, visit) {
  const [sizeA] = teamSizes(n, 2);
  const fixFirst = n % 2 === 0; // equal sizes: pin player 0 to skip mirror images
  const start = fixFirst ? 1 : 0;
  const r = fixFirst ? sizeA - 1 : sizeA;
  const m = n - start;
  const assign = new Array(n).fill(1);
  const comb = Array.from({ length: r }, (_, i) => i);
  for (;;) {
    assign.fill(1);
    if (fixFirst) assign[0] = 0;
    for (const c of comb) assign[start + c] = 0;
    visit(assign);
    let i = r - 1;
    while (i >= 0 && comb[i] === m - r + i) i--;
    if (i < 0) return;
    comb[i]++;
    for (let j = i + 1; j < r; j++) comb[j] = comb[j - 1] + 1;
  }
}

function twoSplitCount(n) {
  const [sizeA] = teamSizes(n, 2);
  return n % 2 === 0 ? binom(n - 1, sizeA - 1) : binom(n, sizeA);
}

// True when a two-team assignment is the excluded split (or its mirror image).
function isExcludedTwo(a, ex) {
  if (!ex) return false;
  let same = true;
  let mirror = true;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === ex[i]) mirror = false;
    else same = false;
    if (!same && !mirror) return false;
  }
  return true;
}

function exhaustive(P, rng) {
  let best = Infinity;
  forEachTwoSplit(P.n, (a) => {
    const c = costOf(a, P);
    if (c < best) best = c;
  });
  let chosen = null;
  let fallback = null;
  let seen = 0;
  forEachTwoSplit(P.n, (a) => {
    const c = costOf(a, P);
    if (c > best + TOLERANCE + 1e-9) return;
    if (!fallback || c < fallback.cost) fallback = { assign: a.slice(), cost: c };
    if (isExcludedTwo(a, P.excludeAssign)) return;
    seen++;
    if (rng() * seen < 1) chosen = { assign: a.slice(), cost: c };
  });
  return { ...(chosen || fallback), best, method: "exhaustive" };
}

function localSearch(P, rng) {
  const { n, k } = P;
  const sizes = teamSizes(n, k);
  const restarts = Math.max(6, Math.min(40, Math.round(900 / Math.max(n, 1))));
  const found = new Map();
  const order = Array.from({ length: n }, (_, i) => i);
  for (let r = 0; r < restarts; r++) {
    shuffleInPlace(order, rng);
    const assign = new Array(n);
    let pos = 0;
    sizes.forEach((size, t) => {
      for (let s = 0; s < size; s++) assign[order[pos++]] = t;
    });
    let cur = costOf(assign, P);
    let improved = true;
    while (improved) {
      improved = false;
      shuffleInPlace(order, rng);
      for (let x = 0; x < n; x++) {
        for (let y = x + 1; y < n; y++) {
          const i = order[x];
          const j = order[y];
          if (assign[i] === assign[j]) continue;
          const ti = assign[i];
          assign[i] = assign[j];
          assign[j] = ti;
          const c = costOf(assign, P);
          if (c < cur - 1e-9) {
            cur = c;
            improved = true;
          } else {
            assign[j] = assign[i];
            assign[i] = ti;
          }
        }
      }
    }
    const key = keyOf(assign, P);
    if (!found.has(key)) found.set(key, { assign: assign.slice(), cost: cur, key });
  }
  const results = [...found.values()];
  const best = Math.min(...results.map((x) => x.cost));
  const near = results.filter((x) => x.cost <= best + TOLERANCE + 1e-9);
  const pool = near.filter((x) => x.key !== P.excludeKey);
  const pickFrom = pool.length ? pool : near;
  const chosen = pickFrom[Math.floor(rng() * pickFrom.length)];
  return { assign: chosen.assign, cost: chosen.cost, best, method: "local-search" };
}

/**
 * @param {object} input
 * @param {{id:string, mu:number, roles?:string[], isNew?:boolean}[]} input.players  players taking part
 * @param {number} input.teamCount
 * @param {{apart?:string[][], together?:string[][]}} [input.rules]
 * @param {string[]} [input.roles]       roles to spread evenly (e.g. ["GK"])
 * @param {string[][]} [input.lastTeams] teams from the previous session
 * @param {boolean} [input.spreadNew]
 * @param {boolean} [input.avoidRepeat]
 * @param {"balanced"|"random"} [input.mode]
 * @param {number} [input.seed]
 * @param {string[][]} [input.exclude]  a split to avoid (the one on screen), so a reshuffle changes something
 */
export function balanceTeams(input) {
  const mode = input.mode === "random" ? "random" : "balanced";
  const P = prepare(input, mode);
  if (P.n === 0) return { teams: Array.from({ length: input.teamCount || 2 }, () => []), cost: 0, method: "empty", mode };
  const rng = makeRng(input.seed ?? 1);
  const useExhaustive = P.k === 2 && twoSplitCount(P.n) <= EXHAUSTIVE_LIMIT;
  const result = useExhaustive ? exhaustive(P, rng) : localSearch(P, rng);
  // Shuffle which colour each team gets, so the first name on the roster isn't always Red.
  const teams = shuffleInPlace(toTeams(result.assign, P), rng);
  return { teams, cost: result.cost, best: result.best, method: result.method, mode };
}

/**
 * Describes any set of teams (generated, hand-edited or captain-picked):
 * team strength, predicted win chance for two teams, and every broken rule.
 */
export function analyzeTeams(teams, { ratings, rules = {}, roles = [], players = [], lastTeams = null }) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const teamOf = new Map();
  teams.forEach((t, ti) => t.forEach((id) => teamOf.set(id, ti)));
  const muOf = (id) => ratings.get(id)?.mu ?? MU;
  const strengths = teams.map((t) => t.reduce((s, id) => s + muOf(id), 0));
  const avgTier = teams.map((t, i) => (t.length ? muToTier(strengths[i] / t.length) : null));
  const winChance =
    teams.length === 2 && teams[0].length && teams[1].length ? winProbability(teams[0], teams[1], ratings) : null;
  const gap = teams.length ? Math.max(...strengths) - Math.min(...strengths) : 0;

  const issues = [];
  const both = (a, b) => teamOf.has(a) && teamOf.has(b);
  for (const [a, b] of rules.apart || []) {
    if (both(a, b) && teamOf.get(a) === teamOf.get(b)) issues.push({ type: "apart", a, b });
  }
  for (const [a, b] of rules.together || []) {
    if (both(a, b) && teamOf.get(a) !== teamOf.get(b)) issues.push({ type: "together", a, b });
  }
  for (const role of roles) {
    const counts = teams.map((t) => t.filter((id) => byId.get(id)?.roles?.includes(role)).length);
    const holders = counts.reduce((s, c) => s + c, 0);
    if (!holders) continue;
    const lo = Math.floor(holders / teams.length);
    const hi = Math.ceil(holders / teams.length);
    if (counts.some((c) => c < lo || c > hi)) issues.push({ type: "role", role, counts });
  }
  let repeats = 0;
  if (lastTeams) {
    for (const team of lastTeams) {
      const present = team.filter((id) => teamOf.has(id));
      for (let x = 0; x < present.length; x++) {
        for (let y = x + 1; y < present.length; y++) {
          if (teamOf.get(present[x]) === teamOf.get(present[y])) repeats++;
        }
      }
    }
  }
  return { strengths, avgTier, winChance, gap, issues, repeats };
}
