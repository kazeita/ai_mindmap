import { useState } from "react";
import { TEAM_COLORS } from "./engine/share.js";

const blank = (a, b) => ({ a, b, sa: "", sb: "", winner: null });
const toScore = (s) => (/^\d{1,3}$/.test(s) ? Number(s) : null);

function TeamPick({ value, teamCount, onChange, label }) {
  if (teamCount === 2) {
    return (
      <span className="db-match-team">
        <span className="db-dot" style={{ background: TEAM_COLORS[value].hex }} aria-hidden="true" />
        {TEAM_COLORS[value].name}
      </span>
    );
  }
  return (
    <select className="db-input" value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))}>
      {TEAM_COLORS.slice(0, teamCount).map((c, t) => (
        <option key={c.key} value={t}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

export default function ResultForm({ teamCount, blind, onSave, onCancel }) {
  const [matches, setMatches] = useState([blank(0, 1)]);
  const [feel, setFeel] = useState(null);

  const update = (i, patch) => setMatches((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  const parsed = matches.map((m) => {
    const sa = toScore(m.sa);
    const sb = toScore(m.sb);
    const scored = sa != null && sb != null;
    return { a: m.a, b: m.b, sa: scored ? sa : null, sb: scored ? sb : null, winner: scored ? null : m.winner };
  });
  const valid = parsed.every((m) => m.a !== m.b && ((m.sa != null && m.sb != null) || m.winner));

  // With three or more teams, each new game defaults to the next pairing.
  const nextPair = () => {
    const pairs = [];
    for (let x = 0; x < teamCount; x++) for (let y = x + 1; y < teamCount; y++) pairs.push([x, y]);
    const [a, b] = pairs[matches.length % pairs.length];
    return blank(a, b);
  };

  return (
    <div className="db-result">
      <h3>Log the result</h3>
      <p className="db-muted">Scores if you kept them, otherwise just who won. Played several short games? Add each one.</p>
      {matches.map((m, i) => {
        const nameA = TEAM_COLORS[m.a].name;
        const nameB = TEAM_COLORS[m.b].name;
        return (
          <div className="db-match" key={i}>
            <div className="db-match-score">
              <TeamPick value={m.a} teamCount={teamCount} label="First team" onChange={(a) => update(i, { a })} />
              <input
                className="db-input db-score"
                inputMode="numeric"
                value={m.sa}
                placeholder="–"
                aria-label={`${nameA} score`}
                onChange={(e) => update(i, { sa: e.target.value.replace(/\D/g, "").slice(0, 3), winner: null })}
              />
              <span className="db-vs" aria-hidden="true">
                :
              </span>
              <input
                className="db-input db-score"
                inputMode="numeric"
                value={m.sb}
                placeholder="–"
                aria-label={`${nameB} score`}
                onChange={(e) => update(i, { sb: e.target.value.replace(/\D/g, "").slice(0, 3), winner: null })}
              />
              <TeamPick value={m.b} teamCount={teamCount} label="Second team" onChange={(b) => update(i, { b })} />
              {matches.length > 1 && (
                <button
                  type="button"
                  className="db-icon-btn db-match-x"
                  aria-label={`Remove game ${i + 1}`}
                  onClick={() => setMatches((ms) => ms.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              )}
            </div>
            <div className="db-winner" role="group" aria-label="Or pick the winner">
              <span className="db-muted">or</span>
              {[
                ["a", `${nameA} won`],
                ["draw", "Draw"],
                ["b", `${nameB} won`],
              ].map(([w, label]) => (
                <button
                  key={w}
                  type="button"
                  className={`db-chip${m.winner === w ? " is-on" : ""}`}
                  aria-pressed={m.winner === w}
                  onClick={() => update(i, { winner: m.winner === w ? null : w, sa: "", sb: "" })}
                >
                  {label}
                </button>
              ))}
            </div>
            {m.a === m.b && <p className="db-muted">Pick two different teams.</p>}
          </div>
        );
      })}
      <button type="button" className="btn-ghost" onClick={() => setMatches((ms) => [...ms, nextPair()])}>
        + Add another game
      </button>

      <div className="db-feel" role="group" aria-label="How did it feel?">
        <span className="db-label">How did it feel?</span>
        {[
          ["lopsided", "Lopsided"],
          ["fair", "Fair"],
          ["close", "Close"],
        ].map(([f, label]) => (
          <button
            key={f}
            type="button"
            className={`db-chip${feel === f ? " is-on" : ""}`}
            aria-pressed={feel === f}
            onClick={() => setFeel(feel === f ? null : f)}
          >
            {label}
          </button>
        ))}
      </div>
      {blind && <p className="db-muted db-spaced">Saving reveals whether this was a Draft Board or a random split.</p>}

      <div className="db-actions">
        <button className="btn-primary small" type="button" disabled={!valid} onClick={() => onSave({ matches: parsed, feel })}>
          Save result
        </button>
        <button className="btn-ghost" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
