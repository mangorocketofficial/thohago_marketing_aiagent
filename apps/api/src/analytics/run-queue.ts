import type { AnalysisRunRecord, AnalysisTriggerReason } from "@repo/types";
import { env } from "../lib/env";
import { supabaseAdmin } from "../lib/supabase-admin";
import {
  countNewMetricsSince,
  countScoredContentsForAnalysis,
  hasQueuedOrRunningAnalysisRun,
  loadLatestMetricHighWatermark
} from "./data";
import { getLatestAnalysisReport } from "./report-repository";

export type EnqueueAnalysisRunResult = {
  queued: boolean;
  run: AnalysisRunRecord | null;
  reason:
    | "queued"
    | "already_queued"
    | "not_enough_data"
    | "cooldown"
    | "below_threshold"
    | "not_due";
  message: string;
};

const readOptionalString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const toAnalysisRunRecord = (value: Record<string, unknown>): AnalysisRunRecord => ({
  id: readOptionalString(value.id) ?? "",
  org_id: readOptionalString(value.org_id) ?? "",
  trigger_reason: (readOptionalString(value.trigger_reason) ?? "manual") as AnalysisTriggerReason,
  status: (readOptionalString(value.status) ?? "queued") as AnalysisRunRecord["status"],
  idempotency_key: readOptionalString(value.idempotency_key) ?? "",
  requested_at: readOptionalString(value.requested_at) ?? new Date(0).toISOString(),
  started_at: readOptionalString(value.started_at),
  completed_at: readOptionalString(value.completed_at),
  lease_owner: readOptionalString(value.lease_owner),
  lease_expires_at: readOptionalString(value.lease_expires_at),
  metric_high_watermark: readOptionalString(value.metric_high_watermark),
  report_id: readOptionalString(value.report_id),
  last_error: readOptionalString(value.last_error)
});

const hoursToMs = (hours: number): number => Math.max(0, hours) * 60 * 60 * 1000;

const isWithinCooldown = (lastAnalyzedAt: string | null): boolean => {
  if (!lastAnalyzedAt) {
    return false;
  }
  const parsed = Date.parse(lastAnalyzedAt);
  if (!Number.isFinite(parsed)) {
    return false;
  }
  return Date.now() - parsed < hoursToMs(env.analysisCooldownHours);
};

const buildCadenceCutoffIso = (): string => {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() - env.analysisCadenceDays);
  return now.toISOString();
};

const buildIdempotencyKey = (orgId: string, triggerReason: AnalysisTriggerReason, metricHighWatermark: string | null): string => {
  if (triggerReason === "new_metrics") {
    return `analysis:new_metrics:${orgId}:${metricHighWatermark ?? "none"}`;
  }
  if (triggerReason === "cadence") {
    return `analysis:cadence:${orgId}:${new Date().toISOString().slice(0, 10)}`;
  }
  if (triggerReason === "recovery") {
    return `analysis:recovery:${orgId}:${metricHighWatermark ?? Date.now()}`;
  }
  return `analysis:manual:${orgId}:${Date.now()}`;
};

const getExistingRunByIdempotencyKey = async (orgId: string, idempotencyKey: string): Promise<AnalysisRunRecord | null> => {
  const { data, error } = await supabaseAdmin
    .from("analytics_analysis_runs")
    .select("*")
    .eq("org_id", orgId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load existing analysis run: ${error.message}`);
  }

  if (!data || typeof data !== "object") {
    return null;
  }

  return toAnalysisRunRecord(data as Record<string, unknown>);
};

export const enqueueAnalysisRun = async (
  orgId: string,
  triggerReason: AnalysisTriggerReason,
  params: { idempotencyKey?: string; metricHighWatermark?: string | null } = {}
): Promise<AnalysisRunRecord> => {
  const idempotencyKey = params.idempotencyKey ?? buildIdempotencyKey(orgId, triggerReason, params.metricHighWatermark ?? null);

  const { data, error } = await supabaseAdmin
    .from("analytics_analysis_runs")
    .insert({
      org_id: orgId,
      trigger_reason: triggerReason,
      status: "queued",
      idempotency_key: idempotencyKey,
      metric_high_watermark: params.metricHighWatermark ?? null
    })
    .select("*")
    .single();

  if (!error && data && typeof data === "object") {
    return toAnalysisRunRecord(data as Record<string, unknown>);
  }

  if ((error as { code?: string } | null)?.code === "23505") {
    const existing = await getExistingRunByIdempotencyKey(orgId, idempotencyKey);
    if (existing) {
      return existing;
    }
  }

  throw new Error(`Failed to enqueue analysis run: ${error?.message ?? "unknown"}`);
};

export const maybeEnqueueAnalysisRun = async (
  orgId: string,
  triggerReason: AnalysisTriggerReason
): Promise<EnqueueAnalysisRunResult> => {
  if (await hasQueuedOrRunningAnalysisRun(orgId)) {
    return {
      queued: false,
      run: null,
      reason: "already_queued",
      message: "An analysis run is already queued or running."
    };
  }

  const scoredContentCount = await countScoredContentsForAnalysis(orgId);
  if (scoredContentCount < env.analysisMinScoredContents) {
    return {
      queued: false,
      run: null,
      reason: "not_enough_data",
      message: `At least ${env.analysisMinScoredContents} scored contents are required for analysis.`
    };
  }

  const latestReport = await getLatestAnalysisReport(orgId);
  if (isWithinCooldown(latestReport?.analyzed_at ?? null)) {
    return {
      queued: false,
      run: null,
      reason: "cooldown",
      message: `Analysis cannot run again within ${env.analysisCooldownHours} hours of the latest report.`
    };
  }

  const metricHighWatermark = await loadLatestMetricHighWatermark(orgId);

  if (triggerReason === "new_metrics") {
    const newMetricCount = await countNewMetricsSince(orgId, latestReport?.analyzed_at ?? null);
    if (newMetricCount < env.analysisNewMetricsThreshold) {
      return {
        queued: false,
        run: null,
        reason: "below_threshold",
        message: `${env.analysisNewMetricsThreshold} or more new metrics are required before another automatic analysis run.`
      };
    }
  }

  if (triggerReason === "cadence") {
    const cadenceCutoffIso = buildCadenceCutoffIso();
    const latestAnalyzedAt = latestReport?.analyzed_at ?? null;
    if (latestAnalyzedAt && latestAnalyzedAt >= cadenceCutoffIso) {
      return {
        queued: false,
        run: null,
        reason: "not_due",
        message: `Cadence analysis is not due until ${env.analysisCadenceDays} days have passed.`
      };
    }
  }

  const run = await enqueueAnalysisRun(orgId, triggerReason, { metricHighWatermark });
  return {
    queued: true,
    run,
    reason: "queued",
    message: "Analysis run queued."
  };
};

export const claimNextQueuedAnalysisRun = async (leaseOwner: string): Promise<AnalysisRunRecord | null> => {
  const { data, error } = await supabaseAdmin
    .from("analytics_analysis_runs")
    .select("*")
    .eq("status", "queued")
    .order("requested_at", { ascending: true })
    .limit(20);

  if (error) {
    throw new Error(`Failed to load queued analysis runs: ${error.message}`);
  }

  for (const row of Array.isArray(data) ? data : []) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const run = toAnalysisRunRecord(row as Record<string, unknown>);
    const leaseExpiresAt = new Date(Date.now() + env.analysisLeaseMs).toISOString();
    const { data: claimed, error: claimError } = await supabaseAdmin
      .from("analytics_analysis_runs")
      .update({
        status: "running",
        started_at: new Date().toISOString(),
        lease_owner: leaseOwner,
        lease_expires_at: leaseExpiresAt,
        last_error: null
      })
      .eq("id", run.id)
      .eq("status", "queued")
      .select("*")
      .maybeSingle();

    if (claimError) {
      throw new Error(`Failed to claim analysis run ${run.id}: ${claimError.message}`);
    }

    if (claimed && typeof claimed === "object") {
      return toAnalysisRunRecord(claimed as Record<string, unknown>);
    }
  }

  return null;
};

export const requeueStaleAnalysisRuns = async (): Promise<number> => {
  const staleCutoffIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("analytics_analysis_runs")
    .select("id")
    .eq("status", "running")
    .lt("lease_expires_at", staleCutoffIso)
    .limit(100);

  if (error) {
    throw new Error(`Failed to load stale analysis runs: ${error.message}`);
  }

  let updated = 0;
  for (const row of Array.isArray(data) ? data : []) {
    const id = readOptionalString((row as Record<string, unknown>).id);
    if (!id) {
      continue;
    }

    const { error: updateError } = await supabaseAdmin
      .from("analytics_analysis_runs")
      .update({
        status: "queued",
        lease_owner: null,
        lease_expires_at: null,
        started_at: null,
        completed_at: null,
        last_error: "lease_expired_requeued"
      })
      .eq("id", id)
      .eq("status", "running");

    if (updateError) {
      throw new Error(`Failed to requeue stale analysis run ${id}: ${updateError.message}`);
    }

    updated += 1;
  }

  return updated;
};

export const markAnalysisRunDone = async (runId: string, reportId: string): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("analytics_analysis_runs")
    .update({
      status: "done",
      completed_at: new Date().toISOString(),
      lease_owner: null,
      lease_expires_at: null,
      report_id: reportId,
      last_error: null
    })
    .eq("id", runId);

  if (error) {
    throw new Error(`Failed to mark analysis run done (${runId}): ${error.message}`);
  }
};

export const markAnalysisRunFailed = async (runId: string, errorMessage: string): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("analytics_analysis_runs")
    .update({
      status: "failed",
      completed_at: new Date().toISOString(),
      lease_owner: null,
      lease_expires_at: null,
      last_error: errorMessage.slice(0, 500)
    })
    .eq("id", runId);

  if (error) {
    throw new Error(`Failed to mark analysis run failed (${runId}): ${error.message}`);
  }
};
