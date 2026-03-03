import { env } from "../lib/env";
import { randomUUID } from "node:crypto";
import { HttpError } from "../lib/errors";
import { supabaseAdmin } from "../lib/supabase-admin";
import { onContentEdited } from "../rag/ingest-edit-pattern";
import { onContentPublished } from "../rag/ingest-content";
import { invalidateMemoryCache } from "../rag/memory-service";
import { applyWorkflowAction, ensureCampaignWorkflowItem, ensureContentWorkflowItem } from "../workflow/service";
import type { WorkflowItemRow, WorkflowStatus } from "../workflow/types";
import { generateCampaignPlan, generateContentDraft, generateDetectMessage } from "./ai";
import { checkForbiddenWords } from "./forbidden-check";
import type {
  CampaignPlan,
  EnqueueTriggerResult,
  ForbiddenCheckMeta,
  OrchestratorSessionRow,
  OrchestratorStep,
  PipelineTriggerRow,
  RagContextMeta,
  ResumeEventRequest,
  ResumeSessionResult,
  SessionState,
  SessionStatus
} from "./types";

const ACTIVE_SESSION_STATUSES: SessionStatus[] = ["running", "paused"];
const CHANNEL_SET = new Set(["instagram", "threads", "naver_blog", "facebook", "youtube"]);

const lockQueueByKey = new Map<string, Promise<void>>();

const withLock = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
  const previous = lockQueueByKey.get(key) ?? Promise.resolve();

  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });

  lockQueueByKey.set(key, previous.then(() => current));
  await previous;

  try {
    return await fn();
  } finally {
    releaseCurrent();
    if (lockQueueByKey.get(key) === current) {
      lockQueueByKey.delete(key);
    }
  }
};

const asString = (value: unknown, fallback = ""): string => {
  if (typeof value === "string") {
    return value;
  }
  return fallback;
};

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
};

const normalizeStep = (value: unknown): OrchestratorStep => {
  const step = asString(value);
  switch (step) {
    case "detect":
    case "await_user_input":
    case "await_campaign_approval":
    case "generate_content":
    case "await_content_approval":
    case "publish":
    case "done":
      return step;
    default:
      return "detect";
  }
};

const parseCampaignPlan = (value: unknown): CampaignPlan | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const row = value as Record<string, unknown>;
  if (!Array.isArray(row.channels) || !Array.isArray(row.content_types)) {
    return null;
  }

  const schedule = Array.isArray(row.suggested_schedule)
    ? row.suggested_schedule
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }

          const item = entry as Record<string, unknown>;
          const dayRaw = item.day;
          const day = typeof dayRaw === "number" && Number.isFinite(dayRaw) ? Math.max(1, Math.floor(dayRaw)) : 1;
          return {
            day,
            channel: asString(item.channel, "instagram").toLowerCase(),
            type: asString(item.type, "text")
          };
        })
        .filter((entry): entry is { day: number; channel: string; type: string } => !!entry)
    : [];

  return {
    objective: asString(row.objective, ""),
    channels: asStringArray(row.channels).map((entry) => entry.toLowerCase()),
    duration_days:
      typeof row.duration_days === "number" && Number.isFinite(row.duration_days)
        ? Math.max(1, Math.floor(row.duration_days))
        : 7,
    post_count:
      typeof row.post_count === "number" && Number.isFinite(row.post_count)
        ? Math.max(1, Math.floor(row.post_count))
        : 1,
    content_types: asStringArray(row.content_types),
    suggested_schedule: schedule
  };
};

const parseContextLevel = (value: unknown): RagContextMeta["context_level"] => {
  const level = asString(value, "");
  if (level === "full" || level === "tier1_only" || level === "no_context") {
    return level;
  }
  return "no_context";
};

const parseRagContextMeta = (value: unknown): RagContextMeta | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const row = value as Record<string, unknown>;
  const memoryGeneratedAt =
    row.memory_md_generated_at === null
      ? null
      : typeof row.memory_md_generated_at === "string" && row.memory_md_generated_at.trim()
        ? row.memory_md_generated_at.trim()
        : null;
  const tier2Sources = Array.isArray(row.tier2_sources)
    ? row.tier2_sources
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const source = entry as Record<string, unknown>;
          return {
            id: asString(source.id, ""),
            source_type: asString(source.source_type, ""),
            source_id: asString(source.source_id, ""),
            similarity:
              typeof source.similarity === "number" && Number.isFinite(source.similarity) ? source.similarity : 0
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => !!entry && !!entry.id)
    : [];

  return {
    context_level: parseContextLevel(row.context_level),
    memory_md_generated_at: memoryGeneratedAt,
    tier2_sources: tier2Sources,
    total_context_tokens:
      typeof row.total_context_tokens === "number" && Number.isFinite(row.total_context_tokens)
        ? Math.max(0, Math.floor(row.total_context_tokens))
        : 0,
    retrieval_avg_similarity:
      typeof row.retrieval_avg_similarity === "number" && Number.isFinite(row.retrieval_avg_similarity)
        ? row.retrieval_avg_similarity
        : null
  };
};

const parseForbiddenCheckMeta = (value: unknown): ForbiddenCheckMeta | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const row = value as Record<string, unknown>;
  return {
    passed: row.passed === true,
    violations: asStringArray(row.violations),
    regenerated: row.regenerated === true
  };
};

const emptyStateFromTrigger = (trigger: PipelineTriggerRow): SessionState => ({
  trigger_id: trigger.id,
  activity_folder: trigger.activity_folder,
  file_name: trigger.file_name,
  file_type: trigger.file_type,
  user_message: null,
  campaign_id: null,
  campaign_workflow_item_id: null,
  campaign_plan: null,
  content_id: null,
  content_workflow_item_id: null,
  content_draft: null,
  rag_context: null,
  forbidden_check: null,
  processed_event_ids: [],
  last_error: null
});

const parseState = (raw: unknown, trigger: PipelineTriggerRow | null): SessionState => {
  if (!raw || typeof raw !== "object") {
    if (!trigger) {
      throw new HttpError(500, "invalid_state", "Session state is missing trigger context.");
    }
    return emptyStateFromTrigger(trigger);
  }

  const row = raw as Record<string, unknown>;
  return {
    trigger_id: asString(row.trigger_id, trigger?.id ?? ""),
    activity_folder: asString(row.activity_folder, trigger?.activity_folder ?? ""),
    file_name: asString(row.file_name, trigger?.file_name ?? ""),
    file_type:
      asString(row.file_type, trigger?.file_type ?? "document") === "video"
        ? "video"
        : asString(row.file_type, trigger?.file_type ?? "document") === "image"
          ? "image"
          : "document",
    user_message: row.user_message === null ? null : asString(row.user_message, ""),
    campaign_id: row.campaign_id === null ? null : asString(row.campaign_id, ""),
    campaign_workflow_item_id:
      typeof row.campaign_workflow_item_id === "string" && row.campaign_workflow_item_id.trim()
        ? row.campaign_workflow_item_id.trim()
        : null,
    campaign_plan: row.campaign_plan === null ? null : parseCampaignPlan(row.campaign_plan),
    content_id: row.content_id === null ? null : asString(row.content_id, ""),
    content_workflow_item_id:
      typeof row.content_workflow_item_id === "string" && row.content_workflow_item_id.trim()
        ? row.content_workflow_item_id.trim()
        : null,
    content_draft: row.content_draft === null ? null : asString(row.content_draft, ""),
    rag_context: row.rag_context === null ? null : parseRagContextMeta(row.rag_context),
    forbidden_check: row.forbidden_check === null ? null : parseForbiddenCheckMeta(row.forbidden_check),
    processed_event_ids: asStringArray(row.processed_event_ids),
    last_error: row.last_error === null ? null : asString(row.last_error, "")
  };
};

const normalizeChannel = (value: unknown): string => {
  const candidate = asString(value, "instagram").trim().toLowerCase();
  return CHANNEL_SET.has(candidate) ? candidate : "instagram";
};

const messageFromError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown orchestration error";
};

const getActiveSessionByOrg = async (orgId: string): Promise<OrchestratorSessionRow | null> => {
  const { data, error } = await supabaseAdmin
    .from("orchestrator_sessions")
    .select("*")
    .eq("org_id", orgId)
    .in("status", ACTIVE_SESSION_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "db_error", `Failed to query active session: ${error.message}`);
  }

  return (data as OrchestratorSessionRow | null) ?? null;
};

export const getSessionById = async (sessionId: string): Promise<OrchestratorSessionRow | null> => {
  const { data, error } = await supabaseAdmin
    .from("orchestrator_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "db_error", `Failed to query session: ${error.message}`);
  }

  return (data as OrchestratorSessionRow | null) ?? null;
};

export const getActiveSessionForOrg = async (orgId: string): Promise<OrchestratorSessionRow | null> =>
  getActiveSessionByOrg(orgId);

const getPendingTrigger = async (orgId: string): Promise<PipelineTriggerRow | null> => {
  const { data, error } = await supabaseAdmin
    .from("pipeline_triggers")
    .select("*")
    .eq("org_id", orgId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "db_error", `Failed to query pending trigger: ${error.message}`);
  }

  return (data as PipelineTriggerRow | null) ?? null;
};

const updateTrigger = async (
  triggerId: string,
  patch: { status?: string; processed_at?: string | null }
): Promise<void> => {
  const { error } = await supabaseAdmin.from("pipeline_triggers").update(patch).eq("id", triggerId);
  if (error) {
    throw new HttpError(500, "db_error", `Failed to update pipeline trigger: ${error.message}`);
  }
};

const updateSession = async (
  sessionId: string,
  patch: {
    state?: SessionState;
    current_step?: OrchestratorStep;
    status?: SessionStatus;
  }
): Promise<void> => {
  const updatePayload: Record<string, unknown> = {};
  if (patch.state) updatePayload.state = patch.state;
  if (patch.current_step) updatePayload.current_step = patch.current_step;
  if (patch.status) updatePayload.status = patch.status;

  const { error } = await supabaseAdmin.from("orchestrator_sessions").update(updatePayload).eq("id", sessionId);
  if (error) {
    throw new HttpError(500, "db_error", `Failed to update session: ${error.message}`);
  }
};

const insertChatMessage = async (orgId: string, role: "user" | "assistant", content: string): Promise<string> => {
  const payload = {
    org_id: orgId,
    role,
    content,
    channel: "dashboard"
  };

  const { data, error } = await supabaseAdmin.from("chat_messages").insert(payload).select("id").single();
  if (error || !data) {
    throw new HttpError(500, "db_error", `Failed to insert chat message: ${error?.message ?? "unknown"}`);
  }
  return asString((data as Record<string, unknown>).id, "");
};

const startSessionForTrigger = async (trigger: PipelineTriggerRow): Promise<string> => {
  const state = emptyStateFromTrigger(trigger);

  const { data: createdSession, error: insertError } = await supabaseAdmin
    .from("orchestrator_sessions")
    .insert({
      org_id: trigger.org_id,
      trigger_id: trigger.id,
      state,
      current_step: "detect",
      status: "running"
    })
    .select("*")
    .single();

  if (insertError) {
    if ((insertError as { code?: string }).code === "23505") {
      const activeSession = await getActiveSessionByOrg(trigger.org_id);
      if (!activeSession) {
        throw new HttpError(409, "session_conflict", "Active session already exists for this org.");
      }
      return activeSession.id;
    }

    throw new HttpError(500, "db_error", `Failed to create session: ${insertError.message}`);
  }

  const session = createdSession as OrchestratorSessionRow;

  try {
    const now = new Date().toISOString();
    await updateTrigger(trigger.id, { status: "processing", processed_at: now });

    const detectMessage = await generateDetectMessage(trigger.activity_folder, trigger.file_name);
    await insertChatMessage(trigger.org_id, "assistant", detectMessage);

    await updateSession(session.id, {
      state,
      current_step: "await_user_input",
      status: "paused"
    });
  } catch (error) {
    const nextState: SessionState = {
      ...state,
      last_error: messageFromError(error)
    };

    await updateSession(session.id, {
      state: nextState,
      status: "failed"
    });
    await updateTrigger(trigger.id, { status: "failed" });
    throw error;
  }

  return session.id;
};

const eventAlreadyProcessed = (state: SessionState, idempotencyKey: string | null): boolean => {
  if (!idempotencyKey) {
    return false;
  }
  return state.processed_event_ids.includes(idempotencyKey);
};

const addProcessedEvent = (state: SessionState, idempotencyKey: string | null): SessionState => {
  if (!idempotencyKey) {
    return state;
  }

  const merged = [...state.processed_event_ids, idempotencyKey];
  const deduped = [...new Set(merged)];
  return {
    ...state,
    processed_event_ids: deduped.slice(Math.max(0, deduped.length - 100))
  };
};

const resolveCampaignId = (state: SessionState, payload?: Record<string, unknown>): string => {
  const payloadCampaignId = asString(payload?.campaign_id, "");
  const campaignId = payloadCampaignId || state.campaign_id || "";
  if (!campaignId) {
    throw new HttpError(400, "invalid_payload", "campaign_id is required.");
  }
  return campaignId;
};

const resolveContentId = (state: SessionState, payload?: Record<string, unknown>): string => {
  const payloadContentId = asString(payload?.content_id, "");
  const contentId = payloadContentId || state.content_id || "";
  if (!contentId) {
    throw new HttpError(400, "invalid_payload", "content_id is required.");
  }
  return contentId;
};

const buildWorkflowCreateIdempotencyKey = (
  sessionId: string,
  type: "campaign_plan" | "content_draft",
  sourceId: string,
  eventIdempotencyKey: string | null
): string =>
  eventIdempotencyKey
    ? `wf:create:${sessionId}:${type}:${sourceId}:${eventIdempotencyKey}`
    : `wf:create:${sessionId}:${type}:${sourceId}:${randomUUID()}`;

const buildWorkflowActionIdempotencyKey = (
  sessionId: string,
  eventType: ResumeEventRequest["event_type"],
  itemId: string,
  eventIdempotencyKey: string | null
): string =>
  eventIdempotencyKey
    ? `wf:action:${sessionId}:${eventType}:${itemId}:${eventIdempotencyKey}`
    : `wf:action:${sessionId}:${eventType}:${itemId}:${randomUUID()}`;

const mirrorCampaignStatusFromWorkflow = async (
  orgId: string,
  campaignId: string,
  workflowStatus: WorkflowStatus
): Promise<void> => {
  const campaignStatus =
    workflowStatus === "approved" ? "approved" : workflowStatus === "rejected" ? "cancelled" : "draft";

  const { error } = await supabaseAdmin
    .from("campaigns")
    .update({ status: campaignStatus })
    .eq("id", campaignId)
    .eq("org_id", orgId);

  if (error) {
    throw new HttpError(500, "db_error", `Failed to mirror campaign status from workflow: ${error.message}`);
  }
};

const mirrorContentStatusFromWorkflow = async (params: {
  orgId: string;
  contentId: string;
  workflowStatus: WorkflowStatus;
  editedBody?: string;
  publishedAt?: string;
}): Promise<void> => {
  const patch: Record<string, unknown> = {};

  if (params.workflowStatus === "approved") {
    patch.status = "published";
    patch.published_at = params.publishedAt ?? new Date().toISOString();
    if (params.editedBody && params.editedBody.trim()) {
      patch.body = params.editedBody.trim();
    }
  } else if (params.workflowStatus === "rejected") {
    patch.status = "rejected";
  } else {
    patch.status = "pending_approval";
  }

  const { error } = await supabaseAdmin
    .from("contents")
    .update(patch)
    .eq("id", params.contentId)
    .eq("org_id", params.orgId);

  if (error) {
    throw new HttpError(500, "db_error", `Failed to mirror content status from workflow: ${error.message}`);
  }
};

const ensureCampaignWorkflowItemForState = async (params: {
  session: OrchestratorSessionRow;
  state: SessionState;
  campaignId: string;
  eventIdempotencyKey: string | null;
}): Promise<WorkflowItemRow> => {
  return ensureCampaignWorkflowItem({
    orgId: params.session.org_id,
    campaignId: params.campaignId,
    payload: {
      campaign_id: params.campaignId,
      activity_folder: params.state.activity_folder,
      user_message: params.state.user_message,
      plan: params.state.campaign_plan
    },
    idempotencyKey: buildWorkflowCreateIdempotencyKey(
      params.session.id,
      "campaign_plan",
      params.campaignId,
      params.eventIdempotencyKey
    )
  });
};

const ensureContentWorkflowItemForState = async (params: {
  session: OrchestratorSessionRow;
  state: SessionState;
  contentId: string;
  originChatMessageId?: string | null;
  eventIdempotencyKey: string | null;
}): Promise<WorkflowItemRow> => {
  return ensureContentWorkflowItem({
    orgId: params.session.org_id,
    contentId: params.contentId,
    payload: {
      content_id: params.contentId,
      campaign_id: params.state.campaign_id,
      activity_folder: params.state.activity_folder,
      channel: normalizeChannel(params.state.campaign_plan?.suggested_schedule?.[0]?.channel),
      draft: params.state.content_draft,
      rag_context: params.state.rag_context,
      forbidden_check: params.state.forbidden_check
    },
    originChatMessageId: params.originChatMessageId ?? null,
    idempotencyKey: buildWorkflowCreateIdempotencyKey(
      params.session.id,
      "content_draft",
      params.contentId,
      params.eventIdempotencyKey
    )
  });
};

const applyUserMessageStep = async (
  session: OrchestratorSessionRow,
  state: SessionState,
  payload?: Record<string, unknown>,
  eventIdempotencyKey: string | null = null
): Promise<{ state: SessionState; step: OrchestratorStep; status: SessionStatus }> => {
  if (session.current_step !== "await_user_input") {
    throw new HttpError(
      409,
      "invalid_step",
      `Session is at "${session.current_step}" and cannot process user_message event.`
    );
  }

  const userMessage = asString(payload?.content, "").trim();
  if (!userMessage) {
    throw new HttpError(400, "invalid_payload", "payload.content is required for user_message.");
  }

  await insertChatMessage(session.org_id, "user", userMessage);

  const { plan, ragMeta } = await generateCampaignPlan(session.org_id, state.activity_folder, userMessage);
  const { data: campaign, error: campaignError } = await supabaseAdmin
    .from("campaigns")
    .insert({
      org_id: session.org_id,
      title: `${state.activity_folder} Campaign`,
      activity_folder: state.activity_folder,
      status: "draft",
      channels: plan.channels,
      plan
    })
    .select("id")
    .single();

  if (campaignError || !campaign) {
    throw new HttpError(500, "db_error", `Failed to create campaign: ${campaignError?.message ?? "unknown"}`);
  }

  const summary = [
    `캠페인 초안이 준비되었습니다: ${state.activity_folder}`,
    `- 채널: ${plan.channels.join(", ")}`,
    `- 기간: ${plan.duration_days}일 / ${plan.post_count}개 포스트`,
    "확인하면 첫 콘텐츠 초안을 생성하겠습니다."
  ].join("\n");
  const summaryMessageId = await insertChatMessage(session.org_id, "assistant", summary);
  const campaignId = campaign.id as string;
  const campaignWorkflowItem = await ensureCampaignWorkflowItem({
    orgId: session.org_id,
    campaignId,
    payload: {
      campaign_id: campaignId,
      activity_folder: state.activity_folder,
      user_message: userMessage,
      plan
    },
    originChatMessageId: summaryMessageId,
    idempotencyKey: buildWorkflowCreateIdempotencyKey(session.id, "campaign_plan", campaignId, eventIdempotencyKey)
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

const applyCampaignApprovedStep = async (
  session: OrchestratorSessionRow,
  state: SessionState,
  payload?: Record<string, unknown>,
  eventIdempotencyKey: string | null = null
): Promise<{ state: SessionState; step: OrchestratorStep; status: SessionStatus }> => {
  if (session.current_step !== "await_campaign_approval") {
    throw new HttpError(
      409,
      "invalid_step",
      `Session is at "${session.current_step}" and cannot process campaign_approved event.`
    );
  }

  const campaignId = resolveCampaignId(state, payload);
  const campaignWorkflowItem = await ensureCampaignWorkflowItemForState({
    session,
    state,
    campaignId,
    eventIdempotencyKey
  });
  const campaignApproval = await applyWorkflowAction({
    orgId: session.org_id,
    itemId: campaignWorkflowItem.id,
    action: "approved",
    actorType: "user",
    payload: {
      campaign_id: campaignId,
      topic: asString(payload?.topic, "").trim() || null
    },
    expectedVersion: campaignWorkflowItem.version,
    idempotencyKey: buildWorkflowActionIdempotencyKey(
      session.id,
      "campaign_approved",
      campaignWorkflowItem.id,
      eventIdempotencyKey
    )
  });
  await mirrorCampaignStatusFromWorkflow(session.org_id, campaignId, campaignApproval.item.status);

  const firstSchedule = state.campaign_plan?.suggested_schedule?.[0];
  const firstChannel = normalizeChannel(firstSchedule?.channel);
  const payloadTopic = asString(payload?.topic, "").trim();
  const topic = payloadTopic || asString(firstSchedule?.type, "").trim() || state.activity_folder;

  let { draft, ragMeta } = await generateContentDraft(session.org_id, state.activity_folder, firstChannel, topic);
  let forbiddenResult = await checkForbiddenWords(session.org_id, draft);
  let regenerated = false;

  const maxRetries = env.ragForbiddenCheckEnabled ? env.ragForbiddenMaxRetries : 0;
  for (let attempt = 0; !forbiddenResult.passed && attempt < maxRetries; attempt += 1) {
    regenerated = true;
    console.warn(
      `[FORBIDDEN_CHECK] Violations for org ${session.org_id}: ${forbiddenResult.violations.join(", ")} (retry ${
        attempt + 1
      }/${maxRetries})`
    );

    const retry = await generateContentDraft(session.org_id, state.activity_folder, firstChannel, topic);
    draft = retry.draft;
    ragMeta = retry.ragMeta;
    forbiddenResult = await checkForbiddenWords(session.org_id, draft);
  }

  const forbiddenCheck: ForbiddenCheckMeta = {
    passed: forbiddenResult.passed,
    violations: forbiddenResult.violations,
    regenerated
  };

  const { data: content, error: contentError } = await supabaseAdmin
    .from("contents")
    .insert({
      org_id: session.org_id,
      campaign_id: campaignId,
      channel: firstChannel,
      content_type: "text",
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

  const contentMessageId = await insertChatMessage(
    session.org_id,
    "assistant",
    forbiddenCheck.passed
      ? `첫 번째 ${firstChannel} 콘텐츠 초안이 생성되었습니다. 승인 큐에서 확인해 주세요.`
      : `첫 번째 ${firstChannel} 콘텐츠 초안이 생성되었습니다. 금지 표현 감지(${forbiddenCheck.violations.join(", ")})가 있어 검토가 필요합니다.`
  );
  const contentId = content.id as string;
  const contentWorkflowItem = await ensureContentWorkflowItemForState({
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
    originChatMessageId: contentMessageId,
    eventIdempotencyKey
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

const applyContentApprovedStep = async (
  session: OrchestratorSessionRow,
  state: SessionState,
  payload?: Record<string, unknown>,
  eventIdempotencyKey: string | null = null
): Promise<{ state: SessionState; step: OrchestratorStep; status: SessionStatus; completed: true }> => {
  if (session.current_step !== "await_content_approval") {
    throw new HttpError(
      409,
      "invalid_step",
      `Session is at "${session.current_step}" and cannot process content_approved event.`
    );
  }

  const contentId = resolveContentId(state, payload);
  const editedBody = asString(payload?.edited_body, "").trim();
  const publishedAt = new Date().toISOString();
  const shouldCaptureEditPattern =
    !!editedBody && !!state.content_draft?.trim() && editedBody !== state.content_draft.trim();
  const editPatternChannel = normalizeChannel(state.campaign_plan?.suggested_schedule?.[0]?.channel);
  const contentWorkflowItem = await ensureContentWorkflowItemForState({
    session,
    state,
    contentId,
    eventIdempotencyKey
  });
  const contentApproval = await applyWorkflowAction({
    orgId: session.org_id,
    itemId: contentWorkflowItem.id,
    action: "approved",
    actorType: "user",
    payload: {
      content_id: contentId,
      ...(editedBody ? { edited_body: editedBody } : {})
    },
    expectedVersion: contentWorkflowItem.version,
    idempotencyKey: buildWorkflowActionIdempotencyKey(
      session.id,
      "content_approved",
      contentWorkflowItem.id,
      eventIdempotencyKey
    )
  });
  await mirrorContentStatusFromWorkflow({
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

  await insertChatMessage(session.org_id, "assistant", "콘텐츠 게시가 완료되었습니다(시뮬레이션).");

  void onContentPublished(session.org_id, contentId).catch((error) => {
    console.warn(
      `[CONTENT_EMBED] Background embed failed. org=${session.org_id}, content=${contentId}, reason=${
        error instanceof Error ? error.message : String(error)
      }`
    );
  });

  if (shouldCaptureEditPattern) {
    void onContentEdited(session.org_id, state.content_draft as string, editedBody, editPatternChannel).catch((error) => {
      console.warn(
        `[EDIT_PATTERN] Background extraction failed. org=${session.org_id}, content=${contentId}, reason=${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });
  }

  void invalidateMemoryCache(session.org_id).catch((error) => {
    console.warn(
      `[MEMORY] Cache invalidation failed. org=${session.org_id}, reason=${
        error instanceof Error ? error.message : String(error)
      }`
    );
  });

  await updateTrigger(state.trigger_id, { status: "done" });

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

const applyRejectStep = async (
  session: OrchestratorSessionRow,
  state: SessionState,
  type: "campaign_rejected" | "content_rejected",
  payload?: Record<string, unknown>,
  eventIdempotencyKey: string | null = null
): Promise<{ state: SessionState; step: OrchestratorStep; status: SessionStatus; completed: true }> => {
  const reason = asString(payload?.reason, "").trim();
  let nextCampaignWorkflowId = state.campaign_workflow_item_id;
  let nextContentWorkflowId = state.content_workflow_item_id;

  if (type === "campaign_rejected") {
    const campaignId = resolveCampaignId(state, payload);
    const campaignWorkflowItem = await ensureCampaignWorkflowItemForState({
      session,
      state,
      campaignId,
      eventIdempotencyKey
    });
    const campaignRejection = await applyWorkflowAction({
      orgId: session.org_id,
      itemId: campaignWorkflowItem.id,
      action: "rejected",
      actorType: "user",
      payload: reason ? { reason } : {},
      expectedVersion: campaignWorkflowItem.version,
      idempotencyKey: buildWorkflowActionIdempotencyKey(
        session.id,
        "campaign_rejected",
        campaignWorkflowItem.id,
        eventIdempotencyKey
      )
    });
    await mirrorCampaignStatusFromWorkflow(session.org_id, campaignId, campaignRejection.item.status);
    nextCampaignWorkflowId = campaignRejection.item.id;
  } else {
    const contentId = resolveContentId(state, payload);
    const contentWorkflowItem = await ensureContentWorkflowItemForState({
      session,
      state,
      contentId,
      eventIdempotencyKey
    });
    const contentRejection = await applyWorkflowAction({
      orgId: session.org_id,
      itemId: contentWorkflowItem.id,
      action: "rejected",
      actorType: "user",
      payload: reason ? { reason } : {},
      expectedVersion: contentWorkflowItem.version,
      idempotencyKey: buildWorkflowActionIdempotencyKey(
        session.id,
        "content_rejected",
        contentWorkflowItem.id,
        eventIdempotencyKey
      )
    });
    await mirrorContentStatusFromWorkflow({
      orgId: session.org_id,
      contentId,
      workflowStatus: contentRejection.item.status
    });
    nextContentWorkflowId = contentRejection.item.id;
  }

  await insertChatMessage(
    session.org_id,
    "assistant",
    reason
      ? `요청을 반영했습니다. 세션을 종료합니다. 사유: ${reason}`
      : "요청을 반영했습니다. 세션을 종료합니다."
  );
  await updateTrigger(state.trigger_id, { status: "failed" });

  return {
    state: {
      ...state,
      campaign_workflow_item_id: nextCampaignWorkflowId,
      content_workflow_item_id: nextContentWorkflowId,
      last_error: reason || "rejected_by_user"
    },
    step: session.current_step,
    status: "failed",
    completed: true
  };
};

const processResumeEvent = async (
  session: OrchestratorSessionRow,
  state: SessionState,
  event: ResumeEventRequest,
  idempotencyKey: string | null
): Promise<{ state: SessionState; step: OrchestratorStep; status: SessionStatus; completed: boolean }> => {
  switch (event.event_type) {
    case "user_message": {
      const next = await applyUserMessageStep(session, state, event.payload, idempotencyKey);
      return { ...next, completed: false };
    }
    case "campaign_approved": {
      const next = await applyCampaignApprovedStep(session, state, event.payload, idempotencyKey);
      return { ...next, completed: false };
    }
    case "content_approved": {
      const next = await applyContentApprovedStep(session, state, event.payload, idempotencyKey);
      return next;
    }
    case "campaign_rejected":
    case "content_rejected": {
      const next = await applyRejectStep(session, state, event.event_type, event.payload, idempotencyKey);
      return next;
    }
    default:
      throw new HttpError(400, "invalid_event", `Unsupported event type: ${event.event_type}`);
  }
};

const tryStartNextPendingForOrg = async (orgId: string): Promise<void> => {
  await withLock(`org:${orgId}`, async () => {
    const active = await getActiveSessionByOrg(orgId);
    if (active) {
      return;
    }

    const pendingTrigger = await getPendingTrigger(orgId);
    if (!pendingTrigger) {
      return;
    }

    await startSessionForTrigger(pendingTrigger);
  });
};

export const enqueueTrigger = async (trigger: PipelineTriggerRow): Promise<EnqueueTriggerResult> =>
  withLock(`org:${trigger.org_id}`, async () => {
    const active = await getActiveSessionByOrg(trigger.org_id);
    if (active) {
      return {
        mode: "queued",
        session_id: active.id
      };
    }

    const sessionId = await startSessionForTrigger(trigger);
    return {
      mode: "started",
      session_id: sessionId
    };
  });

export const resumeSession = async (
  sessionId: string,
  event: ResumeEventRequest
): Promise<ResumeSessionResult> => {
  const seedSession = await getSessionById(sessionId);
  if (!seedSession) {
    throw new HttpError(404, "not_found", "Session not found.");
  }

  let shouldKickoffNext = false;

  const result = await withLock(`org:${seedSession.org_id}`, async () => {
    const currentSession = await getSessionById(sessionId);
    if (!currentSession) {
      throw new HttpError(404, "not_found", "Session not found.");
    }

    const { data: triggerData, error: triggerError } = await supabaseAdmin
      .from("pipeline_triggers")
      .select("*")
      .eq("id", currentSession.trigger_id)
      .maybeSingle();

    if (triggerError) {
      throw new HttpError(500, "db_error", `Failed to query trigger for session: ${triggerError.message}`);
    }

    const trigger = (triggerData as PipelineTriggerRow | null) ?? null;
    const currentState = parseState(currentSession.state, trigger);

    const idempotencyKey = asString(event.idempotency_key, "").trim() || null;
    if (eventAlreadyProcessed(currentState, idempotencyKey)) {
      return {
        session_id: currentSession.id,
        current_step: normalizeStep(currentSession.current_step),
        status: currentSession.status,
        idempotent: true
      };
    }

    if (currentSession.status === "done" || currentSession.status === "failed") {
      throw new HttpError(409, "session_closed", "Session is already closed.");
    }

    await updateSession(currentSession.id, { status: "running" });

    try {
      const processed = await processResumeEvent(currentSession, currentState, event, idempotencyKey);
      const nextState = addProcessedEvent(processed.state, idempotencyKey);

      await updateSession(currentSession.id, {
        state: nextState,
        current_step: processed.step,
        status: processed.status
      });

      shouldKickoffNext = processed.completed;

      return {
        session_id: currentSession.id,
        current_step: processed.step,
        status: processed.status,
        idempotent: false
      };
    } catch (error) {
      if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
        await updateSession(currentSession.id, { status: currentSession.status });
        throw error;
      }

      const failedState = {
        ...currentState,
        last_error: messageFromError(error)
      };

      await updateSession(currentSession.id, {
        state: addProcessedEvent(failedState, idempotencyKey),
        status: "failed"
      });
      await updateTrigger(currentState.trigger_id, { status: "failed" });

      shouldKickoffNext = true;
      throw error;
    }
  });

  if (shouldKickoffNext) {
    void tryStartNextPendingForOrg(seedSession.org_id);
  }

  return result;
};
