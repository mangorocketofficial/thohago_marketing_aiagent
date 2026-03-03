import { supabaseAdmin } from "../lib/supabase-admin";
import { WorkflowRepositoryError } from "./errors";
import type { WorkflowAction, WorkflowActorType, WorkflowEventRow, WorkflowItemPayload, WorkflowItemRow, WorkflowStatus } from "./types";

type DbErrorLike = {
  message?: string;
  code?: string;
  details?: string;
};

const toRepositoryError = (message: string, error: unknown): WorkflowRepositoryError => {
  const row = (error ?? {}) as DbErrorLike;
  return new WorkflowRepositoryError(
    `${message}: ${typeof row.message === "string" ? row.message : "unknown database error"}`,
    typeof row.code === "string" ? row.code : null,
    typeof row.details === "string" ? row.details : null
  );
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

const asNullableString = (value: unknown): string | null => (typeof value === "string" ? value : null);

const asPayload = (value: unknown): WorkflowItemPayload => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as WorkflowItemPayload;
};

const asVersion = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 1;
};

const parseWorkflowItem = (value: unknown): WorkflowItemRow => {
  const row = asRecord(value);
  return {
    id: asString(row.id),
    org_id: asString(row.org_id),
    type: asString(row.type) as WorkflowItemRow["type"],
    status: asString(row.status) as WorkflowStatus,
    payload: asPayload(row.payload),
    origin_chat_message_id: asNullableString(row.origin_chat_message_id),
    source_campaign_id: asNullableString(row.source_campaign_id),
    source_content_id: asNullableString(row.source_content_id),
    resolved_at: asNullableString(row.resolved_at),
    resolved_by: asNullableString(row.resolved_by),
    version: asVersion(row.version),
    created_at: asString(row.created_at),
    updated_at: asString(row.updated_at)
  };
};

const parseWorkflowEvent = (value: unknown): WorkflowEventRow => {
  const row = asRecord(value);
  return {
    id: asString(row.id),
    org_id: asString(row.org_id),
    workflow_item_id: asString(row.workflow_item_id),
    action: asString(row.action) as WorkflowAction,
    actor_type: asString(row.actor_type) as WorkflowActorType,
    actor_user_id: asNullableString(row.actor_user_id),
    from_status: (asNullableString(row.from_status) as WorkflowStatus | null) ?? null,
    to_status: asString(row.to_status) as WorkflowStatus,
    payload: asPayload(row.payload),
    expected_version:
      row.expected_version === null || row.expected_version === undefined ? null : asVersion(row.expected_version),
    idempotency_key: asString(row.idempotency_key),
    created_at: asString(row.created_at)
  };
};

export const getWorkflowItemById = async (orgId: string, itemId: string): Promise<WorkflowItemRow | null> => {
  const { data, error } = await supabaseAdmin
    .from("workflow_items")
    .select("*")
    .eq("org_id", orgId)
    .eq("id", itemId)
    .maybeSingle();

  if (error) {
    throw toRepositoryError("Failed to query workflow item by id", error);
  }

  return data ? parseWorkflowItem(data) : null;
};

export const getWorkflowItemBySourceCampaignId = async (
  orgId: string,
  campaignId: string
): Promise<WorkflowItemRow | null> => {
  const { data, error } = await supabaseAdmin
    .from("workflow_items")
    .select("*")
    .eq("org_id", orgId)
    .eq("type", "campaign_plan")
    .eq("source_campaign_id", campaignId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw toRepositoryError("Failed to query workflow item by source campaign", error);
  }

  return data ? parseWorkflowItem(data) : null;
};

export const getWorkflowItemBySourceContentId = async (
  orgId: string,
  contentId: string
): Promise<WorkflowItemRow | null> => {
  const { data, error } = await supabaseAdmin
    .from("workflow_items")
    .select("*")
    .eq("org_id", orgId)
    .eq("type", "content_draft")
    .eq("source_content_id", contentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw toRepositoryError("Failed to query workflow item by source content", error);
  }

  return data ? parseWorkflowItem(data) : null;
};

type InsertWorkflowItemInput = {
  org_id: string;
  type: WorkflowItemRow["type"];
  status: WorkflowStatus;
  payload: WorkflowItemPayload;
  origin_chat_message_id: string | null;
  source_campaign_id: string | null;
  source_content_id: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
};

export const insertWorkflowItem = async (input: InsertWorkflowItemInput): Promise<WorkflowItemRow> => {
  const { data, error } = await supabaseAdmin.from("workflow_items").insert(input).select("*").single();

  if (error) {
    throw toRepositoryError("Failed to insert workflow item", error);
  }

  return parseWorkflowItem(data);
};

type UpdateWorkflowItemInput = {
  orgId: string;
  itemId: string;
  fromVersion: number;
  status: WorkflowStatus;
  payload: WorkflowItemPayload;
  resolvedAt: string | null;
  resolvedBy: string | null;
};

export const updateWorkflowItemWithVersion = async (input: UpdateWorkflowItemInput): Promise<WorkflowItemRow | null> => {
  const { data, error } = await supabaseAdmin
    .from("workflow_items")
    .update({
      status: input.status,
      payload: input.payload,
      resolved_at: input.resolvedAt,
      resolved_by: input.resolvedBy,
      version: input.fromVersion + 1
    })
    .eq("org_id", input.orgId)
    .eq("id", input.itemId)
    .eq("version", input.fromVersion)
    .select("*")
    .maybeSingle();

  if (error) {
    throw toRepositoryError("Failed to update workflow item", error);
  }

  return data ? parseWorkflowItem(data) : null;
};

type UpdateWorkflowItemOriginChatMessageInput = {
  orgId: string;
  itemId: string;
  originChatMessageId: string;
};

export const updateWorkflowItemOriginChatMessage = async (
  input: UpdateWorkflowItemOriginChatMessageInput
): Promise<WorkflowItemRow | null> => {
  const { data, error } = await supabaseAdmin
    .from("workflow_items")
    .update({
      origin_chat_message_id: input.originChatMessageId
    })
    .eq("org_id", input.orgId)
    .eq("id", input.itemId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw toRepositoryError("Failed to update workflow item origin chat message", error);
  }

  return data ? parseWorkflowItem(data) : null;
};

export const deleteWorkflowItemById = async (orgId: string, itemId: string): Promise<void> => {
  const { error } = await supabaseAdmin.from("workflow_items").delete().eq("org_id", orgId).eq("id", itemId);

  if (error) {
    throw toRepositoryError("Failed to delete workflow item", error);
  }
};

type InsertWorkflowEventInput = {
  org_id: string;
  workflow_item_id: string;
  action: WorkflowAction;
  actor_type: WorkflowActorType;
  actor_user_id: string | null;
  from_status: WorkflowStatus | null;
  to_status: WorkflowStatus;
  payload: WorkflowItemPayload;
  expected_version: number | null;
  idempotency_key: string;
};

export const insertWorkflowEvent = async (input: InsertWorkflowEventInput): Promise<WorkflowEventRow> => {
  const { data, error } = await supabaseAdmin.from("workflow_events").insert(input).select("*").single();

  if (error) {
    throw toRepositoryError("Failed to insert workflow event", error);
  }

  return parseWorkflowEvent(data);
};

export const getWorkflowEventByIdempotencyKey = async (
  orgId: string,
  idempotencyKey: string
): Promise<WorkflowEventRow | null> => {
  const { data, error } = await supabaseAdmin
    .from("workflow_events")
    .select("*")
    .eq("org_id", orgId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) {
    throw toRepositoryError("Failed to query workflow event by idempotency key", error);
  }

  return data ? parseWorkflowEvent(data) : null;
};

export const listWorkflowItemsByStatuses = async (
  orgId: string,
  statuses: WorkflowStatus[]
): Promise<WorkflowItemRow[]> => {
  const { data, error } = await supabaseAdmin
    .from("workflow_items")
    .select("*")
    .eq("org_id", orgId)
    .in("status", statuses)
    .order("created_at", { ascending: false });

  if (error) {
    throw toRepositoryError("Failed to list workflow items by statuses", error);
  }

  return Array.isArray(data) ? data.map(parseWorkflowItem) : [];
};
