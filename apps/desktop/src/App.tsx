import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavigationProvider } from "./context/NavigationContext";
import { useChat } from "./hooks/useChat";
import { OnboardingLayout, resolveOnboardingEntryStep, type OnboardingStep } from "./layouts/OnboardingLayout";
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
  OrchestratorSession,
  WorkflowStatus
} from "@repo/types";

type UiMode = "loading" | "onboarding" | "dashboard";
type Runtime = Window["desktopRuntime"];
type WatcherStatus = Awaited<ReturnType<Runtime["watcher"]["getStatus"]>>;
type RendererFileEntry = Awaited<ReturnType<Runtime["watcher"]["getFiles"]>>[number];
type ChatConfig = Awaited<ReturnType<Runtime["chat"]["getConfig"]>>;
type DesktopAppConfig = Awaited<ReturnType<Runtime["app"]["getConfig"]>>;
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
  const { i18n } = useTranslation();

  const [mode, setMode] = useState<UiMode>("loading");
  const [status, setStatus] = useState<WatcherStatus | null>(null);
  const [files, setFiles] = useState<RendererFileEntry[]>([]);
  const [onboardingEntryStep, setOnboardingEntryStep] = useState<OnboardingStep>(0);
  const [onboardingEntryVersion, setOnboardingEntryVersion] = useState(0);
  const [selectedPath, setSelectedPath] = useState("");
  const [notice, setNotice] = useState("");
  const [scanCount, setScanCount] = useState<number | null>(null);
  const [desktopConfig, setDesktopConfig] = useState<DesktopAppConfig | null>(null);
  const [authSession, setAuthSession] = useState<Session | null>(null);
  const [isAuthPending, setIsAuthPending] = useState(false);

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
  const runtimeSummary = useRuntime({
    runtimePlatform: runtime?.platform ?? "-",
    watchPath: status?.watchPath,
    isRunning: status?.isRunning,
    fileCount: status?.fileCount,
    scanCount,
    activeSession,
    formatSessionStatus
  });
  const enterOnboarding = useCallback((watchPath: string | null | undefined, explicitStep?: OnboardingStep) => {
    setOnboardingEntryStep(explicitStep ?? resolveOnboardingEntryStep(watchPath));
    setOnboardingEntryVersion((previous) => previous + 1);
    setMode("onboarding");
  }, []);

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
      setSelectedPath(watchPathAtBootstrap);
      if (nextDesktopConfig.language) {
        void i18n.changeLanguage(nextDesktopConfig.language);
      }

      const nextStatus = await runtime.watcher.getStatus();
      setStatus(nextStatus);
      if (nextStatus.requiresOnboarding) {
        enterOnboarding(nextStatus.watchPath ?? watchPathAtBootstrap);
      } else {
        setMode("dashboard");
      }

      const nextFiles = await runtime.watcher.getFiles();
      setFiles(nextFiles);

      const config = await runtime.chat.getConfig();
      setChatConfig(config);
      if (!config.enabled && config.message) {
        setChatNotice(config.message);
      }

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
          setOnboardingEntryStep(resolveOnboardingEntryStep(watchPath));
          setOnboardingEntryVersion((previous) => previous + 1);
        }
        return nextMode;
      });
    });

    const offShowOnboarding = runtime.watcher.onShowOnboarding(() => {
      enterOnboarding(watchPathAtBootstrap);
    });

    const offActionResult = runtime.chat.onActionResult((payload) => {
      setChatNotice(`Action succeeded: ${payload.action}`);
    });

    const offActionError = runtime.chat.onActionError((payload) => {
      setChatNotice(`Action failed (${payload.action}): ${payload.message}`);
    });

    return () => {
      offIndexed();
      offDeleted();
      offScan();
      offStatus();
      offShowOnboarding();
      offActionResult();
      offActionError();
    };
  }, [enterOnboarding, i18n, refreshActiveSession, runtime, scheduleRefreshActiveSession]);

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

  const signOutAuth = async () => {
    if (!runtime) {
      return;
    }

    setIsAuthPending(true);
    try {
      if (authSupabase) {
        await authSupabase.auth.signOut();
      }
      await runtime.auth.clearSession();
      setAuthSession(null);
      setChatNotice("Signed out.");
      enterOnboarding(status?.watchPath ?? selectedPath, 1);
    } catch (error) {
      setChatNotice(error instanceof Error ? error.message : "Sign-out failed.");
    } finally {
      setIsAuthPending(false);
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
    return (
      <OnboardingLayout
        runtime={runtime}
        authSupabase={authSupabase}
        authSession={authSession}
        desktopConfig={desktopConfig}
        selectedPath={selectedPath}
        entryStep={onboardingEntryStep}
        entryVersion={onboardingEntryVersion}
        language={i18n.language}
        formatDateTime={formatDateTime}
        onLanguageChange={updateLanguage}
        onDesktopConfigChange={setDesktopConfig}
        onSelectedPathChange={setSelectedPath}
        onSignOut={signOutAuth}
        onComplete={({ status: nextStatus, config: nextConfig, files: nextFiles, notice: nextNotice }) => {
          setStatus(nextStatus);
          setDesktopConfig(nextConfig);
          setSelectedPath(nextConfig.watchPath ?? "");
          setFiles(nextFiles);
          setNotice(nextNotice);
          setMode("dashboard");
        }}
      />
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

