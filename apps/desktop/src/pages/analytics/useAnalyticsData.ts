import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccumulatedInsights, Channel, PublishedContentWithMetrics } from "@repo/types";

const PAGE_SIZE = 20;

export type AnalyticsChannelFilter = Channel | null;

type UseAnalyticsDataArgs = {
  supabase: SupabaseClient | null;
  orgId: string | null;
};

type InsightsRow = {
  accumulated_insights: unknown;
  updated_at: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const parseInsights = (value: unknown): AccumulatedInsights | null => {
  if (!isRecord(value) || typeof value.generated_at !== "string" || !value.generated_at.trim()) {
    return null;
  }

  return {
    best_publish_times: isRecord(value.best_publish_times)
      ? Object.fromEntries(
          Object.entries(value.best_publish_times)
            .map(([key, row]) => [key, typeof row === "string" ? row : ""])
            .filter(([, row]) => !!row)
        )
      : {},
    top_cta_phrases: Array.isArray(value.top_cta_phrases)
      ? value.top_cta_phrases.map((row) => (typeof row === "string" ? row.trim() : "")).filter(Boolean)
      : [],
    content_pattern_summary: typeof value.content_pattern_summary === "string" ? value.content_pattern_summary : "",
    channel_recommendations: isRecord(value.channel_recommendations)
      ? Object.fromEntries(
          Object.entries(value.channel_recommendations)
            .map(([key, row]) => [key, typeof row === "string" ? row : ""])
            .filter(([, row]) => !!row)
        )
      : {},
    user_edit_preference_summary:
      typeof value.user_edit_preference_summary === "string" ? value.user_edit_preference_summary : "",
    generated_at: value.generated_at,
    content_count_at_generation:
      typeof value.content_count_at_generation === "number" && Number.isFinite(value.content_count_at_generation)
        ? Math.max(0, Math.floor(value.content_count_at_generation))
        : 0
  };
};

export const useAnalyticsData = ({ supabase, orgId }: UseAnalyticsDataArgs) => {
  const [insights, setInsights] = useState<AccumulatedInsights | null>(null);
  const [insightsUpdatedAt, setInsightsUpdatedAt] = useState<string | null>(null);
  const [publishedContents, setPublishedContents] = useState<PublishedContentWithMetrics[]>([]);
  const [publishedNextCursor, setPublishedNextCursor] = useState<string | null>(null);
  const [publishedFilter, setPublishedFilter] = useState<AnalyticsChannelFilter>(null);
  const [isLoadingInsights, setIsLoadingInsights] = useState(false);
  const [isLoadingPublished, setIsLoadingPublished] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [notice, setNotice] = useState("");

  const refreshInsights = useCallback(async () => {
    if (!supabase || !orgId) {
      setInsights(null);
      setInsightsUpdatedAt(null);
      return;
    }

    setIsLoadingInsights(true);
    try {
      const { data, error } = await supabase
        .from("org_brand_settings")
        .select("accumulated_insights,updated_at")
        .eq("org_id", orgId)
        .maybeSingle();
      if (error) {
        setNotice(error.message);
        return;
      }

      const row = (data ?? null) as InsightsRow | null;
      setInsights(parseInsights(row?.accumulated_insights));
      setInsightsUpdatedAt(row?.updated_at ?? null);
    } finally {
      setIsLoadingInsights(false);
    }
  }, [orgId, supabase]);

  const refreshPublished = useCallback(async (channel: AnalyticsChannelFilter = null) => {
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
        setNotice(response.message ?? "Failed to load published contents.");
        return;
      }

      setPublishedContents(response.items);
      setPublishedNextCursor(response.next_cursor);
      setNotice("");
    } finally {
      setIsLoadingPublished(false);
    }
  }, []);

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
        setNotice(response.message ?? "Failed to load more published contents.");
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
    } finally {
      setIsLoadingMore(false);
    }
  }, [publishedFilter, publishedNextCursor]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshInsights(), refreshPublished(publishedFilter)]);
  }, [publishedFilter, refreshInsights, refreshPublished]);

  useEffect(() => {
    void refreshInsights();
    void refreshPublished(null);
  }, [orgId, supabase, refreshInsights, refreshPublished]);

  return {
    insights,
    insightsUpdatedAt,
    publishedContents,
    isLoadingInsights,
    isLoadingPublished,
    isLoadingMore,
    hasMorePublished: !!publishedNextCursor,
    publishedFilter,
    notice,
    refreshInsights,
    refreshPublished,
    loadMorePublished,
    refreshAll
  };
};

