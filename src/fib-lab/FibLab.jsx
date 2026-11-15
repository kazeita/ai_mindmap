import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { LEVELS, SUBJECTS } from "./levels.js";
import "./fib-lab.css";

// Fonts load on their own, so a blocked font request never blocks the game.
const FONTS =
  "https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=JetBrains+Mono:wght@500;700&display=swap";
if (!document.querySelector(`link[href="${FONTS}"]`)) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = FONTS;
  document.head.appendChild(link);
}

const TOTAL = LEVELS.length;
const LETTERS = ["A", "B", "C"];
const FILTERS = [["all", "All"], ...Object.entries(SUBJECTS).map(([k, s]) => [k, s.name])];

// Progress lives in this browser only: { res: { [level]: 1 right | 0 missed }, streak, best }
const KEY = "fiblab.v1";
const EMPTY = { res: {}, streak: 0, best: 0 };
function loadProgress() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    if (v && typeof v.res === "object") return { res: v.res, streak: v.streak || 0, best: v.best || 0 };
  } catch {}
  return EMPTY;
}
function saveProgress(p) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {}
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startLevel(n) {
  const L = LEVELS[n - 1];
  return { n, picked: null, opts: shuffle([{ text: L.truths[0] }, { text: L.truths[1] }, { text: L.lie, lie: true }]) };
}

export default function FibLab() {
  const [prog, setProg] = useState(loadProgress);
  const [filter, setFilter] = useState("all");
  const [game, setGame] = useState(null); // null = level board
  const [confirmReset, setConfirmReset] = useState(false);
  const root = useRef(null);
  const titleRef = useRef(null);
  const nextRef = useRef(null);

  const play = useCallback((n) => setGame(startLevel(n)), []);
  const showBoard = useCallback(() => setGame(null), []);
  const next = useCallback(() => setGame((g) => (g && g.n < TOTAL ? startLevel(g.n + 1) : null)), []);

  const pick = useCallback(
    (i) => {
      if (!game || game.picked !== null) return;
      const right = !!game.opts[i].lie;
      const streak = right ? prog.streak + 1 : 0;
      const np = { res: { ...prog.res, [game.n]: right ? 1 : 0 }, streak, best: Math.max(prog.best, streak) };
      saveProgress(np);
      setProg(np);
      setGame({ ...game, picked: i });
    },
    [game, prog],
  );

  // Each new level starts at the top with focus on its question; an answer moves focus to "Next".
  useLayoutEffect(() => {
    if (!game) return;
    if (game.picked === null) {
      window.scrollTo(0, 0);
      titleRef.current?.focus({ preventScroll: true });
    } else {
      nextRef.current?.focus({ preventScroll: true });
    }
  }, [game?.n, game?.picked]);

  // Keys: 1-3 or A-C to pick, Enter or → for the next level, Esc for the board.
  // The tab stays mounted while hidden, so ignore keys unless it's on screen.
  useEffect(() => {
    const onKey = (e) => {
      if (!game || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!root.current || root.current.closest("[hidden]")) return;
      const k = e.key.toLowerCase();
      if (game.picked === null) {
        const idx = { 1: 0, 2: 1, 3: 2, a: 0, b: 1, c: 2 }[k];
        if (idx !== undefined) {
          e.preventDefault();
          pick(idx);
        }
      } else if (k === "arrowright" || (k === "enter" && document.activeElement !== nextRef.current)) {
        e.preventDefault();
        next();
      }
      if (k === "escape") showBoard();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [game, pick, next, showBoard]);

  return (
    <div className="fib" ref={root}>
      <div className="fib-wrap">
        {game ? (
          <Level
            game={game}
            prog={prog}
            onPick={pick}
            onNext={next}
            onBack={showBoard}
            titleRef={titleRef}
            nextRef={nextRef}
          />
        ) : (
          <Board
            prog={prog}
            filter={filter}
            setFilter={setFilter}
            onPlay={play}
            confirmReset={confirmReset}
            setConfirmReset={setConfirmReset}
            onReset={() => {
              setProg(EMPTY);
              saveProgress(EMPTY);
              setConfirmReset(false);
            }}
          />
        )}
      </div>
    </div>
  );
}

function Board({ prog, filter, setFilter, onPlay, confirmReset, setConfirmReset, onReset }) {
  const played = LEVELS.filter((L) => L.n in prog.res);
  const right = played.filter((L) => prog.res[L.n] === 1).length;
  const allRight = LEVELS.every((L) => prog.res[L.n] === 1);
  const resume =
    LEVELS.find((L) => !(L.n in prog.res))?.n ?? LEVELS.find((L) => prog.res[L.n] === 0)?.n ?? 1;
  const list = LEVELS.filter((L) => filter === "all" || L.cat === filter);

  return (
    <>
      <header className="fib-masthead">
        <div className="fib-brand">
          <h1>
            Fib Lab<span>.</span>
          </h1>
          <p>Every level has three science statements. Two are true. One is a lie. Find it.</p>
        </div>
        <div className="fib-stats" aria-label="Your progress">
          <div className="fib-stat">
            <b>
              {played.length}/{TOTAL}
            </b>
            <span>Played</span>
          </div>
          <div className="fib-stat">
            <b>{played.length ? `${Math.round((right / played.length) * 100)}%` : "–"}</b>
            <span>Correct</span>
          </div>
          <div className="fib-stat">
            <b>{prog.best}</b>
            <span>Best streak</span>
          </div>
        </div>
      </header>

      <div className="fib-toolbar">
        <div className="fib-chips" role="group" aria-label="Filter by subject">
          {FILTERS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`fib-chip${k === "all" ? "" : ` cat-${k}`}`}
              aria-pressed={filter === k}
              onClick={() => setFilter(k)}
            >
              {k !== "all" && <span className="dot" />}
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="fib-primary" onClick={() => onPlay(allRight ? 1 : resume)}>
          {allRight ? "Replay from level 1" : played.length ? `Continue: level ${resume}` : "Play level 1"}
        </button>
      </div>

      <div className="fib-board">
        {list.map((L) => {
          const r = prog.res[L.n];
          const state = r === 1 ? " right" : r === 0 ? " wrong" : "";
          const status = r === 1 ? "found the lie" : r === 0 ? "missed" : "not played";
          return (
            <button
              key={L.n}
              type="button"
              className={`fib-tile cat-${L.cat}${state}`}
              aria-label={`Level ${L.n}, ${SUBJECTS[L.cat].name}, ${status}`}
              onClick={() => onPlay(L.n)}
            >
              <span className="num">{L.n}</span>
              <span className="mark" aria-hidden="true">
                {r === 1 ? "✓" : r === 0 ? "✗" : ""}
              </span>
              <span className="sym" aria-hidden="true">
                {SUBJECTS[L.cat].sym}
              </span>
              <span className="nm" aria-hidden="true">
                {SUBJECTS[L.cat].name}
              </span>
            </button>
          );
        })}
      </div>

      <div className="fib-legend">
        <span>
          <i className="l-new" />
          Not played
        </span>
        <span>
          <i className="l-right" />
          Found the lie
        </span>
        <span>
          <i className="l-wrong" />
          Missed, replay anytime
        </span>
      </div>

      <div className="fib-foot">
        <span>
          {TOTAL} levels across {Object.keys(SUBJECTS).length} subjects
        </span>
        <span aria-hidden="true">·</span>
        {confirmReset ? (
          <span>
            Erase all progress?{" "}
            <button type="button" className="fib-link danger" onClick={onReset}>
              Erase
            </button>{" "}
            <button type="button" className="fib-link" onClick={() => setConfirmReset(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button type="button" className="fib-link" onClick={() => setConfirmReset(true)}>
            Reset progress
          </button>
        )}
      </div>
    </>
  );
}

function Level({ game, prog, onPick, onNext, onBack, titleRef, nextRef }) {
  const L = LEVELS[game.n - 1];
  const S = SUBJECTS[L.cat];
  const answered = game.picked !== null;
  const right = answered && !!game.opts[game.picked].lie;
  const lieIdx = game.opts.findIndex((o) => o.lie);

  return (
    <>
      <div className="fib-playbar">
        <button type="button" className="fib-back" onClick={onBack}>
          ← All levels
        </button>
        <div className="fib-meta">
          <span>
            {L.n} / {TOTAL}
          </span>
          <span>Streak {prog.streak}</span>
        </div>
      </div>

      <div className="fib-level-head">
        <div className={`fib-level-tag cat-${L.cat}`}>
          <div className="badge">
            <span>{S.sym}</span>
            <small>{L.n}</small>
          </div>
          <div className="cname">{S.name}</div>
        </div>
        <h2 ref={titleRef} tabIndex={-1}>
          Level {L.n}: which one is the lie?
        </h2>
      </div>

      <div className="fib-opts">
        {game.opts.map((o, i) => (
          <button
            key={`${game.n}-${i}`}
            type="button"
            disabled={answered}
            className={`fib-opt${answered ? ` revealed ${o.lie ? "is-lie" : "is-true"}` : ""}${game.picked === i ? " picked" : ""}`}
            onClick={() => onPick(i)}
          >
            <span className="key">{LETTERS[i]}</span>
            <span className="txt">{o.text}</span>
            {answered && <span className="stamp">{o.lie ? "Lie" : "True"}</span>}
          </button>
        ))}
      </div>

      {answered && (
        <div className={`fib-verdict ${right ? "good" : "bad"}`} aria-live="polite">
          <h3>{right ? "Correct. You caught the lie." : `Not quite. ${LETTERS[lieIdx]} was the lie.`}</h3>
          <span className="label">The real science</span>
          <p>{L.why}</p>
        </div>
      )}

      <div className="fib-actions">
        {answered && (
          <button type="button" className="fib-primary" ref={nextRef} onClick={onNext}>
            {L.n < TOTAL ? `Next: level ${L.n + 1} →` : "Back to all levels"}
          </button>
        )}
        <span className="fib-hint">
          {answered ? (
            <>
              Press <kbd>Enter</kbd> for the next level
            </>
          ) : (
            <>
              Press <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> to choose
            </>
          )}
        </span>
      </div>
    </>
  );
}
