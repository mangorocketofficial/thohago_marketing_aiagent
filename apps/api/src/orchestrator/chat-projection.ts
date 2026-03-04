import { HttpError } from "../lib/errors";
import { supabaseAdmin } from "../lib/supabase-admin";
import {
  buildCampaignPlanProjectionMetadata,
  buildContentDraftProjectionMetadata,
  buildProjectionKey,
  patchActionCardMetadataStatus
} from "../workflow/projection";
import type { WorkflowItemRow } from "../workflow/types";
import type { CampaignPlan, ForbiddenCheckMeta } from "./types";

export const DEFAULT_CHAT_CHANNEL = "dashboard";

export type ChatMessageType = "text" | "action_card" | "system";
export type ChatChannel = "dashboard" | "telegram";

export type InsertChatMessageInput = {
  orgId: string;
  sessionId?: string | null;
  role: "user" | "assistant";
  content: string;
  channel?: ChatChannel;
  messageType?: ChatMessageType;
  metadata?: Record<string, unknown>;
  workflowItemId?: string | null;
  projectionKey?: string | null;
};

export type UpdateLatestActionCardProjectionStatusInput = {
  orgId: string;
  workflowItem: WorkflowItemRow;
  sessionId: string;
};

export type EmitCampaignActionCardProjectionInput = {
  orgId: string;
  sessionId: string;
  workflowItem: WorkflowItemRow;
  activityFolder: string;
  plan: CampaignPlan;
};

export type EmitContentActionCardProjectionInput = {
  orgId: string;
  sessionId: string;
  workflowItem: WorkflowItemRow;
  activityFolder: string;
  channel: string;
  draft: string;
  forbiddenCheck: ForbiddenCheckMeta;
};

const asString = (value: unknown, fallback = ""): string => {
  if (typeof value === "string") {
    return value;
  }
  return fallback;
};

const buildCampaignSummary = (activityFolder: string, plan: CampaignPlan): string =>
  [
    `캠페인 초안이 준비되었습니다: ${activityFolder}`,
    `- 채널: ${plan.channels.join(", ")}`,
    `- 기간: ${plan.duration_days}일 / ${plan.post_count}개 포스트`,
    "확인하면 첫 콘텐츠 초안을 생성하겠습니다."
  ].join("\n");

const buildContentSummary = (channel: string, forbiddenCheck: ForbiddenCheckMeta): string =>
  forbiddenCheck.passed
    ? `첫 번째 ${channel} 콘텐츠 초안이 생성되었습니다. 승인 큐에서 확인해 주세요.`
    : `첫 번째 ${channel} 콘텐츠 초안이 생성되었습니다. 금지 표현 감지(${forbiddenCheck.violations.join(", ")})가 있어 검토가 필요합니다.`;

const readChatMessageIdByProjectionKey = async (orgId: string, projectionKey: string): Promise<string | null> => {
  const { data, error } = await supabaseAdmin
    .from("chat_messages")
    .select("id")
    .eq("org_id", orgId)
    .eq("projection_key", projectionKey)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "db_error", `Failed to read chat message by projection key: ${error.message}`);
  }

  if (!data) {
    return null;
  }
  const id = asString((data as Record<string, unknown>).id, "");
  return id || null;
};

export const insertChatMessage = async (input: InsertChatMessageInput): Promise<string> => {
  const payload = {
    org_id: input.orgId,
    session_id: input.sessionId ?? null,
    role: input.role,
    content: input.content,
    channel: input.channel ?? DEFAULT_CHAT_CHANNEL,
    message_type: input.messageType ?? "text",
    metadata: input.metadata ?? {},
    workflow_item_id: input.workflowItemId ?? null,
    projection_key: input.projectionKey ?? null
  };

  if (input.projectionKey) {
    const { data, error } = await supabaseAdmin
      .from("chat_messages")
      .upsert(payload, {
        onConflict: "org_id,projection_key",
        ignoreDuplicates: true
      })
      .select("id")
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "db_error", `Failed to upsert chat projection message: ${error.message}`);
    }

    if (data) {
      const insertedId = asString((data as Record<string, unknown>).id, "");
      if (insertedId) {
        return insertedId;
      }
    }

    const existingId = await readChatMessageIdByProjectionKey(input.orgId, input.projectionKey);
    if (existingId) {
      return existingId;
    }
    throw new HttpError(500, "db_error", "Failed to resolve chat projection message id after upsert.");
  }

  const { data, error } = await supabaseAdmin.from("chat_messages").insert(payload).select("id").single();
  if (error || !data) {
    throw new HttpError(500, "db_error", `Failed to insert chat message: ${error?.message ?? "unknown"}`);
  }
  return asString((data as Record<string, unknown>).id, "");
};

export const updateLatestActionCardProjectionStatus = async (
  params: UpdateLatestActionCardProjectionStatusInput
): Promise<void> => {
  const { data, error } = await supabaseAdmin
    .from("chat_messages")
    .select("id, metadata")
    .eq("org_id", params.orgId)
    .eq("workflow_item_id", params.workflowItem.id)
    .eq("message_type", "action_card")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "db_error", `Failed to query action-card projection: ${error.message}`);
  }
  if (!data) {
    return;
  }

  const row = data as Record<string, unknown>;
  const messageId = asString(row.id, "");
  if (!messageId) {
    return;
  }

  const nextMetadata = patchActionCardMetadataStatus({
    metadata: row.metadata,
    workflowStatus: params.workflowItem.status,
    expectedVersion: params.workflowItem.version,
    workflowItemId: params.workflowItem.id,
    sessionId: params.sessionId
  });

  const { error: updateError } = await supabaseAdmin
    .from("chat_messages")
    .update({ metadata: nextMetadata })
    .eq("org_id", params.orgId)
    .eq("id", messageId);

  if (updateError) {
    throw new HttpError(500, "db_error", `Failed to update action-card projection status: ${updateError.message}`);
  }
};

export const emitCampaignActionCardProjection = async (
  params: EmitCampaignActionCardProjectionInput
): Promise<string> => {
  const campaignProjectionKey = buildProjectionKey({
    channel: DEFAULT_CHAT_CHANNEL,
    workflowItemId: params.workflowItem.id,
    eventType: "campaign_proposed",
    expectedVersion: params.workflowItem.version
  });

  return insertChatMessage({
    orgId: params.orgId,
    sessionId: params.sessionId,
    role: "assistant",
    content: buildCampaignSummary(params.activityFolder, params.plan),
    channel: DEFAULT_CHAT_CHANNEL,
    messageType: "action_card",
    metadata: buildCampaignPlanProjectionMetadata({
      workflowItem: params.workflowItem,
      sessionId: params.sessionId,
      activityFolder: params.activityFolder,
      plan: params.plan
    }),
    workflowItemId: params.workflowItem.id,
    projectionKey: campaignProjectionKey
  });
};

export const emitContentActionCardProjection = async (params: EmitContentActionCardProjectionInput): Promise<string> => {
  const contentProjectionKey = buildProjectionKey({
    channel: DEFAULT_CHAT_CHANNEL,
    workflowItemId: params.workflowItem.id,
    eventType: "content_proposed",
    expectedVersion: params.workflowItem.version
  });

  return insertChatMessage({
    orgId: params.orgId,
    sessionId: params.sessionId,
    role: "assistant",
    content: buildContentSummary(params.channel, params.forbiddenCheck),
    channel: DEFAULT_CHAT_CHANNEL,
    messageType: "action_card",
    metadata: buildContentDraftProjectionMetadata({
      workflowItem: params.workflowItem,
      sessionId: params.sessionId,
      activityFolder: params.activityFolder,
      channel: params.channel,
      draft: params.draft,
      forbiddenCheck: params.forbiddenCheck
    }),
    workflowItemId: params.workflowItem.id,
    projectionKey: contentProjectionKey
  });
};
