import { useEffect, useMemo, useRef, useState } from "react";
import { useChatContext } from "../../context/ChatContext";
import { useNavigation } from "../../context/NavigationContext";
import { useSessionSelector } from "../../context/SessionSelectorContext";

const PANEL_DEFAULT_WIDTH = 360;
const PANEL_MIN_WIDTH = 280;
const PANEL_MAX_WIDTH = 560;
const WIDTH_STORAGE_KEY = "ddohago:globalChatWidth";
const COLLAPSED_STORAGE_KEY = "ddohago:globalChatCollapsed";

const readStoredWidth = (): number => {
  const raw = window.localStorage.getItem(WIDTH_STORAGE_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return PANEL_DEFAULT_WIDTH;
  }
  return Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, parsed));
};

const readStoredCollapsed = (): boolean => window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1";

const clampWidth = (value: number): number =>
  Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, Math.round(value)));

export const GlobalChatPanel = () => {
  const { activePage } = useNavigation();
  const {
    messages,
    chatInput,
    setChatInput,
    chatNotice,
    chatConfigMessage,
    selectedSessionId,
    isActionPending,
    isSessionMutating,
    sendMessage
  } = useChatContext();
  const {
    selectedSession,
    recentSessions,
    recommendedSession,
    isSessionLoading,
    sessionNotice,
    pendingFolderUpdates,
    isFolderUpdatesLoading,
    createSessionForCurrentWorkspace,
    selectSession,
    dismissRecommendation,
    refreshRecentSessions,
    refreshPendingFolderUpdates,
    acknowledgeFolderUpdates
  } = useSessionSelector();

  const [isCollapsed, setIsCollapsed] = useState(readStoredCollapsed);
  const [panelWidth, setPanelWidth] = useState(readStoredWidth);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);

  const isUiBusy = isActionPending || isSessionMutating;

  const timelineMessages = useMemo(
    () => messages.filter((message) => message.message_type !== "action_card"),
    [messages]
  );

  const recentSelectableSessions = useMemo(() => {
    if (selectedSession && !recentSessions.some((entry) => entry.id === selectedSession.id)) {
      return [selectedSession, ...recentSessions].slice(0, 6);
    }
    return recentSessions.slice(0, 6);
  }, [recentSessions, selectedSession]);

  useEffect(() => {
    window.localStorage.setItem(WIDTH_STORAGE_KEY, String(panelWidth));
  }, [panelWidth]);

  useEffect(() => {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, isCollapsed ? "1" : "0");
  }, [isCollapsed]);

  useEffect(() => {
    const onOpen = () => setIsCollapsed(false);
    window.addEventListener("ui:open-global-chat", onOpen);
    return () => window.removeEventListener("ui:open-global-chat", onOpen);
  }, []);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      const delta = drag.startX - event.clientX;
      setPanelWidth(clampWidth(drag.startWidth + delta));
    };

    const onUp = () => {
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  useEffect(() => {
    const node = timelineRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [selectedSessionId, timelineMessages.length]);

  if (isCollapsed) {
    return (
      <aside className="ui-global-chat-collapsed">
        <button type="button" onClick={() => setIsCollapsed(false)} aria-label="Open chat panel">
          {'<'}
        </button>
      </aside>
    );
  }

  return (
    <aside className="ui-global-chat" style={{ width: `${panelWidth}px`, minWidth: `${panelWidth}px` }}>
      <div
        className="ui-global-chat-resizer"
        onMouseDown={(event) => {
          dragRef.current = { startX: event.clientX, startWidth: panelWidth };
          document.body.style.cursor = "ew-resize";
          document.body.style.userSelect = "none";
        }}
        onDoubleClick={() => setPanelWidth(PANEL_DEFAULT_WIDTH)}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat panel"
      />

      <div className="ui-global-chat-inner">
        <header className="ui-global-chat-head">
          <strong>또대리</strong>
          <div className="button-row">
            <button type="button" onClick={() => void createSessionForCurrentWorkspace()} disabled={isUiBusy}>
              + Session
            </button>
            <button type="button" onClick={() => setIsCollapsed(true)} aria-label="Collapse chat panel">
              {'>'}
            </button>
          </div>
        </header>

        <div className="ui-global-chat-session-row">
          <select
            value={selectedSessionId ?? ""}
            onChange={(event) => {
              const session = recentSelectableSessions.find((entry) => entry.id === event.target.value);
              if (session) {
                selectSession(session);
              }
            }}
            disabled={isUiBusy || isSessionLoading}
          >
            {!selectedSessionId ? <option value="">Select recent session</option> : null}
            {recentSelectableSessions.map((session) => (
              <option key={session.id} value={session.id}>
                {(session.title?.trim() || session.id.slice(0, 8)) + ` (${session.status})`}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void Promise.all([refreshRecentSessions(), refreshPendingFolderUpdates()])}
            disabled={isUiBusy || isSessionLoading || isFolderUpdatesLoading}
          >
            Refresh
          </button>
        </div>

        {recommendedSession && recommendedSession.id !== selectedSessionId ? (
          <div className="ui-session-selector-recommendation">
            <p>
              Recommended: <strong>{recommendedSession.title?.trim() || recommendedSession.id.slice(0, 8)}</strong>
            </p>
            <div className="ui-session-selector-recommendation-actions">
              <button type="button" onClick={dismissRecommendation} disabled={isUiBusy}>
                Keep current
              </button>
              <button type="button" className="primary" onClick={() => selectSession(recommendedSession)} disabled={isUiBusy}>
                Switch
              </button>
            </div>
          </div>
        ) : null}

        {pendingFolderUpdates.length > 0 ? (
          <div className="ui-global-chat-folder-list">
            {pendingFolderUpdates.slice(0, 4).map((entry) => (
              <button
                key={entry.activity_folder}
                type="button"
                className="ui-session-rail-folder-item"
                onClick={() => {
                  setChatInput(`Create a campaign plan for ${entry.activity_folder}.`);
                  void acknowledgeFolderUpdates(entry.activity_folder);
                }}
                disabled={isUiBusy}
              >
                <span className="ui-session-rail-folder-title">
                  {entry.activity_folder} ({entry.pending_count})
                </span>
                <span className="ui-session-rail-folder-meta">
                  img {entry.file_type_counts.image} | vid {entry.file_type_counts.video} | doc {entry.file_type_counts.document}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="ui-global-chat-timeline" ref={timelineRef}>
          {timelineMessages.length === 0 ? <p className="empty">No chat messages yet.</p> : null}
          {timelineMessages.map((message) => (
            <div key={message.id} className={`chat-item chat-${message.role}`}>
              <p>{message.content || "-"}</p>
            </div>
          ))}
        </div>

        <div className="chat-input-row">
          <input
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            placeholder="Type a message..."
            disabled={isUiBusy || !selectedSessionId}
          />
          <button
            className="primary"
            disabled={isUiBusy || !selectedSessionId || !chatInput.trim()}
            onClick={() =>
              void sendMessage({
                uiContext: {
                  source: "global-chat-panel",
                  pageId: activePage
                }
              })
            }
          >
            Send
          </button>
        </div>

        {chatConfigMessage ? <p className="notice">{chatConfigMessage}</p> : null}
        {sessionNotice ? <p className="notice">{sessionNotice}</p> : null}
        {chatNotice ? <p className="notice">{chatNotice}</p> : null}
      </div>
    </aside>
  );
};
