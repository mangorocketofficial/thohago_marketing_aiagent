import { useTranslation } from "react-i18next";

export const ContentCreatePage = () => {
  const { t } = useTranslation();

  return (
    <div className="app-shell ui-page-shell">
      <section className="panel ui-page-panel">
        <p className="eyebrow">{t("ui.pages.contentCreate.eyebrow")}</p>
        <h1>{t("ui.pages.contentCreate.title")}</h1>
        <p className="description">{t("ui.pages.contentCreate.description")}</p>
      </section>

      <section className="panel ui-page-panel ui-grid-2">
        <article className="ui-skeleton-card">
          <h2>{t("ui.pages.contentCreate.briefTitle")}</h2>
          <p>{t("ui.pages.contentCreate.briefDescription")}</p>
          <p className="ui-todo">{t("ui.common.todo")}</p>
        </article>

        <article className="ui-skeleton-card">
          <h2>{t("ui.pages.contentCreate.previewTitle")}</h2>
          <p>{t("ui.pages.contentCreate.previewDescription")}</p>
          <div className="ui-placeholder-block" />
        </article>
      </section>
    </div>
  );
};
