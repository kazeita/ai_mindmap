import { useEffect, useState } from "react";
import { ARTIST_ID, RELEASES } from "./releases.js";
import "./yoasobi.css";

const embed = (type, id) => `https://open.spotify.com/embed/${type}/${id}?utm_source=generator&theme=0`;

const formatDate = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

// A real (per-browser) visit counter in the old hit-counter style.
function useVisits() {
  const [n, setN] = useState(null);
  useEffect(() => {
    try {
      const next = (Number(localStorage.getItem("ys-visits")) || 0) + 1;
      localStorage.setItem("ys-visits", String(next));
      setN(next);
    } catch {
      setN(1);
    }
  }, []);
  return n;
}

export default function YoasobiSpace() {
  const visits = useVisits();
  return (
    <div className="ys">
      <div className="ys-page">
        <header className="ys-header">
          <div className="ys-moon" aria-hidden="true" />
          <div>
            <h1>☆ YOASOBI in orbit ☆</h1>
            <p className="ys-tagline">a cozy little corner of the night sky for the newest songs ~</p>
          </div>
        </header>

        <nav className="ys-nav" aria-label="Releases">
          {RELEASES.map((r) => (
            <a key={r.id} href={`#ys-${r.id}`}>
              {r.title}
            </a>
          ))}
        </nav>

        <div className="ys-layout">
          <main className="ys-posts">
            {RELEASES.map((r, i) => (
              <article key={r.id} id={`ys-${r.id}`} className="ys-post">
                <div className="ys-date" aria-hidden="true">
                  <span>{new Date(`${r.date}T00:00:00`).toLocaleDateString(undefined, { month: "short" })}</span>
                  <b>{Number(r.date.slice(8))}</b>
                </div>
                <div className="ys-post-body">
                  <h2>
                    {r.title}
                    {i === 0 && <span className="ys-new">new!</span>}
                  </h2>
                  <p className="ys-byline">
                    {r.native} · posted <time dateTime={r.date}>{formatDate(r.date)}</time>
                  </p>
                  <p>{r.note}</p>
                  <iframe
                    className={`ys-player is-${r.type}`}
                    src={embed(r.type, r.id)}
                    title={`${r.title} on Spotify`}
                    loading="lazy"
                    allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                  />
                  <p className="ys-tags">
                    filed under: <span>yoasobi</span> <span>{r.type === "album" ? "albums" : "singles"}</span>{" "}
                    <span>2026</span>
                  </p>
                </div>
              </article>
            ))}
          </main>

          <aside className="ys-sidebar">
            <section className="ys-widget">
              <h3>♪ about the band</h3>
              <p>
                YOASOBI is <b>Ayase</b> (composer) and <b>ikura</b> (vocals), a duo that turns short stories into songs.
              </p>
            </section>
            <section className="ys-widget">
              <h3>☾ now playing</h3>
              <iframe
                className="ys-player is-artist"
                src={embed("artist", ARTIST_ID)}
                title="YOASOBI top tracks on Spotify"
                loading="lazy"
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              />
            </section>
            <section className="ys-widget">
              <h3>✿ archive</h3>
              <ul>
                {RELEASES.map((r) => (
                  <li key={r.id}>
                    <a href={`#ys-${r.id}`}>{r.title}</a> <small>({r.date.slice(0, 7)})</small>
                  </li>
                ))}
              </ul>
            </section>
            <section className="ys-widget ys-counter">
              <h3>☆ your visits</h3>
              <div className="ys-digits" aria-label={`You have visited ${visits ?? 1} times`}>
                {String(visits ?? 1)
                  .padStart(6, "0")
                  .split("")
                  .map((d, i) => (
                    <span key={i}>{d}</span>
                  ))}
              </div>
              <p>counted in this browser only ♡</p>
            </section>
          </aside>
        </div>

        <footer className="ys-footer">
          made with ♡ under the stars · players by Spotify (log in to hear full tracks) · best viewed with a warm drink
        </footer>
      </div>
    </div>
  );
}
