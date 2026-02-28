import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Campaign, ChatMessage, Content, OrchestratorSession } from "@repo/types";

type UiMode = "loading" | "onboarding" | "dashboard";
type Runtime = Window["desktopRuntime"];
type WatcherStatus = Awaited<ReturnType<Runtime["watcher"]["getStatus"]>>;
type RendererFileEntry = Awaited<ReturnType<Runtime["watcher"]["getFiles"]>>[number];
type ChatConfig = Awaited<ReturnType<Runtime["chat"]["getConfig"]>>;

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

const sortMessages = (messages: ChatMessage[]): ChatMessage[] =>
  [...messages].sort((a, b) => a.created_at.localeCompare(b.created_at));

const upsertMessage = (messages: ChatMessage[], next: ChatMessage): ChatMessage[] => {
  const withoutOld = messages.filter((item) => item.id !== next.id);
  return sortMessages([...withoutOld, next]);
};

let cachedSupabaseClient: SupabaseClient | null = null;
let cachedSupabaseClientKey = "";

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

const App = () => {
  const runtime = window.desktopRuntime;

  const [mode, setMode] = useState<UiMode>("loading");
  const [status, setStatus] = useState<WatcherStatus | null>(null);
  const [files, setFiles] = useState<RendererFileEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [notice, setNotice] = useState("");
  const [scanCount, setScanCount] = useState<number | null>(null);

  const [chatConfig, setChatConfig] = useState<ChatConfig | null>(null);
  const [activeSession, setActiveSession] = useState<OrchestratorSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draftCampaigns, setDraftCampaigns] = useState<Campaign[]>([]);
  const [pendingContents, setPendingContents] = useState<Content[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatNotice, setChatNotice] = useState("");
  const [isActionPending, setIsActionPending] = useState(false);

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

  const refreshActiveSession = useCallback(async () => {
    const response = await window.desktopRuntime.chat.getActiveSession();
    if (!response.ok) {
      setChatNotice(response.message ?? "Failed to load active session.");
      return;
    }

    setActiveSession(response.session);
  }, []);

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

    setDraftCampaigns((data ?? []) as Campaign[]);
  }, [chatConfig, supabase]);

  const refreshPendingContents = useCallback(async () => {
    if (!supabase || !chatConfig) {
      setPendingContents([]);
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

    setPendingContents((data ?? []) as Content[]);
  }, [chatConfig, supabase]);

  useEffect(() => {
    if (!runtime) {
      setChatNotice(
        "desktopRuntime bridge is unavailable. Check preload script loading and restart the desktop app."
      );
      setMode("dashboard");
      return;
    }

    const init = async () => {
      const nextStatus = await runtime.watcher.getStatus();
      setStatus(nextStatus);
      setMode(nextStatus.requiresOnboarding ? "onboarding" : "dashboard");

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
    });

    const offDeleted = runtime.watcher.onFileDeleted(({ relativePath }) => {
      setFiles((prev) => prev.filter((item) => item.relativePath !== relativePath));
    });

    const offScan = runtime.watcher.onScanComplete(({ count }) => {
      setScanCount(count);
      setNotice(`Initial scan completed: ${count} file(s) indexed.`);
    });

    const offStatus = runtime.watcher.onStatusChanged((nextStatus) => {
      setStatus(nextStatus);
      setMode(nextStatus.requiresOnboarding ? "onboarding" : "dashboard");
    });

    const offShowOnboarding = runtime.watcher.onShowOnboarding(() => {
      setMode("onboarding");
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
  }, [refreshActiveSession, runtime]);

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
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `org_id=eq.${chatConfig.orgId}`
        },
        (payload) => {
          setMessages((prev) => upsertMessage(prev, payload.new as ChatMessage));
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
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(chatChannel);
      void supabase.removeChannel(contentsChannel);
      void supabase.removeChannel(campaignsChannel);
    };
  }, [chatConfig, refreshDraftCampaigns, refreshMessages, refreshPendingContents, supabase]);

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

  const completeOnboarding = async () => {
    if (!selectedPath) {
      setNotice("Choose or create a folder first.");
      return;
    }

    try {
      const nextStatus = await window.desktopRuntime.onboarding.complete(selectedPath);
      setStatus(nextStatus);
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
      await refreshActiveSession();
      await Promise.all([refreshDraftCampaigns(), refreshPendingContents()]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Action failed.";
      setChatNotice(message);
    } finally {
      setIsActionPending(false);
    }
  };

  const sendMessage = async () => {
    const content = chatInput.trim();
    if (!content) {
      return;
    }
    if (!activeSession?.id) {
      setChatNotice("No active session. Drop a folder to start a new flow first.");
      return;
    }

    await runChatAction(async () => {
      await window.desktopRuntime.chat.sendMessage({
        sessionId: activeSession.id,
        content
      });
      setChatInput("");
    });
  };

  const approveCampaign = async (campaignId: string) => {
    if (!activeSession?.id) {
      setChatNotice("No active session available for campaign approval.");
      return;
    }

    await runChatAction(async () => {
      await window.desktopRuntime.chat.approveCampaign({
        sessionId: activeSession.id,
        campaignId
      });
    });
  };

  const approveContent = async (contentId: string) => {
    if (!activeSession?.id) {
      setChatNotice("No active session available for content approval.");
      return;
    }

    await runChatAction(async () => {
      await window.desktopRuntime.chat.approveContent({
        sessionId: activeSession.id,
        contentId
      });
    });
  };

  const rejectCampaign = async (campaignId: string) => {
    if (!activeSession?.id) {
      setChatNotice("No active session available for rejection.");
      return;
    }

    await runChatAction(async () => {
      await window.desktopRuntime.chat.reject({
        sessionId: activeSession.id,
        type: "campaign",
        id: campaignId
      });
    });
  };

  const rejectContent = async (contentId: string) => {
    if (!activeSession?.id) {
      setChatNotice("No active session available for rejection.");
      return;
    }

    await runChatAction(async () => {
      await window.desktopRuntime.chat.reject({
        sessionId: activeSession.id,
        type: "content",
        id: contentId
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
      <main className="app-shell">
        <section className="panel">
          <p className="eyebrow">First Run Setup</p>
          <h1>Choose Marketing Folder</h1>
          <p className="description">
            Organize files by activity folder. Example: <code>tanzania-activity/photo01.jpg</code>
          </p>
          <div className="button-row">
            <button onClick={() => void chooseFolder()}>Choose Existing Folder</button>
            <button onClick={() => void createFolder()}>Create New Folder</button>
          </div>
          <p className="meta">
            Selected: <strong>{selectedPath || "None"}</strong>
          </p>
          <div className="button-row">
            <button className="primary" onClick={() => void completeOnboarding()}>
              Save and Start Watcher
            </button>
          </div>
          {notice ? <p className="notice">{notice}</p> : null}
        </section>
      </main>
    );
  }

  const campaignToReview = draftCampaigns[0] ?? null;

  return (
    <main className="app-shell">
      <section className="panel">
        <p className="eyebrow">Phase 1-5b Runtime</p>
        <h1>Watcher, Chat, and Approval Queue</h1>
        <p className="description">Desktop runtime listens to local files and drives server-side orchestration.</p>
        <div className="meta-grid">
          <p>
            Platform: <strong>{runtime.platform}</strong>
          </p>
          <p>
            Watch Path: <strong>{status?.watchPath ?? "-"}</strong>
          </p>
          <p>
            Running: <strong>{status?.isRunning ? "Yes" : "No"}</strong>
          </p>
          <p>
            Active Files: <strong>{status?.fileCount ?? 0}</strong>
          </p>
          <p>
            Last Scan Count: <strong>{scanCount ?? 0}</strong>
          </p>
          <p>
            Active Session: <strong>{activeSession?.id ?? "None"}</strong>
          </p>
          <p>
            Session Step: <strong>{activeSession?.current_step ?? "-"}</strong>
          </p>
          <p>
            Session Status: <strong>{activeSession?.status ?? "-"}</strong>
          </p>
        </div>
        <div className="button-row">
          <button onClick={() => void openWatchFolder()}>Open Watch Folder</button>
          <button onClick={() => void refreshActiveSession()}>Refresh Active Session</button>
        </div>
        {notice ? <p className="notice">{notice}</p> : null}
      </section>

      <section className="panel panel-split">
        <article className="subpanel">
          <h2>Chat</h2>
          <p className="sub-description">
            Realtime stream from <code>chat_messages</code>. Send user replies to resume the orchestrator session.
          </p>
          {!chatConfig?.enabled ? (
            <p className="notice">{chatConfig?.message ?? "Chat is not enabled. Check runtime env."}</p>
          ) : null}
          <div className="chat-list">
            {messages.length === 0 ? (
              <p className="empty">No chat messages yet.</p>
            ) : (
              messages.map((message) => (
                <div key={message.id} className={`chat-item chat-${message.role}`}>
                  <div className="chat-head">
                    <strong>{message.role}</strong>
                    <span>{formatDateTime(message.created_at)}</span>
                  </div>
                  <p>{message.content}</p>
                </div>
              ))
            )}
          </div>
          {campaignToReview ? (
            <div className="campaign-card">
              <h3>Campaign Approval</h3>
              <p>
                <strong>{campaignToReview.title}</strong>
              </p>
              <p>Channels: {campaignToReview.channels.join(", ") || "-"}</p>
              <p>
                {campaignToReview.plan.post_count} posts / {campaignToReview.plan.duration_days} days
              </p>
              <div className="button-row">
                <button
                  className="primary"
                  disabled={isActionPending || !activeSession?.id}
                  onClick={() => void approveCampaign(campaignToReview.id)}
                >
                  Approve Campaign
                </button>
                <button
                  disabled={isActionPending || !activeSession?.id}
                  onClick={() => void rejectCampaign(campaignToReview.id)}
                >
                  Reject Campaign
                </button>
              </div>
            </div>
          ) : (
            <p className="empty">No draft campaign awaiting approval.</p>
          )}
          {!activeSession?.id ? (
            <p className="empty">
              No active session yet. Add a file under an activity folder (example:{" "}
              <code>tanzania-activity/photo01.jpg</code>) or place a file at watch-root.
            </p>
          ) : null}
          <div className="chat-input-row">
            <input
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="Type a reply for the assistant..."
              disabled={isActionPending || !activeSession?.id}
            />
            <button className="primary" disabled={isActionPending || !activeSession?.id} onClick={() => void sendMessage()}>
              Send
            </button>
          </div>
          {chatNotice ? <p className="notice">{chatNotice}</p> : null}
        </article>

        <article className="subpanel">
          <h2>Approval Queue</h2>
          <p className="sub-description">
            Pending items from <code>contents.status = pending_approval</code>.
          </p>
          <div className="queue-list">
            {pendingContents.length === 0 ? (
              <p className="empty">No pending contents.</p>
            ) : (
              pendingContents.map((content) => (
                <div key={content.id} className="queue-item">
                  <div className="queue-meta">
                    <p>
                      <strong>{content.channel}</strong> · {content.content_type}
                    </p>
                    <p>Campaign: {content.campaign_id ?? "-"}</p>
                    <p>Created: {formatDateTime(content.created_at)}</p>
                  </div>
                  <p className="queue-body">{content.body ?? "(empty content)"}</p>
                  <div className="button-row">
                    <button
                      className="primary"
                      disabled={isActionPending || !activeSession?.id}
                      onClick={() => void approveContent(content.id)}
                    >
                      Approve
                    </button>
                    <button
                      disabled={isActionPending || !activeSession?.id}
                      onClick={() => void rejectContent(content.id)}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </article>
      </section>

      <section className="panel">
        <h2>Indexed Files</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Activity</th>
                <th>File</th>
                <th>Type</th>
                <th>Size</th>
              </tr>
            </thead>
            <tbody>
              {sortedFiles.length === 0 ? (
                <tr>
                  <td colSpan={4}>No active files indexed yet.</td>
                </tr>
              ) : (
                sortedFiles.map((entry) => (
                  <tr key={entry.relativePath}>
                    <td>{entry.activityFolder}</td>
                    <td>{entry.fileName}</td>
                    <td>{entry.fileType}</td>
                    <td>{entry.fileSize.toLocaleString()} B</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
};

export default App;
