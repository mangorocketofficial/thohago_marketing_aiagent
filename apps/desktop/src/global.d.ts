export {};
import type {
  Campaign,
  BrandProfile,
  ChatActionCardAction,
  ChatActionCardEventType,
  Content,
  InterviewAnswers,
  OnboardingCrawlSourceResult,
  OnboardingCrawlStatus,
  OnboardingResultDocument,
  OrgEntitlement,
  OrchestratorSession,
  WorkflowStatus
} from "@repo/types";

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

type ChatAction =
  | "get-active-session"
  | "send-message"
  | "approve-campaign"
  | "approve-content"
  | "reject"
  | "dispatch-action";

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
  timelineScope: "session" | "org";
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

type ChatSessionListParams = {
  limit?: number;
  cursor?: string | null;
  workspaceType?: string;
  scopeId?: string | null;
  archived?: boolean;
};

type ChatSessionListResult = {
  ok: boolean;
  sessions: OrchestratorSession[];
  next_cursor: string | null;
  message?: string;
};

type ChatInboxPlanSummary = {
  channels: string[];
  duration_days: number | null;
  post_count: number | null;
  week_count: number | null;
};

type ChatInboxCampaign = Campaign & {
  plan_summary?: ChatInboxPlanSummary | null;
};

type ChatInboxItem = {
  workflow_item_id: string;
  type: "campaign_plan" | "content_draft";
  status: WorkflowStatus;
  expected_version: number;
  session_id: string | null;
  display_title: string | null;
  created_at: string;
  campaign: ChatInboxCampaign | null;
  content: Content | null;
};

type ChatInboxListResult = {
  ok: boolean;
  items: ChatInboxItem[];
  message?: string;
};

type ChatScheduledContentItem = {
  slot_id: string;
  scheduled_date: string;
  scheduled_time: string | null;
  slot_status: "scheduled" | "generating" | "pending_approval" | "approved" | "published" | "skipped" | "failed";
  channel: string;
  content_type: string;
  campaign_id: string | null;
  workflow_item_id: string | null;
  content_id: string | null;
  session_id: string | null;
  title: string | null;
  workflow_status: WorkflowStatus | null;
  content: Content | null;
};

type ChatScheduledContentListResult = {
  ok: boolean;
  items: ChatScheduledContentItem[];
  message?: string;
};

type ChatPendingFolderUpdate = {
  activity_folder: string;
  pending_count: number;
  first_detected_at: string;
  last_detected_at: string;
  file_type_counts: {
    image: number;
    video: number;
    document: number;
  };
};

type ChatFolderUpdateListResult = {
  ok: boolean;
  folder_updates: ChatPendingFolderUpdate[];
  message?: string;
};

type ChatAcknowledgeFolderUpdatesResult = {
  ok: boolean;
  activity_folder: string;
  updated_count: number;
  message?: string;
};

type ChatCreateSessionPayload = {
  workspaceType: string;
  scopeId?: string | null;
  title?: string | null;
  startPaused?: boolean;
};

type ChatCreateSessionResult = {
  ok: boolean;
  reused: boolean;
  session: OrchestratorSession | null;
  message?: string;
};

type ChatRecommendedSessionPayload = {
  workspaceType: string;
  scopeId?: string | null;
};

type ChatRecommendedSessionResult = {
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

type ChatDispatchActionPayload = {
  sessionId: string;
  workflowItemId: string;
  expectedVersion: number;
  actionId: ChatActionCardAction["id"];
  eventType: ChatActionCardEventType;
  contentId?: string;
  mode?: "revision";
  reason?: string;
  editedBody?: string;
};

type ChatSendUiContext = {
  source: "workspace-chat" | "context-panel-widget" | "global-chat-panel";
  pageId: string;
  contextPanelMode?: "agent-chat" | "page-context";
  focusWorkflowItemId?: string;
  focusContentId?: string;
  focusCampaignId?: string;
};

type SecureAuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
};

type EntitlementResponse = {
  ok: boolean;
} & OrgEntitlement;

type BillingCheckoutResult = {
  ok: boolean;
  message: string | null;
  url: string | null;
};

type OnboardingSynthesisResponse = {
  ok: boolean;
  org_id: string;
  brand_profile: BrandProfile;
  onboarding_result_document: OnboardingResultDocument;
  review_markdown?: string;
  review_export_path?: string | null;
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
      billing: {
        getEntitlement: (payload: {
          accessToken?: string;
          orgId?: string;
        }) => Promise<EntitlementResponse>;
        refreshEntitlement: (payload: {
          accessToken?: string;
          orgId?: string;
        }) => Promise<EntitlementResponse>;
        openCheckout: (payload?: { orgId?: string }) => Promise<BillingCheckoutResult>;
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
        onCrawlProgress: (cb: (payload: {
          source: "website" | "naver_blog" | "instagram" | null;
          sourceState: OnboardingCrawlSourceResult | null;
          crawlState: OnboardingCrawlStatus;
        }) => void) => () => void;
        onCrawlComplete: (cb: (payload: { crawlState: OnboardingCrawlStatus }) => void) => () => void;
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
          entitlement: OrgEntitlement;
        }>;
        getCrawlState: () => Promise<OnboardingCrawlStatus>;
        startCrawl: (payload: {
          urls: {
            websiteUrl: string;
            naverBlogUrl: string;
            instagramUrl: string;
          };
        }) => Promise<OnboardingCrawlStatus>;
        saveInterview: (payload: {
          accessToken?: string;
          orgId?: string;
          interviewAnswers: InterviewAnswers;
        }) => Promise<{
          ok: boolean;
          org_id: string;
          interview_answers: InterviewAnswers;
        }>;
        synthesize: (payload: {
          accessToken?: string;
          orgId?: string;
          interviewAnswers: InterviewAnswers;
          synthesisMode?: "phase_1_7a" | "phase_1_7b";
          urlMetadata?: {
            website_url?: string;
            naver_blog_url?: string;
            instagram_url?: string;
            facebook_url?: string;
            youtube_url?: string;
            threads_url?: string;
          };
        }) => Promise<OnboardingSynthesisResponse>;
        getLastSynthesis: () => Promise<OnboardingSynthesisResponse | null>;
        chooseFolder: () => Promise<string | null>;
        createFolder: () => Promise<string | null>;
        complete: (payload: { watchPath: string; orgId?: string }) => Promise<WatcherStatus>;
      };
      chat: {
        onActionResult: (cb: (payload: ChatActionResult) => void) => () => void;
        onActionError: (cb: (payload: ChatActionError) => void) => () => void;
        getConfig: () => Promise<ChatConfig>;
        getActiveSession: () => Promise<ChatActiveSessionResult>;
        listSessions: (payload?: ChatSessionListParams) => Promise<ChatSessionListResult>;
        listInboxItems: (payload?: { limit?: number }) => Promise<ChatInboxListResult>;
        listScheduledContent: (payload?: { limit?: number }) => Promise<ChatScheduledContentListResult>;
        listFolderUpdates: (payload?: { limit?: number }) => Promise<ChatFolderUpdateListResult>;
        acknowledgeFolderUpdates: (payload: {
          activityFolder: string;
        }) => Promise<ChatAcknowledgeFolderUpdatesResult>;
        createSession: (payload: ChatCreateSessionPayload) => Promise<ChatCreateSessionResult>;
        getRecommendedSession: (payload: ChatRecommendedSessionPayload) => Promise<ChatRecommendedSessionResult>;
        sendMessage: (payload: {
          sessionId: string;
          content: string;
          uiContext?: ChatSendUiContext;
        }) => Promise<ChatResumeResult>;
        approveCampaign: (payload: { sessionId: string; campaignId: string }) => Promise<ChatResumeResult>;
        approveContent: (payload: { sessionId: string; contentId: string; editedBody?: string }) => Promise<ChatResumeResult>;
        reject: (payload: {
          sessionId: string;
          type: "campaign" | "content";
          id: string;
          reason?: string;
        }) => Promise<ChatResumeResult>;
        dispatchAction: (payload: ChatDispatchActionPayload) => Promise<ChatResumeResult>;
      };
    };
  }
}
