import { useState } from "react";
import { addPeerTiers, clearPeerTiers } from "./engine/store.js";
import { TierPicker } from "./ui.jsx";

// Pass-the-phone cold start: each person privately rates the others.
// Answers are folded into running averages on save; nothing links a rating
// to the person who gave it.
export default function PeerRating({ group, updateGroup, onClose }) {
  const [rater, setRater] = useState(null);
  const [tiers, setTiers] = useState({});
  const [thanked, setThanked] = useState(null);
  const here = group.players.filter((p) => p.here);
  const waiting = here.filter((p) => !group.peerRaters.includes(p.id));

  const setTier = (id, t) =>
    setTiers((x) => {
      const next = { ...x };
      if (t == null) delete next[id];
      else next[id] = t;
      return next;
    });

  if (rater) {
    const others = here.filter((p) => p.id !== rater.id);
    const count = Object.keys(tiers).length;
    return (
      <section className="db-card db-peer">
        <p className="db-kicker">Private · for {rater.name}</p>
        <h2>How strong is everyone else?</h2>
        <p className="db-muted">
          Tap a tier for anyone you've played with and skip the rest. 1 is a beginner, 5 the strongest. Your answers
          are blended into averages the moment you save.
        </p>
        <ul className="db-peer-list">
          {others.map((p) => (
            <li key={p.id}>
              <span>{p.name}</span>
              <TierPicker value={tiers[p.id] ?? null} label={`Tier for ${p.name}`} onChange={(t) => setTier(p.id, t)} />
            </li>
          ))}
        </ul>
        <div className="db-actions">
          <button
            className="btn-primary small"
            type="button"
            disabled={!count}
            onClick={() => {
              updateGroup((g) => addPeerTiers(g, rater.id, tiers));
              setThanked(rater.name);
              setRater(null);
              setTiers({});
            }}
          >
            Save and pass the phone
          </button>
          <button
            className="btn-ghost"
            type="button"
            onClick={() => {
              setRater(null);
              setTiers({});
            }}
          >
            Cancel
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="db-card db-peer">
      <p className="db-kicker">Pass the phone</p>
      <h2>{thanked ? `Thanks, ${thanked}. Who's next?` : "Who's rating?"}</h2>
      <p className="db-muted">
        Each person rates the others on their own. Only running averages are stored, so nobody can see who rated whom.
      </p>
      {waiting.length ? (
        <div className="db-chipgrid">
          {waiting.map((p) => (
            <button
              key={p.id}
              type="button"
              className="db-chip is-big"
              onClick={() => {
                setRater(p);
                setThanked(null);
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      ) : (
        <p className="db-empty">Everyone here has rated.</p>
      )}
      <p className="db-muted">
        {here.length - waiting.length} of {here.length} done.
      </p>
      <div className="db-actions">
        <button className="btn-primary small" type="button" onClick={onClose}>
          Done
        </button>
        {group.peerRaters.length > 0 && (
          <button
            className="btn-ghost"
            type="button"
            onClick={() => {
              if (window.confirm("Clear every peer tier and start the round again?")) updateGroup(clearPeerTiers);
            }}
          >
            Reset peer tiers
          </button>
        )}
      </div>
    </section>
  );
}
