import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChatProvider } from "./context/ChatContext";
import { NavigationProvider } from "./context/NavigationContext";
import { SessionSelectorProvider } from "./context/SessionSelectorContext";
import { OnboardingLayout, resolveOnboardingEntryStep, type OnboardingStep } from "./layouts/OnboardingLayout";
import { useRuntime } from "./hooks/useRuntime";
import { MainLayout } from "./layouts/MainLayout";
import { AnalyticsPage } from "./pages/Analytics";
import { BrandReviewPage } from "./pages/BrandReview";
import { CampaignPlanPage } from "./pages/CampaignPlan";
import { DashboardPage } from "./pages/Dashboard";
import { EmailAutomationPage } from "./pages/EmailAutomation";
import { SettingsPage } from "./pages/Settings";
import { SchedulerPage } from "./pages/Scheduler";
import type { OrchestratorSession } from "@repo/types";

type UiMode = "loading" | "onboarding" | "dashboard";
type Runtime = Window["desktopRuntime"];
type WatcherStatus = Awaited<ReturnType<Runtime["watcher"]["getStatus"]>>;
type RendererFileEntry = Awaited<ReturnType<Runtime["watcher"]["getFiles"]>>[number];
type ChatConfig = Awaited<ReturnType<Runtime["chat"]["getConfig"]>>;
type DesktopAppConfig = Awaited<ReturnType<Runtime["app"]["getConfig"]>>;
const REFRESH_ACTIVE_SESSION_DEBOUNCE_MS = 250;

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

let cachedSupabaseClient: SupabaseClient | null = null;
let cachedSupabaseClientKey = "";
let cachedAuthSupabaseClient: SupabaseClient | null = null;
let cachedAuthSupabaseClientKey = "";

const getSupabaseClientForConfig = (config: ChatConfig | null): SupabaseClient | null => {
  if (!config?.enabled || !config.supabaseUrl || !config.supabaseAnonKey) {
    return null;
  }

  const cacheKey = [config.supabaseUrl, config.supabaseAnonKey, config.supabaseAccessToken].join("|");

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
  const refreshActiveSessionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    scanCount
  });
  const enterOnboarding = useCallback((watchPath: string | null | undefined, explicitStep?: OnboardingStep) => {
    setOnboardingEntryStep(explicitStep ?? resolveOnboardingEntryStep(watchPath));
    setOnboardingEntryVersion((previous) => previous + 1);
    setMode("onboarding");
  }, []);

  const refreshChatConfig = useCallback(async (): Promise<ChatConfig | null> => {
    if (!runtime) {
      return null;
    }

    try {
      const config = await runtime.chat.getConfig();
      setChatConfig(config);
      if (config.message) {
        setNotice(config.message);
      }
      return config;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Failed to refresh chat config.");
      return null;
    }
  }, [runtime]);

  const refreshActiveSession = useCallback(async (): Promise<OrchestratorSession | null> => {
    if (!runtime) {
      return null;
    }

    const response = await runtime.chat.getActiveSession();
    if (!response.ok) {
      setNotice(response.message ?? "Failed to load active session.");
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

  useEffect(() => {
    if (!runtime) {
      setNotice(
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

      await refreshChatConfig();

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

    return () => {
      offIndexed();
      offDeleted();
      offScan();
      offStatus();
      offShowOnboarding();
    };
  }, [enterOnboarding, i18n, refreshActiveSession, refreshChatConfig, runtime, scheduleRefreshActiveSession]);

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

      await refreshChatConfig();

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
        void (async () => {
          await runtime.auth.saveSession({
            accessToken: session.access_token,
            refreshToken: session.refresh_token,
            expiresAt
          });
          await refreshChatConfig();
        })();
        return;
      }

      // Supabase may emit INITIAL_SESSION(null) before secure-store hydration.
      if (event === "INITIAL_SESSION") {
        return;
      }
      if (event === "SIGNED_OUT") {
        void (async () => {
          await runtime.auth.clearSession();
          await refreshChatConfig();
        })();
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [authSupabase, refreshChatConfig, runtime]);

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
      setNotice("Signed out.");
      enterOnboarding(status?.watchPath ?? selectedPath, 1);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Sign-out failed.");
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
      <SessionSelectorProvider runtime={runtime} chatConfig={chatConfig} activeSession={activeSession}>
        <ChatProvider
          runtime={runtime}
          supabase={supabase}
          chatConfig={chatConfig}
          activeSession={activeSession}
          refreshActiveSession={refreshActiveSession}
        >
          <MainLayout
            schedulerPage={<SchedulerPage />}
            dashboardPage={
              <DashboardPage
                runtimeSummary={runtimeSummary}
                notice={notice}
                sortedFiles={sortedFiles}
                isAuthPending={isAuthPending}
                formatDateTime={formatDateTime}
                onOpenWatchFolder={() => void openWatchFolder()}
                onRefreshActiveSession={() => void refreshActiveSession()}
                onSignOut={() => void signOutAuth()}
              />
            }
            campaignPlanPage={
              <CampaignPlanPage
                supabase={supabase}
                orgId={chatConfig?.orgId ?? desktopConfig?.orgId ?? null}
                dataAccessMessage={chatConfig?.message ?? ""}
                formatDateTime={formatDateTime}
              />
            }
            brandReviewPage={
              <BrandReviewPage
                supabase={supabase}
                orgId={chatConfig?.orgId ?? desktopConfig?.orgId ?? null}
                dataAccessMessage={chatConfig?.message ?? ""}
                formatDateTime={formatDateTime}
              />
            }
            analyticsPage={<AnalyticsPage />}
            emailAutomationPage={<EmailAutomationPage />}
            settingsPage={
              <SettingsPage
                orgId={desktopConfig?.orgId ?? "-"}
                watchPath={selectedPath || status?.watchPath || "-"}
                language={i18n.language}
                userEmail={authSession?.user?.email ?? "-"}
                runtimeSummary={runtimeSummary}
                isAuthPending={isAuthPending}
                onOpenWatchFolder={() => void openWatchFolder()}
                onSignOut={() => void signOutAuth()}
                onChangeLanguage={(language) => void updateLanguage(language)}
              />
            }
          />
        </ChatProvider>
      </SessionSelectorProvider>
    </NavigationProvider>
  );
};

export default App;

