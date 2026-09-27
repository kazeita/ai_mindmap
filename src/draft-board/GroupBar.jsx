import { useState } from "react";

export default function GroupBar({ groups, group, actions }) {
  const [mode, setMode] = useState(null); // "rename" | "new"
  const [text, setText] = useState("");
  const list = Object.values(groups).sort((a, b) => a.createdAt - b.createdAt);

  const open = (m) => {
    setText(m === "rename" ? group.name : "");
    setMode(m);
  };

  const submit = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (mode === "new") actions.create(text.trim());
    else actions.rename(text);
    setMode(null);
  };

  if (mode) {
    return (
      <form className="db-groupbar" onSubmit={submit}>
        <input
          autoFocus
          className="db-input"
          value={text}
          maxLength={40}
          onChange={(e) => setText(e.target.value)}
          placeholder={mode === "new" ? "Group name, e.g. Tuesday futsal" : "Group name"}
          aria-label={mode === "new" ? "New group name" : "Group name"}
        />
        <button className="btn-secondary" type="submit" disabled={!text.trim()}>
          {mode === "new" ? "Create" : "Save"}
        </button>
        <button className="btn-ghost" type="button" onClick={() => setMode(null)}>
          Cancel
        </button>
      </form>
    );
  }

  return (
    <div className="db-groupbar">
      {list.length > 1 ? (
        <label className="db-grouppick">
          <span className="db-sr">Group</span>
          <select value={group.id} onChange={(e) => actions.switchTo(e.target.value)}>
            {list.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <strong className="db-groupname">{group.name}</strong>
      )}
      <button className="btn-ghost" type="button" onClick={() => open("rename")}>
        Rename
      </button>
      <button className="btn-ghost" type="button" onClick={() => open("new")}>
        + New group
      </button>
    </div>
  );
}
