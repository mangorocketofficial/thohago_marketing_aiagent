import { useMemo } from "react";
import type { OrchestratorSession } from "@repo/types";

type RuntimeSummaryInput = {
  runtimePlatform: string;
  watchPath: string | null | undefined;
  isRunning: boolean | null | undefined;
  fileCount: number | null | undefined;
  scanCount: number | null | undefined;
  activeSession: OrchestratorSession | null;
  formatSessionStatus: (session: OrchestratorSession | null) => string;
};

export const useRuntime = ({
  runtimePlatform,
  watchPath,
  isRunning,
  fileCount,
  scanCount,
  activeSession,
  formatSessionStatus
}: RuntimeSummaryInput) =>
  useMemo(
    () => ({
      platform: runtimePlatform,
      watchPath: watchPath ?? "-",
      isRunning: isRunning === true,
      fileCount: fileCount ?? 0,
      scanCount: scanCount ?? 0,
      activeSessionId: activeSession?.id ?? "None",
      sessionStep: activeSession?.current_step ?? "-",
      sessionStatus: formatSessionStatus(activeSession)
    }),
    [activeSession, fileCount, formatSessionStatus, isRunning, runtimePlatform, scanCount, watchPath]
  );

