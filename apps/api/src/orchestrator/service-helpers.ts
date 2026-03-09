import { ANALYTICS_CHANNELS, isAnalyticsChannel } from "@repo/analytics";
import { HttpError } from "../lib/errors";
import type {
  CampaignPlan,
  ForbiddenCheckMeta,
  OrchestratorStep,
  PipelineTriggerRow,
  RagContextMeta,
  SessionState
} from "./types";

export const DEFAULT_WORKSPACE_TYPE = "general";
export const DEFAULT_SCOPE_ID = "default";

const CHANNEL_SET = new Set(ANALYTICS_CHANNELS);

export const asString = (value: unknown, fallback = ""): string => {
  if (typeof value === "string") {
    return value;
  }
  return fallback;
};

export const normalizeWorkspaceType = (value: unknown, fallback = DEFAULT_WORKSPACE_TYPE): string => {
  const normalized = asString(value, fallback).trim().toLowerCase();
  return normalized || fallback;
};

export const normalizeScopeId = (value: unknown): string | null => {
  const normalized = asString(value, "").trim();
  return normalized ? normalized : null;
};

export const buildWorkspaceKey = (workspaceType: string, scopeId?: string | null): string => {
  const normalizedType = normalizeWorkspaceType(workspaceType);
  const normalizedScope = normalizeScopeId(scopeId) ?? DEFAULT_SCOPE_ID;
  return `${normalizedType}:${normalizedScope}`;
};

export const isWorkspaceKeyColumnMissingError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }
  const message = typeof (error as { message?: unknown }).message === "string" ? (error as { message: string }).message : "";
  return message.includes("workspace_key") && message.includes("does not exist");
};

export const isContextLabelColumnMissingError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }
  const message = typeof (error as { message?: unknown }).message === "string" ? (error as { message: string }).message : "";
  return message.includes("context_label") && message.includes("does not exist");
};

export const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
};

export const normalizeStep = (value: unknown): OrchestratorStep => {
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

export const parseCampaignPlan = (value: unknown): CampaignPlan | null => {
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
  if (level === "full" || level === "partial" || level === "minimal") {
    return level;
  }
  if (level === "tier1_only") {
    return "partial";
  }
  if (level === "no_context") {
    return "minimal";
  }
  return "minimal";
};

export const buildCampaignPlanSummary = (params: {
  plan: SessionState["campaign_plan"] | null;
  planChainData?: unknown;
}): Record<string, unknown> | null => {
  if (!params.plan) {
    return null;
  }
  const planChainData = asRecord(params.planChainData);
  const calendar = asRecord(planChainData.calendar);
  const weeks = Array.isArray(calendar.weeks) ? calendar.weeks : [];

  return {
    channels: Array.isArray(params.plan.channels) ? params.plan.channels : [],
    duration_days:
      typeof params.plan.duration_days === "number" && Number.isFinite(params.plan.duration_days)
        ? Math.max(1, Math.floor(params.plan.duration_days))
        : null,
    post_count:
      typeof params.plan.post_count === "number" && Number.isFinite(params.plan.post_count)
        ? Math.max(1, Math.floor(params.plan.post_count))
        : null,
    week_count: Math.max(0, weeks.length)
  };
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

const parseSkillConfidence = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.min(1, parsed));
    }
  }
  return null;
};

const emptyStateFromTrigger = (trigger: PipelineTriggerRow): SessionState => ({
  trigger_id: trigger.id,
  activity_folder: trigger.activity_folder,
  file_name: trigger.file_name,
  file_type: trigger.file_type,
  active_skill: null,
  active_skill_started_at: null,
  active_skill_version: null,
  active_skill_confidence: null,
  skill_lock_id: null,
  skill_lock_source: null,
  skill_lock_at: null,
  user_message: null,
  campaign_id: null,
  campaign_survey: null,
  instagram_survey: null,
  campaign_draft_version: 0,
  campaign_chain_data: null,
  campaign_plan_document: null,
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

export const parseState = (raw: unknown, trigger: PipelineTriggerRow | null): SessionState => {
  if (!raw || typeof raw !== "object") {
    if (!trigger) {
      throw new HttpError(500, "invalid_state", "Session state is missing trigger context.");
    }
    return emptyStateFromTrigger(trigger);
  }

  const row = raw as Record<string, unknown>;
  const fileTypeRaw = asString(row.file_type, trigger?.file_type ?? "document");
  const fileType = fileTypeRaw === "video" ? "video" : fileTypeRaw === "image" ? "image" : "document";

  return {
    trigger_id: asString(row.trigger_id, trigger?.id ?? ""),
    activity_folder: asString(row.activity_folder, trigger?.activity_folder ?? ""),
    file_name: asString(row.file_name, trigger?.file_name ?? ""),
    file_type: fileType,
    active_skill:
      typeof row.active_skill === "string" && row.active_skill.trim() ? row.active_skill.trim() : null,
    active_skill_started_at:
      typeof row.active_skill_started_at === "string" && row.active_skill_started_at.trim()
        ? row.active_skill_started_at.trim()
        : null,
    active_skill_version:
      typeof row.active_skill_version === "string" && row.active_skill_version.trim()
        ? row.active_skill_version.trim()
        : null,
    active_skill_confidence: row.active_skill_confidence === null ? null : parseSkillConfidence(row.active_skill_confidence),
    skill_lock_id:
      typeof row.skill_lock_id === "string" && row.skill_lock_id.trim() ? row.skill_lock_id.trim() : null,
    skill_lock_source:
      row.skill_lock_source === "manual" || row.skill_lock_source === "llm_auto" ? row.skill_lock_source : null,
    skill_lock_at:
      typeof row.skill_lock_at === "string" && row.skill_lock_at.trim() ? row.skill_lock_at.trim() : null,
    user_message: row.user_message === null ? null : asString(row.user_message, ""),
    campaign_id: row.campaign_id === null ? null : asString(row.campaign_id, ""),
    campaign_survey:
      row.campaign_survey && typeof row.campaign_survey === "object" && !Array.isArray(row.campaign_survey)
        ? (row.campaign_survey as SessionState["campaign_survey"])
        : null,
    instagram_survey:
      row.instagram_survey && typeof row.instagram_survey === "object" && !Array.isArray(row.instagram_survey)
        ? (row.instagram_survey as Record<string, unknown>)
        : null,
    campaign_draft_version:
      typeof row.campaign_draft_version === "number" && Number.isFinite(row.campaign_draft_version)
        ? Math.max(0, Math.floor(row.campaign_draft_version))
        : 0,
    campaign_chain_data:
      row.campaign_chain_data && typeof row.campaign_chain_data === "object" && !Array.isArray(row.campaign_chain_data)
        ? (row.campaign_chain_data as Record<string, unknown>)
        : null,
    campaign_plan_document:
      typeof row.campaign_plan_document === "string" && row.campaign_plan_document.trim()
        ? row.campaign_plan_document
        : null,
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

export const normalizeChannel = (value: unknown): string => {
  const candidate = asString(value, "instagram").trim().toLowerCase();
  return isAnalyticsChannel(candidate) && CHANNEL_SET.has(candidate) ? candidate : "instagram";
};

const truncateDisplayTitle = (value: string, maxLength = 50): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return normalized.slice(0, maxLength).trimEnd();
};

export const buildCampaignDisplayTitle = (activityFolder: string, userMessage: string | null): string => {
  const folder = activityFolder.trim();
  if (folder) {
    return folder;
  }
  return truncateDisplayTitle(userMessage ?? "") || "Campaign plan";
};

export const buildContentDisplayTitle = (activityFolder: string, channel: string, userMessage: string | null): string => {
  const folder = activityFolder.trim();
  const normalizedChannel = normalizeChannel(channel);
  if (folder) {
    return `${folder} - ${normalizedChannel}`;
  }
  return truncateDisplayTitle(userMessage ?? "") || `Content draft - ${normalizedChannel}`;
};

export const messageFromError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown orchestration error";
};

export const buildManualSessionState = (
  workspaceType: string,
  scopeId: string | null,
  title: string | null
): SessionState => {
  const preferredScope = normalizeScopeId(scopeId);
  const titleValue = title ? title.trim() : "";
  const activityFolder = preferredScope ?? (titleValue || workspaceType || DEFAULT_WORKSPACE_TYPE);
  return {
    trigger_id: "",
    activity_folder: activityFolder,
    file_name: "",
    file_type: "document",
    active_skill: null,
    active_skill_started_at: null,
    active_skill_version: null,
    active_skill_confidence: null,
    skill_lock_id: null,
    skill_lock_source: null,
    skill_lock_at: null,
    user_message: null,
    campaign_id: null,
    campaign_survey: null,
    instagram_survey: null,
    campaign_draft_version: 0,
    campaign_chain_data: null,
    campaign_plan_document: null,
    campaign_workflow_item_id: null,
    campaign_plan: null,
    content_id: null,
    content_workflow_item_id: null,
    content_draft: null,
    rag_context: null,
    forbidden_check: null,
    processed_event_ids: [],
    last_error: null
  };
};
