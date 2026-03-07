import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useTranslation } from "react-i18next";
import { InsightsPanel } from "./analytics/InsightsPanel";
import { PerformanceInputPanel } from "./analytics/PerformanceInputPanel";
import { useAnalyticsData } from "./analytics/useAnalyticsData";

type AnalyticsPageProps = {
  supabase: SupabaseClient | null;
  orgId: string | null;
};

export const AnalyticsPage = ({ supabase, orgId }: AnalyticsPageProps) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"insights" | "input">("insights");
  const {
    insights,
    insightsUpdatedAt,
    publishedContents,
    isLoadingInsights,
    isLoadingPublished,
    isLoadingMore,
    hasMorePublished,
    notice,
    refreshInsights,
    refreshPublished,
    loadMorePublished,
    refreshAll
  } = useAnalyticsData({ supabase, orgId });

  return (
    <div className="app-shell ui-page-shell">
      <section className="panel ui-page-panel">
        <p className="eyebrow">{t("ui.pages.analytics.eyebrow")}</p>
        <h1>{t("ui.pages.analytics.title")}</h1>
        <p className="description">{t("ui.pages.analytics.description")}</p>
        <div className="ui-analytics-tab-row">
          <button
            type="button"
            className={`ui-analytics-tab ${tab === "insights" ? "active" : ""}`}
            onClick={() => setTab("insights")}
          >
            {t("ui.pages.analytics.tabs.insights")}
          </button>
          <button
            type="button"
            className={`ui-analytics-tab ${tab === "input" ? "active" : ""}`}
            onClick={() => setTab("input")}
          >
            {t("ui.pages.analytics.tabs.input")}
          </button>
        </div>
      </section>

      {tab === "insights" ? (
        <InsightsPanel
          insights={insights}
          updatedAt={insightsUpdatedAt}
          isLoading={isLoadingInsights}
          onRefresh={() => {
            void refreshInsights();
          }}
        />
      ) : (
        <PerformanceInputPanel
          publishedContents={publishedContents}
          isLoading={isLoadingPublished}
          isLoadingMore={isLoadingMore}
          hasMore={hasMorePublished}
          onRefreshPublished={refreshPublished}
          onLoadMorePublished={loadMorePublished}
          onSubmitCompleted={async () => {
            await refreshAll();
            setTab("insights");
          }}
        />
      )}

      {notice ? <p className="notice">{notice}</p> : null}
    </div>
  );
};

