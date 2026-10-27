import { useEffect, useRef } from "react";
import { ARTIST_ID, RELEASES } from "./releases.js";
import "./yoasobi.css";

const embed = (type, id) => `https://open.spotify.com/embed/${type}/${id}?utm_source=generator&theme=0`;

const formatDate = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

// Slowly drifting stars with a few twinkles; still when the visitor prefers reduced motion.
function Starfield() {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w, h, stars, raf;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = Array.from({ length: Math.round((w * h) / 2600) }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.3 + 0.2,
        z: Math.random() * 0.6 + 0.1,
        t: Math.random() * Math.PI * 2,
        hue: Math.random() < 0.15 ? 330 : Math.random() < 0.3 ? 200 : 240,
      }));
    };
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        if (!still) {
          s.y += s.z * 0.18;
          s.t += 0.02 * s.z;
          if (s.y > h + 2) {
            s.y = -2;
            s.x = Math.random() * w;
          }
        }
        ctx.globalAlpha = 0.45 + 0.55 * Math.abs(Math.sin(s.t));
        ctx.fillStyle = `hsl(${s.hue} 90% 88%)`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!still) raf = requestAnimationFrame(draw);
    };
    resize();
    draw();
    const onResize = () => {
      resize();
      if (still) draw();
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);
  return <canvas ref={ref} className="ys-stars" aria-hidden="true" />;
}

export default function YoasobiSpace() {
  return (
    <div className="ys">
      <Starfield />
      <div className="ys-nebula" aria-hidden="true" />
      <div className="ys-planet" aria-hidden="true">
        <span className="ys-ring" />
      </div>

      <header className="ys-hero">
        <p className="ys-kicker">Transmission · latest releases</p>
        <h1>
          YOASOBI <span>in orbit</span>
        </h1>
        <p className="ys-lede">
          The newest from Ayase and ikura, from the first orchestral single back to the year's opening anime themes. Press
          play and drift.
        </p>
      </header>

      <ol className="ys-orbit">
        {RELEASES.map((r, i) => (
          <li key={r.id} className="ys-card" style={{ "--i": i }}>
            <div className="ys-meta">
              <span className="ys-index" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <h2>{r.title}</h2>
                <p className="ys-native">
                  {r.native} · <time dateTime={r.date}>{formatDate(r.date)}</time>
                </p>
              </div>
              {i === 0 && <span className="ys-new">New</span>}
            </div>
            <p className="ys-note">{r.note}</p>
            <iframe
              className={`ys-player is-${r.type}`}
              src={embed(r.type, r.id)}
              title={`${r.title} on Spotify`}
              loading="lazy"
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            />
          </li>
        ))}
      </ol>

      <section className="ys-card ys-artist">
        <h2>More from the YOASOBI galaxy</h2>
        <iframe
          className="ys-player is-artist"
          src={embed("artist", ARTIST_ID)}
          title="YOASOBI top tracks on Spotify"
          loading="lazy"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        />
      </section>

      <p className="ys-foot">Players are Spotify embeds; log in to Spotify in this browser to hear full tracks.</p>
    </div>
  );
}
