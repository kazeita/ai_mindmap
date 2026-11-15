import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { LEVELS, SUBJECTS } from "./levels.js";
import { AI_START, TOTAL, discardLevel, ensureLevel, getLevel, isAiLevel, prefetch, subjectFor } from "./aiLevels.js";
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

const LETTERS = ["A", "B", "C"];
const FILTERS = [["all", "All"], ...Object.entries(SUBJECTS).map(([k, s]) => [k, s.name])];
const PAGE = 100;
const PAGES = Math.ceil(TOTAL / PAGE);
const fmt = (n) => n.toLocaleString("en-US");
const pageOf = (n) => Math.floor((n - 1) / PAGE);

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

const readyState = (L) => ({
  n: L.n,
  status: "ready",
  level: L,
  picked: null,
  opts: shuffle([{ text: L.truths[0] }, { text: L.truths[1] }, { text: L.lie, lie: true }]),
});

function firstUnplayed(res) {
  for (let n = 1; n <= TOTAL; n++) if (!(n in res)) return n;
  return null;
}

export default function FibLab() {
  const [prog, setProg] = useState(loadProgress);
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(() => pageOf(firstUnplayed(loadProgress().res) ?? 1));
  const [game, setGame] = useState(null); // null = level board
  const [confirmReset, setConfirmReset] = useState(false);
  const root = useRef(null);
  const titleRef = useRef(null);
  const nextRef = useRef(null);

  const play = useCallback((n) => {
    const ready = getLevel(n);
    if (ready) {
      setGame(readyState(ready));
      prefetch(n + 1);
      return;
    }
    setGame({ n, status: "loading", picked: null });
    ensureLevel(n)
      .then((L) => {
        setGame((g) => (g && g.n === n && g.status === "loading" ? readyState(L) : g));
        prefetch(n + 1);
      })
      .catch((err) => {
        setGame((g) => (g && g.n === n && g.status === "loading" ? { ...g, status: "error", error: err.message } : g));
      });
  }, []);

  const showBoard = useCallback(() => {
    if (game) setPage(pageOf(game.n));
    setGame(null);
  }, [game]);

  const next = useCallback(() => {
    if (!game) return;
    if (game.n < TOTAL) play(game.n + 1);
    else showBoard();
  }, [game, play, showBoard]);

  const swap = useCallback(() => {
    if (!game || !isAiLevel(game.n)) return;
    discardLevel(game.n);
    play(game.n);
  }, [game, play]);

  const pick = useCallback(
    (i) => {
      if (!game || game.status !== "ready" || game.picked !== null) return;
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
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const k = e.key.toLowerCase();
      if (game.status === "ready" && game.picked === null) {
        const idx = { 1: 0, 2: 1, 3: 2, a: 0, b: 1, c: 2 }[k];
        if (idx !== undefined) {
          e.preventDefault();
          pick(idx);
        }
      } else if (game.picked !== null && (k === "arrowright" || (k === "enter" && document.activeElement !== nextRef.current))) {
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
            onRetry={() => play(game.n)}
            onSwap={swap}
            titleRef={titleRef}
            nextRef={nextRef}
          />
        ) : (
          <Board
            prog={prog}
            filter={filter}
            setFilter={setFilter}
            page={page}
            setPage={setPage}
            onPlay={play}
            confirmReset={confirmReset}
            setConfirmReset={setConfirmReset}
            onReset={() => {
              setProg(EMPTY);
              saveProgress(EMPTY);
              setConfirmReset(false);
              setPage(0);
            }}
          />
        )}
      </div>
    </div>
  );
}

function Board({ prog, filter, setFilter, page, setPage, onPlay, confirmReset, setConfirmReset, onReset }) {
  const [jump, setJump] = useState("");
  const playedKeys = Object.keys(prog.res).filter((k) => +k >= 1 && +k <= TOTAL);
  const right = playedKeys.filter((k) => prog.res[k] === 1).length;
  const unplayed = firstUnplayed(prog.res);
  const resume = unplayed ?? Number(playedKeys.find((k) => prog.res[k] === 0) ?? 1);

  const first = page * PAGE + 1;
  const last = Math.min(TOTAL, first + PAGE - 1);
  const ns = [];
  for (let n = first; n <= last; n++) if (filter === "all" || subjectFor(n) === filter) ns.push(n);

  const jumpTo = (e) => {
    e.preventDefault();
    const n = Math.round(Number(jump));
    if (n >= 1 && n <= TOTAL) {
      setJump("");
      onPlay(n);
    }
  };

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
            <b>{fmt(playedKeys.length)}</b>
            <span>Played of {fmt(TOTAL)}</span>
          </div>
          <div className="fib-stat">
            <b>{playedKeys.length ? `${Math.round((right / playedKeys.length) * 100)}%` : "–"}</b>
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
        <button type="button" className="fib-primary" onClick={() => onPlay(resume)}>
          {playedKeys.length ? `Continue: level ${fmt(resume)}` : "Play level 1"}
        </button>
      </div>

      <div className="fib-pager">
        <div className="fib-pager-nav">
          <button type="button" className="fib-step" onClick={() => setPage(page - 1)} disabled={page === 0} aria-label="Previous 100 levels">
            ‹
          </button>
          <label className="fib-visually-hidden" htmlFor="fib-page">
            Level range
          </label>
          <select id="fib-page" className="fib-select" value={page} onChange={(e) => setPage(Number(e.target.value))}>
            {Array.from({ length: PAGES }, (_, p) => (
              <option key={p} value={p}>
                Levels {fmt(p * PAGE + 1)}–{fmt(Math.min(TOTAL, (p + 1) * PAGE))}
                {p * PAGE + 1 >= AI_START ? " · AI" : (p + 1) * PAGE >= AI_START ? " · some AI" : ""}
              </option>
            ))}
          </select>
          <button type="button" className="fib-step" onClick={() => setPage(page + 1)} disabled={page === PAGES - 1} aria-label="Next 100 levels">
            ›
          </button>
        </div>
        <form className="fib-jump" onSubmit={jumpTo}>
          <label htmlFor="fib-jump">Go to level</label>
          <input
            id="fib-jump"
            type="number"
            inputMode="numeric"
            min="1"
            max={TOTAL}
            placeholder={`1–${fmt(TOTAL)}`}
            value={jump}
            onChange={(e) => setJump(e.target.value)}
          />
          <button type="submit" className="fib-step wide">
            Go
          </button>
        </form>
      </div>

      <div className="fib-board">
        {ns.map((n) => {
          const cat = subjectFor(n);
          const r = prog.res[n];
          const ai = isAiLevel(n);
          const state = r === 1 ? " right" : r === 0 ? " wrong" : "";
          const status = r === 1 ? "found the lie" : r === 0 ? "missed" : "not played";
          return (
            <button
              key={n}
              type="button"
              className={`fib-tile cat-${cat}${state}`}
              aria-label={`Level ${n}, ${SUBJECTS[cat].name}${ai ? ", written by AI" : ""}, ${status}`}
              onClick={() => onPlay(n)}
            >
              <span className="num">{fmt(n)}</span>
              <span className="mark" aria-hidden="true">
                {r === 1 ? "✓" : r === 0 ? "✗" : ai ? <span className="ai">AI</span> : ""}
              </span>
              <span className="sym" aria-hidden="true">
                {SUBJECTS[cat].sym}
              </span>
              <span className="nm" aria-hidden="true">
                {SUBJECTS[cat].name}
              </span>
            </button>
          );
        })}
        {ns.length === 0 && <p className="fib-empty">No {SUBJECTS[filter]?.name} levels in this range.</p>}
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
        <span>
          <b className="ai">AI</b> Written live by AI, not fact-checked
        </span>
      </div>

      <div className="fib-foot">
        <span>
          Levels 1–{LEVELS.length} are hand-written. Levels {fmt(AI_START)}–{fmt(TOTAL)} are written by AI when you reach them.
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

function Level({ game, prog, onPick, onNext, onBack, onRetry, onSwap, titleRef, nextRef }) {
  const { n } = game;
  const cat = subjectFor(n);
  const S = SUBJECTS[cat];
  const ai = isAiLevel(n);
  const answered = game.picked !== null;
  const right = answered && !!game.opts[game.picked].lie;
  const lieIdx = game.status === "ready" ? game.opts.findIndex((o) => o.lie) : -1;

  return (
    <>
      <div className="fib-playbar">
        <button type="button" className="fib-back" onClick={onBack}>
          ← All levels
        </button>
        <div className="fib-meta">
          <span>
            {fmt(n)} / {fmt(TOTAL)}
          </span>
          <span>Streak {prog.streak}</span>
        </div>
      </div>

      <div className="fib-level-head">
        <div className={`fib-level-tag cat-${cat}`}>
          <div className="badge">
            <span>{S.sym}</span>
            <small>{fmt(n)}</small>
          </div>
          <div className="cname">{S.name}</div>
        </div>
        <h2 ref={titleRef} tabIndex={-1}>
          Level {fmt(n)}: which one is the lie?
        </h2>
        {ai && game.status === "ready" && (
          <p className="fib-ai-note">
            <b className="ai">AI</b>
            <span>Written by AI just now. It hasn't been fact-checked, so it can be wrong.</span>
            {!answered && (
              <button type="button" className="fib-link" onClick={onSwap}>
                Get a different question
              </button>
            )}
          </p>
        )}
      </div>

      {game.status === "loading" && (
        <div className="fib-opts" aria-busy="true">
          <p className="fib-status" role="status">
            Writing level {fmt(n)}…
          </p>
          {LETTERS.map((l) => (
            <div key={l} className="fib-opt skeleton" aria-hidden="true">
              <span className="key">{l}</span>
              <span className="txt">
                <span className="bar" />
                <span className="bar short" />
              </span>
            </div>
          ))}
        </div>
      )}

      {game.status === "error" && (
        <div className="fib-verdict bad" role="alert">
          <h3>Level {fmt(n)} couldn't be written</h3>
          <p>{game.error}</p>
          <div className="fib-actions">
            <button type="button" className="fib-primary" onClick={onRetry}>
              Try again
            </button>
          </div>
        </div>
      )}

      {game.status === "ready" && (
        <div className="fib-opts">
          {game.opts.map((o, i) => (
            <button
              key={`${n}-${i}`}
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
      )}

      {answered && (
        <div className={`fib-verdict ${right ? "good" : "bad"}`} aria-live="polite">
          <h3>{right ? "Correct. You caught the lie." : `Not quite. ${LETTERS[lieIdx]} was the lie.`}</h3>
          <span className="label">The real science</span>
          <p>{game.level.why}</p>
        </div>
      )}

      {game.status === "ready" && (
        <div className="fib-actions">
          {answered && (
            <button type="button" className="fib-primary" ref={nextRef} onClick={onNext}>
              {n < TOTAL ? `Next: level ${fmt(n + 1)} →` : "Back to all levels"}
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
      )}
    </>
  );
}
