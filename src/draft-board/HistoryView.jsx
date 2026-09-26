import { useMemo, useRef } from "react";
import { ARM_LABELS, experimentVerdict, MIN_SESSIONS, summarizeExperiment } from "./engine/experiment.js";
import { formatDay, TEAM_COLORS } from "./engine/share.js";
import { anonymisedExport, deleteSession, exportGroup, importGroup } from "./engine/store.js";
import { download, Flash, slug, useFlash } from "./ui.jsx";

const pct = (x) => (x == null ? "–" : `${Math.round(x * 100)}%`);
const dec = (x) => (x == null ? "–" : x.toFixed(2));

function matchText(m) {
  const A = TEAM_COLORS[m.a].name;
  const B = TEAM_COLORS[m.b].name;
  if (m.sa != null && m.sb != null) return `${A} ${m.sa} – ${m.sb} ${B}`;
  if (m.winner === "draw") return `${A} and ${B} drew`;
  return m.winner === "a" ? `${A} beat ${B}` : `${B} beat ${A}`;
}

export default function HistoryView({ group, groups, updateGroup, rating, actions }) {
  const [message, flash] = useFlash();
  const fileRef = useRef(null);
  const byId = useMemo(() => new Map(group.players.map((p) => [p.id, p])), [group.players]);
  const name = (id) => byId.get(id)?.name ?? "(removed)";
  const summary = useMemo(() => summarizeExperiment(group.sessions), [group.sessions]);
  const verdict = experimentVerdict(summary);
  const chemistry = rating.chemistry
    .filter((c) => c.n >= 5 && Math.abs(c.effect) >= 0.08 && byId.has(c.a) && byId.has(c.b))
    .slice(0, 6);
  const sessions = [...group.sessions].sort((a, b) => b.at - a.at);
  const showTest = group.settings.fairnessTest || summary.some((s) => s.arm !== "balanced");

  const onImport = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const g = importGroup(await file.text(), Object.keys(groups));
    if (!g) {
      flash("That file isn't a Draft Board backup.");
      return;
    }
    actions.add(g);
    flash(`Restored “${g.name}”.`);
  };

  return (
    <>
      {showTest && (
        <section className="db-card">
          <h2>Fairness test</h2>
          <p className="db-muted">
            Do Draft Board teams really play closer than a random split or a captains' pick? Margin runs from 0 (dead
            even) to 1 (a shutout); Lopsided and Close are how the games felt.
          </p>
          {summary.length ? (
            <div className="db-table-wrap">
              <table className="db-table">
                <thead>
                  <tr>
                    <th scope="col">Teams by</th>
                    <th scope="col">Sessions</th>
                    <th scope="col">Margin</th>
                    <th scope="col">Lopsided</th>
                    <th scope="col">Close</th>
                    <th scope="col" className="db-col-edited">Edited</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((s) => (
                    <tr key={s.arm}>
                      <th scope="row">{s.label}</th>
                      <td>{s.sessions}</td>
                      <td>{dec(s.meanMargin)}</td>
                      <td>{pct(s.lopsidedRate)}</td>
                      <td>{pct(s.closeRate)}</td>
                      <td className="db-col-edited">{pct(s.editedRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="db-empty">No sessions logged yet.</p>
          )}
          {summary.length > 0 && <p className={`db-verdict is-${verdict.status}`}>{verdict.text}</p>}
          <p className="db-muted db-spaced">
            A fair read needs about {MIN_SESSIONS} sessions on each side. Testing with several groups? Each host downloads
            the anonymised test data below, and you pool the files.
          </p>
        </section>
      )}

      {chemistry.length > 0 && (
        <section className="db-card">
          <h2>
            Chemistry <span className="db-tag">early signal</span>
          </h2>
          <p className="db-muted">
            Pairs whose teams beat (or fall short of) the prediction when they play together. +10 means their teams won
            10 points more often than expected. Pulled toward zero until there's enough data, and not used for
            balancing yet.
          </p>
          <ul className="db-chem">
            {chemistry.map((c) => (
              <li key={`${c.a}|${c.b}`}>
                <span>
                  {name(c.a)} + {name(c.b)}
                </span>
                <span className={c.effect > 0 ? "is-pos" : "is-neg"}>
                  {c.effect > 0 ? "+" : "−"}
                  {Math.round(Math.abs(c.effect) * 100)}
                </span>
                <span className="db-muted">{c.n} games</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="db-card">
        <h2>Sessions</h2>
        {!sessions.length ? (
          <p className="db-empty">
            No results yet. Make teams, play, then log the score: every result sharpens the ratings.
          </p>
        ) : (
          <ol className="db-sessions">
            {sessions.map((s) => (
              <li key={s.id} className="db-session">
                <div className="db-session-head">
                  <strong>{formatDay(s.at)}</strong>
                  <span className={`db-badge is-${s.arm}`}>{ARM_LABELS[s.arm]}</span>
                  {s.edited && <span className="db-badge">edited</span>}
                  {s.feel && <span className="db-muted">felt {s.feel}</span>}
                  <button
                    type="button"
                    className="db-icon-btn"
                    aria-label={`Delete the session from ${formatDay(s.at)}`}
                    onClick={() => {
                      if (window.confirm("Delete this session? Ratings are recalculated without it."))
                        updateGroup((g) => deleteSession(g, s.id));
                    }}
                  >
                    ×
                  </button>
                </div>
                <ul className="db-session-matches">
                  {s.matches.map((m, i) => (
                    <li key={i}>{matchText(m)}</li>
                  ))}
                </ul>
                <details>
                  <summary>Teams</summary>
                  <ul className="db-session-teams">
                    {s.teams.map((t, ti) => (
                      <li key={ti}>
                        <span className="db-dot" style={{ background: TEAM_COLORS[ti].hex }} aria-hidden="true" />
                        <b>{TEAM_COLORS[ti].name}:</b> {t.map(name).join(", ")}
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="db-card">
        <h2>Your data</h2>
        <p className="db-muted">Stored only in this browser. Download a backup to move to another phone or keep it safe.</p>
        <div className="db-actions">
          <button
            className="btn-secondary"
            type="button"
            onClick={() => download(`draft-board-${slug(group.name)}.json`, exportGroup(group))}
          >
            Download backup
          </button>
          <button className="btn-secondary" type="button" onClick={() => fileRef.current?.click()}>
            Restore a backup
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onImport} />
          <button
            className="btn-secondary"
            type="button"
            disabled={!group.sessions.length}
            onClick={() =>
              download(
                `draft-board-test-${new Date().toISOString().slice(0, 10)}.json`,
                JSON.stringify(anonymisedExport(group, rating), null, 2),
              )
            }
          >
            Download anonymised test data
          </button>
        </div>
        <Flash message={message} />
        <div className="db-danger">
          <button
            className="btn-ghost is-danger"
            type="button"
            onClick={() => {
              if (window.confirm(`Delete “${group.name}”, with every player and result, from this browser? This can't be undone.`))
                actions.removeActive();
            }}
          >
            Delete this group
          </button>
        </div>
      </section>
    </>
  );
}
