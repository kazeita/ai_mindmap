import "./site-tabs.css";

export const TABS = [
  { id: "map", path: "/", label: "AI Map", title: "Reasoning Map - AI Mindmap" },
  { id: "draft", path: "/draft-board", label: "Draft Board", title: "Draft Board · fair teams for pickup games", badge: "New" },
  { id: "endless", path: "/endless-way", label: "Endless Way", title: "Endless Way" },
  { id: "amber", path: "/amber-heart", label: "Amber Heart", title: "The Amber Heart" },
];

export const tabForPath = (path) =>
  TABS.find((t) => t.path !== "/" && (path === t.path || path.startsWith(`${t.path}/`)))?.id ?? "map";

export default function SiteTabs({ active, onNavigate }) {
  return (
    <nav className="site-tabs" aria-label="Site sections">
      <div className="site-tabs-inner">
        {TABS.map((tab) => (
          <a
            key={tab.id}
            href={tab.path}
            className={`site-tab${tab.id === active ? " is-active" : ""}`}
            aria-current={tab.id === active ? "page" : undefined}
            onClick={(e) => {
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              onNavigate(tab);
            }}
          >
            {tab.label}
            {tab.badge && tab.id !== active && <span className="site-tab-badge">{tab.badge}</span>}
          </a>
        ))}
      </div>
    </nav>
  );
}
