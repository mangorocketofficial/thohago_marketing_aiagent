import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren
} from "react";
import type { OrchestratorSession } from "@repo/types";
import type { PageId } from "../types/navigation";
import { useNavigation } from "./NavigationContext";

const RECENT_LIMIT = 5;
const REVIEW_ALL_LIMIT = 20;
const FOLDER_UPDATE_LIMIT = 20;
const RECOMMENDATION_DEBOUNCE_MS = 400;
const SELECTED_SESSION_STORAGE_KEY = "ddohago:selectedSessionIdByOrg";

type ChatConfig = Awaited<ReturnType<Window["desktopRuntime"]["chat"]["getConfig"]>>;

type SessionSelectorProviderProps = PropsWithChildren<{
  runtime: Window["desktopRuntime"];
  chatConfig: ChatConfig | null;
  activeSession: OrchestratorSession | null;
}>;

type WorkspaceContext = {
  pageId: PageId;
  workspaceType: string;
  scopeId: string;
  workspaceKey: string;
  label: string;
};

type PendingFolderUpdate = {
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

type SessionSelectorContextValue = {
  selectedSessionId: string | null;
  selectedSession: OrchestratorSession | null;
  recentSessions: OrchestratorSession[];
  recommendedSession: OrchestratorSession | null;
  isSessionLoading: boolean;
  isSessionMutating: boolean;
  sessionNotice: string;
  workspaceContext: WorkspaceContext;
  reviewAllSessions: OrchestratorSession[];
  reviewAllNextCursor: string | null;
  isReviewAllLoading: boolean;
  pendingFolderUpdates: PendingFolderUpdate[];
  isFolderUpdatesLoading: boolean;
  refreshRecentSessions: () => Promise<void>;
  refreshPendingFolderUpdates: () => Promise<void>;
  acknowledgeFolderUpdates: (activityFolder: string) => Promise<void>;
  refreshRecommendedSession: () => Promise<void>;
  createSessionForCurrentWorkspace: () => Promise<void>;
  selectSession: (session: OrchestratorSession) => void;
  dismissRecommendation: () => void;
  clearSessionNotice: () => void;
  loadReviewAllSessions: () => Promise<void>;
  loadMoreReviewAllSessions: () => Promise<void>;
  invalidateSelectedSession: (notice?: string) => Promise<void>;
};

const SessionSelectorContext = createContext<SessionSelectorContextValue | null>(null);

const toRuntimeMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

const normalizeWorkspaceType = (value: unknown): string => {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || "general";
};

const normalizeScopeId = (value: unknown): string => {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || "default";
};

const buildWorkspaceKey = (workspaceType: string, scopeId: string): string => `${workspaceType}:${scopeId}`;

const toWorkspaceLabel = (workspaceType: string, scopeId: string): string => {
  if (workspaceType === "general") {
    return scopeId === "default" ? "General" : `General (${scopeId})`;
  }
  if (workspaceType === "campaign_plan") {
    return scopeId === "default" ? "Campaign Plan" : `Campaign Plan (${scopeId})`;
  }
  if (workspaceType === "content_create") {
    return scopeId === "default" ? "Content Create" : `Content Create (${scopeId})`;
  }
  return scopeId === "default" ? workspaceType : `${workspaceType} (${scopeId})`;
};

const readPersistedSelectedSessionByOrg = (): Record<string, string> => {
  try {
    const raw = window.localStorage.getItem(SELECTED_SESSION_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const orgId = key.trim();
      const sessionId = typeof value === "string" ? value.trim() : "";
      if (!orgId || !sessionId) {
        continue;
      }
      result[orgId] = sessionId;
    }
    return result;
  } catch {
    return {};
  }
};

const writePersistedSelectedSessionByOrg = (input: Record<string, string>): void => {
  try {
    window.localStorage.setItem(SELECTED_SESSION_STORAGE_KEY, JSON.stringify(input));
  } catch {
    // Ignore storage write failures to keep selector usable in-memory.
  }
};

const upsertSession = (sessions: OrchestratorSession[], next: OrchestratorSession, limit: number): OrchestratorSession[] => {
  const merged = [next, ...sessions.filter((entry) => entry.id !== next.id)];
  return merged.slice(0, Math.max(1, limit));
};

const mergeUniqueSessions = (base: OrchestratorSession[], appended: OrchestratorSession[]): OrchestratorSession[] => {
  const map = new Map<string, OrchestratorSession>();
  for (const session of base) {
    map.set(session.id, session);
  }
  for (const session of appended) {
    map.set(session.id, session);
  }
  return Array.from(map.values());
};

const resolveWorkspaceContext = (pageId: PageId, selectedSession: OrchestratorSession | null): WorkspaceContext => {
  if (
    pageId === "dashboard" ||
    pageId === "brand-review" ||
    pageId === "analytics" ||
    pageId === "email-automation" ||
    pageId === "settings"
  ) {
    const workspaceType = "general";
    const scopeId = "default";
    return {
      pageId,
      workspaceType,
      scopeId,
      workspaceKey: buildWorkspaceKey(workspaceType, scopeId),
      label: toWorkspaceLabel(workspaceType, scopeId)
    };
  }

  if (pageId === "workspace") {
    const workspaceType = normalizeWorkspaceType(selectedSession?.workspace_type);
    const scopeId = normalizeScopeId(selectedSession?.scope_id);
    return {
      pageId,
      workspaceType,
      scopeId,
      workspaceKey: buildWorkspaceKey(workspaceType, scopeId),
      label: toWorkspaceLabel(workspaceType, scopeId)
    };
  }

  const workspaceType = "general";
  const scopeId = "default";
  return {
    pageId,
    workspaceType,
    scopeId,
    workspaceKey: buildWorkspaceKey(workspaceType, scopeId),
    label: toWorkspaceLabel(workspaceType, scopeId)
  };
};

export const SessionSelectorProvider = ({ children, runtime, chatConfig, activeSession }: SessionSelectorProviderProps) => {
  const { activePage } = useNavigation();
  const orgId = chatConfig?.orgId ?? "";

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<OrchestratorSession | null>(null);
  const [recentSessions, setRecentSessions] = useState<OrchestratorSession[]>([]);
  const [recommendedSession, setRecommendedSession] = useState<OrchestratorSession | null>(null);
  const [isSessionLoading, setIsSessionLoading] = useState(false);
  const [isSessionMutating, setIsSessionMutating] = useState(false);
  const [sessionNotice, setSessionNotice] = useState("");
  const [reviewAllSessions, setReviewAllSessions] = useState<OrchestratorSession[]>([]);
  const [reviewAllNextCursor, setReviewAllNextCursor] = useState<string | null>(null);
  const [isReviewAllLoading, setIsReviewAllLoading] = useState(false);
  const [pendingFolderUpdates, setPendingFolderUpdates] = useState<PendingFolderUpdate[]>([]);
  const [isFolderUpdatesLoading, setIsFolderUpdatesLoading] = useState(false);
  const [recommendationKey, setRecommendationKey] = useState("");

  const latestRecentRequestIdRef = useRef(0);
  const latestBootstrapRequestIdRef = useRef(0);
  const latestCreateRequestIdRef = useRef(0);
  const latestRecommendRequestIdRef = useRef(0);
  const latestReviewRequestIdRef = useRef(0);
  const latestFolderUpdateRequestIdRef = useRef(0);
  const recommendationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressedRecommendationKeyRef = useRef("");
  const activePageRef = useRef<PageId>(activePage);
  const activeSessionRef = useRef<OrchestratorSession | null>(activeSession);

  const workspaceContext = useMemo(
    () => resolveWorkspaceContext(activePage, selectedSession),
    [
      activePage,
      selectedSession?.id,
      selectedSession?.workspace_type,
      selectedSession?.scope_id,
      selectedSession?.state?.campaign_id,
      selectedSession?.state?.content_id
    ]
  );

  useEffect(() => {
    activePageRef.current = activePage;
  }, [activePage]);

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  const persistSelection = useCallback(
    (nextSessionId: string | null) => {
      if (!orgId) {
        return;
      }
      const persisted = readPersistedSelectedSessionByOrg();
      if (nextSessionId) {
        persisted[orgId] = nextSessionId;
      } else {
        delete persisted[orgId];
      }
      writePersistedSelectedSessionByOrg(persisted);
    },
    [orgId]
  );

  const commitSelectedSession = useCallback(
    (session: OrchestratorSession | null) => {
      const normalizedId = session?.id?.trim() ? session.id.trim() : null;
      setSelectedSessionId(normalizedId);
      setSelectedSession(session);
      persistSelection(normalizedId);
      if (!normalizedId) {
        setRecommendedSession(null);
        setRecommendationKey("");
      }
    },
    [persistSelection]
  );

  const fetchRecentSessions = useCallback(async (): Promise<OrchestratorSession[]> => {
    const response = await runtime.chat.listSessions({
      limit: RECENT_LIMIT,
      archived: false
    });
    if (!response.ok) {
      throw new Error(response.message ?? "Failed to load recent sessions.");
    }
    return (response.sessions ?? []).slice(0, RECENT_LIMIT);
  }, [runtime]);

  const refreshRecentSessions = useCallback(async () => {
    const requestId = latestRecentRequestIdRef.current + 1;
    latestRecentRequestIdRef.current = requestId;
    setIsSessionLoading(true);
    try {
      const sessions = await fetchRecentSessions();
      if (requestId !== latestRecentRequestIdRef.current) {
        return;
      }
      setRecentSessions(sessions);
    } catch (error) {
      if (requestId !== latestRecentRequestIdRef.current) {
        return;
      }
      setSessionNotice(toRuntimeMessage(error, "Failed to refresh recent sessions."));
    } finally {
      if (requestId === latestRecentRequestIdRef.current) {
        setIsSessionLoading(false);
      }
    }
  }, [fetchRecentSessions]);

  const fetchPendingFolderUpdates = useCallback(async (): Promise<PendingFolderUpdate[]> => {
    const response = await runtime.chat.listFolderUpdates({
      limit: FOLDER_UPDATE_LIMIT
    });
    if (!response.ok) {
      throw new Error(response.message ?? "Failed to load folder updates.");
    }
    return response.folder_updates ?? [];
  }, [runtime]);

  const refreshPendingFolderUpdates = useCallback(async () => {
    if (!chatConfig?.enabled || !orgId) {
      setPendingFolderUpdates([]);
      setIsFolderUpdatesLoading(false);
      return;
    }

    const requestId = latestFolderUpdateRequestIdRef.current + 1;
    latestFolderUpdateRequestIdRef.current = requestId;
    setIsFolderUpdatesLoading(true);
    try {
      const updates = await fetchPendingFolderUpdates();
      if (requestId !== latestFolderUpdateRequestIdRef.current) {
        return;
      }
      setPendingFolderUpdates(updates);
    } catch (error) {
      if (requestId !== latestFolderUpdateRequestIdRef.current) {
        return;
      }
      setSessionNotice(toRuntimeMessage(error, "Failed to refresh folder updates."));
    } finally {
      if (requestId === latestFolderUpdateRequestIdRef.current) {
        setIsFolderUpdatesLoading(false);
      }
    }
  }, [chatConfig?.enabled, fetchPendingFolderUpdates, orgId]);

  const acknowledgeFolderUpdates = useCallback(
    async (activityFolder: string) => {
      const normalizedFolder = activityFolder.trim();
      if (!normalizedFolder) {
        return;
      }

      const response = await runtime.chat.acknowledgeFolderUpdates({
        activityFolder: normalizedFolder
      });
      if (!response.ok) {
        throw new Error(response.message ?? "Failed to acknowledge folder updates.");
      }

      await refreshPendingFolderUpdates();
    },
    [refreshPendingFolderUpdates, runtime]
  );

  const fetchRecommendedSession = useCallback(
    async (workspace: WorkspaceContext): Promise<OrchestratorSession | null> => {
      const response = await runtime.chat.getRecommendedSession({
        workspaceType: workspace.workspaceType,
        scopeId: workspace.scopeId
      });
      if (!response.ok) {
        throw new Error(response.message ?? "Failed to load recommended session.");
      }
      return response.session ?? null;
    },
    [runtime]
  );

  const refreshRecommendedSession = useCallback(async () => {
    if (!chatConfig?.enabled || !orgId) {
      setRecommendedSession(null);
      setRecommendationKey("");
      return;
    }

    const requestId = latestRecommendRequestIdRef.current + 1;
    latestRecommendRequestIdRef.current = requestId;
    try {
      const recommended = await fetchRecommendedSession(workspaceContext);
      if (requestId !== latestRecommendRequestIdRef.current) {
        return;
      }

      if (!recommended?.id || recommended.id === selectedSessionId) {
        setRecommendedSession(null);
        setRecommendationKey("");
        return;
      }

      const nextKey = `${workspaceContext.workspaceKey}:${selectedSessionId ?? "none"}:${recommended.id}`;
      if (suppressedRecommendationKeyRef.current === nextKey) {
        setRecommendedSession(null);
        setRecommendationKey("");
        return;
      }

      setRecommendedSession(recommended);
      setRecommendationKey(nextKey);
    } catch (error) {
      if (requestId !== latestRecommendRequestIdRef.current) {
        return;
      }
      setRecommendedSession(null);
      setRecommendationKey("");
      setSessionNotice(toRuntimeMessage(error, "Failed to load recommended session."));
    }
  }, [chatConfig?.enabled, fetchRecommendedSession, orgId, selectedSessionId, workspaceContext]);

  const bootstrapSelection = useCallback(async () => {
    if (!chatConfig?.enabled || !orgId) {
      setSelectedSessionId(null);
      setSelectedSession(null);
      setRecentSessions([]);
      setRecommendedSession(null);
      setReviewAllSessions([]);
      setReviewAllNextCursor(null);
      setPendingFolderUpdates([]);
      setIsFolderUpdatesLoading(false);
      setSessionNotice("");
      return;
    }

    const requestId = latestBootstrapRequestIdRef.current + 1;
    latestBootstrapRequestIdRef.current = requestId;
    setIsSessionLoading(true);
    setSessionNotice("");

    try {
      const recent = await fetchRecentSessions();
      if (requestId !== latestBootstrapRequestIdRef.current) {
        return;
      }
      setRecentSessions(recent);

      const persisted = readPersistedSelectedSessionByOrg();
      const persistedSessionId = persisted[orgId] ?? "";
      const persistedSession = persistedSessionId ? recent.find((entry) => entry.id === persistedSessionId) ?? null : null;
      if (persistedSession) {
        commitSelectedSession(persistedSession);
        return;
      }

      const activeCompat = activeSessionRef.current?.id ? activeSessionRef.current : null;
      if (activeCompat?.id) {
        commitSelectedSession(activeCompat);
        setRecentSessions((previous) => upsertSession(previous, activeCompat, RECENT_LIMIT));
        return;
      }

      const activeResponse = await runtime.chat.getActiveSession();
      if (requestId !== latestBootstrapRequestIdRef.current) {
        return;
      }
      const activeFromApi = activeResponse.ok ? activeResponse.session : null;
      if (activeFromApi?.id) {
        commitSelectedSession(activeFromApi);
        setRecentSessions((previous) => upsertSession(previous, activeFromApi, RECENT_LIMIT));
        return;
      }

      const bootstrapWorkspace = resolveWorkspaceContext(activePageRef.current, null);
      let recommended: OrchestratorSession | null = null;
      try {
        recommended = await fetchRecommendedSession(bootstrapWorkspace);
      } catch (error) {
        if (requestId === latestBootstrapRequestIdRef.current) {
          setSessionNotice(toRuntimeMessage(error, "Failed to load recommended session during bootstrap."));
        }
      }
      if (requestId !== latestBootstrapRequestIdRef.current) {
        return;
      }
      if (recommended?.id) {
        commitSelectedSession(recommended);
        setRecentSessions((previous) => upsertSession(previous, recommended, RECENT_LIMIT));
        return;
      }

      const fallbackSession = recent[0] ?? null;
      if (fallbackSession?.id) {
        commitSelectedSession(fallbackSession);
        return;
      }

      commitSelectedSession(null);
      setSessionNotice("No session is available yet. Create a new session to continue.");
    } catch (error) {
      if (requestId !== latestBootstrapRequestIdRef.current) {
        return;
      }
      commitSelectedSession(null);
      setSessionNotice(toRuntimeMessage(error, "Failed to bootstrap selected session."));
    } finally {
      if (requestId === latestBootstrapRequestIdRef.current) {
        setIsSessionLoading(false);
      }
    }
  }, [chatConfig?.enabled, commitSelectedSession, fetchRecentSessions, fetchRecommendedSession, orgId, runtime]);

  useEffect(() => {
    void bootstrapSelection();
  }, [bootstrapSelection]);

  useEffect(() => {
    if (!chatConfig?.enabled || !orgId) {
      setPendingFolderUpdates([]);
      setIsFolderUpdatesLoading(false);
      return;
    }
    void refreshPendingFolderUpdates();
  }, [chatConfig?.enabled, orgId, refreshPendingFolderUpdates]);

  useEffect(() => {
    const offIndexed = runtime.watcher.onFileIndexed(() => {
      void refreshPendingFolderUpdates();
    });
    const offDeleted = runtime.watcher.onFileDeleted(() => {
      void refreshPendingFolderUpdates();
    });

    return () => {
      offIndexed();
      offDeleted();
    };
  }, [refreshPendingFolderUpdates, runtime]);

  useEffect(() => {
    if (!selectedSessionId || !activeSession?.id || activeSession.id !== selectedSessionId) {
      return;
    }
    setSelectedSession(activeSession);
    setRecentSessions((previous) => upsertSession(previous, activeSession, RECENT_LIMIT));
  }, [activeSession, selectedSessionId]);

  useEffect(() => {
    if (selectedSessionId) {
      return;
    }
    if (!activeSession?.id) {
      return;
    }
    commitSelectedSession(activeSession);
    setRecentSessions((previous) => upsertSession(previous, activeSession, RECENT_LIMIT));
  }, [activeSession, commitSelectedSession, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId) {
      return;
    }

    const candidate =
      recentSessions.find((entry) => entry.id === selectedSessionId) ??
      reviewAllSessions.find((entry) => entry.id === selectedSessionId) ??
      null;
    if (!candidate) {
      return;
    }

    if (!selectedSession || selectedSession.id !== candidate.id || selectedSession.updated_at !== candidate.updated_at) {
      setSelectedSession(candidate);
    }
  }, [recentSessions, reviewAllSessions, selectedSession, selectedSessionId]);

  const selectSession = useCallback(
    (session: OrchestratorSession) => {
      commitSelectedSession(session);
      setRecentSessions((previous) => upsertSession(previous, session, RECENT_LIMIT));
      setSessionNotice("");
      setRecommendedSession(null);
      setRecommendationKey("");
    },
    [commitSelectedSession]
  );

  const createSessionForCurrentWorkspace = useCallback(async () => {
    if (!chatConfig?.enabled || !orgId) {
      setSessionNotice("Chat runtime is unavailable. Refresh config and retry.");
      return;
    }

    const requestId = latestCreateRequestIdRef.current + 1;
    latestCreateRequestIdRef.current = requestId;
    setIsSessionMutating(true);
    setSessionNotice("");
    try {
      const response = await runtime.chat.createSession({
        workspaceType: workspaceContext.workspaceType,
        scopeId: workspaceContext.scopeId,
        startPaused: true
      });
      if (requestId !== latestCreateRequestIdRef.current) {
        return;
      }
      if (!response.ok || !response.session?.id) {
        throw new Error(response.message ?? "Failed to create session.");
      }

      selectSession(response.session);
      setSessionNotice(response.reused ? "Reused existing active session for this workspace." : "New session created.");
    } catch (error) {
      if (requestId !== latestCreateRequestIdRef.current) {
        return;
      }
      setSessionNotice(toRuntimeMessage(error, "Failed to create a new session."));
    } finally {
      if (requestId === latestCreateRequestIdRef.current) {
        setIsSessionMutating(false);
      }
    }
  }, [chatConfig?.enabled, orgId, runtime, selectSession, workspaceContext.scopeId, workspaceContext.workspaceType]);

  const dismissRecommendation = useCallback(() => {
    if (recommendationKey) {
      suppressedRecommendationKeyRef.current = recommendationKey;
    }
    setRecommendedSession(null);
    setRecommendationKey("");
  }, [recommendationKey]);

  const clearSessionNotice = useCallback(() => {
    setSessionNotice("");
  }, []);

  const loadReviewAllSessions = useCallback(async () => {
    const requestId = latestReviewRequestIdRef.current + 1;
    latestReviewRequestIdRef.current = requestId;
    setIsReviewAllLoading(true);
    try {
      const response = await runtime.chat.listSessions({
        limit: REVIEW_ALL_LIMIT,
        archived: false
      });
      if (requestId !== latestReviewRequestIdRef.current) {
        return;
      }
      if (!response.ok) {
        throw new Error(response.message ?? "Failed to load sessions.");
      }

      setReviewAllSessions(response.sessions ?? []);
      setReviewAllNextCursor(response.next_cursor ?? null);
    } catch (error) {
      if (requestId !== latestReviewRequestIdRef.current) {
        return;
      }
      setSessionNotice(toRuntimeMessage(error, "Failed to load session list."));
    } finally {
      if (requestId === latestReviewRequestIdRef.current) {
        setIsReviewAllLoading(false);
      }
    }
  }, [runtime]);

  const loadMoreReviewAllSessions = useCallback(async () => {
    if (!reviewAllNextCursor) {
      return;
    }
    const requestId = latestReviewRequestIdRef.current + 1;
    latestReviewRequestIdRef.current = requestId;
    setIsReviewAllLoading(true);
    try {
      const response = await runtime.chat.listSessions({
        limit: REVIEW_ALL_LIMIT,
        archived: false,
        cursor: reviewAllNextCursor
      });
      if (requestId !== latestReviewRequestIdRef.current) {
        return;
      }
      if (!response.ok) {
        throw new Error(response.message ?? "Failed to load additional sessions.");
      }

      setReviewAllSessions((previous) => mergeUniqueSessions(previous, response.sessions ?? []));
      setReviewAllNextCursor(response.next_cursor ?? null);
    } catch (error) {
      if (requestId !== latestReviewRequestIdRef.current) {
        return;
      }
      setSessionNotice(toRuntimeMessage(error, "Failed to load additional sessions."));
    } finally {
      if (requestId === latestReviewRequestIdRef.current) {
        setIsReviewAllLoading(false);
      }
    }
  }, [reviewAllNextCursor, runtime]);

  const invalidateSelectedSession = useCallback(
    async (notice?: string) => {
      commitSelectedSession(null);
      setRecommendedSession(null);
      setRecommendationKey("");
      if (notice) {
        setSessionNotice(notice);
      }
      await bootstrapSelection();
    },
    [bootstrapSelection, commitSelectedSession]
  );

  useEffect(() => {
    suppressedRecommendationKeyRef.current = "";
  }, [selectedSessionId, workspaceContext.workspaceKey]);

  useEffect(() => {
    if (!chatConfig?.enabled || !orgId) {
      setRecommendedSession(null);
      setRecommendationKey("");
      return;
    }

    if (recommendationTimerRef.current) {
      clearTimeout(recommendationTimerRef.current);
      recommendationTimerRef.current = null;
    }

    recommendationTimerRef.current = setTimeout(() => {
      recommendationTimerRef.current = null;
      void refreshRecommendedSession();
    }, RECOMMENDATION_DEBOUNCE_MS);

    return () => {
      if (recommendationTimerRef.current) {
        clearTimeout(recommendationTimerRef.current);
        recommendationTimerRef.current = null;
      }
    };
  }, [chatConfig?.enabled, orgId, refreshRecommendedSession, workspaceContext.workspaceKey]);

  const value = useMemo<SessionSelectorContextValue>(
    () => ({
      selectedSessionId,
      selectedSession,
      recentSessions,
      recommendedSession,
      isSessionLoading,
      isSessionMutating,
      sessionNotice,
      workspaceContext,
      reviewAllSessions,
      reviewAllNextCursor,
      isReviewAllLoading,
      pendingFolderUpdates,
      isFolderUpdatesLoading,
      refreshRecentSessions,
      refreshPendingFolderUpdates,
      acknowledgeFolderUpdates,
      refreshRecommendedSession,
      createSessionForCurrentWorkspace,
      selectSession,
      dismissRecommendation,
      clearSessionNotice,
      loadReviewAllSessions,
      loadMoreReviewAllSessions,
      invalidateSelectedSession
    }),
    [
      clearSessionNotice,
      createSessionForCurrentWorkspace,
      dismissRecommendation,
      invalidateSelectedSession,
      isFolderUpdatesLoading,
      isReviewAllLoading,
      isSessionLoading,
      isSessionMutating,
      acknowledgeFolderUpdates,
      loadMoreReviewAllSessions,
      loadReviewAllSessions,
      pendingFolderUpdates,
      recentSessions,
      recommendedSession,
      refreshPendingFolderUpdates,
      refreshRecentSessions,
      refreshRecommendedSession,
      reviewAllNextCursor,
      reviewAllSessions,
      selectSession,
      selectedSession,
      selectedSessionId,
      sessionNotice,
      workspaceContext
    ]
  );

  return <SessionSelectorContext.Provider value={value}>{children}</SessionSelectorContext.Provider>;
};

export const useSessionSelector = (): SessionSelectorContextValue => {
  const value = useContext(SessionSelectorContext);
  if (!value) {
    throw new Error("useSessionSelector must be used within SessionSelectorProvider.");
  }
  return value;
};
