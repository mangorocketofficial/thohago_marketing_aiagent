import { HttpError } from "../../lib/errors";
import { supabaseAdmin } from "../../lib/supabase-admin";
import { applyWorkflowAction, linkWorkflowItemOriginChatMessage } from "../../workflow/service";
import type { WorkflowItemRow, WorkflowStatus } from "../../workflow/types";
import type {
  EmitCampaignActionCardProjectionInput,
  EmitContentActionCardProjectionInput,
  InsertChatMessageInput,
  UpdateLatestWorkflowProjectionStatusInput
} from "../chat-projection";
import { resolveChannelContentType } from "../content-type-policy";
import { buildCampaignPlanSummary } from "../service-helpers";
import { generateCampaignPlan } from "../ai";
import type { CampaignPlanChainData } from "../skills/campaign-plan/chain-types";
import type {
  ForbiddenCheckMeta,
  OrchestratorSessionRow,
  OrchestratorStep,
  RagContextMeta,
  SessionState,
  SessionStatus
} from "../types";
import { completeReservedSlotGeneration, reserveNextSlotForGeneration } from "../scheduler-slot-transition";

type EnsureCampaignWorkflowItemForStateInput = {
  session: OrchestratorSessionRow;
  state: SessionState;
  campaignId: string;
  eventIdempotencyKey: string | null;
  campaignPlan?: SessionState["campaign_plan"] | null;
  planChainData?: CampaignPlanChainData | null;
  planDocument?: string | null;
};

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

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const parseCampaignChainData = (value: unknown): CampaignPlanChainData | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as CampaignPlanChainData) : null;

const parseRerunFromStep = (value: unknown): "step_a" | "step_b" | "step_c" | "step_d" | undefined => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "step_a" || normalized === "step_b" || normalized === "step_c" || normalized === "step_d") {
    return normalized;
  }
  return undefined;
};

export type CampaignStepResult = {
  state: SessionState;
  step: OrchestratorStep;
  status: SessionStatus;
};

export type CampaignRejectStepResult = CampaignStepResult & { completed: boolean };

export type CampaignStepDeps = {
  asString: (value: unknown, fallback?: string) => string;
  resolveCampaignId: (state: SessionState, payload?: Record<string, unknown>) => string;
  resolveExpectedVersion: (payload?: Record<string, unknown>) => number | undefined;
  normalizeChannel: (value: unknown) => string;
  buildWorkflowCreateIdempotencyKey: (
    sessionId: string,
    type: "campaign_plan" | "content_draft",
    sourceId: string,
    eventIdempotencyKey: string | null
  ) => string;
  buildWorkflowActionIdempotencyKey: (
    sessionId: string,
    eventType: "campaign_approved" | "campaign_rejected",
    itemId: string,
    eventIdempotencyKey: string | null,
    actionSuffix?: string
  ) => string;
  ensureCampaignWorkflowItemForState: (params: EnsureCampaignWorkflowItemForStateInput) => Promise<WorkflowItemRow>;
  ensureContentWorkflowItemForState: (params: EnsureContentWorkflowItemForStateInput) => Promise<WorkflowItemRow>;
  emitCampaignActionCardProjection: (params: EmitCampaignActionCardProjectionInput) => Promise<string>;
  emitContentActionCardProjection: (params: EmitContentActionCardProjectionInput) => Promise<string>;
  updateLatestWorkflowProjectionStatus: (params: UpdateLatestWorkflowProjectionStatusInput) => Promise<void>;
  mirrorCampaignStatusFromWorkflow: (orgId: string, campaignId: string, workflowStatus: WorkflowStatus) => Promise<void>;
  generateContentDraftWithForbiddenCheck: (
    params: GenerateContentDraftWithForbiddenCheckInput
  ) => Promise<GenerateContentDraftWithForbiddenCheckResult>;
  insertChatMessage: (input: InsertChatMessageInput) => Promise<string>;
  updateTrigger: (triggerId: string, patch: { status?: string; processed_at?: string | null }) => Promise<void>;
};

export const applyUserMessageStep = async (
  session: OrchestratorSessionRow,
  state: SessionState,
  payload: Record<string, unknown> | undefined,
  eventIdempotencyKey: string | null,
  deps: CampaignStepDeps
): Promise<CampaignStepResult> => {
  if (session.current_step !== "await_user_input") {
    throw new HttpError(
      409,
      "invalid_step",
      `Session is at "${session.current_step}" and cannot process user_message event.`
    );
  }

  const userMessage = deps.asString(payload?.content, "").trim();
  if (!userMessage) {
    throw new HttpError(400, "invalid_payload", "payload.content is required for user_message.");
  }

  const rawUiContext =
    payload?.ui_context && typeof payload.ui_context === "object" && !Array.isArray(payload.ui_context)
      ? (payload.ui_context as Record<string, unknown>)
      : null;
  const source = deps.asString(rawUiContext?.source, "").trim();
  const pageId = deps.asString(rawUiContext?.pageId, "").trim();
  const contextPanelMode = deps.asString(rawUiContext?.contextPanelMode, "").trim();
  const focusWorkflowItemId = deps.asString(rawUiContext?.focusWorkflowItemId, "").trim();
  const focusContentId = deps.asString(rawUiContext?.focusContentId, "").trim();
  const focusCampaignId = deps.asString(rawUiContext?.focusCampaignId, "").trim();

  const uiContextMetadata =
    source && pageId
      ? {
          source,
          page_id: pageId,
          ...(contextPanelMode ? { context_panel_mode: contextPanelMode } : {}),
          ...(focusWorkflowItemId ? { focus_workflow_item_id: focusWorkflowItemId } : {}),
          ...(focusContentId ? { focus_content_id: focusContentId } : {}),
          ...(focusCampaignId ? { focus_campaign_id: focusCampaignId } : {})
        }
      : null;

  await deps.insertChatMessage({
    orgId: session.org_id,
    sessionId: session.id,
    userId: session.created_by_user_id,
    role: "user",
    content: userMessage,
    ...(uiContextMetadata ? { metadata: { ui_context: uiContextMetadata } } : {})
  });

  const { plan, ragMeta, chainData, planDocument } = await generateCampaignPlan(
    session.org_id,
    state.activity_folder,
    userMessage,
    {
      orgName: state.activity_folder
    }
  );
  const { data: campaign, error: campaignError } = await supabaseAdmin
    .from("campaigns")
    .insert({
      org_id: session.org_id,
      title: `${state.activity_folder} Campaign`,
      activity_folder: state.activity_folder,
      status: "draft",
      channels: plan.channels,
      plan,
      plan_chain_data: chainData,
      plan_document: planDocument
    })
    .select("id")
    .single();

  if (campaignError || !campaign) {
    throw new HttpError(500, "db_error", `Failed to create campaign: ${campaignError?.message ?? "unknown"}`);
  }

  const campaignId = campaign.id as string;
  const campaignWorkflowItem = await deps.ensureCampaignWorkflowItemForState({
    session,
    state,
    campaignId,
    eventIdempotencyKey,
    campaignPlan: plan,
    planChainData: chainData,
    planDocument
  });
  const summaryMessageId = await deps.emitCampaignActionCardProjection({
    orgId: session.org_id,
    sessionId: session.id,
    workflowItem: campaignWorkflowItem,
    activityFolder: state.activity_folder,
    plan
  });
  await linkWorkflowItemOriginChatMessage({
    orgId: session.org_id,
    itemId: campaignWorkflowItem.id,
    chatMessageId: summaryMessageId
  });

  return {
    state: {
      ...state,
      user_message: userMessage,
      campaign_id: campaignId,
      campaign_workflow_item_id: campaignWorkflowItem.id,
      campaign_plan: plan,
      content_id: null,
      content_workflow_item_id: null,
      content_draft: null,
      rag_context: ragMeta,
      forbidden_check: null,
      last_error: null
    },
    step: "await_campaign_approval",
    status: "paused"
  };
};

export const applyCampaignApprovedStep = async (
  session: OrchestratorSessionRow,
  state: SessionState,
  payload: Record<string, unknown> | undefined,
  eventIdempotencyKey: string | null,
  deps: CampaignStepDeps
): Promise<CampaignStepResult> => {
  if (session.current_step !== "await_campaign_approval") {
    throw new HttpError(
      409,
      "invalid_step",
      `Session is at "${session.current_step}" and cannot process campaign_approved event.`
    );
  }

  const campaignId = deps.resolveCampaignId(state, payload);
  const campaignWorkflowItem = await deps.ensureCampaignWorkflowItemForState({
    session,
    state,
    campaignId,
    eventIdempotencyKey
  });
  const expectedVersion = deps.resolveExpectedVersion(payload) ?? campaignWorkflowItem.version;
  const campaignApproval = await applyWorkflowAction({
    orgId: session.org_id,
    itemId: campaignWorkflowItem.id,
    action: "approved",
    actorType: "user",
    payload: {
      campaign_id: campaignId,
      topic: deps.asString(payload?.topic, "").trim() || null
    },
    expectedVersion,
    idempotencyKey: deps.buildWorkflowActionIdempotencyKey(
      session.id,
      "campaign_approved",
      campaignWorkflowItem.id,
      eventIdempotencyKey,
      "approved"
    )
  });
  await deps.mirrorCampaignStatusFromWorkflow(session.org_id, campaignId, campaignApproval.item.status);
  await deps.updateLatestWorkflowProjectionStatus({
    orgId: session.org_id,
    workflowItem: campaignApproval.item,
    sessionId: session.id
  });

  const firstSchedule = state.campaign_plan?.suggested_schedule?.[0];
  const firstChannel = deps.normalizeChannel(firstSchedule?.channel);
  const firstContentType = resolveChannelContentType({
    channel: firstChannel,
    suggestedType: firstSchedule?.type ?? null,
    sequenceIndex: 0
  });
  const payloadTopic = deps.asString(payload?.topic, "").trim();
  const topic = payloadTopic || deps.asString(state.campaign_plan?.objective, "").trim() || state.activity_folder;
  const reservedSlotId = await reserveNextSlotForGeneration({
    orgId: session.org_id,
    campaignId,
    sessionId: session.id,
    channel: firstChannel,
    contentType: firstContentType
  });

  const generated = await deps.generateContentDraftWithForbiddenCheck({
    orgId: session.org_id,
    activityFolder: state.activity_folder,
    channel: firstChannel,
    topic
  });
  const { draft, ragMeta, forbiddenCheck } = generated;

  const { data: content, error: contentError } = await supabaseAdmin
    .from("contents")
    .insert({
      org_id: session.org_id,
      campaign_id: campaignId,
      channel: firstChannel,
      content_type: firstContentType,
      status: "pending_approval",
      body: draft,
      metadata: {
        phase: "2-3",
        source: "orchestrator",
        rag_context: ragMeta,
        forbidden_check: forbiddenCheck
      },
      created_by: "ai"
    })
    .select("id")
    .single();

  if (contentError || !content) {
    throw new HttpError(500, "db_error", `Failed to create content draft: ${contentError?.message ?? "unknown"}`);
  }

  const contentId = content.id as string;
  const contentWorkflowItem = await deps.ensureContentWorkflowItemForState({
    session,
    state: {
      ...state,
      campaign_id: campaignId,
      content_id: contentId,
      content_draft: draft,
      rag_context: ragMeta,
      forbidden_check: forbiddenCheck
    },
    contentId,
    eventIdempotencyKey
  });
  if (reservedSlotId) {
    await completeReservedSlotGeneration({
      orgId: session.org_id,
      slotId: reservedSlotId,
      contentId,
      workflowItemId: contentWorkflowItem.id,
      sessionId: session.id,
      title: draft.slice(0, 72)
    });
  }
  const contentMessageId = await deps.emitContentActionCardProjection({
    orgId: session.org_id,
    sessionId: session.id,
    workflowItem: contentWorkflowItem,
    activityFolder: state.activity_folder,
    channel: firstChannel,
    draft,
    forbiddenCheck
  });
  await linkWorkflowItemOriginChatMessage({
    orgId: session.org_id,
    itemId: contentWorkflowItem.id,
    chatMessageId: contentMessageId
  });

  return {
    state: {
      ...state,
      campaign_id: campaignId,
      campaign_workflow_item_id: campaignApproval.item.id,
      content_id: contentId,
      content_workflow_item_id: contentWorkflowItem.id,
      content_draft: draft,
      rag_context: ragMeta,
      forbidden_check: forbiddenCheck,
      last_error: null
    },
    step: "await_content_approval",
    status: "paused"
  };
};

export const applyCampaignRevisionStep = async (
  session: OrchestratorSessionRow,
  state: SessionState,
  payload: Record<string, unknown> | undefined,
  eventIdempotencyKey: string | null,
  deps: CampaignStepDeps
): Promise<CampaignStepResult> => {
  if (session.current_step !== "await_campaign_approval") {
    throw new HttpError(
      409,
      "invalid_step",
      `Session is at "${session.current_step}" and cannot process campaign revision event.`
    );
  }

  const campaignId = deps.resolveCampaignId(state, payload);
  const reason = deps.asString(payload?.reason, "").trim();
  if (!reason) {
    throw new HttpError(400, "invalid_payload", "payload.reason is required when payload.mode is revision.");
  }
  const rerunFromStep = parseRerunFromStep(payload?.rerun_from_step);

  const campaignWorkflowItem = await deps.ensureCampaignWorkflowItemForState({
    session,
    state,
    campaignId,
    eventIdempotencyKey
  });
  const expectedVersion = deps.resolveExpectedVersion(payload) ?? campaignWorkflowItem.version;
  const revisionRequested = await applyWorkflowAction({
    orgId: session.org_id,
    itemId: campaignWorkflowItem.id,
    action: "request_revision",
    actorType: "user",
    payload: { mode: "revision", reason, ...(rerunFromStep ? { rerun_from_step: rerunFromStep } : {}) },
    expectedVersion,
    idempotencyKey: deps.buildWorkflowActionIdempotencyKey(
      session.id,
      "campaign_rejected",
      campaignWorkflowItem.id,
      eventIdempotencyKey,
      "request_revision"
    )
  });
  await deps.updateLatestWorkflowProjectionStatus({
    orgId: session.org_id,
    workflowItem: revisionRequested.item,
    sessionId: session.id
  });

  const expectedUpdatedAt = deps.asString(payload?.expected_updated_at, "").trim();
  const { data: campaignSnapshot, error: campaignSnapshotError } = await supabaseAdmin
    .from("campaigns")
    .select("plan, plan_chain_data, updated_at")
    .eq("id", campaignId)
    .eq("org_id", session.org_id)
    .maybeSingle();

  if (campaignSnapshotError) {
    throw new HttpError(500, "db_error", `Failed to read campaign revision base: ${campaignSnapshotError.message}`);
  }
  if (!campaignSnapshot) {
    throw new HttpError(404, "not_found", "Campaign not found for revision.");
  }

  const snapshotRow = asRecord(campaignSnapshot);
  const currentUpdatedAt = deps.asString(snapshotRow.updated_at, "").trim();
  if (expectedUpdatedAt && currentUpdatedAt && expectedUpdatedAt !== currentUpdatedAt) {
    throw new HttpError(409, "version_conflict", "Campaign plan was updated by another request.", {
      campaign_id: campaignId,
      expected_updated_at: expectedUpdatedAt,
      current_updated_at: currentUpdatedAt
    });
  }

  const snapshotPlanRaw = snapshotRow.plan;
  const previousPlan =
    state.campaign_plan ??
    (snapshotPlanRaw && typeof snapshotPlanRaw === "object" && !Array.isArray(snapshotPlanRaw)
      ? (snapshotPlanRaw as SessionState["campaign_plan"])
      : null);
  const previousChainData = parseCampaignChainData(snapshotRow.plan_chain_data);

  const { plan, ragMeta, chainData, planDocument } = await generateCampaignPlan(
    session.org_id,
    state.activity_folder,
    state.user_message ?? "",
    {
      previousPlan,
      previousChainData,
      revisionReason: reason,
      orgName: state.activity_folder,
      rerunFromStep
    }
  );

  let updateCampaignQuery = supabaseAdmin
    .from("campaigns")
    .update({
      status: "draft",
      channels: plan.channels,
      plan,
      plan_chain_data: chainData,
      plan_document: planDocument
    })
    .eq("id", campaignId)
    .eq("org_id", session.org_id);

  if (expectedUpdatedAt) {
    updateCampaignQuery = updateCampaignQuery.eq("updated_at", expectedUpdatedAt);
  }

  const { data: updatedCampaign, error: updateCampaignError } = await updateCampaignQuery.select("id").maybeSingle();
  if (updateCampaignError) {
    throw new HttpError(500, "db_error", `Failed to apply revised campaign plan: ${updateCampaignError.message}`);
  }
  if (!updatedCampaign) {
    throw new HttpError(409, "version_conflict", "Campaign plan was updated during revision request.");
  }

  const resubmitted = await applyWorkflowAction({
    orgId: session.org_id,
    itemId: campaignWorkflowItem.id,
    action: "resubmitted",
    actorType: "assistant",
    payload: {
      mode: "revision",
      reason,
      ...(rerunFromStep ? { rerun_from_step: rerunFromStep } : {}),
      plan,
      plan_document: planDocument,
      plan_summary: buildCampaignPlanSummary({ plan, planChainData: chainData })
    },
    expectedVersion: revisionRequested.item.version,
    idempotencyKey: deps.buildWorkflowActionIdempotencyKey(
      session.id,
      "campaign_rejected",
      campaignWorkflowItem.id,
      eventIdempotencyKey,
      "resubmitted"
    )
  });
  await deps.mirrorCampaignStatusFromWorkflow(session.org_id, campaignId, resubmitted.item.status);

  const messageId = await deps.emitCampaignActionCardProjection({
    orgId: session.org_id,
    sessionId: session.id,
    workflowItem: resubmitted.item,
    activityFolder: state.activity_folder,
    plan
  });
  await linkWorkflowItemOriginChatMessage({
    orgId: session.org_id,
    itemId: resubmitted.item.id,
    chatMessageId: messageId
  });

  return {
    state: {
      ...state,
      campaign_id: campaignId,
      campaign_workflow_item_id: resubmitted.item.id,
      campaign_plan: plan,
      rag_context: ragMeta,
      last_error: null
    },
    step: "await_campaign_approval",
    status: "paused"
  };
};

const applyCampaignTerminalRejectStep = async (
  session: OrchestratorSessionRow,
  state: SessionState,
  payload: Record<string, unknown> | undefined,
  eventIdempotencyKey: string | null,
  deps: CampaignStepDeps
): Promise<CampaignRejectStepResult> => {
  const reason = deps.asString(payload?.reason, "").trim();
  const campaignId = deps.resolveCampaignId(state, payload);
  const campaignWorkflowItem = await deps.ensureCampaignWorkflowItemForState({
    session,
    state,
    campaignId,
    eventIdempotencyKey
  });
  const expectedVersion = deps.resolveExpectedVersion(payload) ?? campaignWorkflowItem.version;
  const campaignRejection = await applyWorkflowAction({
    orgId: session.org_id,
    itemId: campaignWorkflowItem.id,
    action: "rejected",
    actorType: "user",
    payload: reason ? { reason } : {},
    expectedVersion,
    idempotencyKey: deps.buildWorkflowActionIdempotencyKey(
      session.id,
      "campaign_rejected",
      campaignWorkflowItem.id,
      eventIdempotencyKey,
      "rejected"
    )
  });
  await deps.updateLatestWorkflowProjectionStatus({
    orgId: session.org_id,
    workflowItem: campaignRejection.item,
    sessionId: session.id
  });
  await deps.mirrorCampaignStatusFromWorkflow(session.org_id, campaignId, campaignRejection.item.status);

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
      campaign_workflow_item_id: campaignRejection.item.id,
      last_error: reason || "rejected_by_user"
    },
    step: session.current_step,
    status: "failed",
    completed: true
  };
};

export const applyCampaignRejectStep = async (
  session: OrchestratorSessionRow,
  state: SessionState,
  payload: Record<string, unknown> | undefined,
  eventIdempotencyKey: string | null,
  deps: CampaignStepDeps
): Promise<CampaignRejectStepResult> => {
  const mode = deps.asString(payload?.mode, "").trim().toLowerCase();
  if (mode === "revision") {
    const next = await applyCampaignRevisionStep(session, state, payload, eventIdempotencyKey, deps);
    return { ...next, completed: false };
  }

  return applyCampaignTerminalRejectStep(session, state, payload, eventIdempotencyKey, deps);
};
