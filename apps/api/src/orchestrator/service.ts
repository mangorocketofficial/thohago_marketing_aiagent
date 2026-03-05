import { env } from "../lib/env";
import { randomUUID } from "node:crypto";
import { HttpError } from "../lib/errors";
import { supabaseAdmin } from "../lib/supabase-admin";
import { detectSkillIntentForRouting, generateContentDraft, generateGeneralAssistantReply } from "./ai";
import {
  emitCampaignActionCardProjection,
  emitContentActionCardProjection,
  insertChatMessage,
  updateLatestWorkflowProjectionStatus
} from "./chat-projection";
import { checkForbiddenWords } from "./forbidden-check";
import {
  asRecord,
  asString,
  buildCampaignDisplayTitle,
  buildCampaignPlanSummary,
  buildContentDisplayTitle,
  buildManualSessionState,
  buildWorkspaceKey,
  DEFAULT_SCOPE_ID,
  DEFAULT_WORKSPACE_TYPE,
  isContextLabelColumnMissingError,
  isWorkspaceKeyColumnMissingError,
  messageFromError,
  normalizeChannel,
  normalizeScopeId,
  normalizeStep,
  normalizeWorkspaceType,
  parseState
} from "./service-helpers";
import { buildSessionTitleFromFirstUserMessage } from "./session-title";
import { runContentApprovalSideEffects } from "./side-effects";
import { applyContentApprovedStep, applyContentRejectStep } from "./steps/content";
import { syncSlotStatusFromWorkflow } from "./scheduler-slot-transition";
import type { CampaignStepDeps } from "./steps/campaign";
import type { ContentStepDeps } from "./steps/content";
import { getSkillRegistry, routeSkill } from "./skills/router";
import type { SkillDeps, SkillOutcome, SkillRouteDecision } from "./skills/types";
export { listWorkspaceInboxItemsForOrg, type WorkspaceInboxItem } from "./workspace-inbox";
import {
  ensureCampaignWorkflowItem,
  ensureContentWorkflowItem
} from "../workflow/service";
import type { WorkflowItemRow, WorkflowStatus } from "../workflow/types";
import type {
  CreateSessionParams,
  CreateSessionResult,
  ForbiddenCheckMeta,
  ListSessionsParams,
  OrchestratorSessionRow,
  OrchestratorStep,
  PendingFolderUpdateSummary,
  PipelineTriggerRow,
  RagContextMeta,
  ResumeEventRequest,
  ResumeSessionResult,
  SessionState,
  SessionStatus
} from "./types";

const ACTIVE_SESSION_STATUSES: SessionStatus[] = ["running", "paused"];
const MAX_PENDING_TRIGGER_SCAN = 1000;

const lockQueueByKey = new Map<string, Promise<void>>();

const withLock = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
  const previous = lockQueueByKey.get(key) ?? Promise.resolve();

  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });

  const queued = previous.then(() => current);
  lockQueueByKey.set(key, queued);
  await previous;

  try {
    return await fn();
  } finally {
    releaseCurrent();
    if (lockQueueByKey.get(key) === queued) {
      lockQueueByKey.delete(key);
    }
  }
};

const queryWorkspaceSessionWithFallback = async (params: {
  orgId: string;
  workspaceType: string;
  scopeId: string;
  activeOnly: boolean;
  errorContext: string;
}): Promise<OrchestratorSessionRow | null> => {
  const workspaceKey = buildWorkspaceKey(params.workspaceType, params.scopeId);

  let query = supabaseAdmin
    .from("orchestrator_sessions")
    .select("*")
    .eq("org_id", params.orgId)
    .eq("workspace_key", workspaceKey)
    .is("archived_at", null);
  if (params.activeOnly) {
    query = query.in("status", ACTIVE_SESSION_STATUSES);
  }
  const { data, error } = await query.order("updated_at", { ascending: false }).limit(1).maybeSingle();

  if (error && !isWorkspaceKeyColumnMissingError(error)) {
    throw new HttpError(500, "db_error", `${params.errorContext}: ${error.message}`);
  }
  if (!error) {
    return (data as OrchestratorSessionRow | null) ?? null;
  }

  let fallbackQuery = supabaseAdmin
    .from("orchestrator_sessions")
    .select("*")
    .eq("org_id", params.orgId)
    .eq("workspace_type", params.workspaceType)
    .eq("scope_id", params.scopeId)
    .is("archived_at", null);
  if (params.activeOnly) {
    fallbackQuery = fallbackQuery.in("status", ACTIVE_SESSION_STATUSES);
  }
  const { data: fallbackData, error: fallbackError } = await fallbackQuery
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fallbackError) {
    throw new HttpError(500, "db_error", `${params.errorContext}: ${fallbackError.message}`);
  }
  return (fallbackData as OrchestratorSessionRow | null) ?? null;
};

const getActiveSessionByWorkspace = async (
  orgId: string,
  workspaceType: string,
  scopeId: string
): Promise<OrchestratorSessionRow | null> =>
  queryWorkspaceSessionWithFallback({
    orgId,
    workspaceType,
    scopeId,
    activeOnly: true,
    errorContext: "Failed to query workspace active session"
  });

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
  getActiveSessionByWorkspace(orgId, DEFAULT_WORKSPACE_TYPE, DEFAULT_SCOPE_ID);

export const listSessionsForOrg = async (params: ListSessionsParams): Promise<OrchestratorSessionRow[]> => {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(params.limit)));
  let query = supabaseAdmin.from("orchestrator_sessions").select("*").eq("org_id", params.orgId);

  if (!params.includeArchived) {
    query = query.is("archived_at", null);
  }

  const workspaceType = asString(params.workspaceType, "").trim() ? normalizeWorkspaceType(params.workspaceType) : null;
  if (workspaceType) {
    query = query.eq("workspace_type", workspaceType);
  }

  if (params.scopeId !== undefined) {
    const scopeId = normalizeScopeId(params.scopeId);
    query = scopeId ? query.eq("scope_id", scopeId) : query.is("scope_id", null);
  }

  if (Array.isArray(params.statuses) && params.statuses.length > 0) {
    query = query.in("status", params.statuses);
  }

  if (params.cursor?.updated_at && params.cursor?.id) {
    const updatedAt = params.cursor.updated_at.trim();
    const id = params.cursor.id.trim();
    if (updatedAt && id) {
      query = query.or(`updated_at.lt.${updatedAt},and(updated_at.eq.${updatedAt},id.lt.${id})`);
    }
  }

  const { data, error } = await query
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new HttpError(500, "db_error", `Failed to list sessions: ${error.message}`);
  }

  return (data as OrchestratorSessionRow[] | null) ?? [];
};

export const createSessionForOrg = async (params: CreateSessionParams): Promise<CreateSessionResult> => {
  const workspaceType = normalizeWorkspaceType(params.workspaceType);
  const scopeId = normalizeScopeId(params.scopeId) ?? DEFAULT_SCOPE_ID;
  const workspaceKey = buildWorkspaceKey(workspaceType, scopeId);
  const title = normalizeScopeId(params.title);
  const createdByUserId = normalizeScopeId(params.createdByUserId);
  const startPaused = params.startPaused !== false;
  const forceNew = params.forceNew === true;

  const finalizeActiveSessionForNewCreate = async (session: OrchestratorSessionRow): Promise<void> => {
    const { error } = await supabaseAdmin
      .from("orchestrator_sessions")
      .update({
        status: "done",
        current_step: "done"
      })
      .eq("id", session.id);
    if (error) {
      throw new HttpError(500, "db_error", `Failed to finalize existing active session: ${error.message}`);
    }
  };

  return withLock(`org:${params.orgId}`, async () => {
    const active = await getActiveSessionByWorkspace(params.orgId, workspaceType, scopeId);
    if (active && !forceNew) {
      return {
        session: active,
        reused: true
      };
    }
    if (active && forceNew) {
      await finalizeActiveSessionForNewCreate(active);
    }

    const state = buildManualSessionState(workspaceType, scopeId, title);

    const insertBasePayload = {
      org_id: params.orgId,
      trigger_id: null,
      workspace_type: workspaceType,
      scope_id: scopeId,
      title,
      created_by_user_id: createdByUserId,
      archived_at: null,
      state,
      current_step: "await_user_input",
      status: startPaused ? "paused" : "running"
    };

    const { data, error } = await supabaseAdmin
      .from("orchestrator_sessions")
      .insert({
        ...insertBasePayload,
        workspace_key: workspaceKey
      })
      .select("*")
      .single();

    if (error && isWorkspaceKeyColumnMissingError(error)) {
      const { data: fallbackData, error: fallbackError } = await supabaseAdmin
        .from("orchestrator_sessions")
        .insert(insertBasePayload)
        .select("*")
        .single();

      if (fallbackError) {
        if ((fallbackError as { code?: string }).code === "23505") {
          const existing = await getActiveSessionByWorkspace(params.orgId, workspaceType, scopeId);
          if (existing) {
            if (forceNew) {
              await finalizeActiveSessionForNewCreate(existing);
              const { data: retryData, error: retryError } = await supabaseAdmin
                .from("orchestrator_sessions")
                .insert(insertBasePayload)
                .select("*")
                .single();
              if (!retryError) {
                return {
                  session: retryData as OrchestratorSessionRow,
                  reused: false
                };
              }
              if ((retryError as { code?: string }).code === "23505") {
                throw new HttpError(409, "session_conflict", "Failed to create a new session. Please retry.");
              }
              throw new HttpError(500, "db_error", `Failed to create session: ${retryError.message}`);
            }
            return {
              session: existing,
              reused: true
            };
          }
          throw new HttpError(409, "session_conflict", "An active session already exists for this workspace.");
        }
        throw new HttpError(500, "db_error", `Failed to create session: ${fallbackError.message}`);
      }

      return {
        session: fallbackData as OrchestratorSessionRow,
        reused: false
      };
    }

    if (error) {
      if ((error as { code?: string }).code === "23505") {
        const existing = await getActiveSessionByWorkspace(params.orgId, workspaceType, scopeId);
        if (existing) {
          if (forceNew) {
            await finalizeActiveSessionForNewCreate(existing);
            const { data: retryData, error: retryError } = await supabaseAdmin
              .from("orchestrator_sessions")
              .insert({
                ...insertBasePayload,
                workspace_key: workspaceKey
              })
              .select("*")
              .single();
            if (!retryError) {
              return {
                session: retryData as OrchestratorSessionRow,
                reused: false
              };
            }
            if ((retryError as { code?: string }).code === "23505") {
              throw new HttpError(409, "session_conflict", "Failed to create a new session. Please retry.");
            }
            throw new HttpError(500, "db_error", `Failed to create session: ${retryError.message}`);
          }
          return {
            session: existing,
            reused: true
          };
        }
        throw new HttpError(409, "session_conflict", "An active session already exists for this workspace.");
      }
      throw new HttpError(500, "db_error", `Failed to create session: ${error.message}`);
    }

    return {
      session: data as OrchestratorSessionRow,
      reused: false
    };
  });
};

export const getRecommendedSessionForWorkspace = async (params: {
  orgId: string;
  workspaceType: string;
  scopeId?: string | null;
}): Promise<OrchestratorSessionRow | null> => {
  const workspaceType = normalizeWorkspaceType(params.workspaceType);
  const scopeId = normalizeScopeId(params.scopeId) ?? DEFAULT_SCOPE_ID;

  const active = await getActiveSessionByWorkspace(params.orgId, workspaceType, scopeId);
  if (active) {
    return active;
  }

  return queryWorkspaceSessionWithFallback({
    orgId: params.orgId,
    workspaceType,
    scopeId,
    activeOnly: false,
    errorContext: "Failed to query recommended session"
  });
};

export const listPendingFolderUpdatesForOrg = async (params: {
  orgId: string;
  limit?: number;
}): Promise<PendingFolderUpdateSummary[]> => {
  const safeLimit =
    typeof params.limit === "number" && Number.isFinite(params.limit)
      ? Math.max(1, Math.min(100, Math.floor(params.limit)))
      : 20;

  const { data, error } = await supabaseAdmin
    .from("pipeline_triggers")
    .select("activity_folder,file_type,created_at")
    .eq("org_id", params.orgId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(MAX_PENDING_TRIGGER_SCAN);

  if (error) {
    throw new HttpError(500, "db_error", `Failed to query pending folder updates: ${error.message}`);
  }

  const grouped = new Map<string, PendingFolderUpdateSummary>();
  for (const row of (data as Record<string, unknown>[] | null) ?? []) {
    const activityFolder = asString(row.activity_folder, "").trim();
    if (!activityFolder) {
      continue;
    }
    const createdAt = asString(row.created_at, new Date().toISOString());
    const fileType = asString(row.file_type, "document");

    const current =
      grouped.get(activityFolder) ??
      {
        activity_folder: activityFolder,
        pending_count: 0,
        first_detected_at: createdAt,
        last_detected_at: createdAt,
        file_type_counts: {
          image: 0,
          video: 0,
          document: 0
        }
      };

    current.pending_count += 1;
    if (createdAt < current.first_detected_at) {
      current.first_detected_at = createdAt;
    }
    if (createdAt > current.last_detected_at) {
      current.last_detected_at = createdAt;
    }

    if (fileType === "image") {
      current.file_type_counts.image += 1;
    } else if (fileType === "video") {
      current.file_type_counts.video += 1;
    } else {
      current.file_type_counts.document += 1;
    }

    grouped.set(activityFolder, current);
  }

  return [...grouped.values()]
    .sort((left, right) => {
      if (left.last_detected_at === right.last_detected_at) {
        return left.activity_folder.localeCompare(right.activity_folder);
      }
      return right.last_detected_at.localeCompare(left.last_detected_at);
    })
    .slice(0, safeLimit);
};

export const acknowledgePendingFolderUpdatesForFolder = async (params: {
  orgId: string;
  activityFolder: string;
}): Promise<{ updated_count: number }> => {
  const activityFolder = params.activityFolder.trim();
  if (!activityFolder) {
    throw new HttpError(400, "invalid_payload", "activity_folder is required.");
  }

  const { data, error } = await supabaseAdmin
    .from("pipeline_triggers")
    .update({
      status: "processing",
      processed_at: new Date().toISOString()
    })
    .eq("org_id", params.orgId)
    .eq("activity_folder", activityFolder)
    .eq("status", "pending")
    .select("id");

  if (error) {
    throw new HttpError(500, "db_error", `Failed to acknowledge folder updates: ${error.message}`);
  }

  return {
    updated_count: Array.isArray(data) ? data.length : 0
  };
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
    title?: string;
  }
): Promise<void> => {
  const updatePayload: Record<string, unknown> = {};
  if (patch.state) updatePayload.state = patch.state;
  if (patch.current_step) updatePayload.current_step = patch.current_step;
  if (patch.status) updatePayload.status = patch.status;
  if (patch.title) updatePayload.title = patch.title;

  const { error } = await supabaseAdmin.from("orchestrator_sessions").update(updatePayload).eq("id", sessionId);
  if (error) {
    throw new HttpError(500, "db_error", `Failed to update session: ${error.message}`);
  }
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
  eventIdempotencyKey: string | null,
  actionSuffix?: string
): string =>
  eventIdempotencyKey
    ? `wf:action:${sessionId}:${eventType}:${itemId}:${actionSuffix ?? "main"}:${eventIdempotencyKey}`
    : `wf:action:${sessionId}:${eventType}:${itemId}:${actionSuffix ?? "main"}:${randomUUID()}`;

const resolveExpectedVersion = (payload?: Record<string, unknown>): number | undefined => {
  const raw = payload?.expected_version;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 1) {
    return Math.floor(raw);
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number.parseInt(raw.trim(), 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return parsed;
    }
  }
  return undefined;
};

const generateContentDraftWithForbiddenCheck = async (params: {
  orgId: string;
  activityFolder: string;
  channel: string;
  topic: string;
  revisionReason?: string;
  previousDraft?: string;
}): Promise<{
  draft: string;
  ragMeta: RagContextMeta;
  forbiddenCheck: ForbiddenCheckMeta;
}> => {
  let { draft, ragMeta } = await generateContentDraft(params.orgId, params.activityFolder, params.channel, params.topic, {
    revisionReason: params.revisionReason ?? null,
    previousDraft: params.previousDraft ?? null
  });
  let forbiddenResult = await checkForbiddenWords(params.orgId, draft);
  let regenerated = false;

  const maxRetries = env.ragForbiddenCheckEnabled ? env.ragForbiddenMaxRetries : 0;
  for (let attempt = 0; !forbiddenResult.passed && attempt < maxRetries; attempt += 1) {
    regenerated = true;
    console.warn(
      `[FORBIDDEN_CHECK] Violations for org ${params.orgId}: ${forbiddenResult.violations.join(", ")} (retry ${
        attempt + 1
      }/${maxRetries})`
    );

    const retry = await generateContentDraft(params.orgId, params.activityFolder, params.channel, params.topic, {
      revisionReason: params.revisionReason ?? null,
      previousDraft: params.previousDraft ?? null
    });
    draft = retry.draft;
    ragMeta = retry.ragMeta;
    forbiddenResult = await checkForbiddenWords(params.orgId, draft);
  }

  return {
    draft,
    ragMeta,
    forbiddenCheck: {
      passed: forbiddenResult.passed,
      violations: forbiddenResult.violations,
      regenerated
    }
  };
};

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
  workflowItemId: string;
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

  await syncSlotStatusFromWorkflow({
    orgId: params.orgId,
    workflowItemId: params.workflowItemId,
    contentId: params.contentId,
    workflowStatus: params.workflowStatus,
    publishedAt: params.publishedAt ?? null
  });
};

const bindSessionContextLabelIfEmpty = async (sessionId: string, activityFolder: string): Promise<void> => {
  const nextLabel = activityFolder.trim();
  if (!nextLabel) {
    return;
  }

  const { error } = await supabaseAdmin
    .from("orchestrator_sessions")
    .update({ context_label: nextLabel })
    .eq("id", sessionId)
    .is("context_label", null);

  if (error && !isContextLabelColumnMissingError(error)) {
    throw new HttpError(500, "db_error", `Failed to bind session context label: ${error.message}`);
  }
};

const ensureCampaignWorkflowItemForState = async (params: {
  session: OrchestratorSessionRow;
  state: SessionState;
  campaignId: string;
  eventIdempotencyKey: string | null;
  campaignPlan?: SessionState["campaign_plan"] | null;
  planChainData?: unknown;
  planDocument?: string | null;
}): Promise<WorkflowItemRow> => {
  const campaignPlan = params.campaignPlan ?? params.state.campaign_plan;
  const planSummary = buildCampaignPlanSummary({
    plan: campaignPlan,
    planChainData: params.planChainData
  });

  const workflowItem = await ensureCampaignWorkflowItem({
    orgId: params.session.org_id,
    sessionId: params.session.id,
    displayTitle: buildCampaignDisplayTitle(params.state.activity_folder, params.state.user_message),
    campaignId: params.campaignId,
    payload: {
      campaign_id: params.campaignId,
      activity_folder: params.state.activity_folder,
      user_message: params.state.user_message,
      plan: campaignPlan,
      plan_document:
        typeof params.planDocument === "string" && params.planDocument.trim() ? params.planDocument : null,
      plan_summary: planSummary,
      ...(params.planChainData ? { plan_chain_data: params.planChainData } : {})
    },
    idempotencyKey: buildWorkflowCreateIdempotencyKey(
      params.session.id,
      "campaign_plan",
      params.campaignId,
      params.eventIdempotencyKey
    )
  });

  await bindSessionContextLabelIfEmpty(params.session.id, params.state.activity_folder);
  return workflowItem;
};

const ensureContentWorkflowItemForState = async (params: {
  session: OrchestratorSessionRow;
  state: SessionState;
  contentId: string;
  originChatMessageId?: string | null;
  eventIdempotencyKey: string | null;
}): Promise<WorkflowItemRow> => {
  const channel = normalizeChannel(params.state.campaign_plan?.suggested_schedule?.[0]?.channel);
  const workflowItem = await ensureContentWorkflowItem({
    orgId: params.session.org_id,
    sessionId: params.session.id,
    displayTitle: buildContentDisplayTitle(params.state.activity_folder, channel, params.state.user_message),
    contentId: params.contentId,
    payload: {
      content_id: params.contentId,
      campaign_id: params.state.campaign_id,
      activity_folder: params.state.activity_folder,
      channel,
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

  await bindSessionContextLabelIfEmpty(params.session.id, params.state.activity_folder);
  return workflowItem;
};

type ProcessResumeEventResult = {
  state: SessionState;
  step: OrchestratorStep;
  status: SessionStatus;
  completed: boolean;
};

const buildCampaignStepDeps = (): CampaignStepDeps => ({
  asString,
  resolveCampaignId,
  resolveExpectedVersion,
  normalizeChannel,
  buildWorkflowCreateIdempotencyKey,
  buildWorkflowActionIdempotencyKey,
  ensureCampaignWorkflowItemForState,
  ensureContentWorkflowItemForState,
  emitCampaignActionCardProjection,
  emitContentActionCardProjection,
  updateLatestWorkflowProjectionStatus,
  mirrorCampaignStatusFromWorkflow,
  generateContentDraftWithForbiddenCheck,
  insertChatMessage,
  updateTrigger
});

const buildContentStepDeps = (): ContentStepDeps => ({
  asString,
  asRecord,
  normalizeChannel,
  resolveContentId,
  resolveExpectedVersion,
  buildWorkflowActionIdempotencyKey,
  ensureContentWorkflowItemForState,
  updateLatestWorkflowProjectionStatus,
  mirrorContentStatusFromWorkflow,
  emitContentActionCardProjection,
  generateContentDraftWithForbiddenCheck,
  insertChatMessage,
  updateTrigger,
  runContentApprovalSideEffects
});

const ensureSessionTitleFromFirstUserMessage = async (params: {
  session: OrchestratorSessionRow;
  userMessage: string;
}): Promise<void> => {
  const currentTitle = asString(params.session.title, "").trim();
  if (currentTitle) {
    return;
  }

  const nextTitle = buildSessionTitleFromFirstUserMessage(params.userMessage);
  if (!nextTitle) {
    return;
  }

  await updateSession(params.session.id, {
    title: nextTitle
  });
};

const buildManualSkillClarificationReply = (skillId: string): string | null => {
  const normalized = asString(skillId, "").trim().toLowerCase();
  if (normalized === "naverblog_generation") {
    return [
      "네이버 블로그 글 작성을 시작할게요.",
      "어떤 주제로 작성할까요?",
      "예: `봄맞이 홈카페 인테리어 팁`, `초보 사장님을 위한 네이버 블로그 운영법`"
    ].join("\n");
  }

  return null;
};

const handleGeneralUserMessage = async (params: {
  session: OrchestratorSessionRow;
  state: SessionState;
  event: ResumeEventRequest;
  lastError?: string | null;
}): Promise<ProcessResumeEventResult> => {
  const content = asString(params.event.payload?.content, "").trim();
  if (!content) {
    throw new HttpError(400, "invalid_payload", "payload.content is required for user_message.");
  }

  await ensureSessionTitleFromFirstUserMessage({
    session: params.session,
    userMessage: content
  });

  await insertChatMessage({
    orgId: params.session.org_id,
    sessionId: params.session.id,
    userId: params.session.created_by_user_id,
    role: "user",
    content
  });

  const payload = asRecord(params.event.payload);
  const explicitTrigger = asString(payload.skill_trigger, "").trim().toLowerCase();
  const manualSkillClarification = buildManualSkillClarificationReply(explicitTrigger);
  const assistantReply =
    manualSkillClarification ??
    (await generateGeneralAssistantReply({
      orgId: params.session.org_id,
      sessionId: params.session.id,
      userId: params.session.created_by_user_id,
      activityFolder: params.state.activity_folder,
      currentStep: params.session.current_step,
      userMessage: content,
      campaignId: params.state.campaign_id,
      contentId: params.state.content_id
    }));

  await insertChatMessage({
    orgId: params.session.org_id,
    sessionId: params.session.id,
    userId: params.session.created_by_user_id,
    role: "assistant",
    content: assistantReply
  });

  return {
    state: {
      ...params.state,
      last_error: params.lastError ?? null
    },
    step: normalizeStep(params.session.current_step),
    status: "paused",
    completed: false
  };
};

const resolveTransitionFromSkillOutcome = (params: {
  session: OrchestratorSessionRow;
  outcome: SkillOutcome;
}): { step: OrchestratorStep; status: SessionStatus } => {
  switch (params.outcome) {
    case "await_campaign_approval":
      return { step: "await_campaign_approval", status: "paused" };
    case "await_content_approval":
      return { step: "await_content_approval", status: "paused" };
    case "session_done":
      return { step: "done", status: "done" };
    case "session_failed":
      return { step: normalizeStep(params.session.current_step), status: "failed" };
    default:
      return { step: normalizeStep(params.session.current_step), status: "paused" };
  }
};

const applySkillStatePatch = (params: {
  state: SessionState;
  route: SkillRouteDecision;
  outcome: SkillOutcome;
  statePatch?: Partial<SessionState>;
}): SessionState => {
  const merged: SessionState = {
    ...params.state,
    ...(params.statePatch ?? {})
  };

  if (params.statePatch?.last_error === undefined && params.outcome !== "session_failed") {
    merged.last_error = null;
  }

  if (params.outcome === "session_done" || params.outcome === "session_failed") {
    return {
      ...merged,
      active_skill: null,
      active_skill_started_at: null,
      active_skill_version: null,
      active_skill_confidence: null,
      skill_lock_id: null,
      skill_lock_source: null,
      skill_lock_at: null
    };
  }

  const now = new Date().toISOString();
  const isSameSkill = params.state.active_skill === params.route.skill.id;
  const shouldLock =
    params.route.reason === "explicit_trigger" || params.route.reason === "llm_intent" || params.route.reason === "intent";
  const nextSkillLockSource =
    params.route.reason === "explicit_trigger"
      ? "manual"
      : params.route.reason === "llm_intent"
        ? "llm_auto"
        : params.route.reason === "intent"
          ? params.state.skill_lock_source ?? "manual"
          : params.state.skill_lock_source;
  return {
    ...merged,
    active_skill: params.route.skill.id,
    active_skill_started_at: isSameSkill ? params.state.active_skill_started_at ?? now : now,
    active_skill_version: params.route.skill.version,
    active_skill_confidence: params.route.confidence ?? params.state.active_skill_confidence,
    skill_lock_id: shouldLock ? params.route.skill.id : params.state.skill_lock_id,
    skill_lock_source: shouldLock ? nextSkillLockSource : params.state.skill_lock_source,
    skill_lock_at: shouldLock ? now : params.state.skill_lock_at
  };
};

const LLM_SKILL_ROUTE_CONFIDENCE_THRESHOLD = 0.9;

const resolveRoutedSkill = async (params: {
  event: ResumeEventRequest;
  session: OrchestratorSessionRow;
  state: SessionState;
}): Promise<SkillRouteDecision | null> => {
  const routed = routeSkill(params);
  if (routed) {
    return routed;
  }

  if (params.event.event_type !== "user_message") {
    return null;
  }

  if (params.session.current_step !== "await_user_input" || params.state.active_skill || params.state.skill_lock_id) {
    return null;
  }

  const userMessage = asString(params.event.payload?.content, "").trim();
  if (!userMessage) {
    return null;
  }

  const registry = getSkillRegistry();
  const payload = asRecord(params.event.payload);
  const explicitTrigger = asString(payload.skill_trigger, "").trim().toLowerCase();
  const explicitSkill = explicitTrigger ? registry.findById(explicitTrigger) : null;
  const preferredSkillId =
    explicitSkill && explicitSkill.handlesEvents.includes("user_message") ? explicitSkill.id : null;
  const availableSkills = registry
    .getAll()
    .filter((skill) => skill.handlesEvents.includes("user_message"))
    .map((skill) => ({
      id: skill.id,
      description: `${skill.displayName} (${skill.id})`
    }));
  const detected = await detectSkillIntentForRouting({
    orgId: params.session.org_id,
    sessionId: params.session.id,
    currentStep: params.session.current_step,
    userMessage,
    availableSkills,
    preferredSkillId
  });
  if (!detected || detected.confidence < LLM_SKILL_ROUTE_CONFIDENCE_THRESHOLD) {
    return null;
  }
  if (preferredSkillId && detected.skillId !== preferredSkillId) {
    return null;
  }

  const skill = registry.findById(detected.skillId);
  if (!skill || !skill.handlesEvents.includes("user_message")) {
    return null;
  }

  return {
    skill,
    reason: "llm_intent",
    confidence: detected.confidence,
    note: `llm_skill_intent:${detected.reason}`
  };
};

const processResumeEvent = async (
  session: OrchestratorSessionRow,
  state: SessionState,
  event: ResumeEventRequest,
  idempotencyKey: string | null
): Promise<ProcessResumeEventResult> => {
  const campaignStepDeps = buildCampaignStepDeps();
  const contentStepDeps = buildContentStepDeps();
  const skillDeps: SkillDeps = {
    campaign: campaignStepDeps,
    content: contentStepDeps,
    asString,
    normalizeStep,
    generateGeneralAssistantReply
  };

  const routedSkill = await resolveRoutedSkill({
    event,
    session,
    state
  });

  if (routedSkill) {
    try {
      const skillResult = await routedSkill.skill.execute({
        session,
        state,
        event,
        idempotencyKey,
        routeReason: routedSkill.reason,
        routeConfidence: routedSkill.confidence,
        deps: skillDeps
      });

      if (!skillResult.handled) {
        console.warn(
          `[SKILL_ROUTER] handled=false skill=${routedSkill.skill.id} event=${event.event_type} session=${session.id}`
        );
      } else {
        const transition = resolveTransitionFromSkillOutcome({
          session,
          outcome: skillResult.outcome
        });
        const nextState = applySkillStatePatch({
          state,
          route: routedSkill,
          outcome: skillResult.outcome,
          statePatch: skillResult.statePatch
        });

        return {
          state: nextState,
          step: transition.step,
          status: transition.status,
          completed: skillResult.completion === "kickoff_next"
        };
      }
    } catch (error) {
      const errorMessage = messageFromError(error);
      console.error(
        `[SKILL_ROUTER] execute_failed skill=${routedSkill.skill.id} event=${event.event_type} session=${session.id} reason=${routedSkill.reason}: ${errorMessage}`
      );

      if (event.event_type === "user_message") {
        return handleGeneralUserMessage({
          session,
          state,
          event,
          lastError: `skill_execute_failed:${routedSkill.skill.id}:${errorMessage}`
        });
      }

      throw error;
    }
  }

  switch (event.event_type) {
    case "content_approved": {
      const next = await applyContentApprovedStep(session, state, event.payload, idempotencyKey, contentStepDeps);
      return next;
    }
    case "content_rejected": {
      const next = await applyContentRejectStep(session, state, event.payload, idempotencyKey, contentStepDeps);
      return next;
    }
    case "user_message":
      return handleGeneralUserMessage({
        session,
        state,
        event
      });
    case "campaign_approved":
    case "campaign_rejected":
      throw new HttpError(409, "skill_not_routed", `No skill route resolved for ${event.event_type}.`);
    default:
      throw new HttpError(400, "invalid_event", `Unsupported event type: ${event.event_type}`);
  }
};

export const resumeSession = async (
  sessionId: string,
  event: ResumeEventRequest
): Promise<ResumeSessionResult> => {
  const seedSession = await getSessionById(sessionId);
  if (!seedSession) {
    throw new HttpError(404, "not_found", "Session not found.");
  }

  const result = await withLock(`org:${seedSession.org_id}`, async () => {
    const currentSession = await getSessionById(sessionId);
    if (!currentSession) {
      throw new HttpError(404, "not_found", "Session not found.");
    }

    const normalizedTriggerId =
      typeof currentSession.trigger_id === "string" && currentSession.trigger_id.trim()
        ? currentSession.trigger_id.trim()
        : null;

    let trigger: PipelineTriggerRow | null = null;
    if (normalizedTriggerId) {
      const { data: triggerData, error: triggerError } = await supabaseAdmin
        .from("pipeline_triggers")
        .select("*")
        .eq("id", normalizedTriggerId)
        .maybeSingle();

      if (triggerError) {
        throw new HttpError(500, "db_error", `Failed to query trigger for session: ${triggerError.message}`);
      }

      trigger = (triggerData as PipelineTriggerRow | null) ?? null;
    }

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
      if (currentState.trigger_id.trim()) {
        await updateTrigger(currentState.trigger_id, { status: "failed" });
      }
      throw error;
    }
  });

  return result;
};
