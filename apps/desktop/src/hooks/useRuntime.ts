import { useMemo } from "react";
import type { RuntimeSummary } from "../types/runtime";

type RuntimeSummaryInput = {
  runtimePlatform: string;
  watchPath: string | null | undefined;
  isRunning: boolean | null | undefined;
  fileCount: number | null | undefined;
  scanCount: number | null | undefined;
};

export const useRuntime = ({
  runtimePlatform,
  watchPath,
  isRunning,
  fileCount,
  scanCount
}: RuntimeSummaryInput): RuntimeSummary =>
  useMemo(
    () => ({
      platform: runtimePlatform,
      watchPath: watchPath ?? "-",
      isRunning: isRunning === true,
      fileCount: fileCount ?? 0,
      scanCount: scanCount ?? 0
    }),
    [fileCount, isRunning, runtimePlatform, scanCount, watchPath]
  );
