// Skill ratings with uncertainty: the Weng–Lin Bayesian approximation
// (Bradley–Terry, full pairing), the model behind OpenSkill.
//
// Every player has a skill estimate `mu` and an uncertainty `sigma`.
// Night one runs on rough tiers (host or peer); logged results refine them.
// Ratings are never stored: they are replayed from the priors and the
// session log, so deleting a mistaken result simply rewinds it.

import { pairKey } from "./util.js";

export const MU = 25;
export const SIGMA = MU / 3;
export const BETA = SIGMA / 2;
const KAPPA = 1e-4;
const TAU = MU / 300; // small drift per match so improving players keep moving

export const TIER_STEP = 5; // one tier ≈ 5 skill points
const TIER_SIGMA = 6; // one tier guess: fairly confident, still wide
const CROWD_SIGMA = 5; // three or more tier guesses agree on it
const CHEMISTRY_SHRINK = 4; // pseudo-matches pulling pair effects toward zero

export const isTier = (t) => Number.isInteger(t) && t >= 1 && t <= 5;

// Average of the host tier and any pass-the-phone peer tiers.
export function startingTier(player) {
  let total = 0;
  let count = 0;
  if (isTier(player.tier)) {
    total += player.tier;
    count += 1;
  }
  if (player.peer?.count > 0) {
    total += player.peer.sum;
    count += player.peer.count;
  }
  return count ? { tier: total / count, count } : null;
}

export function priorFor(player) {
  const start = startingTier(player);
  if (!start) return { mu: MU, sigma: SIGMA };
  return {
    mu: MU + (start.tier - 3) * TIER_STEP,
    sigma: start.count >= 3 ? CROWD_SIGMA : TIER_SIGMA,
  };
}

export const muToTier = (mu) => 3 + (mu - MU) / TIER_STEP;
export const sigmaToTiers = (sigma) => sigma / TIER_STEP;

const ratingOf = (ratings, id) => ratings.get(id) || { mu: MU, sigma: SIGMA };

function teamStats(team, ratings) {
  let mu = 0;
  let s2 = 0;
  for (const id of team) {
    const r = ratingOf(ratings, id);
    mu += r.mu;
    s2 += r.sigma * r.sigma;
  }
  return { mu, s2 };
}

// Chance that team A beats team B under the current ratings.
export function winProbability(teamA, teamB, ratings) {
  const a = teamStats(teamA, ratings);
  const b = teamStats(teamB, ratings);
  const c = Math.sqrt(a.s2 + b.s2 + 2 * BETA * BETA);
  return 1 / (1 + Math.exp((b.mu - a.mu) / c));
}

// 1 = team A won, 0.5 = draw, 0 = team B won, null = no result.
export function matchScore(match) {
  const { sa, sb, winner } = match;
  if (Number.isFinite(sa) && Number.isFinite(sb)) return sa > sb ? 1 : sa < sb ? 0 : 0.5;
  if (winner === "a") return 1;
  if (winner === "b") return 0;
  if (winner === "draw") return 0.5;
  return null;
}

export function updateMatch(teamA, teamB, score, ratings) {
  for (const id of [...teamA, ...teamB]) {
    const r = ratingOf(ratings, id);
    ratings.set(id, { ...r, sigma: Math.sqrt(r.sigma * r.sigma + TAU * TAU) });
  }
  const a = teamStats(teamA, ratings);
  const b = teamStats(teamB, ratings);
  const c = Math.sqrt(a.s2 + b.s2 + 2 * BETA * BETA);
  const pA = 1 / (1 + Math.exp((b.mu - a.mu) / c));
  const sides = [
    { team: teamA, st: a, s: score, p: pA },
    { team: teamB, st: b, s: 1 - score, p: 1 - pA },
  ];
  for (const side of sides) {
    const omega = (side.st.s2 / c) * (side.s - side.p);
    const gamma = Math.sqrt(side.st.s2) / c;
    const delta = gamma * (side.st.s2 / (c * c)) * side.p * (1 - side.p);
    for (const id of side.team) {
      const r = ratingOf(ratings, id);
      const share = (r.sigma * r.sigma) / side.st.s2;
      ratings.set(id, {
        mu: r.mu + share * omega,
        sigma: Math.sqrt(r.sigma * r.sigma * Math.max(1 - share * delta, KAPPA)),
      });
    }
  }
}

function addChemistry(chem, team, residual) {
  for (let i = 0; i < team.length; i++) {
    for (let j = i + 1; j < team.length; j++) {
      const key = pairKey(team[i], team[j]);
      const entry = chem.get(key) || { a: team[i] < team[j] ? team[i] : team[j], b: team[i] < team[j] ? team[j] : team[i], n: 0, sum: 0 };
      entry.n += 1;
      entry.sum += residual;
      chem.set(key, entry);
    }
  }
}

// Replays every logged match in time order.
// Returns current ratings, per-player records, pair chemistry and the
// pre-match prediction for every match (for calibration and exports).
export function computeRatings(players, sessions) {
  const ratings = new Map();
  const record = new Map();
  for (const p of players) {
    ratings.set(p.id, priorFor(p));
    record.set(p.id, { games: 0, wins: 0, draws: 0, losses: 0, sessions: 0 });
  }
  const chemistry = new Map();
  const predictions = [];
  const ordered = [...sessions].sort((x, y) => x.at - y.at);
  for (const s of ordered) {
    const played = new Set();
    s.matches.forEach((m, mi) => {
      if (m.a === m.b) return;
      const A = (s.teams[m.a] || []).filter((id) => ratings.has(id));
      const B = (s.teams[m.b] || []).filter((id) => ratings.has(id));
      const score = matchScore(m);
      if (!A.length || !B.length || score == null) return;
      const pA = winProbability(A, B, ratings);
      predictions.push({ sessionId: s.id, match: mi, pA, score });
      addChemistry(chemistry, A, score - pA);
      addChemistry(chemistry, B, pA - score);
      updateMatch(A, B, score, ratings);
      for (const [team, sc] of [[A, score], [B, 1 - score]]) {
        for (const id of team) {
          const rec = record.get(id);
          rec.games += 1;
          if (sc === 1) rec.wins += 1;
          else if (sc === 0) rec.losses += 1;
          else rec.draws += 1;
          played.add(id);
        }
      }
    });
    for (const id of played) record.get(id).sessions += 1;
  }
  const pairs = [...chemistry.values()]
    .map((e) => ({ a: e.a, b: e.b, n: e.n, effect: e.sum / (e.n + CHEMISTRY_SHRINK) }))
    .sort((x, y) => Math.abs(y.effect) - Math.abs(x.effect));
  return { ratings, record, chemistry: pairs, predictions };
}
