// Read-only team links and group-chat messages.
// A share link carries names only: never tiers, ratings or history.

export const TEAM_COLORS = [
  { key: "red", name: "Red", emoji: "🔴", hex: "#e5484d" },
  { key: "blue", name: "Blue", emoji: "🔵", hex: "#3b82f6" },
  { key: "yellow", name: "Yellow", emoji: "🟡", hex: "#e0a800" },
  { key: "green", name: "Green", emoji: "🟢", hex: "#22a06b" },
  { key: "purple", name: "Purple", emoji: "🟣", hex: "#8b5cf6" },
  { key: "orange", name: "Orange", emoji: "🟠", hex: "#f97316" },
];
export const MAX_TEAMS = TEAM_COLORS.length;

const MAX_NAME = 40;
const MAX_PER_TEAM = 60;

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s) {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const bin = atob(b64);
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

const clean = (v) => String(v ?? "").slice(0, MAX_NAME);

/** @param {{group:string, date:number, teams:string[][]}} data  teams as lists of names */
export function encodeShare({ group, date, teams }) {
  return toBase64Url(JSON.stringify({ v: 1, g: clean(group), d: date, t: teams.map((names) => names.map(clean)) }));
}

export function decodeShare(token) {
  try {
    const raw = JSON.parse(fromBase64Url(token));
    if (!raw || raw.v !== 1 || !Array.isArray(raw.t)) return null;
    if (raw.t.length < 1 || raw.t.length > MAX_TEAMS) return null;
    const teams = raw.t.map((names) => {
      if (!Array.isArray(names) || names.length > MAX_PER_TEAM) throw new Error("bad team");
      return names.map(clean);
    });
    const date = Number.isFinite(raw.d) && raw.d > 1.5e12 && raw.d < 4.2e12 ? raw.d : null; // 2017–2103
    return { group: clean(raw.g), date, teams };
  } catch {
    return null;
  }
}

export function shareUrl(origin, data) {
  return `${origin}/draft-board#t=${encodeShare(data)}`;
}

export function formatDay(ts, locale) {
  return new Date(ts).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
}

/** Plain-text teams for WhatsApp / Zalo / Messenger groups. */
export function teamsMessage({ group, dateLabel, teams, link }) {
  const head = ["Teams", group, dateLabel].filter(Boolean).join(" · ");
  const lines = teams.map((names, i) => {
    const c = TEAM_COLORS[i];
    return `${c.emoji} ${c.name} (${names.length}): ${names.join(", ")}`;
  });
  return [head, ...lines, link ? `Made with Draft Board: ${link}` : null].filter(Boolean).join("\n");
}
