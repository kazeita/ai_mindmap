import { useCallback, useEffect, useRef, useState } from "react";
import { ARTIST_ID, FAVORITES, RELEASES } from "./releases.js";
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
    { id: ARTIST_ID, title: "Top tracks", native: "YOASOBI", date: null, type: "artist" },
  ]),
];
const ALL_BOXES = SHELVES.flatMap((s) => s.boxes);

// Repeat cycles like Spotify's own button: off → whole shelf → this box.
const REPEAT_MODES = ["off", "all", "one"];
const REPEAT_LABEL = { off: "Repeat off", all: "Repeat shelf", one: "Repeat this box" };
const REPEAT_SYMBOL = { off: "🔁", all: "🔁", one: "🔂" };
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
        IFrameAPI.createController(el, { uri, width: "100%", height: 80 }, (c) => {
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

  return { currentKey, paused, error, playBox };
}

function MusicBox({ box, index, playing, selected, isNew, onPlay }) {
  return (
    <li className="mb-cell" style={{ "--i": index }}>
      <button
        type="button"
        className={`mb${playing ? " is-playing" : ""}${selected ? " is-selected" : ""}`}
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
          <span className="mb-crank" aria-hidden="true" />
          <span className="mb-plaque">
            <span className="mb-title">{box.title}</span>
            <span className="mb-sub">{box.native}</span>
            {box.date && <span className="mb-date">{formatDate(box.date)}</span>}
          </span>
          <span className="mb-state" aria-hidden="true">
            {playing ? "❚❚ playing" : "▶ play"}
          </span>
        </span>
        {isNew && <span className="mb-new">new</span>}
      </button>
    </li>
  );
}

export default function YoasobiSpace() {
  const mount = useRef(null);
  const [repeat, setRepeat] = useState(savedRepeat);
  const { currentKey, paused, error, playBox } = useSpotifyPlayer(mount, repeat);
  const now = ALL_BOXES.find((b) => b.key === currentKey);

  const cycleRepeat = () => {
    const next = REPEAT_MODES[(REPEAT_MODES.indexOf(repeat) + 1) % REPEAT_MODES.length];
    setRepeat(next);
    try {
      localStorage.setItem(REPEAT_KEY, next);
    } catch {
      // private mode: the choice just lasts for this visit
    }
  };

  return (
    <div className="ys">
      <header className="ys-head">
        <div className="ys-moon" aria-hidden="true" />
        <h1>YOASOBI music boxes</h1>
        <p>Open a box to hear it.</p>
      </header>

      {SHELVES.map((s) => (
        <section className="ys-shelf" key={s.id} aria-labelledby={`ys-${s.id}`}>
          <h2 id={`ys-${s.id}`} className="ys-shelf-title">
            {s.title}
          </h2>
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

      <div className="ys-dock">
        <div className="ys-dock-top">
          <p className="ys-dock-label" aria-live="polite">
            {error ? error : now ? `Now in the box: ${now.title}` : "Pick a music box"}
          </p>
          <button
            type="button"
            className={`ys-repeat is-${repeat}`}
            onClick={cycleRepeat}
            title={REPEAT_LABEL[repeat]}
            aria-label={`${REPEAT_LABEL[repeat]}. Change repeat mode`}
          >
            <span aria-hidden="true">{REPEAT_SYMBOL[repeat]}</span>
          </button>
        </div>
        <div className="ys-dock-player">
          <div ref={mount} />
        </div>
      </div>
      <p className="ys-foot">
        Players by Spotify. Log in to Spotify in this browser to hear full tracks. Volume follows your device and the
        Spotify app.
      </p>
    </div>
  );
}
