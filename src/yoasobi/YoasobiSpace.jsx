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

// Spotify reports no "ended" event, so the end is inferred. A stop counts as
// the end when it lands in the last couple of seconds of the track, at the
// 30 s mark (logged-out visitors only get a preview, while the reported
// duration is still the full song), or when the position jumps back to the
// start after a good stretch of playing. Albums pause briefly between tracks,
// so they get a short settle wait before the end is acted on.
const END_WINDOW_MS = 2000;
const END_SETTLE_MS = 1200;
const PREVIEW_MS = 30000;
const STALL_MS = 3000; // near an end and no more updates: it quietly stopped
const RESET_MIN_MS = 10000;
const READY_WAIT_MS = 1500; // no "ready" after loadUri: press play anyway
const nearEnd = ({ position: p, duration: d }) =>
  (d > 0 && p >= d - END_WINDOW_MS) || Math.abs(p - PREVIEW_MS) <= END_WINDOW_MS;
const newTrack = () => ({ position: 0, duration: 0, maxPosition: 0 });

// /yoasobi?debug shows what the Spotify player reports and what this page does about it.
const DEBUG = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug");
const secs = (ms) => (ms / 1000).toFixed(1);

function useDebugLog() {
  const [lines, setLines] = useState([]);
  const log = useCallback((text, kind = "") => {
    if (!DEBUG) return;
    const line = { text: `${secs(performance.now())}  ${text}`, kind };
    // A run of position updates collapses into its latest line.
    setLines((all) => [...(kind && all.at(-1)?.kind === kind ? all.slice(0, -1) : all), line].slice(-18));
  }, []);
  return [lines, log];
}

function useSpotifyPlayer(mountRef, repeat, log) {
  const controller = useRef(null);
  const pending = useRef(null); // uri to play as soon as the player is ready
  const current = useRef(null); // the box that is loaded
  const track = useRef(newTrack());
  const endTimer = useRef(null);
  const endPending = useRef(false);
  const readyTimer = useRef(null);
  const loadedAt = useRef(0);
  const pausedByHand = useRef(false); // a pause from our boxes is never "the end"
  const finished = useRef(false); // ended with repeat off: the next tap starts it again
  // Logged-out visitors may get no playback_update events at all, so we also
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
      if (heardFromSpotify.current) return;
      log("end: 30 s played with no word from Spotify");
      onEnd.current();
    }, Math.max(0, PREVIEW_MS + END_SETTLE_MS - k.playedMs));
  }, [log]);

  const cancelEnd = useCallback(() => {
    clearTimeout(endTimer.current);
    endPending.current = false;
  }, []);

  // The end was spotted. Tracks act on it at once (a hidden tab may not get
  // another timer for a while); albums wait in case the next track starts.
  const finish = useCallback(
    (reason) => {
      clearTimeout(endTimer.current);
      endPending.current = true;
      const wait = current.current?.type === "track" ? 0 : END_SETTLE_MS;
      log(`end: ${reason}`);
      if (wait) endTimer.current = setTimeout(() => onEnd.current(), wait);
      else onEnd.current();
    },
    [log],
  );

  const load = useCallback(
    (box) => {
      const c = controller.current;
      const again = current.current?.uri === box.uri;
      cancelEnd();
      clearTimeout(readyTimer.current);
      stopClock();
      clock.current.playedMs = 0;
      heardFromSpotify.current = false;
      pausedByHand.current = false;
      finished.current = false;
      track.current = newTrack();
      loadedAt.current = Date.now();
      current.current = box;
      setCurrentKey(box.key);
      setPaused(false);
      pending.current = box.uri;
      if (!c) return;
      log(`loadUri ${box.title}${again ? " (same song again)" : ""}`);
      c.loadUri(box.uri);
      if (again) {
        // Loading the song that is already loaded may do nothing, so no "ready" follows.
        c.play();
        startClock();
        return;
      }
      readyTimer.current = setTimeout(() => {
        if (pending.current !== box.uri) return;
        log("no ready after loadUri: play anyway");
        c.play();
        startClock();
      }, READY_WAIT_MS);
    },
    [cancelEnd, stopClock, startClock, log],
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
            log(`ready${pending.current ? ": play" : ""}`);
            clearTimeout(readyTimer.current);
            if (pending.current) {
              pending.current = null;
              c.play();
              startClock();
            }
          });
          c.addListener("playback_update", (e) => {
            const { isPaused, position = 0, duration = 0 } = e.data || {};
            log(`update ${isPaused ? "paused" : "playing"} pos=${secs(position)} dur=${secs(duration)}`, isPaused ? "" : "tick");
            heardFromSpotify.current = true;
            stopClock();
            setPaused(isPaused);
            const settled = Date.now() - loadedAt.current >= END_WINDOW_MS; // earlier updates may be the old song's
            const prev = track.current;
            const now = { position, duration, maxPosition: prev.maxPosition };
            if (!isPaused && settled) now.maxPosition = Math.max(prev.maxPosition, position);
            track.current = now;

            if (!isPaused) {
              pausedByHand.current = false;
              finished.current = false;
              cancelEnd();
              // If the updates simply stop, these are the moments the song would have run out.
              const waits = [];
              if (duration > 0) waits.push(duration - position + STALL_MS / 2);
              if (nearEnd(now)) waits.push(STALL_MS);
              if (settled && waits.length) {
                endTimer.current = setTimeout(() => finish("updates stopped at an end"), Math.max(0, Math.min(...waits)));
              }
              return;
            }
            // Paused. Once the end is spotted, later paused updates must not cancel it.
            if (endPending.current) return;
            clearTimeout(endTimer.current);
            if (pausedByHand.current || !settled) return;
            if (nearEnd(now) || nearEnd(prev)) finish("stopped at an end");
            else if (position <= 1000 && prev.maxPosition >= RESET_MIN_MS) finish("jumped back to the start");
          });
          if (DEBUG) {
            ["playback_started", "error"].forEach((name) =>
              c.addListener(name, (e) => log(`${name} ${JSON.stringify(e?.data ?? {})}`)),
            );
          }
        });
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
      clearTimeout(endTimer.current);
      clearTimeout(readyTimer.current);
      clearTimeout(clock.current.timer);
      controller.current?.destroy?.();
      controller.current = null;
      if (mountRef.current) mountRef.current.innerHTML = "";
    };
  }, [mountRef, startClock, stopClock, cancelEnd, finish, log]);

  onEnd.current = () => {
    cancelEnd();
    stopClock();
    const box = current.current;
    if (!box) return;
    if (repeat === "off") {
      log("repeat is off: stop here");
      finished.current = true;
      setPaused(true);
      return;
    }
    if (repeat === "one") return load(box);
    const boxes = SHELVES.find((s) => s.id === box.shelf).boxes;
    load(boxes[(box.index + 1) % boxes.length]);
  };

  const playBox = useCallback(
    (box) => {
      const c = controller.current;
      if (box.key !== currentKey || !c || finished.current) return load(box);
      // Explicit pause/resume from our own state: togglePlay depends on the
      // embed knowing its state, which it may not report when logged out.
      cancelEnd();
      if (paused) {
        log("box tapped: resume");
        pausedByHand.current = false;
        setPaused(false);
        c.resume();
        startClock();
      } else {
        log("box tapped: pause");
        pausedByHand.current = true;
        setPaused(true);
        c.pause();
        stopClock();
      }
    },
    [currentKey, paused, load, cancelEnd, startClock, stopClock, log],
  );

  // Previous / next box on the same shelf, wrapping round.
  const step = useCallback(
    (dir) => {
      const box = current.current;
      if (!box) return load(ALL_BOXES[0]);
      const boxes = SHELVES.find((s) => s.id === box.shelf).boxes;
      load(boxes[(box.index + dir + boxes.length) % boxes.length]);
    },
    [load],
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
  const [debugLines, log] = useDebugLog();
  const { currentKey, paused, error, playBox, step } = useSpotifyPlayer(mount, repeat, log);
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

      {DEBUG && (
        <pre className="ys-debug" aria-label="Player debug log">
          {`repeat: ${repeat}\n${debugLines.map((l) => l.text).join("\n")}`}
        </pre>
      )}

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
