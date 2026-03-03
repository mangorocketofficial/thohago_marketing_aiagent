import type { CampaignPlan, ForbiddenCheckMeta } from "../orchestrator/types";
import type { WorkflowItemRow, WorkflowStatus } from "./types";

export type ProjectionCardType = "campaign_plan" | "content_draft" | "content_generation_request";
export type ProjectionEventType = "campaign_proposed" | "content_proposed" | "content_generation_requested";
export type ProjectionChannel = "dashboard";

type ProjectionActionEventType =
  | "campaign_approved"
  | "campaign_rejected"
  | "content_approved"
  | "content_rejected";

export type WorkflowActionCardAction = {
  id: "approve" | "request_revision" | "reject";
  label: string;
  event_type: ProjectionActionEventType;
  mode?: "revision";
  disabled?: boolean;
};

type CampaignPlanCardData = {
  title: string;
  channels: string[];
  post_count: number;
  date_range: {
    start: string;
    end: string;
  };
};

type ContentDraftCardData = {
  title: string;
  channel: string;
  body_preview: string;
  body_full?: string;
  media_urls: string[];
};

export type WorkflowActionCardMetadata = {
  projection_type: "workflow_action_card";
  card_type: ProjectionCardType;
  workflow_item_id: string;
  workflow_status: WorkflowStatus;
  expected_version: number;
  session_id: string;
  actions: WorkflowActionCardAction[];
  card_data: CampaignPlanCardData | ContentDraftCardData | Record<string, unknown>;
};

const isResolvedStatus = (status: WorkflowStatus): boolean => status !== "proposed";

const disableActionsIfResolved = (actions: WorkflowActionCardAction[], status: WorkflowStatus): WorkflowActionCardAction[] =>
  isResolvedStatus(status) ? actions.map((action) => ({ ...action, disabled: true })) : actions;

const formatDateOnly = (value: Date): string => {
  const year = value.getUTCFullYear();
  const month = `${value.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${value.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const computeDateRange = (durationDays: number, startFromIso?: string): { start: string; end: string } => {
  const safeDuration = Number.isFinite(durationDays) ? Math.max(1, Math.floor(durationDays)) : 1;
  const startBase = startFromIso ? new Date(startFromIso) : new Date();
  const start = Number.isNaN(startBase.getTime()) ? new Date() : startBase;
  const end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + Math.max(0, safeDuration - 1));
  return {
    start: formatDateOnly(start),
    end: formatDateOnly(end)
  };
};

const toCardTitle = (activityFolder: string, fallback: string): string => {
  const trimmed = activityFolder.trim();
  return trimmed ? `${trimmed} Campaign` : fallback;
};

const truncatePreview = (value: string, maxLength = 240): string => {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
};

const campaignActions = (status: WorkflowStatus): WorkflowActionCardAction[] =>
  disableActionsIfResolved(
    [
      { id: "approve", label: "Approve", event_type: "campaign_approved" },
      {
        id: "request_revision",
        label: "Request Revision",
        event_type: "campaign_rejected",
        mode: "revision"
      },
      { id: "reject", label: "Reject", event_type: "campaign_rejected" }
    ],
    status
  );

const contentActions = (status: WorkflowStatus): WorkflowActionCardAction[] =>
  disableActionsIfResolved(
    [
      { id: "approve", label: "Approve", event_type: "content_approved" },
      {
        id: "request_revision",
        label: "Request Revision",
        event_type: "content_rejected",
        mode: "revision"
      },
      { id: "reject", label: "Reject", event_type: "content_rejected" }
    ],
    status
  );

export const buildProjectionKey = (params: {
  channel: ProjectionChannel;
  workflowItemId: string;
  eventType: ProjectionEventType;
  expectedVersion: number;
}): string =>
  `wf_card:${params.channel}:${params.workflowItemId}:${params.eventType}:v${Math.max(1, Math.floor(params.expectedVersion))}`;

export const buildCampaignPlanProjectionMetadata = (params: {
  workflowItem: WorkflowItemRow;
  sessionId: string;
  activityFolder: string;
  plan: CampaignPlan;
}): WorkflowActionCardMetadata => ({
  projection_type: "workflow_action_card",
  card_type: "campaign_plan",
  workflow_item_id: params.workflowItem.id,
  workflow_status: params.workflowItem.status,
  expected_version: params.workflowItem.version,
  session_id: params.sessionId,
  actions: campaignActions(params.workflowItem.status),
  card_data: {
    title: toCardTitle(params.activityFolder, "Campaign Plan"),
    channels: params.plan.channels,
    post_count: params.plan.post_count,
    date_range: computeDateRange(params.plan.duration_days, params.workflowItem.created_at)
  }
});

export const buildContentDraftProjectionMetadata = (params: {
  workflowItem: WorkflowItemRow;
  sessionId: string;
  activityFolder: string;
  channel: string;
  draft: string;
  forbiddenCheck: ForbiddenCheckMeta | null;
}): WorkflowActionCardMetadata => ({
  projection_type: "workflow_action_card",
  card_type: "content_draft",
  workflow_item_id: params.workflowItem.id,
  workflow_status: params.workflowItem.status,
  expected_version: params.workflowItem.version,
  session_id: params.sessionId,
  actions: contentActions(params.workflowItem.status),
  card_data: {
    title: `${toCardTitle(params.activityFolder, "Content Draft")} - ${params.channel}`,
    channel: params.channel,
    body_preview: truncatePreview(params.draft),
    body_full: params.draft,
    media_urls: [],
    ...(params.forbiddenCheck && !params.forbiddenCheck.passed
      ? {
          forbidden_violations: params.forbiddenCheck.violations
        }
      : {})
  }
});

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const inferActions = (cardType: ProjectionCardType, status: WorkflowStatus): WorkflowActionCardAction[] => {
  if (cardType === "campaign_plan") {
    return campaignActions(status);
  }
  if (cardType === "content_draft") {
    return contentActions(status);
  }
  return disableActionsIfResolved([], status);
};

export const patchActionCardMetadataStatus = (params: {
  metadata: unknown;
  workflowStatus: WorkflowStatus;
  expectedVersion: number;
  workflowItemId?: string;
  sessionId?: string;
}): WorkflowActionCardMetadata => {
  const metadata = asRecord(params.metadata);
  const cardType = (metadata.card_type as ProjectionCardType | undefined) ?? "campaign_plan";
  const actionsRaw = Array.isArray(metadata.actions) ? metadata.actions : [];
  const parsedActions: WorkflowActionCardAction[] = [];
  for (const entry of actionsRaw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const row = entry as Record<string, unknown>;
    const id = row.id;
    const label = row.label;
    const eventType = row.event_type;
    if (typeof id !== "string" || typeof label !== "string" || typeof eventType !== "string") {
      continue;
    }
    parsedActions.push({
      id: id as WorkflowActionCardAction["id"],
      label,
      event_type: eventType as ProjectionActionEventType,
      ...(row.mode === "revision" ? { mode: "revision" } : {})
    });
  }
  const actions =
    parsedActions.length > 0
      ? disableActionsIfResolved(parsedActions, params.workflowStatus)
      : inferActions(cardType, params.workflowStatus);

  return {
    projection_type: "workflow_action_card",
    card_type: cardType,
    workflow_item_id:
      typeof metadata.workflow_item_id === "string" && metadata.workflow_item_id.trim()
        ? metadata.workflow_item_id.trim()
        : params.workflowItemId ?? "",
    workflow_status: params.workflowStatus,
    expected_version: Math.max(1, Math.floor(params.expectedVersion)),
    session_id: typeof metadata.session_id === "string" ? metadata.session_id : (params.sessionId ?? ""),
    actions,
    card_data: asRecord(metadata.card_data),
    ...(isResolvedStatus(params.workflowStatus) ? { resolved_at: new Date().toISOString() } : {})
  };
};
