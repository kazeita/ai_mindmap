import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { Analytics } from "@vercel/analytics/react";
import "./styles.css";

/* ───────────────────────── api ───────────────────────── */

const BASE = "/api/chat";
const MODEL_LABEL = "gemini-3.1-flash-lite";
const STEPS_PER_CONCLUSION = 5;
const ASKED_HISTORY_CAP = 10;

let idCounter = 0;
const uid = (s) => `${s}__${++idCounter}`;

const shortLabel = (text) => {
  const words = text.trim().split(/\s+/).slice(0, 4).join(" ");
  return words.length > 28 ? words.slice(0, 26) + "…" : words;
};

async function callApi(kind, userMessage) {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, userMessage }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || data.error || "API error");
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function fetchKeywords(problem, pathLabels, askedQuestions = []) {
  let msg;
  if (pathLabels.length === 0) {
    msg = `Problem: "${problem}"\nGenerate 5 top-level diagnostic items.`;
  } else {
    msg = `Original problem: "${problem}"
Narrowed down through: ${pathLabels.join(" → ")}
Generate 5 sub-items that further narrow the cause within "${pathLabels[pathLabels.length - 1]}". Stay inside that sub-area.`;
  }
  if (askedQuestions.length > 0) {
    const recent = askedQuestions.slice(-ASKED_HISTORY_CAP);
    msg += `\n\nAlready asked (do NOT repeat or paraphrase any of these — bring genuinely fresh angles):
${recent.map((q) => `- "${q}"`).join("\n")}`;
  }
  const text = await callApi("keywords", msg);
  const cleaned = text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned).map((k) => ({ ...k, id: uid(k.id) }));
}

const formatChoices = (choices) =>
  choices
    .map((c, i) => {
      if (c.answer === "added") {
        return `${i + 1}. (User added a custom direction): "${c.question}"`;
      }
      return `${i + 1}. "${c.question}" → ${c.answer.toUpperCase()}`;
    })
    .join("\n");

async function fetchAnalysis(problem, choices) {
  if (choices.length === 0) return "";
  const msg = `Problem: "${problem}"
Choices so far:
${formatChoices(choices)}

Write a short current analysis (3–5 sentences).`;
  return callApi("analysis", msg);
}

async function fetchConclusion(problem, choices) {
  const msg = `Problem: "${problem}"
Choices so far:
${formatChoices(choices)}

Write the structured conclusion with a summary paragraph then a numbered step-by-step solution.`;
  return callApi("conclusion", msg);
}

async function fetchFollowup(problem, conclusion, reply) {
  const msg = `Problem: "${problem}"
Conclusion shown to user: """${conclusion}"""
User's reply to "Does this solve your problem?": "${reply}"

Respond.`;
  return callApi("followup", msg);
}

async function fetchDetails(problem, pathLabels, kw) {
  const msg = `Problem: "${problem}"
Path: ${pathLabels.length ? pathLabels.join(" → ") : "(top level)"}
Question being explored: "${kw.question}"
Short brief: "${kw.tooltip || ""}"

Write a ~200-word friendly explanation of how this could be the cause, what to inspect, and how to verify.`;
  return callApi("details", msg);
}

async function fetchInsight(problem, pathLabels, kw, answer) {
  const msg = `Problem: "${problem}"
Path: ${pathLabels.length ? pathLabels.join(" → ") : "(top level)"}
Question under investigation: "${kw.question}" — ${kw.tooltip || ""}
User's answer: "${answer}"

Provide a brief diagnostic summary.`;
  return callApi("insight", msg);
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

function ParentCard({ label, question, tooltip, source }) {
  const isUser = source === "user";
  return (
    <motion.div layout className={`parent-card ${isUser ? "from-user" : ""}`}>
      <span className="tag">{isUser ? "you added" : "exploring"}</span>
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
  const [text, setText] = useState("");
  const [insight, setInsight] = useState(null);
  const [insightLoading, setInsightLoading] = useState(false);

  const submitInsight = async () => {
    if (!text.trim() || insightLoading || busy) return;
    setInsightLoading(true);
    setInsight(null);
    try {
      const s = await onInsight(kw, text.trim());
      setInsight(s);
    } catch {
      setInsight("Hmm, couldn't pull an insight just now. Try again?");
    }
    setInsightLoading(false);
  };

  return (
    <motion.div
      layoutId={`kw-${kw.id}`}
      className="active-wrap"
      transition={{ type: "spring", stiffness: 220, damping: 28 }}
    >
      <div className={`active-card ${busy ? "busy" : ""}`}>
        <button
          className="btn-info"
          onClick={() => onDetails(kw)}
          disabled={busy}
          title="More details"
          aria-label="More details"
        >
          <span className="info-icon">i</span>
        </button>

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
          </div>

          <div className="active-input-row">
            <input
              className="active-input"
              placeholder="or tell me what's going on…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitInsight(); } }}
              disabled={busy}
            />
            <button
              className="btn-input-submit"
              onClick={submitInsight}
              disabled={busy || insightLoading || !text.trim()}
              title="Get a quick insight"
              aria-label="Get a quick insight"
            >
              {insightLoading ? <span className="dots tiny"><span /><span /><span /></span> : "→"}
            </button>
          </div>

          <AnimatePresence>
            {insight && (
              <motion.div
                className="active-insight"
                initial={{ opacity: 0, y: -4, height: 0 }}
                animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={{ opacity: 0, y: -4, height: 0 }}
                transition={{ duration: 0.25 }}
              >
                <span className="lbl">💡 insight</span>
                <p>{insight}</p>
              </motion.div>
            )}
          </AnimatePresence>
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
  const {
    parentLabel, parentQuestion, parentTooltip, parentSource,
    keywords, currentIndex, rejectedIds, chosenId, isRoot,
  } = level;
  const rejected = keywords.filter((k) => rejectedIds.includes(k.id));
  const chosen = chosenId ? keywords.find((k) => k.id === chosenId) : null;
  const active = !chosen && currentIndex < keywords.length ? keywords[currentIndex] : null;
  const showActiveArea = active || chosen || (isCurrent && loading);

  return (
    <div className="level">
      <div className="level-parent">
        {isRoot
          ? <RootCard problem={parentLabel} />
          : <ParentCard
              label={parentLabel}
              question={parentQuestion}
              tooltip={parentTooltip}
              source={parentSource}
            />}
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

function ConclusionModal({ problem, choices, content, loading, onClose, onExploreMore }) {
  const [reply, setReply] = useState("");
  const [followup, setFollowup] = useState(null);
  const [followupLoading, setFollowupLoading] = useState(false);

  const handleQuickReply = async () => {
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

  const handleExplore = () => onExploreMore(reply);

  const hasReply = reply.trim().length > 0;

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

          <textarea
            className="modal-textarea"
            placeholder="Tell us how it went — or describe what you'd like to explore next…"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleExplore();
              }
            }}
            autoFocus
          />

          {followup && (
            <div className="modal-body">
              <div className="insight-block insight">
                <span className="lbl">💡 quick reply</span>
                <p>{followup}</p>
              </div>
            </div>
          )}

          <div className="modal-actions">
            <button className="btn-ghost" onClick={onClose}>Close</button>
            <button
              className="btn-secondary"
              onClick={handleQuickReply}
              disabled={followupLoading || !hasReply}
              title="Get a short AI reply without leaving this conclusion"
            >
              {followupLoading ? "Thinking…" : "Quick reply"}
            </button>
            <button
              className="btn-primary small"
              onClick={handleExplore}
              title={hasReply
                ? "Use your input as the next step in the map"
                : "Close and keep exploring the map"}
            >
              {hasReply ? "Explore more →" : "Keep exploring"}
            </button>
          </div>

          {hasReply && (
            <p className="explore-hint">
              "Explore more" will add your input as the next step and branch the map from there.
            </p>
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

  const currentLevel = levels[levels.length - 1];
  const pathLabels = currentLevel?.pathLabels || [];
  const stepCount = choices.length;
  const askedQuestions = useMemo(() => choices.map((c) => c.question), [choices]);

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
      const kws = await fetchKeywords(problem, [], []);
      setLevels([{
        parentLabel: problem,
        parentQuestion: null,
        parentTooltip: null,
        parentSource: "ai",
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
      const newAsked = newChoices.map((c) => c.question);
      const [analysisText, kws] = await Promise.all([
        fetchAnalysis(problem, newChoices),
        fetchKeywords(problem, newPath, newAsked),
      ]);
      setAnalysis(analysisText);
      setLevels((prev) => [...prev, {
        parentLabel: kw.label,
        parentQuestion: kw.question,
        parentTooltip: kw.tooltip,
        parentSource: "ai",
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

  const handleExploreMore = async (text) => {
    setConclusionOpen(false);
    const trimmed = (text || "").trim();
    if (!trimmed) return;

    const label = shortLabel(trimmed);
    const newChoices = [
      ...choices,
      { question: trimmed, label, answer: "added" },
    ];
    setChoices(newChoices);

    setLoading(true);
    setAnalysisLoading(true);

    try {
      const newPath = [...(currentLevel?.pathLabels || []), label];
      const newAsked = newChoices.map((c) => c.question);
      const [analysisText, kws] = await Promise.all([
        fetchAnalysis(problem, newChoices),
        fetchKeywords(problem, newPath, newAsked),
      ]);
      setAnalysis(analysisText);
      setLevels((prev) => [...prev, {
        parentLabel: label,
        parentQuestion: trimmed,
        parentTooltip: "your own direction — exploring further from here",
        parentSource: "user",
        isRoot: false,
        keywords: kws,
        currentIndex: 0,
        rejectedIds: [],
        chosenId: null,
        pathLabels: newPath,
      }]);
    } catch (e) { console.error("explore more failed", e); }

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
        const more = await fetchKeywords(problem, currentLevel.pathLabels, askedQuestions);
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

  const handleInlineInsight = async (kw, text) => {
    return await fetchInsight(problem, pathLabels, kw, text);
  };

  const canUndo = useMemo(() => {
    if (levels.length === 0) return false;
    const last = levels[levels.length - 1];
    return last.rejectedIds.length > 0 || levels.length > 1;
  }, [levels]);

  /* ── render ── */

  return (
    <>
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
                        onInsight={handleInlineInsight}
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
          {conclusionOpen && (
            <ConclusionModal
              problem={problem}
              choices={choices}
              content={conclusionContent}
              loading={conclusionLoading}
              onClose={() => setConclusionOpen(false)}
              onExploreMore={handleExploreMore}
            />
          )}
        </AnimatePresence>
      </div>
      <Analytics />
    </>
  );
}
