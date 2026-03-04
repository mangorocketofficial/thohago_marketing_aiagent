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
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type {
  Campaign,
  ChatActionCardDispatchInput,
  ChatMessage,
  Content,
  OrchestratorSession,
  WorkflowStatus
} from "@repo/types";
import type { PageId } from "../types/navigation";
import { useSessionSelector } from "./SessionSelectorContext";

const REFRESH_ACTIVE_SESSION_DEBOUNCE_MS = 250;

type ChatConfig = Awaited<ReturnType<Window["desktopRuntime"]["chat"]["getConfig"]>>;
type ChatTimelineScope = "session" | "org";

type WorkflowItemLinkRow = {
  id: string;
  source_campaign_id: string | null;
  source_content_id: string | null;
  session_id: string | null;
  display_title: string | null;
  status: WorkflowStatus;
  version: number | string;
};

export type WorkflowLinkHint = {
  workflowItemId: string;
  workflowStatus: WorkflowStatus;
  version: number;
  sessionId: string | null;
  displayTitle: string | null;
};

export type ChatUiContext = {
  source: "workspace-chat" | "context-panel-widget";
  pageId: PageId;
  contextPanelMode?: "agent-chat" | "page-context";
  focusWorkflowItemId?: string;
  focusContentId?: string;
  focusCampaignId?: string;
};

type SendMessageInput = {
  content?: string;
  uiContext?: ChatUiContext;
};

type ChatProviderProps = PropsWithChildren<{
  runtime: Window["desktopRuntime"];
  supabase: SupabaseClient | null;
  chatConfig: ChatConfig | null;
  activeSession: OrchestratorSession | null;
  refreshActiveSession: () => Promise<OrchestratorSession | null>;
}>;

type ChatContextValue = {
  messages: ChatMessage[];
  legacyMessages: ChatMessage[];
  isLegacyMessagesLoading: boolean;
  legacyMessagesNotice: string;
  draftCampaigns: Campaign[];
  pendingContents: Content[];
  campaignWorkflowHints: Record<string, WorkflowLinkHint>;
  pendingContentWorkflowHints: Record<string, WorkflowLinkHint>;
  campaignToReview: Campaign | null;
  chatInput: string;
  setChatInput: (value: string) => void;
  clearChatInput: () => void;
  chatNotice: string;
  chatConfigMessage: string;
  selectedSessionId: string | null;
  selectedSession: OrchestratorSession | null;
  isActionPending: boolean;
  isSessionMutating: boolean;
  loadLegacyMessages: () => Promise<void>;
  sendMessage: (input?: SendMessageInput) => Promise<void>;
  dispatchCardAction: (payload: ChatActionCardDispatchInput) => Promise<void>;
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

const sortMessages = (messages: ChatMessage[]): ChatMessage[] =>
  [...messages].sort((a, b) => a.created_at.localeCompare(b.created_at));

const upsertMessage = (messages: ChatMessage[], next: ChatMessage): ChatMessage[] => {
  const withoutOld = messages.filter((item) => item.id !== next.id);
  return sortMessages([...withoutOld, next]);
};

const normalizeTimelineScope = (value: unknown): ChatTimelineScope => (value === "org" ? "org" : "session");

const ChatContext = createContext<ChatContextValue | null>(null);

export const ChatProvider = ({
  children,
  runtime,
  supabase,
  chatConfig,
  activeSession: _activeSession,
  refreshActiveSession
}: ChatProviderProps) => {
  const { selectedSessionId, selectedSession, isSessionMutating, invalidateSelectedSession } = useSessionSelector();
  const timelineScope = normalizeTimelineScope(chatConfig?.timelineScope);

  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [legacyMessages, setLegacyMessages] = useState<ChatMessage[]>([]);
  const [isLegacyMessagesLoading, setIsLegacyMessagesLoading] = useState(false);
  const [legacyMessagesNotice, setLegacyMessagesNotice] = useState("");
  const [draftCampaigns, setDraftCampaigns] = useState<Campaign[]>([]);
  const [campaignWorkflowHints, setCampaignWorkflowHints] = useState<Record<string, WorkflowLinkHint>>({});
  const [pendingContents, setPendingContents] = useState<Content[]>([]);
  const [pendingContentWorkflowHints, setPendingContentWorkflowHints] = useState<Record<string, WorkflowLinkHint>>({});
  const [chatNotice, setChatNotice] = useState("");
  const [isActionPending, setIsActionPending] = useState(false);

  const refreshActiveSessionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedSessionIdRef = useRef<string | null>(selectedSessionId);
  const timelineScopeRef = useRef<ChatTimelineScope>(timelineScope);
  const messageRefreshRequestIdRef = useRef(0);
  const chatSubscriptionTokenRef = useRef(0);
  const chatChannelRef = useRef<RealtimeChannel | null>(null);

  const clearChatInput = useCallback(() => {
    setChatInput("");
  }, []);

  const campaignToReview = useMemo(() => draftCampaigns[0] ?? null, [draftCampaigns]);

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    timelineScopeRef.current = timelineScope;
  }, [timelineScope]);

  const refreshMessages = useCallback(
    async (options?: { token?: number }) => {
      const requestId = messageRefreshRequestIdRef.current + 1;
      messageRefreshRequestIdRef.current = requestId;

      const token = options?.token ?? chatSubscriptionTokenRef.current;
      const boundSelectedSessionId = selectedSessionId;
      const boundTimelineScope = timelineScope;

      if (!supabase || !chatConfig) {
        if (requestId === messageRefreshRequestIdRef.current) {
          setMessages([]);
        }
        return;
      }

      if (boundTimelineScope === "session" && !boundSelectedSessionId) {
        if (requestId === messageRefreshRequestIdRef.current) {
          setMessages([]);
        }
        return;
      }

      let query = supabase
        .from("chat_messages")
        .select("*")
        .eq("org_id", chatConfig.orgId)
        .order("created_at", { ascending: true })
        .limit(200);

      if (boundTimelineScope === "session") {
        query = query.eq("session_id", boundSelectedSessionId);
      }

      const { data, error } = await query;

      if (
        requestId !== messageRefreshRequestIdRef.current ||
        token !== chatSubscriptionTokenRef.current ||
        timelineScopeRef.current !== boundTimelineScope ||
        (boundTimelineScope === "session" && selectedSessionIdRef.current !== boundSelectedSessionId)
      ) {
        return;
      }

      if (error) {
        setChatNotice(`Failed to load chat messages: ${error.message}`);
        return;
      }

      setMessages(sortMessages((data ?? []) as ChatMessage[]));
    },
    [chatConfig, selectedSessionId, supabase, timelineScope]
  );

  const loadLegacyMessages = useCallback(async () => {
    if (!supabase || !chatConfig) {
      setLegacyMessages([]);
      setLegacyMessagesNotice("");
      return;
    }

    setIsLegacyMessagesLoading(true);
    setLegacyMessagesNotice("");
    try {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("org_id", chatConfig.orgId)
        .is("session_id", null)
        .order("created_at", { ascending: true })
        .limit(200);

      if (error) {
        setLegacyMessagesNotice(`Failed to load legacy messages: ${error.message}`);
        return;
      }

      setLegacyMessages(sortMessages((data ?? []) as ChatMessage[]));
    } finally {
      setIsLegacyMessagesLoading(false);
    }
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
      .select("id,source_campaign_id,session_id,display_title,status,version")
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
      const workflowSessionId = typeof row.session_id === "string" && row.session_id.trim() ? row.session_id.trim() : null;
      const displayTitle =
        typeof row.display_title === "string" && row.display_title.trim() ? row.display_title.trim() : null;
      nextHints[sourceCampaignId] = {
        workflowItemId,
        workflowStatus: row.status,
        version: toPositiveIntOrDefault(row.version, 1),
        sessionId: workflowSessionId,
        displayTitle
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
      .select("id,source_content_id,session_id,display_title,status,version")
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
      const workflowSessionId = typeof row.session_id === "string" && row.session_id.trim() ? row.session_id.trim() : null;
      const displayTitle =
        typeof row.display_title === "string" && row.display_title.trim() ? row.display_title.trim() : null;
      nextHints[sourceContentId] = {
        workflowItemId,
        workflowStatus: row.status,
        version: toPositiveIntOrDefault(row.version, 1),
        sessionId: workflowSessionId,
        displayTitle
      };
    }

    setPendingContentWorkflowHints(nextHints);
  }, [chatConfig, supabase]);

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
    const offActionResult = runtime.chat.onActionResult((payload) => {
      setChatNotice(`Action succeeded: ${payload.action}`);
    });

    const offActionError = runtime.chat.onActionError((payload) => {
      setChatNotice(`Action failed (${payload.action}): ${payload.message}`);
    });

    return () => {
      offActionResult();
      offActionError();
    };
  }, [runtime]);

  useEffect(() => {
    if (!supabase || !chatConfig) {
      setDraftCampaigns([]);
      setCampaignWorkflowHints({});
      setPendingContents([]);
      setPendingContentWorkflowHints({});
      return;
    }

    void refreshDraftCampaigns();
    void refreshPendingContents();

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
      void supabase.removeChannel(contentsChannel);
      void supabase.removeChannel(campaignsChannel);
    };
  }, [chatConfig, refreshDraftCampaigns, refreshPendingContents, scheduleRefreshActiveSession, supabase]);

  useEffect(() => {
    if (!supabase || !chatConfig) {
      setMessages([]);
      return;
    }

    const token = chatSubscriptionTokenRef.current + 1;
    chatSubscriptionTokenRef.current = token;

    const boundTimelineScope = timelineScope;
    const boundSelectedSessionId = selectedSessionId;

    // 1) clear stale timeline first
    setMessages([]);

    // 2) unsubscribe previous message channel
    if (chatChannelRef.current) {
      void supabase.removeChannel(chatChannelRef.current);
      chatChannelRef.current = null;
    }

    if (boundTimelineScope === "session" && !boundSelectedSessionId) {
      return;
    }

    const channelFilter =
      boundTimelineScope === "session"
        ? `org_id=eq.${chatConfig.orgId},session_id=eq.${boundSelectedSessionId}`
        : `org_id=eq.${chatConfig.orgId}`;
    const channelName =
      boundTimelineScope === "session"
        ? `desktop-chat-${chatConfig.orgId}-${boundSelectedSessionId}`
        : `desktop-chat-${chatConfig.orgId}-org`;

    // 3) subscribe new channel
    const nextChannel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_messages",
          filter: channelFilter
        },
        (payload) => {
          if (token !== chatSubscriptionTokenRef.current) {
            return;
          }
          if (timelineScopeRef.current !== boundTimelineScope) {
            return;
          }
          if (boundTimelineScope === "session" && selectedSessionIdRef.current !== boundSelectedSessionId) {
            return;
          }

          const nextRow = (payload.new ?? null) as ChatMessage | null;
          const oldRow = (payload.old ?? null) as ChatMessage | null;
          const eventSessionIdRaw = nextRow?.session_id ?? oldRow?.session_id ?? null;
          const eventSessionId = typeof eventSessionIdRaw === "string" ? eventSessionIdRaw.trim() : null;
          if (boundTimelineScope === "session" && eventSessionId !== boundSelectedSessionId) {
            return;
          }

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
    chatChannelRef.current = nextChannel;

    // 4) load snapshot after binding
    void refreshMessages({ token });

    return () => {
      if (chatChannelRef.current === nextChannel) {
        void supabase.removeChannel(nextChannel);
        chatChannelRef.current = null;
      }
    };
  }, [chatConfig, refreshMessages, scheduleRefreshActiveSession, selectedSessionId, supabase, timelineScope]);

  const ensureSelectedSessionId = useCallback(async (): Promise<string | null> => {
    if (selectedSessionId) {
      return selectedSessionId;
    }

    setChatNotice("No selected session. Choose a session or create a new session first.");
    return null;
  }, [selectedSessionId]);

  const runChatAction = useCallback(
    async (action: () => Promise<void>) => {
      setIsActionPending(true);
      setChatNotice("");
      try {
        await action();
        await refreshMessages();
        await refreshActiveSession();
        await Promise.all([refreshDraftCampaigns(), refreshPendingContents()]);
      } catch (error) {
        const runtimeError = toRuntimeActionError(error, "Action failed.");
        if (
          runtimeError.status === 403 ||
          runtimeError.status === 404 ||
          runtimeError.code === "not_found" ||
          runtimeError.code === "session_closed"
        ) {
          await invalidateSelectedSession("Selected session is unavailable. Re-select a valid session.");
          setChatNotice("Selected session is unavailable. Re-select a valid session.");
          return;
        }
        if (runtimeError.code === "version_conflict") {
          setChatNotice(buildVersionConflictNotice(runtimeError));
          await Promise.all([refreshMessages(), refreshActiveSession(), refreshDraftCampaigns(), refreshPendingContents()]);
        } else {
          setChatNotice(runtimeError.message);
        }
      } finally {
        setIsActionPending(false);
      }
    },
    [invalidateSelectedSession, refreshActiveSession, refreshDraftCampaigns, refreshMessages, refreshPendingContents]
  );

  const sendMessage = useCallback(
    async (input?: SendMessageInput) => {
      if (isSessionMutating) {
        setChatNotice("Session switch is in progress. Wait for completion, then retry.");
        return;
      }
      const source = typeof input?.content === "string" ? input.content : chatInput;
      const content = source.trim();
      if (!content) {
        return;
      }

      const sessionId = await ensureSelectedSessionId();
      if (!sessionId) {
        return;
      }

      await runChatAction(async () => {
        await runtime.chat.sendMessage({
          sessionId,
          content,
          ...(input?.uiContext ? { uiContext: input.uiContext } : {})
        });
        if (input?.content === undefined) {
          clearChatInput();
        }
      });
    },
    [chatInput, clearChatInput, ensureSelectedSessionId, isSessionMutating, runChatAction, runtime]
  );

  const dispatchCardAction = useCallback(
    async (payload: ChatActionCardDispatchInput) => {
      if (isSessionMutating) {
        setChatNotice("Session switch is in progress. Wait for completion, then retry.");
        return;
      }
      const sessionId = payload.sessionId.trim();
      if (!sessionId) {
        setChatNotice("sessionId is required for action card dispatch.");
        return;
      }
      const payloadCampaignId = typeof payload.campaignId === "string" ? payload.campaignId.trim() : "";
      const payloadContentId = typeof payload.contentId === "string" ? payload.contentId.trim() : "";
      const activeCampaignId =
        typeof selectedSession?.state?.campaign_id === "string" ? selectedSession.state.campaign_id.trim() : "";
      const activeContentId =
        typeof selectedSession?.state?.content_id === "string" ? selectedSession.state.content_id.trim() : "";
      const campaignId = payloadCampaignId || activeCampaignId;
      const contentId = payloadContentId || activeContentId;

      const isCampaignEvent = payload.eventType.startsWith("campaign_");
      const isContentEvent = payload.eventType.startsWith("content_");
      if (isCampaignEvent && !campaignId) {
        console.warn("[ChatContext] dispatchCardAction missing campaignId", {
          sessionId,
          workflowItemId: payload.workflowItemId,
          selectedSessionId,
          payloadCampaignId,
          activeCampaignId
        });
        setChatNotice("Campaign action is missing campaignId. Retry from Inbox or refresh session state.");
        return;
      }
      if (isContentEvent && !contentId) {
        console.warn("[ChatContext] dispatchCardAction missing contentId", {
          sessionId,
          workflowItemId: payload.workflowItemId,
          selectedSessionId,
          payloadContentId,
          activeContentId
        });
        setChatNotice("Content action is missing contentId. Retry from Inbox or refresh session state.");
        return;
      }

      await runChatAction(async () => {
        await runtime.chat.dispatchAction({
          ...payload,
          ...(isCampaignEvent ? { campaignId } : {}),
          ...(isContentEvent ? { contentId } : {})
        });
      });
    },
    [isSessionMutating, runChatAction, runtime, selectedSession, selectedSessionId]
  );

  const value = useMemo<ChatContextValue>(
    () => ({
      messages,
      legacyMessages,
      isLegacyMessagesLoading,
      legacyMessagesNotice,
      draftCampaigns,
      pendingContents,
      campaignWorkflowHints,
      pendingContentWorkflowHints,
      campaignToReview,
      chatInput,
      setChatInput,
      clearChatInput,
      chatNotice,
      chatConfigMessage: chatConfig?.message ?? "",
      selectedSessionId,
      selectedSession,
      isActionPending,
      isSessionMutating,
      loadLegacyMessages,
      sendMessage,
      dispatchCardAction
    }),
    [
      messages,
      legacyMessages,
      isLegacyMessagesLoading,
      legacyMessagesNotice,
      draftCampaigns,
      pendingContents,
      campaignWorkflowHints,
      pendingContentWorkflowHints,
      campaignToReview,
      chatInput,
      clearChatInput,
      chatNotice,
      chatConfig,
      selectedSessionId,
      selectedSession,
      isActionPending,
      isSessionMutating,
      loadLegacyMessages,
      sendMessage,
      dispatchCardAction
    ]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};

export const useChatContext = (): ChatContextValue => {
  const value = useContext(ChatContext);
  if (!value) {
    throw new Error("useChatContext must be used within ChatProvider.");
  }
  return value;
};
