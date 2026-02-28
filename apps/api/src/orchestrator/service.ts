import { HttpError } from "../lib/errors";
import { supabaseAdmin } from "../lib/supabase-admin";
import { generateCampaignPlan, generateContentDraft, generateDetectMessage } from "./ai";
import type {
  CampaignPlan,
  EnqueueTriggerResult,
  OrchestratorSessionRow,
  OrchestratorStep,
  PipelineTriggerRow,
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

const emptyStateFromTrigger = (trigger: PipelineTriggerRow): SessionState => ({
  trigger_id: trigger.id,
  activity_folder: trigger.activity_folder,
  file_name: trigger.file_name,
  file_type: trigger.file_type,
  user_message: null,
  campaign_id: null,
  campaign_plan: null,
  content_id: null,
  content_draft: null,
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
    campaign_plan: row.campaign_plan === null ? null : parseCampaignPlan(row.campaign_plan),
    content_id: row.content_id === null ? null : asString(row.content_id, ""),
    content_draft: row.content_draft === null ? null : asString(row.content_draft, ""),
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

const insertChatMessage = async (orgId: string, role: "user" | "assistant", content: string): Promise<void> => {
  const payload = {
    org_id: orgId,
    role,
    content,
    channel: "dashboard"
  };

  const { error } = await supabaseAdmin.from("chat_messages").insert(payload);
  if (error) {
    throw new HttpError(500, "db_error", `Failed to insert chat message: ${error.message}`);
  }
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

const applyUserMessageStep = async (
  session: OrchestratorSessionRow,
  state: SessionState,
  payload?: Record<string, unknown>
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

  const plan = await generateCampaignPlan(state.activity_folder, userMessage);
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
    "승인하면 첫 콘텐츠 초안을 생성하겠습니다."
  ].join("\n");
  await insertChatMessage(session.org_id, "assistant", summary);

  return {
    state: {
      ...state,
      user_message: userMessage,
      campaign_id: campaign.id as string,
      campaign_plan: plan,
      last_error: null
    },
    step: "await_campaign_approval",
    status: "paused"
  };
};

const applyCampaignApprovedStep = async (
  session: OrchestratorSessionRow,
  state: SessionState,
  payload?: Record<string, unknown>
): Promise<{ state: SessionState; step: OrchestratorStep; status: SessionStatus }> => {
  if (session.current_step !== "await_campaign_approval") {
    throw new HttpError(
      409,
      "invalid_step",
      `Session is at "${session.current_step}" and cannot process campaign_approved event.`
    );
  }

  const campaignId = resolveCampaignId(state, payload);
  const { error: campaignStatusError } = await supabaseAdmin
    .from("campaigns")
    .update({ status: "approved" })
    .eq("id", campaignId)
    .eq("org_id", session.org_id);

  if (campaignStatusError) {
    throw new HttpError(500, "db_error", `Failed to update campaign status: ${campaignStatusError.message}`);
  }

  const firstChannel = normalizeChannel(state.campaign_plan?.suggested_schedule?.[0]?.channel);
  const draft = await generateContentDraft(state.activity_folder, firstChannel);

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
        phase: "1-5a",
        source: "orchestrator"
      },
      created_by: "ai"
    })
    .select("id")
    .single();

  if (contentError || !content) {
    throw new HttpError(500, "db_error", `Failed to create content draft: ${contentError?.message ?? "unknown"}`);
  }

  await insertChatMessage(
    session.org_id,
    "assistant",
    `첫 번째 ${firstChannel} 콘텐츠 초안이 생성되었습니다. 승인 큐에서 확인해 주세요.`
  );

  return {
    state: {
      ...state,
      campaign_id: campaignId,
      content_id: content.id as string,
      content_draft: draft,
      last_error: null
    },
    step: "await_content_approval",
    status: "paused"
  };
};

const applyContentApprovedStep = async (
  session: OrchestratorSessionRow,
  state: SessionState,
  payload?: Record<string, unknown>
): Promise<{ state: SessionState; step: OrchestratorStep; status: SessionStatus; completed: true }> => {
  if (session.current_step !== "await_content_approval") {
    throw new HttpError(
      409,
      "invalid_step",
      `Session is at "${session.current_step}" and cannot process content_approved event.`
    );
  }

  const contentId = resolveContentId(state, payload);
  const publishedAt = new Date().toISOString();

  const { error: contentError } = await supabaseAdmin
    .from("contents")
    .update({ status: "published", published_at: publishedAt })
    .eq("id", contentId)
    .eq("org_id", session.org_id);

  if (contentError) {
    throw new HttpError(500, "db_error", `Failed to publish content: ${contentError.message}`);
  }

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
  await updateTrigger(state.trigger_id, { status: "done" });

  return {
    state: {
      ...state,
      content_id: contentId,
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
  payload?: Record<string, unknown>
): Promise<{ state: SessionState; step: OrchestratorStep; status: SessionStatus; completed: true }> => {
  const reason = asString(payload?.reason, "").trim();

  if (type === "campaign_rejected") {
    const campaignId = resolveCampaignId(state, payload);
    const { error } = await supabaseAdmin
      .from("campaigns")
      .update({ status: "cancelled" })
      .eq("id", campaignId)
      .eq("org_id", session.org_id);
    if (error) {
      throw new HttpError(500, "db_error", `Failed to cancel campaign: ${error.message}`);
    }
  } else {
    const contentId = resolveContentId(state, payload);
    const { error } = await supabaseAdmin
      .from("contents")
      .update({ status: "rejected" })
      .eq("id", contentId)
      .eq("org_id", session.org_id);
    if (error) {
      throw new HttpError(500, "db_error", `Failed to reject content: ${error.message}`);
    }
  }

  await insertChatMessage(
    session.org_id,
    "assistant",
    reason
      ? `요청이 반영되었습니다. 세션을 종료합니다. 사유: ${reason}`
      : "요청이 반영되었습니다. 세션을 종료합니다."
  );
  await updateTrigger(state.trigger_id, { status: "failed" });

  return {
    state: {
      ...state,
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
  event: ResumeEventRequest
): Promise<{ state: SessionState; step: OrchestratorStep; status: SessionStatus; completed: boolean }> => {
  switch (event.event_type) {
    case "user_message": {
      const next = await applyUserMessageStep(session, state, event.payload);
      return { ...next, completed: false };
    }
    case "campaign_approved": {
      const next = await applyCampaignApprovedStep(session, state, event.payload);
      return { ...next, completed: false };
    }
    case "content_approved": {
      const next = await applyContentApprovedStep(session, state, event.payload);
      return next;
    }
    case "campaign_rejected":
    case "content_rejected": {
      const next = await applyRejectStep(session, state, event.event_type, event.payload);
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
      const processed = await processResumeEvent(currentSession, currentState, event);
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

