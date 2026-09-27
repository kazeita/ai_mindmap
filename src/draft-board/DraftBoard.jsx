import { useCallback, useEffect, useMemo, useState } from "react";
import { Analytics } from "@vercel/analytics/react";
import "./draft-board.css";
import { computeRatings } from "./engine/rating.js";
import { decodeShare } from "./engine/share.js";
import { emptyState, loadState, newGroup, saveState } from "./engine/store.js";
import GroupBar from "./GroupBar.jsx";
import HistoryView from "./HistoryView.jsx";
import PlayersView from "./PlayersView.jsx";
import SharedTeams from "./SharedTeams.jsx";
import TeamsView from "./TeamsView.jsx";

function readShareHash() {
  const m = window.location.hash.match(/^#t=(.+)$/);
  if (!m) return null;
  return decodeShare(m[1]) || { invalid: true };
}

export default function DraftBoard() {
  const [shared, setShared] = useState(readShareHash);
  const [state, setState] = useState(() => loadState());
  const [saved, setSaved] = useState(true);
  const group = state.groups[state.activeGroupId];
  const [view, setView] = useState(() => (group.players.length >= 2 ? "teams" : "players"));

  useEffect(() => {
    const onHash = () => setShared(readShareHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    setSaved(saveState(state));
  }, [state]);

  const updateGroup = useCallback(
    (fn) => setState((s) => ({ ...s, groups: { ...s.groups, [s.activeGroupId]: fn(s.groups[s.activeGroupId]) } })),
    [],
  );

  const rating = useMemo(() => computeRatings(group.players, group.sessions), [group.players, group.sessions]);

  const groupActions = useMemo(
    () => ({
      switchTo: (id) => setState((s) => (s.groups[id] ? { ...s, activeGroupId: id } : s)),
      create: (name) => {
        const g = newGroup(name);
        setState((s) => ({ ...s, activeGroupId: g.id, groups: { ...s.groups, [g.id]: g } }));
        setView("players");
      },
      rename: (name) => updateGroup((g) => ({ ...g, name: name.trim().slice(0, 40) || g.name })),
      add: (g) => setState((s) => ({ ...s, activeGroupId: g.id, groups: { ...s.groups, [g.id]: g } })),
      removeActive: () =>
        setState((s) => {
          const rest = { ...s.groups };
          delete rest[s.activeGroupId];
          const ids = Object.keys(rest);
          return ids.length ? { ...s, groups: rest, activeGroupId: ids[0] } : emptyState();
        }),
    }),
    [updateGroup],
  );

  const closeShared = () => {
    window.history.replaceState(null, "", "/draft-board");
    setShared(null);
  };

  if (shared) {
    return (
      <>
        <SharedTeams data={shared} onOpenBoard={closeShared} />
        <Analytics />
      </>
    );
  }

  const tabs = [
    ["players", "Players", group.players.length],
    ["teams", "Teams", null],
    ["history", "History", group.sessions.length],
  ];

  return (
    <div className="db-app">
      <header className="db-hero">
        <h1>Draft Board</h1>
        <p>Fair teams for pickup games from the first night. Rough tiers to start, real results to learn from.</p>
      </header>

      <GroupBar groups={state.groups} group={group} actions={groupActions} />

      <nav className="db-seg" aria-label="Draft Board sections">
        {tabs.map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            className={`db-seg-btn${view === id ? " is-active" : ""}`}
            aria-current={view === id ? "true" : undefined}
            onClick={() => setView(id)}
          >
            {label}
            {count != null && <span className="db-seg-count">{count}</span>}
          </button>
        ))}
      </nav>

      {!saved && (
        <p className="db-notice is-warn" role="alert">
          This browser isn't saving (private window or storage full). Download a backup from History before you close
          the tab.
        </p>
      )}

      {view === "players" && (
        <PlayersView group={group} updateGroup={updateGroup} rating={rating} onDone={() => setView("teams")} />
      )}
      {view === "teams" && <TeamsView group={group} updateGroup={updateGroup} rating={rating} goTo={setView} />}
      {view === "history" && (
        <HistoryView group={group} groups={state.groups} updateGroup={updateGroup} rating={rating} actions={groupActions} />
      )}

      <footer className="db-foot">
        Everything stays in this browser: no account, no server. Share links carry names only, never tiers or
        ratings.
      </footer>
      <Analytics />
    </div>
  );
}
