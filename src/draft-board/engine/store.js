// Local-first storage: everything lives in this browser's localStorage.
// All reads go through normalize*, so a corrupted or hand-edited backup can
// never crash the app.

import { isTier } from "./rating.js";
import { MAX_TEAMS } from "./share.js";
import { uid } from "./util.js";

export const STORAGE_KEY = "draft-board:v1";
export const ARMS = ["balanced", "random", "captains"];
export const FEELS = ["lopsided", "fair", "close"];
const MAX_ROLES = 6;

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const str = (v, max = 40) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const bool = (v, fallback) => (typeof v === "boolean" ? v : fallback);
const intIn = (v, lo, hi, fallback) => (Number.isInteger(v) && v >= lo && v <= hi ? v : fallback);
const score = (v) => (Number.isInteger(v) && v >= 0 && v <= 999 ? v : null);

export function newGroup(name = "My group") {
  return {
    id: uid(),
    name: str(name) || "My group",
    createdAt: Date.now(),
    players: [],
    roles: [],
    settings: { teamCount: 2, spreadNew: true, avoidRepeat: true, fairnessTest: false },
    rules: { apart: [], together: [] },
    sessions: [],
    draft: null,
    peerRaters: [],
  };
}

export function emptyState() {
  const g = newGroup();
  return { v: 1, activeGroupId: g.id, groups: { [g.id]: g } };
}

function normalizeTeams(teams, ids) {
  if (!Array.isArray(teams) || teams.length < 1 || teams.length > MAX_TEAMS) return null;
  const seen = new Set();
  const out = teams.map((t) =>
    Array.isArray(t)
      ? t.filter((id) => typeof id === "string" && (!ids || ids.has(id)) && !seen.has(id) && seen.add(id))
      : [],
  );
  return out;
}

function normalizeMatch(m, teamCount) {
  if (!isObj(m)) return null;
  const a = intIn(m.a, 0, teamCount - 1, null);
  const b = intIn(m.b, 0, teamCount - 1, null);
  if (a == null || b == null || a === b) return null;
  const sa = score(m.sa);
  const sb = score(m.sb);
  const winner = ["a", "b", "draw"].includes(m.winner) ? m.winner : null;
  if ((sa == null || sb == null) && !winner) return null;
  return { a, b, sa: sa != null && sb != null ? sa : null, sb: sa != null && sb != null ? sb : null, winner };
}

function normalizeSession(s) {
  if (!isObj(s)) return null;
  const teams = normalizeTeams(s.teams, null);
  if (!teams || teams.length < 2) return null;
  const matches = (Array.isArray(s.matches) ? s.matches : []).map((m) => normalizeMatch(m, teams.length)).filter(Boolean);
  if (!matches.length) return null;
  return {
    id: str(s.id, 24) || uid(),
    at: Number.isFinite(s.at) ? s.at : Date.now(),
    teams,
    arm: ARMS.includes(s.arm) ? s.arm : "balanced",
    edited: bool(s.edited, false),
    matches,
    feel: FEELS.includes(s.feel) ? s.feel : null,
  };
}

export function normalizeGroup(raw) {
  if (!isObj(raw)) return null;
  const g = newGroup(str(raw.name) || "My group");
  g.id = str(raw.id, 24) || g.id;
  g.createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : g.createdAt;

  const roles = [];
  for (const r of Array.isArray(raw.roles) ? raw.roles : []) {
    const name = str(r, 16);
    if (name && !roles.includes(name) && roles.length < MAX_ROLES) roles.push(name);
  }
  g.roles = roles;

  const ids = new Set();
  for (const p of Array.isArray(raw.players) ? raw.players : []) {
    if (!isObj(p)) continue;
    const id = str(p.id, 24);
    const name = str(p.name);
    if (!id || !name || ids.has(id)) continue;
    ids.add(id);
    const peer =
      isObj(p.peer) && Number.isInteger(p.peer.count) && p.peer.count > 0 && Number.isFinite(p.peer.sum)
        ? { sum: Math.min(Math.max(p.peer.sum, p.peer.count), p.peer.count * 5), count: p.peer.count }
        : null;
    g.players.push({
      id,
      name,
      tier: isTier(p.tier) ? p.tier : null,
      peer,
      roles: (Array.isArray(p.roles) ? p.roles : []).filter((r) => roles.includes(r)),
      isNew: bool(p.isNew, false),
      here: bool(p.here, true),
      addedAt: Number.isFinite(p.addedAt) ? p.addedAt : Date.now(),
    });
  }

  const s = isObj(raw.settings) ? raw.settings : {};
  g.settings = {
    teamCount: intIn(s.teamCount, 2, MAX_TEAMS, 2),
    spreadNew: bool(s.spreadNew, true),
    avoidRepeat: bool(s.avoidRepeat, true),
    fairnessTest: bool(s.fairnessTest, false),
  };

  const rulePairs = (list) => {
    const out = [];
    const keys = new Set();
    for (const pair of Array.isArray(list) ? list : []) {
      if (!Array.isArray(pair) || pair.length !== 2) continue;
      const [a, b] = pair;
      const key = [a, b].sort().join("|");
      if (a !== b && ids.has(a) && ids.has(b) && !keys.has(key)) {
        keys.add(key);
        out.push([a, b]);
      }
    }
    return out;
  };
  const rules = isObj(raw.rules) ? raw.rules : {};
  g.rules = { apart: rulePairs(rules.apart), together: rulePairs(rules.together) };

  g.sessions = (Array.isArray(raw.sessions) ? raw.sessions : []).map(normalizeSession).filter(Boolean);

  if (isObj(raw.draft)) {
    const teams = normalizeTeams(raw.draft.teams, ids);
    if (teams && teams.length >= 2) {
      g.draft = {
        teams,
        arm: ARMS.includes(raw.draft.arm) ? raw.draft.arm : "balanced",
        blind: bool(raw.draft.blind, false),
        edited: bool(raw.draft.edited, false),
        createdAt: Number.isFinite(raw.draft.createdAt) ? raw.draft.createdAt : Date.now(),
      };
    }
  }
  g.peerRaters = (Array.isArray(raw.peerRaters) ? raw.peerRaters : []).filter((id) => ids.has(id));
  return g;
}

export function normalizeState(raw) {
  if (!isObj(raw) || raw.v !== 1 || !isObj(raw.groups)) return emptyState();
  const groups = {};
  for (const g of Object.values(raw.groups)) {
    const n = normalizeGroup(g);
    if (n) groups[n.id] = n;
  }
  const ids = Object.keys(groups);
  if (!ids.length) return emptyState();
  return { v: 1, activeGroupId: groups[raw.activeGroupId] ? raw.activeGroupId : ids[0], groups };
}

export function loadState(storage = globalThis.localStorage) {
  try {
    const text = storage?.getItem(STORAGE_KEY);
    return text ? normalizeState(JSON.parse(text)) : emptyState();
  } catch {
    return emptyState();
  }
}

export function saveState(state, storage = globalThis.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/* ───────────── group operations (pure: group in, group out) ───────────── */

// Accepts one name, or a pasted list: one per line or comma-separated,
// with optional numbering or bullets ("1. Minh", "- Lan").
export function splitNames(text) {
  return String(text)
    .split(/[\n,;]+/)
    .map((s) => s.replace(/^\s*(?:\d+\s*[.)]\s*|[-*•·]\s*)/, "").trim().slice(0, 40))
    .filter(Boolean);
}

export function addPlayers(group, text) {
  const names = splitNames(text);
  const taken = new Set(group.players.map((p) => p.name.toLowerCase()));
  const added = [];
  for (const name of names) {
    const key = name.toLowerCase();
    if (taken.has(key)) continue;
    taken.add(key);
    added.push({ id: uid(), name, tier: null, peer: null, roles: [], isNew: false, here: true, addedAt: Date.now() });
  }
  return { group: { ...group, players: [...group.players, ...added] }, added: added.length, skipped: names.length - added.length };
}

export const updatePlayer = (group, id, patch) => ({
  ...group,
  players: group.players.map((p) => (p.id === id ? { ...p, ...patch } : p)),
});

// Deletes the player's name, tiers and rules. Past sessions keep only an
// anonymous id, so everyone else's history still adds up.
export function removePlayer(group, id) {
  const drop = (pairs) => pairs.filter(([a, b]) => a !== id && b !== id);
  let draft = group.draft;
  if (draft) {
    const teams = draft.teams.map((t) => t.filter((x) => x !== id));
    draft = { ...draft, teams, edited: draft.edited || teams.some((t, i) => t.length !== draft.teams[i].length) };
  }
  return {
    ...group,
    players: group.players.filter((p) => p.id !== id),
    rules: { apart: drop(group.rules.apart), together: drop(group.rules.together) },
    peerRaters: group.peerRaters.filter((x) => x !== id),
    draft,
  };
}

export function addRule(group, type, a, b) {
  if (!a || !b || a === b || !["apart", "together"].includes(type)) return group;
  const key = [a, b].sort().join("|");
  const exists = (pairs) => pairs.some((p) => [...p].sort().join("|") === key);
  if (exists(group.rules.apart) || exists(group.rules.together)) return group;
  return { ...group, rules: { ...group.rules, [type]: [...group.rules[type], [a, b]] } };
}

export const removeRule = (group, type, index) => ({
  ...group,
  rules: { ...group.rules, [type]: group.rules[type].filter((_, i) => i !== index) },
});

export function setRoles(group, roles) {
  const clean = [];
  for (const r of roles) {
    const name = str(r, 16);
    if (name && !clean.includes(name) && clean.length < MAX_ROLES) clean.push(name);
  }
  return {
    ...group,
    roles: clean,
    players: group.players.map((p) => ({ ...p, roles: p.roles.filter((r) => clean.includes(r)) })),
  };
}

// Pass-the-phone peer tiers: only running sums are kept, never who rated whom.
export function addPeerTiers(group, raterId, tiers) {
  if (group.peerRaters.includes(raterId)) return group;
  return {
    ...group,
    peerRaters: [...group.peerRaters, raterId],
    players: group.players.map((p) => {
      const t = tiers[p.id];
      if (p.id === raterId || !isTier(t)) return p;
      const peer = p.peer || { sum: 0, count: 0 };
      return { ...p, peer: { sum: peer.sum + t, count: peer.count + 1 } };
    }),
  };
}

export const clearPeerTiers = (group) => ({
  ...group,
  peerRaters: [],
  players: group.players.map((p) => ({ ...p, peer: null })),
});

export function logSession(group, { matches, feel }) {
  if (!group.draft) return group;
  const session = normalizeSession({
    id: uid(),
    at: Date.now(),
    teams: group.draft.teams,
    arm: group.draft.arm,
    edited: group.draft.edited,
    matches,
    feel,
  });
  if (!session) return group;
  return { ...group, sessions: [...group.sessions, session], draft: null };
}

export const deleteSession = (group, id) => ({ ...group, sessions: group.sessions.filter((s) => s.id !== id) });

export function lastSession(group) {
  let last = null;
  for (const s of group.sessions) if (!last || s.at > last.at) last = s;
  return last;
}

/* ───────────── backups and exports ───────────── */

export const exportGroup = (group) => JSON.stringify({ kind: "draft-board-group", v: 1, group }, null, 2);

export function importGroup(text, existingIds = []) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(raw) || raw.kind !== "draft-board-group") return null;
  const g = normalizeGroup(raw.group);
  if (!g) return null;
  if (existingIds.includes(g.id)) g.id = uid();
  return g;
}

// For pooling fairness-test results across groups: no names, no tiers.
export function anonymisedExport(group, ratingResult) {
  const alias = new Map(group.players.map((p, i) => [p.id, `p${i + 1}`]));
  const pred = new Map(ratingResult.predictions.map((x) => [`${x.sessionId}:${x.match}`, x.pA]));
  return {
    kind: "draft-board-fairness-test",
    v: 1,
    exportedOn: new Date().toISOString().slice(0, 10),
    players: group.players.length,
    sessions: [...group.sessions]
      .sort((a, b) => a.at - b.at)
      .map((s) => ({
        day: new Date(s.at).toISOString().slice(0, 10),
        arm: s.arm,
        edited: s.edited,
        teams: s.teams.map((t) => t.map((id) => alias.get(id) || "removed")),
        matches: s.matches.map((m, i) => {
          const p = pred.get(`${s.id}:${i}`);
          return { a: m.a, b: m.b, sa: m.sa, sb: m.sb, winner: m.winner, predictedA: p == null ? null : Math.round(p * 1000) / 1000 };
        }),
        feel: s.feel,
      })),
  };
}
