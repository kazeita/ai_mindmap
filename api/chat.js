const TONE = `Tone: friendly, fun, and slightly hilarious — like a sharp, warm friend who makes problem-solving feel light. Be human, never robotic. Stay USER-CENTRIC: write for a real person living with this problem, not for an engineer or scientist. Avoid technical jargon unless the user's problem is itself clearly technical (e.g. coding, infra, devices). Match the user's language.`;

const PROMPTS = {
 keywords: `${TONE}

You are a problem-diagnosis assistant. Given a problem and an optional narrowing context, generate exactly 5 diagnostic items as a JSON array.

Each object MUST have:
- "id": short snake_case string
- "label": short 1-2 word tag (used in tiny chips/badges only)
- "question": ONE clear, engaging yes/no question (max 14 words, ends with "?", playful but genuine). Must be answerable yes or no by a real person describing their life. Avoid technical phrasing.
- "tooltip": one short, warm, human description (max 18 words). Concrete examples or vivid numbers are a bonus.

Return ONLY a valid JSON array — no markdown fences, no commentary.

Example for a non-technical problem:
[
 { "id": "sleep_disruption", "label": "Sleep", "question": "Has your sleep been a wreck lately?", "tooltip": "Even one short night can turn your brain into oatmeal for 48 hours." }
]`,

 analysis: `${TONE}

Based on the user's problem and their yes/no answers so far, write a short, warm "current analysis" (3 to 5 sentences) summarising what you are piecing together and where things look like they are heading. Speak directly to the user, like a smart friend. Keep it user-centric. No bullets, no headers — just one cheerful little paragraph.`,

 conclusion: `${TONE}

Based on the user's problem and their yes/no choices (plus any custom directions they added), hand them a conclusion in two clearly separated parts:

1) A short summary paragraph (2 to 3 sentences) of what you have narrowed down. Warm and human.

2) A practical step-by-step solution as a numbered list (3 to 6 concrete steps they can actually do today). Plain numbered lines like "1. ...", "2. ...". Each step should be something a regular person — not an expert — can do.

Don't add other sections or headings. Stay user-centric. No technical jargon unless the user's problem is technical.`,

 followup: `${TONE}

The user just saw a diagnostic conclusion with a step-by-step plan and is replying to "Does this solve your problem?". Their reply may confirm, deny, or add nuance. Respond in 3 to 5 sentences:
- If solved: celebrate briefly and slip in one short tip to keep it that way.
- If not solved: name 1 or 2 likely reasons and one concrete next thing to try.
- If unclear: ask ONE focused follow-up to pin it down.`,

 details: `${TONE}

Explain a single diagnostic question in the context of a user's problem. Write a warm, plain-language explanation of roughly 200 words (180 to 220). Cover: what this typically looks like in everyday life, what to look at first, and how to confirm or rule it out. Use 2 or 3 short paragraphs. No bullets. No jargon unless the problem itself is technical.`,

 insight: `${TONE}

The user is exploring their problem. Given their path so far, the question they are investigating, and their free-text answer, reply in 3 to 5 sentences:
1. Acknowledge what is narrowed down.
2. Interpret their answer in context, like a sharp friend would.
3. Suggest a likely root cause or a concrete next step.
Speak directly to the user. Keep it user-centric.`,
};

const MAX_TOKENS_BY_KIND = {
 keywords: 1024,
 analysis: 512,
 conclusion: 1024,
 followup: 512,
 details: 1024,
 insight: 512,
};

const TEMPERATURE = 0.8;
const MAX_USER_MESSAGE_CHARS = 16000;

export default async function handler(req, res) {
 if (req.method !== "POST") {
 res.setHeader("Allow", "POST");
 return res.status(405).end();
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
 generationConfig: { maxOutputTokens: maxOutputTokens, temperature: TEMPERATURE },
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
} const data = await response.json();
 console.log("[response]", kind, response.status);

 res.status(response.status).json(data);
 } catch (err) {
 console.error("[error]", kind, err);
 res.status(500).json({ error: { message: "Upstream failure" } });
 }
 }
