import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import { NavigationProvider } from "./context/NavigationContext";
import { useChat } from "./hooks/useChat";
import { useRuntime } from "./hooks/useRuntime";
import { MainLayout } from "./layouts/MainLayout";
import { AgentChatPage } from "./pages/AgentChat";
import { DashboardPage } from "./pages/Dashboard";
import { SettingsPage } from "./pages/Settings";
import type {
  Campaign,
  ChatActionCardDispatchInput,
  ChatMessage,
  Content,
  InterviewAnswers,
  OnboardingCrawlSourceResult,
  OnboardingCrawlStatus,
  OrgEntitlement,
  OrchestratorSession,
  WorkflowStatus
} from "@repo/types";

type UiMode = "loading" | "onboarding" | "dashboard";
type Runtime = Window["desktopRuntime"];
type WatcherStatus = Awaited<ReturnType<Runtime["watcher"]["getStatus"]>>;
type RendererFileEntry = Awaited<ReturnType<Runtime["watcher"]["getFiles"]>>[number];
type ChatConfig = Awaited<ReturnType<Runtime["chat"]["getConfig"]>>;
type DesktopAppConfig = Awaited<ReturnType<Runtime["app"]["getConfig"]>>;
type OnboardingDraft = DesktopAppConfig["onboardingDraft"];
type OnboardingStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
type AuthMode = "sign_in" | "sign_up";
type OnboardingSynthesisResult = Awaited<ReturnType<Runtime["onboarding"]["synthesize"]>>;
type EntitlementResponse = Awaited<ReturnType<Runtime["billing"]["getEntitlement"]>>;
type WorkflowItemLinkRow = {
  id: string;
  source_campaign_id: string | null;
  source_content_id: string | null;
  status: WorkflowStatus;
  version: number | string;
};
type WorkflowLinkHint = {
  workflowItemId: string;
  workflowStatus: WorkflowStatus;
  version: number;
};
const REFRESH_ACTIVE_SESSION_DEBOUNCE_MS = 250;
const ONBOARDING_STEPS: OnboardingStep[] = [0, 1, 2, 3, 4, 5, 6, 7];
const FALLBACK_ENTITLEMENT: OrgEntitlement = {
  org_id: "",
  status: "past_due",
  is_entitled: false,
  trial_ends_at: null,
  current_period_end: null
};

const resolveOnboardingEntryStep = (watchPath: string | null | undefined): OnboardingStep =>
  String(watchPath ?? "").trim() ? 1 : 0;

const defaultOnboardingDraft = (): OnboardingDraft => ({
  websiteUrl: "",
  naverBlogUrl: "",
  instagramUrl: "",
  facebookUrl: "",
  youtubeUrl: "",
  threadsUrl: ""
});

const defaultInterviewAnswers = (): InterviewAnswers => ({
  q1: "",
  q2: "",
  q3: "",
  q4: ""
});

const defaultOnboardingCrawlStatus = (): OnboardingCrawlStatus => ({
  state: "idle",
  started_at: null,
  finished_at: null,
  sources: {
    website: {
      source: "website",
      url: "",
      status: "pending",
      started_at: null,
      finished_at: null,
      error: null,
      data: null
    },
    naver_blog: {
      source: "naver_blog",
      url: "",
      status: "pending",
      started_at: null,
      finished_at: null,
      error: null,
      data: null
    },
    instagram: {
      source: "instagram",
      url: "",
      status: "pending",
      started_at: null,
      finished_at: null,
      error: null,
      data: null
    }
  }
});

const isCrawlSourceComplete = (source: OnboardingCrawlSourceResult): boolean =>
  source.status === "done" || source.status === "partial" || source.status === "failed" || source.status === "skipped";

const isCrawlFullyComplete = (status: OnboardingCrawlStatus): boolean =>
  isCrawlSourceComplete(status.sources.website) &&
  isCrawlSourceComplete(status.sources.naver_blog) &&
  isCrawlSourceComplete(status.sources.instagram);

const formatCrawlStatusLabel = (status: OnboardingCrawlSourceResult["status"]): string => {
  if (status === "pending") {
    return "Pending";
  }
  if (status === "running") {
    return "Running";
  }
  if (status === "done") {
    return "Done";
  }
  if (status === "partial") {
    return "Partial";
  }
  if (status === "failed") {
    return "Failed";
  }
  if (status === "skipped") {
    return "Skipped";
  }
  return status;
};

const formatSessionStatus = (session: OrchestratorSession | null): string => {
  if (!session) {
    return "-";
  }
  if (session.status !== "paused") {
    return session.status;
  }

  if (session.current_step === "await_user_input") {
    return "paused (awaiting user input)";
  }
  if (session.current_step === "await_campaign_approval") {
    return "paused (awaiting campaign approval)";
  }
  if (session.current_step === "await_content_approval") {
    return "paused (awaiting content approval)";
  }
  return "paused (waiting for next event)";
};

const formatDateTime = (iso: string | null | undefined): string => {
  if (!iso) {
    return "-";
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return parsed.toLocaleString();
};

const isWorkflowStatus = (value: unknown): value is WorkflowStatus =>
  value === "proposed" || value === "revision_requested" || value === "approved" || value === "rejected";

const toPositiveIntOrDefault = (value: unknown, fallback: number): number => {
  const normalized =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(normalized)) {
    return fallback;
  }
  return Math.max(1, Math.floor(normalized));
};

type RuntimeActionError = Error & {
  code?: string;
  status?: number;
  details?: Record<string, unknown>;
};

const toRuntimeActionError = (error: unknown, fallbackMessage: string): RuntimeActionError => {
  const message = error instanceof Error ? error.message : fallbackMessage;
  const next = new Error(message) as RuntimeActionError;

  if (error && typeof error === "object") {
    const row = error as Record<string, unknown>;
    if (typeof row.code === "string") {
      next.code = row.code;
    }
    if (typeof row.status === "number" && Number.isFinite(row.status)) {
      next.status = Math.floor(row.status);
    }
    if (row.details && typeof row.details === "object" && !Array.isArray(row.details)) {
      next.details = row.details as Record<string, unknown>;
    }
  }

  return next;
};

const buildVersionConflictNotice = (error: RuntimeActionError): string => {
  const details = error.details ?? {};
  const currentVersion =
    typeof details.current_version === "number" && Number.isFinite(details.current_version)
      ? Math.floor(details.current_version)
      : null;
  const expectedVersion =
    typeof details.expected_version === "number" && Number.isFinite(details.expected_version)
      ? Math.floor(details.expected_version)
      : null;

  if (currentVersion && expectedVersion) {
    return `Action failed due to stale card version (expected v${expectedVersion}, current v${currentVersion}). Refreshed latest timeline.`;
  }
  if (currentVersion) {
    return `Action failed due to stale card version (current v${currentVersion}). Refreshed latest timeline.`;
  }
  return "Action failed due to stale card version. Refreshed latest timeline.";
};

const isValidHttpUrl = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const parseJwtExpiration = (token: string): number | null => {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded));
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
};

const sortMessages = (messages: ChatMessage[]): ChatMessage[] =>
  [...messages].sort((a, b) => a.created_at.localeCompare(b.created_at));

const upsertMessage = (messages: ChatMessage[], next: ChatMessage): ChatMessage[] => {
  const withoutOld = messages.filter((item) => item.id !== next.id);
  return sortMessages([...withoutOld, next]);
};

let cachedSupabaseClient: SupabaseClient | null = null;
let cachedSupabaseClientKey = "";
let cachedAuthSupabaseClient: SupabaseClient | null = null;
let cachedAuthSupabaseClientKey = "";

const getSupabaseClientForConfig = (config: ChatConfig | null): SupabaseClient | null => {
  if (!config?.enabled || !config.supabaseUrl || !config.supabaseAnonKey) {
    return null;
  }

  const cacheKey = [
    config.supabaseUrl,
    config.supabaseAnonKey.slice(0, 16),
    config.supabaseAccessToken.slice(0, 16)
  ].join("|");

  if (cachedSupabaseClient && cachedSupabaseClientKey === cacheKey) {
    return cachedSupabaseClient;
  }

  const client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: "desktop-runtime-auth"
    },
    ...(config.supabaseAccessToken
      ? {
          global: {
            headers: {
              Authorization: `Bearer ${config.supabaseAccessToken}`
            }
          }
        }
      : {})
  });

  if (config.supabaseAccessToken) {
    client.realtime.setAuth(config.supabaseAccessToken);
  }

  cachedSupabaseClient = client;
  cachedSupabaseClientKey = cacheKey;
  return client;
};

const getAuthSupabaseClient = (config: ChatConfig | null): SupabaseClient | null => {
  if (!config?.supabaseUrl || !config.supabaseAnonKey) {
    return null;
  }

  const cacheKey = [config.supabaseUrl, config.supabaseAnonKey.slice(0, 16)].join("|");
  if (cachedAuthSupabaseClient && cachedAuthSupabaseClientKey === cacheKey) {
    return cachedAuthSupabaseClient;
  }

  const client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: "desktop-onboarding-auth"
    }
  });

  cachedAuthSupabaseClient = client;
  cachedAuthSupabaseClientKey = cacheKey;
  return client;
};

const App = () => {
  const runtime = window.desktopRuntime;
  const { t, i18n } = useTranslation();

  const [mode, setMode] = useState<UiMode>("loading");
  const [status, setStatus] = useState<WatcherStatus | null>(null);
  const [files, setFiles] = useState<RendererFileEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [notice, setNotice] = useState("");
  const [scanCount, setScanCount] = useState<number | null>(null);
  const [desktopConfig, setDesktopConfig] = useState<DesktopAppConfig | null>(null);
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>(0);
  const [onboardingDraft, setOnboardingDraft] = useState<OnboardingDraft>(defaultOnboardingDraft());
  const [authSession, setAuthSession] = useState<Session | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("sign_in");
  const [authForm, setAuthForm] = useState({
    name: "",
    email: "",
    password: ""
  });
  const [authNotice, setAuthNotice] = useState("");
  const [isAuthPending, setIsAuthPending] = useState(false);
  const [interviewAnswers, setInterviewAnswers] = useState(defaultInterviewAnswers());
  const [crawlStatus, setCrawlStatus] = useState<OnboardingCrawlStatus>(defaultOnboardingCrawlStatus());
  const [isCrawlPending, setIsCrawlPending] = useState(false);
  const [isInterviewSaving, setIsInterviewSaving] = useState(false);
  const [isSynthesisPending, setIsSynthesisPending] = useState(false);
  const [synthesisResult, setSynthesisResult] = useState<OnboardingSynthesisResult | null>(null);
  const [hasSynthesisAttempted, setHasSynthesisAttempted] = useState(false);
  const [entitlement, setEntitlement] = useState<EntitlementResponse | null>(null);
  const [isEntitlementPending, setIsEntitlementPending] = useState(false);

  const [chatConfig, setChatConfig] = useState<ChatConfig | null>(null);
  const [activeSession, setActiveSession] = useState<OrchestratorSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draftCampaigns, setDraftCampaigns] = useState<Campaign[]>([]);
  const [campaignWorkflowHints, setCampaignWorkflowHints] = useState<Record<string, WorkflowLinkHint>>({});
  const [pendingContents, setPendingContents] = useState<Content[]>([]);
  const [pendingContentWorkflowHints, setPendingContentWorkflowHints] = useState<Record<string, WorkflowLinkHint>>({});
  const [chatNotice, setChatNotice] = useState("");
  const [isActionPending, setIsActionPending] = useState(false);
  const refreshActiveSessionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { chatInput, setChatInput, clearChatInput, campaignToReview } = useChat(draftCampaigns);
  const campaignWorkflowHint = useMemo<WorkflowLinkHint | null>(() => {
    if (!campaignToReview) {
      return null;
    }
    return campaignWorkflowHints[campaignToReview.id] ?? null;
  }, [campaignToReview, campaignWorkflowHints]);

  const sortedFiles = useMemo(
    () =>
      [...files].sort((a, b) => {
        if (a.activityFolder !== b.activityFolder) {
          return a.activityFolder.localeCompare(b.activityFolder);
        }
        return b.detectedAt.localeCompare(a.detectedAt);
      }),
    [files]
  );

  const supabase = useMemo<SupabaseClient | null>(() => getSupabaseClientForConfig(chatConfig), [chatConfig]);
  const authSupabase = useMemo<SupabaseClient | null>(() => getAuthSupabaseClient(chatConfig), [chatConfig]);
  const crawlDone = useMemo(() => isCrawlFullyComplete(crawlStatus), [crawlStatus]);
  const reviewMarkdown = useMemo(() => {
    if (!synthesisResult?.ok) {
      return "";
    }
    const direct = typeof synthesisResult.review_markdown === "string" ? synthesisResult.review_markdown.trim() : "";
    if (direct) {
      return direct;
    }
    const nested =
      typeof synthesisResult.onboarding_result_document?.review_markdown === "string"
        ? synthesisResult.onboarding_result_document.review_markdown.trim()
        : "";
    return nested;
  }, [synthesisResult]);
  const reviewExportPath = useMemo(() => {
    if (!synthesisResult?.ok) {
      return "";
    }
    return typeof synthesisResult.review_export_path === "string" ? synthesisResult.review_export_path.trim() : "";
  }, [synthesisResult]);
  const isEntitled = entitlement?.is_entitled === true;
  const entitlementStatus = entitlement?.status ?? FALLBACK_ENTITLEMENT.status;
  const runtimeSummary = useRuntime({
    runtimePlatform: runtime?.platform ?? "-",
    watchPath: status?.watchPath,
    isRunning: status?.isRunning,
    fileCount: status?.fileCount,
    scanCount,
    activeSession,
    formatSessionStatus
  });

  const refreshActiveSession = useCallback(async (): Promise<OrchestratorSession | null> => {
    if (!runtime) {
      return null;
    }

    const response = await runtime.chat.getActiveSession();
    if (!response.ok) {
      setChatNotice(response.message ?? "Failed to load active session.");
      return null;
    }

    setActiveSession(response.session);
    return response.session;
  }, [runtime]);

  const scheduleRefreshActiveSession = useCallback(
    (delayMs = REFRESH_ACTIVE_SESSION_DEBOUNCE_MS) => {
      if (refreshActiveSessionTimerRef.current) {
        clearTimeout(refreshActiveSessionTimerRef.current);
      }

      refreshActiveSessionTimerRef.current = setTimeout(() => {
        refreshActiveSessionTimerRef.current = null;
        void refreshActiveSession();
      }, delayMs);
    },
    [refreshActiveSession]
  );

  useEffect(
    () => () => {
      if (refreshActiveSessionTimerRef.current) {
        clearTimeout(refreshActiveSessionTimerRef.current);
        refreshActiveSessionTimerRef.current = null;
      }
    },
    []
  );

  const refreshMessages = useCallback(async () => {
    if (!supabase || !chatConfig) {
      setMessages([]);
      return;
    }

    const { data, error } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("org_id", chatConfig.orgId)
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) {
      setChatNotice(`Failed to load chat messages: ${error.message}`);
      return;
    }

    setMessages(sortMessages((data ?? []) as ChatMessage[]));
  }, [chatConfig, supabase]);

  const refreshDraftCampaigns = useCallback(async () => {
    if (!supabase || !chatConfig) {
      setDraftCampaigns([]);
      setCampaignWorkflowHints({});
      return;
    }

    const { data, error } = await supabase
      .from("campaigns")
      .select("*")
      .eq("org_id", chatConfig.orgId)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) {
      setChatNotice(`Failed to load campaigns: ${error.message}`);
      return;
    }

    const campaigns = (data ?? []) as Campaign[];
    setDraftCampaigns(campaigns);

    const campaignIds = campaigns
      .map((campaign) => campaign.id)
      .filter((entry): entry is string => typeof entry === "string" && !!entry.trim());
    if (campaignIds.length === 0) {
      setCampaignWorkflowHints({});
      return;
    }

    const { data: workflowRows, error: workflowError } = await supabase
      .from("workflow_items")
      .select("id,source_campaign_id,status,version")
      .eq("org_id", chatConfig.orgId)
      .eq("type", "campaign_plan")
      .in("source_campaign_id", campaignIds);

    if (workflowError || !workflowRows) {
      setCampaignWorkflowHints({});
      return;
    }

    const nextHints: Record<string, WorkflowLinkHint> = {};
    for (const row of workflowRows as WorkflowItemLinkRow[]) {
      const sourceCampaignId =
        typeof row.source_campaign_id === "string" && row.source_campaign_id.trim()
          ? row.source_campaign_id.trim()
          : "";
      const workflowItemId = typeof row.id === "string" && row.id.trim() ? row.id.trim() : "";
      if (!sourceCampaignId || !workflowItemId || !isWorkflowStatus(row.status)) {
        continue;
      }
      nextHints[sourceCampaignId] = {
        workflowItemId,
        workflowStatus: row.status,
        version: toPositiveIntOrDefault(row.version, 1)
      };
    }

    setCampaignWorkflowHints(nextHints);
  }, [chatConfig, supabase]);

  const refreshPendingContents = useCallback(async () => {
    if (!supabase || !chatConfig) {
      setPendingContents([]);
      setPendingContentWorkflowHints({});
      return;
    }

    const { data, error } = await supabase
      .from("contents")
      .select("*")
      .eq("org_id", chatConfig.orgId)
      .eq("status", "pending_approval")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      setChatNotice(`Failed to load pending contents: ${error.message}`);
      return;
    }

    const contents = (data ?? []) as Content[];
    setPendingContents(contents);

    const contentIds = contents
      .map((content) => content.id)
      .filter((entry): entry is string => typeof entry === "string" && !!entry.trim());
    if (contentIds.length === 0) {
      setPendingContentWorkflowHints({});
      return;
    }

    const { data: workflowRows, error: workflowError } = await supabase
      .from("workflow_items")
      .select("id,source_content_id,status,version")
      .eq("org_id", chatConfig.orgId)
      .eq("type", "content_draft")
      .in("source_content_id", contentIds);

    if (workflowError || !workflowRows) {
      setPendingContentWorkflowHints({});
      return;
    }

    const nextHints: Record<string, WorkflowLinkHint> = {};
    for (const row of workflowRows as WorkflowItemLinkRow[]) {
      const sourceContentId =
        typeof row.source_content_id === "string" && row.source_content_id.trim()
          ? row.source_content_id.trim()
          : "";
      const workflowItemId = typeof row.id === "string" && row.id.trim() ? row.id.trim() : "";
      if (!sourceContentId || !workflowItemId || !isWorkflowStatus(row.status)) {
        continue;
      }
      nextHints[sourceContentId] = {
        workflowItemId,
        workflowStatus: row.status,
        version: toPositiveIntOrDefault(row.version, 1)
      };
    }

    setPendingContentWorkflowHints(nextHints);
  }, [chatConfig, supabase]);

  useEffect(() => {
    if (!runtime) {
      setChatNotice(
        "desktopRuntime bridge is unavailable. Check preload script loading and restart the desktop app."
      );
      setMode("dashboard");
      return;
    }

    let watchPathAtBootstrap = "";

    const init = async () => {
      const nextDesktopConfig = await runtime.app.getConfig();
      watchPathAtBootstrap = nextDesktopConfig.watchPath ?? "";
      setDesktopConfig(nextDesktopConfig);
      setOnboardingDraft(nextDesktopConfig.onboardingDraft ?? defaultOnboardingDraft());
      setSelectedPath(watchPathAtBootstrap);
      if (nextDesktopConfig.language) {
        void i18n.changeLanguage(nextDesktopConfig.language);
      }

      const nextStatus = await runtime.watcher.getStatus();
      setStatus(nextStatus);
      setMode(nextStatus.requiresOnboarding ? "onboarding" : "dashboard");
      if (nextStatus.requiresOnboarding) {
        setOnboardingStep(resolveOnboardingEntryStep(nextStatus.watchPath ?? watchPathAtBootstrap));
      }

      const nextFiles = await runtime.watcher.getFiles();
      setFiles(nextFiles);

      const config = await runtime.chat.getConfig();
      setChatConfig(config);
      if (!config.enabled && config.message) {
        setChatNotice(config.message);
      }

      const nextCrawlStatus = await runtime.onboarding.getCrawlState();
      setCrawlStatus(nextCrawlStatus ?? defaultOnboardingCrawlStatus());
      const lastSynthesis = await runtime.onboarding.getLastSynthesis();
      setSynthesisResult(lastSynthesis?.ok ? lastSynthesis : null);

      await refreshActiveSession();
    };

    void init();

    const offIndexed = runtime.watcher.onFileIndexed((entry) => {
      setFiles((prev) => {
        const withoutOld = prev.filter((item) => item.relativePath !== entry.relativePath);
        return [entry, ...withoutOld];
      });
      scheduleRefreshActiveSession();
    });

    const offDeleted = runtime.watcher.onFileDeleted(({ relativePath }) => {
      setFiles((prev) => prev.filter((item) => item.relativePath !== relativePath));
    });

    const offScan = runtime.watcher.onScanComplete(({ count }) => {
      setScanCount(count);
      setNotice(`Initial scan completed: ${count} file(s) indexed.`);
      scheduleRefreshActiveSession();
    });

    const offStatus = runtime.watcher.onStatusChanged((nextStatus) => {
      setStatus(nextStatus);
      setMode((prevMode) => {
        const nextMode = nextStatus.requiresOnboarding ? "onboarding" : "dashboard";
        if (nextMode === "onboarding" && prevMode !== "onboarding") {
          const watchPath = nextStatus.watchPath ?? "";
          watchPathAtBootstrap = watchPath;
          setSelectedPath(watchPath);
          setOnboardingStep(resolveOnboardingEntryStep(watchPath));
        }
        return nextMode;
      });
    });

    const offShowOnboarding = runtime.watcher.onShowOnboarding(() => {
      setMode("onboarding");
      setOnboardingStep(resolveOnboardingEntryStep(watchPathAtBootstrap));
    });

    const offActionResult = runtime.chat.onActionResult((payload) => {
      setChatNotice(`Action succeeded: ${payload.action}`);
    });

    const offActionError = runtime.chat.onActionError((payload) => {
      setChatNotice(`Action failed (${payload.action}): ${payload.message}`);
    });

    const offCrawlProgress = runtime.onboarding.onCrawlProgress((payload) => {
      if (!payload?.crawlState) {
        return;
      }
      setCrawlStatus(payload.crawlState);
    });

    const offCrawlComplete = runtime.onboarding.onCrawlComplete((payload) => {
      if (!payload?.crawlState) {
        return;
      }
      setCrawlStatus(payload.crawlState);
    });

    return () => {
      offIndexed();
      offDeleted();
      offScan();
      offStatus();
      offShowOnboarding();
      offActionResult();
      offActionError();
      offCrawlProgress();
      offCrawlComplete();
    };
  }, [i18n, refreshActiveSession, runtime, scheduleRefreshActiveSession]);

  useEffect(() => {
    if (!supabase || !chatConfig) {
      return;
    }

    void refreshMessages();
    void refreshDraftCampaigns();
    void refreshPendingContents();

    const chatChannel = supabase
      .channel(`desktop-chat-${chatConfig.orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_messages",
          filter: `org_id=eq.${chatConfig.orgId}`
        },
        (payload) => {
          const nextRow = (payload.new ?? null) as ChatMessage | null;
          const oldRow = (payload.old ?? null) as ChatMessage | null;

          setMessages((prev) => {
            if (nextRow && typeof nextRow.id === "string") {
              return upsertMessage(prev, nextRow);
            }
            if (oldRow && typeof oldRow.id === "string") {
              return prev.filter((item) => item.id !== oldRow.id);
            }
            return prev;
          });
          scheduleRefreshActiveSession();
        }
      )
      .subscribe();

    const contentsChannel = supabase
      .channel(`desktop-contents-${chatConfig.orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "contents",
          filter: `org_id=eq.${chatConfig.orgId}`
        },
        () => {
          void refreshPendingContents();
          scheduleRefreshActiveSession();
        }
      )
      .subscribe();

    const campaignsChannel = supabase
      .channel(`desktop-campaigns-${chatConfig.orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "campaigns",
          filter: `org_id=eq.${chatConfig.orgId}`
        },
        () => {
          void refreshDraftCampaigns();
          scheduleRefreshActiveSession();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(chatChannel);
      void supabase.removeChannel(contentsChannel);
      void supabase.removeChannel(campaignsChannel);
    };
  }, [
    chatConfig,
    refreshActiveSession,
    refreshDraftCampaigns,
    refreshMessages,
    refreshPendingContents,
    scheduleRefreshActiveSession,
    supabase
  ]);

  useEffect(() => {
    if (!authSupabase || !runtime) {
      setAuthSession(null);
      return;
    }

    let mounted = true;
    void (async () => {
      const stored = await runtime.auth.getStoredSession();
      if (stored?.accessToken && stored.refreshToken) {
        const { error } = await authSupabase.auth.setSession({
          access_token: stored.accessToken,
          refresh_token: stored.refreshToken
        });
        if (error) {
          await runtime.auth.clearSession();
        }
      }

      const { data } = await authSupabase.auth.getSession();
      if (!mounted) {
        return;
      }
      setAuthSession(data.session ?? null);
    })();

    const {
      data: { subscription }
    } = authSupabase.auth.onAuthStateChange((event, session) => {
      setAuthSession(session ?? null);
      if (session?.access_token && session.refresh_token) {
        const expiresAt = session.expires_at ?? parseJwtExpiration(session.access_token) ?? null;
        void runtime.auth.saveSession({
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
          expiresAt
        });
        return;
      }

      // Supabase may emit INITIAL_SESSION(null) before secure-store hydration.
      if (event === "INITIAL_SESSION") {
        return;
      }
      if (event === "SIGNED_OUT") {
        void runtime.auth.clearSession();
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [authSupabase, runtime]);

  const ensureActiveSessionId = useCallback(async (): Promise<string | null> => {
    if (activeSession?.id) {
      return activeSession.id;
    }

    const session = await refreshActiveSession();
    if (!session?.id) {
      setChatNotice("No active session yet. Wait for trigger processing, then retry.");
      return null;
    }

    return session.id;
  }, [activeSession, refreshActiveSession]);

  const persistDraftPatch = useCallback(
    async (patch: Partial<OnboardingDraft>) => {
      if (!runtime) {
        return;
      }
      const nextConfig = await runtime.onboarding.saveDraft(patch);
      setDesktopConfig(nextConfig);
      setOnboardingDraft(nextConfig.onboardingDraft);
    },
    [runtime]
  );

  const updateLanguage = useCallback(
    async (language: "ko" | "en") => {
      if (!runtime) {
        return;
      }
      const nextConfig = await runtime.app.setLanguage(language);
      setDesktopConfig(nextConfig);
      await i18n.changeLanguage(nextConfig.language);
    },
    [i18n, runtime]
  );

  const setDraftValue = useCallback(
    async (field: keyof OnboardingDraft, value: string) => {
      const next = {
        ...onboardingDraft,
        [field]: value
      };
      setOnboardingDraft(next);
      await persistDraftPatch({
        [field]: value
      });
    },
    [onboardingDraft, persistDraftPatch]
  );

  const bootstrapOrgContext = useCallback(
    async (accessToken: string): Promise<string> => {
      const body = await runtime.onboarding.bootstrapOrg({
        accessToken,
        name: authForm.name || undefined,
        orgName: authForm.name || undefined
      });
      if (!body?.ok || !body.org?.id) {
        throw new Error("Bootstrap org failed.");
      }

      const orgId = body.org.id.trim();
      if (!orgId) {
        throw new Error("Bootstrap org failed: org_id is missing.");
      }

      const nextConfig = await runtime.onboarding.setOrgId(orgId);
      setDesktopConfig(nextConfig);
      setSelectedPath(nextConfig.watchPath ?? "");

      if (body.entitlement) {
        setEntitlement({
          ok: true,
          ...body.entitlement
        });
      }

      return orgId;
    },
    [authForm.name, runtime]
  );

  const resolveOnboardingAccessToken = useCallback(async (): Promise<string> => {
    const direct = authSession?.access_token?.trim() ?? "";
    if (direct) {
      return direct;
    }
    const stored = await runtime.auth.getStoredSession();
    return stored?.accessToken?.trim() ?? "";
  }, [authSession?.access_token, runtime.auth]);

  const refreshEntitlement = useCallback(
    async (options?: {
      accessToken?: string;
      orgId?: string;
      silent?: boolean;
      useRefreshApi?: boolean;
    }): Promise<EntitlementResponse | null> => {
      if (!runtime) {
        return null;
      }

      const orgId = (options?.orgId ?? desktopConfig?.orgId ?? "").trim();
      if (!orgId) {
        if (!options?.silent) {
          setNotice("Organization context is missing.");
        }
        return null;
      }

      const accessToken = (options?.accessToken ?? "").trim() || (await resolveOnboardingAccessToken());
      if (!accessToken) {
        if (!options?.silent) {
          setNotice("Sign in session is missing. Please sign in again.");
        }
        return null;
      }

      setIsEntitlementPending(true);
      try {
        const response = options?.useRefreshApi
          ? await runtime.billing.refreshEntitlement({
              accessToken,
              orgId
            })
          : await runtime.billing.getEntitlement({
              accessToken,
              orgId
            });
        setEntitlement(response);
        return response;
      } catch (error) {
        if (!options?.silent) {
          setNotice(error instanceof Error ? error.message : "Failed to load subscription status.");
        }
        return null;
      } finally {
        setIsEntitlementPending(false);
      }
    },
    [desktopConfig?.orgId, resolveOnboardingAccessToken, runtime]
  );

  const ensureActiveEntitlement = useCallback(
    async (options?: { silent?: boolean }): Promise<boolean> => {
      if (entitlement?.is_entitled) {
        return true;
      }

      const refreshed = await refreshEntitlement({
        silent: options?.silent ?? false,
        useRefreshApi: true
      });
      if (refreshed?.is_entitled) {
        return true;
      }

      if (!options?.silent) {
        setNotice("Active subscription is required. Please complete checkout and refresh entitlement.");
      }
      return false;
    },
    [entitlement?.is_entitled, refreshEntitlement]
  );

  const startOnboardingCrawl = useCallback(
    async (forceRestart = false) => {
      if (!runtime) {
        return;
      }
      const entitled = await ensureActiveEntitlement();
      if (!entitled) {
        return;
      }
      if (!forceRestart && (crawlStatus.state === "running" || crawlStatus.started_at)) {
        return;
      }

      setIsCrawlPending(true);
      setNotice("");
      setSynthesisResult(null);
      setHasSynthesisAttempted(false);
      try {
        const nextStatus = await runtime.onboarding.startCrawl({
          urls: {
            websiteUrl: onboardingDraft.websiteUrl,
            naverBlogUrl: onboardingDraft.naverBlogUrl,
            instagramUrl: onboardingDraft.instagramUrl
          }
        });
        setCrawlStatus(nextStatus);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Failed to start brand review crawl.");
      } finally {
        setIsCrawlPending(false);
      }
    },
    [
      crawlStatus.started_at,
      crawlStatus.state,
      onboardingDraft.instagramUrl,
      onboardingDraft.naverBlogUrl,
      onboardingDraft.websiteUrl,
      ensureActiveEntitlement,
      runtime
    ]
  );

  const persistInterviewAnswers = useCallback(
    async (answers: InterviewAnswers, options?: { silent?: boolean }) => {
      if (!runtime) {
        return false;
      }
      const orgId = desktopConfig?.orgId?.trim() ?? "";
      if (!orgId) {
        if (!options?.silent) {
          setNotice("Organization context is missing.");
        }
        return false;
      }

      const accessToken = await resolveOnboardingAccessToken();
      if (!accessToken) {
        if (!options?.silent) {
          setNotice("Sign in session is missing. Please sign in again.");
        }
        return false;
      }
      const entitled = await ensureActiveEntitlement({
        silent: options?.silent ?? false
      });
      if (!entitled) {
        return false;
      }

      setIsInterviewSaving(true);
      try {
        await runtime.onboarding.saveInterview({
          accessToken,
          orgId,
          interviewAnswers: answers
        });
        if (!options?.silent) {
          setNotice("Interview answers saved.");
        }
        return true;
      } catch (error) {
        if (!options?.silent) {
          setNotice(error instanceof Error ? error.message : "Failed to save interview answers.");
        }
        return false;
      } finally {
        setIsInterviewSaving(false);
      }
    },
    [desktopConfig?.orgId, ensureActiveEntitlement, resolveOnboardingAccessToken, runtime]
  );

  const synthesizeOnboardingResult = useCallback(async () => {
    if (!runtime) {
      return;
    }
    const orgId = desktopConfig?.orgId?.trim() ?? "";
    if (!orgId) {
      setNotice("Organization context is missing.");
      return;
    }

    const accessToken = await resolveOnboardingAccessToken();
    if (!accessToken) {
      setNotice("Sign in session is missing. Please sign in again.");
      return;
    }
    const entitled = await ensureActiveEntitlement();
    if (!entitled) {
      return;
    }

    setIsSynthesisPending(true);
    setHasSynthesisAttempted(true);
    setNotice("");
    try {
      const response = await runtime.onboarding.synthesize({
        accessToken,
        orgId,
        synthesisMode: "phase_1_7b",
        interviewAnswers,
        urlMetadata: {
          website_url: onboardingDraft.websiteUrl,
          naver_blog_url: onboardingDraft.naverBlogUrl,
          instagram_url: onboardingDraft.instagramUrl,
          facebook_url: onboardingDraft.facebookUrl,
          youtube_url: onboardingDraft.youtubeUrl,
          threads_url: onboardingDraft.threadsUrl
        }
      });
      if (!response?.ok) {
        throw new Error("Result synthesis failed.");
      }

      setSynthesisResult(response);
      setNotice(
        response.review_export_path
          ? `Result document generated. Exported to: ${response.review_export_path}`
          : "Result document generated."
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Failed to generate result document.");
    } finally {
      setIsSynthesisPending(false);
    }
  }, [
    desktopConfig?.orgId,
    interviewAnswers,
    onboardingDraft.facebookUrl,
    onboardingDraft.instagramUrl,
    onboardingDraft.naverBlogUrl,
    onboardingDraft.threadsUrl,
    onboardingDraft.websiteUrl,
    onboardingDraft.youtubeUrl,
    ensureActiveEntitlement,
    resolveOnboardingAccessToken,
    runtime
  ]);

  const submitEmailAuth = async () => {
    if (!authSupabase) {
      setAuthNotice("Supabase auth config is missing.");
      return;
    }

    if (!authForm.email.trim() || !authForm.password.trim()) {
      setAuthNotice("Email and password are required.");
      return;
    }

    setIsAuthPending(true);
    setAuthNotice("");
    try {
      if (authMode === "sign_up") {
        const { error } = await authSupabase.auth.signUp({
          email: authForm.email.trim(),
          password: authForm.password,
          options: {
            data: {
              name: authForm.name.trim() || undefined
            }
          }
        });
        if (error) {
          throw error;
        }

        const { data: sessionData } = await authSupabase.auth.getSession();
        const session = sessionData.session;
        if (session) {
          const orgId = await bootstrapOrgContext(session.access_token);
          const entitlementResponse = await refreshEntitlement({
            accessToken: session.access_token,
            orgId,
            silent: true
          });
          if (!entitlementResponse) {
            throw new Error("Signup completed, but failed to load organization entitlement.");
          }
          setOnboardingStep(2);
        } else {
          setAuthNotice("Signup completed. Please verify email if confirmation is enabled, then sign in.");
        }
        return;
      }

      const { data, error } = await authSupabase.auth.signInWithPassword({
        email: authForm.email.trim(),
        password: authForm.password
      });
      if (error || !data.session) {
        throw error ?? new Error("Sign in failed.");
      }

      const orgId = await bootstrapOrgContext(data.session.access_token);
      const entitlementResponse = await refreshEntitlement({
        accessToken: data.session.access_token,
        orgId,
        silent: true
      });
      if (!entitlementResponse) {
        throw new Error("Sign-in completed, but failed to load organization entitlement.");
      }
      setOnboardingStep(2);
    } catch (error) {
      setAuthNotice(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setIsAuthPending(false);
    }
  };

  const signInWithGoogle = async () => {
    if (!authSupabase || !runtime) {
      setAuthNotice("Supabase auth config is missing.");
      return;
    }

    setIsAuthPending(true);
    setAuthNotice("Waiting for Google sign-in in your browser...");
    try {
      const secureSession = await runtime.auth.startGoogleOAuth();
      const { error } = await authSupabase.auth.setSession({
        access_token: secureSession.accessToken,
        refresh_token: secureSession.refreshToken
      });
      if (error) {
        console.warn("[Auth] Google session sync warning:", error.message);
      }

      const orgId = await bootstrapOrgContext(secureSession.accessToken);
      const entitlementResponse = await refreshEntitlement({
        accessToken: secureSession.accessToken,
        orgId,
        silent: true
      });
      if (!entitlementResponse) {
        throw new Error("Google sign-in completed, but failed to load organization entitlement.");
      }
      setOnboardingStep(2);
      setAuthNotice("Google sign-in completed.");
    } catch (error) {
      setAuthNotice(error instanceof Error ? error.message : "Google sign-in failed.");
    } finally {
      setIsAuthPending(false);
    }
  };

  const continueAfterAuth = async () => {
    setIsAuthPending(true);
    setAuthNotice("");
    try {
      let accessToken = authSession?.access_token ?? "";
      if (!accessToken && runtime) {
        const stored = await runtime.auth.getStoredSession();
        accessToken = stored?.accessToken ?? "";
      }

      if (!accessToken) {
        setAuthNotice("Sign in first.");
        return;
      }

      const orgId = await bootstrapOrgContext(accessToken);
      const entitlementResponse = await refreshEntitlement({
        accessToken,
        orgId,
        silent: true
      });
      if (!entitlementResponse) {
        throw new Error("Auth is valid, but failed to load organization entitlement.");
      }
      moveToStep(2);
      setAuthNotice("");
    } catch (error) {
      setAuthNotice(error instanceof Error ? error.message : "Organization bootstrap failed.");
    } finally {
      setIsAuthPending(false);
    }
  };

  const signOutAuth = async () => {
    if (!runtime) {
      return;
    }

    setIsAuthPending(true);
    setAuthNotice("");
    try {
      if (authSupabase) {
        await authSupabase.auth.signOut();
      }
      await runtime.auth.clearSession();
      setAuthSession(null);
      setEntitlement(null);
      setAuthNotice("Signed out.");
      setChatNotice("Signed out.");
      setMode("onboarding");
      setOnboardingStep(1);
    } catch (error) {
      setAuthNotice(error instanceof Error ? error.message : "Sign-out failed.");
      setChatNotice(error instanceof Error ? error.message : "Sign-out failed.");
    } finally {
      setIsAuthPending(false);
    }
  };

  useEffect(() => {
    if (mode !== "onboarding" || onboardingStep !== 1 || !authSession) {
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        const resolvedOrgId = await bootstrapOrgContext(authSession.access_token);
        const entitlementResponse = await refreshEntitlement({
          accessToken: authSession.access_token,
          orgId: resolvedOrgId,
          silent: true
        });
        if (!entitlementResponse) {
          throw new Error("Authenticated, but failed to load organization entitlement.");
        }
        if (!cancelled) {
          setAuthNotice("");
          setOnboardingStep(2);
        }
      } catch (error) {
        if (!cancelled) {
          setAuthNotice(error instanceof Error ? error.message : "Organization bootstrap failed.");
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [authSession, bootstrapOrgContext, mode, onboardingStep, refreshEntitlement]);

  useEffect(() => {
    if (mode !== "onboarding" || onboardingStep < 2) {
      return;
    }
    if (isEntitlementPending) {
      return;
    }
    const orgId = (desktopConfig?.orgId ?? "").trim();
    if (!orgId) {
      return;
    }
    if (entitlement?.org_id === orgId) {
      return;
    }

    void refreshEntitlement({
      orgId,
      silent: true
    });
  }, [desktopConfig?.orgId, entitlement?.org_id, isEntitlementPending, mode, onboardingStep, refreshEntitlement]);

  useEffect(() => {
    if (mode !== "onboarding") {
      return;
    }
    if (onboardingStep < 3) {
      return;
    }
    if (crawlStatus.state === "running" || crawlStatus.started_at) {
      return;
    }
    void startOnboardingCrawl(false);
  }, [crawlStatus.started_at, crawlStatus.state, mode, onboardingStep, startOnboardingCrawl]);

  useEffect(() => {
    if (mode !== "onboarding" || onboardingStep !== 5) {
      return;
    }
    if (!crawlDone || isSynthesisPending || synthesisResult || hasSynthesisAttempted) {
      return;
    }
    void synthesizeOnboardingResult();
  }, [
    crawlDone,
    hasSynthesisAttempted,
    isSynthesisPending,
    mode,
    onboardingStep,
    synthesisResult,
    synthesizeOnboardingResult
  ]);

  const moveToStep = (step: OnboardingStep) => {
    if (step >= 3 && !isEntitled) {
      setOnboardingStep(2);
      setNotice("Active subscription is required before continuing onboarding.");
      return;
    }
    setOnboardingStep(step);
    setNotice("");
  };

  const handleUrlsNext = async () => {
    const entitled = await ensureActiveEntitlement();
    if (!entitled) {
      return;
    }

    const urlFields: Array<keyof OnboardingDraft> = [
      "websiteUrl",
      "naverBlogUrl",
      "instagramUrl",
      "facebookUrl",
      "youtubeUrl",
      "threadsUrl"
    ];

    for (const key of urlFields) {
      const value = onboardingDraft[key].trim();
      if (value && !isValidHttpUrl(value)) {
        setNotice(`Invalid URL format: ${key}`);
        return;
      }
    }

    await persistDraftPatch(onboardingDraft);
    setCrawlStatus(defaultOnboardingCrawlStatus());
    setSynthesisResult(null);
    setHasSynthesisAttempted(false);
    moveToStep(3);
  };

  const handleInterviewNext = async () => {
    const entitled = await ensureActiveEntitlement();
    if (!entitled) {
      return;
    }

    if (!interviewAnswers.q1.trim() || !interviewAnswers.q2.trim() || !interviewAnswers.q3.trim() || !interviewAnswers.q4.trim()) {
      setNotice("Please answer all 4 questions.");
      return;
    }

    const saved = await persistInterviewAnswers(interviewAnswers);
    if (!saved) {
      return;
    }
    setHasSynthesisAttempted(false);
    setSynthesisResult(null);
    moveToStep(5);
  };

  const setInterviewValue = (key: keyof InterviewAnswers, value: string) => {
    setInterviewAnswers((prev) => ({
      ...prev,
      [key]: value
    }));
    setHasSynthesisAttempted(false);
    setSynthesisResult(null);
  };

  const handleInterviewBlur = async () => {
    await persistInterviewAnswers(interviewAnswers, { silent: true });
  };

  const refreshEntitlementStatus = async () => {
    const refreshed = await refreshEntitlement({
      useRefreshApi: true,
      silent: false
    });
    if (!refreshed) {
      return;
    }
    if (refreshed.is_entitled) {
      setNotice("Subscription is active. You can continue onboarding.");
      return;
    }
    setNotice(`Subscription status is "${refreshed.status}". Active access is still required.`);
  };

  const openCheckout = async () => {
    if (!runtime) {
      return;
    }
    try {
      const result = await runtime.billing.openCheckout({
        orgId: desktopConfig?.orgId
      });
      if (!result.ok) {
        setNotice(result.message ?? "Checkout URL is not configured.");
        return;
      }
      setNotice(result.url ? `Opened checkout: ${result.url}` : "Checkout opened in your browser.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Failed to open checkout.");
    }
  };

  const chooseFolder = async () => {
    const folderPath = await window.desktopRuntime.onboarding.chooseFolder();
    if (folderPath) {
      setSelectedPath(folderPath);
      setNotice("");
    }
  };

  const createFolder = async () => {
    const folderPath = await window.desktopRuntime.onboarding.createFolder();
    if (folderPath) {
      setSelectedPath(folderPath);
      setNotice("");
    }
  };

  const handleFolderNext = () => {
    if (!selectedPath) {
      setNotice("Choose or create a folder first.");
      return;
    }
    moveToStep(7);
  };

  const completeOnboarding = async () => {
    if (!selectedPath) {
      setNotice("Choose or create a folder first.");
      return;
    }

    try {
      const nextStatus = await window.desktopRuntime.onboarding.complete({
        watchPath: selectedPath,
        orgId: desktopConfig?.orgId
      });
      setStatus(nextStatus);
      const nextConfig = await window.desktopRuntime.app.getConfig();
      setDesktopConfig(nextConfig);
      setSelectedPath(nextConfig.watchPath ?? "");
      setMode("dashboard");
      const nextFiles = await window.desktopRuntime.watcher.getFiles();
      setFiles(nextFiles);
      setNotice("Watcher started successfully.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to complete onboarding.";
      setNotice(message);
    }
  };

  const openWatchFolder = async () => {
    const result = await window.desktopRuntime.watcher.openFolder();
    if (!result.ok) {
      setNotice(result.message ?? "Failed to open watch folder.");
    }
  };

  const runChatAction = async (action: () => Promise<void>) => {
    setIsActionPending(true);
    setChatNotice("");
    try {
      await action();
      await refreshMessages();
      await refreshActiveSession();
      await Promise.all([refreshDraftCampaigns(), refreshPendingContents()]);
    } catch (error) {
      const runtimeError = toRuntimeActionError(error, "Action failed.");
      if (runtimeError.code === "version_conflict") {
        setChatNotice(buildVersionConflictNotice(runtimeError));
        await Promise.all([refreshMessages(), refreshActiveSession(), refreshDraftCampaigns(), refreshPendingContents()]);
      } else {
        setChatNotice(runtimeError.message);
      }
    } finally {
      setIsActionPending(false);
    }
  };

  const sendMessage = async () => {
    const content = chatInput.trim();
    if (!content) {
      return;
    }

    const sessionId = await ensureActiveSessionId();
    if (!sessionId) {
      return;
    }

    await runChatAction(async () => {
      await window.desktopRuntime.chat.sendMessage({
        sessionId,
        content
      });
      clearChatInput();
    });
  };

  const dispatchCardAction = async (payload: Omit<ChatActionCardDispatchInput, "campaignId" | "contentId">) => {
    const sessionId = payload.sessionId.trim();
    if (!sessionId) {
      setChatNotice("sessionId is required for action card dispatch.");
      return;
    }

    const activeCampaignId = typeof activeSession?.state?.campaign_id === "string" ? activeSession.state.campaign_id.trim() : "";
    const activeContentId = typeof activeSession?.state?.content_id === "string" ? activeSession.state.content_id.trim() : "";

    const isCampaignEvent = payload.eventType.startsWith("campaign_");
    const isContentEvent = payload.eventType.startsWith("content_");
    if (isCampaignEvent && !activeCampaignId) {
      setChatNotice("Active session campaign_id is missing. Refresh session and retry.");
      return;
    }
    if (isContentEvent && !activeContentId) {
      setChatNotice("Active session content_id is missing. Refresh session and retry.");
      return;
    }

    await runChatAction(async () => {
      await window.desktopRuntime.chat.dispatchAction({
        ...payload,
        ...(isCampaignEvent ? { campaignId: activeCampaignId } : {}),
        ...(isContentEvent ? { contentId: activeContentId } : {})
      });
    });
  };

  if (!runtime) {
    return (
      <main className="app-shell">
        <section className="panel">
          <p className="eyebrow">Runtime Error</p>
          <h1>Desktop bridge not loaded</h1>
          <p className="description">
            <code>window.desktopRuntime</code> is undefined. Restart desktop dev process and verify preload loading.
          </p>
        </section>
      </main>
    );
  }

  if (mode === "loading") {
    return (
      <main className="app-shell">
        <section className="panel">
          <p className="eyebrow">Phase 1-5b</p>
          <h1>Preparing Desktop Runtime</h1>
          <p className="description">Loading watcher, chat, and approval state...</p>
        </section>
      </main>
    );
  }

  if (mode === "onboarding") {
    const activeStepLabel = t(`onboarding.steps.${onboardingStep}`);
    const crawlSourceRows = [
      {
        label: "Website",
        source: crawlStatus.sources.website
      },
      {
        label: "Naver Blog",
        source: crawlStatus.sources.naver_blog
      },
      {
        label: "Instagram",
        source: crawlStatus.sources.instagram
      }
    ];
    const instagramStatus = crawlStatus.sources.instagram.status;
    const showInstagramGuidance = instagramStatus === "partial" || instagramStatus === "failed";
    return (
      <main className="app-shell">
        <section className="panel onboarding-panel">
          <div className="onboarding-head">
            <p className="eyebrow">Phase 1-7b</p>
            <div className="button-row">
              <span className="meta">{t("onboarding.language")}</span>
              <button
                className={i18n.language === "ko" ? "primary" : ""}
                onClick={() => void updateLanguage("ko")}
              >
                KO
              </button>
              <button
                className={i18n.language === "en" ? "primary" : ""}
                onClick={() => void updateLanguage("en")}
              >
                EN
              </button>
            </div>
          </div>

          <div className="onboarding-stepper">
            {ONBOARDING_STEPS.map((step) => (
              <button
                key={step}
                className={`step-chip${step === onboardingStep ? " primary" : ""}`}
                disabled={step > onboardingStep}
                onClick={() => moveToStep(step)}
              >
                {step}. {t(`onboarding.steps.${step}`)}
              </button>
            ))}
          </div>

          <h1>{activeStepLabel}</h1>

          {onboardingStep === 0 ? (
            <>
              <p className="description" style={{ whiteSpace: "pre-line" }}>
                {t("onboarding.intro.greeting")}
                {"\n"}
                {t("onboarding.intro.intro")}
              </p>
              <p className="description">{t("onboarding.intro.promise")}</p>
              <div className="button-row">
                <button className="primary" onClick={() => moveToStep(1)}>
                  {t("onboarding.intro.cta")}
                </button>
              </div>
            </>
          ) : null}

          {onboardingStep === 1 ? (
            <>
              <p className="description">{t("onboarding.auth.description")}</p>
              <div className="button-row">
                <button
                  className={authMode === "sign_in" ? "primary" : ""}
                  disabled={isAuthPending}
                  onClick={() => setAuthMode("sign_in")}
                >
                  {t("onboarding.auth.signIn")}
                </button>
                <button
                  className={authMode === "sign_up" ? "primary" : ""}
                  disabled={isAuthPending}
                  onClick={() => setAuthMode("sign_up")}
                >
                  {t("onboarding.auth.signUp")}
                </button>
              </div>
              <div className="auth-form">
                <input
                  value={authForm.name}
                  placeholder={t("onboarding.auth.name")}
                  onChange={(event) => setAuthForm((prev) => ({ ...prev, name: event.target.value }))}
                  disabled={isAuthPending}
                />
                <input
                  value={authForm.email}
                  placeholder={t("onboarding.auth.email")}
                  onChange={(event) => setAuthForm((prev) => ({ ...prev, email: event.target.value }))}
                  disabled={isAuthPending}
                />
                <input
                  type="password"
                  value={authForm.password}
                  placeholder={t("onboarding.auth.password")}
                  onChange={(event) => setAuthForm((prev) => ({ ...prev, password: event.target.value }))}
                  disabled={isAuthPending}
                />
              </div>
              <div className="button-row">
                <button className="primary" disabled={isAuthPending} onClick={() => void submitEmailAuth()}>
                  {authMode === "sign_up" ? t("onboarding.auth.signUp") : t("onboarding.auth.signIn")}
                </button>
                <button disabled={isAuthPending} onClick={() => void signInWithGoogle()}>
                  {t("onboarding.auth.google")}
                </button>
                <button
                  disabled={isAuthPending || !authSession}
                  className="primary"
                  onClick={() => void continueAfterAuth()}
                >
                  {t("onboarding.auth.continue")}
                </button>
                {authSession ? (
                  <button disabled={isAuthPending} onClick={() => void signOutAuth()}>
                    Sign out
                  </button>
                ) : null}
              </div>
              {authSession?.user?.email ? (
                <p className="meta">
                  Authenticated as <strong>{authSession.user.email}</strong>
                </p>
              ) : null}
              {authNotice ? <p className="notice">{authNotice}</p> : null}
            </>
          ) : null}

          {onboardingStep === 2 ? (
            <>
              {!isEntitled ? (
                <>
                  <p className="description">
                    Active subscription is required before brand URL setup and synthesis.
                  </p>
                  <div className="meta-grid">
                    <p>
                      Subscription status: <strong>{entitlementStatus}</strong>
                    </p>
                    <p>
                      Trial ends: <strong>{formatDateTime(entitlement?.trial_ends_at)}</strong>
                    </p>
                    <p>
                      Period end: <strong>{formatDateTime(entitlement?.current_period_end)}</strong>
                    </p>
                    <p>
                      Org: <strong>{entitlement?.org_id || desktopConfig?.orgId || "-"}</strong>
                    </p>
                  </div>
                  {isEntitlementPending ? <p className="meta">Refreshing subscription status...</p> : null}
                  <div className="button-row">
                    <button onClick={() => moveToStep(1)}>{t("onboarding.back")}</button>
                    <button onClick={() => void openCheckout()}>Open Checkout</button>
                    <button className="primary" disabled={isEntitlementPending} onClick={() => void refreshEntitlementStatus()}>
                      Refresh Subscription
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="description">{t("onboarding.urls.description")}</p>
                  <div className="auth-form">
                    <input
                      value={onboardingDraft.websiteUrl}
                      placeholder={t("onboarding.urls.website")}
                      onChange={(event) => void setDraftValue("websiteUrl", event.target.value)}
                    />
                    <input
                      value={onboardingDraft.naverBlogUrl}
                      placeholder={t("onboarding.urls.naverBlog")}
                      onChange={(event) => void setDraftValue("naverBlogUrl", event.target.value)}
                    />
                    <input
                      value={onboardingDraft.instagramUrl}
                      placeholder={t("onboarding.urls.instagram")}
                      onChange={(event) => void setDraftValue("instagramUrl", event.target.value)}
                    />
                    <input
                      value={onboardingDraft.facebookUrl}
                      placeholder={t("onboarding.urls.facebook")}
                      onChange={(event) => void setDraftValue("facebookUrl", event.target.value)}
                    />
                    <input
                      value={onboardingDraft.youtubeUrl}
                      placeholder={t("onboarding.urls.youtube")}
                      onChange={(event) => void setDraftValue("youtubeUrl", event.target.value)}
                    />
                    <input
                      value={onboardingDraft.threadsUrl}
                      placeholder={t("onboarding.urls.threads")}
                      onChange={(event) => void setDraftValue("threadsUrl", event.target.value)}
                    />
                  </div>
                  <div className="button-row">
                    <button onClick={() => moveToStep(1)}>{t("onboarding.back")}</button>
                    <button className="primary" onClick={() => void handleUrlsNext()}>
                      {t("onboarding.urls.next")}
                    </button>
                  </div>
                </>
              )}
            </>
          ) : null}

          {onboardingStep === 3 ? (
            <>
              <p className="description">{t("onboarding.review.description")}</p>
              <div className="meta-grid onboarding-crawl-grid">
                <p>
                  Website: <strong>{onboardingDraft.websiteUrl || "-"}</strong>
                </p>
                <p>
                  Naver Blog: <strong>{onboardingDraft.naverBlogUrl || "-"}</strong>
                </p>
                <p>
                  Instagram: <strong>{onboardingDraft.instagramUrl || "-"}</strong>
                </p>
                <p>
                  YouTube: <strong>{onboardingDraft.youtubeUrl || "-"}</strong>
                </p>
              </div>
              <div className="crawl-status-list">
                {crawlSourceRows.map((row) => (
                  <article key={row.label} className="crawl-status-item">
                    <p>
                      <strong>{row.label}</strong>
                    </p>
                    <p>
                      Status: <strong>{formatCrawlStatusLabel(row.source.status)}</strong>
                    </p>
                    <p>
                      URL: <strong>{row.source.url || "-"}</strong>
                    </p>
                    {row.source.error ? <p className="notice">{row.source.error}</p> : null}
                  </article>
                ))}
              </div>
              {crawlDone ? (
                <p className="meta">Brand review crawl completed (with best-effort partial failures allowed).</p>
              ) : (
                <p className="meta">Crawl is running in the background. You can continue to interview now.</p>
              )}
              <div className="button-row">
                <button onClick={() => moveToStep(2)}>{t("onboarding.back")}</button>
                <button disabled={isCrawlPending || crawlStatus.state === "running"} onClick={() => void startOnboardingCrawl(true)}>
                  Retry Crawl
                </button>
                <button className="primary" onClick={() => moveToStep(4)}>
                  {t("onboarding.review.next")}
                </button>
              </div>
            </>
          ) : null}

          {onboardingStep === 4 ? (
            <>
              <p className="description">{t("onboarding.interview.description")}</p>
              {!crawlDone ? <p className="meta">Brand review crawl is still running. Keep answering interview questions.</p> : null}
              <div className="auth-form">
                <textarea
                  value={interviewAnswers.q1}
                  placeholder={t("onboarding.interview.q1")}
                  onChange={(event) => setInterviewValue("q1", event.target.value)}
                  onBlur={() => void handleInterviewBlur()}
                />
                <textarea
                  value={interviewAnswers.q2}
                  placeholder={t("onboarding.interview.q2")}
                  onChange={(event) => setInterviewValue("q2", event.target.value)}
                  onBlur={() => void handleInterviewBlur()}
                />
                <textarea
                  value={interviewAnswers.q3}
                  placeholder={t("onboarding.interview.q3")}
                  onChange={(event) => setInterviewValue("q3", event.target.value)}
                  onBlur={() => void handleInterviewBlur()}
                />
                <textarea
                  value={interviewAnswers.q4}
                  placeholder={t("onboarding.interview.q4")}
                  onChange={(event) => setInterviewValue("q4", event.target.value)}
                  onBlur={() => void handleInterviewBlur()}
                />
              </div>
              {isInterviewSaving ? <p className="meta">Saving interview answers...</p> : null}
              <div className="button-row">
                <button onClick={() => moveToStep(3)}>{t("onboarding.back")}</button>
                <button className="primary" disabled={isInterviewSaving} onClick={() => void handleInterviewNext()}>
                  {t("onboarding.interview.next")}
                </button>
              </div>
            </>
          ) : null}

          {onboardingStep === 5 ? (
            <>
              <p className="description">{t("onboarding.result.description")}</p>
              {!crawlDone ? <p className="meta">Waiting for background crawl to finish before synthesis.</p> : null}
              {isSynthesisPending ? <p className="meta">Generating result document...</p> : null}
              {synthesisResult?.ok ? (
                <>
                  <div className="source-coverage-row">
                    {crawlSourceRows.map((row) => (
                      <span key={`coverage-${row.label}`} className={`source-coverage-badge status-${row.source.status}`}>
                        {row.label}: {formatCrawlStatusLabel(row.source.status)}
                      </span>
                    ))}
                  </div>
                  {showInstagramGuidance ? (
                    <p className="meta">
                      {instagramStatus === "partial"
                        ? "Instagram crawl collected only partial public metadata. The review includes explicit data limitation notes."
                        : "Instagram crawl could not collect profile metadata. The review uses website/blog/interview evidence and records this limitation."}
                    </p>
                  ) : null}
                  <div className="meta-grid">
                    <p>
                      Tone: <strong>{synthesisResult.brand_profile.detected_tone || "-"}</strong>
                    </p>
                    <p>
                      Themes: <strong>{synthesisResult.brand_profile.key_themes.join(", ") || "-"}</strong>
                    </p>
                    <p>
                      Audience: <strong>{synthesisResult.brand_profile.target_audience.join(", ") || "-"}</strong>
                    </p>
                    <p>
                      Campaign Seasons: <strong>{synthesisResult.brand_profile.campaign_seasons.join(", ") || "-"}</strong>
                    </p>
                  </div>
                  {reviewExportPath ? (
                    <p className="meta">
                      Exported Markdown: <strong>{reviewExportPath}</strong>
                    </p>
                  ) : null}
                  {reviewMarkdown ? (
                    <article className="markdown-card">
                      <div className="markdown-viewer">
                        <ReactMarkdown>{reviewMarkdown}</ReactMarkdown>
                      </div>
                    </article>
                  ) : (
                    <p className="meta">Markdown content is not available. Showing structured profile only.</p>
                  )}
                </>
              ) : (
                <p className="empty">Result generation is automatic at this step.</p>
              )}
              <div className="button-row">
                <button onClick={() => moveToStep(4)}>{t("onboarding.back")}</button>
                <button className="primary" disabled={!synthesisResult || isSynthesisPending} onClick={() => moveToStep(6)}>
                  {t("onboarding.result.next")}
                </button>
              </div>
            </>
          ) : null}

          {onboardingStep === 6 ? (
            <>
              <p className="description">{t("onboarding.folder.description")}</p>
              <div className="button-row">
                <button onClick={() => void chooseFolder()}>{t("onboarding.folder.choose")}</button>
                <button onClick={() => void createFolder()}>{t("onboarding.folder.create")}</button>
              </div>
              <p className="meta">
                {t("onboarding.folder.selected")}: <strong>{selectedPath || "-"}</strong>
              </p>
              <div className="button-row">
                <button onClick={() => moveToStep(5)}>{t("onboarding.back")}</button>
                <button className="primary" onClick={() => handleFolderNext()}>
                  {t("onboarding.folder.next")}
                </button>
              </div>
            </>
          ) : null}

          {onboardingStep === 7 ? (
            <>
              <p className="description">{t("onboarding.summary.description")}</p>
              <div className="meta-grid">
                <p>
                  Org: <strong>{desktopConfig?.orgId ?? "-"}</strong>
                </p>
                <p>
                  Watch Folder: <strong>{selectedPath || "-"}</strong>
                </p>
                <p>
                  Detected Tone: <strong>{synthesisResult?.brand_profile.detected_tone || "-"}</strong>
                </p>
                <p>
                  Key Themes: <strong>{synthesisResult?.brand_profile.key_themes.join(", ") || "-"}</strong>
                </p>
              </div>
              <div className="button-row">
                <button onClick={() => moveToStep(6)}>{t("onboarding.back")}</button>
                <button className="primary" onClick={() => void completeOnboarding()}>
                  {t("onboarding.summary.cta")}
                </button>
              </div>
            </>
          ) : null}

          {notice ? <p className="notice">{notice}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <NavigationProvider>
      <MainLayout
        dashboardPage={
          <DashboardPage
            runtimeSummary={runtimeSummary}
            notice={notice}
            sortedFiles={sortedFiles}
            pendingContents={pendingContents}
            pendingContentWorkflowHints={pendingContentWorkflowHints}
            campaignToReview={campaignToReview}
            campaignWorkflowHint={campaignWorkflowHint}
            isActionPending={isActionPending}
            isAuthPending={isAuthPending}
            formatDateTime={formatDateTime}
            onOpenWatchFolder={() => void openWatchFolder()}
            onRefreshActiveSession={() => void refreshActiveSession()}
            onSignOut={() => void signOutAuth()}
          />
        }
        agentChatPage={
          <AgentChatPage
            messages={messages}
            chatInput={chatInput}
            chatNotice={chatNotice}
            chatConfigMessage={chatConfig?.message ?? ""}
            activeSessionId={activeSession?.id ?? null}
            isActionPending={isActionPending}
            formatDateTime={formatDateTime}
            onChatInputChange={setChatInput}
            onSendMessage={() => void sendMessage()}
            onDispatchCardAction={(payload) => void dispatchCardAction(payload)}
          />
        }
        settingsPage={
          <SettingsPage
            orgId={desktopConfig?.orgId ?? "-"}
            watchPath={selectedPath || status?.watchPath || "-"}
            language={i18n.language}
            userEmail={authSession?.user?.email ?? "-"}
            runtimeSummary={runtimeSummary}
            isActionPending={isActionPending}
            isAuthPending={isAuthPending}
            onOpenWatchFolder={() => void openWatchFolder()}
            onSignOut={() => void signOutAuth()}
            onChangeLanguage={(language) => void updateLanguage(language)}
          />
        }
      />
    </NavigationProvider>
  );
};

export default App;

