import { HttpError } from "../../lib/errors";
import { supabaseAdmin } from "../../lib/supabase-admin";
import { normalizeSlotStatus, type ScheduleSlotStatus, type WorkflowStatus } from "../../orchestrator/scheduler-status";

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

type SlotRow = {
  id: string;
  scheduled_date: string;
  scheduled_time: string | null;
  slot_status: string;
  channel: string;
  content_type: string;
  campaign_id: string | null;
  workflow_item_id: string | null;
  content_id: string | null;
  session_id: string | null;
  title: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
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
  metadata: Record<string, unknown>;
  workflow_status: WorkflowStatus | null;
  updated_at: string;
  content: ContentRow | null;
};

export type ScheduledContentCursor = {
  scheduled_date: string;
  id: string;
};

export type ListScheduledContentParams = {
  orgId: string;
  startDate: string;
  endDate: string;
  timezone: string;
  campaignId?: string | "adhoc" | null;
  channel?: string | null;
  status?: ScheduleSlotStatus | null;
  limit: number;
  cursor?: ScheduledContentCursor | null;
};

export type ListScheduledContentResult = {
  items: ScheduledContentItem[];
  page: {
    nextCursor: ScheduledContentCursor | null;
    hasMore: boolean;
  };
  query: {
    timezone: string;
    startDate: string;
    endDate: string;
  };
};

const isMissingRelationError = (error: unknown): boolean =>
  !!error && typeof error === "object" && (error as { code?: string }).code === "42P01";

const asString = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

const asRecord = (value: unknown): Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

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

const buildCursorFilter = (cursor: ScheduledContentCursor): string =>
  `scheduled_date.gt.${cursor.scheduled_date},and(scheduled_date.eq.${cursor.scheduled_date},id.gt.${cursor.id})`;

export const listScheduledContentBySlotWindow = async (params: ListScheduledContentParams): Promise<ListScheduledContentResult> => {
  let query = supabaseAdmin
    .from("schedule_slots")
    .select(
      "id,scheduled_date,scheduled_time,slot_status,channel,content_type,campaign_id,workflow_item_id,content_id,session_id,title,metadata,created_at,updated_at"
    )
    .eq("org_id", params.orgId)
    .gte("scheduled_date", params.startDate)
    .lte("scheduled_date", params.endDate)
    .order("scheduled_date", { ascending: true })
    .order("id", { ascending: true })
    .limit(params.limit + 1);

  if (params.campaignId === "adhoc") {
    query = query.is("campaign_id", null);
  } else if (typeof params.campaignId === "string" && params.campaignId.trim()) {
    query = query.eq("campaign_id", params.campaignId.trim());
  }

  if (typeof params.channel === "string" && params.channel.trim()) {
    query = query.eq("channel", params.channel.trim().toLowerCase());
  }

  if (params.status) {
    query = query.eq("slot_status", params.status);
  }

  if (params.cursor) {
    query = query.or(buildCursorFilter(params.cursor));
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingRelationError(error)) {
      throw new HttpError(409, "schema_not_ready", "schedule_slots table is missing.");
    }
    throw new HttpError(500, "db_error", `Failed to query schedule slots: ${error.message}`);
  }

  const rows = ((data as SlotRow[] | null) ?? []).map((row) => ({
    ...row,
    metadata: asRecord(row.metadata)
  }));

  const hasMore = rows.length > params.limit;
  const visibleRows = hasMore ? rows.slice(0, params.limit) : rows;
  const lastVisible = visibleRows[visibleRows.length - 1] ?? null;
  const nextCursor: ScheduledContentCursor | null =
    hasMore && lastVisible
      ? {
          scheduled_date: lastVisible.scheduled_date,
          id: lastVisible.id
        }
      : null;

  const contentIds = [...new Set(visibleRows.map((row) => asString(row.content_id, "")).filter(Boolean))];
  const workflowIds = [...new Set(visibleRows.map((row) => asString(row.workflow_item_id, "")).filter(Boolean))];
  const [contentMap, workflowMap] = await Promise.all([
    loadContentsByIds(params.orgId, contentIds),
    loadWorkflowByIds(params.orgId, workflowIds)
  ]);

  const items = visibleRows.map((row) => {
    const contentId = asString(row.content_id, "").trim() || null;
    const workflowItemId = asString(row.workflow_item_id, "").trim() || null;
    const workflow = workflowItemId ? workflowMap.get(workflowItemId) ?? null : null;

    return {
      slot_id: asString(row.id, ""),
      scheduled_date: asString(row.scheduled_date, ""),
      scheduled_time: asString(row.scheduled_time, "").trim() || null,
      slot_status: normalizeSlotStatus(row.slot_status),
      channel: asString(row.channel, "instagram"),
      content_type: asString(row.content_type, "text"),
      campaign_id: asString(row.campaign_id, "").trim() || null,
      workflow_item_id: workflowItemId,
      content_id: contentId,
      session_id: asString(row.session_id, "").trim() || workflow?.session_id || null,
      title: asString(row.title, "").trim() || (contentId ? contentMap.get(contentId)?.body?.slice(0, 72) ?? null : null),
      metadata: row.metadata,
      workflow_status: workflow?.status ?? null,
      updated_at: asString(row.updated_at, asString(row.created_at, new Date().toISOString())),
      content: contentId ? contentMap.get(contentId) ?? null : null
    } satisfies ScheduledContentItem;
  });

  return {
    items,
    page: {
      nextCursor,
      hasMore
    },
    query: {
      timezone: params.timezone,
      startDate: params.startDate,
      endDate: params.endDate
    }
  };
};
