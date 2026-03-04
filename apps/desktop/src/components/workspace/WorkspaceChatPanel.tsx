import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useChatContext } from "../../context/ChatContext";

type WorkspaceChatPanelProps = {
  formatDateTime: (iso: string | null | undefined) => string;
};

export const WorkspaceChatPanel = ({ formatDateTime: _formatDateTime }: WorkspaceChatPanelProps) => {
  const { t } = useTranslation();
  const {
    messages,
    chatInput,
    setChatInput,
    chatNotice,
    chatConfigMessage,
    selectedSessionId,
    isSessionMutating,
    sendMessage
  } = useChatContext();

  const timelineMessages = useMemo(
    () => messages.filter((message) => message.message_type !== "action_card"),
    [messages]
  );

  return (
    <article className="ui-workspace-chat subpanel">
      <div className="ui-workspace-panel-head">
        <h2>또대리</h2>
      </div>

      {chatConfigMessage ? <p className="notice">{chatConfigMessage}</p> : null}

      <div className="chat-list">
        {timelineMessages.length === 0 ? (
          <p className="empty">No chat messages yet.</p>
        ) : (
          timelineMessages.map((message) => (
            <div key={message.id} className={`chat-item chat-${message.role}`}>
              <p>{message.content || "-"}</p>
            </div>
          ))
        )}
      </div>

      {!selectedSessionId ? <p className="empty">{t("chat.sessionSelector.noSelection")}</p> : null}
      {chatNotice ? <p className="notice">{chatNotice}</p> : null}

      <div className="chat-input-row">
        <input
          value={chatInput}
          onChange={(event) => setChatInput(event.target.value)}
          placeholder={t("chat.sessionSelector.inputPlaceholder")}
          disabled={isSessionMutating || !selectedSessionId}
        />
        <button
          className="primary"
          disabled={isSessionMutating || !selectedSessionId || !chatInput.trim()}
          onClick={() =>
            void sendMessage({
              uiContext: {
                source: "workspace-chat",
                pageId: "workspace"
              }
            })
          }
        >
          {t("chat.sessionSelector.send")}
        </button>
      </div>
    </article>
  );
};
