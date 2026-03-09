import { chunkByHeading } from "@repo/rag";
import type { AnalysisReportRecord } from "@repo/types";
import { env } from "../lib/env";
import { getRagEmbedder, ragConfig, ragStore } from "../lib/rag";
import { supabaseAdmin } from "../lib/supabase-admin";
import { listRecentAnalysisReports } from "./report-repository";

const MAX_EMBEDDING_ROWS = 2000;

export const buildAnalysisReportChunks = (report: AnalysisReportRecord) =>
  chunkByHeading(report.markdown, {
    sourceType: "analysis_report",
    sourceId: report.id,
    metadata: {
      report_id: report.id,
      analyzed_at: report.analyzed_at,
      content_count: report.content_count
    }
  }).map((chunk) => ({
    ...chunk,
    metadata: {
      ...chunk.metadata,
      section_title: typeof chunk.metadata.section_heading === "string" ? chunk.metadata.section_heading : null
    }
  }));

export const pruneOldAnalysisReportEmbeddings = async (orgId: string, keepLatestReports = env.analysisReportHistoryRagCount) => {
  const keepReports = await listRecentAnalysisReports(orgId, keepLatestReports);
  const keepIds = new Set(keepReports.map((report) => report.id));

  const { data, error } = await supabaseAdmin
    .from("org_rag_embeddings")
    .select("source_id")
    .eq("org_id", orgId)
    .eq("source_type", "analysis_report")
    .limit(MAX_EMBEDDING_ROWS);

  if (error) {
    throw new Error(`Failed to load analysis report embeddings for pruning: ${error.message}`);
  }

  const seen = new Set<string>();
  for (const row of Array.isArray(data) ? data : []) {
    const sourceId = typeof row?.source_id === "string" ? row.source_id.trim() : "";
    if (!sourceId || seen.has(sourceId) || keepIds.has(sourceId)) {
      continue;
    }

    seen.add(sourceId);
    await ragStore.deleteBySource(orgId, "analysis_report", sourceId, ragConfig.defaultEmbeddingProfile);
  }
};

export const indexAnalysisReportInRag = async (orgId: string, report: AnalysisReportRecord): Promise<void> => {
  const chunks = buildAnalysisReportChunks(report);
  const profile = ragConfig.defaultEmbeddingProfile;
  if (!chunks.length) {
    await ragStore.deleteBySource(orgId, "analysis_report", report.id, profile);
    await pruneOldAnalysisReportEmbeddings(orgId);
    return;
  }

  const embedder = getRagEmbedder();
  const embeddings = await embedder.generateEmbeddings(
    chunks.map((chunk) => chunk.content),
    profile
  );

  await ragStore.replaceBySource(orgId, "analysis_report", report.id, chunks, embeddings, profile);
  await pruneOldAnalysisReportEmbeddings(orgId);
};
