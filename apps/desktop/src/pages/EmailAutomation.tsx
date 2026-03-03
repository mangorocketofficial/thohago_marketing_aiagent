import { useTranslation } from "react-i18next";

export const EmailAutomationPage = () => {
  const { t } = useTranslation();

  return (
    <div className="app-shell ui-page-shell">
      <section className="panel ui-page-panel">
        <p className="eyebrow">{t("ui.pages.emailAutomation.eyebrow")}</p>
        <h1>{t("ui.pages.emailAutomation.title")}</h1>
        <p className="description">{t("ui.pages.emailAutomation.description")}</p>
      </section>

      <section className="panel ui-page-panel ui-grid-2">
        <article className="ui-skeleton-card">
          <h2>{t("ui.pages.emailAutomation.sequenceTitle")}</h2>
          <p>{t("ui.pages.emailAutomation.sequenceDescription")}</p>
          <p className="ui-todo">{t("ui.common.todo")}</p>
        </article>

        <article className="ui-skeleton-card">
          <h2>{t("ui.pages.emailAutomation.audienceTitle")}</h2>
          <p>{t("ui.pages.emailAutomation.audienceDescription")}</p>
          <div className="ui-placeholder-block" />
        </article>
      </section>
    </div>
  );
};
