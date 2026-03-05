import { HttpError } from "../lib/errors";
import { supabaseAdmin } from "../lib/supabase-admin";
import {
  normalizeSlotStatus,
  resolveSlotStatusFromContent,
  type ContentStatus,
  type ScheduleSlotStatus,
  type WorkflowStatus
} from "./scheduler-status";
import { asString } from "./service-helpers";

type ContentRow = {
  id: string;
  campaign_id: string | null;
  channel: string;
  content_type: string;
  status: string;
  body: string | null;
  metadata: Record<string, unknown>;
  scheduled_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

type WorkflowRow = {
  id: string;
  source_content_id: string | null;
  status: WorkflowStatus;
  session_id: string | null;
};

export type ScheduledContentItem = {
  slot_id: string;
  scheduled_date: string;
  scheduled_time: string | null;
  slot_status: ScheduleSlotStatus;
  channel: string;
  content_type: string;
  campaign_id: string | null;
  workflow_item_id: string | null;
  content_id: string | null;
  session_id: string | null;
  title: string | null;
  workflow_status: WorkflowStatus | null;
  content: ContentRow | null;
};

const isMissingRelationError = (error: unknown): boolean =>
  !!error && typeof error === "object" && (error as { code?: string }).code === "42P01";

const toDateKey = (iso: string | null | undefined): string => {
  if (!iso) {
    return new Date().toISOString().slice(0, 10);
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
};

const asContentStatus = (value: string): ContentStatus => {
  if (
    value === "draft" ||
    value === "pending_approval" ||
    value === "approved" ||
    value === "published" ||
    value === "rejected" ||
    value === "historical"
  ) {
    return value;
  }
  return "draft";
};

const loadContentsByIds = async (orgId: string, ids: string[]): Promise<Map<string, ContentRow>> => {
  if (ids.length === 0) {
    return new Map();
  }

  const { data, error } = await supabaseAdmin
    .from("contents")
    .select("id,campaign_id,channel,content_type,status,body,metadata,scheduled_at,published_at,created_at,updated_at")
    .eq("org_id", orgId)
    .in("id", ids);

  if (error) {
    throw new HttpError(500, "db_error", `Failed to load contents for scheduler: ${error.message}`);
  }

  const map = new Map<string, ContentRow>();
  for (const row of (data as ContentRow[] | null) ?? []) {
    map.set(row.id, row);
  }
  return map;
};

const loadWorkflowByIds = async (orgId: string, ids: string[]): Promise<Map<string, WorkflowRow>> => {
  if (ids.length === 0) {
    return new Map();
  }

  const { data, error } = await supabaseAdmin
    .from("workflow_items")
    .select("id,source_content_id,status,session_id")
    .eq("org_id", orgId)
    .in("id", ids);

  if (error) {
    throw new HttpError(500, "db_error", `Failed to load workflow items for scheduler: ${error.message}`);
  }

  const map = new Map<string, WorkflowRow>();
  for (const row of (data as WorkflowRow[] | null) ?? []) {
    map.set(row.id, row);
  }
  return map;
};

const listScheduledContentFromSlots = async (orgId: string, limit: number): Promise<ScheduledContentItem[]> => {
  const { data, error } = await supabaseAdmin
    .from("schedule_slots")
    .select(
      "id,scheduled_date,scheduled_time,slot_status,channel,content_type,campaign_id,workflow_item_id,content_id,session_id,title,created_at"
    )
    .eq("org_id", orgId)
    .order("scheduled_date", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new HttpError(500, "db_error", `Failed to query schedule slots: ${error.message}`);
  }

  const rows = (data as Record<string, unknown>[] | null) ?? [];
  if (rows.length === 0) {
    return [];
  }

  const contentIds = [...new Set(rows.map((row) => asString(row.content_id, "")).filter(Boolean))];
  const workflowIds = [...new Set(rows.map((row) => asString(row.workflow_item_id, "")).filter(Boolean))];

  const [contentMap, workflowMap] = await Promise.all([
    loadContentsByIds(orgId, contentIds),
    loadWorkflowByIds(orgId, workflowIds)
  ]);

  return rows.map((row) => {
    const contentId = asString(row.content_id, "").trim() || null;
    const workflowItemId = asString(row.workflow_item_id, "").trim() || null;
    const content = contentId ? contentMap.get(contentId) ?? null : null;
    const workflow = workflowItemId ? workflowMap.get(workflowItemId) ?? null : null;
    const workflowStatus = workflow?.status ?? null;

    const slotStatus = content
      ? resolveSlotStatusFromContent({
          contentStatus: asContentStatus(content.status),
          workflowStatus
        })
      : normalizeSlotStatus(row.slot_status);

    return {
      slot_id: asString(row.id, ""),
      scheduled_date: asString(row.scheduled_date, toDateKey(content?.scheduled_at ?? null)),
      scheduled_time: asString(row.scheduled_time, "").trim() || content?.scheduled_at || null,
      slot_status: slotStatus,
      channel: asString(row.channel, content?.channel ?? "instagram"),
      content_type: asString(row.content_type, content?.content_type ?? "text"),
      campaign_id: asString(row.campaign_id, "").trim() || content?.campaign_id || null,
      workflow_item_id: workflowItemId,
      content_id: contentId,
      session_id: asString(row.session_id, "").trim() || workflow?.session_id || null,
      title: asString(row.title, "").trim() || null,
      workflow_status: workflowStatus,
      content
    };
  });
};

const listScheduledContentFromContents = async (orgId: string, limit: number): Promise<ScheduledContentItem[]> => {
  const { data: contentRows, error: contentError } = await supabaseAdmin
    .from("contents")
    .select("id,campaign_id,channel,content_type,status,body,metadata,scheduled_at,published_at,created_at,updated_at")
    .eq("org_id", orgId)
    .order("scheduled_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(limit);

  if (contentError) {
    throw new HttpError(500, "db_error", `Failed to query content schedule fallback: ${contentError.message}`);
  }

  const contents = (contentRows as ContentRow[] | null) ?? [];
  if (contents.length === 0) {
    return [];
  }

  const contentIds = contents.map((entry) => entry.id);
  const { data: workflowRows, error: workflowError } = await supabaseAdmin
    .from("workflow_items")
    .select("id,source_content_id,status,session_id")
    .eq("org_id", orgId)
    .in("source_content_id", contentIds);

  if (workflowError) {
    throw new HttpError(500, "db_error", `Failed to query workflow schedule fallback: ${workflowError.message}`);
  }

  const workflowByContentId = new Map<string, WorkflowRow>();
  for (const row of (workflowRows as WorkflowRow[] | null) ?? []) {
    const sourceContentId = asString(row.source_content_id, "").trim();
    if (!sourceContentId || workflowByContentId.has(sourceContentId)) {
      continue;
    }
    workflowByContentId.set(sourceContentId, row);
  }

  return contents.map((content) => {
    const workflow = workflowByContentId.get(content.id) ?? null;
    return {
      slot_id: `content:${content.id}`,
      scheduled_date: toDateKey(content.scheduled_at ?? content.created_at),
      scheduled_time: content.scheduled_at,
      slot_status: resolveSlotStatusFromContent({
        contentStatus: asContentStatus(content.status),
        workflowStatus: workflow?.status ?? null
      }),
      channel: content.channel,
      content_type: content.content_type,
      campaign_id: content.campaign_id,
      workflow_item_id: workflow?.id ?? null,
      content_id: content.id,
      session_id: workflow?.session_id ?? null,
      title: content.body?.trim().slice(0, 72) || null,
      workflow_status: workflow?.status ?? null,
      content
    };
  });
};

export const listScheduledContentForOrg = async (params: {
  orgId: string;
  limit?: number;
}): Promise<ScheduledContentItem[]> => {
  const safeLimit =
    typeof params.limit === "number" && Number.isFinite(params.limit)
      ? Math.max(1, Math.min(500, Math.floor(params.limit)))
      : 200;

  const fromSlots = await listScheduledContentFromSlots(params.orgId, safeLimit);
  if (fromSlots.length > 0) {
    return fromSlots;
  }

  return listScheduledContentFromContents(params.orgId, safeLimit);
};
