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
type ChatInboxItem = Awaited<ReturnType<Window["desktopRuntime"]["chat"]["listInboxItems"]>>["items"][number];
type ChatInboxCampaign = NonNullable<ChatInboxItem["campaign"]>;
type ChatInboxContent = NonNullable<ChatInboxItem["content"]>;

export type WorkflowLinkHint = {
  workflowItemId: string;
  workflowStatus: WorkflowStatus;
  version: number;
  sessionId: string | null;
  displayTitle: string | null;
};

export type ChatUiContext = {
  source: "workspace-chat" | "context-panel-widget" | "global-chat-panel";
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const normalizeCampaignFromInbox = (value: ChatInboxCampaign): Campaign | null => {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) {
    return null;
  }

  return value as Campaign;
};

const normalizeContentFromInbox = (value: ChatInboxContent): Content | null => {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) {
    return null;
  }
  return value as Content;
};

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

  const refreshWorkspaceInbox = useCallback(async () => {
    if (!chatConfig) {
      setDraftCampaigns([]);
      setCampaignWorkflowHints({});
      setPendingContents([]);
      setPendingContentWorkflowHints({});
      return;
    }

    const result = await runtime.chat.listInboxItems({
      limit: 80
    });

    if (!result.ok) {
      setChatNotice(result.message ?? "Failed to load workspace inbox items.");
      return;
    }

    const nextCampaigns: Campaign[] = [];
    const nextCampaignHints: Record<string, WorkflowLinkHint> = {};
    const seenCampaignIds = new Set<string>();

    const nextContents: Content[] = [];
    const nextContentHints: Record<string, WorkflowLinkHint> = {};
    const seenContentIds = new Set<string>();

    for (const rawItem of result.items) {
      const item = rawItem as ChatInboxItem;
      const status = item.status;
      if (!isWorkflowStatus(status)) {
        continue;
      }

      const workflowItemId =
        typeof item.workflow_item_id === "string" && item.workflow_item_id.trim()
          ? item.workflow_item_id.trim()
          : "";
      if (!workflowItemId) {
        continue;
      }

      const version = toPositiveIntOrDefault(item.expected_version, 1);
      const sessionId =
        typeof item.session_id === "string" && item.session_id.trim() ? item.session_id.trim() : null;
      const displayTitle =
        typeof item.display_title === "string" && item.display_title.trim() ? item.display_title.trim() : null;

      if (item.type === "campaign_plan") {
        const campaign = normalizeCampaignFromInbox(item.campaign as ChatInboxCampaign);
        if (!campaign || !campaign.id || seenCampaignIds.has(campaign.id)) {
          continue;
        }
        seenCampaignIds.add(campaign.id);
        nextCampaigns.push(campaign);
        nextCampaignHints[campaign.id] = {
          workflowItemId,
          workflowStatus: status,
          version,
          sessionId,
          displayTitle
        };
        continue;
      }

      if (item.type === "content_draft") {
        const content = normalizeContentFromInbox(item.content as ChatInboxContent);
        if (!content || !content.id || seenContentIds.has(content.id)) {
          continue;
        }
        seenContentIds.add(content.id);
        nextContents.push(content);
        nextContentHints[content.id] = {
          workflowItemId,
          workflowStatus: status,
          version,
          sessionId,
          displayTitle
        };
      }
    }

    nextCampaigns.sort((left, right) => right.created_at.localeCompare(left.created_at));
    nextContents.sort((left, right) => right.created_at.localeCompare(left.created_at));

    setDraftCampaigns(nextCampaigns);
    setCampaignWorkflowHints(nextCampaignHints);
    setPendingContents(nextContents);
    setPendingContentWorkflowHints(nextContentHints);
  }, [chatConfig, runtime]);

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
    if (!chatConfig) {
      setDraftCampaigns([]);
      setCampaignWorkflowHints({});
      setPendingContents([]);
      setPendingContentWorkflowHints({});
      return;
    }

    void refreshWorkspaceInbox();

    if (!supabase) {
      return;
    }

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
          void refreshWorkspaceInbox();
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
          void refreshWorkspaceInbox();
          scheduleRefreshActiveSession();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(contentsChannel);
      void supabase.removeChannel(campaignsChannel);
    };
  }, [chatConfig, refreshWorkspaceInbox, scheduleRefreshActiveSession, supabase]);

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
        await refreshWorkspaceInbox();
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
          await Promise.all([refreshMessages(), refreshActiveSession(), refreshWorkspaceInbox()]);
        } else {
          setChatNotice(runtimeError.message);
        }
      } finally {
        setIsActionPending(false);
      }
    },
    [invalidateSelectedSession, refreshActiveSession, refreshMessages, refreshWorkspaceInbox]
  );

  const sendMessage = useCallback(
    async (input?: SendMessageInput) => {
      if (isSessionMutating) {
        setChatNotice("Session switch is in progress. Wait for completion, then retry.");
        return;
      }
      if (selectedSession && (selectedSession.status === "done" || selectedSession.status === "failed")) {
        setChatNotice(`Selected session is ${selectedSession.status}. Select or create an active session to continue.`);
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
    [chatInput, clearChatInput, ensureSelectedSessionId, isSessionMutating, runChatAction, runtime, selectedSession]
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
      const payloadContentId = typeof payload.contentId === "string" ? payload.contentId.trim() : "";
      const activeContentId =
        typeof selectedSession?.state?.content_id === "string" ? selectedSession.state.content_id.trim() : "";
      const contentId = payloadContentId || activeContentId;

      if (!contentId) {
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
          contentId
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
