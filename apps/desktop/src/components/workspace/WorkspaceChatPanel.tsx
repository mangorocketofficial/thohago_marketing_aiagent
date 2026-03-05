import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage } from "@repo/types";
import { useChatContext } from "../../context/ChatContext";
import { useNavigation } from "../../context/NavigationContext";

type WorkspaceChatPanelProps = {
  formatDateTime: (iso: string | null | undefined) => string;
};

export const WorkspaceChatPanel = ({ formatDateTime: _formatDateTime }: WorkspaceChatPanelProps) => {
  const { t } = useTranslation();
  const { navigate } = useNavigation();
  const timelineRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    const node = timelineRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [selectedSessionId, timelineMessages.length]);

  const readWorkflowNotification = (
    message: ChatMessage
  ): { workflowItemId: string; sessionId: string | null } | null => {
    if (message.message_type !== "system") {
      return null;
    }
    const metadata = message.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      return null;
    }
    const row = metadata as Record<string, unknown>;
    if (row.notification_type !== "workflow_proposed") {
      return null;
    }
    const workflowItemId =
      typeof row.workflow_item_id === "string" && row.workflow_item_id.trim() ? row.workflow_item_id.trim() : "";
    if (!workflowItemId) {
      return null;
    }
    const sessionId = typeof message.session_id === "string" && message.session_id.trim() ? message.session_id.trim() : null;
    return { workflowItemId, sessionId };
  };

  return (
    <article className="ui-workspace-chat subpanel">
      <div className="ui-workspace-panel-head">
        <h2>또대리</h2>
      </div>

      {chatConfigMessage ? <p className="notice">{chatConfigMessage}</p> : null}

      <div className="chat-list" ref={timelineRef}>
        {timelineMessages.length === 0 ? (
          <p className="empty">No chat messages yet.</p>
        ) : (
          timelineMessages.map((message) => {
            const workflowNotice = readWorkflowNotification(message);
            return (
              <div key={message.id} className={`chat-item chat-${message.role}`}>
                <p>{message.content || "-"}</p>
                {workflowNotice ? (
                  <button
                    type="button"
                    className="ui-system-notice-link"
                    onClick={() =>
                      navigate("scheduler", {
                        workspaceHandoff: {
                          focusWorkflowItemId: workflowNotice.workflowItemId,
                          focusSessionId: workflowNotice.sessionId ?? undefined
                        }
                      })
                    }
                  >
                    {t("campaignPlan.viewInInbox")}
                  </button>
                ) : null}
              </div>
            );
          })
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
                pageId: "scheduler"
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
