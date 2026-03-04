import { HttpError } from "../lib/errors";
import { supabaseAdmin } from "../lib/supabase-admin";
import {
  buildProjectionKey,
  patchActionCardMetadataStatus
} from "../workflow/projection";
import type { WorkflowItemRow } from "../workflow/types";
import type { CampaignPlan, ForbiddenCheckMeta } from "./types";

export const DEFAULT_CHAT_CHANNEL = "dashboard";

export type ChatMessageType = "text" | "action_card" | "system";
export type ChatChannel = "dashboard" | "telegram";
type WorkflowNotificationCardType = "campaign_plan" | "content_draft";

type WorkflowSystemNotificationMetadata = {
  notification_type: "workflow_proposed";
  workflow_item_id: string;
  card_type: WorkflowNotificationCardType;
  display_title: string;
  workflow_status?: WorkflowItemRow["status"];
  expected_version?: number;
  resolved_at?: string;
};

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

export type UpdateLatestWorkflowProjectionStatusInput = {
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

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const buildSystemWorkflowMetadata = (params: {
  workflowItem: WorkflowItemRow;
  cardType: WorkflowNotificationCardType;
  displayTitle: string;
}): WorkflowSystemNotificationMetadata => ({
  notification_type: "workflow_proposed",
  workflow_item_id: params.workflowItem.id,
  card_type: params.cardType,
  display_title: params.displayTitle,
  workflow_status: params.workflowItem.status,
  expected_version: params.workflowItem.version
});

const patchSystemWorkflowMetadataStatus = (params: {
  metadata: unknown;
  workflowItem: WorkflowItemRow;
}): WorkflowSystemNotificationMetadata => {
  const metadata = asRecord(params.metadata);
  const cardType =
    metadata.card_type === "campaign_plan" || metadata.card_type === "content_draft"
      ? metadata.card_type
      : params.workflowItem.type === "content_draft"
        ? "content_draft"
        : "campaign_plan";
  const displayTitle = asString(metadata.display_title, params.workflowItem.display_title ?? "");

  return {
    notification_type: "workflow_proposed",
    workflow_item_id: params.workflowItem.id,
    card_type: cardType,
    display_title: displayTitle || params.workflowItem.id,
    workflow_status: params.workflowItem.status,
    expected_version: params.workflowItem.version,
    ...(params.workflowItem.status === "proposed" ? {} : { resolved_at: new Date().toISOString() })
  };
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

export const updateLatestWorkflowProjectionStatus = async (
  params: UpdateLatestWorkflowProjectionStatusInput
): Promise<void> => {
  const { data, error } = await supabaseAdmin
    .from("chat_messages")
    .select("id, message_type, metadata")
    .eq("org_id", params.orgId)
    .eq("workflow_item_id", params.workflowItem.id)
    .in("message_type", ["action_card", "system"])
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

  const messageType = asString(row.message_type, "");
  const nextMetadata =
    messageType === "system"
      ? patchSystemWorkflowMetadataStatus({
          metadata: row.metadata,
          workflowItem: params.workflowItem
        })
      : patchActionCardMetadataStatus({
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
    throw new HttpError(500, "db_error", `Failed to update workflow projection status: ${updateError.message}`);
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
    messageType: "system",
    metadata: buildSystemWorkflowMetadata({
      workflowItem: params.workflowItem,
      cardType: "campaign_plan",
      displayTitle: params.workflowItem.display_title ?? params.activityFolder
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
    messageType: "system",
    metadata: buildSystemWorkflowMetadata({
      workflowItem: params.workflowItem,
      cardType: "content_draft",
      displayTitle: params.workflowItem.display_title ?? `${params.activityFolder} - ${params.channel}`
    }),
    workflowItemId: params.workflowItem.id,
    projectionKey: contentProjectionKey
  });
};
