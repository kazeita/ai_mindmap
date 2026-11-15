// Levels after the hand-written ones are written live by the site's AI endpoint (/api/chat, kind "fiblab").
// They are requested a few at a time, checked for shape, and cached in this browser so a level stays the
// same when it's replayed. Nobody fact-checks them, and the game says so on every AI level.
import { LEVELS, SUBJECTS } from "./levels.js";

export const AI_LEVEL_COUNT = 10000;
export const AI_START = LEVELS.length + 1;
export const TOTAL = LEVELS.length + AI_LEVEL_COUNT;

const BATCH = 5;
const ORDER = ["life", "chem", "phys", "space", "body", "earth"];
const CACHE_KEY = "fiblab.ai.v2"; // v1 levels read like exam questions, so they are dropped
const CACHE_CAP = 1500; // about 600 KB; past this the oldest levels are dropped and rewritten if replayed
const MAX_STATEMENT = 180; // the prompt asks for 90; anything far longer reads like a textbook
const MAX_WHY = 320;

// A random focus per level keeps 10,000 levels from circling the same few facts.
const FOCUS = {
  life: ["insects", "birds", "sea creatures", "snakes, lizards and frogs", "pets and farm animals", "wild mammals", "plants and flowers", "trees", "mushrooms and mold", "germs and bacteria", "animal superpowers", "how animals sleep, eat and move", "dinosaurs and fossils", "deep-sea creatures", "jungle animals", "polar animals", "bees and pollination", "animal myths people believe", "baby animals", "animal senses"],
  chem: ["metals", "gases around us", "chemistry in the kitchen", "salt and sugar", "water", "ice and steam", "rust and things that corrode", "fire", "household cleaners", "plastics", "colors and dyes", "fizzy drinks and bubbles", "batteries", "diamonds and gemstones", "gold and silver", "the air we breathe", "what everyday things are made of", "smells", "baking and cooking reactions", "chemistry myths people believe"],
  phys: ["light and color", "rainbows and mirrors", "sound and music", "electricity at home", "magnets", "how things fall", "heat and cold", "floating and sinking", "speed and motion", "physics in sports", "physics in the kitchen", "weight and gravity", "rubber bands and springs", "lightning and static", "airplanes and flight", "cars and bikes", "everyday machines", "lasers and screens", "temperature", "physics myths people believe"],
  space: ["the Sun", "the Moon", "Mars", "Venus and Mercury", "Jupiter and Saturn", "the far planets", "Pluto and dwarf planets", "comets and asteroids", "shooting stars", "stars", "black holes", "galaxies", "eclipses", "astronauts' daily life", "rockets and space travel", "telescopes", "the night sky", "day, night and seasons", "Earth seen from space", "space myths people believe"],
  body: ["the heart and blood", "the brain", "bones", "muscles", "skin, hair and nails", "eyes", "ears and hearing", "taste and smell", "the stomach and digestion", "lungs and breathing", "getting sick and germs", "sleep and dreams", "teeth", "sneezing, yawning and hiccups", "babies and growing up", "food and vitamins", "exercise", "the senses", "body facts that sound fake", "health myths people believe"],
  earth: ["volcanoes", "earthquakes", "rocks and crystals", "weather", "clouds and rain", "snow and ice", "oceans and waves", "rivers and lakes", "deserts", "mountains", "caves", "storms", "the seasons", "Earth's insides", "beaches and sand", "lightning and thunder", "fossils", "the air and sky", "maps and the shape of Earth", "weather myths people believe"],
};

export const subjectFor = (n) => (n <= LEVELS.length ? LEVELS[n - 1].cat : ORDER[(n - 1) % ORDER.length]);
export const isAiLevel = (n) => n >= AI_START;

/* ---------- cache: [[n, level], ...] oldest first ---------- */
let cache = null;
function readCache() {
  if (cache) return cache;
  cache = new Map();
  try {
    const rows = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (Array.isArray(rows)) for (const [n, lv] of rows) if (valid(lv)) cache.set(n, lv);
  } catch {}
  return cache;
}
function writeCache() {
  const c = readCache();
  while (c.size > CACHE_CAP) c.delete(c.keys().next().value);
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify([...c]));
  } catch {
    // Storage full or blocked: keep levels in memory for this visit only.
  }
}

const str = (s, max) => typeof s === "string" && s.trim().length > 0 && s.length <= max;
function valid(lv) {
  if (!lv || !Array.isArray(lv.truths) || lv.truths.length !== 2) return false;
  if (![...lv.truths, lv.lie].every((s) => str(s, MAX_STATEMENT)) || !str(lv.why, MAX_WHY)) return false;
  const all = [...lv.truths, lv.lie].map((s) => s.trim().toLowerCase());
  return new Set(all).size === 3;
}

/** The level if it's ready to play right now (hand-written or cached), else null. */
export function getLevel(n) {
  if (n <= LEVELS.length) return LEVELS[n - 1];
  const lv = readCache().get(n);
  return lv ? { n, cat: subjectFor(n), ...lv } : null;
}

/** Forget an AI level so the next request writes a new one. */
export function discardLevel(n) {
  if (readCache().delete(n)) writeCache();
}

/* ---------- requests ---------- */
async function callApi(userMessage) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "fiblab", userMessage }),
  });
  if (res.status === 429) throw new Error("Too many new levels in a short time. Wait a few minutes, then try again.");
  if (!res.ok) throw new Error(`The level writer didn't answer (error ${res.status}). Try again in a moment.`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "The level writer reported an error. Try again.");
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
}

function buildMessage(ns) {
  const lines = ns.map((n) => {
    const cat = subjectFor(n);
    const focus = FOCUS[cat][Math.floor(Math.random() * FOCUS[cat].length)];
    return `- n=${n}, subject: ${SUBJECTS[cat].name}, focus: ${focus}`;
  });
  // Recent AI lies plus a sample of the hand-written ones, so new levels don't repeat them.
  const recent = [...readCache().values()].slice(-30).map((lv) => lv.lie);
  const classics = LEVELS.map((L) => L.lie);
  const avoid = [...recent, ...classics].map((s) => `- ${s}`).join("\n");
  return `Write these ${ns.length} levels:\n${lines.join("\n")}\n\nAvoid (already used as lies):\n${avoid}`;
}

function parseLevels(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("The level writer sent something unreadable. Try again.");
  const arr = JSON.parse(cleaned.slice(start, end + 1));
  return Array.isArray(arr) ? arr : [];
}

const inflight = new Map(); // n -> promise of the batch that will contain it

async function fetchBatch(ns) {
  const text = await callApi(buildMessage(ns));
  const wanted = new Set(ns);
  const c = readCache();
  for (const raw of parseLevels(text)) {
    const n = Number(raw?.n);
    if (!wanted.has(n)) continue;
    const lv = {
      truths: Array.isArray(raw.truths) ? raw.truths.map((s) => String(s).trim()) : [],
      lie: String(raw.lie ?? "").trim(),
      why: String(raw.why ?? "").trim(),
    };
    if (valid(lv)) c.set(n, lv);
  }
  writeCache();
}

/** Resolve with level n, writing it (and the next few) first if needed. */
export function ensureLevel(n) {
  const ready = getLevel(n);
  if (ready) return Promise.resolve(ready);
  if (!inflight.has(n)) {
    const ns = [];
    for (let k = n; k <= TOTAL && ns.length < BATCH; k++) if (!getLevel(k) && !inflight.has(k)) ns.push(k);
    const p = fetchBatch(ns).finally(() => ns.forEach((k) => inflight.delete(k)));
    ns.forEach((k) => inflight.set(k, p));
  }
  return inflight.get(n).then(() => {
    const lv = getLevel(n);
    if (!lv) throw new Error(`Level ${n} came back incomplete. Try again.`);
    return lv;
  });
}

/** Quietly write level n ahead of time; failures are retried when it's actually played. */
export function prefetch(n) {
  if (n <= TOTAL && isAiLevel(n) && !getLevel(n)) ensureLevel(n).catch(() => {});
}
