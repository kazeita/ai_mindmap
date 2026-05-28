import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { Analytics } from "@vercel/analytics/react";

/* ───────────────────────── prompts ───────────────────────── */

const KEYWORDS_PROMPT = `You are a warm, friendly problem diagnosis assistant. Given a problem and an optional narrowing context, generate exactly 5 diagnostic items as a JSON array.

Each object MUST have:
- "id": short snake_case string
- "label": short 1-2 word tag (used only in small chips/badges)
- "question": ONE clear, engaging yes/no question (max 14 words, friendly tone, must end with "?", must be answerable yes or no). This is the main thing shown to the user.
- "tooltip": one short plain-language description (max 18 words; include a concrete example or number when possible)

Return ONLY a valid JSON array — no markdown fences, no commentary. Match the user's language.

Example:
[
 { "id": "sleep_disruption", "label": "Sleep", "question": "Has your sleep been disrupted in the past 2 weeks?", "tooltip": "Less than 6 hours nightly can cause irritability and fatigue within days." }
]`;

const ANALYSIS_PROMPT = `You are a friendly diagnostic assistant. Based on the user's problem and their yes/no answers so far, write a short, conversational "current analysis" (3–5 sentences) summarising what we've learned and where things are pointing. No bullets, no headers — just a warm short paragraph. Match the user's language.`;

const CONCLUSION_PROMPT = `You are a friendly diagnostic assistant. Based on the user's problem and their yes/no choices so far, provide a conclusion with two clearly separated parts:

1) A short summary paragraph (2–3 sentences) of what we've narrowed down.

2) A practical step-by-step solution as a numbered list (3–6 concrete steps the user can act on today). Use plain numbered lines like "1. ...", "2. ...", etc.

Be warm and concrete. Match the user's language. Do not add other sections or headings beyond the summary and the numbered steps.`;

const FOLLOWUP_PROMPT = `The user just saw a diagnostic conclusion with a step-by-step solution and is responding to the question "Does this solve your problem?". Their reply may confirm, deny, or add nuance. Respond in 3–5 sentences:
- If solved: validate and offer one short maintenance tip.
- If not solved: name 1–2 likely reasons and one concrete next step to try.
- If unclear: ask one focused follow-up question.
Match the user's language.`;

const DETAILS_PROMPT = `You explain a single diagnostic question in the context of a user's problem. Write a friendly explanation of ~200 words (180–220). Cover what this typically looks like, what to inspect first, and how to confirm or rule it out. 2–3 short paragraphs, no bullets. Match the user's language.`;

const INSIGHT_PROMPT = `You are a diagnostic assistant. The user is exploring their problem. Given their path so far, the question they're investigating, and their free-text answer, provide a brief diagnostic summary (3–5 sentences):
1. Acknowledge what's narrowed down.
2. Interpret their answer in context.
3. Suggest a likely root cause or concrete next step.
Match the user's language.`;

/* ───────────────────────── api ───────────────────────── */

const BASE = "/api/chat";
const MODEL_LABEL = "gemini-3.1-flash-lite";
const STEPS_PER_CONCLUSION = 5;

let idCounter = 0;
const uid = (s) => `${s}__${++idCounter}`;

async function callGemini(systemPrompt, userMessage, maxTokens = 1024) {
 const res = await fetch(BASE, {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 systemInstruction: { parts: [{ text: systemPrompt }] },
 contents: [{ role: "user", parts: [{ text: userMessage }] }],
 generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
 }),
 });
 if (!res.ok) {
 const body = await res.text().catch(() => "");
 throw new Error(`API ${res.status}: ${body.slice(0, 200)}`);
 }
 const data = await res.json();
 if (data.error) throw new Error(data.error.message || "Gemini API error");
 return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function fetchKeywords(problem, pathLabels, rejectedLabels = []) {
 let msg;
 if (pathLabels.length === 0) {
 msg = `Problem: "${problem}"\nGenerate 5 top-level diagnostic items.`;
 } else {
 msg = `Original problem: "${problem}"
Narrowed down through: ${pathLabels.join(" → ")}
Generate 5 sub-items that further narrow the cause within "${pathLabels[pathLabels.length - 1]}". Stay inside that sub-area.`;
 }
 if (rejectedLabels.length > 0) {
 msg += `\n\nThe user already ruled out: ${rejectedLabels.join(", ")}. Propose 5 entirely different angles.`;
 }
 const text = await callGemini(KEYWORDS_PROMPT, msg);
 const cleaned = text.replace(/```json|```/g, "").trim();
 return JSON.parse(cleaned).map((k) => ({ ...k, id: uid(k.id) }));
}

const formatChoices = (choices) =>
 choices.map((c, i) => `${i + 1}. "${c.question}" → ${c.answer.toUpperCase()}`).join("\n");

async function fetchAnalysis(problem, choices) {
 if (choices.length === 0) return "";
 const msg = `Problem: "${problem}"
Choices so far:
${formatChoices(choices)}

Write a short current analysis (3–5 sentences).`;
 return callGemini(ANALYSIS_PROMPT, msg, 512);
}

async function fetchConclusion(problem, choices) {
 const msg = `Problem: "${problem}"
Choices so far:
${formatChoices(choices)}

Write the structured conclusion with a summary paragraph then a numbered step-by-step solution.`;
 return callGemini(CONCLUSION_PROMPT, msg, 1024);
}

async function fetchFollowup(problem, conclusion, reply) {
 const msg = `Problem: "${problem}"
Conclusion shown to user: """${conclusion}"""
User's reply to "Does this solve your problem?": "${reply}"

Respond.`;
 return callGemini(FOLLOWUP_PROMPT, msg, 512);
}

async function fetchDetails(problem, pathLabels, kw) {
 const msg = `Problem: "${problem}"
Path: ${pathLabels.length ? pathLabels.join(" → ") : "(top level)"}
Question being explored: "${kw.question}"
Short brief: "${kw.tooltip || ""}"

Write a ~200-word friendly explanation of how this could be the cause, what to inspect, and how to verify.`;
 return callGemini(DETAILS_PROMPT, msg);
}

async function fetchInsight(problem, pathLabels, kw, answer) {
 const msg = `Problem: "${problem}"
Path: ${pathLabels.length ? pathLabels.join(" → ") : "(top level)"}
Question under investigation: "${kw.question}" — ${kw.tooltip || ""}
User's answer: "${answer}"

Provide a brief diagnostic summary.`;
 return callGemini(INSIGHT_PROMPT, msg);
}

/* ───────────────────────── visual atoms ───────────────────────── */

function RootCard({ problem }) {
 return (
 <motion.div layout className="root-card">
 <span className="tag">your problem</span>
 <p className="root-text">{problem}</p>
 </motion.div>
 );
}

function ParentCard({ label, question, tooltip }) {
 return (
 <motion.div layout className="parent-card">
 <span className="tag">exploring</span>
 <h3 className="parent-text">{label}</h3>
 {question && <p className="parent-sub">{question}</p>}
 {tooltip && <p className="parent-tooltip">{tooltip}</p>}
 </motion.div>
 );
}

function ChosenBadge({ kw }) {
 return (
 <motion.div layoutId={`kw-${kw.id}`} className="chosen-badge">
 <span className="check">✓</span>
 <span className="chosen-label">{kw.label}</span>
 </motion.div>
 );
}

function RejectedChip({ kw, onReopen }) {
 return (
 <motion.button
 layoutId={`kw-${kw.id}`}
 onClick={() => onReopen(kw)}
 className="rejected-chip"
 whileHover={{ opacity: 1, y: -2 }}
 title="click to reconsider"
 >
 <span className="rejected-x">✕</span>
 <span className="rejected-label">{kw.label}</span>
 </motion.button>
 );
}

function ActiveCard({ kw, onYes, onNo, onDetails, onInsight, busy }) {
 return (
 <motion.div
 layoutId={`kw-${kw.id}`}
 className="active-wrap"
 transition={{ type: "spring", stiffness: 220, damping: 28 }}
 >
 <div className={`active-card ${busy ? "busy" : ""}`}>
 <motion.div
 initial={{ opacity: 0, y: 8 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ delay: 0.08 }}
 >
 <h2 className="active-question-title">{kw.question}</h2>
 <p className="active-desc">{kw.tooltip}</p>
 <div className="active-actions">
 <button className="btn-yes" onClick={() => onYes(kw)} disabled={busy}>Yes</button>
 <button className="btn-no" onClick={() => onNo(kw)} disabled={busy}>No</button>
 <button className="btn-more" onClick={() => onDetails(kw)} disabled={busy}>More details</button>
 <button className="btn-insight" onClick={() => onInsight(kw)} disabled={busy} aria-label="Free-text insight" title="Free-text insight">💬</button>
 </div>
 </motion.div>
 </div>
 </motion.div>
 );
}

function Connector({ short }) {
 return <div className={short ? "connector short" : "connector"} />;
}

function LoadingBlock({ label = "thinking…" }) {
 return (
 <div className="loading-block">
 <span className="dots"><span /><span /><span /></span>
 <span>{label}</span>
 </div>
 );
}

/* ───────────────────────── level ───────────────────────── */

function LevelView({
 level,
 isCurrent,
 loading,
 onYes, onNo, onDetails, onInsight, onReopen,
}) {
 const { parentLabel, parentQuestion, parentTooltip, keywords, currentIndex, rejectedIds, chosenId, isRoot } = level;
 const rejected = keywords.filter((k) => rejectedIds.includes(k.id));
 const chosen = chosenId ? keywords.find((k) => k.id === chosenId) : null;
 const active = !chosen && currentIndex < keywords.length ? keywords[currentIndex] : null;
 const showActiveArea = active || chosen || (isCurrent && loading);

 return (
 <div className="level">
 <div className="level-parent">
 {isRoot
 ? <RootCard problem={parentLabel} />
 : <ParentCard label={parentLabel} question={parentQuestion} tooltip={parentTooltip} />}
 </div>

 {(showActiveArea || rejected.length > 0) && <Connector />}

 {(showActiveArea || rejected.length > 0) && (
 <div className="level-row">
 {rejected.length > 0 && (
 <div className="rejected-stack">
 <AnimatePresence>
 {rejected.map((kw) => (
 <RejectedChip key={kw.id} kw={kw} onReopen={onReopen} />
 ))}
 </AnimatePresence>
 </div>
 )}

 <div className="active-area">
 <AnimatePresence mode="popLayout">
 {chosen ? (
 <ChosenBadge key={`chosen-${chosen.id}`} kw={chosen} />
 ) : isCurrent && loading ? (
 <motion.div
 key="loading"
 initial={{ opacity: 0, y: 8 }}
 animate={{ opacity: 1, y: 0 }}
 exit={{ opacity: 0, y: -4 }}
 >
 <LoadingBlock label="thinking…" />
 </motion.div>
 ) : active ? (
 <ActiveCard
 key={active.id}
 kw={active}
 onYes={onYes}
 onNo={onNo}
 onDetails={onDetails}
 onInsight={onInsight}
 />
 ) : null}
 </AnimatePresence>
 </div>
 </div>
 )}
 </div>
 );
}

/* ───────────────────────── analysis panel ───────────────────────── */

function AnalysisPanel({ analysis, loading, stepCount }) {
 const progress = stepCount === 0
 ? 0
 : (stepCount % STEPS_PER_CONCLUSION === 0
 ? 1
 : (stepCount % STEPS_PER_CONCLUSION) / STEPS_PER_CONCLUSION);
 const remaining = stepCount === 0
 ? STEPS_PER_CONCLUSION
 : (stepCount % STEPS_PER_CONCLUSION === 0 ? 0 : STEPS_PER_CONCLUSION - (stepCount % STEPS_PER_CONCLUSION));

 return (
 <div className="analysis-panel">
 <div className="panel-head">
 <span className="panel-tag">current analysis</span>
 <span className="panel-step">step {stepCount}</span>
 </div>
 <div className="panel-body">
 {!analysis && loading ? (
 <div className="panel-loading">
 <span className="dots"><span /><span /><span /></span>
 <span>reading the room…</span>
 </div>
 ) : analysis ? (
 <>
 <motion.p
 key={analysis}
 className="panel-text"
 initial={{ opacity: 0, y: 6 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ duration: 0.4 }}
 >
 {analysis}
 </motion.p>
 {loading && (
 <div className="panel-loading mini">
 <span className="dots"><span /><span /><span /></span>
 <span>updating…</span>
 </div>
 )}
 </>
 ) : (
 <p className="panel-empty">
 As you answer questions, a short running analysis will appear here.
 </p>
 )}
 </div>
 {stepCount > 0 && (
 <div className="panel-footer">
 <div className="panel-progress">
 <div className="panel-progress-bar" style={{ width: `${progress * 100}%` }} />
 </div>
 <span className="panel-progress-label">
 {remaining === 0
 ? "conclusion ready"
 : `${remaining} step${remaining === 1 ? "" : "s"} to next conclusion`}
 </span>
 </div>
 )}
 </div>
 );
}

/* ───────────────────────── modals ───────────────────────── */

function ModalShell({ children, onClose, wide }) {
 return (
 <motion.div
 className="modal-overlay"
 onClick={onClose}
 initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
 >
 <motion.div
 className={`modal ${wide ? "wide" : ""}`}
 onClick={(e) => e.stopPropagation()}
 initial={{ opacity: 0, y: 16, scale: 0.97 }}
 animate={{ opacity: 1, y: 0, scale: 1 }}
 exit={{ opacity: 0, y: 10, scale: 0.97 }}
 transition={{ type: "spring", stiffness: 240, damping: 28 }}
 >
 <button className="modal-close" onClick={onClose}>✕</button>
 {children}
 </motion.div>
 </motion.div>
 );
}

function DetailsModal({ keyword, content, loading, onClose }) {
 return (
 <ModalShell onClose={onClose}>
 <span className="modal-tag">more details</span>
 <h2 className="modal-title">{keyword.question}</h2>
 <p className="modal-sub">{keyword.tooltip}</p>
 {loading
 ? <div className="modal-loading"><span className="dots"><span /><span /><span /></span><p>writing a deeper explanation…</p></div>
 : <div className="modal-body">{content}</div>}
 </ModalShell>
 );
}

function InsightModal({ keyword, problem, pathLabels, onClose }) {
 const [answer, setAnswer] = useState("");
 const [summary, setSummary] = useState(null);
 const [loading, setLoading] = useState(false);

 const submit = async () => {
 if (!answer.trim()) return;
 setLoading(true);
 try {
 const s = await fetchInsight(problem, pathLabels, keyword, answer);
 setSummary(s);
 } catch {
 setSummary("Unable to generate an insight right now. Please try again.");
 }
 setLoading(false);
 };

 return (
 <ModalShell onClose={onClose}>
 <span className="modal-tag">insight</span>
 <h2 className="modal-title">{keyword.question}</h2>
 <p className="modal-sub">{keyword.tooltip}</p>

 {!summary ? (
 <>
 <textarea
 className="modal-textarea"
 placeholder="Share what you've observed…"
 value={answer}
 onChange={(e) => setAnswer(e.target.value)}
 onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
 autoFocus
 />
 <div className="modal-actions">
 <button className="btn-primary small" onClick={submit} disabled={loading || !answer.trim()}>
 {loading ? "Thinking…" : "Get insight →"}
 </button>
 </div>
 </>
 ) : (
 <div className="modal-body">
 <div className="insight-block"><span className="lbl">your answer</span><p>{answer}</p></div>
 <div className="insight-block insight"><span className="lbl">💡 insight</span><p>{summary}</p></div>
 <div className="modal-actions"><button className="btn-secondary" onClick={onClose}>Done</button></div>
 </div>
 )}
 </ModalShell>
 );
}

function ConclusionModal({ problem, choices, content, loading, onClose }) {
 const [reply, setReply] = useState("");
 const [followup, setFollowup] = useState(null);
 const [followupLoading, setFollowupLoading] = useState(false);

 const submit = async () => {
 if (!reply.trim() || followupLoading) return;
 setFollowupLoading(true);
 try {
 const text = await fetchFollowup(problem, content || "", reply);
 setFollowup(text);
 } catch {
 setFollowup("Could not generate a follow-up right now.");
 }
 setFollowupLoading(false);
 };

 return (
 <ModalShell onClose={onClose} wide>
 <span className="modal-tag">conclusion · step {choices.length}</span>
 <h2 className="modal-title">Where we've landed</h2>
 <p className="modal-sub">A diagnostic summary based on your {choices.length} answers so far.</p>

 {loading ? (
 <div className="modal-loading">
 <span className="dots"><span /><span /><span /></span>
 <p>writing your conclusion…</p>
 </div>
 ) : (
 <>
 <div className="conclusion-body">{content}</div>

 <p className="conclusion-question">Does this solve your problem?</p>

 {!followup ? (
 <>
 <textarea
 className="modal-textarea"
 placeholder="Tell us how it went — solved, not quite, or something in between."
 value={reply}
 onChange={(e) => setReply(e.target.value)}
 onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
 autoFocus
 />
 <div className="modal-actions">
 <button className="btn-secondary" onClick={onClose}>Keep exploring</button>
 <button className="btn-primary small" onClick={submit} disabled={followupLoading || !reply.trim()}>
 {followupLoading ? "Thinking…" : "Send →"}
 </button>
 </div>
 </>
 ) : (
 <div className="modal-body">
 <div className="insight-block"><span className="lbl">your reply</span><p>{reply}</p></div>
 <div className="insight-block insight"><span className="lbl">💡 follow-up</span><p>{followup}</p></div>
 <div className="modal-actions">
 <button className="btn-secondary" onClick={onClose}>Keep exploring</button>
 </div>
 </div>
 )}
 </>
 )}
 </ModalShell>
 );
}

/* ───────────────────────── root ───────────────────────── */

export default function AppV2() {
 const [problem, setProblem] = useState("");
 const [submitted, setSubmitted] = useState(false);
 const [levels, setLevels] = useState([]);
 const [loading, setLoading] = useState(false);

 const [choices, setChoices] = useState([]);
 const [analysis, setAnalysis] = useState("");
 const [analysisLoading, setAnalysisLoading] = useState(false);
 const [lastConclusionAt, setLastConclusionAt] = useState(0);

 const [conclusionOpen, setConclusionOpen] = useState(false);
 const [conclusionContent, setConclusionContent] = useState(null);
 const [conclusionLoading, setConclusionLoading] = useState(false);

 const [detailsTarget, setDetailsTarget] = useState(null);
 const [detailsContent, setDetailsContent] = useState(null);
 const [detailsLoading, setDetailsLoading] = useState(false);

 const [insightTarget, setInsightTarget] = useState(null);

 const currentLevel = levels[levels.length - 1];
 const pathLabels = currentLevel?.pathLabels || [];
 const stepCount = choices.length;

 /* ── helpers ── */

 const maybeTriggerConclusion = async (newChoices) => {
 if (
 newChoices.length > 0 &&
 newChoices.length % STEPS_PER_CONCLUSION === 0 &&
 newChoices.length > lastConclusionAt
 ) {
 setLastConclusionAt(newChoices.length);
 setConclusionOpen(true);
 setConclusionContent(null);
 setConclusionLoading(true);
 try {
 const text = await fetchConclusion(problem, newChoices);
 setConclusionContent(text);
 } catch {
 setConclusionContent("Couldn't generate a conclusion right now.");
 }
 setConclusionLoading(false);
 }
 };

 const refreshAnalysis = async (choicesNow) => {
 if (choicesNow.length === 0) { setAnalysis(""); return; }
 setAnalysisLoading(true);
 try {
 const text = await fetchAnalysis(problem, choicesNow);
 setAnalysis(text);
 } catch (e) { console.error("analysis failed", e); }
 setAnalysisLoading(false);
 };

 /* ── handlers ── */

 const handleStart = async () => {
 if (!problem.trim() || submitted) return;
 setSubmitted(true);
 setLoading(true);
 try {
 const kws = await fetchKeywords(problem, []);
 setLevels([{
 parentLabel: problem,
 parentQuestion: null,
 parentTooltip: null,
 isRoot: true,
 keywords: kws,
 currentIndex: 0,
 rejectedIds: [],
 chosenId: null,
 pathLabels: [],
 }]);
 } catch (e) { console.error("start failed", e); }
 setLoading(false);
 };

 const handleNo = async (kw) => {
 setLevels((prev) => {
 const last = { ...prev[prev.length - 1] };
 last.rejectedIds = [...last.rejectedIds, kw.id];
 last.currentIndex = last.currentIndex + 1;
 return [...prev.slice(0, -1), last];
 });

 setLoading(true);
 const newChoices = [...choices, { question: kw.question, label: kw.label, answer: "no" }];
 setChoices(newChoices);
 await refreshAnalysis(newChoices);
 setLoading(false);

 await maybeTriggerConclusion(newChoices);
 };

 const handleYes = async (kw) => {
 setLevels((prev) => {
 const last = { ...prev[prev.length - 1] };
 last.chosenId = kw.id;
 return [...prev.slice(0, -1), last];
 });

 setLoading(true);
 const newChoices = [...choices, { question: kw.question, label: kw.label, answer: "yes" }];
 setChoices(newChoices);
 setAnalysisLoading(true);

 try {
 const newPath = [...(currentLevel?.pathLabels || []), kw.label];
 const [analysisText, kws] = await Promise.all([
 fetchAnalysis(problem, newChoices),
 fetchKeywords(problem, newPath),
 ]);
 setAnalysis(analysisText);
 setLevels((prev) => [...prev, {
 parentLabel: kw.label,
 parentQuestion: kw.question,
 parentTooltip: kw.tooltip,
 isRoot: false,
 keywords: kws,
 currentIndex: 0,
 rejectedIds: [],
 chosenId: null,
 pathLabels: newPath,
 }]);
 } catch (e) { console.error("yes failed", e); }

 setAnalysisLoading(false);
 setLoading(false);

 await maybeTriggerConclusion(newChoices);
 };

 const handleReopen = (kw) => {
 setLevels((prev) => {
 const last = { ...prev[prev.length - 1] };
 last.rejectedIds = last.rejectedIds.filter((id) => id !== kw.id);
 const idx = last.keywords.findIndex((k) => k.id === kw.id);
 const arr = [...last.keywords];
 const [item] = arr.splice(idx, 1);
 arr.splice(last.currentIndex, 0, item);
 last.keywords = arr;
 return [...prev.slice(0, -1), last];
 });
 };

 // auto-refetch when all current keywords are rejected
 useEffect(() => {
 if (loading || !currentLevel) return;
 if (currentLevel.chosenId) return;
 if (currentLevel.currentIndex < currentLevel.keywords.length) return;
 let cancelled = false;
 (async () => {
 setLoading(true);
 try {
 const rejectedLabels = currentLevel.keywords.map((k) => k.label);
 const more = await fetchKeywords(problem, currentLevel.pathLabels, rejectedLabels);
 if (cancelled) return;
 setLevels((prev) => {
 const last = { ...prev[prev.length - 1] };
 last.keywords = [...last.keywords, ...more];
 return [...prev.slice(0, -1), last];
 });
 } catch (e) { console.error("refetch failed", e); }
 if (!cancelled) setLoading(false);
 })();
 return () => { cancelled = true; };
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [levels]);

 const handleUndo = async () => {
 if (levels.length === 0) return;
 const last = levels[levels.length - 1];
 const canUndo = last.rejectedIds.length > 0 || levels.length > 1;
 if (!canUndo) return;

 setLevels((prev) => {
 const lastPrev = { ...prev[prev.length - 1] };
 if (lastPrev.rejectedIds.length > 0) {
 const lastRejected = lastPrev.rejectedIds[lastPrev.rejectedIds.length - 1];
 lastPrev.rejectedIds = lastPrev.rejectedIds.slice(0, -1);
 lastPrev.currentIndex = Math.max(0, lastPrev.currentIndex - 1);
 const idx = lastPrev.keywords.findIndex((k) => k.id === lastRejected);
 if (idx > -1) {
 const arr = [...lastPrev.keywords];
 const [item] = arr.splice(idx, 1);
 arr.splice(lastPrev.currentIndex, 0, item);
 lastPrev.keywords = arr;
 }
 return [...prev.slice(0, -1), lastPrev];
 }
 if (prev.length > 1) {
 const parentLevels = prev.slice(0, -1);
 const newLast = { ...parentLevels[parentLevels.length - 1] };
 newLast.chosenId = null;
 return [...parentLevels.slice(0, -1), newLast];
 }
 return prev;
 });

 const newChoices = choices.length > 0 ? choices.slice(0, -1) : choices;
 setChoices(newChoices);
 await refreshAnalysis(newChoices);
 };

 const handleReset = () => {
 setProblem("");
 setSubmitted(false);
 setLevels([]);
 setLoading(false);
 setChoices([]);
 setAnalysis("");
 setAnalysisLoading(false);
 setLastConclusionAt(0);
 setConclusionOpen(false);
 setConclusionContent(null);
 setConclusionLoading(false);
 setDetailsTarget(null);
 setDetailsContent(null);
 setInsightTarget(null);
 idCounter = 0;
 };

 const openDetails = async (kw) => {
 setDetailsTarget(kw);
 setDetailsContent(null);
 setDetailsLoading(true);
 try {
 const text = await fetchDetails(problem, pathLabels, kw);
 setDetailsContent(text);
 } catch {
 setDetailsContent("Unable to load details right now.");
 }
 setDetailsLoading(false);
 };

 const closeDetails = () => { setDetailsTarget(null); setDetailsContent(null); };

 const canUndo = useMemo(() => {
 if (levels.length === 0) return false;
 const last = levels[levels.length - 1];
 return last.rejectedIds.length > 0 || levels.length > 1;
 }, [levels]);

 /* ── render ── */

 return (
 <>
 <style>{styles}</style>
 <div className="app">
 <header className="header">
 <h1 onClick={handleReset}>Promes AI Map</h1>
 <p>describe a problem — explore it as a friendly map</p>
 {submitted && <div className="model-badge">{MODEL_LABEL}</div>}
 </header>

 <div className="input-area">
 <div className="input-row">
 <input
 className="input-field"
 placeholder="What problem are you trying to solve?"
 value={problem}
 onChange={(e) => setProblem(e.target.value)}
 onKeyDown={(e) => e.key === "Enter" && !submitted && handleStart()}
 disabled={submitted}
 />
 {!submitted && (
 <button className="btn-primary" onClick={handleStart} disabled={!problem.trim()}>
 Map it
 </button>
 )}
 </div>
 {submitted && (
 <div className="control-row">
 <button className="btn-ghost" onClick={handleUndo} disabled={!canUndo || loading}>↶ Undo</button>
 <button className="btn-ghost" onClick={handleReset}>← New problem</button>
 </div>
 )}
 </div>

 {submitted && (
 <div className="workspace">
 <div className="map-col">
 <LayoutGroup>
 <div className="map">
 {loading && levels.length === 0 && (
 <LoadingBlock label="mapping your problem…" />
 )}

 {levels.map((lv, i) => (
 <div className="level-wrap" key={i}>
 {i > 0 && <Connector short />}
 <LevelView
 level={lv}
 isCurrent={i === levels.length - 1}
 loading={loading && i === levels.length - 1}
 onYes={handleYes}
 onNo={handleNo}
 onDetails={openDetails}
 onInsight={(kw) => setInsightTarget(kw)}
 onReopen={handleReopen}
 />
 </div>
 ))}

 {loading && levels.length > 0 && levels[levels.length - 1].chosenId && (
 <>
 <Connector short />
 <LoadingBlock label="exploring deeper…" />
 </>
 )}

 {levels.length > 0 && (
 <div className="footer-actions">
 <button className="btn-ghost" onClick={handleReset}>↺ Start over</button>
 </div>
 )}
 </div>
 </LayoutGroup>
 </div>

 <aside className="panel-col">
 <AnalysisPanel
 analysis={analysis}
 loading={analysisLoading}
 stepCount={stepCount}
 />
 </aside>
 </div>
 )}

 <AnimatePresence>
 {detailsTarget && (
 <DetailsModal
 keyword={detailsTarget}
 content={detailsContent}
 loading={detailsLoading}
 onClose={closeDetails}
 />
 )}
 {insightTarget && (
 <InsightModal
 keyword={insightTarget}
 problem={problem}
 pathLabels={pathLabels}
 onClose={() => setInsightTarget(null)}
 />
 )}
 {conclusionOpen && (
 <ConclusionModal
 problem={problem}
 choices={choices}
 content={conclusionContent}
 loading={conclusionLoading}
 onClose={() => setConclusionOpen(false)}
 />
 )}
 </AnimatePresence>
 </div>
 <Analytics />
 </>
 );
}

/* ───────────────────────── styles ───────────────────────── */

const styles = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@5…

*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

body{
 background:radial-gradient(1200px 600px at 50% -10%, #efefff 0%, #f8f9ff 50%, #fbfbff 100%);
 color:#1f2330;
 font-family:'Inter',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
 min-height:100vh;
 -webkit-font-smoothing:antialiased;
}

.app{
 min-height:100vh;
 display:flex;flex-direction:column;align-items:center;
 padding:48px 24px 120px;
}

/* header */
.header{text-align:center;margin-bottom:36px}
.header h1{
 font-family:'Plus Jakarta Sans',sans-serif;
 font-size:32px;font-weight:800;letter-spacing:-0.025em;
 background:linear-gradient(90deg,#6366f1,#8b5cf6 60%,#a855f7);
 -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
 cursor:pointer;margin-bottom:8px;
}
.header p{font-size:14px;color:#6b7280}
.model-badge{
 margin-top:12px;font-size:11px;color:#5b58f0;
 background:#eef0ff;padding:4px 12px;border-radius:999px;
 display:inline-block;letter-spacing:0.04em;font-weight:500;
}

/* input */
.input-area{width:100%;max-width:640px;margin-bottom:40px}
.input-row{display:flex;gap:10px}
.input-field{
 flex:1;background:#ffffff;border:1px solid #e6e8ff;border-radius:14px;
 color:#1f2330;font-family:inherit;font-size:15px;padding:14px 18px;outline:none;
 transition:border-color .2s,box-shadow .2s;
 box-shadow:0 2px 10px rgba(99,102,241,0.04);
}
.input-field:focus{border-color:#a5a8ff;box-shadow:0 6px 22px rgba(99,102,241,0.10)}
.input-field::placeholder{color:#9ca3af}
.input-field:disabled{background:#fafbff;color:#6b7280;cursor:default}

.btn-primary{
 background:linear-gradient(135deg,#6366f1,#8b5cf6);
 color:#fff;border:none;border-radius:14px;
 font-family:inherit;font-size:14px;font-weight:600;
 padding:14px 22px;cursor:pointer;white-space:nowrap;
 transition:transform .15s,box-shadow .2s,opacity .2s;
 box-shadow:0 6px 18px rgba(99,102,241,0.28);
}
.btn-primary:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 10px 24px rgba(99,102,241,0.35)}
.btn-primary:disabled{opacity:.45;cursor:default;box-shadow:none}
.btn-primary.small{padding:10px 18px;font-size:13px;border-radius:12px}

.btn-secondary{
 background:#eef0ff;color:#4f46e5;border:none;border-radius:12px;
 font-family:inherit;font-size:13px;font-weight:600;
 padding:10px 18px;cursor:pointer;transition:background .15s;
}
.btn-secondary:hover{background:#e1e4ff}

.btn-ghost{
 background:transparent;color:#6b7280;border:1px solid #e6e8ff;
 border-radius:999px;font-family:inherit;font-size:12px;font-weight:500;
 padding:7px 14px;cursor:pointer;transition:all .15s;
}
.btn-ghost:hover:not(:disabled){color:#5b58f0;border-color:#c7caff;background:#fbfbff}
.btn-ghost:disabled{opacity:.4;cursor:default}

.control-row{display:flex;gap:8px;margin-top:12px;justify-content:flex-end}

/* workspace: map + side panel */
.workspace{
 display:grid;
 grid-template-columns:minmax(0,1fr) 320px;
 gap:32px;
 max-width:1340px;width:100%;align-items:start;
}
.map-col{min-width:0;display:flex;justify-content:center}
.panel-col{position:sticky;top:24px}
@media (max-width:1024px){
 .workspace{grid-template-columns:1fr;gap:24px}
 .panel-col{position:static;order:-1}
}

/* map */
.map{display:flex;flex-direction:column;align-items:center;width:100%;max-width:1000px;gap:0}

.level-wrap{display:flex;flex-direction:column;align-items:center;width:100%}
.level{display:flex;flex-direction:column;align-items:center;width:100%}
.level-parent{display:flex;justify-content:center}
.connector{width:2px;height:36px;background:linear-gradient(180deg,#c7caff,#eef0ff);border-radius:2px}
.connector.short{height:24px}

/* root + parent */
.root-card{
 background:#ffffff;border:1px solid #e6e8ff;border-radius:18px;
 padding:18px 26px;max-width:560px;text-align:center;
 box-shadow:0 8px 24px rgba(99,102,241,0.06);
}
.tag{
 display:block;font-size:10px;color:#8b8fb8;
 letter-spacing:0.15em;text-transform:uppercase;margin-bottom:6px;font-weight:600;
}
.root-text{font-size:16px;color:#1f2330;line-height:1.5;font-weight:500}

.parent-card{
 background:#ffffff;border:1px solid #e6e8ff;border-radius:16px;
 padding:14px 22px;max-width:520px;text-align:center;
 box-shadow:0 6px 18px rgba(99,102,241,0.05);
}
.parent-text{
 font-family:'Plus Jakarta Sans',sans-serif;font-size:16px;font-weight:700;
 color:#4f46e5;letter-spacing:-0.01em;
}
.parent-sub{margin-top:4px;font-size:13px;color:#1f2330;line-height:1.45;font-weight:500}
.parent-tooltip{margin-top:6px;font-size:12px;color:#6b7280;line-height:1.5}

/* row */
.level-row{
 display:flex;align-items:center;justify-content:center;
 gap:24px;width:100%;min-height:240px;padding:8px 0 16px;flex-wrap:wrap;
}
.rejected-stack{
 display:flex;flex-direction:row;gap:8px;flex-wrap:wrap;
 max-width:340px;justify-content:flex-end;
}
.rejected-chip{
 background:#f7f8ff;border:1px dashed #d7daff;border-radius:12px;
 padding:8px 14px;font-family:inherit;font-size:12px;font-weight:500;
 color:#8b8fb8;cursor:pointer;opacity:.85;
 transition:opacity .2s,border-color .2s;
 display:inline-flex;align-items:center;gap:6px;
}
.rejected-chip:hover{opacity:1;border-color:#c7caff;color:#5b58f0}
.rejected-x{font-size:10px;color:#c0c4ee}
.rejected-label{text-decoration:line-through;text-decoration-color:#c0c4ee}

/* active */
.active-area{display:flex;align-items:center;justify-content:center;min-width:380px;min-height:260px}
.active-wrap{display:flex;flex-direction:column;align-items:center;gap:12px;width:100%;max-width:440px}

.active-card{
 background:#ffffff;border:1px solid #dcdfff;border-radius:22px;
 padding:26px 26px;width:100%;
 box-shadow:0 16px 40px rgba(99,102,241,0.14),0 4px 12px rgba(99,102,241,0.06);
 transition:opacity .2s,filter .2s;
}
.active-card.busy{opacity:.55;filter:grayscale(.2);pointer-events:none}

.active-question-title{
 font-family:'Plus Jakarta Sans',sans-serif;font-size:22px;font-weight:800;
 color:#1f2330;margin-bottom:12px;letter-spacing:-0.015em;line-height:1.3;
}
.active-desc{font-size:14px;color:#4b5165;line-height:1.65}

.active-actions{display:flex;gap:8px;margin-top:22px;flex-wrap:wrap}
.btn-yes{
 background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;border:none;border-radius:11px;
 font-family:inherit;font-size:13px;font-weight:600;padding:11px 18px;cursor:pointer;
 transition:transform .15s,box-shadow .2s;flex:1;min-width:64px;
 box-shadow:0 4px 12px rgba(99,102,241,0.22);
}
.btn-yes:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 8px 18px rgba(99,102,241,0.30)}
.btn-yes:disabled,.btn-no:disabled,.btn-more:disabled,.btn-insight:disabled{opacity:.5;cursor:default}
.btn-no{
 background:#ffffff;color:#6b7280;border:1px solid #e6e8ff;border-radius:11px;
 font-family:inherit;font-size:13px;font-weight:600;padding:11px 18px;cursor:pointer;
 transition:all .15s;flex:1;min-width:64px;
}
.btn-no:hover:not(:disabled){color:#1f2330;border-color:#c7caff;background:#fbfbff}
.btn-more{
 background:#eef0ff;color:#4f46e5;border:none;border-radius:11px;
 font-family:inherit;font-size:13px;font-weight:600;padding:11px 14px;cursor:pointer;
 transition:background .15s;
}
.btn-more:hover:not(:disabled){background:#e1e4ff}
.btn-insight{
 background:#ffffff;border:1px solid #e6e8ff;border-radius:11px;
 padding:11px 14px;cursor:pointer;font-size:15px;transition:all .15s;
}
.btn-insight:hover:not(:disabled){border-color:#c7caff;background:#fbfbff}

/* chosen badge */
.chosen-badge{
 background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;
 border-radius:999px;padding:10px 18px;
 display:inline-flex;align-items:center;gap:8px;
 font-family:'Plus Jakarta Sans',sans-serif;font-size:14px;font-weight:700;
 box-shadow:0 8px 22px rgba(99,102,241,0.28);
}
.chosen-badge .check{font-size:12px;opacity:.9}

/* loading */
.dots{display:inline-flex;gap:5px;align-items:center}
.dots span{
 width:6px;height:6px;background:#6366f1;border-radius:50%;
 animation:pulse 1.2s infinite;
}
.dots span:nth-child(2){animation-delay:.2s}
.dots span:nth-child(3){animation-delay:.4s}
@keyframes pulse{0%,80%,100%{opacity:.25;transform:scale(.75)}40%{opacity:1;transform:scale(1)}}

.loading-block{
 display:inline-flex;align-items:center;gap:10px;
 background:#ffffff;border:1px solid #e6e8ff;border-radius:14px;
 padding:14px 20px;color:#6b7280;font-size:13px;
 box-shadow:0 4px 14px rgba(99,102,241,0.05);
}

.footer-actions{margin-top:40px;display:flex;justify-content:center}

/* analysis panel */
.analysis-panel{
 background:#ffffff;border:1px solid #e6e8ff;border-radius:18px;
 padding:18px 18px 14px;display:flex;flex-direction:column;gap:14px;
 box-shadow:0 8px 28px rgba(99,102,241,0.06);
 width:100%;
}
.panel-head{display:flex;align-items:center;justify-content:space-between}
.panel-tag{
 font-size:10px;color:#8b8fb8;letter-spacing:0.15em;text-transform:uppercase;font-weight:600;
}
.panel-step{
 font-size:11px;color:#4f46e5;background:#eef0ff;
 padding:3px 10px;border-radius:999px;font-weight:600;letter-spacing:.04em;
}
.panel-body{min-height:80px}
.panel-text{font-size:13px;color:#2a2f44;line-height:1.65;white-space:pre-wrap}
.panel-empty{font-size:12px;color:#8b8fb8;line-height:1.55;font-style:italic}
.panel-loading{
 display:flex;align-items:center;gap:8px;
 color:#8b8fb8;font-size:12px;
}
.panel-loading.mini{margin-top:10px}
.panel-footer{display:flex;flex-direction:column;gap:6px;padding-top:10px;border-top:1px solid #f0f1ff}
.panel-progress{height:4px;background:#f0f1ff;border-radius:99px;overflow:hidden}
.panel-progress-bar{
 height:100%;background:linear-gradient(90deg,#6366f1,#8b5cf6);
 border-radius:99px;transition:width .35s ease;
}
.panel-progress-label{font-size:10px;color:#8b8fb8;letter-spacing:.06em}

/* modal */
.modal-overlay{
 position:fixed;inset:0;background:rgba(20,22,40,0.45);
 backdrop-filter:blur(6px);z-index:1000;
 display:flex;align-items:center;justify-content:center;padding:24px;
}
.modal{
 background:#ffffff;border-radius:22px;width:100%;max-width:560px;
 padding:30px;position:relative;
 box-shadow:0 28px 64px rgba(20,22,40,0.22);
 max-height:88vh;overflow-y:auto;
}
.modal.wide{max-width:640px}
.modal-close{
 position:absolute;top:14px;right:14px;width:32px;height:32px;
 border:none;border-radius:50%;background:#f5f6ff;color:#6b7280;
 cursor:pointer;display:flex;align-items:center;justify-content:center;
 font-size:13px;transition:background .15s,color .15s;
}
.modal-close:hover{background:#e6e8ff;color:#1f2330}

.modal-tag{
 display:inline-block;font-size:10px;color:#5b58f0;
 background:#eef0ff;padding:5px 12px;border-radius:999px;
 letter-spacing:0.14em;text-transform:uppercase;font-weight:600;margin-bottom:12px;
}
.modal-title{
 font-family:'Plus Jakarta Sans',sans-serif;font-size:24px;font-weight:800;
 color:#1f2330;margin-bottom:6px;letter-spacing:-0.02em;line-height:1.25;
}
.modal-sub{font-size:13px;color:#6b7280;margin-bottom:18px;line-height:1.5}
.modal-body{font-size:14px;color:#2a2f44;line-height:1.75;white-space:pre-wrap}
.modal-loading{display:flex;flex-direction:column;align-items:center;gap:10px;padding:30px 0;color:#6b7280;font-size:13px}
.modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}

.modal-textarea{
 width:100%;background:#fbfbff;border:1px solid #e6e8ff;border-radius:12px;
 font-family:inherit;font-size:14px;color:#1f2330;
 padding:14px;min-height:120px;outline:none;resize:vertical;
 transition:border-color .2s;
}
.modal-textarea:focus{border-color:#a5a8ff}

.insight-block{
 background:#fbfbff;border:1px solid #e6e8ff;border-radius:12px;
 padding:14px 16px;margin-bottom:12px;
}
.insight-block.insight{border-color:#d7daff;background:#f5f6ff}
.lbl{
 display:block;font-size:10px;color:#8b8fb8;letter-spacing:0.14em;
 text-transform:uppercase;margin-bottom:8px;font-weight:600;
}
.insight-block p{font-size:13px;color:#2a2f44;line-height:1.65}

/* conclusion specifics */
.conclusion-body{
 font-size:14px;color:#2a2f44;line-height:1.75;
 background:#fbfbff;border:1px solid #e6e8ff;border-radius:14px;
 padding:18px 20px;margin-bottom:18px;white-space:pre-wrap;
}
.conclusion-question{
 font-family:'Plus Jakarta Sans',sans-serif;
 font-size:17px;font-weight:700;
 color:#2563eb;
 margin:10px 0 14px;
 line-height:1.4;
 letter-spacing:-0.01em;
}
`;
const DETAILS_PROMPT = `You explain a single diagnostic question in the context of a user's problem. Write a friendly explanation of ~200 words (180–220). Cover what this typically looks like, what to inspect first, and how to confirm or rule it out. 2–3 short paragraphs, no bullets. Match the user's language.`;

const INSIGHT_PROMPT = `You are a diagnostic assistant. The user is exploring their problem. Given their path so far, the question they're investigating, and their free-text answer, provide a brief diagnostic summary (3–5 sentences):
1. Acknowledge what's narrowed down.
2. Interpret their answer in context.
3. Suggest a likely root cause or concrete next step.
Match the user's language.`;

/* ───────────────────────── api ───────────────────────── */

const BASE = "/api/chat";
const MODEL_LABEL = "gemini-3.1-flash-lite";
const STEPS_PER_CONCLUSION = 5;

let idCounter = 0;
const uid = (s) => `${s}__${++idCounter}`;

async function callGemini(systemPrompt, userMessage, maxTokens = 1024) {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "Gemini API error");
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function fetchKeywords(problem, pathLabels, rejectedLabels = []) {
  let msg;
  if (pathLabels.length === 0) {
    msg = `Problem: "${problem}"\nGenerate 5 top-level diagnostic items.`;
  } else {
    msg = `Original problem: "${problem}"
Narrowed down through: ${pathLabels.join(" → ")}
Generate 5 sub-items that further narrow the cause within "${pathLabels[pathLabels.length - 1]}". Stay inside that sub-area.`;
  }
  if (rejectedLabels.length > 0) {
    msg += `\n\nThe user already ruled out: ${rejectedLabels.join(", ")}. Propose 5 entirely different angles.`;
  }
  const text = await callGemini(KEYWORDS_PROMPT, msg);
  const cleaned = text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned).map((k) => ({ ...k, id: uid(k.id) }));
}

const formatChoices = (choices) =>
  choices.map((c, i) => `${i + 1}. "${c.question}" → ${c.answer.toUpperCase()}`).join("\n");

async function fetchAnalysis(problem, choices) {
  if (choices.length === 0) return "";
  const msg = `Problem: "${problem}"
Choices so far:
${formatChoices(choices)}

Write a short current analysis (3–5 sentences).`;
  return callGemini(ANALYSIS_PROMPT, msg, 512);
}

async function fetchConclusion(problem, choices) {
  const msg = `Problem: "${problem}"
Choices so far:
${formatChoices(choices)}

Write the structured conclusion with a summary paragraph then a numbered step-by-step solution.`;
  return callGemini(CONCLUSION_PROMPT, msg, 1024);
}

async function fetchFollowup(problem, conclusion, reply) {
  const msg = `Problem: "${problem}"
Conclusion shown to user: """${conclusion}"""
User's reply to "Does this solve your problem?": "${reply}"

Respond.`;
  return callGemini(FOLLOWUP_PROMPT, msg, 512);
}

async function fetchDetails(problem, pathLabels, kw) {
  const msg = `Problem: "${problem}"
Path: ${pathLabels.length ? pathLabels.join(" → ") : "(top level)"}
Question being explored: "${kw.question}"
Short brief: "${kw.tooltip || ""}"

Write a ~200-word friendly explanation of how this could be the cause, what to inspect, and how to verify.`;
  return callGemini(DETAILS_PROMPT, msg);
}

async function fetchInsight(problem, pathLabels, kw, answer) {
  const msg = `Problem: "${problem}"
Path: ${pathLabels.length ? pathLabels.join(" → ") : "(top level)"}
Question under investigation: "${kw.question}" — ${kw.tooltip || ""}
User's answer: "${answer}"

Provide a brief diagnostic summary.`;
  return callGemini(INSIGHT_PROMPT, msg);
}

/* ───────────────────────── visual atoms ───────────────────────── */

function RootCard({ problem }) {
  return (
    <motion.div layout className="root-card">
      <span className="tag">your problem</span>
      <p className="root-text">{problem}</p>
    </motion.div>
  );
}

function ParentCard({ label, question, tooltip }) {
  return (
    <motion.div layout className="parent-card">
      <span className="tag">exploring</span>
      <h3 className="parent-text">{label}</h3>
      {question && <p className="parent-sub">{question}</p>}
      {tooltip && <p className="parent-tooltip">{tooltip}</p>}
    </motion.div>
  );
}

function ChosenBadge({ kw }) {
  return (
    <motion.div layoutId={`kw-${kw.id}`} className="chosen-badge">
      <span className="check">✓</span>
      <span className="chosen-label">{kw.label}</span>
    </motion.div>
  );
}

function RejectedChip({ kw, onReopen }) {
  return (
    <motion.button
      layoutId={`kw-${kw.id}`}
      onClick={() => onReopen(kw)}
      className="rejected-chip"
      whileHover={{ opacity: 1, y: -2 }}
      title="click to reconsider"
    >
      <span className="rejected-x">✕</span>
      <span className="rejected-label">{kw.label}</span>
    </motion.button>
  );
}

function ActiveCard({ kw, onYes, onNo, onDetails, onInsight, busy }) {
  return (
    <motion.div
      layoutId={`kw-${kw.id}`}
      className="active-wrap"
      transition={{ type: "spring", stiffness: 220, damping: 28 }}
    >
      <div className={`active-card ${busy ? "busy" : ""}`}>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
        >
          <h2 className="active-question-title">{kw.question}</h2>
          <p className="active-desc">{kw.tooltip}</p>
          <div className="active-actions">
            <button className="btn-yes" onClick={() => onYes(kw)} disabled={busy}>Yes</button>
            <button className="btn-no" onClick={() => onNo(kw)} disabled={busy}>No</button>
            <button className="btn-more" onClick={() => onDetails(kw)} disabled={busy}>More details</button>
            <button className="btn-insight" onClick={() => onInsight(kw)} disabled={busy} aria-label="Free-text insight" title="Free-text insight">💬</button>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

function Connector({ short }) {
  return <div className={short ? "connector short" : "connector"} />;
}

function LoadingBlock({ label = "thinking…" }) {
  return (
    <div className="loading-block">
      <span className="dots"><span /><span /><span /></span>
      <span>{label}</span>
    </div>
  );
}

/* ───────────────────────── level ───────────────────────── */

function LevelView({
  level,
  isCurrent,
  loading,
  onYes, onNo, onDetails, onInsight, onReopen,
}) {
  const { parentLabel, parentQuestion, parentTooltip, keywords, currentIndex, rejectedIds, chosenId, isRoot } = level;
  const rejected = keywords.filter((k) => rejectedIds.includes(k.id));
  const chosen = chosenId ? keywords.find((k) => k.id === chosenId) : null;
  const active = !chosen && currentIndex < keywords.length ? keywords[currentIndex] : null;
  const showActiveArea = active || chosen || (isCurrent && loading);

  return (
    <div className="level">
      <div className="level-parent">
        {isRoot
          ? <RootCard problem={parentLabel} />
          : <ParentCard label={parentLabel} question={parentQuestion} tooltip={parentTooltip} />}
      </div>

      {(showActiveArea || rejected.length > 0) && <Connector />}

      {(showActiveArea || rejected.length > 0) && (
        <div className="level-row">
          {rejected.length > 0 && (
            <div className="rejected-stack">
              <AnimatePresence>
                {rejected.map((kw) => (
                  <RejectedChip key={kw.id} kw={kw} onReopen={onReopen} />
                ))}
              </AnimatePresence>
            </div>
          )}

          <div className="active-area">
            <AnimatePresence mode="popLayout">
              {chosen ? (
                <ChosenBadge key={`chosen-${chosen.id}`} kw={chosen} />
              ) : isCurrent && loading ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                >
                  <LoadingBlock label="thinking…" />
                </motion.div>
              ) : active ? (
                <ActiveCard
                  key={active.id}
                  kw={active}
                  onYes={onYes}
                  onNo={onNo}
                  onDetails={onDetails}
                  onInsight={onInsight}
                />
              ) : null}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── analysis panel ───────────────────────── */

function AnalysisPanel({ analysis, loading, stepCount }) {
  const progress = stepCount === 0
    ? 0
    : (stepCount % STEPS_PER_CONCLUSION === 0
      ? 1
      : (stepCount % STEPS_PER_CONCLUSION) / STEPS_PER_CONCLUSION);
  const remaining = stepCount === 0
    ? STEPS_PER_CONCLUSION
    : (stepCount % STEPS_PER_CONCLUSION === 0 ? 0 : STEPS_PER_CONCLUSION - (stepCount % STEPS_PER_CONCLUSION));

  return (
    <div className="analysis-panel">
      <div className="panel-head">
        <span className="panel-tag">current analysis</span>
        <span className="panel-step">step {stepCount}</span>
      </div>
      <div className="panel-body">
        {!analysis && loading ? (
          <div className="panel-loading">
            <span className="dots"><span /><span /><span /></span>
            <span>reading the room…</span>
          </div>
        ) : analysis ? (
          <>
            <motion.p
              key={analysis}
              className="panel-text"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              {analysis}
            </motion.p>
            {loading && (
              <div className="panel-loading mini">
                <span className="dots"><span /><span /><span /></span>
                <span>updating…</span>
              </div>
            )}
          </>
        ) : (
          <p className="panel-empty">
            As you answer questions, a short running analysis will appear here.
          </p>
        )}
      </div>
      {stepCount > 0 && (
        <div className="panel-footer">
          <div className="panel-progress">
            <div className="panel-progress-bar" style={{ width: `${progress * 100}%` }} />
          </div>
          <span className="panel-progress-label">
            {remaining === 0
              ? "conclusion ready"
              : `${remaining} step${remaining === 1 ? "" : "s"} to next conclusion`}
          </span>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── modals ───────────────────────── */

function ModalShell({ children, onClose, wide }) {
  return (
    <motion.div
      className="modal-overlay"
      onClick={onClose}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <motion.div
        className={`modal ${wide ? "wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.97 }}
        transition={{ type: "spring", stiffness: 240, damping: 28 }}
      >
        <button className="modal-close" onClick={onClose}>✕</button>
        {children}
      </motion.div>
    </motion.div>
  );
}

function DetailsModal({ keyword, content, loading, onClose }) {
  return (
    <ModalShell onClose={onClose}>
      <span className="modal-tag">more details</span>
      <h2 className="modal-title">{keyword.question}</h2>
      <p className="modal-sub">{keyword.tooltip}</p>
      {loading
        ? <div className="modal-loading"><span className="dots"><span /><span /><span /></span><p>writing a deeper explanation…</p></div>
        : <div className="modal-body">{content}</div>}
    </ModalShell>
  );
}

function InsightModal({ keyword, problem, pathLabels, onClose }) {
  const [answer, setAnswer] = useState("");
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!answer.trim()) return;
    setLoading(true);
    try {
      const s = await fetchInsight(problem, pathLabels, keyword, answer);
      setSummary(s);
    } catch {
      setSummary("Unable to generate an insight right now. Please try again.");
    }
    setLoading(false);
  };

  return (
    <ModalShell onClose={onClose}>
      <span className="modal-tag">insight</span>
      <h2 className="modal-title">{keyword.question}</h2>
      <p className="modal-sub">{keyword.tooltip}</p>

      {!summary ? (
        <>
          <textarea
            className="modal-textarea"
            placeholder="Share what you've observed…"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            autoFocus
          />
          <div className="modal-actions">
            <button className="btn-primary small" onClick={submit} disabled={loading || !answer.trim()}>
              {loading ? "Thinking…" : "Get insight →"}
            </button>
          </div>
        </>
      ) : (
        <div className="modal-body">
          <div className="insight-block"><span className="lbl">your answer</span><p>{answer}</p></div>
          <div className="insight-block insight"><span className="lbl">💡 insight</span><p>{summary}</p></div>
          <div className="modal-actions"><button className="btn-secondary" onClick={onClose}>Done</button></div>
        </div>
      )}
    </ModalShell>
  );
}

function ConclusionModal({ problem, choices, content, loading, onClose }) {
  const [reply, setReply] = useState("");
  const [followup, setFollowup] = useState(null);
  const [followupLoading, setFollowupLoading] = useState(false);

  const submit = async () => {
    if (!reply.trim() || followupLoading) return;
    setFollowupLoading(true);
    try {
      const text = await fetchFollowup(problem, content || "", reply);
      setFollowup(text);
    } catch {
      setFollowup("Could not generate a follow-up right now.");
    }
    setFollowupLoading(false);
  };

  return (
    <ModalShell onClose={onClose} wide>
      <span className="modal-tag">conclusion · step {choices.length}</span>
      <h2 className="modal-title">Where we've landed</h2>
      <p className="modal-sub">A diagnostic summary based on your {choices.length} answers so far.</p>

      {loading ? (
        <div className="modal-loading">
          <span className="dots"><span /><span /><span /></span>
          <p>writing your conclusion…</p>
        </div>
      ) : (
        <>
          <div className="conclusion-body">{content}</div>

          <p className="conclusion-question">Does this solve your problem?</p>

          {!followup ? (
            <>
              <textarea
                className="modal-textarea"
                placeholder="Tell us how it went — solved, not quite, or something in between."
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
                autoFocus
              />
              <div className="modal-actions">
                <button className="btn-secondary" onClick={onClose}>Keep exploring</button>
                <button className="btn-primary small" onClick={submit} disabled={followupLoading || !reply.trim()}>
                  {followupLoading ? "Thinking…" : "Send →"}
                </button>
              </div>
            </>
          ) : (
            <div className="modal-body">
              <div className="insight-block"><span className="lbl">your reply</span><p>{reply}</p></div>
              <div className="insight-block insight"><span className="lbl">💡 follow-up</span><p>{followup}</p></div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={onClose}>Keep exploring</button>
              </div>
            </div>
          )}
        </>
      )}
    </ModalShell>
  );
}

/* ───────────────────────── root ───────────────────────── */

export default function AppV2() {
  const [problem, setProblem] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [levels, setLevels] = useState([]);
  const [loading, setLoading] = useState(false);

  const [choices, setChoices] = useState([]);
  const [analysis, setAnalysis] = useState("");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [lastConclusionAt, setLastConclusionAt] = useState(0);

  const [conclusionOpen, setConclusionOpen] = useState(false);
  const [conclusionContent, setConclusionContent] = useState(null);
  const [conclusionLoading, setConclusionLoading] = useState(false);

  const [detailsTarget, setDetailsTarget] = useState(null);
  const [detailsContent, setDetailsContent] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  const [insightTarget, setInsightTarget] = useState(null);

  const currentLevel = levels[levels.length - 1];
  const pathLabels = currentLevel?.pathLabels || [];
  const stepCount = choices.length;

  /* ── helpers ── */

  const maybeTriggerConclusion = async (newChoices) => {
    if (
      newChoices.length > 0 &&
      newChoices.length % STEPS_PER_CONCLUSION === 0 &&
      newChoices.length > lastConclusionAt
    ) {
      setLastConclusionAt(newChoices.length);
      setConclusionOpen(true);
      setConclusionContent(null);
      setConclusionLoading(true);
      try {
        const text = await fetchConclusion(problem, newChoices);
        setConclusionContent(text);
      } catch {
        setConclusionContent("Couldn't generate a conclusion right now.");
      }
      setConclusionLoading(false);
    }
  };

  const refreshAnalysis = async (choicesNow) => {
    if (choicesNow.length === 0) { setAnalysis(""); return; }
    setAnalysisLoading(true);
    try {
      const text = await fetchAnalysis(problem, choicesNow);
      setAnalysis(text);
    } catch (e) { console.error("analysis failed", e); }
    setAnalysisLoading(false);
  };

  /* ── handlers ── */

  const handleStart = async () => {
    if (!problem.trim() || submitted) return;
    setSubmitted(true);
    setLoading(true);
    try {
      const kws = await fetchKeywords(problem, []);
      setLevels([{
        parentLabel: problem,
        parentQuestion: null,
        parentTooltip: null,
        isRoot: true,
        keywords: kws,
        currentIndex: 0,
        rejectedIds: [],
        chosenId: null,
        pathLabels: [],
      }]);
    } catch (e) { console.error("start failed", e); }
    setLoading(false);
  };

  const handleNo = async (kw) => {
    setLevels((prev) => {
      const last = { ...prev[prev.length - 1] };
      last.rejectedIds = [...last.rejectedIds, kw.id];
      last.currentIndex = last.currentIndex + 1;
      return [...prev.slice(0, -1), last];
    });

    setLoading(true);
    const newChoices = [...choices, { question: kw.question, label: kw.label, answer: "no" }];
    setChoices(newChoices);
    await refreshAnalysis(newChoices);
    setLoading(false);

    await maybeTriggerConclusion(newChoices);
  };

  const handleYes = async (kw) => {
    setLevels((prev) => {
      const last = { ...prev[prev.length - 1] };
      last.chosenId = kw.id;
      return [...prev.slice(0, -1), last];
    });

    setLoading(true);
    const newChoices = [...choices, { question: kw.question, label: kw.label, answer: "yes" }];
    setChoices(newChoices);
    setAnalysisLoading(true);

    try {
      const newPath = [...(currentLevel?.pathLabels || []), kw.label];
      const [analysisText, kws] = await Promise.all([
        fetchAnalysis(problem, newChoices),
        fetchKeywords(problem, newPath),
      ]);
      setAnalysis(analysisText);
      setLevels((prev) => [...prev, {
        parentLabel: kw.label,
        parentQuestion: kw.question,
        parentTooltip: kw.tooltip,
        isRoot: false,
        keywords: kws,
        currentIndex: 0,
        rejectedIds: [],
        chosenId: null,
        pathLabels: newPath,
      }]);
    } catch (e) { console.error("yes failed", e); }

    setAnalysisLoading(false);
    setLoading(false);

    await maybeTriggerConclusion(newChoices);
  };

  const handleReopen = (kw) => {
    setLevels((prev) => {
      const last = { ...prev[prev.length - 1] };
      last.rejectedIds = last.rejectedIds.filter((id) => id !== kw.id);
      const idx = last.keywords.findIndex((k) => k.id === kw.id);
      const arr = [...last.keywords];
      const [item] = arr.splice(idx, 1);
      arr.splice(last.currentIndex, 0, item);
      last.keywords = arr;
      return [...prev.slice(0, -1), last];
    });
  };

  // auto-refetch when all current keywords are rejected
  useEffect(() => {
    if (loading || !currentLevel) return;
    if (currentLevel.chosenId) return;
    if (currentLevel.currentIndex < currentLevel.keywords.length) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const rejectedLabels = currentLevel.keywords.map((k) => k.label);
        const more = await fetchKeywords(problem, currentLevel.pathLabels, rejectedLabels);
        if (cancelled) return;
        setLevels((prev) => {
          const last = { ...prev[prev.length - 1] };
          last.keywords = [...last.keywords, ...more];
          return [...prev.slice(0, -1), last];
        });
      } catch (e) { console.error("refetch failed", e); }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levels]);

  const handleUndo = async () => {
    if (levels.length === 0) return;
    const last = levels[levels.length - 1];
    const canUndo = last.rejectedIds.length > 0 || levels.length > 1;
    if (!canUndo) return;

    setLevels((prev) => {
      const lastPrev = { ...prev[prev.length - 1] };
      if (lastPrev.rejectedIds.length > 0) {
        const lastRejected = lastPrev.rejectedIds[lastPrev.rejectedIds.length - 1];
        lastPrev.rejectedIds = lastPrev.rejectedIds.slice(0, -1);
        lastPrev.currentIndex = Math.max(0, lastPrev.currentIndex - 1);
        const idx = lastPrev.keywords.findIndex((k) => k.id === lastRejected);
        if (idx > -1) {
          const arr = [...lastPrev.keywords];
          const [item] = arr.splice(idx, 1);
          arr.splice(lastPrev.currentIndex, 0, item);
          lastPrev.keywords = arr;
        }
        return [...prev.slice(0, -1), lastPrev];
      }
      if (prev.length > 1) {
        const parentLevels = prev.slice(0, -1);
        const newLast = { ...parentLevels[parentLevels.length - 1] };
        newLast.chosenId = null;
        return [...parentLevels.slice(0, -1), newLast];
      }
      return prev;
    });

    const newChoices = choices.length > 0 ? choices.slice(0, -1) : choices;
    setChoices(newChoices);
    await refreshAnalysis(newChoices);
  };

  const handleReset = () => {
    setProblem("");
    setSubmitted(false);
    setLevels([]);
    setLoading(false);
    setChoices([]);
    setAnalysis("");
    setAnalysisLoading(false);
    setLastConclusionAt(0);
    setConclusionOpen(false);
    setConclusionContent(null);
    setConclusionLoading(false);
    setDetailsTarget(null);
    setDetailsContent(null);
    setInsightTarget(null);
    idCounter = 0;
  };

  const openDetails = async (kw) => {
    setDetailsTarget(kw);
    setDetailsContent(null);
    setDetailsLoading(true);
    try {
      const text = await fetchDetails(problem, pathLabels, kw);
      setDetailsContent(text);
    } catch {
      setDetailsContent("Unable to load details right now.");
    }
    setDetailsLoading(false);
  };

  const closeDetails = () => { setDetailsTarget(null); setDetailsContent(null); };

  const canUndo = useMemo(() => {
    if (levels.length === 0) return false;
    const last = levels[levels.length - 1];
    return last.rejectedIds.length > 0 || levels.length > 1;
  }, [levels]);

  /* ── render ── */

  return (
    <>
      <style>{styles}</style>
      <div className="app">
        <header className="header">
          <h1 onClick={handleReset}>Promes AI Map</h1>
          <p>describe a problem — explore it as a friendly map</p>
          {submitted && <div className="model-badge">{MODEL_LABEL}</div>}
        </header>

        <div className="input-area">
          <div className="input-row">
            <input
              className="input-field"
              placeholder="What problem are you trying to solve?"
              value={problem}
              onChange={(e) => setProblem(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !submitted && handleStart()}
              disabled={submitted}
            />
            {!submitted && (
              <button className="btn-primary" onClick={handleStart} disabled={!problem.trim()}>
                Map it
              </button>
            )}
          </div>
          {submitted && (
            <div className="control-row">
              <button className="btn-ghost" onClick={handleUndo} disabled={!canUndo || loading}>↶ Undo</button>
              <button className="btn-ghost" onClick={handleReset}>← New problem</button>
            </div>
          )}
        </div>

        {submitted && (
          <div className="workspace">
            <div className="map-col">
              <LayoutGroup>
                <div className="map">
                  {loading && levels.length === 0 && (
                    <LoadingBlock label="mapping your problem…" />
                  )}

                  {levels.map((lv, i) => (
                    <div className="level-wrap" key={i}>
                      {i > 0 && <Connector short />}
                      <LevelView
                        level={lv}
                        isCurrent={i === levels.length - 1}
                        loading={loading && i === levels.length - 1}
                        onYes={handleYes}
                        onNo={handleNo}
                        onDetails={openDetails}
                        onInsight={(kw) => setInsightTarget(kw)}
                        onReopen={handleReopen}
                      />
                    </div>
                  ))}

                  {loading && levels.length > 0 && levels[levels.length - 1].chosenId && (
                    <>
                      <Connector short />
                      <LoadingBlock label="exploring deeper…" />
                    </>
                  )}

                  {levels.length > 0 && (
                    <div className="footer-actions">
                      <button className="btn-ghost" onClick={handleReset}>↺ Start over</button>
                    </div>
                  )}
                </div>
              </LayoutGroup>
            </div>

            <aside className="panel-col">
              <AnalysisPanel
                analysis={analysis}
                loading={analysisLoading}
                stepCount={stepCount}
              />
            </aside>
          </div>
        )}

        <AnimatePresence>
          {detailsTarget && (
            <DetailsModal
              keyword={detailsTarget}
              content={detailsContent}
              loading={detailsLoading}
              onClose={closeDetails}
            />
          )}
          {insightTarget && (
            <InsightModal
              keyword={insightTarget}
              problem={problem}
              pathLabels={pathLabels}
              onClose={() => setInsightTarget(null)}
            />
          )}
          {conclusionOpen && (
            <ConclusionModal
              problem={problem}
              choices={choices}
              content={conclusionContent}
              loading={conclusionLoading}
              onClose={() => setConclusionOpen(false)}
            />
          )}
        </AnimatePresence>
      </div>
      <Analytics />
    </>
  );
}

/* ───────────────────────── styles ───────────────────────── */

const styles = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap');

*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

body{
  background:radial-gradient(1200px 600px at 50% -10%, #efefff 0%, #f8f9ff 50%, #fbfbff 100%);
  color:#1f2330;
  font-family:'Inter',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  min-height:100vh;
  -webkit-font-smoothing:antialiased;
}

.app{
  min-height:100vh;
  display:flex;flex-direction:column;align-items:center;
  padding:48px 24px 120px;
}

/* header */
.header{text-align:center;margin-bottom:36px}
.header h1{
  font-family:'Plus Jakarta Sans',sans-serif;
  font-size:32px;font-weight:800;letter-spacing:-0.025em;
  background:linear-gradient(90deg,#6366f1,#8b5cf6 60%,#a855f7);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
  cursor:pointer;margin-bottom:8px;
}
.header p{font-size:14px;color:#6b7280}
.model-badge{
  margin-top:12px;font-size:11px;color:#5b58f0;
  background:#eef0ff;padding:4px 12px;border-radius:999px;
  display:inline-block;letter-spacing:0.04em;font-weight:500;
}

/* input */
.input-area{width:100%;max-width:640px;margin-bottom:40px}
.input-row{display:flex;gap:10px}
.input-field{
  flex:1;background:#ffffff;border:1px solid #e6e8ff;border-radius:14px;
  color:#1f2330;font-family:inherit;font-size:15px;padding:14px 18px;outline:none;
  transition:border-color .2s,box-shadow .2s;
  box-shadow:0 2px 10px rgba(99,102,241,0.04);
}
.input-field:focus{border-color:#a5a8ff;box-shadow:0 6px 22px rgba(99,102,241,0.10)}
.input-field::placeholder{color:#9ca3af}
.input-field:disabled{background:#fafbff;color:#6b7280;cursor:default}

.btn-primary{
  background:linear-gradient(135deg,#6366f1,#8b5cf6);
  color:#fff;border:none;border-radius:14px;
  font-family:inherit;font-size:14px;font-weight:600;
  padding:14px 22px;cursor:pointer;white-space:nowrap;
  transition:transform .15s,box-shadow .2s,opacity .2s;
  box-shadow:0 6px 18px rgba(99,102,241,0.28);
}
.btn-primary:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 10px 24px rgba(99,102,241,0.35)}
.btn-primary:disabled{opacity:.45;cursor:default;box-shadow:none}
.btn-primary.small{padding:10px 18px;font-size:13px;border-radius:12px}

.btn-secondary{
  background:#eef0ff;color:#4f46e5;border:none;border-radius:12px;
  font-family:inherit;font-size:13px;font-weight:600;
  padding:10px 18px;cursor:pointer;transition:background .15s;
}
.btn-secondary:hover{background:#e1e4ff}

.btn-ghost{
  background:transparent;color:#6b7280;border:1px solid #e6e8ff;
  border-radius:999px;font-family:inherit;font-size:12px;font-weight:500;
  padding:7px 14px;cursor:pointer;transition:all .15s;
}
.btn-ghost:hover:not(:disabled){color:#5b58f0;border-color:#c7caff;background:#fbfbff}
.btn-ghost:disabled{opacity:.4;cursor:default}

.control-row{display:flex;gap:8px;margin-top:12px;justify-content:flex-end}

/* workspace: map + side panel */
.workspace{
  display:grid;
  grid-template-columns:minmax(0,1fr) 320px;
  gap:32px;
  max-width:1340px;width:100%;align-items:start;
}
.map-col{min-width:0;display:flex;justify-content:center}
.panel-col{position:sticky;top:24px}
@media (max-width:1024px){
  .workspace{grid-template-columns:1fr;gap:24px}
  .panel-col{position:static;order:-1}
}

/* map */
.map{display:flex;flex-direction:column;align-items:center;width:100%;max-width:1000px;gap:0}

.level-wrap{display:flex;flex-direction:column;align-items:center;width:100%}
.level{display:flex;flex-direction:column;align-items:center;width:100%}
.level-parent{display:flex;justify-content:center}
.connector{width:2px;height:36px;background:linear-gradient(180deg,#c7caff,#eef0ff);border-radius:2px}
.connector.short{height:24px}

/* root + parent */
.root-card{
  background:#ffffff;border:1px solid #e6e8ff;border-radius:18px;
  padding:18px 26px;max-width:560px;text-align:center;
  box-shadow:0 8px 24px rgba(99,102,241,0.06);
}
.tag{
  display:block;font-size:10px;color:#8b8fb8;
  letter-spacing:0.15em;text-transform:uppercase;margin-bottom:6px;font-weight:600;
}
.root-text{font-size:16px;color:#1f2330;line-height:1.5;font-weight:500}

.parent-card{
  background:#ffffff;border:1px solid #e6e8ff;border-radius:16px;
  padding:14px 22px;max-width:520px;text-align:center;
  box-shadow:0 6px 18px rgba(99,102,241,0.05);
}
.parent-text{
  font-family:'Plus Jakarta Sans',sans-serif;font-size:16px;font-weight:700;
  color:#4f46e5;letter-spacing:-0.01em;
}
.parent-sub{margin-top:4px;font-size:13px;color:#1f2330;line-height:1.45;font-weight:500}
.parent-tooltip{margin-top:6px;font-size:12px;color:#6b7280;line-height:1.5}

/* row */
.level-row{
  display:flex;align-items:center;justify-content:center;
  gap:24px;width:100%;min-height:240px;padding:8px 0 16px;flex-wrap:wrap;
}
.rejected-stack{
  display:flex;flex-direction:row;gap:8px;flex-wrap:wrap;
  max-width:340px;justify-content:flex-end;
}
.rejected-chip{
  background:#f7f8ff;border:1px dashed #d7daff;border-radius:12px;
  padding:8px 14px;font-family:inherit;font-size:12px;font-weight:500;
  color:#8b8fb8;cursor:pointer;opacity:.85;
  transition:opacity .2s,border-color .2s;
  display:inline-flex;align-items:center;gap:6px;
}
.rejected-chip:hover{opacity:1;border-color:#c7caff;color:#5b58f0}
.rejected-x{font-size:10px;color:#c0c4ee}
.rejected-label{text-decoration:line-through;text-decoration-color:#c0c4ee}

/* active */
.active-area{display:flex;align-items:center;justify-content:center;min-width:380px;min-height:260px}
.active-wrap{display:flex;flex-direction:column;align-items:center;gap:12px;width:100%;max-width:440px}

.active-card{
  background:#ffffff;border:1px solid #dcdfff;border-radius:22px;
  padding:26px 26px;width:100%;
  box-shadow:0 16px 40px rgba(99,102,241,0.14),0 4px 12px rgba(99,102,241,0.06);
  transition:opacity .2s,filter .2s;
}
.active-card.busy{opacity:.55;filter:grayscale(.2);pointer-events:none}

.active-question-title{
  font-family:'Plus Jakarta Sans',sans-serif;font-size:22px;font-weight:800;
  color:#1f2330;margin-bottom:12px;letter-spacing:-0.015em;line-height:1.3;
}
.active-desc{font-size:14px;color:#4b5165;line-height:1.65}

.active-actions{display:flex;gap:8px;margin-top:22px;flex-wrap:wrap}
.btn-yes{
  background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;border:none;border-radius:11px;
  font-family:inherit;font-size:13px;font-weight:600;padding:11px 18px;cursor:pointer;
  transition:transform .15s,box-shadow .2s;flex:1;min-width:64px;
  box-shadow:0 4px 12px rgba(99,102,241,0.22);
}
.btn-yes:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 8px 18px rgba(99,102,241,0.30)}
.btn-yes:disabled,.btn-no:disabled,.btn-more:disabled,.btn-insight:disabled{opacity:.5;cursor:default}
.btn-no{
  background:#ffffff;color:#6b7280;border:1px solid #e6e8ff;border-radius:11px;
  font-family:inherit;font-size:13px;font-weight:600;padding:11px 18px;cursor:pointer;
  transition:all .15s;flex:1;min-width:64px;
}
.btn-no:hover:not(:disabled){color:#1f2330;border-color:#c7caff;background:#fbfbff}
.btn-more{
  background:#eef0ff;color:#4f46e5;border:none;border-radius:11px;
  font-family:inherit;font-size:13px;font-weight:600;padding:11px 14px;cursor:pointer;
  transition:background .15s;
}
.btn-more:hover:not(:disabled){background:#e1e4ff}
.btn-insight{
  background:#ffffff;border:1px solid #e6e8ff;border-radius:11px;
  padding:11px 14px;cursor:pointer;font-size:15px;transition:all .15s;
}
.btn-insight:hover:not(:disabled){border-color:#c7caff;background:#fbfbff}

/* chosen badge */
.chosen-badge{
  background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;
  border-radius:999px;padding:10px 18px;
  display:inline-flex;align-items:center;gap:8px;
  font-family:'Plus Jakarta Sans',sans-serif;font-size:14px;font-weight:700;
  box-shadow:0 8px 22px rgba(99,102,241,0.28);
}
.chosen-badge .check{font-size:12px;opacity:.9}

/* loading */
.dots{display:inline-flex;gap:5px;align-items:center}
.dots span{
  width:6px;height:6px;background:#6366f1;border-radius:50%;
  animation:pulse 1.2s infinite;
}
.dots span:nth-child(2){animation-delay:.2s}
.dots span:nth-child(3){animation-delay:.4s}
@keyframes pulse{0%,80%,100%{opacity:.25;transform:scale(.75)}40%{opacity:1;transform:scale(1)}}

.loading-block{
  display:inline-flex;align-items:center;gap:10px;
  background:#ffffff;border:1px solid #e6e8ff;border-radius:14px;
  padding:14px 20px;color:#6b7280;font-size:13px;
  box-shadow:0 4px 14px rgba(99,102,241,0.05);
}

.footer-actions{margin-top:40px;display:flex;justify-content:center}

/* analysis panel */
.analysis-panel{
  background:#ffffff;border:1px solid #e6e8ff;border-radius:18px;
  padding:18px 18px 14px;display:flex;flex-direction:column;gap:14px;
  box-shadow:0 8px 28px rgba(99,102,241,0.06);
  width:100%;
}
.panel-head{display:flex;align-items:center;justify-content:space-between}
.panel-tag{
  font-size:10px;color:#8b8fb8;letter-spacing:0.15em;text-transform:uppercase;font-weight:600;
}
.panel-step{
  font-size:11px;color:#4f46e5;background:#eef0ff;
  padding:3px 10px;border-radius:999px;font-weight:600;letter-spacing:.04em;
}
.panel-body{min-height:80px}
.panel-text{font-size:13px;color:#2a2f44;line-height:1.65;white-space:pre-wrap}
.panel-empty{font-size:12px;color:#8b8fb8;line-height:1.55;font-style:italic}
.panel-loading{
  display:flex;align-items:center;gap:8px;
  color:#8b8fb8;font-size:12px;
}
.panel-loading.mini{margin-top:10px}
.panel-footer{display:flex;flex-direction:column;gap:6px;padding-top:10px;border-top:1px solid #f0f1ff}
.panel-progress{height:4px;background:#f0f1ff;border-radius:99px;overflow:hidden}
.panel-progress-bar{
  height:100%;background:linear-gradient(90deg,#6366f1,#8b5cf6);
  border-radius:99px;transition:width .35s ease;
}
.panel-progress-label{font-size:10px;color:#8b8fb8;letter-spacing:.06em}

/* modal */
.modal-overlay{
  position:fixed;inset:0;background:rgba(20,22,40,0.45);
  backdrop-filter:blur(6px);z-index:1000;
  display:flex;align-items:center;justify-content:center;padding:24px;
}
.modal{
  background:#ffffff;border-radius:22px;width:100%;max-width:560px;
  padding:30px;position:relative;
  box-shadow:0 28px 64px rgba(20,22,40,0.22);
  max-height:88vh;overflow-y:auto;
}
.modal.wide{max-width:640px}
.modal-close{
  position:absolute;top:14px;right:14px;width:32px;height:32px;
  border:none;border-radius:50%;background:#f5f6ff;color:#6b7280;
  cursor:pointer;display:flex;align-items:center;justify-content:center;
  font-size:13px;transition:background .15s,color .15s;
}
.modal-close:hover{background:#e6e8ff;color:#1f2330}

.modal-tag{
  display:inline-block;font-size:10px;color:#5b58f0;
  background:#eef0ff;padding:5px 12px;border-radius:999px;
  letter-spacing:0.14em;text-transform:uppercase;font-weight:600;margin-bottom:12px;
}
.modal-title{
  font-family:'Plus Jakarta Sans',sans-serif;font-size:24px;font-weight:800;
  color:#1f2330;margin-bottom:6px;letter-spacing:-0.02em;line-height:1.25;
}
.modal-sub{font-size:13px;color:#6b7280;margin-bottom:18px;line-height:1.5}
.modal-body{font-size:14px;color:#2a2f44;line-height:1.75;white-space:pre-wrap}
.modal-loading{display:flex;flex-direction:column;align-items:center;gap:10px;padding:30px 0;color:#6b7280;font-size:13px}
.modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}

.modal-textarea{
  width:100%;background:#fbfbff;border:1px solid #e6e8ff;border-radius:12px;
  font-family:inherit;font-size:14px;color:#1f2330;
  padding:14px;min-height:120px;outline:none;resize:vertical;
  transition:border-color .2s;
}
.modal-textarea:focus{border-color:#a5a8ff}

.insight-block{
  background:#fbfbff;border:1px solid #e6e8ff;border-radius:12px;
  padding:14px 16px;margin-bottom:12px;
}
.insight-block.insight{border-color:#d7daff;background:#f5f6ff}
.lbl{
  display:block;font-size:10px;color:#8b8fb8;letter-spacing:0.14em;
  text-transform:uppercase;margin-bottom:8px;font-weight:600;
}
.insight-block p{font-size:13px;color:#2a2f44;line-height:1.65}

/* conclusion specifics */
.conclusion-body{
  font-size:14px;color:#2a2f44;line-height:1.75;
  background:#fbfbff;border:1px solid #e6e8ff;border-radius:14px;
  padding:18px 20px;margin-bottom:18px;white-space:pre-wrap;
}
.conclusion-question{
  font-family:'Plus Jakarta Sans',sans-serif;
  font-size:17px;font-weight:700;
  color:#2563eb;
  margin:10px 0 14px;
  line-height:1.4;
  letter-spacing:-0.01em;
}
`;
