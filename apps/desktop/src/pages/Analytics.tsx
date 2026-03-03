import { useTranslation } from "react-i18next";

export const AnalyticsPage = () => {
  const { t } = useTranslation();

  return (
    <div className="app-shell ui-page-shell">
      <section className="panel ui-page-panel">
        <p className="eyebrow">{t("ui.pages.analytics.eyebrow")}</p>
        <h1>{t("ui.pages.analytics.title")}</h1>
        <p className="description">{t("ui.pages.analytics.description")}</p>
      </section>

      <section className="panel ui-page-panel ui-grid-3">
        <article className="ui-skeleton-card">
          <h2>{t("ui.pages.analytics.cardReach")}</h2>
          <div className="ui-placeholder-metric" />
        </article>
        <article className="ui-skeleton-card">
          <h2>{t("ui.pages.analytics.cardEngagement")}</h2>
          <div className="ui-placeholder-metric" />
        </article>
        <article className="ui-skeleton-card">
          <h2>{t("ui.pages.analytics.cardConversion")}</h2>
          <div className="ui-placeholder-metric" />
        </article>
      </section>

      <section className="panel ui-page-panel">
        <article className="ui-skeleton-card">
          <h2>{t("ui.pages.analytics.chartPlaceholderTitle")}</h2>
          <p>{t("ui.pages.analytics.chartPlaceholderDescription")}</p>
          <div className="ui-placeholder-chart" />
        </article>
      </section>
    </div>
  );
};
