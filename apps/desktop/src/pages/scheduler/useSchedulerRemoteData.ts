import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildDateWindow,
  normalizeDateKey,
  resolveLocalTimezone,
  shiftCurrentDateKey,
  todayDateKeyInTimezone,
  type SchedulerViewMode
} from "../../components/scheduler/date-window";
import type { SchedulerFilterState } from "../../components/scheduler/SchedulerFilters";
import {
  FILTER_DEBOUNCE_MS,
  SOFT_REFETCH_MS,
  asString,
  type ScheduledContentItem,
  type ScheduledContentPayload
} from "./scheduler-helpers";
import { useSchedulerRealtimeSync } from "./useSchedulerRealtimeSync";

type CampaignSummariesResult = Awaited<ReturnType<Window["desktopRuntime"]["chat"]["listActiveCampaignSummaries"]>>["items"];

export type SchedulerRemoteData = {
  viewMode: SchedulerViewMode;
  currentDateKey: string;
  todayDateKey: string;
  filters: SchedulerFilterState;
  activeWindow: { startDate: string; endDate: string };
  scheduledItems: ScheduledContentItem[];
  campaignSummaries: CampaignSummariesResult;
  scheduleNotice: string;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  nextCursor: string | null;
  isOffline: boolean;
  connectionState: "online" | "reconnecting" | "offline";
  setViewMode: (next: SchedulerViewMode) => void;
  shiftCurrentDate: (direction: "prev" | "next") => void;
  jumpToToday: () => void;
  setFilters: (next: SchedulerFilterState) => void;
  loadMore: () => Promise<void>;
  refreshNow: () => Promise<void>;
};

export const useSchedulerRemoteData = (refreshTriggerKey: number): SchedulerRemoteData => {
  const localTimezone = useMemo(() => resolveLocalTimezone(), []);
  const todayDateKey = useMemo(() => todayDateKeyInTimezone(localTimezone), [localTimezone]);

  const [viewMode, setViewMode] = useState<SchedulerViewMode>("week");
  const [currentDateKey, setCurrentDateKey] = useState(todayDateKey);
  const [filters, setFilters] = useState<SchedulerFilterState>({
    campaignId: "all",
    channel: "all",
    status: "all"
  });
  const [scheduledItems, setScheduledItems] = useState<ScheduledContentItem[]>([]);
  const [campaignSummaries, setCampaignSummaries] = useState<CampaignSummariesResult>([]);
  const [scheduleNotice, setScheduleNotice] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isOffline, setIsOffline] = useState<boolean>(typeof navigator !== "undefined" ? !navigator.onLine : false);

  const activeWindow = useMemo(() => buildDateWindow({ viewMode, currentDateKey }), [currentDateKey, viewMode]);
  const requestIdRef = useRef(0);
  const activeWindowRef = useRef(activeWindow);
  activeWindowRef.current = activeWindow;

  const buildFetchPayload = useCallback(
    (cursor?: string | null): ScheduledContentPayload => ({
      startDate: activeWindow.startDate,
      endDate: activeWindow.endDate,
      timezone: localTimezone,
      campaignId: filters.campaignId === "all" ? undefined : filters.campaignId,
      channel: filters.channel === "all" ? undefined : filters.channel,
      status: filters.status === "all" ? undefined : filters.status,
      limit: 200,
      cursor: cursor ?? undefined
    }),
    [activeWindow.endDate, activeWindow.startDate, filters.campaignId, filters.channel, filters.status, localTimezone]
  );

  const mergeItemsByUpdatedAt = useCallback((prev: ScheduledContentItem[], next: ScheduledContentItem[]): ScheduledContentItem[] => {
    const byId = new Map<string, ScheduledContentItem>();
    for (const item of prev) {
      byId.set(item.slot_id, item);
    }
    for (const item of next) {
      const current = byId.get(item.slot_id);
      if (!current || asString(item.updated_at) > asString(current.updated_at)) {
        byId.set(item.slot_id, item);
      }
    }
    return [...byId.values()].sort((left, right) => {
      if (left.scheduled_date === right.scheduled_date) {
        return left.slot_id.localeCompare(right.slot_id);
      }
      return left.scheduled_date.localeCompare(right.scheduled_date);
    });
  }, []);

  const fetchScheduledContent = useCallback(
    async (params?: { append?: boolean; cursor?: string | null }) => {
      if (isOffline) {
        return;
      }

      const append = params?.append === true;
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }

      try {
        const payload = buildFetchPayload(append ? params?.cursor ?? null : null);
        const response = await window.desktopRuntime.chat.listScheduledContent(payload);
        if (requestId !== requestIdRef.current) {
          return;
        }
        if (!response.ok) {
          setScheduleNotice(response.message ?? "Failed to load scheduled content.");
          return;
        }

        setScheduleNotice("");
        setScheduledItems((previous) => (append ? mergeItemsByUpdatedAt(previous, response.items ?? []) : response.items ?? []));
        setNextCursor(response.page.next_cursor ?? null);
        setHasMore(response.page.has_more === true);

        const fallbackDate = normalizeDateKey(response.query?.start_date, activeWindow.startDate);
        if (viewMode === "week") {
          setCurrentDateKey((prev) => normalizeDateKey(prev, fallbackDate));
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [activeWindow.startDate, buildFetchPayload, isOffline, mergeItemsByUpdatedAt, viewMode]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchScheduledContent();
    }, FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [fetchScheduledContent, viewMode, currentDateKey, filters]);

  useEffect(() => {
    if (isOffline) {
      return;
    }
    const interval = window.setInterval(() => {
      void fetchScheduledContent();
    }, SOFT_REFETCH_MS);
    return () => window.clearInterval(interval);
  }, [fetchScheduledContent, isOffline]);

  useEffect(() => {
    const onOnline = () => {
      setIsOffline(false);
      void fetchScheduledContent();
    };
    const onOffline = () => {
      setIsOffline(true);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [fetchScheduledContent]);

  useEffect(() => {
    const onFocus = () => {
      if (!isOffline) {
        void fetchScheduledContent();
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchScheduledContent, isOffline]);

  useEffect(() => {
    let cancelled = false;
    const loadCampaigns = async () => {
      const response = await window.desktopRuntime.chat.listActiveCampaignSummaries();
      if (cancelled) {
        return;
      }
      if (!response.ok) {
        setScheduleNotice((prev) => prev || response.message || "Failed to load campaign summaries.");
        return;
      }
      setCampaignSummaries(response.items ?? []);
    };
    void loadCampaigns();
    return () => {
      cancelled = true;
    };
  }, []);

  const { isRealtimeConnected } = useSchedulerRealtimeSync({
    isOffline,
    activeWindowRef,
    fetchScheduledContent: async () => {
      await fetchScheduledContent();
    },
    setScheduledItems
  });

  useEffect(() => {
    if (refreshTriggerKey <= 0 || isOffline) {
      return;
    }
    void fetchScheduledContent();
  }, [fetchScheduledContent, isOffline, refreshTriggerKey]);

  return {
    viewMode,
    currentDateKey,
    todayDateKey,
    filters,
    activeWindow,
    scheduledItems,
    campaignSummaries,
    scheduleNotice,
    isLoading,
    isLoadingMore,
    hasMore,
    nextCursor,
    isOffline,
    connectionState: isOffline ? "offline" : isRealtimeConnected ? "online" : "reconnecting",
    setViewMode,
    shiftCurrentDate: (direction) =>
      setCurrentDateKey((prev) => shiftCurrentDateKey({ viewMode, currentDateKey: prev, direction })),
    jumpToToday: () => setCurrentDateKey(todayDateKey),
    setFilters,
    loadMore: async () => {
      if (!nextCursor) {
        return;
      }
      await fetchScheduledContent({ append: true, cursor: nextCursor });
    },
    refreshNow: async () => {
      await fetchScheduledContent();
    }
  };
};
