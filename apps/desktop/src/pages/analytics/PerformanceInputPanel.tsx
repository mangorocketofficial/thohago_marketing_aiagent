import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AnalyticsChannelFilter } from "./useAnalyticsData";
import type { ContentMetricsInput, PublishedContentWithMetrics } from "@repo/types";
import { resolveChannelPresentation } from "../../components/scheduler/card-presentation";

const CHANNEL_FILTERS: AnalyticsChannelFilter[] = [null, "instagram", "threads", "facebook", "naver_blog", "youtube"];

const FIELD_ORDER = ["views", "likes", "comments", "shares", "saves", "follower_delta"] as const;
type MetricField = (typeof FIELD_ORDER)[number];

type DraftRow = Omit<ContentMetricsInput, "content_id">;

type PerformanceInputPanelProps = {
  publishedContents: PublishedContentWithMetrics[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  onRefreshPublished: (channel: AnalyticsChannelFilter) => Promise<void>;
  onLoadMorePublished: () => Promise<void>;
  onSubmitCompleted: () => Promise<void>;
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

const getFieldsForChannel = (channel: string): MetricField[] => {
  if (channel === "instagram") {
    return ["likes", "comments", "shares", "saves", "follower_delta"];
  }
  if (channel === "threads") {
    return ["likes", "comments", "shares", "follower_delta"];
  }
  if (channel === "facebook") {
    return ["likes", "comments", "shares"];
  }
  if (channel === "naver_blog" || channel === "youtube") {
    return ["views", "comments"];
  }
  return ["likes", "comments"];
};

const getLatestMetricValue = (item: PublishedContentWithMetrics, field: MetricField): number | null => {
  const latest = item.latest_metrics;
  if (!latest) {
    return null;
  }

  if (field === "views") {
    return item.channel === "naver_blog" || item.channel === "youtube" ? latest.likes : null;
  }
  if (field === "likes") {
    return item.channel === "naver_blog" || item.channel === "youtube" ? null : latest.likes;
  }
  if (field === "comments") {
    return latest.comments;
  }
  if (field === "shares") {
    return latest.shares;
  }
  if (field === "saves") {
    return latest.saves;
  }
  if (field === "follower_delta") {
    return latest.follower_delta;
  }
  return null;
};

const hasAnyMetric = (row: DraftRow | undefined): boolean => {
  if (!row) {
    return false;
  }
  return FIELD_ORDER.some((field) => typeof row[field] === "number" && Number.isFinite(row[field] as number));
};

const buildDeterministicRequestKey = (entries: ContentMetricsInput[]): string => {
  const serialized = entries
    .map((entry) => {
      const parts = [`content_id=${entry.content_id}`];
      for (const field of FIELD_ORDER) {
        const value = (entry as Record<string, unknown>)[field];
        if (typeof value === "number" && Number.isFinite(value)) {
          parts.push(`${field}=${value}`);
        }
      }
      return parts.join(",");
    })
    .sort()
    .join("|");

  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return `metrics_${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

export const PerformanceInputPanel = ({
  publishedContents,
  isLoading,
  isLoadingMore,
  hasMore,
  onRefreshPublished,
  onLoadMorePublished,
  onSubmitCompleted
}: PerformanceInputPanelProps) => {
  const { t } = useTranslation();
  const [channelFilter, setChannelFilter] = useState<AnalyticsChannelFilter>(null);
  const [draftByContentId, setDraftByContentId] = useState<Record<string, DraftRow>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void onRefreshPublished(channelFilter);
  }, [channelFilter, onRefreshPublished]);

  const dirtyCount = useMemo(
    () => Object.values(draftByContentId).filter((row) => hasAnyMetric(row)).length,
    [draftByContentId]
  );

  const updateField = (contentId: string, field: MetricField, rawValue: string) => {
    setDraftByContentId((previous) => {
      const base = previous[contentId] ?? {};
      const trimmed = rawValue.trim();
      const nextValue = trimmed === "" ? null : Number.parseInt(trimmed, 10);
      const nextRow: DraftRow = {
        ...base,
        [field]: Number.isFinite(nextValue) ? nextValue : null
      };

      if (!hasAnyMetric(nextRow)) {
        const { [contentId]: _unused, ...rest } = previous;
        return rest;
      }
      return {
        ...previous,
        [contentId]: nextRow
      };
    });
  };

  const handleReset = () => {
    setDraftByContentId({});
    setNotice("");
  };

  const handleSubmit = async () => {
    const entries = Object.entries(draftByContentId)
      .filter(([, row]) => hasAnyMetric(row))
      .map(([contentId, row]) => ({
        content_id: contentId,
        ...row
      })) as ContentMetricsInput[];

    if (!entries.length) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await window.desktopRuntime.metrics.submitBatch({
        entries,
        requestIdempotencyKey: buildDeterministicRequestKey(entries)
      });

      if (!response.ok) {
        setNotice(response.message ?? t("ui.pages.analytics.input.partialFailure", { saved: 0, failed: entries.length }));
        return;
      }

      if (response.failed > 0) {
        setNotice(t("ui.pages.analytics.input.partialFailure", { saved: response.saved, failed: response.failed }));
      } else {
        setNotice(t("ui.pages.analytics.input.successMessage", { saved: response.saved }));
        setDraftByContentId({});
      }

      if (response.saved > 0) {
        await onSubmitCompleted();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="panel ui-page-panel">
      <p className="eyebrow">{t("ui.pages.analytics.input.eyebrow")}</p>
      <h2>{t("ui.pages.analytics.input.title")}</h2>
      <p className="sub-description">{t("ui.pages.analytics.input.description")}</p>

      <div className="ui-analytics-filter-row">
        {CHANNEL_FILTERS.map((filter) => {
          const key = filter ?? "all";
          const label =
            filter === null
              ? t("ui.pages.analytics.input.channelFilterAll")
              : resolveChannelPresentation(filter).label;
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

      {isLoading ? <p className="empty">{t("ui.pages.analytics.input.loading")}</p> : null}
      {!isLoading && publishedContents.length === 0 ? <p className="empty">{t("ui.pages.analytics.input.empty")}</p> : null}

      {!isLoading && publishedContents.length > 0 ? (
        <div className="ui-metrics-content-list">
          {publishedContents.map((item) => {
            const fields = getFieldsForChannel(item.channel);
            const draftRow = draftByContentId[item.id] ?? {};
            const scoreText =
              typeof item.latest_metrics?.performance_score === "number"
                ? item.latest_metrics.performance_score.toFixed(2)
                : t("ui.pages.analytics.score.notAvailable");

            return (
              <article key={item.id} className="ui-metrics-row">
                <div className="ui-metrics-content-preview">
                  <p className="ui-metrics-channel">
                    {resolveChannelPresentation(item.channel).label}
                  </p>
                  <p className="ui-metrics-content-body">{item.body?.trim() || t("ui.common.notAvailable")}</p>
                  <p className="meta">{formatDateTime(item.published_at)}</p>
                  <span className="ui-metrics-score-badge">
                    {t("ui.pages.analytics.score.label")}: {scoreText}
                  </span>
                </div>

                <div className="ui-metrics-inputs">
                  {fields.map((field) => (
                    <div key={`${item.id}:${field}`} className="ui-metrics-field">
                      <label htmlFor={`${item.id}:${field}`}>{t(`ui.pages.analytics.input.fields.${field}`)}</label>
                      <input
                        id={`${item.id}:${field}`}
                        type="number"
                        min={field === "follower_delta" ? undefined : 0}
                        value={typeof draftRow[field] === "number" ? String(draftRow[field]) : ""}
                        placeholder={
                          getLatestMetricValue(item, field) !== null
                            ? String(getLatestMetricValue(item, field))
                            : ""
                        }
                        onChange={(event) => updateField(item.id, field, event.target.value)}
                      />
                    </div>
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
            {isLoadingMore ? t("ui.pages.analytics.input.loading") : t("ui.pages.analytics.input.loadMore")}
          </button>
        </div>
      ) : null}

      <div className="ui-metrics-submit-bar">
        <p className="meta">{t("ui.pages.analytics.input.dirtyCount", { count: dirtyCount })}</p>
        <button type="button" onClick={handleReset} disabled={isSubmitting || dirtyCount === 0}>
          {t("ui.pages.analytics.input.resetButton")}
        </button>
        <button type="button" className="primary" onClick={() => void handleSubmit()} disabled={isSubmitting || dirtyCount === 0}>
          {isSubmitting ? t("ui.pages.analytics.input.submitting") : t("ui.pages.analytics.input.submitButton")}
        </button>
      </div>

      {notice ? <p className="notice">{notice}</p> : null}
    </section>
  );
};
