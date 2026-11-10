import { useCallback, useEffect, useRef, useState } from "react";
import { ARTIST_ID, FAVORITES, RELEASES } from "./releases.js";
import "@fontsource-variable/fraunces/soft.css";
import "./yoasobi.css";

const shelf = (id, title, items) => ({
  id,
  title,
  boxes: items.map((r, index) => {
    const uri = `spotify:${r.type}:${r.id}`;
    return { ...r, uri, shelf: id, index, key: `${id}:${uri}` };
  }),
});

const SHELVES = [
  shelf("fav", "My favourites", FAVORITES),
  shelf("latest", "Latest releases", [
    ...RELEASES,
    { id: ARTIST_ID, title: "Top tracks", native: "YOASOBI", date: null, type: "artist", hue: 265 },
  ]),
];
const ALL_BOXES = SHELVES.flatMap((s) => s.boxes);

// Repeat cycles like Spotify's own button: off → whole shelf → this box.
const REPEAT_MODES = ["off", "all", "one"];
const REPEAT_LABEL = { off: "Repeat off", all: "Repeat shelf", one: "Repeat this box" };
const PLAYER_HEIGHT = 352; // Spotify's large embed
const REPEAT_KEY = "yoasobi-repeat";

function savedRepeat() {
  try {
    const v = localStorage.getItem(REPEAT_KEY);
    return REPEAT_MODES.includes(v) ? v : "off";
  } catch {
    return "off";
  }
}

const formatDate = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

// Spotify's iFrame API: one embedded player we can load and play from our own buttons.
let apiPromise;
function loadSpotifyApi() {
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      window.onSpotifyIframeApiReady = resolve;
      const s = document.createElement("script");
      s.src = "https://open.spotify.com/embed/iframe-api/v1";
      s.async = true;
      s.onerror = () => {
        apiPromise = null;
        reject(new Error("Spotify player could not load"));
      };
      document.body.appendChild(s);
    });
  }
  return apiPromise;
}

// Spotify reports no "ended" event, so a stop near the end counts as the end:
// the last couple of seconds of the track, or the 30 s mark when a logged-out
// visitor only gets the preview (the reported duration is still the full song).
// Albums pause briefly between tracks, hence the settle wait.
const END_WINDOW_MS = 2000;
const END_SETTLE_MS = 1200;
const PREVIEW_MS = 30000;
const STALL_MS = 3000; // no updates while "playing" means it quietly stopped
const nearEnd = ({ position: p, duration: d }) =>
  (d > 0 && p >= d - END_WINDOW_MS) || Math.abs(p - PREVIEW_MS) <= END_WINDOW_MS;

function useSpotifyPlayer(mountRef, repeat) {
  const controller = useRef(null);
  const pending = useRef(null); // uri to play as soon as the player is ready
  const last = useRef({ position: 0, duration: 0 });
  const endTimer = useRef(null);
  const loadedAt = useRef(0);
  const pausedByHand = useRef(false); // a pause from our boxes is never "the end"
  // Logged-out visitors often get no playback_update events at all, so we also
  // keep our own clock and treat 30 s of playing as the end of the preview.
  const heardFromSpotify = useRef(false);
  const clock = useRef({ playedMs: 0, since: null, timer: null });
  const onEnd = useRef(() => {});
  const [currentKey, setCurrentKey] = useState(null);
  const [paused, setPaused] = useState(true);
  const [error, setError] = useState(null);

  const stopClock = useCallback(() => {
    const k = clock.current;
    clearTimeout(k.timer);
    if (k.since !== null) k.playedMs += Date.now() - k.since;
    k.since = null;
  }, []);

  const startClock = useCallback(() => {
    const k = clock.current;
    if (heardFromSpotify.current || k.since !== null) return;
    k.since = Date.now();
    k.timer = setTimeout(() => {
      if (!heardFromSpotify.current) onEnd.current();
    }, Math.max(0, PREVIEW_MS + END_SETTLE_MS - k.playedMs));
  }, []);

  const load = useCallback(
    (box) => {
      clearTimeout(endTimer.current);
      stopClock();
      clock.current.playedMs = 0;
      heardFromSpotify.current = false;
      pausedByHand.current = false;
      last.current = { position: 0, duration: 0 };
      loadedAt.current = Date.now();
      setCurrentKey(box.key);
      setPaused(false);
      pending.current = box.uri;
      controller.current?.loadUri(box.uri);
    },
    [stopClock],
  );

  useEffect(() => {
    let alive = true;
    loadSpotifyApi()
      .then((IFrameAPI) => {
        if (!alive || !mountRef.current) return;
        // Spotify swaps this element for its iframe, so it must not be React's own node.
        const el = document.createElement("div");
        mountRef.current.appendChild(el);
        const uri = pending.current || ALL_BOXES[0].uri;
        IFrameAPI.createController(el, { uri, width: "100%", height: PLAYER_HEIGHT }, (c) => {
          if (!alive) {
            c.destroy?.();
            return;
          }
          controller.current = c;
          c.addListener("ready", () => {
            if (pending.current) {
              pending.current = null;
              c.play();
              startClock();
            }
          });
          c.addListener("playback_update", (e) => {
            const { isPaused, position = 0, duration = 0 } = e.data;
            heardFromSpotify.current = true;
            stopClock();
            const prev = last.current;
            last.current = { position, duration };
            setPaused(isPaused);
            clearTimeout(endTimer.current);
            if (!isPaused) pausedByHand.current = false;
            if (pausedByHand.current || Date.now() - loadedAt.current < END_WINDOW_MS) return;
            if (!isPaused) {
              endTimer.current = setTimeout(() => nearEnd(last.current) && onEnd.current(), STALL_MS);
            } else if (nearEnd(last.current) || nearEnd(prev)) {
              endTimer.current = setTimeout(() => onEnd.current(), END_SETTLE_MS);
            }
          });
        });
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
      clearTimeout(endTimer.current);
      clearTimeout(clock.current.timer);
      controller.current?.destroy?.();
      controller.current = null;
      if (mountRef.current) mountRef.current.innerHTML = "";
    };
  }, [mountRef, startClock, stopClock]);

  onEnd.current = () => {
    stopClock();
    const box = ALL_BOXES.find((b) => b.key === currentKey);
    if (!box) return;
    if (repeat === "off") return setPaused(true);
    if (repeat === "one") return load(box);
    const boxes = SHELVES.find((s) => s.id === box.shelf).boxes;
    load(boxes[(box.index + 1) % boxes.length]);
  };

  const playBox = useCallback(
    (box) => {
      const c = controller.current;
      if (box.key !== currentKey || !c) return load(box);
      // Explicit pause/resume from our own state: togglePlay depends on the
      // embed knowing its state, which it may not report when logged out.
      clearTimeout(endTimer.current);
      if (paused) {
        pausedByHand.current = false;
        setPaused(false);
        c.resume();
        startClock();
      } else {
        pausedByHand.current = true;
        setPaused(true);
        c.pause();
        stopClock();
      }
    },
    [currentKey, paused, load, startClock, stopClock],
  );

  // Previous / next box on the same shelf, wrapping round.
  const step = useCallback(
    (dir) => {
      const box = ALL_BOXES.find((b) => b.key === currentKey);
      if (!box) return load(ALL_BOXES[0]);
      const boxes = SHELVES.find((s) => s.id === box.shelf).boxes;
      load(boxes[(box.index + dir + boxes.length) % boxes.length]);
    },
    [currentKey, load],
  );

  return { currentKey, paused, error, playBox, step };
}

const ICONS = {
  play: <path d="M8 5.6v12.8a1 1 0 0 0 1.52.85l10.4-6.4a1 1 0 0 0 0-1.7L9.52 4.75A1 1 0 0 0 8 5.6z" />,
  pause: (
    <>
      <rect x="6" y="5" width="4.5" height="14" rx="1.3" />
      <rect x="13.5" y="5" width="4.5" height="14" rx="1.3" />
    </>
  ),
  next: <path d="M5 6.1v11.8a1 1 0 0 0 1.56.83L15 13.1V18a1.25 1.25 0 0 0 2.5 0V6A1.25 1.25 0 0 0 15 6v4.9L6.56 5.27A1 1 0 0 0 5 6.1z" />,
  repeat: (
    <g fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 2.5l3.5 3.5L17 9.5" />
      <path d="M3.5 11.5V10a4 4 0 0 1 4-4h13" />
      <path d="M7 21.5L3.5 18 7 14.5" />
      <path d="M20.5 12.5V14a4 4 0 0 1-4 4h-13" />
    </g>
  ),
};

function Icon({ name, flip }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" style={flip ? { transform: "scaleX(-1)" } : undefined}>
      {ICONS[name]}
    </svg>
  );
}

function RepeatButton({ repeat, onClick }) {
  return (
    <button
      type="button"
      className={`ys-btn ys-repeat is-${repeat}`}
      onClick={onClick}
      title={REPEAT_LABEL[repeat]}
      aria-label={`${REPEAT_LABEL[repeat]}. Change repeat mode`}
    >
      <Icon name="repeat" />
      {repeat === "one" && <span className="ys-repeat-one">1</span>}
    </button>
  );
}

function MusicBox({ box, index, playing, selected, isNew, onPlay }) {
  return (
    <li className="mb-cell" style={{ "--i": index }}>
      <button
        type="button"
        className={`mb${playing ? " is-playing" : ""}${selected ? " is-selected" : ""}`}
        style={{ "--hue": box.hue }}
        aria-pressed={playing}
        aria-label={`${playing ? "Pause" : "Play"} ${box.title}`}
        onClick={() => onPlay(box)}
      >
        <span className="mb-notes" aria-hidden="true">
          <i>♪</i>
          <i>♫</i>
          <i>♪</i>
        </span>
        <span className="mb-lid" aria-hidden="true" />
        <span className="mb-body">
          <span className="mb-glow" aria-hidden="true" />
          <span className="mb-crank" aria-hidden="true" />
          <span className="mb-title">{box.title}</span>
          {box.native !== box.title && <span className="mb-sub">{box.native}</span>}
          {box.date && <span className="mb-date">{formatDate(box.date)}</span>}
          <span className="mb-disc" aria-hidden="true" />
          <span className="mb-key" aria-hidden="true">
            <Icon name={playing ? "pause" : "play"} />
          </span>
        </span>
        {isNew && <span className="mb-new">new</span>}
      </button>
    </li>
  );
}

export default function YoasobiSpace() {
  const mount = useRef(null);
  const panel = useRef(null);
  const [repeat, setRepeat] = useState(savedRepeat);
  const [panelInView, setPanelInView] = useState(true);
  const { currentKey, paused, error, playBox, step } = useSpotifyPlayer(mount, repeat);
  const now = ALL_BOXES.find((b) => b.key === currentKey);
  const playing = Boolean(now) && !paused;

  // On narrow screens the player scrolls away, so a small bar takes over.
  useEffect(() => {
    if (!panel.current || !("IntersectionObserver" in window)) return undefined;
    const seen = new IntersectionObserver(([entry]) => setPanelInView(entry.isIntersecting), { threshold: 0.2 });
    seen.observe(panel.current);
    return () => seen.disconnect();
  }, []);

  const cycleRepeat = () => {
    const next = REPEAT_MODES[(REPEAT_MODES.indexOf(repeat) + 1) % REPEAT_MODES.length];
    setRepeat(next);
    try {
      localStorage.setItem(REPEAT_KEY, next);
    } catch {
      // private mode: the choice just lasts for this visit
    }
  };

  const showPlayer = () => {
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    panel.current?.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "center" });
  };

  return (
    <div className="ys">
      <div className="ys-wrap">
        <header className="ys-head">
          <div className="ys-moon" aria-hidden="true" />
          <div>
            <h1>YOASOBI music boxes</h1>
            <p>Open a box to hear it.</p>
          </div>
        </header>

        <div className="ys-main">
          <aside className="ys-side" aria-label="Player">
            <div className="ys-player" ref={panel}>
              <div className="ys-now" aria-live="polite">
                <span className={`ys-eq${playing ? " is-on" : ""}`} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <div className="ys-now-text">
                  <span className="ys-now-label">{error ? "Player" : playing ? "Now playing" : now ? "Paused" : "Ready"}</span>
                  <span className="ys-now-title">{error ? error : now ? now.title : "Pick a music box"}</span>
                </div>
              </div>
              <div className="ys-embed">
                <div ref={mount} />
              </div>
              <div className="ys-controls">
                <button type="button" className="ys-btn" onClick={() => step(-1)} aria-label="Previous box" title="Previous box">
                  <Icon name="next" flip />
                </button>
                <button type="button" className="ys-btn" onClick={() => step(1)} aria-label="Next box" title="Next box">
                  <Icon name="next" />
                </button>
                <span className="ys-controls-gap" />
                <RepeatButton repeat={repeat} onClick={cycleRepeat} />
              </div>
            </div>
            <p className="ys-foot">Log in to Spotify in this browser for full tracks. Volume follows your device.</p>
          </aside>

          <div className="ys-shelves">
            {SHELVES.map((s) => (
              <section className={`ys-shelf is-${s.id}`} key={s.id} aria-labelledby={`ys-${s.id}`}>
                <div className="ys-shelf-head">
                  <h2 id={`ys-${s.id}`} className="ys-shelf-title">
                    {s.title}
                  </h2>
                  <span className="ys-shelf-count">{s.boxes.length}</span>
                </div>
                <ol className="mb-grid">
                  {s.boxes.map((box, i) => (
                    <MusicBox
                      key={box.key}
                      box={box}
                      index={i}
                      isNew={s.id === "latest" && i === 0}
                      selected={box.key === currentKey}
                      playing={box.key === currentKey && !paused}
                      onPlay={playBox}
                    />
                  ))}
                </ol>
              </section>
            ))}
          </div>
        </div>
      </div>

      {now && !panelInView && (
        <div className="ys-mini" style={{ "--hue": now.hue }}>
          <button
            type="button"
            className="ys-btn is-primary"
            onClick={() => playBox(now)}
            aria-label={`${playing ? "Pause" : "Play"} ${now.title}`}
          >
            <Icon name={playing ? "pause" : "play"} />
          </button>
          <button type="button" className="ys-mini-title" onClick={showPlayer} title="Show the player">
            <span>{now.title}</span>
            {now.native !== now.title && <small>{now.native}</small>}
          </button>
          <button type="button" className="ys-btn" onClick={() => step(1)} aria-label="Next box" title="Next box">
            <Icon name="next" />
          </button>
          <RepeatButton repeat={repeat} onClick={cycleRepeat} />
        </div>
      )}
    </div>
  );
}
