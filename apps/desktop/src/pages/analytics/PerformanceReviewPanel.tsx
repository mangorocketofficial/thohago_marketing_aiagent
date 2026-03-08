import { useEffect, useMemo, useState } from "react";
import { ANALYTICS_CHANNEL_DISPLAY_ORDER, getMetricFieldsForChannel, readMetricValue } from "@repo/analytics";
import type { PublishedContentWithMetrics } from "@repo/types";
import { useTranslation } from "react-i18next";
import { resolveChannelPresentation } from "../../components/scheduler/card-presentation";
import type { AnalyticsChannelFilter, AnalyticsReadSource } from "./useAnalyticsData";

type PerformanceReviewPanelProps = {
  publishedContents: PublishedContentWithMetrics[];
  source: AnalyticsReadSource;
  notice: string;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  onRefreshPublished: (channel: AnalyticsChannelFilter) => Promise<void>;
  onLoadMorePublished: () => Promise<void>;
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
  hasCollectedMetrics: boolean,
  notice: string,
  t: ReturnType<typeof useTranslation>["t"]
): string => {
  if (source === "error") {
    return notice || t("ui.pages.analytics.source.error");
  }
  if (source === "empty") {
    return t("ui.pages.analytics.source.empty");
  }
  if (!hasCollectedMetrics) {
    return t("ui.pages.analytics.source.apiPending");
  }
  return t("ui.pages.analytics.source.live");
};

export const PerformanceReviewPanel = ({
  publishedContents,
  source,
  notice,
  isLoading,
  isLoadingMore,
  hasMore,
  onRefreshPublished,
  onLoadMorePublished
}: PerformanceReviewPanelProps) => {
  const { t } = useTranslation();
  const [channelFilter, setChannelFilter] = useState<AnalyticsChannelFilter>(null);

  useEffect(() => {
    void onRefreshPublished(channelFilter);
  }, [channelFilter, onRefreshPublished]);

  const summaryRows = useMemo(() => {
    const byChannel = new Map<string, { count: number; scored: number; scoreSum: number }>();
    for (const item of publishedContents) {
      const key = item.channel;
      const score = item.latest_metrics?.performance_score;
      const row = byChannel.get(key) ?? { count: 0, scored: 0, scoreSum: 0 };
      row.count += 1;
      if (typeof score === "number" && Number.isFinite(score)) {
        row.scored += 1;
        row.scoreSum += score;
      }
      byChannel.set(key, row);
    }

    return [...byChannel.entries()]
      .sort(
        (left, right) =>
          ANALYTICS_CHANNEL_DISPLAY_ORDER.indexOf(left[0] as (typeof ANALYTICS_CHANNEL_DISPLAY_ORDER)[number]) -
          ANALYTICS_CHANNEL_DISPLAY_ORDER.indexOf(right[0] as (typeof ANALYTICS_CHANNEL_DISPLAY_ORDER)[number])
      )
      .map(([channel, row]) => ({
        channel,
        count: row.count,
        avgScore: row.scored > 0 ? row.scoreSum / row.scored : null
      }));
  }, [publishedContents]);

  const hasCollectedMetrics = useMemo(
    () => publishedContents.some((item) => item.latest_metrics !== null),
    [publishedContents]
  );

  return (
    <section className="panel ui-page-panel">
      <p className="eyebrow">{t("ui.pages.analytics.review.eyebrow")}</p>
      <h2>{t("ui.pages.analytics.review.title")}</h2>
      <p className="sub-description">{t("ui.pages.analytics.review.description")}</p>
      <p className={`ui-analytics-source-banner ${source}`}>{buildBannerText(source, hasCollectedMetrics, notice, t)}</p>

      <div className="ui-analytics-filter-row">
        {[null, ...ANALYTICS_CHANNEL_DISPLAY_ORDER].map((filter) => {
          const key = filter ?? "all";
          const label = filter === null ? t("ui.pages.analytics.review.channelFilterAll") : resolveChannelPresentation(filter).label;
          return (
            <button
              key={key}
              type="button"
              className={`ui-analytics-filter-chip ${channelFilter === filter ? "active" : ""}`}
              onClick={() => setChannelFilter(filter)}
            >
              {label}
            </button>
          );
        })}
      </div>

      {summaryRows.length > 0 ? (
        <div className="table-wrap ui-insight-table-wrap">
          <table className="ui-insight-table">
            <thead>
              <tr>
                <th>{t("ui.pages.analytics.review.summary.channel")}</th>
                <th>{t("ui.pages.analytics.review.summary.contents")}</th>
                <th>{t("ui.pages.analytics.review.summary.avgScore")}</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.map((row) => (
                <tr key={row.channel}>
                  <td>{resolveChannelPresentation(row.channel).label}</td>
                  <td>{row.count.toLocaleString()}</td>
                  <td>{typeof row.avgScore === "number" ? row.avgScore.toFixed(2) : t("ui.common.notAvailable")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {isLoading ? <p className="empty">{t("ui.pages.analytics.review.loading")}</p> : null}
      {!isLoading && source !== "error" && publishedContents.length === 0 ? (
        <p className="empty">{t("ui.pages.analytics.review.empty")}</p>
      ) : null}

      {!isLoading && publishedContents.length > 0 ? (
        <div className="ui-metrics-content-list">
          {publishedContents.map((item) => {
            const fields = getMetricFieldsForChannel(item.channel);
            const scoreText =
              typeof item.latest_metrics?.performance_score === "number"
                ? item.latest_metrics.performance_score.toFixed(2)
                : t("ui.pages.analytics.score.notAvailable");

            return (
              <article key={item.id} className="ui-metrics-row">
                <div className="ui-metrics-content-preview">
                  <p className="ui-metrics-channel">{resolveChannelPresentation(item.channel).label}</p>
                  <p className="ui-metrics-content-body">{item.body?.trim() || t("ui.common.notAvailable")}</p>
                  <p className="meta">{formatDateTime(item.published_at)}</p>
                  <span className="ui-metrics-score-badge">
                    {t("ui.pages.analytics.score.label")}: {scoreText}
                  </span>
                </div>
                <div className="ui-metrics-values">
                  {fields.map((field) => (
                    <span key={`${item.id}:${field}`} className="ui-metrics-value">
                      {t(`ui.pages.analytics.metrics.fields.${field}`)}:{" "}
                      {readMetricValue(item.latest_metrics, field)?.toLocaleString() ?? t("ui.common.notAvailable")}
                    </span>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {hasMore ? (
        <div className="button-row">
          <button type="button" onClick={() => void onLoadMorePublished()} disabled={isLoadingMore}>
            {isLoadingMore ? t("ui.pages.analytics.review.loading") : t("ui.pages.analytics.review.loadMore")}
          </button>
        </div>
      ) : null}
    </section>
  );
};
