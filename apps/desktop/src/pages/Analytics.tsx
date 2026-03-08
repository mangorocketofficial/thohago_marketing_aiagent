import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FixtureValidationPanel } from "./analytics/FixtureValidationPanel";
import { InsightsPanel } from "./analytics/InsightsPanel";
import { PerformanceReviewPanel } from "./analytics/PerformanceReviewPanel";
import { useAnalyticsData } from "./analytics/useAnalyticsData";

type AnalyticsPageProps = {
  orgId: string | null;
};

export const AnalyticsPage = ({ orgId }: AnalyticsPageProps) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"insights" | "review" | "fixture">("review");
  const {
    insights,
    insightsUpdatedAt,
    insightsSource,
    insightsNotice,
    publishedContents,
    publishedSource,
    publishedNotice,
    isLoadingInsights,
    isLoadingPublished,
    isLoadingMore,
    hasMorePublished,
    refreshInsights,
    refreshPublished,
    loadMorePublished
  } = useAnalyticsData({ orgId });

  return (
    <div className="app-shell ui-page-shell">
      <section className="panel ui-page-panel">
        <p className="eyebrow">{t("ui.pages.analytics.eyebrow")}</p>
        <h1>{t("ui.pages.analytics.title")}</h1>
        <p className="description">{t("ui.pages.analytics.description")}</p>
        <div className="ui-analytics-tab-row">
          <button
            type="button"
            className={`ui-analytics-tab ${tab === "review" ? "active" : ""}`}
            onClick={() => setTab("review")}
          >
            {t("ui.pages.analytics.tabs.review")}
          </button>
          <button
            type="button"
            className={`ui-analytics-tab ${tab === "insights" ? "active" : ""}`}
            onClick={() => setTab("insights")}
          >
            {t("ui.pages.analytics.tabs.insights")}
          </button>
          <button
            type="button"
            className={`ui-analytics-tab ${tab === "fixture" ? "active" : ""}`}
            onClick={() => setTab("fixture")}
          >
            {t("ui.pages.analytics.tabs.fixture")}
          </button>
        </div>
      </section>

      {tab === "insights" ? (
        <InsightsPanel
          insights={insights}
          updatedAt={insightsUpdatedAt}
          source={insightsSource}
          notice={insightsNotice}
          isLoading={isLoadingInsights}
          onRefresh={() => {
            void refreshInsights();
          }}
        />
      ) : tab === "review" ? (
        <PerformanceReviewPanel
          publishedContents={publishedContents}
          source={publishedSource}
          notice={publishedNotice}
          isLoading={isLoadingPublished}
          isLoadingMore={isLoadingMore}
          hasMore={hasMorePublished}
          onRefreshPublished={refreshPublished}
          onLoadMorePublished={loadMorePublished}
        />
      ) : (
        <FixtureValidationPanel />
      )}
    </div>
  );
};
