import { useTranslation } from "react-i18next";

export const CampaignPlanPage = () => {
  const { t } = useTranslation();

  return (
    <div className="app-shell ui-page-shell">
      <section className="panel ui-page-panel">
        <p className="eyebrow">{t("ui.pages.campaignPlan.eyebrow")}</p>
        <h1>{t("ui.pages.campaignPlan.title")}</h1>
        <p className="description">{t("ui.pages.campaignPlan.description")}</p>
      </section>

      <section className="panel ui-page-panel ui-grid-2">
        <article className="ui-skeleton-card">
          <h2>{t("ui.pages.campaignPlan.objectiveTitle")}</h2>
          <p>{t("ui.pages.campaignPlan.objectiveDescription")}</p>
          <p className="ui-todo">{t("ui.common.todo")}</p>
        </article>

        <article className="ui-skeleton-card">
          <h2>{t("ui.pages.campaignPlan.scheduleTitle")}</h2>
          <p>{t("ui.pages.campaignPlan.scheduleDescription")}</p>
          <div className="ui-placeholder-block" />
        </article>
      </section>
    </div>
  );
};
