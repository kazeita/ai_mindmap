import { useCallback, useEffect, useRef, useState } from "react";
import { TEAM_COLORS } from "./engine/share.js";

export function TierPicker({ value, onChange, label }) {
  return (
    <div className="db-tiers" role="group" aria-label={label}>
      {[1, 2, 3, 4, 5].map((t) => (
        <button
          key={t}
          type="button"
          className={`db-tier${value === t ? " is-on" : ""}`}
          aria-pressed={value === t}
          onClick={() => onChange(value === t ? null : t)}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

export function TeamCard({ index, meta, action, children }) {
  const c = TEAM_COLORS[index];
  return (
    <section className="db-team" style={{ "--team": c.hex }}>
      <header className="db-team-head">
        <span className="db-team-dot" aria-hidden="true" />
        <h3>{c.name}</h3>
        {meta != null && <span className="db-team-meta">{meta}</span>}
        {action}
      </header>
      <ul className="db-team-list">{children}</ul>
    </section>
  );
}

export function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="db-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="db-toggle-track" aria-hidden="true" />
      <span className="db-toggle-text">
        <span className="db-toggle-label">{label}</span>
        {hint && <span className="db-toggle-hint">{hint}</span>}
      </span>
    </label>
  );
}

export function Stepper({ value, min, max, onChange, label }) {
  return (
    <div className="db-stepper" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={`Fewer ${label}`}>
        −
      </button>
      <output aria-live="polite">{value}</output>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label={`More ${label}`}>
        +
      </button>
    </div>
  );
}

// A short-lived status line (copied, saved, …) announced to screen readers.
export function useFlash(ms = 2800) {
  const [message, setMessage] = useState(null);
  const timer = useRef(null);
  const flash = useCallback(
    (m) => {
      setMessage(m);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setMessage(null), ms);
    },
    [ms],
  );
  useEffect(() => () => clearTimeout(timer.current), []);
  return [message, flash];
}

export function Flash({ message }) {
  return (
    <p className="db-flash" role="status" aria-live="polite">
      {message}
    </p>
  );
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const slug = (s) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "group";
