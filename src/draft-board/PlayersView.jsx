import { useState } from "react";
import { muToTier, sigmaToTiers, startingTier } from "./engine/rating.js";
import { addPlayers, removePlayer, setRoles, updatePlayer } from "./engine/store.js";
import PeerRating from "./PeerRating.jsx";
import { Flash, TierPicker, useFlash } from "./ui.jsx";

const fmt = (x) => x.toFixed(1);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default function PlayersView({ group, updateGroup, rating, onDone }) {
  const [text, setText] = useState("");
  const [renaming, setRenaming] = useState(null); // { id, value }
  const [roleText, setRoleText] = useState("");
  const [peerOpen, setPeerOpen] = useState(false);
  const [message, flash] = useFlash();
  const here = group.players.filter((p) => p.here);

  const add = (value) => {
    const { added, skipped } = addPlayers(group, value);
    if (!added && !skipped) return;
    updateGroup((g) => addPlayers(g, value).group);
    setText("");
    flash(skipped ? `Added ${added}. Skipped ${skipped} already on the list.` : `Added ${plural(added, "player")}.`);
  };

  // Pasting a list from a group chat adds everyone at once.
  const onPaste = (e) => {
    const pasted = e.clipboardData.getData("text");
    if (/[\n,;]/.test(pasted.trim())) {
      e.preventDefault();
      add(pasted);
    }
  };

  const setAllHere = (value) => updateGroup((g) => ({ ...g, players: g.players.map((p) => ({ ...p, here: value })) }));

  const commitRename = () => {
    if (!renaming) return;
    const name = renaming.value.trim().slice(0, 40);
    const clash = group.players.some((p) => p.id !== renaming.id && p.name.toLowerCase() === name.toLowerCase());
    if (clash) flash(`There's already a ${name} on the list.`);
    else if (name) updateGroup((g) => updatePlayer(g, renaming.id, { name }));
    setRenaming(null);
  };

  const remove = (p) => {
    if (!window.confirm(`Remove ${p.name}? Their name and tiers are deleted; past results stay, anonymised.`)) return;
    updateGroup((g) => removePlayer(g, p.id));
  };

  const addRole = (e) => {
    e.preventDefault();
    if (!roleText.trim()) return;
    updateGroup((g) => setRoles(g, [...g.roles, roleText]));
    setRoleText("");
  };

  const describe = (p) => {
    const rec = rating.record.get(p.id);
    const r = rating.ratings.get(p.id);
    if (rec?.games) {
      return `est. ${fmt(muToTier(r.mu))} ±${fmt(sigmaToTiers(r.sigma))} · ${plural(rec.games, "game")} (${rec.wins}W ${rec.draws}D ${rec.losses}L)`;
    }
    if (p.peer?.count) return `peers say ${fmt(p.peer.sum / p.peer.count)} (${p.peer.count}) · no games yet`;
    return startingTier(p) ? "no games yet" : "no tier yet · counts as a 3";
  };

  if (peerOpen) return <PeerRating group={group} updateGroup={updateGroup} onClose={() => setPeerOpen(false)} />;

  return (
    <>
      <section className="db-card">
        <h2>Who plays?</h2>
        <form
          className="db-addrow"
          onSubmit={(e) => {
            e.preventDefault();
            add(text);
          }}
        >
          <input
            className="input-field"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={onPaste}
            placeholder="Add a name, or paste the list from your group chat"
            aria-label="Player name, or a list of names"
          />
          <button className="btn-primary small" type="submit" disabled={!text.trim()}>
            Add
          </button>
        </form>
        <Flash message={message} />

        {group.players.length === 0 ? (
          <p className="db-empty">
            Start with names. Tiers are optional: 1 is a beginner, 5 is your strongest regular, and anyone without a
            tier counts as a 3. Logged results take over from there.
          </p>
        ) : (
          <>
            <div className="db-listhead">
              <span>
                <strong>{here.length}</strong> of {group.players.length} here tonight
              </span>
              <span className="db-listhead-actions">
                <button className="btn-ghost" type="button" onClick={() => setAllHere(true)}>
                  All here
                </button>
                <button className="btn-ghost" type="button" onClick={() => setAllHere(false)}>
                  Clear
                </button>
              </span>
            </div>
            <p className="db-legend">Tier: 1 beginner → 5 strongest. A rough guess is enough.</p>
            <ul className="db-players">
              {group.players.map((p) => (
                <li key={p.id} className={`db-player${p.here ? "" : " is-away"}`}>
                  <button
                    type="button"
                    className="db-here"
                    aria-pressed={p.here}
                    aria-label={`${p.name} is here tonight`}
                    onClick={() => updateGroup((g) => updatePlayer(g, p.id, { here: !p.here }))}
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M3.5 8.5l3 3 6-7" />
                    </svg>
                  </button>
                  <div className="db-player-main">
                    {renaming?.id === p.id ? (
                      <input
                        className="db-input db-rename"
                        autoFocus
                        value={renaming.value}
                        maxLength={40}
                        aria-label={`Rename ${p.name}`}
                        onChange={(e) => setRenaming({ id: p.id, value: e.target.value })}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") setRenaming(null);
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="db-name"
                        title="Rename"
                        onClick={() => setRenaming({ id: p.id, value: p.name })}
                      >
                        {p.name}
                      </button>
                    )}
                    <span className="db-player-meta">{describe(p)}</span>
                  </div>
                  <TierPicker
                    value={p.tier}
                    label={`${p.name}'s tier`}
                    onChange={(tier) => updateGroup((g) => updatePlayer(g, p.id, { tier }))}
                  />
                  <div className="db-player-tags">
                    {group.roles.map((r) => {
                      const on = p.roles.includes(r);
                      return (
                        <button
                          key={r}
                          type="button"
                          className={`db-chip${on ? " is-on" : ""}`}
                          aria-pressed={on}
                          onClick={() =>
                            updateGroup((g) =>
                              updatePlayer(g, p.id, { roles: on ? p.roles.filter((x) => x !== r) : [...p.roles, r] }),
                            )
                          }
                        >
                          {r}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      className={`db-chip${p.isNew ? " is-on" : ""}`}
                      aria-pressed={p.isNew}
                      title="New to the group: spread across teams"
                      onClick={() => updateGroup((g) => updatePlayer(g, p.id, { isNew: !p.isNew }))}
                    >
                      New
                    </button>
                  </div>
                  <button type="button" className="db-icon-btn" aria-label={`Remove ${p.name}`} onClick={() => remove(p)}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {here.length >= 2 && (
        <div className="db-next">
          <button className="btn-primary" type="button" onClick={onDone}>
            Make teams for {here.length} players →
          </button>
        </div>
      )}

      {group.players.length > 0 && (
        <section className="db-card">
          <h2>Not sure who's good?</h2>
          <p className="db-muted">
            Pass the phone round: everyone taps a tier for the others, about 30 seconds each. Only averages are kept,
            never who rated whom.
          </p>
          <div className="db-actions">
            <button className="btn-secondary" type="button" onClick={() => setPeerOpen(true)} disabled={here.length < 3}>
              Pass the phone
            </button>
            {group.peerRaters.length > 0 && (
              <span className="db-muted">{plural(group.peerRaters.length, "person")} rated so far.</span>
            )}
          </div>
        </section>
      )}

      <section className="db-card">
        <h2>Positions to spread</h2>
        <p className="db-muted">Optional. Tag players (for example GK) and every team gets its fair share.</p>
        <div className="db-rolelist">
          {group.roles.map((r) => (
            <span className="db-chip is-static" key={r}>
              {r}
              <button
                type="button"
                aria-label={`Remove position ${r}`}
                onClick={() => updateGroup((g) => setRoles(g, g.roles.filter((x) => x !== r)))}
              >
                ×
              </button>
            </span>
          ))}
          {group.roles.length < 6 && (
            <form className="db-inline-form" onSubmit={addRole}>
              <input
                className="db-input"
                value={roleText}
                maxLength={16}
                onChange={(e) => setRoleText(e.target.value)}
                placeholder="e.g. GK"
                aria-label="New position"
              />
              <button className="btn-secondary" type="submit" disabled={!roleText.trim()}>
                Add
              </button>
            </form>
          )}
        </div>
      </section>
    </>
  );
}
