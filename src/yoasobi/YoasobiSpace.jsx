import { useCallback, useEffect, useRef, useState } from "react";
import { ARTIST_ID, RELEASES } from "./releases.js";
import "./yoasobi.css";

const BOXES = [
  ...RELEASES.map((r) => ({ ...r, uri: `spotify:${r.type}:${r.id}` })),
  { id: ARTIST_ID, uri: `spotify:artist:${ARTIST_ID}`, title: "Top tracks", native: "YOASOBI", date: null, type: "artist" },
];

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

function useSpotifyPlayer(mountRef) {
  const controller = useRef(null);
  const pending = useRef(null); // uri to play as soon as the player is ready
  const [current, setCurrent] = useState(null);
  const [paused, setPaused] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    loadSpotifyApi()
      .then((IFrameAPI) => {
        if (!alive || !mountRef.current) return;
        // Spotify swaps this element for its iframe, so it must not be React's own node.
        const el = document.createElement("div");
        mountRef.current.appendChild(el);
        IFrameAPI.createController(el, { uri: pending.current || BOXES[0].uri, width: "100%", height: 80 }, (c) => {
          if (!alive) {
            c.destroy?.();
            return;
          }
          controller.current = c;
          c.addListener("ready", () => {
            if (pending.current) {
              pending.current = null;
              c.play();
            }
          });
          c.addListener("playback_update", (e) => setPaused(e.data.isPaused));
        });
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
      controller.current?.destroy?.();
      controller.current = null;
      if (mountRef.current) mountRef.current.innerHTML = "";
    };
  }, [mountRef]);

  const playBox = useCallback(
    (box) => {
      const c = controller.current;
      if (box.uri === current && c) {
        c.togglePlay();
        return;
      }
      setCurrent(box.uri);
      setPaused(false);
      pending.current = box.uri;
      if (c) c.loadUri(box.uri);
    },
    [current],
  );

  return { current, paused, error, playBox };
}

function MusicBox({ box, index, playing, selected, onPlay }) {
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
        {index === 0 && <span className="mb-new">new</span>}
      </button>
    </li>
  );
}

export default function YoasobiSpace() {
  const mount = useRef(null);
  const { current, paused, error, playBox } = useSpotifyPlayer(mount);
  const now = BOXES.find((b) => b.uri === current);

  return (
    <div className="ys">
      <header className="ys-head">
        <div className="ys-moon" aria-hidden="true" />
        <h1>YOASOBI music boxes</h1>
        <p>Open a box to hear it. Newest first.</p>
      </header>

      <ol className="mb-grid">
        {BOXES.map((box, i) => (
          <MusicBox
            key={box.uri}
            box={box}
            index={i}
            selected={box.uri === current}
            playing={box.uri === current && !paused}
            onPlay={playBox}
          />
        ))}
      </ol>

      <div className="ys-dock" aria-live="polite">
        <p className="ys-dock-label">
          {error ? error : now ? `Now in the box: ${now.title}` : "Pick a music box"}
        </p>
        <div className="ys-dock-player">
          <div ref={mount} />
        </div>
      </div>
      <p className="ys-foot">Players by Spotify. Log in to Spotify in this browser to hear full tracks.</p>
    </div>
  );
}
