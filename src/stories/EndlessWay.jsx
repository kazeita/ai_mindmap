import text from "./endless-way.txt?raw";
import "./endless-way.css";

// The story lives in endless-way.txt so it can be edited as plain text:
//   - the first line is the title
//   - paragraphs are separated by a blank line
//   - a paragraph that is only 〇, ⁂ or * * * is drawn as a scene break
const BREAKS = new Set(["〇", "⁂", "* * *"]);

// Fonts load on their own, so a blocked font request never blocks the story.
const FONTS = "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;1,500&family=Lora:ital@0;1&display=swap";
if (!document.querySelector(`link[href="${FONTS}"]`)) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = FONTS;
  document.head.appendChild(link);
}

const [title, ...paragraphs] = text
  .replace(/\r\n?/g, "\n")
  .split(/\n\s*\n/)
  .map((p) => p.trim())
  .filter(Boolean);

export default function EndlessWay() {
  return (
    <article className="ew">
      <header className="ew-head">
        <p className="ew-eyebrow">A travel story</p>
        <h1>{title}</h1>
        <div className="ew-road" aria-hidden="true" />
      </header>
      {paragraphs.map((p, i) =>
        BREAKS.has(p) ? (
          <p key={i} className="ew-break" aria-hidden="true">
            {p === "* * *" ? "· · ·" : p}
          </p>
        ) : (
          <p key={i}>
            {p.split("\n").map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {line}
              </span>
            ))}
          </p>
        ),
      )}
      <footer className="ew-foot">
        Fan fiction inspired by <em>Wandering Witch: The Journey of Elaina</em>.
      </footer>
    </article>
  );
}
