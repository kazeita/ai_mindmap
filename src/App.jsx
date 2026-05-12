import { useState, useCallback, useEffect, useRef } from "react";

const SYSTEM_PROMPT = `You are a problem diagnosis AI. When given a problem and context, generate exactly 5 diagnostic keywords as a JSON array.

Each keyword object must have:
- "id": unique string
- "label": short keyword (1-2 words max)
- "question": one direct diagnostic question (max 12 words)
- "tooltip": one insight with specific numbers if possible (max 20 words)
- "eliminated": false

Return ONLY valid JSON array, no markdown, no explanation, with the language of the user's prompt.

Example:
[
  {
    "id": "network",
    "label": "Network",
    "question": "Is latency high on mobile vs WiFi?",
    "tooltip": "Mobile latency can be 10x higher than WiFi, causing 2-3s delays.",
    "eliminated": false
  }
]`;

const ANSWER_SUMMARY_PROMPT = `You are a problem diagnosis AI. The user has been exploring a problem through a diagnostic tree. Given their investigation path, the question they answered, and their response, provide a brief diagnostic summary that:

1. Acknowledges what they've narrowed down so far
2. Interprets their answer in the context of the problem
3. Suggests a likely root cause or concrete next step

Keep it to 3-5 sentences. Be specific and actionable.`;

const MODEL_PRIORITY = [
  "gemini-3.1-flash-lite",
  "gemini-3.1-flash-lite-preview",
];

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

let currentModelIndex = 0;
let idCounter = 0;

function getCurrentModel() {
  return MODEL_PRIORITY[currentModelIndex] || MODEL_PRIORITY[MODEL_PRIORITY.length - 1];
}

function switchToNextModel() {
  if (currentModelIndex < MODEL_PRIORITY.length - 1) {
    currentModelIndex++;
    return true;
  }
  return false;
}

function makeUniqueId(baseId) {
  return `${baseId}__${++idCounter}`;
}

function getApiKey() {
  return (
    typeof import.meta !== "undefined" && import.meta.env?.VITE_GEMINI_API_KEY
  ) || window.GEMINI_API_KEY || "fake_key";
}

async function callGemini(systemPrompt, userMessage) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

  const maxAttempts = MODEL_PRIORITY.length + 2;
  let lastError;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const model = getCurrentModel();
    const url = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          contents: [
            { role: "user", parts: [{ text: userMessage }] },
          ],
          generationConfig: {
            maxOutputTokens: 1024,
            temperature: 0.7,
          },
        }),
      });

      if (response.status === 429) {
        console.warn(`429 from ${model}, switching…`);
        const switched = switchToNextModel();
        if (!switched)
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }

      if (!response.ok) {
        const errBody = await response.text().catch(() => "");
        throw new Error(`API ${response.status}: ${errBody.slice(0, 200)}`);
      }

      const data = await response.json();

      if (data.error) {
        if (
          data.error.status === "RESOURCE_EXHAUSTED" ||
          data.error.code === 429
        ) {
          console.warn(`Rate limited on ${model}, switching…`);
          const switched = switchToNextModel();
          if (!switched)
            await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        throw new Error(data.error.message || "Gemini API error");
      }

      const text =
        data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      return { text, model };
    } catch (err) {
      lastError = err;
      console.error(`Error with ${model}:`, err);
      switchToNextModel();
    }
  }
  throw lastError || new Error("All models exhausted");
}

async function fetchKeywords(problem, path) {
  const contextMsg =
    path.length > 0
      ? `Problem: "${problem}"\nDiagnosis path so far: ${path.map((p) => p.label).join(" → ")}\nGenerate 5 deeper diagnostic keywords to narrow down the issue further.`
      : `Problem: "${problem}"\nGenerate 5 top-level diagnostic keywords to start diagnosing this problem.`;

  const { text } = await callGemini(SYSTEM_PROMPT, contextMsg);
  const cleaned = text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned).map((k) => ({ ...k, id: makeUniqueId(k.id) }));
}

async function fetchAnswerSummary(problem, path, question, answer) {
  const msg = `Problem: "${problem}"
Diagnosis path: ${path.map((p) => p.label).join(" → ")}
Question asked: "${question}"
User's answer: "${answer}"

Provide a brief diagnostic summary based on this information.`;
  const { text } = await callGemini(ANSWER_SUMMARY_PROMPT, msg);
  return text;
}

function Tooltip({ text }) {
  return (
    <div className="tooltip-box">
      <span className="tooltip-icon">💡</span>
      {text}
    </div>
  );
}

function AnswerModal({ node, path, problem, onClose }) {
  const [answer, setAnswer] = useState("");
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!answer.trim()) return;
    setLoading(true);
    try {
      const result = await fetchAnswerSummary(
        problem,
        path,
        node.question,
        answer
      );
      setSummary(result);
    } catch {
      setSummary("Unable to generate summary. Please try again.");
    }
    setLoading(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>
          ✕
        </button>

        <div className="modal-header">
          <span className="modal-node-label">{node.label}</span>
          <p className="modal-question">{node.question}</p>
        </div>

        {!summary ? (
          <div className="modal-input-area">
            <textarea
              className="modal-textarea"
              placeholder="Type your answer..."
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              autoFocus
            />
            <button
              className="btn-submit-answer"
              onClick={handleSubmit}
              disabled={loading || !answer.trim()}
            >
              {loading ? (
                <span className="loading-dots inline-dots">
                  <span />
                  <span />
                  <span />
                </span>
              ) : (
                "Get Insight →"
              )}
            </button>
          </div>
        ) : (
          <div className="modal-summary">
            <div className="summary-path">
              {path.map((p, i) => (
                <span key={p.id}>
                  <span className="path-node">{p.label}</span>
                  {i < path.length - 1 && (
                    <span className="path-arrow"> → </span>
                  )}
                </span>
              ))}
              {path.length > 0 && <span className="path-arrow"> → </span>}
              <span className="path-node active">{node.label}</span>
            </div>
            <div className="summary-section">
              <span className="summary-label">Your answer</span>
              <p className="summary-text">{answer}</p>
            </div>
            <div className="summary-section insight">
              <span className="summary-label">💡 Insight</span>
              <p className="summary-text">{summary}</p>
            </div>
            <button className="btn-close-summary" onClick={onClose}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Node({
  node,
  depth,
  onChoose,
  onEliminate,
  onAnswer,
  isActive,
  loading,
}) {
  const [hovered, setHovered] = useState(false);
  const eliminated = node.eliminated;

  return (
    <div
      className={`node-wrapper ${eliminated ? "eliminated" : ""} ${isActive ? "active-leaf" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className={`node depth-${depth % 4}`}>
        <div className="node-label">{node.label}</div>
        <div className="node-question">{node.question}</div>
        {hovered && !eliminated && !loading && (
          <Tooltip text={node.tooltip} />
        )}
        {!eliminated && !loading && (
          <div className="node-actions">
            <button className="btn-choose" onClick={() => onChoose(node)}>
              Branch →
            </button>
            <button className="btn-answer" onClick={() => onAnswer(node)}>
              💬
            </button>
            <button className="btn-eliminate" onClick={() => onEliminate(node)}>
              ✕
            </button>
          </div>
        )}
        {eliminated && <div className="eliminated-label">ruled out</div>}
        {loading && (
          <div className="loading-indicator">
            <div className="loading-dots">
              <span />
              <span />
              <span />
            </div>
            <span className="loading-text">branching…</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Connector() {
  return <div className="connector" />;
}

function TreeLevel({
  nodes,
  depth,
  onChoose,
  onEliminate,
  onAnswer,
  loadingNodeId,
  focusedPath,
}) {
  const focusedNodeId = focusedPath[depth];
  const shouldFocus = focusedNodeId != null;

  const visibleNodes = shouldFocus
    ? nodes.filter((n) => n.id === focusedNodeId)
    : nodes;

  const hiddenCount = shouldFocus ? nodes.length - visibleNodes.length : 0;

  return (
    <div className={`tree-level ${shouldFocus ? "focused-level" : ""}`}>
      {shouldFocus && hiddenCount > 0 && (
        <div className="collapsed-indicator">
          +{hiddenCount} other branch{hiddenCount > 1 ? "es" : ""} collapsed
        </div>
      )}
      {visibleNodes.map((node) => (
        <div key={node.id} className="node-column">
          <Connector />
          <Node
            node={node}
            depth={depth}
            onChoose={onChoose}
            onEliminate={onEliminate}
            onAnswer={onAnswer}
            isActive={node.id === loadingNodeId}
            loading={node.id === loadingNodeId}
          />
          {node.children && node.children.length > 0 && (
            <TreeLevel
              nodes={node.children}
              depth={depth + 1}
              onChoose={onChoose}
              onEliminate={onEliminate}
              onAnswer={onAnswer}
              loadingNodeId={loadingNodeId}
              focusedPath={focusedPath}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function PathTrail({ path }) {
  if (path.length === 0) return null;
  return (
    <div className="path-trail">
      {path.map((p, i) => (
        <span key={p.id}>
          <span className="path-node">{p.label}</span>
          {i < path.length - 1 && <span className="path-arrow"> → </span>}
        </span>
      ))}
    </div>
  );
}

export default function App() {
  const [problem, setProblem] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [tree, setTree] = useState(null);
  const [path, setPath] = useState([]);
  const [loadingNodeId, setLoadingNodeId] = useState(null);
  const [answerNode, setAnswerNode] = useState(null);
  /* eslint-disable-next-line no-unused-vars */
  const [modelTick, setModelTick] = useState(0);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (submitted && bottomRef.current) {
      setTimeout(
        () =>
          bottomRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "end",
          }),
        300
      );
    }
  }, [tree, submitted]);

  const findAndUpdate = useCallback((nodes, targetId, updater) => {
    return nodes.map((node) => {
      if (node.id === targetId) return updater(node);
      if (node.children)
        return {
          ...node,
          children: findAndUpdate(node.children, targetId, updater),
        };
      return node;
    });
  }, []);

  const focusedPath = {};
  if (path.length >= 2) {
    path.forEach((p, i) => {
      focusedPath[i] = p.id;
    });
  }

  const handleStart = async () => {
    if (!problem.trim()) return;
    setSubmitted(true);
    setLoadingNodeId("root");
    try {
      const keywords = await fetchKeywords(problem, []);
      setTree({ id: "root", label: problem, children: keywords });
    } catch (err) {
      console.error("Start failed:", err);
    }
    setLoadingNodeId(null);
    setModelTick((v) => v + 1);
  };

  const handleChoose = async (node) => {
    const newPath = [...path, node];
    setPath(newPath);
    setLoadingNodeId(node.id);

    try {
      const children = await fetchKeywords(problem, newPath);
      setTree((prev) => ({
        ...prev,
        children: findAndUpdate(prev.children, node.id, (n) => ({
          ...n,
          children,
        })),
      }));
    } catch (err) {
      console.error("Branch failed:", err);
    }
    setLoadingNodeId(null);
    setModelTick((v) => v + 1);
  };

  const handleEliminate = (node) => {
    setTree((prev) => ({
      ...prev,
      children: findAndUpdate(prev.children, node.id, (n) => ({
        ...n,
        eliminated: true,
      })),
    }));
  };

  const handleAnswer = (node) => setAnswerNode(node);

  const handleReset = () => {
    setProblem("");
    setSubmitted(false);
    setTree(null);
    setPath([]);
    setLoadingNodeId(null);
    setAnswerNode(null);
    currentModelIndex = 0;
    idCounter = 0;
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:wght@400;500&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

        body{
          background:#0a0a0f;
          color:#e8e4dc;
          font-family:'DM Mono',monospace;
          min-height:100vh;
        }

        .app{
          min-height:100vh;
          display:flex;flex-direction:column;align-items:center;
          padding:48px 24px 120px;
        }

        /* ── header ── */
        .header{text-align:center;margin-bottom:56px}
        .header h1{
          font-family:'Syne',sans-serif;font-size:13px;font-weight:700;
          letter-spacing:.3em;text-transform:uppercase;color:#5a5a7a;margin-bottom:12px;
          cursor:pointer;transition:color .2s;
        }
        .header h1:hover{color:#5a4fff}
        .header p{font-size:11px;color:#3a3a5a;letter-spacing:.1em}
        .model-badge{
          margin-top:10px;font-size:10px;color:#3a3a5a;
          letter-spacing:.08em;
          border:1px solid #1a1a2a;padding:4px 10px;display:inline-block;
        }

        /* ── input ── */
        .input-area{width:100%;max-width:580px;margin-bottom:64px}
        .input-row{display:flex;gap:12px;align-items:stretch}
        .input-field{
          flex:1;background:#0f0f1a;border:1px solid #2a2a3a;color:#e8e4dc;
          font-family:'DM Mono',monospace;font-size:13px;padding:14px 18px;outline:none;
          transition:border-color .2s;
        }
        .input-field:focus{border-color:#5a4fff}
        .input-field::placeholder{color:#3a3a5a}

        .btn-start{
          background:#5a4fff;color:#fff;border:none;
          font-family:'Syne',sans-serif;font-size:12px;font-weight:700;
          letter-spacing:.15em;text-transform:uppercase;
          padding:14px 24px;cursor:pointer;transition:background .2s;white-space:nowrap;
        }
        .btn-start:hover{background:#7a6fff}

        .btn-reset{
          background:transparent;color:#3a3a5a;border:1px solid #2a2a3a;
          font-family:'DM Mono',monospace;font-size:11px;
          padding:8px 16px;cursor:pointer;margin-top:12px;transition:all .2s;display:block;margin-left:auto;
        }
        .btn-reset:hover{color:#e8e4dc;border-color:#5a5a7a}

        /* ── path trail ── */
        .path-trail{
          font-size:12px;color:#5a5a7a;letter-spacing:.08em;margin-bottom:40px;text-align:center;
        }
        .path-node{color:#5a4fff;font-weight:600}
        .path-arrow{color:#3a3a5a}

        /* ── tree ── */
        .tree-root{display:flex;flex-direction:column;align-items:center;width:100%}
        .root-node{
          background:#0f0f1a;border:1px solid #2a2a3a;
          padding:16px 28px;font-family:'Syne',sans-serif;font-size:14px;font-weight:700;
          color:#e8e4dc;letter-spacing:.05em;max-width:480px;text-align:center;
        }

        .tree-level{
          display:flex;flex-direction:row;justify-content:center;
          gap:16px;flex-wrap:wrap;width:100%;
        }
        .tree-level.focused-level{gap:8px}

        .node-column{display:flex;flex-direction:column;align-items:center;flex:0 0 auto}
        .connector{width:1px;height:32px;background:linear-gradient(to bottom,#2a2a4a,#3a3a5a);flex-shrink:0}

        .collapsed-indicator{
          font-size:10px;color:#3a3a5a;letter-spacing:.08em;
          padding:6px 14px;border:1px dashed #1e1e2e;margin:8px 0;
          align-self:center;
        }

        /* ── node ── */
        .node-wrapper{position:relative;transition:opacity .3s}
        .node-wrapper.eliminated{opacity:.35}

        .node{
          width:200px;background:#0f0f1a;border:1px solid #2a2a3a;
          padding:16px 18px;position:relative;transition:border-color .2s,transform .15s;
        }
        .node:hover{border-color:#5a4fff;transform:translateY(-2px)}
        .node-wrapper.eliminated .node:hover{border-color:#2a2a3a;transform:none}

        .node.depth-0{border-left:2px solid #5a4fff}
        .node.depth-1{border-left:2px solid #4fff9a}
        .node.depth-2{border-left:2px solid #ff9a4f}
        .node.depth-3{border-left:2px solid #ff4f9a}

        .node-label{
          font-family:'Syne',sans-serif;font-size:14px;font-weight:700;
          color:#e8e4dc;letter-spacing:.05em;margin-bottom:6px;
        }
        .node-question{
          font-size:13px;color:#9a9abc;line-height:1.55;letter-spacing:.02em;
        }

        /* ── actions ── */
        .node-actions{display:flex;gap:6px;margin-top:12px}
        .btn-choose{
          flex:1;background:#5a4fff18;border:1px solid #5a4fff44;color:#5a4fff;
          font-family:'DM Mono',monospace;font-size:11px;padding:6px 10px;
          cursor:pointer;transition:all .15s;letter-spacing:.05em;
        }
        .btn-choose:hover{background:#5a4fff33;border-color:#5a4fff}

        .btn-answer{
          background:#4fff9a12;border:1px solid #4fff9a44;color:#4fff9a;
          font-size:11px;padding:6px 10px;cursor:pointer;transition:all .15s;
        }
        .btn-answer:hover{background:#4fff9a28;border-color:#4fff9a}

        .btn-eliminate{
          background:transparent;border:1px solid #2a2a3a;color:#5a5a7a;
          font-size:11px;padding:6px 10px;cursor:pointer;transition:all .15s;
        }
        .btn-eliminate:hover{border-color:#ff4f4f44;color:#ff4f4f}

        .eliminated-label{
          margin-top:8px;font-size:9px;color:#3a3a5a;
          letter-spacing:.1em;text-transform:uppercase;text-decoration:line-through;
        }

        /* ── tooltip ── */
        .tooltip-box{
          position:absolute;bottom:calc(100% + 10px);left:50%;transform:translateX(-50%);
          background:#1a1a2e;border:1px solid #5a4fff44;color:#b8b4dc;
          font-size:11px;line-height:1.6;padding:12px 16px;width:240px;
          z-index:100;letter-spacing:.02em;box-shadow:0 8px 32px #00000088;pointer-events:none;
        }
        .tooltip-icon{display:block;margin-bottom:4px;font-size:13px}

        /* ── loading ── */
        .loading-indicator{display:flex;align-items:center;gap:10px;margin-top:12px}
        .loading-text{font-size:11px;color:#5a5a7a;letter-spacing:.08em}

        .loading-dots{display:flex;gap:5px;justify-content:center}
        .loading-dots span{
          width:5px;height:5px;background:#5a4fff;border-radius:50%;animation:pulse 1.2s infinite;
        }
        .loading-dots span:nth-child(2){animation-delay:.2s}
        .loading-dots span:nth-child(3){animation-delay:.4s}

        .inline-dots{display:inline-flex;gap:4px;vertical-align:middle}
        .inline-dots span{width:4px;height:4px;background:#fff;border-radius:50%;animation:pulse 1.2s infinite}
        .inline-dots span:nth-child(2){animation-delay:.2s}
        .inline-dots span:nth-child(3){animation-delay:.4s}

        @keyframes pulse{
          0%,80%,100%{opacity:.2;transform:scale(.8)}
          40%{opacity:1;transform:scale(1)}
        }

        .initial-loading{
          display:flex;flex-direction:column;align-items:center;gap:16px;
          color:#5a5a7a;font-size:12px;letter-spacing:.15em;text-transform:uppercase;margin-top:40px;
        }
        .initial-loading .loading-dots span{background:#5a4fff}

        /* ── start-over ── */
        .start-over-area{margin-top:56px}
        .btn-start-over{
          background:transparent;color:#5a5a7a;border:1px solid #2a2a3a;
          font-family:'DM Mono',monospace;font-size:12px;
          padding:12px 28px;cursor:pointer;transition:all .25s;letter-spacing:.08em;
        }
        .btn-start-over:hover{color:#e8e4dc;border-color:#5a4fff;background:#5a4fff12}

        /* ── modal ── */
        .modal-overlay{
          position:fixed;inset:0;background:#0a0a0fdd;z-index:1000;
          display:flex;align-items:center;justify-content:center;
          backdrop-filter:blur(6px);
        }
        .modal-content{
          background:#0f0f1a;border:1px solid #2a2a3a;
          width:90%;max-width:520px;padding:32px;position:relative;
        }
        .modal-close{
          position:absolute;top:14px;right:14px;background:none;border:none;
          color:#5a5a7a;font-size:14px;cursor:pointer;transition:color .15s;
        }
        .modal-close:hover{color:#e8e4dc}

        .modal-header{margin-bottom:24px}
        .modal-node-label{
          font-family:'Syne',sans-serif;font-size:14px;font-weight:700;
          color:#5a4fff;letter-spacing:.05em;
        }
        .modal-question{
          font-size:14px;color:#9a9abc;margin-top:8px;line-height:1.5;
        }

        .modal-input-area{display:flex;flex-direction:column;gap:12px}
        .modal-textarea{
          background:#0a0a14;border:1px solid #2a2a3a;color:#e8e4dc;
          font-family:'DM Mono',monospace;font-size:13px;
          padding:14px;min-height:100px;outline:none;resize:vertical;
          transition:border-color .2s;
        }
        .modal-textarea:focus{border-color:#5a4fff}
        .modal-textarea::placeholder{color:#3a3a5a}

        .btn-submit-answer{
          background:#5a4fff;color:#fff;border:none;
          font-family:'Syne',sans-serif;font-size:12px;font-weight:700;
          letter-spacing:.12em;text-transform:uppercase;
          padding:12px 24px;cursor:pointer;transition:background .2s;
          align-self:flex-end;min-width:140px;text-align:center;
        }
        .btn-submit-answer:hover{background:#7a6fff}
        .btn-submit-answer:disabled{opacity:.5;cursor:default}

        .modal-summary{display:flex;flex-direction:column;gap:20px}
        .summary-path{
          font-size:11px;color:#5a5a7a;letter-spacing:.06em;line-height:1.8;
        }
        .summary-path .path-node{color:#5a4fff}
        .summary-path .path-node.active{color:#4fff9a}

        .summary-section{
          padding:16px;background:#0a0a14;border:1px solid #1a1a2a;
        }
        .summary-section.insight{border-color:#5a4fff33;background:#5a4fff08}
        .summary-label{
          display:block;font-size:10px;color:#5a5a7a;letter-spacing:.12em;
          text-transform:uppercase;margin-bottom:8px;
        }
        .summary-text{font-size:13px;color:#c8c4dc;line-height:1.7}

        .btn-close-summary{
          background:transparent;color:#5a5a7a;border:1px solid #2a2a3a;
          font-family:'DM Mono',monospace;font-size:11px;
          padding:10px 20px;cursor:pointer;transition:all .2s;align-self:flex-end;
        }
        .btn-close-summary:hover{color:#e8e4dc;border-color:#5a5a7a}
      `}</style>

      <div className="app">
        <div className="header">
          <h1 onClick={handleReset}>Reasoning Map</h1>
          <p>describe a problem — explore it like a map</p>
          {submitted && (
            <div className="model-badge">{getCurrentModel()}</div>
          )}
        </div>

        <div className="input-area">
          <div className="input-row">
            <input
              className="input-field"
              placeholder="Describe your problem..."
              value={problem}
              onChange={(e) => setProblem(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && !submitted && handleStart()
              }
              disabled={submitted}
            />
            {!submitted && (
              <button className="btn-start" onClick={handleStart}>
                Map it
              </button>
            )}
          </div>
          {submitted && (
            <button className="btn-reset" onClick={handleReset}>
              ← new problem
            </button>
          )}
        </div>

        {submitted && (
          <>
            <PathTrail path={path} />

            {loadingNodeId === "root" ? (
              <div className="initial-loading">
                <div className="loading-dots">
                  <span />
                  <span />
                  <span />
                </div>
                mapping the problem…
              </div>
            ) : (
              tree && (
                <div className="tree-root">
                  <div className="root-node">{tree.label}</div>
                  {tree.children && (
                    <TreeLevel
                      nodes={tree.children}
                      depth={0}
                      onChoose={handleChoose}
                      onEliminate={handleEliminate}
                      onAnswer={handleAnswer}
                      loadingNodeId={loadingNodeId}
                      focusedPath={focusedPath}
                    />
                  )}
                  <div className="start-over-area">
                    <button className="btn-start-over" onClick={handleReset}>
                      ↺ Start Over
                    </button>
                  </div>
                </div>
              )
            )}
          </>
        )}

        {answerNode && (
          <AnswerModal
            node={answerNode}
            path={path}
            problem={problem}
            onClose={() => setAnswerNode(null)}
          />
        )}

        <div ref={bottomRef} />
      </div>
    </>
  );
}
