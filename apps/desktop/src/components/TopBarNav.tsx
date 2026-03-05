import { useTranslation } from "react-i18next";
import { useNavigation } from "../context/NavigationContext";
import type { PageId } from "../types/navigation";

const TOP_BAR_ITEMS: readonly PageId[] = ["scheduler", "dashboard", "brand-review", "analytics", "settings"] as const;

export const TopBarNav = () => {
  const { t } = useTranslation();
  const { activePage, navigate } = useNavigation();

  return (
    <header className="ui-topbar">
      <div className="ui-topbar-brand">
        <p className="ui-topbar-eyebrow">{t("ui.sidebar.productEyebrow")}</p>
        <strong className="ui-topbar-title">{t("ui.sidebar.productTitle")}</strong>
      </div>

      <nav className="ui-topbar-nav" aria-label={t("ui.sidebar.primaryNavAria")}>
        {TOP_BAR_ITEMS.map((pageId) => (
          <button
            key={pageId}
            type="button"
            className={`ui-topbar-item ${activePage === pageId ? "is-active" : ""}`}
            onClick={() => navigate(pageId)}
          >
            {t(`ui.nav.${pageId}`)}
          </button>
        ))}
      </nav>
    </header>
  );
};
