const TONE = "Tone: friendly, fun, and very hilarious — like a sharp, warm friend who makes problem-solving feel light. Be human, never robotic. Stay USER-CENTRIC: write for a real person living a real life. Remember to base on the user's prompt language to respond in the same language.";

// Fib Lab levels should feel like a fun quiz night, not a biology exam.
const FIBLAB_PROMPT = [
 "You write levels for Fib Lab, a science trivia game for regular people: teenagers and adults with no science background. In every level, two statements are TRUE and one is a LIE, and the player has to spot the lie.",
 "",
 "What makes a good level:",
 "- Everyday words. No jargon or textbook phrasing (no 'eukaryotic', 'biochemical', 'primary site', 'organelle'). If a word needs a science class to understand, don't use it.",
 "- Short: each statement is one sentence of at most 90 characters.",
 "- The TRUE statements are fun, surprising facts that make people say 'wait, really?' but are well-established science that no expert would dispute.",
 "- The LIE is something many people actually believe (a popular myth or a common mix-up), or a fact twisted so a curious person could catch it with everyday knowledge and a bit of thinking. Never a detail only a specialist would know. It must be clearly false, never partly true, never a wording trick.",
 "- The lie must not stand out: all three statements share the level's focus and match in length, tone and confidence.",
 "- Avoid record-holders and counts that change over time (number of known moons, newest discoveries) and 'a recent study found' claims.",
 "- \"why\" says what is actually true, in 1 or 2 short, friendly sentences of at most 200 characters.",
 "",
 "Good levels:",
 "{\"truths\": [\"Octopuses have three hearts.\", \"Sharks have skeletons made of cartilage, not bone.\"], \"lie\": \"Sea turtles are amphibians.\", \"why\": \"Sea turtles are reptiles. They breathe air with lungs, have scaly skin, and lay shelled eggs on land.\"}",
 "{\"truths\": [\"Sound travels faster in water than in air.\", \"Sunlight takes about 8 minutes to reach Earth.\"], \"lie\": \"In a vacuum, a heavy ball falls faster than a feather.\", \"why\": \"Without air in the way, everything falls at the same rate. Astronauts showed this on the Moon with a hammer and a feather.\"}",
 "{\"truths\": [\"Your bones are alive and constantly rebuild themselves.\", \"Babies are born with more bones than adults have.\"], \"lie\": \"Cracking your knuckles causes arthritis.\", \"why\": \"Studies found no link. The pop is just gas bubbles in the fluid inside your joints.\"}",
 "",
 "Too hard, don't write levels like this:",
 "{\"truths\": [\"Mitochondria are organelles that generate most of the chemical energy needed to power the cell's biochemical reactions.\", \"The cell membrane is a phospholipid bilayer that regulates the passage of substances.\"], \"lie\": \"The nucleus is the primary site where proteins are synthesized within a eukaryotic cell.\"}",
 "",
 "Never reuse or paraphrase anything listed under Avoid, and make each level in the batch about something different.",
 "",
 "Return ONLY a JSON array, one object per requested level, no markdown fences:",
 "[{\"n\": 121, \"truths\": [\"...\", \"...\"], \"lie\": \"...\", \"why\": \"...\"}]",
].join("\n");

const PROMPTS = {
 keywords: TONE + "\n\nYou are a problem-diagnosis assistant. Given a problem and an optional narrowing context, generate exactly 5 diagnostic items as a JSON array.\n\nEach object MUST have:\n- \"id\": short snake_case string\n- \"label\": short 1-2 word tag (used in tiny chips/badges only)\n- \"question\": ONE clear, engaging yes/no question (max 14 words, ends with \"?\", playful but genuine). Must be answerable yes or no by a real person describing their life. Avoid technical phrasing.\n- \"tooltip\": one short, warm, human description (max 18 words). Concrete examples or vivid numbers are a bonus.\n\nReturn ONLY a valid JSON array — no markdown fences, no commentary.\n\nExample for a non-technical problem:\n[\n { \"id\": \"sleep_disruption\", \"label\": \"Sleep\", \"question\": \"Has your sleep been a wreck lately?\", \"tooltip\": \"Even one short night can turn your brain into oatmeal for 48 hours.\" }\n]",

 analysis: TONE + "\n\nBased on the user's problem and their yes/no answers so far, write a short, warm \"current analysis\" (3 to 5 sentences) summarising what you are piecing together and where things look like they are heading.",

 conclusion: TONE + "\n\nBased on the user's problem and their yes/no choices (plus any custom directions they added), hand them a conclusion in two clearly separated parts:\n\n1) A short summary paragraph (2 to 3 sentences) of what you have narrowed down. Warm and human.\n\n2) A practical step-by-step solution as a numbered list (3 to 6 concrete steps they can actually do today). Plain numbered lines like \"1. ...\", \"2. ...\". Each step should be something a regular person can do without special tools or expertise.\n\nDon't add other sections or headings. Stay user-centric. No technical jargon unless the user's problem is technical.",

 followup: TONE + "\n\nThe user just saw a diagnostic conclusion with a step-by-step plan and is replying to \"Does this solve your problem?\". Their reply may confirm, deny, or add nuance. Respond in 3 to 5 sentences:\n- If solved: celebrate briefly and slip in one short tip to keep it that way.\n- If not solved: name 1 or 2 likely reasons and one concrete next thing to try.\n- If unclear: ask ONE focused follow-up to pin it down.",

 details: TONE + "\n\nExplain a single diagnostic question in the context of a user's problem. Write a warm, plain-language explanation of roughly 200 words (180 to 220). Cover: what this typically looks like in everyday life, why it matters for their situation, and a concrete way to notice if it's happening to them.",

 insight: TONE + "\n\nThe user is exploring their problem. Given their path so far, the question they are investigating, and their free-text answer, reply in 3 to 5 sentences:\n1. Acknowledge what is narrowed down.\n2. Interpret their answer in context, like a sharp friend would.\n3. Suggest a likely root cause or a concrete next step.\nSpeak directly to the user. Keep it user-centric.",
 fiblab: FIBLAB_PROMPT,
};

const MAX_TOKENS_BY_KIND = {
 keywords: 1024,
 analysis: 512,
 conclusion: 1024,
 followup: 512,
 details: 1024,
 insight: 512,
 fiblab: 3072,
};

const TEMPERATURE = 0.8;
// Fib Lab needs facts more than flair, and its reply must be bare JSON.
const TEMPERATURE_BY_KIND = { fiblab: 0.6 };
const JSON_KINDS = new Set(["fiblab"]);
const MAX_USER_MESSAGE_CHARS = 16000;

// Abuse guard. Browsers always send Origin on a JSON POST; scripts usually don't.
// The per-IP limit lives in this instance's memory, so it is a soft second layer.
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 40;
const hits = new Map();

function fromOurSite(req) {
 const source = req.headers.origin || req.headers.referer;
 if (!source) return false;
 let host;
 try {
 host = new URL(source).host;
 } catch {
 return false;
 }
 const ownHost = req.headers["x-forwarded-host"] || req.headers.host;
 if (host === ownHost) return true;
 const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
 return local && process.env.VERCEL_ENV !== "production";
}

function overLimit(req) {
 const ip = String(req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
 const now = Date.now();
 const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
 recent.push(now);
 hits.set(ip, recent);
 if (hits.size > 5000) {
 for (const [key, times] of hits) if (now - times[times.length - 1] >= RATE_WINDOW_MS) hits.delete(key);
 }
 return recent.length > RATE_MAX;
}

export default async function handler(req, res) {
 if (req.method !== "POST") {
 res.setHeader("Allow", "POST");
 return res.status(405).end();
 }

 if (!fromOurSite(req)) {
 console.warn("[blocked]", "origin", req.headers["user-agent"] || "-");
 return res.status(403).json({ error: { message: "Forbidden" } });
 }
 if (overLimit(req)) {
 console.warn("[blocked]", "rate", req.headers["user-agent"] || "-");
 res.setHeader("Retry-After", "600");
 return res.status(429).json({ error: { message: "Too many requests, try again in a few minutes" } });
 }

 const { kind, userMessage } = req.body || {};

 const systemPrompt = PROMPTS[kind];
 if (!systemPrompt) {
 return res.status(400).json({ error: { message: "Invalid kind" } });
 }
 if (typeof userMessage !== "string" || !userMessage.trim()) {
 return res.status(400).json({ error: { message: "Missing userMessage" } });
 }
 if (userMessage.length > MAX_USER_MESSAGE_CHARS) {
 return res.status(400).json({ error: { message: "userMessage too long" } });
 }

 const maxOutputTokens = MAX_TOKENS_BY_KIND[kind];

 console.log("[request]", kind, "len=" + userMessage.length);

 try {
 const response = await fetch(
 "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=" + process.env.GEMINI_API_KEY,
 {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 systemInstruction: { parts: [{ text: systemPrompt }] },
 contents: [{ role: "user", parts: [{ text: userMessage }] }],
 generationConfig: {
 maxOutputTokens: maxOutputTokens,
 temperature: TEMPERATURE_BY_KIND[kind] ?? TEMPERATURE,
 ...(JSON_KINDS.has(kind) && { responseMimeType: "application/json" }),
 },
 }),
 }
 );

 const data = await response.json();
 console.log("[response]", kind, response.status);

 res.status(response.status).json(data);
 } catch (err) {
 console.error("[error]", kind, err);
 res.status(500).json({ error: { message: "Upstream failure" } });
 }
}
