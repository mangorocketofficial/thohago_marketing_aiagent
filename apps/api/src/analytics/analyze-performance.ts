import type { AccumulatedInsights } from "@repo/types";
import { env } from "../lib/env";
import { callWithFallback } from "../orchestrator/llm-client";
import { loadOrgBrandSettings, parseAccumulatedInsights } from "../rag/data";
import { parsePerformanceAnalysisResponse } from "./analysis-response";
import { loadScoredContentsForAnalysis, type AnalysisContentRow } from "./data";
import {
  listRecentAnalysisReportSummaries,
  type AnalysisReportSummaryRecord,
  type PerformanceAnalysisDraft
} from "./report-repository";

const HIGH_SCORE_THRESHOLD = 70;
const MID_SCORE_THRESHOLD = 45;

const snippet = (value: string | null, maxLength = 180): string => {
  const normalized = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!normalized) {
    return "";
  }
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
};

const formatMetrics = (row: AnalysisContentRow) => ({
  likes: row.metrics.likes,
  views: row.metrics.views,
  comments: row.metrics.comments,
  shares: row.metrics.shares,
  saves: row.metrics.saves,
  follower_delta: row.metrics.follower_delta
});

const summarizeScoreDistribution = (rows: AnalysisContentRow[]) => {
  let high = 0;
  let mid = 0;
  let low = 0;

  for (const row of rows) {
    if (row.performance_score >= HIGH_SCORE_THRESHOLD) {
      high += 1;
      continue;
    }
    if (row.performance_score >= MID_SCORE_THRESHOLD) {
      mid += 1;
      continue;
    }
    low += 1;
  }

  return { high, mid, low };
};

const toPromptRows = (rows: AnalysisContentRow[]) =>
  rows.map((row) => ({
    channel: row.channel,
    score: Number(row.performance_score.toFixed(2)),
    published_at: row.published_at,
    body_snippet: snippet(row.body),
    metrics: formatMetrics(row)
  }));

const buildPrompt = (
  insights: AccumulatedInsights | null,
  scoredRows: AnalysisContentRow[],
  previousReports: AnalysisReportSummaryRecord[],
  brandContext: {
    brandSummary: string | null;
    detectedTone: string | null;
    targetAudience: string[];
  }
): string => {
  const sortedDesc = [...scoredRows].sort((left, right) => right.performance_score - left.performance_score);
  const sortedAsc = [...sortedDesc].reverse();
  const scoreDistribution = summarizeScoreDistribution(scoredRows);

  const payload = {
    organization_context: {
      brand_summary: brandContext.brandSummary,
      detected_tone: brandContext.detectedTone,
      target_audience: brandContext.targetAudience
    },
    current_performance_data: {
      total_scored_contents: scoredRows.length,
      tracked_channels: [...new Set(scoredRows.map((row) => row.channel))],
      score_distribution: scoreDistribution,
      accumulated_insights: insights
        ? {
            best_publish_times: insights.best_publish_times,
            top_cta_phrases: insights.top_cta_phrases,
            channel_recommendations: insights.channel_recommendations
          }
        : null
    },
    high_performing_contents: toPromptRows(sortedDesc.slice(0, 10)),
    low_performing_contents: toPromptRows(sortedAsc.slice(0, 5)),
    previous_analysis_summaries: previousReports.map((report) => ({
      id: report.id,
      analyzed_at: report.analyzed_at,
      summary: report.summary,
      key_actions: report.key_actions
    }))
  };

  return [
    "You are a marketing performance analyst for a Korean NGO.",
    "Analyze the payload and return STRICT JSON only.",
    'Return exactly one JSON object with keys: "summary", "key_actions", "markdown".',
    'The "summary" must be 3-5 Korean sentences.',
    'The "key_actions" array must contain 3-5 Korean action items.',
    'The "markdown" value must be a valid Korean markdown report using these H2 sections exactly:',
    "## 핵심 요약",
    "## 채널별 성과 분석",
    "## 콘텐츠 패턴 분석",
    "## CTA 효과 분석",
    "## 발행 전략 제안",
    "## 다음 사이클 액션",
    "## 이전 분석 대비 변화",
    "Do not wrap the JSON in markdown fences.",
    "",
    JSON.stringify(payload, null, 2)
  ].join("\n");
};

export const generatePerformanceAnalysis = async (
  orgId: string,
  options: { comparedReportLimit?: number } = {}
): Promise<PerformanceAnalysisDraft> => {
  const scoredRows = await loadScoredContentsForAnalysis(orgId);
  if (scoredRows.length < env.analysisMinScoredContents) {
    throw new Error(`At least ${env.analysisMinScoredContents} scored contents are required for analysis.`);
  }

  const [brandSettings, previousReports] = await Promise.all([
    loadOrgBrandSettings(orgId),
    listRecentAnalysisReportSummaries(orgId, options.comparedReportLimit ?? 2)
  ]);

  const insights = brandSettings ? parseAccumulatedInsights(brandSettings.accumulated_insights) : null;
  const prompt = buildPrompt(insights, scoredRows, previousReports, {
    brandSummary: brandSettings?.brand_summary ?? null,
    detectedTone: brandSettings?.detected_tone ?? null,
    targetAudience: brandSettings?.target_audience ?? []
  });

  const response = await callWithFallback({
    prompt,
    maxTokens: env.analysisMaxTokens,
    temperature: 0.2,
    orgId
  });

  if (!response.text) {
    throw new Error(response.errorMessage ?? "Analysis model did not return a response.");
  }

  return parsePerformanceAnalysisResponse(
    response.text,
    scoredRows.length,
    previousReports.map((report) => report.id),
    response.model
  );
};
