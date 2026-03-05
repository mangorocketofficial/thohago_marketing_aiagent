import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { SlotStatus } from "../../components/scheduler/status-model";

export const FILTER_DEBOUNCE_MS = 250;
export const SOFT_REFETCH_MS = 45_000;

export type ScheduledContentResponse = Awaited<ReturnType<Window["desktopRuntime"]["chat"]["listScheduledContent"]>>;
export type ScheduledContentItem = ScheduledContentResponse["items"][number];
export type ScheduledContentPayload = Parameters<Window["desktopRuntime"]["chat"]["listScheduledContent"]>[0];
export type ScheduledContentDayResponse = Awaited<ReturnType<Window["desktopRuntime"]["chat"]["listScheduledContentDay"]>>;
export type ScheduledContentDayPayload = Parameters<Window["desktopRuntime"]["chat"]["listScheduledContentDay"]>[0];
export type RescheduleSlotPayload = Parameters<Window["desktopRuntime"]["chat"]["rescheduleSlot"]>[0];
export type RescheduleSlotResponse = Awaited<ReturnType<Window["desktopRuntime"]["chat"]["rescheduleSlot"]>>;

export type SchedulerRealtimeRow = {
  id?: string;
  slot_status?: unknown;
  scheduled_date?: unknown;
  scheduled_time?: unknown;
  channel?: unknown;
  content_type?: unknown;
  campaign_id?: unknown;
  workflow_item_id?: unknown;
  content_id?: unknown;
  session_id?: unknown;
  title?: unknown;
  metadata?: unknown;
  updated_at?: unknown;
};

export const isSlotStatus = (value: unknown): value is SlotStatus =>
  value === "scheduled" ||
  value === "generating" ||
  value === "pending_approval" ||
  value === "approved" ||
  value === "published" ||
  value === "skipped" ||
  value === "failed";

export const asString = (value: unknown): string => (typeof value === "string" ? value : "");

export const asRecord = (value: unknown): Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export const isRealtimeRowInWindow = (row: SchedulerRealtimeRow, startDate: string, endDate: string): boolean => {
  const dateKey = asString(row.scheduled_date).trim();
  if (!dateKey) {
    return false;
  }
  return dateKey >= startDate && dateKey <= endDate;
};

export const buildSchedulerSupabaseClient = async (): Promise<{ orgId: string; client: SupabaseClient | null }> => {
  const config = await window.desktopRuntime.chat.getConfig();
  if (!config.enabled || !config.orgId || !config.supabaseUrl || !config.supabaseAnonKey) {
    return {
      orgId: "",
      client: null
    };
  }

  const client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: "desktop-scheduler-auth"
    },
    ...(config.supabaseAccessToken
      ? {
          global: {
            headers: {
              Authorization: `Bearer ${config.supabaseAccessToken}`
            }
          }
        }
      : {})
  });
  if (config.supabaseAccessToken) {
    client.realtime.setAuth(config.supabaseAccessToken);
  }
  return {
    orgId: config.orgId,
    client
  };
};
