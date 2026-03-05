import { HttpError } from "../lib/errors";
import { supabaseAdmin } from "../lib/supabase-admin";
import { normalizeSlotStatus, type ScheduleSlotStatus } from "./scheduler-status";
import type { WorkflowStatus } from "../workflow/types";
import {
  isSlotTransitionAllowed,
  resolveTargetSlotStatus,
  resolveWorkflowTransitionEvent,
  type SlotTransitionEvent
} from "./scheduler-slot-transition-model";

type ScheduleSlotRow = {
  id: string;
  slot_status: string;
  metadata: Record<string, unknown>;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const isMissingRelationError = (error: unknown): boolean =>
  !!error && typeof error === "object" && (error as { code?: string }).code === "42P01";

const updateSlotById = async (params: {
  orgId: string;
  slotId: string;
  event: SlotTransitionEvent;
  publishedAt?: string | null;
  patch?: Record<string, unknown>;
}): Promise<boolean> => {
  const { data: row, error } = await supabaseAdmin
    .from("schedule_slots")
    .select("id,slot_status,metadata")
    .eq("org_id", params.orgId)
    .eq("id", params.slotId)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error)) {
      console.warn("[SCHEDULER_SLOT_TRANSITION] schedule_slots table is missing; transition skipped.");
      return false;
    }
    throw new HttpError(500, "db_error", `Failed to load schedule slot: ${error.message}`);
  }
  if (!row) {
    return false;
  }

  const slot = row as ScheduleSlotRow;
  const fromStatus = normalizeSlotStatus(slot.slot_status);
  const targetStatus = resolveTargetSlotStatus({
    event: params.event,
    publishedAt: params.publishedAt
  });
  if (!isSlotTransitionAllowed(fromStatus, targetStatus)) {
    console.warn(
      `[SCHEDULER_SLOT_TRANSITION] rejected transition ${fromStatus} -> ${targetStatus} for slot ${params.slotId}.`
    );
    return false;
  }

  const patch: Record<string, unknown> = {
    slot_status: targetStatus,
    ...(params.patch ?? {})
  };

  if (params.event === "workflow_revision_requested") {
    const metadata = asRecord(slot.metadata);
    const revisionCountRaw = Number(metadata.revision_count ?? 0);
    const revisionCount = Number.isFinite(revisionCountRaw) ? Math.max(0, Math.floor(revisionCountRaw)) : 0;
    patch.metadata = {
      ...metadata,
      revision_count: revisionCount + 1
    };
  }

  const { error: updateError } = await supabaseAdmin
    .from("schedule_slots")
    .update(patch)
    .eq("org_id", params.orgId)
    .eq("id", params.slotId);
  if (updateError) {
    throw new HttpError(500, "db_error", `Failed to update schedule slot status: ${updateError.message}`);
  }

  return true;
};

export const reserveNextSlotForGeneration = async (params: {
  orgId: string;
  campaignId: string;
  sessionId?: string | null;
  channel?: string | null;
  contentType?: string;
}): Promise<string | null> => {
  let query = supabaseAdmin
    .from("schedule_slots")
    .select("id,slot_status,metadata")
    .eq("org_id", params.orgId)
    .eq("campaign_id", params.campaignId)
    .is("content_id", null)
    .order("scheduled_date", { ascending: true })
    .order("id", { ascending: true })
    .limit(1);

  if (typeof params.sessionId === "string" && params.sessionId.trim()) {
    query = query.eq("session_id", params.sessionId.trim());
  }
  if (typeof params.channel === "string" && params.channel.trim()) {
    query = query.eq("channel", params.channel.trim().toLowerCase());
  }
  if (typeof params.contentType === "string" && params.contentType.trim()) {
    query = query.eq("content_type", params.contentType.trim());
  }
  query = query.in("slot_status", ["scheduled", "generating"]);

  const { data, error } = await query;
  if (error) {
    if (isMissingRelationError(error)) {
      console.warn("[SCHEDULER_SLOT_TRANSITION] schedule_slots table is missing; reserve skipped.");
      return null;
    }
    throw new HttpError(500, "db_error", `Failed to reserve schedule slot: ${error.message}`);
  }

  const slot = ((data as ScheduleSlotRow[] | null) ?? [])[0];
  if (!slot?.id) {
    return null;
  }

  const current = normalizeSlotStatus(slot.slot_status);
  if (current === "scheduled") {
    await updateSlotById({
      orgId: params.orgId,
      slotId: slot.id,
      event: "generation_started"
    });
  }

  return slot.id;
};

export const completeReservedSlotGeneration = async (params: {
  orgId: string;
  slotId: string;
  contentId: string;
  workflowItemId: string;
  sessionId?: string | null;
  title?: string | null;
}): Promise<void> => {
  const patch: Record<string, unknown> = {
    content_id: params.contentId,
    workflow_item_id: params.workflowItemId
  };
  if (typeof params.sessionId === "string" && params.sessionId.trim()) {
    patch.session_id = params.sessionId.trim();
  }
  if (typeof params.title === "string" && params.title.trim()) {
    patch.title = params.title.trim();
  }

  const moved = await updateSlotById({
    orgId: params.orgId,
    slotId: params.slotId,
    event: "generation_completed",
    patch
  });
  if (moved) {
    return;
  }

  await updateSlotById({
    orgId: params.orgId,
    slotId: params.slotId,
    event: "generation_started"
  });
  await updateSlotById({
    orgId: params.orgId,
    slotId: params.slotId,
    event: "generation_completed",
    patch
  });
};

export const syncSlotStatusFromWorkflow = async (params: {
  orgId: string;
  workflowItemId: string;
  contentId?: string | null;
  workflowStatus: WorkflowStatus;
  publishedAt?: string | null;
}): Promise<void> => {
  const workflowItemId = params.workflowItemId.trim();
  if (!workflowItemId) {
    return;
  }

  const { data: byWorkflow, error: byWorkflowError } = await supabaseAdmin
    .from("schedule_slots")
    .select("id")
    .eq("org_id", params.orgId)
    .eq("workflow_item_id", workflowItemId)
    .order("scheduled_date", { ascending: true })
    .order("id", { ascending: true })
    .limit(1);

  if (byWorkflowError) {
    if (isMissingRelationError(byWorkflowError)) {
      console.warn("[SCHEDULER_SLOT_TRANSITION] schedule_slots table is missing; workflow sync skipped.");
      return;
    }
    throw new HttpError(500, "db_error", `Failed to load slot by workflow item: ${byWorkflowError.message}`);
  }

  const slotIdFromWorkflow = (((byWorkflow as Record<string, unknown>[] | null) ?? [])[0]?.id as string | undefined) ?? null;
  let slotId = typeof slotIdFromWorkflow === "string" ? slotIdFromWorkflow.trim() : "";

  if (!slotId && typeof params.contentId === "string" && params.contentId.trim()) {
    const { data: byContent, error: byContentError } = await supabaseAdmin
      .from("schedule_slots")
      .select("id")
      .eq("org_id", params.orgId)
      .eq("content_id", params.contentId.trim())
      .order("scheduled_date", { ascending: true })
      .order("id", { ascending: true })
      .limit(1);
    if (byContentError) {
      throw new HttpError(500, "db_error", `Failed to load slot by content id: ${byContentError.message}`);
    }
    slotId = (asRecord(((byContent as Record<string, unknown>[] | null) ?? [])[0]).id as string | undefined) ?? "";
  }

  if (!slotId) {
    return;
  }

  await updateSlotById({
    orgId: params.orgId,
    slotId,
    event: resolveWorkflowTransitionEvent(params.workflowStatus),
    publishedAt: params.publishedAt,
    patch: {
      workflow_item_id: workflowItemId,
      ...(typeof params.contentId === "string" && params.contentId.trim() ? { content_id: params.contentId.trim() } : {})
    }
  });
};
