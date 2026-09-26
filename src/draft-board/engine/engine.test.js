import { test } from "node:test";
import assert from "node:assert/strict";

import { analyzeTeams, balanceTeams, teamSizes, TOLERANCE, WEIGHTS } from "./balance.js";
import { BETA, computeRatings, MU, priorFor, SIGMA, winProbability } from "./rating.js";
import { decodeShare, encodeShare, teamsMessage } from "./share.js";
import {
  addPeerTiers,
  addPlayers,
  addRule,
  anonymisedExport,
  importGroup,
  exportGroup,
  logSession,
  newGroup,
  normalizeState,
  removePlayer,
  splitNames,
} from "./store.js";
import { experimentVerdict, margin, summarizeExperiment } from "./experiment.js";
import { partitionKey } from "./util.js";

const mk = (mus, extra = {}) => mus.map((mu, i) => ({ id: `p${i}`, mu, roles: [], ...extra[i] }));
const sums = (teams, players) => teams.map((t) => t.reduce((s, id) => s + players.find((p) => p.id === id).mu, 0));

/* ───────────── balance ───────────── */

test("team sizes differ by at most one", () => {
  assert.deepEqual(teamSizes(10, 2), [5, 5]);
  assert.deepEqual(teamSizes(11, 2), [6, 5]);
  assert.deepEqual(teamSizes(14, 3), [5, 5, 4]);
});

test("exhaustive search finds the perfect 2-team split", () => {
  // 10 + 40 = 20 + 30 = 25 + 25 is the only perfect pairing of these four.
  const players = mk([10, 20, 25, 25, 30, 40]);
  const { teams, method } = balanceTeams({ players, teamCount: 2, seed: 7 });
  assert.equal(method, "exhaustive");
  const [a, b] = sums(teams, players);
  assert.equal(a, b);
});

test("balanced result is within tolerance of the brute-force optimum", () => {
  const players = mk([12, 18, 22, 25, 26, 27, 29, 31, 35, 38, 19]);
  for (let seed = 1; seed <= 20; seed++) {
    const { teams, cost, best } = balanceTeams({ players, teamCount: 2, seed });
    assert.ok(cost <= best + TOLERANCE + 1e-9);
    assert.deepEqual(teams.map((t) => t.length).sort(), [5, 6]);
  }
});

test("same seed gives the same teams; reshuffle avoids the split on screen", () => {
  const players = mk(Array(10).fill(25));
  const a = balanceTeams({ players, teamCount: 2, seed: 42 });
  const b = balanceTeams({ players, teamCount: 2, seed: 42 });
  assert.deepEqual(a.teams, b.teams);
  const c = balanceTeams({ players, teamCount: 2, seed: 42, exclude: a.teams });
  assert.notEqual(partitionKey(c.teams), partitionKey(a.teams));
});

test("keep-apart and keep-together rules are honoured", () => {
  const players = mk([30, 30, 20, 20, 25, 25, 25, 25]);
  const rules = { apart: [["p0", "p1"]], together: [["p2", "p3"]] };
  for (let seed = 1; seed <= 10; seed++) {
    const { teams } = balanceTeams({ players, teamCount: 2, rules, seed });
    const teamOf = (id) => teams.findIndex((t) => t.includes(id));
    assert.notEqual(teamOf("p0"), teamOf("p1"));
    assert.equal(teamOf("p2"), teamOf("p3"));
  }
});

test("roles are spread: one keeper per team", () => {
  const players = mk([25, 25, 25, 25, 25, 25, 25, 25], { 0: { roles: ["GK"] }, 1: { roles: ["GK"] } });
  for (let seed = 1; seed <= 10; seed++) {
    const { teams } = balanceTeams({ players, teamCount: 2, roles: ["GK"], seed });
    assert.ok(teams.every((t) => t.filter((id) => id === "p0" || id === "p1").length === 1));
  }
});

test("newcomers are spread when asked", () => {
  const players = mk(Array(8).fill(25), { 0: { isNew: true }, 1: { isNew: true } });
  const { teams } = balanceTeams({ players, teamCount: 2, spreadNew: true, seed: 3 });
  assert.ok(teams.every((t) => t.filter((id) => id === "p0" || id === "p1").length === 1));
});

test("mixing up teammates avoids last session's teams when skill allows", () => {
  const players = mk(Array(8).fill(25));
  const lastTeams = [["p0", "p1", "p2", "p3"], ["p4", "p5", "p6", "p7"]];
  const { teams } = balanceTeams({ players, teamCount: 2, lastTeams, avoidRepeat: true, seed: 5 });
  const { repeats } = analyzeTeams(teams, { ratings: new Map(), lastTeams });
  assert.equal(repeats, 4); // the minimum for 4v4 from 4v4: two pairs per team
});

test("three or more teams use local search and stay balanced", () => {
  const mus = [];
  for (let i = 0; i < 30; i++) mus.push(15 + ((i * 7) % 21));
  const players = mk(mus);
  const t0 = Date.now();
  const { teams, method } = balanceTeams({ players, teamCount: 3, seed: 11 });
  assert.equal(method, "local-search");
  assert.ok(Date.now() - t0 < 5000);
  assert.deepEqual(teams.map((t) => t.length), [10, 10, 10]);
  const s = sums(teams, players);
  assert.ok(Math.max(...s) - Math.min(...s) <= 2, `gap too big: ${s}`);
});

test("random arm ignores skill but keeps rules and roles", () => {
  const players = mk([40, 40, 40, 40, 10, 10, 10, 10], { 4: { roles: ["GK"] }, 5: { roles: ["GK"] } });
  const rules = { apart: [["p0", "p1"]] };
  let lopsided = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const { teams } = balanceTeams({ players, teamCount: 2, rules, roles: ["GK"], mode: "random", seed });
    const teamOf = (id) => teams.findIndex((t) => t.includes(id));
    assert.notEqual(teamOf("p0"), teamOf("p1"));
    assert.notEqual(teamOf("p4"), teamOf("p5"));
    const [a, b] = sums(teams, players);
    if (a !== b) lopsided++;
  }
  assert.ok(lopsided > 0, "random arm should sometimes be uneven");
});

test("analyzeTeams reports broken rules", () => {
  const players = mk([25, 25, 25, 25], { 0: { roles: ["GK"] }, 1: { roles: ["GK"] } });
  const report = analyzeTeams([["p0", "p1"], ["p2", "p3"]], {
    ratings: new Map(),
    players,
    roles: ["GK"],
    rules: { apart: [["p0", "p1"]], together: [["p2", "p0"]] },
  });
  assert.deepEqual(report.issues.map((i) => i.type).sort(), ["apart", "role", "together"]);
  assert.equal(report.winChance, 0.5);
});

/* ───────────── ratings ───────────── */

test("tiers set the starting estimate; unknown players start wide", () => {
  assert.deepEqual(priorFor({ tier: null }), { mu: MU, sigma: SIGMA });
  assert.equal(priorFor({ tier: 5 }).mu, 35);
  assert.equal(priorFor({ tier: 1 }).mu, 15);
  assert.ok(priorFor({ tier: 3 }).sigma < SIGMA);
  // host says 5, three peers say 3,3,3 → 3.5 on average, tighter sigma
  const crowd = priorFor({ tier: 5, peer: { sum: 9, count: 3 } });
  assert.equal(crowd.mu, 25 + 0.5 * 5);
  assert.ok(crowd.sigma < priorFor({ tier: 5 }).sigma);
});

test("a win moves winners up, losers down, and shrinks uncertainty", () => {
  const players = ["a", "b", "c", "d"].map((id) => ({ id, tier: null }));
  const session = { id: "s1", at: 1, teams: [["a", "b"], ["c", "d"]], matches: [{ a: 0, b: 1, sa: 3, sb: 1 }] };
  const { ratings, record, predictions } = computeRatings(players, [session]);
  assert.ok(ratings.get("a").mu > MU);
  assert.ok(ratings.get("c").mu < MU);
  assert.ok(ratings.get("a").sigma < SIGMA);
  assert.equal(record.get("a").wins, 1);
  assert.equal(record.get("d").losses, 1);
  assert.equal(predictions[0].pA, 0.5);
});

test("a draw between equal teams leaves skill estimates unchanged", () => {
  const players = ["a", "b"].map((id) => ({ id, tier: 3 }));
  const { ratings } = computeRatings(players, [{ id: "s", at: 1, teams: [["a"], ["b"]], matches: [{ a: 0, b: 1, winner: "draw" }] }]);
  assert.ok(Math.abs(ratings.get("a").mu - 25) < 1e-9);
});

test("win probability favours the stronger team and is symmetric", () => {
  const ratings = new Map([["x", { mu: 30, sigma: 4 }], ["y", { mu: 20, sigma: 4 }]]);
  const p = winProbability(["x"], ["y"], ratings);
  assert.ok(p > 0.5);
  assert.ok(Math.abs(p + winProbability(["y"], ["x"], ratings) - 1) < 1e-12);
  assert.ok(BETA > 0);
});

test("pair chemistry picks up a duo that keeps beating expectations", () => {
  const players = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, tier: 3 }));
  const sessions = [];
  const rotate = [["c", "d"], ["e", "f"], ["c", "e"], ["d", "f"], ["c", "f"], ["d", "e"]];
  rotate.forEach((opp, i) => {
    const rest = ["c", "d", "e", "f"].filter((x) => !opp.includes(x));
    sessions.push({ id: `s${i}`, at: i, teams: [["a", "b", rest[0]], [...opp, rest[1]]], matches: [{ a: 0, b: 1, sa: 3, sb: 1 }] });
  });
  const { chemistry } = computeRatings(players, sessions);
  const ab = chemistry.find((c) => c.a === "a" && c.b === "b");
  assert.equal(ab.n, 6);
  assert.ok(ab.effect > 0.1);
  assert.equal(chemistry[0].a + chemistry[0].b, "ab");
});

/* ───────────── share ───────────── */

test("share links round-trip unicode names and reject junk", () => {
  const data = { group: "Futsal thứ Ba", date: 1790000000000, teams: [["Minh", "Hùng 🔥"], ["Lan", "Bảo"]] };
  const decoded = decodeShare(encodeShare(data));
  assert.deepEqual(decoded, data);
  assert.equal(decodeShare("not-a-real-token"), null);
  assert.equal(decodeShare(encodeShare({ ...data, date: 1e20 })).date, null); // nonsense dates are dropped
  assert.equal(decodeShare(""), null);
});

test("group-chat message lists teams with colours", () => {
  const text = teamsMessage({ group: "Tuesday", dateLabel: "Tue 26 Sep", teams: [["A", "B"], ["C"]], link: "https://x/y" });
  assert.equal(text, "Teams · Tuesday · Tue 26 Sep\n🔴 Red (2): A, B\n🔵 Blue (1): C\nMade with Draft Board: https://x/y");
});

/* ───────────── store ───────────── */

test("pasted lists become players, duplicates skipped", () => {
  assert.deepEqual(splitNames("1. Minh\n2) Lan\n- Hùng, Bảo;  Chi "), ["Minh", "Lan", "Hùng", "Bảo", "Chi"]);
  const { group, added, skipped } = addPlayers(newGroup("g"), "Minh\nLan\nminh");
  assert.equal(added, 2);
  assert.equal(skipped, 1);
  assert.equal(group.players.length, 2);
});

test("corrupted storage falls back to a fresh state", () => {
  const s = normalizeState({ v: 1, groups: { x: { players: "nope", sessions: [{ junk: true }] } } });
  const g = Object.values(s.groups)[0];
  assert.equal(g.players.length, 0);
  assert.equal(g.sessions.length, 0);
  const fresh = normalizeState(null);
  assert.equal(fresh.groups[fresh.activeGroupId].players.length, 0);
});

test("logging a session stores the draft and clears it", () => {
  let { group } = addPlayers(newGroup(), "a\nb\nc\nd");
  const ids = group.players.map((p) => p.id);
  group = { ...group, draft: { teams: [ids.slice(0, 2), ids.slice(2)], arm: "random", edited: false, createdAt: 1 } };
  const logged = logSession(group, { matches: [{ a: 0, b: 1, sa: 2, sb: 2, winner: null }], feel: "close" });
  assert.equal(logged.draft, null);
  assert.equal(logged.sessions.length, 1);
  assert.equal(logged.sessions[0].arm, "random");
  // a match with no score and no winner is rejected, and nothing is logged
  assert.equal(logSession(group, { matches: [{ a: 0, b: 1, sa: null, sb: null, winner: null }] }).sessions.length, 0);
});

test("removing a player cleans rules and the draft but keeps history", () => {
  let { group } = addPlayers(newGroup(), "a\nb\nc\nd");
  const [a, b, c, d] = group.players.map((p) => p.id);
  group = addRule(group, "apart", a, b);
  group = { ...group, draft: { teams: [[a, b], [c, d]], arm: "balanced", edited: false, createdAt: 1 } };
  group = logSession(group, { matches: [{ a: 0, b: 1, winner: "a" }] });
  group = { ...group, draft: { teams: [[a, c], [b, d]], arm: "balanced", edited: false, createdAt: 2 } };
  const after = removePlayer(group, a);
  assert.equal(after.players.length, 3);
  assert.equal(after.rules.apart.length, 0);
  assert.deepEqual(after.draft.teams, [[c], [b, d]]);
  assert.equal(after.sessions[0].teams[0][0], a);
});

test("peer tiers keep sums only and each person rates once", () => {
  let { group } = addPlayers(newGroup(), "a\nb\nc");
  const [a, b, c] = group.players.map((p) => p.id);
  group = addPeerTiers(group, a, { [b]: 4, [c]: 2, [a]: 5 });
  group = addPeerTiers(group, a, { [b]: 1 }); // second go by the same rater is ignored
  const byId = Object.fromEntries(group.players.map((p) => [p.id, p]));
  assert.deepEqual(byId[b].peer, { sum: 4, count: 1 });
  assert.equal(byId[a].peer, null); // nobody rates themselves
  assert.deepEqual(group.peerRaters, [a]);
});

test("backups round-trip and anonymised exports carry no names", () => {
  let { group } = addPlayers(newGroup("Club"), "Minh\nLan");
  const [m, l] = group.players.map((p) => p.id);
  group = { ...group, draft: { teams: [[m], [l]], arm: "balanced", edited: false, createdAt: 1 } };
  group = logSession(group, { matches: [{ a: 0, b: 1, sa: 1, sb: 0 }] });
  const restored = importGroup(exportGroup(group), [group.id]);
  assert.notEqual(restored.id, group.id);
  assert.equal(restored.sessions.length, 1);
  const anon = JSON.stringify(anonymisedExport(group, computeRatings(group.players, group.sessions)));
  assert.ok(!anon.includes("Minh") && !anon.includes("Lan"));
  assert.ok(anon.includes('"predictedA":0.5'));
  assert.equal(importGroup("{nope"), null);
});

/* ───────────── experiment ───────────── */

test("margin is scale-free", () => {
  assert.equal(margin({ sa: 5, sb: 5 }), 0);
  assert.equal(margin({ sa: 4, sb: 0 }), 1);
  assert.equal(margin({ sa: 0, sb: 0 }), 0);
  assert.equal(margin({ winner: "a" }), null);
});

test("fairness test summary and verdict", () => {
  const sess = (arm, sa, sb, feel) => ({ arm, edited: false, feel, matches: [{ a: 0, b: 1, sa, sb }] });
  const sessions = [];
  for (let i = 0; i < 8; i++) sessions.push(sess("balanced", 5, 4, "close"), sess("random", 7, 2, "lopsided"));
  const summary = summarizeExperiment(sessions);
  assert.deepEqual(summary.map((s) => s.arm), ["balanced", "random"]);
  assert.equal(experimentVerdict(summary).status, "better");
  assert.equal(experimentVerdict(summarizeExperiment(sessions.slice(0, 6))).status, "collecting");
  assert.equal(experimentVerdict(summarizeExperiment(sessions.filter((s) => s.arm === "balanced"))).status, "no-control");
  const flat = [];
  for (let i = 0; i < 8; i++) flat.push(sess("balanced", 5, 4, "fair"), sess("random", 5, 4, "fair"));
  assert.equal(experimentVerdict(summarizeExperiment(flat)).status, "no-difference");
  assert.ok(WEIGHTS.hard > WEIGHTS.role);
});
