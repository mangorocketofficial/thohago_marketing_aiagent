import { extractKeyCountEntries, toOrderedAnalyticsChannels } from "@repo/analytics";
import type { AccumulatedInsights, AnalysisReportRecord } from "@repo/types";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { resolveChannelPresentation } from "../../components/scheduler/card-presentation";
import { AnalysisReportCard } from "./AnalysisReportCard";
import type { AnalyticsReadSource } from "./useAnalyticsData";

type InsightsPanelProps = {
  insights: AccumulatedInsights | null;
  updatedAt: string | null;
  source: AnalyticsReadSource;
  notice: string;
  isLoading: boolean;
  latestReport: AnalysisReportRecord | null;
  latestReportNotice: string;
  isLoadingLatestReport: boolean;
  isTriggeringAnalysis: boolean;
  onRefresh: () => void;
  onTriggerAnalysis: () => void;
};

const formatDateTime = (value: string | null): string => {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
};

const buildBannerText = (
  source: AnalyticsReadSource,
  notice: string,
  t: ReturnType<typeof useTranslation>["t"]
): string => {
  if (source === "error") {
    return notice || t("ui.pages.analytics.source.error");
  }
  if (source === "empty") {
    return t("ui.pages.analytics.source.empty");
  }
  return t("ui.pages.analytics.source.live");
};

export const InsightsPanel = ({
  insights,
  updatedAt,
  source,
  notice,
  isLoading,
  latestReport,
  latestReportNotice,
  isLoadingLatestReport,
  isTriggeringAnalysis,
  onRefresh,
  onTriggerAnalysis
}: InsightsPanelProps) => {
  const { t } = useTranslation();

  const channels = useMemo(() => {
    if (!insights) {
      return [];
    }
    return toOrderedAnalyticsChannels([
      ...Object.keys(insights.best_publish_times),
      ...Object.keys(insights.channel_recommendations)
    ]);
  }, [insights]);

  const channelCounts = useMemo(() => {
    return new Map(extractKeyCountEntries(insights?.content_pattern_summary ?? "").map((entry) => [entry.key, entry.count]));
  }, [insights]);

  const editPreferenceCounts = useMemo(() => {
    return extractKeyCountEntries(insights?.user_edit_preference_summary ?? "");
  }, [insights]);

  const recommendationChannels = useMemo(() => {
    return toOrderedAnalyticsChannels(Object.keys(insights?.channel_recommendations ?? {}));
  }, [insights]);

  return (
    <>
      <section className="panel ui-page-panel">
        <div className="ui-meta-row">
          <p className="meta">
            {t("ui.pages.analytics.generatedAtLabel")}: <strong>{formatDateTime(insights?.generated_at ?? updatedAt)}</strong>
          </p>
          <button type="button" onClick={onRefresh} disabled={isLoading}>
            {t("ui.common.refresh")}
          </button>
        </div>
        <p className={`ui-analytics-source-banner ${source}`}>{buildBannerText(source, notice, t)}</p>
      </section>

      <AnalysisReportCard
        report={latestReport}
        notice={latestReportNotice}
        isLoading={isLoadingLatestReport}
        isTriggering={isTriggeringAnalysis}
        onTriggerAnalysis={onTriggerAnalysis}
      />

      {isLoading ? (
        <section className="panel ui-page-panel">
          <p className="empty">{t("ui.pages.analytics.insights.loading")}</p>
        </section>
      ) : !insights ? (
        <section className="panel ui-page-panel">
          <p className="empty">{t("ui.pages.analytics.insights.empty")}</p>
        </section>
      ) : (
        <>
          <section className="panel ui-page-panel ui-grid-3">
            <article className="ui-insight-stat-card">
              <p className="ui-insight-stat-label">{t("ui.pages.analytics.metricTotalContents")}</p>
              <p className="ui-insight-stat-value">{insights.content_count_at_generation.toLocaleString()}</p>
            </article>
            <article className="ui-insight-stat-card">
              <p className="ui-insight-stat-label">{t("ui.pages.analytics.metricTrackedChannels")}</p>
              <p className="ui-insight-stat-value">{channels.length.toLocaleString()}</p>
            </article>
            <article className="ui-insight-stat-card">
              <p className="ui-insight-stat-label">{t("ui.pages.analytics.metricTopCtaCount")}</p>
              <p className="ui-insight-stat-value">{insights.top_cta_phrases.length.toLocaleString()}</p>
            </article>
          </section>

          <section className="panel ui-page-panel ui-grid-2">
            <article className="ui-insight-card">
              <h2>{t("ui.pages.analytics.bestPublishTimesTitle")}</h2>
              <div className="table-wrap ui-insight-table-wrap">
                <table className="ui-insight-table">
                  <thead>
                    <tr>
                      <th>{t("ui.pages.analytics.table.channel")}</th>
                      <th>{t("ui.pages.analytics.table.bestTime")}</th>
                      <th>{t("ui.pages.analytics.table.contentCount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {channels.length === 0 ? (
                      <tr>
                        <td colSpan={3}>{t("ui.pages.analytics.channelRecommendationEmpty")}</td>
                      </tr>
                    ) : (
                      channels.map((channel) => (
                        <tr key={channel}>
                          <td>{resolveChannelPresentation(channel).label}</td>
                          <td>{insights.best_publish_times[channel] ?? t("ui.common.notAvailable")}</td>
                          <td>{channelCounts.get(channel)?.toLocaleString() ?? t("ui.common.notAvailable")}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="ui-insight-card">
              <h2>{t("ui.pages.analytics.topCtaTitle")}</h2>
              {insights.top_cta_phrases.length === 0 ? (
                <p className="empty">{t("ui.pages.analytics.channelRecommendationEmpty")}</p>
              ) : (
                <ol className="ui-insight-list">
                  {insights.top_cta_phrases.map((phrase) => (
                    <li key={phrase}>{phrase}</li>
                  ))}
                </ol>
              )}
            </article>
          </section>

          <section className="panel ui-page-panel ui-grid-2">
            <article className="ui-insight-card">
              <h2>{t("ui.pages.analytics.contentPatternTitle")}</h2>
              <p className="ui-insight-summary">{insights.content_pattern_summary || t("ui.common.notAvailable")}</p>
            </article>
            <article className="ui-insight-card">
              <h2>{t("ui.pages.analytics.userPreferenceTitle")}</h2>
              <p className="ui-insight-summary">{insights.user_edit_preference_summary || t("ui.common.notAvailable")}</p>
              {editPreferenceCounts.length > 0 ? (
                <div className="ui-insight-chip-row">
                  {editPreferenceCounts.map((entry) => (
                    <span key={entry.key} className="ui-insight-chip">
                      {entry.key}: {entry.count.toLocaleString()}
                    </span>
                  ))}
                </div>
              ) : null}
            </article>
          </section>

          <section className="panel ui-page-panel">
            <h2>{t("ui.pages.analytics.channelRecommendationsTitle")}</h2>
            {recommendationChannels.length === 0 ? (
              <p className="empty">{t("ui.pages.analytics.channelRecommendationEmpty")}</p>
            ) : (
              <div className="ui-insight-recommendation-grid">
                {recommendationChannels.map((channel) => (
                  <article key={channel} className="ui-insight-card ui-insight-recommendation-card">
                    <div className="ui-insight-recommendation-head">
                      <h3>{resolveChannelPresentation(channel).label}</h3>
                      <span className="ui-insight-pill">{channelCounts.get(channel) ?? 0}</span>
                    </div>
                    <p>{insights.channel_recommendations[channel]}</p>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
};
