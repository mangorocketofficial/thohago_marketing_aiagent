export type WorkflowItemType =
  | "campaign_plan"
  | "content_draft"
  | "content_generation_request"
  | "generic_approval";

export type WorkflowStatus = "proposed" | "revision_requested" | "approved" | "rejected";

export type WorkflowAction = "proposed" | "request_revision" | "resubmitted" | "approved" | "rejected";

export type WorkflowActorType = "user" | "assistant" | "system";

export type WorkflowItemPayload = Record<string, unknown>;

export type WorkflowItemRow = {
  id: string;
  org_id: string;
  session_id: string | null;
  display_title: string | null;
  type: WorkflowItemType;
  status: WorkflowStatus;
  payload: WorkflowItemPayload;
  origin_chat_message_id: string | null;
  source_campaign_id: string | null;
  source_content_id: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export type WorkflowEventRow = {
  id: string;
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
  created_at: string;
};

export type CreateWorkflowItemInput = {
  orgId: string;
  sessionId?: string | null;
  displayTitle?: string | null;
  type: WorkflowItemType;
  status?: WorkflowStatus;
  payload?: WorkflowItemPayload;
  originChatMessageId?: string | null;
  sourceCampaignId?: string | null;
  sourceContentId?: string | null;
  actorType?: WorkflowActorType;
  actorUserId?: string | null;
  idempotencyKey?: string | null;
};

export type ApplyWorkflowActionInput = {
  orgId: string;
  itemId: string;
  action: WorkflowAction;
  actorType: WorkflowActorType;
  actorUserId?: string | null;
  payload?: WorkflowItemPayload;
  expectedVersion?: number | null;
  idempotencyKey: string;
};

export type ApplyWorkflowActionResult = {
  item: WorkflowItemRow;
  event: WorkflowEventRow;
  idempotent: boolean;
};
