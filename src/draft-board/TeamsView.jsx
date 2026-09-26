import { useMemo, useState } from "react";
import { analyzeTeams, balanceTeams, teamSizes } from "./engine/balance.js";
import { MU, muToTier, winProbability } from "./engine/rating.js";
import { formatDay, MAX_TEAMS, shareUrl, TEAM_COLORS, teamsMessage } from "./engine/share.js";
import { addRule, lastSession, logSession, removeRule } from "./engine/store.js";
import { randomSeed } from "./engine/util.js";
import CaptainsPick from "./CaptainsPick.jsx";
import ResultForm from "./ResultForm.jsx";
import { copyText, Flash, Stepper, TeamCard, Toggle, useFlash } from "./ui.jsx";

const pct = (p) => `${Math.round(p * 100)}%`;
const fmt = (x) => (x == null ? "–" : x.toFixed(1));

function evenness(p) {
  const d = Math.abs(p - 0.5);
  if (d < 0.04) return "Dead even";
  if (d < 0.08) return "Close";
  if (d < 0.15) return "Slightly uneven";
  return "Uneven";
}

function BalanceSummary({ teams, analysis, ratings }) {
  if (teams.length === 2 && analysis.winChance != null) {
    const p = analysis.winChance;
    return (
      <div className="db-balance">
        <div className="db-balance-top">
          <strong>{evenness(p)}</strong>
          <span className="db-muted">predicted win chance</span>
        </div>
        <div className="db-meter" role="img" aria-label={`Red ${pct(p)}, Blue ${pct(1 - p)}`}>
          <span style={{ width: pct(p), background: TEAM_COLORS[0].hex }} />
          <span style={{ width: pct(1 - p), background: TEAM_COLORS[1].hex }} />
        </div>
        <div className="db-meter-labels">
          <span>Red {pct(p)}</span>
          <span>{pct(1 - p)} Blue</span>
        </div>
      </div>
    );
  }
  const s = analysis.strengths;
  const hi = s.indexOf(Math.max(...s));
  const lo = s.indexOf(Math.min(...s));
  if (hi === lo || !teams[hi].length || !teams[lo].length) return null;
  const p = winProbability(teams[hi], teams[lo], ratings);
  return (
    <div className="db-balance">
      <div className="db-balance-top">
        <strong>{evenness(p)}</strong>
        <span className="db-muted">
          strongest ({TEAM_COLORS[hi].name}) vs weakest ({TEAM_COLORS[lo].name}): {pct(p)} – {pct(1 - p)}
        </span>
      </div>
    </div>
  );
}

function RulesEditor({ group, updateGroup }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [type, setType] = useState("apart");
  const name = (id) => group.players.find((p) => p.id === id)?.name ?? "?";
  const total = group.rules.apart.length + group.rules.together.length;
  const options = group.players.map((p) => (
    <option key={p.id} value={p.id}>
      {p.name}
    </option>
  ));
  const rows = [
    ...group.rules.apart.map((pair, i) => ({ type: "apart", i, pair })),
    ...group.rules.together.map((pair, i) => ({ type: "together", i, pair })),
  ];
  return (
    <details className="db-rules" open={total > 0}>
      <summary>Rules{total ? ` (${total})` : ""}</summary>
      {rows.length > 0 && (
        <ul className="db-rule-list">
          {rows.map(({ type: t, i, pair: [x, y] }) => (
            <li key={`${t}${i}`}>
              <span>
                Keep <b>{name(x)}</b> and <b>{name(y)}</b> {t === "apart" ? "apart" : "together"}
              </span>
              <button
                type="button"
                className="db-icon-btn"
                aria-label={`Remove rule for ${name(x)} and ${name(y)}`}
                onClick={() => updateGroup((g) => removeRule(g, t, i))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="db-rule-form"
        onSubmit={(e) => {
          e.preventDefault();
          updateGroup((g) => addRule(g, type, a, b));
          setA("");
          setB("");
        }}
      >
        <select className="db-input" value={a} onChange={(e) => setA(e.target.value)} aria-label="First player">
          <option value="">Player…</option>
          {options}
        </select>
        <select className="db-input" value={type} onChange={(e) => setType(e.target.value)} aria-label="Rule type">
          <option value="apart">keep apart from</option>
          <option value="together">keep together with</option>
        </select>
        <select className="db-input" value={b} onChange={(e) => setB(e.target.value)} aria-label="Second player">
          <option value="">Player…</option>
          {options}
        </select>
        <button className="btn-secondary" type="submit" disabled={!a || !b || a === b}>
          Add rule
        </button>
      </form>
      <p className="db-muted">For real-life constraints: two friends who share a ride (together), your two keepers (apart).</p>
    </details>
  );
}

export default function TeamsView({ group, updateGroup, rating, goTo }) {
  const { settings, draft } = group;
  const byId = useMemo(() => new Map(group.players.map((p) => [p.id, p])), [group.players]);
  const present = group.players.filter((p) => p.here);
  const last = lastSession(group);
  const maxTeams = Math.max(2, Math.min(MAX_TEAMS, present.length));
  const teamCount = Math.min(settings.teamCount, maxTeams);
  const [selected, setSelected] = useState(null); // { id, team }
  const [mode, setMode] = useState(null); // null | "captains" | "result"
  const [reveal, setReveal] = useState(null);
  const [message, flash] = useFlash();

  const name = (id) => byId.get(id)?.name ?? "Removed player";
  const muOf = (id) => rating.ratings.get(id)?.mu ?? MU;
  const setSetting = (patch) => updateGroup((g) => ({ ...g, settings: { ...g.settings, ...patch } }));
  const isNewcomer = (p) => p.isNew && (rating.record.get(p.id)?.sessions ?? 0) < 3;

  const makeTeams = () => {
    const blind = settings.fairnessTest;
    const arm = blind && Math.random() < 0.5 ? "random" : "balanced";
    const { teams } = balanceTeams({
      players: present.map((p) => ({ id: p.id, mu: muOf(p.id), roles: p.roles, isNew: isNewcomer(p) })),
      teamCount,
      rules: group.rules,
      roles: group.roles,
      lastTeams: last?.teams ?? null,
      spreadNew: settings.spreadNew,
      avoidRepeat: settings.avoidRepeat,
      mode: arm,
      seed: randomSeed(),
      exclude: draft?.teams,
    });
    updateGroup((g) => ({ ...g, draft: { teams, arm, blind, edited: false, createdAt: Date.now() } }));
    setSelected(null);
    setReveal(null);
    setMode(null);
  };

  const editDraft = (fn) =>
    updateGroup((g) => {
      if (!g.draft) return g;
      const teams = fn(g.draft.teams.map((t) => [...t]));
      return teams ? { ...g, draft: { ...g.draft, teams, edited: true } } : g;
    });

  const tapPlayer = (team, id) => {
    if (!selected || selected.team === team) {
      setSelected(selected?.id === id ? null : { id, team });
      return;
    }
    const other = selected;
    editDraft((teams) => {
      const i = teams[other.team].indexOf(other.id);
      const j = teams[team].indexOf(id);
      if (i < 0 || j < 0) return null;
      teams[other.team][i] = id;
      teams[team][j] = other.id;
      return teams;
    });
    setSelected(null);
  };

  const moveSelectedTo = (team) => {
    const other = selected;
    editDraft((teams) => {
      teams[other.team] = teams[other.team].filter((x) => x !== other.id);
      teams[team].push(other.id);
      return teams;
    });
    setSelected(null);
  };

  // Latecomers join the smallest team, and the weaker one if sizes tie.
  const addLatecomer = (id) =>
    editDraft((teams) => {
      const strength = teams.map((t) => t.reduce((s, x) => s + muOf(x), 0));
      let best = 0;
      teams.forEach((t, i) => {
        if (t.length < teams[best].length || (t.length === teams[best].length && strength[i] < strength[best])) best = i;
      });
      teams[best].push(id);
      return teams;
    });

  const dropFromDraft = (id) => editDraft((teams) => teams.map((t) => t.filter((x) => x !== id)));

  const teamNames = () => draft.teams.map((t) => t.map((id) => byId.get(id)?.name).filter(Boolean));
  const link = () => shareUrl(window.location.origin, { group: group.name, date: draft.createdAt, teams: teamNames() });

  const copyMessage = async () => {
    const text = teamsMessage({ group: group.name, dateLabel: formatDay(draft.createdAt), teams: teamNames(), link: link() });
    flash((await copyText(text)) ? "Copied. Paste it into your group chat." : "Couldn't copy on this browser.");
  };

  const shareLink = async () => {
    const url = link();
    if (navigator.share) {
      try {
        await navigator.share({ title: `Teams · ${group.name}`, url });
        return;
      } catch (e) {
        if (e?.name === "AbortError") return;
      }
    }
    flash((await copyText(url)) ? "Link copied. It shows names only." : "Couldn't copy on this browser.");
  };

  const saveResult = (result) => {
    const { arm, blind } = draft;
    updateGroup((g) => logSession(g, result));
    setMode(null);
    setSelected(null);
    setReveal({ arm, blind });
  };

  const discard = () => {
    if (draft.edited && !window.confirm("Discard these teams and your changes?")) return;
    updateGroup((g) => ({ ...g, draft: null }));
    setSelected(null);
    setMode(null);
  };

  if (group.players.length < 2 || present.length < 2) {
    return (
      <section className="db-card">
        <h2>Teams</h2>
        <p className="db-empty">
          {group.players.length < 2
            ? "Add at least two players first."
            : "Mark who's here tonight: at least two players."}
        </p>
        <div className="db-actions">
          <button className="btn-primary small" type="button" onClick={() => goTo("players")}>
            Go to players
          </button>
        </div>
      </section>
    );
  }

  const analysis = draft
    ? analyzeTeams(draft.teams, {
        ratings: rating.ratings,
        rules: group.rules,
        roles: group.roles,
        players: group.players,
        lastTeams: last?.teams ?? null,
      })
    : null;
  const inDraft = new Set(draft ? draft.teams.flat() : []);
  const arrived = draft ? present.filter((p) => !inDraft.has(p.id)) : [];
  const left = draft ? draft.teams.flat().filter((id) => !byId.get(id)?.here) : [];
  const countChanged = draft && draft.teams.length !== teamCount;
  const blind = draft?.blind && mode !== "captains";

  const describeIssue = (iss) => {
    if (iss.type === "apart") return `${name(iss.a)} and ${name(iss.b)} are on the same team (rule: keep apart).`;
    if (iss.type === "together") return `${name(iss.a)} and ${name(iss.b)} are split up (rule: keep together).`;
    return `${iss.role} is uneven: ${iss.counts.join(" / ")} per team.`;
  };

  return (
    <>
      {reveal && (
        <div className={`db-notice ${reveal.blind ? "" : "is-success"}`} role="status">
          <span>
            {reveal.blind ? (
              <>
                That was {reveal.arm === "random" ? <b>a random split</b> : <b>a Draft Board split</b>}. Logged for the
                fairness test.
              </>
            ) : (
              <>Result saved. Ratings updated.</>
            )}
          </span>
          <button className="btn-ghost" type="button" onClick={() => goTo("history")}>
            See history
          </button>
        </div>
      )}

      {mode === "captains" ? (
        <CaptainsPick
          present={present}
          teamCount={teamCount}
          byId={byId}
          onCancel={() => setMode(null)}
          onUse={(teams) => {
            updateGroup((g) => ({
              ...g,
              draft: { teams, arm: "captains", blind: false, edited: false, createdAt: Date.now() },
            }));
            setMode(null);
            setReveal(null);
          }}
        />
      ) : draft ? (
        <section className="db-card">
          <h2>
            {formatDay(draft.createdAt)}
            {draft.arm === "captains" && <span className="db-badge is-captains">Captains' pick</span>}
            {draft.edited && <span className="db-badge">edited</span>}
          </h2>

          {blind ? (
            <p className="db-notice">
              Fairness test: this split is either Draft Board's or random. Balance stays hidden until you log the
              result.
            </p>
          ) : (
            <BalanceSummary teams={draft.teams} analysis={analysis} ratings={rating.ratings} />
          )}

          {(arrived.length > 0 || left.length > 0 || countChanged) && (
            <div className="db-notice is-warn">
              <span>The roster or setup changed since these teams were made.</span>
              {arrived.map((p) => (
                <button key={p.id} className="btn-ghost" type="button" onClick={() => addLatecomer(p.id)}>
                  + Add {p.name}
                </button>
              ))}
              {left.map((id) => (
                <button key={id} className="btn-ghost" type="button" onClick={() => dropFromDraft(id)}>
                  − Take out {name(id)}
                </button>
              ))}
              <button className="btn-ghost" type="button" onClick={makeTeams}>
                Remake teams
              </button>
            </div>
          )}

          {analysis.issues.length > 0 && (
            <ul className="db-issues">
              {analysis.issues.map((iss, i) => (
                <li key={i}>{describeIssue(iss)}</li>
              ))}
            </ul>
          )}

          <div className="db-teams">
            {draft.teams.map((team, ti) => (
              <TeamCard
                key={ti}
                index={ti}
                meta={blind ? team.length : `${team.length} · avg ${fmt(analysis.avgTier[ti])}`}
                action={
                  selected && selected.team !== ti ? (
                    <button type="button" className="db-team-move" onClick={() => moveSelectedTo(ti)}>
                      Move here
                    </button>
                  ) : null
                }
              >
                {team.map((id) => {
                  const p = byId.get(id);
                  const isSel = selected?.id === id;
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        className={`db-team-player${isSel ? " is-selected" : ""}`}
                        aria-pressed={isSel}
                        onClick={() => tapPlayer(ti, id)}
                      >
                        <span className="db-team-name">{name(id)}</span>
                        {p?.roles.map((r) => (
                          <span key={r} className="db-badge">
                            {r}
                          </span>
                        ))}
                        {p && isNewcomer(p) && <span className="db-badge is-new">new</span>}
                        {!blind && (
                          <span className="db-team-tier">
                            <span className="db-sr">tier </span>
                            {fmt(muToTier(muOf(id)))}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </TeamCard>
            ))}
          </div>
          <p className="db-hint">
            {selected
              ? `Tap someone on another team to swap with ${name(selected.id)}, or use “Move here”.`
              : "Tap two players on different teams to swap them."}
            {!blind && settings.avoidRepeat && last && analysis.repeats > 0 && (
              <> {analysis.repeats} teammate pair{analysis.repeats === 1 ? "" : "s"} repeat from last time.</>
            )}
          </p>

          {mode === "result" ? (
            <ResultForm teamCount={draft.teams.length} blind={draft.blind} onSave={saveResult} onCancel={() => setMode(null)} />
          ) : (
            <div className="db-actions">
              <button className="btn-primary small" type="button" onClick={() => setMode("result")}>
                Log result
              </button>
              <button className="btn-secondary" type="button" onClick={copyMessage}>
                Copy for group chat
              </button>
              <button className="btn-secondary" type="button" onClick={shareLink}>
                Share link
              </button>
              {!draft.blind && (
                <button className="btn-ghost" type="button" onClick={makeTeams}>
                  ↻ Shuffle again
                </button>
              )}
              <button className="btn-ghost" type="button" onClick={discard}>
                Discard
              </button>
            </div>
          )}
          {draft.blind && mode !== "result" && (
            <p className="db-muted db-spaced">Play the first split you get: reshuffling until it looks fair spoils the test.</p>
          )}
          <Flash message={message} />
        </section>
      ) : null}

      {mode !== "captains" && (
        <section className="db-card">
          <h2>{draft ? "Setup" : "Tonight's setup"}</h2>
          <div className="db-setup-row">
            <div>
              <div className="db-label">Teams</div>
              <Stepper value={teamCount} min={2} max={maxTeams} label="teams" onChange={(v) => setSetting({ teamCount: v })} />
            </div>
            <p className="db-sizes">
              {present.length} here → {teamSizes(present.length, teamCount).join(" v ")}
            </p>
          </div>
          <div className="db-toggles">
            <Toggle
              checked={settings.spreadNew}
              onChange={(v) => setSetting({ spreadNew: v })}
              label="Spread new players"
              hint="Players tagged New go to different teams for their first sessions."
            />
            <Toggle
              checked={settings.avoidRepeat}
              onChange={(v) => setSetting({ avoidRepeat: v })}
              label="Mix up teammates"
              hint="Avoid repeating last session's pairings when it costs almost nothing in balance."
            />
            <Toggle
              checked={settings.fairnessTest}
              onChange={(v) => setSetting({ fairnessTest: v })}
              label="Fairness test (blind)"
              hint="Half the time you get a random split instead, with balance hidden until you log the result. History then shows whether Draft Board games really are closer."
            />
          </div>
          <RulesEditor group={group} updateGroup={updateGroup} />
          {!draft && (
            <div className="db-actions">
              <button className="btn-primary small" type="button" onClick={makeTeams}>
                Make fair teams
              </button>
              <button className="btn-secondary" type="button" onClick={() => setMode("captains")}>
                Captains pick instead
              </button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
