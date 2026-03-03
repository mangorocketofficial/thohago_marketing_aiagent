import { useTranslation } from "react-i18next";
import { useNavigation } from "../context/NavigationContext";
import { NAV_ITEMS, type PageId } from "../types/navigation";

type SidebarProps = {
  activePage: PageId;
};

export const Sidebar = ({ activePage }: SidebarProps) => {
  const { t } = useTranslation();
  const { navigate } = useNavigation();
  const primaryItems = NAV_ITEMS.filter((item) => item.section === "primary");
  const secondaryItems = NAV_ITEMS.filter((item) => item.section === "secondary");

  return (
    <aside className="ui-sidebar">
      <div className="ui-sidebar-brand">
        <p className="ui-sidebar-eyebrow">{t("ui.sidebar.productEyebrow")}</p>
        <strong className="ui-sidebar-title">{t("ui.sidebar.productTitle")}</strong>
      </div>

      <nav className="ui-sidebar-nav" aria-label={t("ui.sidebar.primaryNavAria")}> 
        {primaryItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`ui-nav-item ${item.id === activePage ? "is-active" : ""}`}
            onClick={() => navigate(item.id)}
          >
            <span className="ui-nav-icon" aria-hidden>
              {item.icon}
            </span>
            <span>{t(`ui.nav.${item.id}`)}</span>
          </button>
        ))}
      </nav>

      <div className="ui-sidebar-divider" />

      <nav className="ui-sidebar-nav" aria-label={t("ui.sidebar.secondaryNavAria")}> 
        {secondaryItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`ui-nav-item ${item.id === activePage ? "is-active" : ""}`}
            onClick={() => navigate(item.id)}
          >
            <span className="ui-nav-icon" aria-hidden>
              {item.icon}
            </span>
            <span>{t(`ui.nav.${item.id}`)}</span>
          </button>
        ))}
      </nav>

      <footer className="ui-sidebar-footer">
        <p className="ui-sidebar-user">{t("ui.sidebar.userLabel")}</p>
        <p className="ui-sidebar-org">{t("ui.sidebar.orgLabel")}</p>
      </footer>
    </aside>
  );
};
