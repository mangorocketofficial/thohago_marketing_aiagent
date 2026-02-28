export {};

type RendererFileType = "image" | "video" | "document";
type RendererFileStatus = "active" | "deleted";

type RendererFileEntry = {
  relativePath: string;
  fileName: string;
  activityFolder: string;
  fileType: RendererFileType;
  fileSize: number;
  extension: string;
  detectedAt: string;
  status: RendererFileStatus;
};

type WatcherStatus = {
  watchPath: string | null;
  orgId: string;
  fileCount: number;
  isRunning: boolean;
  requiresOnboarding: boolean;
};

type WatcherOpenFolderResult = {
  ok: boolean;
  message: string | null;
};

declare global {
  interface Window {
    desktopRuntime: {
      platform: string;
      watcher: {
        onFileIndexed: (cb: (entry: RendererFileEntry) => void) => () => void;
        onFileDeleted: (cb: (entry: { relativePath: string; fileName: string }) => void) => () => void;
        onScanComplete: (cb: (payload: { count: number }) => void) => () => void;
        onStatusChanged: (cb: (status: WatcherStatus) => void) => () => void;
        onShowOnboarding: (cb: () => void) => () => void;
        getStatus: () => Promise<WatcherStatus>;
        getFiles: () => Promise<RendererFileEntry[]>;
        openFolder: () => Promise<WatcherOpenFolderResult>;
      };
      onboarding: {
        chooseFolder: () => Promise<string | null>;
        createFolder: () => Promise<string | null>;
        complete: (watchPath: string) => Promise<WatcherStatus>;
      };
    };
  }
}
