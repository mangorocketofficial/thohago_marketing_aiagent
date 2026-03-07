import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AccumulatedInsights } from "@repo/types";
import { resolveChannelPresentation } from "../../components/scheduler/card-presentation";
import { extractKeyCountEntries } from "./insights-parser";

const CHANNEL_ORDER = ["naver_blog", "instagram", "youtube", "facebook", "threads"] as const;

type InsightsPanelProps = {
  insights: AccumulatedInsights | null;
  updatedAt: string | null;
  isLoading: boolean;
  onRefresh: () => void;
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

const toOrderedChannels = (channels: string[]): string[] => {
  const known = new Set(CHANNEL_ORDER as readonly string[]);
  const set = new Set(channels.map((channel) => channel.trim().toLowerCase()).filter(Boolean));
  const ordered = CHANNEL_ORDER.filter((channel) => set.has(channel));
  const extras = [...set].filter((channel) => !known.has(channel)).sort((a, b) => a.localeCompare(b));
  return [...ordered, ...extras];
};

export const InsightsPanel = ({ insights, updatedAt, isLoading, onRefresh }: InsightsPanelProps) => {
  const { t } = useTranslation();

  const channels = useMemo(() => {
    if (!insights) {
      return [];
    }
    return toOrderedChannels([...Object.keys(insights.best_publish_times), ...Object.keys(insights.channel_recommendations)]);
  }, [insights]);

  const channelCounts = useMemo(() => {
    if (!insights) {
      return new Map<string, number>();
    }
    return new Map(extractKeyCountEntries(insights.content_pattern_summary).map((entry) => [entry.key, entry.count]));
  }, [insights]);

  const editPreferenceCounts = useMemo(() => {
    if (!insights) {
      return [];
    }
    return extractKeyCountEntries(insights.user_edit_preference_summary);
  }, [insights]);

  return (
    <>
      <section className="panel ui-page-panel">
        <div className="ui-meta-row">
          <p className="meta">
            {t("ui.pages.analytics.generatedAtLabel")}:{" "}
            <strong>{formatDateTime(insights?.generated_at ?? updatedAt)}</strong>
          </p>
          <button type="button" onClick={onRefresh} disabled={isLoading}>
            {t("ui.common.refresh")}
          </button>
        </div>
      </section>

      {isLoading ? (
        <section className="panel ui-page-panel">
          <p className="empty">{t("ui.pages.analytics.input.loading")}</p>
        </section>
      ) : !insights ? (
        <section className="panel ui-page-panel">
          <p className="empty">{t("ui.pages.analytics.input.noMetrics")}</p>
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
              <p className="ui-insight-summary">
                {insights.user_edit_preference_summary || t("ui.common.notAvailable")}
              </p>
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
        </>
      )}
    </>
  );
};

