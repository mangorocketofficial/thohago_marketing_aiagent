import { NAV_ITEMS, type PageId } from "../types/navigation";

type SidebarProps = {
  activePage: PageId;
  onSelectPage: (pageId: PageId) => void;
};

export const Sidebar = ({ activePage, onSelectPage }: SidebarProps) => {
  const primaryItems = NAV_ITEMS.filter((item) => item.section === "primary");
  const secondaryItems = NAV_ITEMS.filter((item) => item.section === "secondary");

  return (
    <aside className="ui-sidebar">
      <div className="ui-sidebar-brand">
        <p className="ui-sidebar-eyebrow">Ddohago</p>
        <strong className="ui-sidebar-title">Marketing Agent</strong>
      </div>

      <nav className="ui-sidebar-nav" aria-label="Primary navigation">
        {primaryItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`ui-nav-item ${item.id === activePage ? "is-active" : ""}`}
            onClick={() => onSelectPage(item.id)}
          >
            <span className="ui-nav-icon" aria-hidden>
              {item.icon}
            </span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="ui-sidebar-divider" />

      <nav className="ui-sidebar-nav" aria-label="Secondary navigation">
        {secondaryItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`ui-nav-item ${item.id === activePage ? "is-active" : ""}`}
            onClick={() => onSelectPage(item.id)}
          >
            <span className="ui-nav-icon" aria-hidden>
              {item.icon}
            </span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <footer className="ui-sidebar-footer">
        <p className="ui-sidebar-user">Local User</p>
        <p className="ui-sidebar-org">Desktop Organization</p>
      </footer>
    </aside>
  );
};

