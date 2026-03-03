export type RuntimeSummary = {
  platform: string;
  watchPath: string;
  isRunning: boolean;
  fileCount: number;
  scanCount: number;
  activeSessionId: string;
  sessionStep: string;
  sessionStatus: string;
};
