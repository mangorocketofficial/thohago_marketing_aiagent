import { useCallback, useEffect, useState } from "react";
import { parseAccumulatedInsights } from "@repo/analytics";
import type { AccumulatedInsights, AnalysisReportRecord, Channel, PublishedContentWithMetrics } from "@repo/types";

const PAGE_SIZE = 20;

export type AnalyticsChannelFilter = Channel | null;
export type AnalyticsReadSource = "live" | "empty" | "error";

type UseAnalyticsDataArgs = {
  orgId: string | null;
};

export const useAnalyticsData = ({ orgId }: UseAnalyticsDataArgs) => {
  const [insights, setInsights] = useState<AccumulatedInsights | null>(null);
  const [insightsUpdatedAt, setInsightsUpdatedAt] = useState<string | null>(null);
  const [publishedContents, setPublishedContents] = useState<PublishedContentWithMetrics[]>([]);
  const [publishedNextCursor, setPublishedNextCursor] = useState<string | null>(null);
  const [publishedFilter, setPublishedFilter] = useState<AnalyticsChannelFilter>(null);
  const [isLoadingInsights, setIsLoadingInsights] = useState(false);
  const [isLoadingPublished, setIsLoadingPublished] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [insightsSource, setInsightsSource] = useState<AnalyticsReadSource>("empty");
  const [publishedSource, setPublishedSource] = useState<AnalyticsReadSource>("empty");
  const [insightsNotice, setInsightsNotice] = useState("");
  const [publishedNotice, setPublishedNotice] = useState("");
  const [latestReport, setLatestReport] = useState<AnalysisReportRecord | null>(null);
  const [latestReportNotice, setLatestReportNotice] = useState("");
  const [isLoadingLatestReport, setIsLoadingLatestReport] = useState(false);
  const [isTriggeringAnalysis, setIsTriggeringAnalysis] = useState(false);

  const refreshInsights = useCallback(async () => {
    if (!orgId) {
      setInsights(null);
      setInsightsUpdatedAt(null);
      setInsightsSource("empty");
      setInsightsNotice("");
      return;
    }

    setIsLoadingInsights(true);
    try {
      const response = await window.desktopRuntime.metrics.getInsights();
      if (!response.ok) {
        setInsights(null);
        setInsightsUpdatedAt(null);
        setInsightsSource("error");
        setInsightsNotice(response.message ?? "Failed to load analytics insights.");
        return;
      }

      const parsed = parseAccumulatedInsights(response.insights);
      setInsights(parsed);
      setInsightsUpdatedAt(response.updated_at);
      setInsightsSource(response.source === "live" && parsed ? "live" : "empty");
      setInsightsNotice("");
    } finally {
      setIsLoadingInsights(false);
    }
  }, [orgId]);

  const refreshPublished = useCallback(async (channel: AnalyticsChannelFilter = null) => {
    if (!orgId) {
      setPublishedContents([]);
      setPublishedNextCursor(null);
      setPublishedFilter(channel);
      setPublishedSource("empty");
      setPublishedNotice("");
      return;
    }

    setIsLoadingPublished(true);
    setPublishedFilter(channel);
    try {
      const response = await window.desktopRuntime.metrics.listPublishedWithMetrics({
        channel: channel ?? undefined,
        limit: PAGE_SIZE,
        cursor: null
      });

      if (!response.ok) {
        setPublishedContents([]);
        setPublishedNextCursor(null);
        setPublishedSource("error");
        setPublishedNotice(response.message ?? "Failed to load published contents.");
        return;
      }

      setPublishedContents(response.items);
      setPublishedNextCursor(response.next_cursor);
      setPublishedSource(response.items.length > 0 ? "live" : "empty");
      setPublishedNotice("");
    } finally {
      setIsLoadingPublished(false);
    }
  }, [orgId]);

  const refreshLatestReport = useCallback(async () => {
    if (!orgId) {
      setLatestReport(null);
      setLatestReportNotice("");
      return;
    }

    setIsLoadingLatestReport(true);
    try {
      const response = await window.desktopRuntime.metrics.getLatestAnalysisReport();
      if (!response.ok) {
        setLatestReport(null);
        setLatestReportNotice(response.message ?? "Failed to load latest analysis report.");
        return;
      }

      setLatestReport(response.report);
      setLatestReportNotice("");
    } finally {
      setIsLoadingLatestReport(false);
    }
  }, [orgId]);

  const triggerAnalysis = useCallback(async () => {
    if (!orgId) {
      return;
    }

    setIsTriggeringAnalysis(true);
    try {
      const response = await window.desktopRuntime.metrics.triggerAnalysis();
      setLatestReportNotice(response.message ?? "");
      if (response.queued === false) {
        await refreshLatestReport();
      }
    } finally {
      setIsTriggeringAnalysis(false);
    }
  }, [orgId, refreshLatestReport]);

  const loadMorePublished = useCallback(async () => {
    if (!publishedNextCursor) {
      return;
    }

    setIsLoadingMore(true);
    try {
      const response = await window.desktopRuntime.metrics.listPublishedWithMetrics({
        channel: publishedFilter ?? undefined,
        limit: PAGE_SIZE,
        cursor: publishedNextCursor
      });
      if (!response.ok) {
        setPublishedSource("error");
        setPublishedNotice(response.message ?? "Failed to load more published contents.");
        return;
      }

      setPublishedContents((previous) => {
        const byId = new Map<string, PublishedContentWithMetrics>();
        for (const row of previous) {
          byId.set(row.id, row);
        }
        for (const row of response.items) {
          byId.set(row.id, row);
        }
        return [...byId.values()];
      });
      setPublishedNextCursor(response.next_cursor);
      setPublishedSource("live");
      setPublishedNotice("");
    } finally {
      setIsLoadingMore(false);
    }
  }, [publishedFilter, publishedNextCursor]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshInsights(), refreshPublished(publishedFilter), refreshLatestReport()]);
  }, [publishedFilter, refreshInsights, refreshLatestReport, refreshPublished]);

  useEffect(() => {
    void refreshInsights();
    void refreshPublished(null);
    void refreshLatestReport();
  }, [orgId, refreshInsights, refreshLatestReport, refreshPublished]);

  return {
    insights,
    insightsUpdatedAt,
    insightsSource,
    insightsNotice,
    publishedContents,
    publishedSource,
    publishedNotice,
    latestReport,
    latestReportNotice,
    isLoadingInsights,
    isLoadingPublished,
    isLoadingLatestReport,
    isLoadingMore,
    isTriggeringAnalysis,
    hasMorePublished: !!publishedNextCursor,
    publishedFilter,
    refreshInsights,
    refreshPublished,
    refreshLatestReport,
    loadMorePublished,
    refreshAll,
    triggerAnalysis
  };
};
