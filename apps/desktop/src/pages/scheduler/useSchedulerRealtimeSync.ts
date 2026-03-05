import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  asRecord,
  asString,
  buildSchedulerSupabaseClient,
  isRealtimeRowInWindow,
  isSlotStatus,
  type ScheduledContentItem,
  type SchedulerRealtimeRow
} from "./scheduler-helpers";

type UseSchedulerRealtimeSyncParams = {
  isOffline: boolean;
  activeWindowRef: MutableRefObject<{ startDate: string; endDate: string }>;
  fetchScheduledContent: () => Promise<void>;
  setScheduledItems: Dispatch<SetStateAction<ScheduledContentItem[]>>;
};

export const useSchedulerRealtimeSync = ({
  isOffline,
  activeWindowRef,
  fetchScheduledContent,
  setScheduledItems
}: UseSchedulerRealtimeSyncParams): { isRealtimeConnected: boolean } => {
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const [realtimeOrgId, setRealtimeOrgId] = useState("");
  const [realtimeClient, setRealtimeClient] = useState<SupabaseClient | null>(null);
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const fetchScheduledContentRef = useRef(fetchScheduledContent);

  useEffect(() => {
    fetchScheduledContentRef.current = fetchScheduledContent;
  }, [fetchScheduledContent]);

  useEffect(() => {
    let cancelled = false;
    const initRealtime = async () => {
      const runtime = await buildSchedulerSupabaseClient();
      if (cancelled) {
        return;
      }
      setRealtimeOrgId(runtime.orgId);
      setRealtimeClient(runtime.client);
    };
    void initRealtime();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!realtimeClient || !realtimeOrgId || isOffline) {
      setIsRealtimeConnected(false);
      return;
    }

    if (realtimeChannelRef.current) {
      void realtimeClient.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }

    const channel = realtimeClient
      .channel(`desktop-scheduler-slots-${realtimeOrgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "schedule_slots", filter: `org_id=eq.${realtimeOrgId}` },
        (payload) => {
          const nextRow = asRecord(payload.new) as SchedulerRealtimeRow;
          const oldRow = asRecord(payload.old) as SchedulerRealtimeRow;
          const eventType = asString((payload as Record<string, unknown>).eventType);
          const rowId = asString(nextRow.id || oldRow.id).trim();
          if (!rowId) {
            return;
          }
          if (eventType === "DELETE") {
            setScheduledItems((prev) => prev.filter((item) => item.slot_id !== rowId));
            return;
          }

          let matchedExisting = false;
          setScheduledItems((prev) =>
            prev.map((item) => {
              if (item.slot_id !== rowId) {
                return item;
              }
              matchedExisting = true;
              const incomingUpdatedAt = asString(nextRow.updated_at).trim();
              if (incomingUpdatedAt && incomingUpdatedAt <= asString(item.updated_at)) {
                return item;
              }
              return {
                ...item,
                slot_status: isSlotStatus(nextRow.slot_status) ? nextRow.slot_status : item.slot_status,
                scheduled_date: asString(nextRow.scheduled_date).trim() || item.scheduled_date,
                scheduled_time:
                  nextRow.scheduled_time === null ? null : asString(nextRow.scheduled_time).trim() || item.scheduled_time,
                channel: asString(nextRow.channel).trim() || item.channel,
                content_type: asString(nextRow.content_type).trim() || item.content_type,
                campaign_id: nextRow.campaign_id === null ? null : asString(nextRow.campaign_id).trim() || item.campaign_id,
                workflow_item_id:
                  nextRow.workflow_item_id === null ? null : asString(nextRow.workflow_item_id).trim() || item.workflow_item_id,
                content_id: nextRow.content_id === null ? null : asString(nextRow.content_id).trim() || item.content_id,
                session_id: nextRow.session_id === null ? null : asString(nextRow.session_id).trim() || item.session_id,
                title: nextRow.title === null ? null : asString(nextRow.title).trim() || item.title,
                metadata: nextRow.metadata ? asRecord(nextRow.metadata) : item.metadata,
                updated_at: asString(nextRow.updated_at).trim() || item.updated_at
              };
            })
          );

          if (!matchedExisting && isRealtimeRowInWindow(nextRow, activeWindowRef.current.startDate, activeWindowRef.current.endDate)) {
            void fetchScheduledContentRef.current();
          }
        }
      )
      .subscribe((status) => {
        setIsRealtimeConnected(status === "SUBSCRIBED");
      });
    realtimeChannelRef.current = channel;

    return () => {
      if (realtimeChannelRef.current === channel) {
        void realtimeClient.removeChannel(channel);
        realtimeChannelRef.current = null;
      }
    };
  }, [activeWindowRef, isOffline, realtimeClient, realtimeOrgId, setScheduledItems]);

  return {
    isRealtimeConnected
  };
};
