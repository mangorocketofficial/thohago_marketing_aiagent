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
  type RescheduleSlotResponse,
  type ScheduledContentDayResponse,
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
  isRescheduling: boolean;
  connectionState: "online" | "reconnecting" | "offline";
  setViewMode: (next: SchedulerViewMode) => void;
  shiftCurrentDate: (direction: "prev" | "next") => void;
  jumpToToday: () => void;
  setFilters: (next: SchedulerFilterState) => void;
  loadDayItems: (params: { date: string; cursor?: string | null; limit?: number }) => Promise<ScheduledContentDayResponse>;
  rescheduleSlot: (params: { slotId: string; targetDate: string; targetTime?: string | null }) => Promise<RescheduleSlotResponse>;
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
  const [isRescheduling, setIsRescheduling] = useState(false);
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
      limit: viewMode === "month" ? 320 : 200,
      cursor: cursor ?? undefined
    }),
    [activeWindow.endDate, activeWindow.startDate, filters.campaignId, filters.channel, filters.status, localTimezone, viewMode]
  );

  const sortScheduledItems = useCallback((items: ScheduledContentItem[]): ScheduledContentItem[] => {
    return [...items].sort((left, right) => {
      if (left.scheduled_date === right.scheduled_date) {
        const timeCompare = (left.scheduled_time ?? "").localeCompare(right.scheduled_time ?? "");
        if (timeCompare !== 0) {
          return timeCompare;
        }
        return left.slot_id.localeCompare(right.slot_id);
      }
      return left.scheduled_date.localeCompare(right.scheduled_date);
    });
  }, []);

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
    return sortScheduledItems([...byId.values()]);
  }, [sortScheduledItems]);

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

  const loadDayItems = useCallback(
    async (params: { date: string; cursor?: string | null; limit?: number }): Promise<ScheduledContentDayResponse> => {
      if (isOffline) {
        return {
          ok: false,
          items: [],
          page: {
            next_cursor: null,
            has_more: false
          },
          query: null,
          message: "Offline mode: unable to fetch day detail."
        };
      }

      return window.desktopRuntime.chat.listScheduledContentDay({
        date: params.date,
        timezone: localTimezone,
        campaignId: filters.campaignId === "all" ? undefined : filters.campaignId,
        channel: filters.channel === "all" ? undefined : filters.channel,
        status: filters.status === "all" ? undefined : filters.status,
        limit: Math.max(1, Math.min(500, params.limit ?? 120)),
        cursor: params.cursor ?? undefined
      });
    },
    [filters.campaignId, filters.channel, filters.status, isOffline, localTimezone]
  );

  const rescheduleSlot = useCallback(
    async (params: { slotId: string; targetDate: string; targetTime?: string | null }): Promise<RescheduleSlotResponse> => {
      const slotId = params.slotId.trim();
      const targetDate = params.targetDate.trim();
      if (!slotId || !targetDate) {
        return {
          ok: false,
          slot: null,
          window: {
            source_in_active_window: null,
            destination_in_active_window: null,
            moved_out_of_active_window: false,
            moved_into_active_window: false
          },
          query: {
            timezone: localTimezone
          },
          idempotency_key: null,
          message: "slotId and targetDate are required."
        };
      }

      if (isOffline) {
        return {
          ok: false,
          slot: null,
          window: {
            source_in_active_window: null,
            destination_in_active_window: null,
            moved_out_of_active_window: false,
            moved_into_active_window: false
          },
          query: {
            timezone: localTimezone
          },
          idempotency_key: null,
          message: "Offline mode: reschedule is disabled."
        };
      }

      const existing = scheduledItems.find((item) => item.slot_id === slotId);
      if (!existing) {
        return {
          ok: false,
          slot: null,
          window: {
            source_in_active_window: null,
            destination_in_active_window: null,
            moved_out_of_active_window: false,
            moved_into_active_window: false
          },
          query: {
            timezone: localTimezone
          },
          idempotency_key: null,
          message: "Selected slot is not available in current scheduler state."
        };
      }

      const optimisticUpdatedAt = new Date().toISOString();
      setIsRescheduling(true);
      setScheduleNotice("");
      setScheduledItems((prev) =>
        sortScheduledItems(
          prev.map((item) =>
            item.slot_id === slotId
              ? {
                  ...item,
                  scheduled_date: targetDate,
                  scheduled_time: params.targetTime ?? item.scheduled_time,
                  updated_at: optimisticUpdatedAt
                }
              : item
          )
        )
      );

      try {
        const response = await window.desktopRuntime.chat.rescheduleSlot({
          slotId,
          targetDate,
          targetTime: params.targetTime,
          timezone: localTimezone,
          windowStart: activeWindow.startDate,
          windowEnd: activeWindow.endDate,
          idempotencyKey: `${slotId}:${existing.updated_at}:${targetDate}`
        });

        if (!response.ok || !response.slot) {
          setScheduledItems((prev) =>
            sortScheduledItems(prev.map((item) => (item.slot_id === slotId ? existing : item)))
          );
          if (response.message) {
            setScheduleNotice(response.message);
          }
          return response;
        }

        setScheduledItems((prev) => {
          const patched = prev.map((item) =>
            item.slot_id === slotId
              ? {
                  ...item,
                  scheduled_date: response.slot!.scheduled_date,
                  scheduled_time: response.slot!.scheduled_time,
                  slot_status: response.slot!.slot_status,
                  channel: response.slot!.channel,
                  content_type: response.slot!.content_type,
                  campaign_id: response.slot!.campaign_id,
                  workflow_item_id: response.slot!.workflow_item_id,
                  content_id: response.slot!.content_id,
                  session_id: response.slot!.session_id,
                  title: response.slot!.title,
                  metadata: response.slot!.metadata,
                  updated_at: response.slot!.updated_at
                }
              : item
          );

          if (response.window.moved_out_of_active_window) {
            return sortScheduledItems(patched.filter((item) => item.slot_id !== slotId));
          }
          return sortScheduledItems(patched);
        });

        if (response.window.moved_out_of_active_window) {
          setScheduleNotice(`Rescheduled to ${response.slot.scheduled_date}. Moved outside current window.`);
        }

        if (response.window.moved_out_of_active_window || response.window.moved_into_active_window) {
          void fetchScheduledContent();
        }

        return response;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to reschedule slot.";
        setScheduledItems((prev) =>
          sortScheduledItems(prev.map((item) => (item.slot_id === slotId ? existing : item)))
        );
        setScheduleNotice(message);
        return {
          ok: false,
          slot: null,
          window: {
            source_in_active_window: null,
            destination_in_active_window: null,
            moved_out_of_active_window: false,
            moved_into_active_window: false
          },
          query: {
            timezone: localTimezone
          },
          idempotency_key: null,
          message
        };
      } finally {
        setIsRescheduling(false);
      }
    },
    [activeWindow.endDate, activeWindow.startDate, fetchScheduledContent, isOffline, localTimezone, scheduledItems, sortScheduledItems]
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
    fetchScheduledContent,
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
    isRescheduling,
    connectionState: isOffline ? "offline" : isRealtimeConnected ? "online" : "reconnecting",
    setViewMode,
    shiftCurrentDate: (direction) =>
      setCurrentDateKey((prev) => shiftCurrentDateKey({ viewMode, currentDateKey: prev, direction })),
    jumpToToday: () => setCurrentDateKey(todayDateKey),
    setFilters,
    loadDayItems,
    rescheduleSlot,
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
