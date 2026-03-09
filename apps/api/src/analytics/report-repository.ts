import crypto from "node:crypto";
import type { AnalysisReportRecord, AnalysisTriggerReason, LatestAnalysisSummary } from "@repo/types";
import { supabaseAdmin } from "../lib/supabase-admin";

export type PerformanceAnalysisDraft = {
  markdown: string;
  summary: string;
  key_actions: string[];
  analyzed_at: string;
  content_count: number;
  model_used: "claude" | "gpt-4o-mini";
  compared_report_ids: string[];
};

export type AnalysisReportSummaryRecord = Pick<
  AnalysisReportRecord,
  "id" | "summary" | "key_actions" | "content_count" | "analyzed_at"
>;

const readOptionalString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
    : [];

const readInteger = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

const toAnalysisReportRecord = (value: Record<string, unknown>): AnalysisReportRecord => ({
  id: readOptionalString(value.id) ?? "",
  org_id: readOptionalString(value.org_id) ?? "",
  trigger_reason: (readOptionalString(value.trigger_reason) ?? "manual") as AnalysisTriggerReason,
  summary: readOptionalString(value.summary) ?? "",
  key_actions: readStringArray(value.key_actions),
  markdown: readOptionalString(value.markdown) ?? "",
  markdown_hash: readOptionalString(value.markdown_hash) ?? "",
  content_count: readInteger(value.content_count, 0),
  model_used: readOptionalString(value.model_used) ?? "",
  compared_report_ids: readStringArray(value.compared_report_ids),
  export_path: readOptionalString(value.export_path),
  exported_at: readOptionalString(value.exported_at),
  analyzed_at: readOptionalString(value.analyzed_at) ?? new Date(0).toISOString(),
  created_at: readOptionalString(value.created_at) ?? new Date(0).toISOString(),
  updated_at: readOptionalString(value.updated_at) ?? new Date(0).toISOString()
});

const toSummaryRecord = (report: AnalysisReportRecord): AnalysisReportSummaryRecord => ({
  id: report.id,
  summary: report.summary,
  key_actions: report.key_actions,
  content_count: report.content_count,
  analyzed_at: report.analyzed_at
});

export const buildAnalysisMarkdownHash = (markdown: string): string =>
  crypto.createHash("sha256").update(markdown).digest("hex");

export const insertAnalysisReport = async (
  orgId: string,
  draft: PerformanceAnalysisDraft,
  triggerReason: AnalysisTriggerReason
): Promise<AnalysisReportRecord> => {
  const payload = {
    org_id: orgId,
    trigger_reason: triggerReason,
    summary: draft.summary,
    key_actions: draft.key_actions,
    markdown: draft.markdown,
    markdown_hash: buildAnalysisMarkdownHash(draft.markdown),
    content_count: draft.content_count,
    model_used: draft.model_used,
    compared_report_ids: draft.compared_report_ids,
    analyzed_at: draft.analyzed_at
  };

  const { data, error } = await supabaseAdmin.from("analysis_reports").insert(payload).select("*").single();
  if (error) {
    throw new Error(`Failed to insert analysis report: ${error.message}`);
  }

  return toAnalysisReportRecord(data as Record<string, unknown>);
};

export const attachAnalysisReportExport = async (
  reportId: string,
  exportPath: string
): Promise<AnalysisReportRecord> => {
  const { data, error } = await supabaseAdmin
    .from("analysis_reports")
    .update({
      export_path: exportPath,
      exported_at: new Date().toISOString()
    })
    .eq("id", reportId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to update analysis report export metadata: ${error.message}`);
  }

  return toAnalysisReportRecord(data as Record<string, unknown>);
};

export const getLatestAnalysisReport = async (orgId: string): Promise<AnalysisReportRecord | null> => {
  const { data, error } = await supabaseAdmin
    .from("analysis_reports")
    .select("*")
    .eq("org_id", orgId)
    .order("analyzed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load latest analysis report: ${error.message}`);
  }

  if (!data || typeof data !== "object") {
    return null;
  }

  return toAnalysisReportRecord(data as Record<string, unknown>);
};

export const getAnalysisReportById = async (orgId: string, reportId: string): Promise<AnalysisReportRecord | null> => {
  const { data, error } = await supabaseAdmin
    .from("analysis_reports")
    .select("*")
    .eq("org_id", orgId)
    .eq("id", reportId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load analysis report ${reportId}: ${error.message}`);
  }

  if (!data || typeof data !== "object") {
    return null;
  }

  return toAnalysisReportRecord(data as Record<string, unknown>);
};

export const listRecentAnalysisReports = async (orgId: string, limit = 4): Promise<AnalysisReportRecord[]> => {
  const safeLimit = Math.max(1, Math.min(20, Math.floor(limit)));
  const { data, error } = await supabaseAdmin
    .from("analysis_reports")
    .select("*")
    .eq("org_id", orgId)
    .order("analyzed_at", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(`Failed to list recent analysis reports: ${error.message}`);
  }

  return (Array.isArray(data) ? data : [])
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
    .map(toAnalysisReportRecord);
};

export const listRecentAnalysisReportSummaries = async (orgId: string, limit = 2): Promise<AnalysisReportSummaryRecord[]> => {
  const reports = await listRecentAnalysisReports(orgId, limit);
  return reports.map(toSummaryRecord);
};

export const toLatestAnalysisSummary = (report: AnalysisReportRecord | null): LatestAnalysisSummary | null => {
  if (!report) {
    return null;
  }

  return {
    summary: report.summary,
    key_actions: report.key_actions,
    analyzed_at: report.analyzed_at,
    content_count: report.content_count
  };
};
