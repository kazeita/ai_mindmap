import { formatDay } from "./engine/share.js";
import { TeamCard } from "./ui.jsx";

// What people see when a host shares the teams: names only, plus the one
// place Draft Board asks for anything (the organiser-to-organiser loop).
export default function SharedTeams({ data, onOpenBoard }) {
  const kicker = data.invalid ? "Draft Board" : [data.group, data.date ? formatDay(data.date) : null].filter(Boolean).join(" · ");
  return (
    <div className="db-app">
      <header className="db-hero">
        <p className="db-kicker">{kicker || "Draft Board"}</p>
        <h1>{data.invalid ? "Link not readable" : "The teams"}</h1>
        {data.invalid && <p>This team link is incomplete or broken. Ask the organiser to share it again.</p>}
      </header>
      {!data.invalid && (
        <div className="db-teams">
          {data.teams.map((names, i) => (
            <TeamCard key={i} index={i} meta={names.length}>
              {names.map((n, j) => (
                <li key={j} className="db-team-static">
                  {n}
                </li>
              ))}
            </TeamCard>
          ))}
        </div>
      )}
      <section className="db-card db-cta">
        <h2>Organise pickup games too?</h2>
        <p className="db-muted">
          Draft Board makes fair teams from the first night and learns from every result. Free, no sign-up, works on
          your phone.
        </p>
        <div className="db-actions">
          <button className="btn-primary small" type="button" onClick={onOpenBoard}>
            Make teams for your group
          </button>
        </div>
      </section>
    </div>
  );
}
