import { HttpError } from "../../lib/errors";
import { supabaseAdmin } from "../../lib/supabase-admin";
import { applyWorkflowAction, linkWorkflowItemOriginChatMessage } from "../../workflow/service";
import type { WorkflowItemRow, WorkflowStatus } from "../../workflow/types";
import type {
  EmitContentActionCardProjectionInput,
  InsertChatMessageInput,
  UpdateLatestActionCardProjectionStatusInput
} from "../chat-projection";
import type { ContentApprovalSideEffectsInput } from "../side-effects";
import type {
  ForbiddenCheckMeta,
  OrchestratorSessionRow,
  OrchestratorStep,
  RagContextMeta,
  SessionState,
  SessionStatus
} from "../types";

type EnsureContentWorkflowItemForStateInput = {
  session: OrchestratorSessionRow;
  state: SessionState;
  contentId: string;
  originChatMessageId?: string | null;
  eventIdempotencyKey: string | null;
};

type GenerateContentDraftWithForbiddenCheckInput = {
  orgId: string;
  activityFolder: string;
  channel: string;
  topic: string;
  revisionReason?: string;
  previousDraft?: string;
};

type GenerateContentDraftWithForbiddenCheckResult = {
  draft: string;
  ragMeta: RagContextMeta;
  forbiddenCheck: ForbiddenCheckMeta;
};

export type ContentStepResult = {
  state: SessionState;
  step: OrchestratorStep;
  status: SessionStatus;
};

export type ContentApprovedStepResult = ContentStepResult & { completed: true };
export type ContentRejectStepResult = ContentStepResult & { completed: boolean };

export type ContentStepDeps = {
  asString: (value: unknown, fallback?: string) => string;
  asRecord: (value: unknown) => Record<string, unknown>;
  normalizeChannel: (value: unknown) => string;
  resolveContentId: (state: SessionState, payload?: Record<string, unknown>) => string;
  resolveExpectedVersion: (payload?: Record<string, unknown>) => number | undefined;
  buildWorkflowActionIdempotencyKey: (
    sessionId: string,
    eventType: "content_approved" | "content_rejected",
    itemId: string,
    eventIdempotencyKey: string | null,
    actionSuffix?: string
  ) => string;
  ensureContentWorkflowItemForState: (params: EnsureContentWorkflowItemForStateInput) => Promise<WorkflowItemRow>;
  updateLatestActionCardProjectionStatus: (params: UpdateLatestActionCardProjectionStatusInput) => Promise<void>;
  mirrorContentStatusFromWorkflow: (params: {
    orgId: string;
    contentId: string;
    workflowStatus: WorkflowStatus;
    editedBody?: string;
    publishedAt?: string;
  }) => Promise<void>;
  emitContentActionCardProjection: (params: EmitContentActionCardProjectionInput) => Promise<string>;
  generateContentDraftWithForbiddenCheck: (
    params: GenerateContentDraftWithForbiddenCheckInput
  ) => Promise<GenerateContentDraftWithForbiddenCheckResult>;
  insertChatMessage: (input: InsertChatMessageInput) => Promise<string>;
  updateTrigger: (triggerId: string, patch: { status?: string; processed_at?: string | null }) => Promise<void>;
  runContentApprovalSideEffects: (params: ContentApprovalSideEffectsInput) => void;
};

export const applyContentApprovedStep = async (
  session: OrchestratorSessionRow,
  state: SessionState,
  payload: Record<string, unknown> | undefined,
  eventIdempotencyKey: string | null,
  deps: ContentStepDeps
): Promise<ContentApprovedStepResult> => {
  if (session.current_step !== "await_content_approval") {
    throw new HttpError(
      409,
      "invalid_step",
      `Session is at "${session.current_step}" and cannot process content_approved event.`
    );
  }

  const contentId = deps.resolveContentId(state, payload);
  const editedBody = deps.asString(payload?.edited_body, "").trim();
  const publishedAt = new Date().toISOString();
  const editPatternChannel = deps.normalizeChannel(state.campaign_plan?.suggested_schedule?.[0]?.channel);
  const contentWorkflowItem = await deps.ensureContentWorkflowItemForState({
    session,
    state,
    contentId,
    eventIdempotencyKey
  });
  const expectedVersion = deps.resolveExpectedVersion(payload) ?? contentWorkflowItem.version;
  const contentApproval = await applyWorkflowAction({
    orgId: session.org_id,
    itemId: contentWorkflowItem.id,
    action: "approved",
    actorType: "user",
    payload: {
      content_id: contentId,
      ...(editedBody ? { edited_body: editedBody } : {})
    },
    expectedVersion,
    idempotencyKey: deps.buildWorkflowActionIdempotencyKey(
      session.id,
      "content_approved",
      contentWorkflowItem.id,
      eventIdempotencyKey,
      "approved"
    )
  });
  await deps.updateLatestActionCardProjectionStatus({
    orgId: session.org_id,
    workflowItem: contentApproval.item,
    sessionId: session.id
  });
  await deps.mirrorContentStatusFromWorkflow({
    orgId: session.org_id,
    contentId,
    workflowStatus: contentApproval.item.status,
    editedBody,
    publishedAt
  });

  if (state.campaign_id) {
    const { error: campaignError } = await supabaseAdmin
      .from("campaigns")
      .update({ status: "active" })
      .eq("id", state.campaign_id)
      .eq("org_id", session.org_id);

    if (campaignError) {
      throw new HttpError(500, "db_error", `Failed to update campaign status: ${campaignError.message}`);
    }
  }

  await deps.insertChatMessage({
    orgId: session.org_id,
    sessionId: session.id,
    role: "assistant",
    content: "콘텐츠 게시가 완료되었습니다(시뮬레이션)."
  });

  deps.runContentApprovalSideEffects({
    orgId: session.org_id,
    contentId,
    previousDraft: state.content_draft,
    editedBody,
    editPatternChannel
  });

  await deps.updateTrigger(state.trigger_id, { status: "done" });

  return {
    state: {
      ...state,
      content_id: contentId,
      content_workflow_item_id: contentApproval.item.id,
      last_error: null
    },
    step: "done",
    status: "done",
    completed: true
  };
};

export const applyContentRevisionStep = async (
  session: OrchestratorSessionRow,
  state: SessionState,
  payload: Record<string, unknown> | undefined,
  eventIdempotencyKey: string | null,
  deps: ContentStepDeps
): Promise<ContentStepResult> => {
  if (session.current_step !== "await_content_approval") {
    throw new HttpError(
      409,
      "invalid_step",
      `Session is at "${session.current_step}" and cannot process content revision event.`
    );
  }

  const contentId = deps.resolveContentId(state, payload);
  const reason = deps.asString(payload?.reason, "").trim();
  if (!reason) {
    throw new HttpError(400, "invalid_payload", "payload.reason is required when payload.mode is revision.");
  }

  const contentWorkflowItem = await deps.ensureContentWorkflowItemForState({
    session,
    state,
    contentId,
    eventIdempotencyKey
  });
  const expectedVersion = deps.resolveExpectedVersion(payload) ?? contentWorkflowItem.version;
  const revisionRequested = await applyWorkflowAction({
    orgId: session.org_id,
    itemId: contentWorkflowItem.id,
    action: "request_revision",
    actorType: "user",
    payload: { mode: "revision", reason },
    expectedVersion,
    idempotencyKey: deps.buildWorkflowActionIdempotencyKey(
      session.id,
      "content_rejected",
      contentWorkflowItem.id,
      eventIdempotencyKey,
      "request_revision"
    )
  });
  await deps.updateLatestActionCardProjectionStatus({
    orgId: session.org_id,
    workflowItem: revisionRequested.item,
    sessionId: session.id
  });

  const { data: contentRow, error: contentReadError } = await supabaseAdmin
    .from("contents")
    .select("channel, body, metadata")
    .eq("org_id", session.org_id)
    .eq("id", contentId)
    .maybeSingle();
  if (contentReadError) {
    throw new HttpError(500, "db_error", `Failed to read content for revision: ${contentReadError.message}`);
  }
  if (!contentRow) {
    throw new HttpError(404, "not_found", "Content not found for revision.");
  }

  const channel = deps.normalizeChannel((contentRow as Record<string, unknown>).channel);
  const previousDraft = deps.asString((contentRow as Record<string, unknown>).body, state.content_draft ?? "");
  const topicHint = deps.asString(state.campaign_plan?.suggested_schedule?.[0]?.type, "").trim();
  const generated = await deps.generateContentDraftWithForbiddenCheck({
    orgId: session.org_id,
    activityFolder: state.activity_folder,
    channel,
    topic: topicHint || state.activity_folder,
    revisionReason: reason,
    previousDraft
  });

  const nextMetadata = {
    ...deps.asRecord((contentRow as Record<string, unknown>).metadata),
    phase: "3-3",
    source: "orchestrator_revision",
    rag_context: generated.ragMeta,
    forbidden_check: generated.forbiddenCheck,
    revision_reason: reason,
    revised_at: new Date().toISOString()
  };

  const { error: contentUpdateError } = await supabaseAdmin
    .from("contents")
    .update({
      channel,
      status: "pending_approval",
      body: generated.draft,
      metadata: nextMetadata,
      published_at: null
    })
    .eq("org_id", session.org_id)
    .eq("id", contentId);
  if (contentUpdateError) {
    throw new HttpError(500, "db_error", `Failed to apply revised content draft: ${contentUpdateError.message}`);
  }

  const resubmitted = await applyWorkflowAction({
    orgId: session.org_id,
    itemId: contentWorkflowItem.id,
    action: "resubmitted",
    actorType: "assistant",
    payload: {
      mode: "revision",
      reason,
      draft: generated.draft,
      channel,
      rag_context: generated.ragMeta,
      forbidden_check: generated.forbiddenCheck
    },
    expectedVersion: revisionRequested.item.version,
    idempotencyKey: deps.buildWorkflowActionIdempotencyKey(
      session.id,
      "content_rejected",
      contentWorkflowItem.id,
      eventIdempotencyKey,
      "resubmitted"
    )
  });
  await deps.mirrorContentStatusFromWorkflow({
    orgId: session.org_id,
    contentId,
    workflowStatus: resubmitted.item.status
  });

  const messageId = await deps.emitContentActionCardProjection({
    orgId: session.org_id,
    sessionId: session.id,
    workflowItem: resubmitted.item,
    activityFolder: state.activity_folder,
    channel,
    draft: generated.draft,
    forbiddenCheck: generated.forbiddenCheck
  });
  await linkWorkflowItemOriginChatMessage({
    orgId: session.org_id,
    itemId: resubmitted.item.id,
    chatMessageId: messageId
  });

  return {
    state: {
      ...state,
      content_id: contentId,
      content_workflow_item_id: resubmitted.item.id,
      content_draft: generated.draft,
      rag_context: generated.ragMeta,
      forbidden_check: generated.forbiddenCheck,
      last_error: null
    },
    step: "await_content_approval",
    status: "paused"
  };
};

const applyContentTerminalRejectStep = async (
  session: OrchestratorSessionRow,
  state: SessionState,
  payload: Record<string, unknown> | undefined,
  eventIdempotencyKey: string | null,
  deps: ContentStepDeps
): Promise<ContentRejectStepResult> => {
  const reason = deps.asString(payload?.reason, "").trim();
  const contentId = deps.resolveContentId(state, payload);
  const contentWorkflowItem = await deps.ensureContentWorkflowItemForState({
    session,
    state,
    contentId,
    eventIdempotencyKey
  });
  const expectedVersion = deps.resolveExpectedVersion(payload) ?? contentWorkflowItem.version;
  const contentRejection = await applyWorkflowAction({
    orgId: session.org_id,
    itemId: contentWorkflowItem.id,
    action: "rejected",
    actorType: "user",
    payload: reason ? { reason } : {},
    expectedVersion,
    idempotencyKey: deps.buildWorkflowActionIdempotencyKey(
      session.id,
      "content_rejected",
      contentWorkflowItem.id,
      eventIdempotencyKey,
      "rejected"
    )
  });
  await deps.updateLatestActionCardProjectionStatus({
    orgId: session.org_id,
    workflowItem: contentRejection.item,
    sessionId: session.id
  });
  await deps.mirrorContentStatusFromWorkflow({
    orgId: session.org_id,
    contentId,
    workflowStatus: contentRejection.item.status
  });

  await deps.insertChatMessage({
    orgId: session.org_id,
    sessionId: session.id,
    role: "assistant",
    content: reason
      ? `요청을 반영했습니다. 세션을 종료합니다. 사유: ${reason}`
      : "요청을 반영했습니다. 세션을 종료합니다."
  });
  await deps.updateTrigger(state.trigger_id, { status: "failed" });

  return {
    state: {
      ...state,
      content_workflow_item_id: contentRejection.item.id,
      last_error: reason || "rejected_by_user"
    },
    step: session.current_step,
    status: "failed",
    completed: true
  };
};

export const applyContentRejectStep = async (
  session: OrchestratorSessionRow,
  state: SessionState,
  payload: Record<string, unknown> | undefined,
  eventIdempotencyKey: string | null,
  deps: ContentStepDeps
): Promise<ContentRejectStepResult> => {
  const mode = deps.asString(payload?.mode, "").trim().toLowerCase();
  if (mode === "revision") {
    const next = await applyContentRevisionStep(session, state, payload, eventIdempotencyKey, deps);
    return { ...next, completed: false };
  }

  return applyContentTerminalRejectStep(session, state, payload, eventIdempotencyKey, deps);
};
