export {};
import type { OrchestratorSession } from "@repo/types";

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

type DesktopAppConfig = {
  watchPath: string;
  orgId: string;
  language: "ko" | "en";
  onboardingCompleted: boolean;
  onboardingDraft: {
    websiteUrl: string;
    naverBlogUrl: string;
    instagramUrl: string;
    facebookUrl: string;
    youtubeUrl: string;
    threadsUrl: string;
  };
};

type WatcherOpenFolderResult = {
  ok: boolean;
  message: string | null;
};

type ChatAction = "get-active-session" | "send-message" | "approve-campaign" | "approve-content" | "reject";

type ChatActionResult = {
  action: ChatAction;
  ok: boolean;
  sessionId: string | null;
};

type ChatActionError = {
  action: ChatAction;
  message: string;
  sessionId: string | null;
};

type ChatConfig = {
  orgId: string;
  apiBaseUrl: string;
  apiToken: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseAccessToken: string;
  enabled: boolean;
  message: string | null;
};

type ChatActiveSessionResult = {
  ok: boolean;
  session: OrchestratorSession | null;
  message?: string;
};

type ChatResumeResult = {
  ok: boolean;
  session_id: string;
  current_step: string;
  status: string;
  idempotent?: boolean;
};

type SecureAuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
};

declare global {
  interface Window {
    desktopRuntime: {
      platform: string;
      app: {
        getConfig: () => Promise<DesktopAppConfig>;
        setLanguage: (language: "ko" | "en") => Promise<DesktopAppConfig>;
      };
      auth: {
        getStoredSession: () => Promise<SecureAuthSession | null>;
        saveSession: (payload: SecureAuthSession) => Promise<SecureAuthSession>;
        clearSession: () => Promise<{ ok: boolean }>;
        startGoogleOAuth: () => Promise<SecureAuthSession>;
      };
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
        saveDraft: (draftPatch: Partial<DesktopAppConfig["onboardingDraft"]>) => Promise<DesktopAppConfig>;
        setOrgId: (orgId: string) => Promise<DesktopAppConfig>;
        bootstrapOrg: (payload: {
          accessToken: string;
          name?: string;
          orgName?: string;
        }) => Promise<{
          ok: boolean;
          created: boolean;
          org: {
            id: string;
            name: string;
            org_type: string;
          };
          membership: {
            role: "owner" | "admin" | "member";
          };
        }>;
        chooseFolder: () => Promise<string | null>;
        createFolder: () => Promise<string | null>;
        complete: (payload: { watchPath: string; orgId?: string }) => Promise<WatcherStatus>;
      };
      chat: {
        onActionResult: (cb: (payload: ChatActionResult) => void) => () => void;
        onActionError: (cb: (payload: ChatActionError) => void) => () => void;
        getConfig: () => Promise<ChatConfig>;
        getActiveSession: () => Promise<ChatActiveSessionResult>;
        sendMessage: (payload: { sessionId: string; content: string }) => Promise<ChatResumeResult>;
        approveCampaign: (payload: { sessionId: string; campaignId: string }) => Promise<ChatResumeResult>;
        approveContent: (payload: { sessionId: string; contentId: string }) => Promise<ChatResumeResult>;
        reject: (payload: {
          sessionId: string;
          type: "campaign" | "content";
          id: string;
          reason?: string;
        }) => Promise<ChatResumeResult>;
      };
    };
  }
}
