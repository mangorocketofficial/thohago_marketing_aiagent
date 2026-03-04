import { HttpError } from "../lib/errors";
import { supabaseAdmin } from "../lib/supabase-admin";
import type { WorkflowStatus } from "../workflow/types";
import type { CampaignPlan } from "./types";
import {
  asRecord,
  asString,
  asStringArray,
  buildCampaignPlanSummary,
  parseCampaignPlan
} from "./service-helpers";

type WorkspaceInboxItemType = "campaign_plan" | "content_draft";

type WorkspaceInboxCampaign = {
  id: string;
  org_id: string;
  title: string;
  activity_folder: string;
  status: string;
  channels: string[];
  plan: CampaignPlan;
  plan_chain_data: unknown;
  plan_document: string | null;
  created_at: string;
  updated_at: string;
  plan_summary: Record<string, unknown> | null;
};

type WorkspaceInboxContent = {
  id: string;
  org_id: string;
  campaign_id: string | null;
  channel: string;
  content_type: string;
  status: string;
  body: string | null;
  metadata: Record<string, unknown>;
  scheduled_at: string | null;
  published_at: string | null;
  embedded_at: string | null;
  created_by: string;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkspaceInboxItem = {
  workflow_item_id: string;
  type: WorkspaceInboxItemType;
  status: WorkflowStatus;
  expected_version: number;
  session_id: string | null;
  display_title: string | null;
  created_at: string;
  campaign: WorkspaceInboxCampaign | null;
  content: WorkspaceInboxContent | null;
};

const isWorkflowStatus = (value: unknown): value is WorkflowStatus =>
  value === "proposed" || value === "revision_requested" || value === "approved" || value === "rejected";

const parseWorkflowStatus = (value: unknown): WorkflowStatus => (isWorkflowStatus(value) ? value : "proposed");

const parseInboxType = (value: unknown): WorkspaceInboxItemType | null => {
  const normalized = asString(value, "").trim();
  if (normalized === "campaign_plan" || normalized === "content_draft") {
    return normalized;
  }
  return null;
};

const toSafeCampaignPlan = (value: unknown): CampaignPlan => {
  const parsed = parseCampaignPlan(value);
  if (parsed) {
    return parsed;
  }
  return {
    objective: "",
    channels: [],
    duration_days: 7,
    post_count: 1,
    content_types: [],
    suggested_schedule: []
  };
};

const fetchCampaignRows = async (orgId: string, campaignIds: string[]): Promise<Record<string, unknown>[]> => {
  if (campaignIds.length === 0) {
    return [];
  }
  const { data, error } = await supabaseAdmin
    .from("campaigns")
    .select("id,org_id,title,activity_folder,status,channels,plan,plan_chain_data,plan_document,created_at,updated_at")
    .eq("org_id", orgId)
    .in("id", campaignIds);

  if (error) {
    throw new HttpError(500, "db_error", `Failed to query workspace inbox campaigns: ${error.message}`);
  }
  return (data as Record<string, unknown>[] | null) ?? [];
};

const fetchContentRows = async (orgId: string, contentIds: string[]): Promise<Record<string, unknown>[]> => {
  if (contentIds.length === 0) {
    return [];
  }
  const { data, error } = await supabaseAdmin
    .from("contents")
    .select(
      "id,org_id,campaign_id,channel,content_type,status,body,metadata,scheduled_at,published_at,embedded_at,created_by,approved_by,created_at,updated_at"
    )
    .eq("org_id", orgId)
    .in("id", contentIds);

  if (error) {
    throw new HttpError(500, "db_error", `Failed to query workspace inbox contents: ${error.message}`);
  }
  return (data as Record<string, unknown>[] | null) ?? [];
};

const buildCampaignMap = (
  orgId: string,
  campaignsRaw: Record<string, unknown>[]
): Map<string, WorkspaceInboxCampaign> => {
  const campaignById = new Map<string, WorkspaceInboxCampaign>();
  for (const row of campaignsRaw) {
    const id = asString(row.id, "").trim();
    if (!id) {
      continue;
    }
    const plan = toSafeCampaignPlan(row.plan);
    campaignById.set(id, {
      id,
      org_id: asString(row.org_id, orgId),
      title: asString(row.title, ""),
      activity_folder: asString(row.activity_folder, ""),
      status: asString(row.status, "draft"),
      channels: asStringArray(row.channels).map((entry) => entry.toLowerCase()),
      plan,
      plan_chain_data: row.plan_chain_data ?? null,
      plan_document: typeof row.plan_document === "string" ? row.plan_document : null,
      created_at: asString(row.created_at, ""),
      updated_at: asString(row.updated_at, ""),
      plan_summary: buildCampaignPlanSummary({ plan, planChainData: row.plan_chain_data })
    });
  }
  return campaignById;
};

const buildContentMap = (orgId: string, contentsRaw: Record<string, unknown>[]): Map<string, WorkspaceInboxContent> => {
  const contentById = new Map<string, WorkspaceInboxContent>();
  for (const row of contentsRaw) {
    const id = asString(row.id, "").trim();
    if (!id) {
      continue;
    }
    contentById.set(id, {
      id,
      org_id: asString(row.org_id, orgId),
      campaign_id: asString(row.campaign_id, "").trim() || null,
      channel: asString(row.channel, ""),
      content_type: asString(row.content_type, ""),
      status: asString(row.status, ""),
      body: typeof row.body === "string" ? row.body : null,
      metadata: asRecord(row.metadata),
      scheduled_at: asString(row.scheduled_at, "").trim() || null,
      published_at: asString(row.published_at, "").trim() || null,
      embedded_at: asString(row.embedded_at, "").trim() || null,
      created_by: asString(row.created_by, "ai"),
      approved_by: asString(row.approved_by, "").trim() || null,
      created_at: asString(row.created_at, ""),
      updated_at: asString(row.updated_at, "")
    });
  }
  return contentById;
};

export const listWorkspaceInboxItemsForOrg = async (params: {
  orgId: string;
  limit?: number;
}): Promise<WorkspaceInboxItem[]> => {
  const safeLimit =
    typeof params.limit === "number" && Number.isFinite(params.limit)
      ? Math.max(1, Math.min(100, Math.floor(params.limit)))
      : 50;

  const { data: workflowRowsRaw, error: workflowError } = await supabaseAdmin
    .from("workflow_items")
    .select("id,type,status,version,session_id,display_title,source_campaign_id,source_content_id,created_at,payload")
    .eq("org_id", params.orgId)
    .eq("status", "proposed")
    .in("type", ["campaign_plan", "content_draft"])
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (workflowError) {
    throw new HttpError(500, "db_error", `Failed to query workspace inbox workflow items: ${workflowError.message}`);
  }

  const workflowRows = Array.isArray(workflowRowsRaw) ? (workflowRowsRaw as Record<string, unknown>[]) : [];
  const campaignIds = [
    ...new Set(
      workflowRows
        .map((row) => asString(row.source_campaign_id, "").trim())
        .filter((entry): entry is string => !!entry)
    )
  ];
  const contentIds = [
    ...new Set(
      workflowRows
        .map((row) => asString(row.source_content_id, "").trim())
        .filter((entry): entry is string => !!entry)
    )
  ];

  const [campaignRows, contentRows] = await Promise.all([
    fetchCampaignRows(params.orgId, campaignIds),
    fetchContentRows(params.orgId, contentIds)
  ]);
  const campaignById = buildCampaignMap(params.orgId, campaignRows);
  const contentById = buildContentMap(params.orgId, contentRows);

  const items: WorkspaceInboxItem[] = [];
  for (const row of workflowRows) {
    const type = parseInboxType(row.type);
    if (!type) {
      continue;
    }

    const workflowItemId = asString(row.id, "").trim();
    if (!workflowItemId) {
      continue;
    }

    const payload = asRecord(row.payload);
    const sourceCampaignId = asString(row.source_campaign_id, "").trim();
    const sourceContentId = asString(row.source_content_id, "").trim();
    const campaignFromDb = sourceCampaignId ? campaignById.get(sourceCampaignId) ?? null : null;
    const contentFromDb = sourceContentId ? contentById.get(sourceContentId) ?? null : null;
    const fallbackPlan = toSafeCampaignPlan(payload.plan);
    const fallbackPlanSummary =
      payload.plan_summary && typeof payload.plan_summary === "object" && !Array.isArray(payload.plan_summary)
        ? (payload.plan_summary as Record<string, unknown>)
        : null;

    const campaign =
      type === "campaign_plan" && sourceCampaignId
        ? (campaignFromDb ?? {
            id: sourceCampaignId,
            org_id: params.orgId,
            title: asString(payload.display_title, asString(row.display_title, "")),
            activity_folder: asString(payload.activity_folder, ""),
            status: "draft",
            channels: fallbackPlan.channels,
            plan: fallbackPlan,
            plan_chain_data: payload.plan_chain_data ?? null,
            plan_document: typeof payload.plan_document === "string" ? payload.plan_document : null,
            created_at: asString(row.created_at, ""),
            updated_at: asString(row.created_at, ""),
            plan_summary:
              fallbackPlanSummary ?? buildCampaignPlanSummary({ plan: fallbackPlan, planChainData: payload.plan_chain_data })
          })
        : null;

    items.push({
      workflow_item_id: workflowItemId,
      type,
      status: parseWorkflowStatus(row.status),
      expected_version:
        typeof row.version === "number" && Number.isFinite(row.version)
          ? Math.max(1, Math.floor(row.version))
          : 1,
      session_id: asString(row.session_id, "").trim() || null,
      display_title: asString(row.display_title, "").trim() || null,
      created_at: asString(row.created_at, ""),
      campaign,
      content: type === "content_draft" ? contentFromDb : null
    });
  }

  return items;
};
