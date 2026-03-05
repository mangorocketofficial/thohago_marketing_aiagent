import { HttpError } from "../../lib/errors";
import { supabaseAdmin } from "../../lib/supabase-admin";
import { normalizeSlotStatus, type ScheduleSlotStatus } from "../../orchestrator/scheduler-status";

type SlotRow = {
  id: string;
  scheduled_date: string;
  scheduled_time: string | null;
  slot_status: string;
  channel: string;
  content_type: string;
  campaign_id: string | null;
  workflow_item_id: string | null;
  content_id: string | null;
  session_id: string | null;
  title: string | null;
  metadata: Record<string, unknown>;
  updated_at: string;
  created_at: string;
};

export type RescheduledSlot = {
  slot_id: string;
  scheduled_date: string;
  scheduled_time: string | null;
  slot_status: ScheduleSlotStatus;
  channel: string;
  content_type: string;
  campaign_id: string | null;
  workflow_item_id: string | null;
  content_id: string | null;
  session_id: string | null;
  title: string | null;
  metadata: Record<string, unknown>;
  updated_at: string;
};

export type RescheduleScheduleSlotParams = {
  orgId: string;
  slotId: string;
  targetDate: string;
  targetTime: string | null;
  timezone: string;
  idempotencyKey: string | null;
  windowStart: string | null;
  windowEnd: string | null;
};

export type RescheduleScheduleSlotResult = {
  slot: RescheduledSlot;
  window: {
    source_in_active_window: boolean | null;
    destination_in_active_window: boolean | null;
    moved_out_of_active_window: boolean;
    moved_into_active_window: boolean;
  };
  query: {
    timezone: string;
  };
  idempotency_key: string | null;
};

const asString = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

const asRecord = (value: unknown): Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const isMissingRelationError = (error: unknown): boolean =>
  !!error && typeof error === "object" && (error as { code?: string }).code === "42P01";

const asNullableWindowMembership = (dateKey: string, startDate: string | null, endDate: string | null): boolean | null => {
  if (!startDate || !endDate) {
    return null;
  }
  return dateKey >= startDate && dateKey <= endDate;
};

export const rescheduleScheduleSlot = async (
  params: RescheduleScheduleSlotParams
): Promise<RescheduleScheduleSlotResult> => {
  const columns =
    "id,scheduled_date,scheduled_time,slot_status,channel,content_type,campaign_id,workflow_item_id,content_id,session_id,title,metadata,updated_at,created_at";

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("schedule_slots")
    .select(columns)
    .eq("org_id", params.orgId)
    .eq("id", params.slotId)
    .maybeSingle();

  if (existingError) {
    if (isMissingRelationError(existingError)) {
      throw new HttpError(409, "schema_not_ready", "schedule_slots table is missing.");
    }
    throw new HttpError(500, "db_error", `Failed to load schedule slot: ${existingError.message}`);
  }

  const existingRow = (existing as SlotRow | null) ?? null;
  if (!existingRow) {
    throw new HttpError(404, "not_found", "Schedule slot not found.");
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("schedule_slots")
    .update({
      scheduled_date: params.targetDate,
      scheduled_time: params.targetTime
    })
    .eq("org_id", params.orgId)
    .eq("id", params.slotId)
    .select(columns)
    .maybeSingle();

  if (updateError) {
    throw new HttpError(500, "db_error", `Failed to reschedule slot: ${updateError.message}`);
  }

  const updatedRow = (updated as SlotRow | null) ?? null;
  if (!updatedRow) {
    throw new HttpError(404, "not_found", "Schedule slot not found after update.");
  }

  const sourceInWindow = asNullableWindowMembership(
    existingRow.scheduled_date,
    params.windowStart,
    params.windowEnd
  );
  const destinationInWindow = asNullableWindowMembership(
    updatedRow.scheduled_date,
    params.windowStart,
    params.windowEnd
  );

  return {
    slot: {
      slot_id: asString(updatedRow.id),
      scheduled_date: asString(updatedRow.scheduled_date),
      scheduled_time: asString(updatedRow.scheduled_time).trim() || null,
      slot_status: normalizeSlotStatus(updatedRow.slot_status),
      channel: asString(updatedRow.channel),
      content_type: asString(updatedRow.content_type),
      campaign_id: asString(updatedRow.campaign_id).trim() || null,
      workflow_item_id: asString(updatedRow.workflow_item_id).trim() || null,
      content_id: asString(updatedRow.content_id).trim() || null,
      session_id: asString(updatedRow.session_id).trim() || null,
      title: asString(updatedRow.title).trim() || null,
      metadata: asRecord(updatedRow.metadata),
      updated_at: asString(updatedRow.updated_at, asString(updatedRow.created_at, new Date().toISOString()))
    },
    window: {
      source_in_active_window: sourceInWindow,
      destination_in_active_window: destinationInWindow,
      moved_out_of_active_window: sourceInWindow === true && destinationInWindow === false,
      moved_into_active_window: sourceInWindow === false && destinationInWindow === true
    },
    query: {
      timezone: params.timezone
    },
    idempotency_key: params.idempotencyKey
  };
};
