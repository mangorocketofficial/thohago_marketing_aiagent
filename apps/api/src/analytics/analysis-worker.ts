import crypto from "node:crypto";
import { env } from "../lib/env";
import { invalidateMemoryCache } from "../rag/memory-service";
import { loadOrgIdsForAnalysisSweep } from "./data";
import { exportAnalysisReportToFile } from "./report-export";
import { indexAnalysisReportInRag } from "./report-rag-indexer";
import { attachAnalysisReportExport, insertAnalysisReport } from "./report-repository";
import {
  claimNextQueuedAnalysisRun,
  markAnalysisRunDone,
  markAnalysisRunFailed,
  maybeEnqueueAnalysisRun,
  requeueStaleAnalysisRuns
} from "./run-queue";
import { generatePerformanceAnalysis } from "./analyze-performance";

const DISPATCH_INTERVAL_MS = 15_000;
const workerId = `analytics-worker:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;

let workerStarted = false;
let dispatchTimer: NodeJS.Timeout | null = null;
let recoveryTimer: NodeJS.Timeout | null = null;
let cadenceTimer: NodeJS.Timeout | null = null;
let processing = false;

const processNextRun = async (): Promise<void> => {
  if (processing) {
    return;
  }

  processing = true;
  try {
    const run = await claimNextQueuedAnalysisRun(workerId);
    if (!run) {
      return;
    }

    try {
      const draft = await generatePerformanceAnalysis(run.org_id);
      let report = await insertAnalysisReport(run.org_id, draft, run.trigger_reason);

      try {
        const exportResult = await exportAnalysisReportToFile(report);
        if (exportResult.exportPath) {
          report = await attachAnalysisReportExport(report.id, exportResult.exportPath);
        }
      } catch (error) {
        console.warn(
          `[ANALYTICS] Report export failed for org ${run.org_id}: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      await indexAnalysisReportInRag(run.org_id, report);
      await invalidateMemoryCache(run.org_id);
      await markAnalysisRunDone(run.id, report.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await markAnalysisRunFailed(run.id, message);
      console.warn(`[ANALYTICS] Analysis run failed for org ${run.org_id}: ${message}`);
    }
  } finally {
    processing = false;
  }
};

const runRecovery = async (): Promise<void> => {
  const requeued = await requeueStaleAnalysisRuns();
  if (requeued > 0) {
    console.warn(`[ANALYTICS] Requeued ${requeued} stale analysis runs.`);
  }
  await processNextRun();
};

const runCadenceSweep = async (): Promise<void> => {
  const orgIds = await loadOrgIdsForAnalysisSweep();
  for (const orgId of orgIds) {
    try {
      await maybeEnqueueAnalysisRun(orgId, "cadence");
    } catch (error) {
      console.warn(
        `[ANALYTICS] Cadence enqueue failed for org ${orgId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  await processNextRun();
};

export const startAnalyticsAnalysisWorker = (): void => {
  if (workerStarted || !env.analyticsWorkerEnabled) {
    return;
  }

  workerStarted = true;

  void runRecovery().catch((error) => {
    console.warn(`[ANALYTICS] Initial recovery failed: ${error instanceof Error ? error.message : String(error)}`);
  });
  void runCadenceSweep().catch((error) => {
    console.warn(`[ANALYTICS] Initial cadence sweep failed: ${error instanceof Error ? error.message : String(error)}`);
  });

  dispatchTimer = setInterval(() => {
    void processNextRun().catch((error) => {
      console.warn(`[ANALYTICS] Dispatch tick failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, DISPATCH_INTERVAL_MS);
  dispatchTimer.unref?.();

  recoveryTimer = setInterval(() => {
    void runRecovery().catch((error) => {
      console.warn(`[ANALYTICS] Recovery tick failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, env.analysisRecoveryIntervalMs);
  recoveryTimer.unref?.();

  cadenceTimer = setInterval(() => {
    void runCadenceSweep().catch((error) => {
      console.warn(`[ANALYTICS] Cadence sweep failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, env.analysisCadenceSweepIntervalMs);
  cadenceTimer.unref?.();
};

export const stopAnalyticsAnalysisWorker = (): void => {
  if (dispatchTimer) {
    clearInterval(dispatchTimer);
    dispatchTimer = null;
  }
  if (recoveryTimer) {
    clearInterval(recoveryTimer);
    recoveryTimer = null;
  }
  if (cadenceTimer) {
    clearInterval(cadenceTimer);
    cadenceTimer = null;
  }
  workerStarted = false;
};
