import { HttpError } from "../../../lib/errors";
import { supabaseAdmin } from "../../../lib/supabase-admin";
import { parseSlotRow, type ScheduleSlotRow, type SlotSource } from "./types";

const SLOT_SELECT =
  "id,org_id,campaign_id,session_id,channel,content_type,title,scheduled_date,slot_status,content_id,metadata,lock_version";

const loadSlotById = async (params: { orgId: string; slotId: string }): Promise<ScheduleSlotRow | null> => {
  const { data, error } = await supabaseAdmin
    .from("schedule_slots")
    .select(SLOT_SELECT)
    .eq("org_id", params.orgId)
    .eq("id", params.slotId)
    .eq("channel", "naver_blog")
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "db_error", `Failed to load schedule slot: ${error.message}`);
  }

  return data ? parseSlotRow(data) : null;
};

const markSlotGenerating = async (params: { orgId: string; slot: ScheduleSlotRow }): Promise<ScheduleSlotRow> => {
  if (params.slot.slot_status === "generating") {
    return params.slot;
  }

  const { data, error } = await supabaseAdmin
    .from("schedule_slots")
    .update({
      slot_status: "generating",
      lock_version: params.slot.lock_version + 1,
      metadata: {
        ...params.slot.metadata,
        generation_started_at: new Date().toISOString()
      }
    })
    .eq("org_id", params.orgId)
    .eq("id", params.slot.id)
    .eq("lock_version", params.slot.lock_version)
    .select(SLOT_SELECT)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "db_error", `Failed to reserve schedule slot: ${error.message}`);
  }

  if (data) {
    return parseSlotRow(data);
  }

  const reloaded = await loadSlotById({
    orgId: params.orgId,
    slotId: params.slot.id
  });
  if (!reloaded || (reloaded.slot_status !== "generating" && reloaded.slot_status !== "scheduled")) {
    throw new HttpError(409, "version_conflict", "Failed to reserve schedule slot due to concurrent update.");
  }

  return reloaded.slot_status === "scheduled"
    ? markSlotGenerating({ orgId: params.orgId, slot: reloaded })
    : reloaded;
};

const findCampaignSlot = async (params: {
  orgId: string;
  campaignId: string | null;
}): Promise<ScheduleSlotRow | null> => {
  if (!params.campaignId) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from("schedule_slots")
    .select(SLOT_SELECT)
    .eq("org_id", params.orgId)
    .eq("campaign_id", params.campaignId)
    .eq("channel", "naver_blog")
    .eq("content_type", "text")
    .is("content_id", null)
    .in("slot_status", ["scheduled", "generating"])
    .order("scheduled_date", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "db_error", `Failed to load campaign slot: ${error.message}`);
  }

  return data ? parseSlotRow(data) : null;
};

const findIdempotentOnDemandSlot = async (params: {
  orgId: string;
  sessionId: string;
  idempotencyKey: string | null;
}): Promise<ScheduleSlotRow | null> => {
  if (!params.idempotencyKey) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from("schedule_slots")
    .select(SLOT_SELECT)
    .eq("org_id", params.orgId)
    .eq("session_id", params.sessionId)
    .eq("channel", "naver_blog")
    .eq("content_type", "text")
    .eq("metadata->>source", "ondemand")
    .eq("metadata->>request_idempotency_key", params.idempotencyKey)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "db_error", `Failed to query idempotent on-demand slot: ${error.message}`);
  }

  return data ? parseSlotRow(data) : null;
};

const createOnDemandSlot = async (params: {
  orgId: string;
  sessionId: string;
  topic: string;
  idempotencyKey: string | null;
}): Promise<ScheduleSlotRow> => {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin
    .from("schedule_slots")
    .insert({
      org_id: params.orgId,
      session_id: params.sessionId,
      campaign_id: null,
      channel: "naver_blog",
      content_type: "text",
      title: params.topic,
      scheduled_date: today,
      slot_status: "generating",
      metadata: {
        source: "ondemand",
        requested_at: new Date().toISOString(),
        request_idempotency_key: params.idempotencyKey
      }
    })
    .select(SLOT_SELECT)
    .single();

  if (error || !data) {
    throw new HttpError(500, "db_error", `Failed to create on-demand slot: ${error?.message ?? "unknown"}`);
  }

  return parseSlotRow(data);
};

/**
 * Resolve target schedule slot with campaign-first and idempotent on-demand fallback.
 */
export const resolveGenerationSlot = async (params: {
  orgId: string;
  sessionId: string;
  campaignId: string | null;
  topic: string;
  idempotencyKey: string | null;
}): Promise<{ slot: ScheduleSlotRow; source: SlotSource }> => {
  const campaignSlot = await findCampaignSlot({
    orgId: params.orgId,
    campaignId: params.campaignId
  });
  if (campaignSlot) {
    return {
      slot: await markSlotGenerating({
        orgId: params.orgId,
        slot: campaignSlot
      }),
      source: "campaign"
    };
  }

  const existing = await findIdempotentOnDemandSlot({
    orgId: params.orgId,
    sessionId: params.sessionId,
    idempotencyKey: params.idempotencyKey
  });
  if (existing) {
    return {
      slot: existing,
      source: "ondemand"
    };
  }

  return {
    slot: await createOnDemandSlot({
      orgId: params.orgId,
      sessionId: params.sessionId,
      topic: params.topic,
      idempotencyKey: params.idempotencyKey
    }),
    source: "ondemand"
  };
};
