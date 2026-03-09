import fs from "node:fs";
import path from "node:path";
import type { AnalysisReportRecord } from "@repo/types";
import { env } from "../lib/env";

const formatPathTimestamp = (iso: string): string => {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return "unknown-time";
  }

  const yyyy = parsed.getUTCFullYear();
  const mm = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getUTCDate()).padStart(2, "0");
  const hh = String(parsed.getUTCHours()).padStart(2, "0");
  const min = String(parsed.getUTCMinutes()).padStart(2, "0");
  const sec = String(parsed.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}_${hh}${min}${sec}`;
};

export const buildAnalysisReportExportPath = (report: AnalysisReportRecord): string => {
  const baseDir = path.resolve(process.cwd(), env.analysisReportExportDir);
  return path.join(
    baseDir,
    report.org_id,
    `performance-analysis_${formatPathTimestamp(report.analyzed_at)}_${report.id}.md`
  );
};

export const exportAnalysisReportToFile = async (
  report: AnalysisReportRecord
): Promise<{ exportPath: string | null }> => {
  if (!env.analysisReportExportEnabled) {
    return { exportPath: null };
  }

  const exportPath = buildAnalysisReportExportPath(report);
  await fs.promises.mkdir(path.dirname(exportPath), { recursive: true });
  await fs.promises.writeFile(exportPath, report.markdown, "utf8");
  return { exportPath };
};
