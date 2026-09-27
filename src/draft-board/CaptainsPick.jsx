import { useState } from "react";
import { TEAM_COLORS } from "./engine/share.js";
import { TeamCard } from "./ui.jsx";

// Records a captains' draft as it happens, so those nights become the
// comparison group for Draft Board's own teams.
export default function CaptainsPick({ present, teamCount, byId, onUse, onCancel }) {
  const [picks, setPicks] = useState([]);
  const picked = new Set(picks);
  const pool = present.filter((p) => !picked.has(p.id));
  const teams = Array.from({ length: teamCount }, () => []);
  picks.forEach((id, i) => teams[i % teamCount].push(id));
  const next = TEAM_COLORS[picks.length % teamCount];

  return (
    <section className="db-card">
      <p className="db-kicker">Captains pick</p>
      <h2>{pool.length ? `${next.name} picks next` : "Everyone's picked"}</h2>
      <p className="db-muted">
        Tap players in the order the captains call them. Picks go {TEAM_COLORS.slice(0, teamCount).map((c) => c.name).join(", ")},
        then round again; each team's first pick is its captain. History compares these nights with Draft Board's.
      </p>
      <div className="db-teams is-compact">
        {teams.map((t, ti) => (
          <TeamCard key={ti} index={ti} meta={t.length}>
            {t.map((id, j) => (
              <li key={id} className="db-team-static">
                {byId.get(id)?.name}
                {j === 0 && <span className="db-badge">C</span>}
              </li>
            ))}
          </TeamCard>
        ))}
      </div>
      {pool.length > 0 && (
        <div className="db-chipgrid">
          {pool.map((p) => (
            <button key={p.id} type="button" className="db-chip is-big" onClick={() => setPicks((x) => [...x, p.id])}>
              {p.name}
            </button>
          ))}
        </div>
      )}
      <div className="db-actions">
        <button className="btn-primary small" type="button" disabled={pool.length > 0} onClick={() => onUse(teams)}>
          Use these teams
        </button>
        <button className="btn-ghost" type="button" disabled={!picks.length} onClick={() => setPicks((x) => x.slice(0, -1))}>
          Undo pick
        </button>
        <button className="btn-ghost" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}
