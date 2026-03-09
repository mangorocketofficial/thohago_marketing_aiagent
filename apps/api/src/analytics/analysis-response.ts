import type { PerformanceAnalysisDraft } from "./report-repository";

const readOptionalString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const stripCodeFences = (value: string): string => {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]+?)\s*```$/i);
  return fenced ? (fenced[1] ?? "").trim() : trimmed;
};

const parseJsonObject = (value: string): Record<string, unknown> | null => {
  const normalized = stripCodeFences(value);
  try {
    const parsed = JSON.parse(normalized) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    const start = normalized.indexOf("{");
    const end = normalized.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return null;
    }
    try {
      const parsed = JSON.parse(normalized.slice(start, end + 1)) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
};

const parseKeyActions = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
        .slice(0, 5)
    : [];

export const parsePerformanceAnalysisResponse = (
  responseText: string,
  contentCount: number,
  comparedReportIds: string[],
  modelUsed: "claude" | "gpt-4o-mini"
): PerformanceAnalysisDraft => {
  const parsed = parseJsonObject(responseText);
  if (!parsed) {
    throw new Error("Analysis model response was not valid JSON.");
  }

  const summary = readOptionalString(parsed.summary);
  const markdown = readOptionalString(parsed.markdown);
  const keyActions = parseKeyActions(parsed.key_actions);
  if (!summary || !markdown || keyActions.length === 0) {
    throw new Error("Analysis model response is missing required fields.");
  }

  return {
    summary,
    markdown,
    key_actions: keyActions,
    analyzed_at: new Date().toISOString(),
    content_count: contentCount,
    model_used: modelUsed,
    compared_report_ids: comparedReportIds
  };
};
