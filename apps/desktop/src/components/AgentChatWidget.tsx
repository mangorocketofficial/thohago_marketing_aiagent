import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage, OrchestratorSession } from "@repo/types";
import { useChatContext } from "../context/ChatContext";
import { useNavigation } from "../context/NavigationContext";
import { useSessionSelector } from "../context/SessionSelectorContext";
import { SessionList } from "./session/SessionList";
import type { PageId } from "../types/navigation";

type AgentChatWidgetProps = {
  pageId: PageId;
};

const workspaceLabel = (session: OrchestratorSession | null): string => {
  if (!session) {
    return "general:default";
  }
  const type = typeof session.workspace_type === "string" && session.workspace_type.trim() ? session.workspace_type.trim() : "general";
  const scope = typeof session.scope_id === "string" && session.scope_id.trim() ? session.scope_id.trim() : "default";
  return `${type}:${scope}`;
};

const sessionTitle = (session: OrchestratorSession | null): string => {
  if (!session) {
    return "-";
  }
  const title = typeof session.title === "string" ? session.title.trim() : "";
  if (title) {
    return title;
  }
  return workspaceLabel(session);
};

export const AgentChatWidget = ({ pageId }: AgentChatWidgetProps) => {
  const { t } = useTranslation();
  const { navigate } = useNavigation();
  const { messages, chatNotice, selectedSessionId, isActionPending, isSessionMutating, sendMessage } = useChatContext();
  const {
    selectedSession,
    recentSessions,
    recommendedSession,
    isSessionLoading,
    sessionNotice,
    workspaceContext,
    reviewAllSessions,
    reviewAllNextCursor,
    isReviewAllLoading,
    createSessionForCurrentWorkspace,
    selectSession,
    dismissRecommendation,
    loadReviewAllSessions,
    loadMoreReviewAllSessions
  } = useSessionSelector();
  const [widgetInput, setWidgetInput] = useState("");
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);

  const isUiBusy = isActionPending || isSessionMutating;
  const recentMessages = useMemo(
    () => messages.filter((message) => message.message_type !== "action_card").slice(-20),
    [messages]
  );

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

  const recentSelectableSessions = useMemo(() => {
    if (selectedSession && !recentSessions.some((entry) => entry.id === selectedSession.id)) {
      return [selectedSession, ...recentSessions].slice(0, 5);
    }
    return recentSessions.slice(0, 5);
  }, [recentSessions, selectedSession]);

  useEffect(() => {
    if (!isReviewModalOpen) {
      return;
    }
    if (reviewAllSessions.length > 0 || isReviewAllLoading) {
      return;
    }
    void loadReviewAllSessions();
  }, [isReviewModalOpen, isReviewAllLoading, loadReviewAllSessions, reviewAllSessions.length]);

  const onSend = async () => {
    const content = widgetInput.trim();
    if (!content || !selectedSessionId) {
      return;
    }

    await sendMessage({
      content,
      uiContext: {
        source: "context-panel-widget",
        pageId,
        contextPanelMode: "agent-chat"
      }
    });
    setWidgetInput("");
  };

  return (
    <div className="ui-agent-widget">
      <div className="ui-agent-widget-head">
        <h4>{t("ui.pages.agentWidget.title")}</h4>
        <p>{t("ui.pages.agentWidget.description")}</p>
      </div>

      <section className="ui-session-selector-bar">
        <div className="ui-session-selector-current">
          <strong>{sessionTitle(selectedSession)}</strong>
          <div className="ui-session-selector-chip-row">
            <span className="ui-session-chip">{workspaceLabel(selectedSession)}</span>
            <span className="ui-session-chip">{selectedSession?.status ?? "-"}</span>
          </div>
        </div>

        <div className="ui-session-selector-actions">
          <select
            value={selectedSessionId ?? ""}
            onChange={(event) => {
              const nextId = event.target.value;
              const nextSession = recentSelectableSessions.find((entry) => entry.id === nextId) ?? null;
              if (nextSession) {
                selectSession(nextSession);
              }
            }}
            disabled={isUiBusy || isSessionLoading}
          >
            {!selectedSessionId ? (
              <option value="">{t("chat.sessionSelector.selectRecent")}</option>
            ) : null}
            {recentSelectableSessions.map((session) => (
              <option key={session.id} value={session.id}>
                {sessionTitle(session)} ({session.status})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              setIsReviewModalOpen(true);
              void loadReviewAllSessions();
            }}
            disabled={isUiBusy}
          >
            {t("chat.sessionSelector.reviewAll")}
          </button>
          <button type="button" onClick={() => void createSessionForCurrentWorkspace()} disabled={isUiBusy}>
            {t("chat.sessionSelector.newSession")}
          </button>
          <button type="button" onClick={() => navigate("scheduler")} disabled={isUiBusy}>
            {t("chat.sessionSelector.openHub")}
          </button>
        </div>

        {recommendedSession && recommendedSession.id !== selectedSessionId ? (
          <div className="ui-session-selector-recommendation">
            <p>
              {t("chat.sessionSelector.recommendedLabel")}: <strong>{sessionTitle(recommendedSession)}</strong>
            </p>
            <div className="ui-session-selector-recommendation-actions">
              <button type="button" onClick={dismissRecommendation} disabled={isUiBusy}>
                {t("chat.sessionSelector.continueCurrent")}
              </button>
              <button type="button" className="primary" onClick={() => selectSession(recommendedSession)} disabled={isUiBusy}>
                {t("chat.sessionSelector.switchRecommended")}
              </button>
            </div>
          </div>
        ) : null}

        <p className="ui-session-selector-context">
          {t("chat.sessionSelector.workspaceContext")}: {workspaceContext.label}
        </p>
      </section>

      <div className="ui-agent-widget-list">
        {recentMessages.length === 0 ? (
          <p className="empty">{t("ui.pages.agentWidget.empty")}</p>
        ) : (
          recentMessages.map((message) => {
            const workflowNotice = readWorkflowNotification(message);
            return (
              <div key={message.id} className={`ui-agent-widget-item is-${message.role}`}>
                <strong>{message.role}</strong>
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

      <div className="ui-agent-widget-input-row">
        <input
          value={widgetInput}
          onChange={(event) => setWidgetInput(event.target.value)}
          placeholder={t("ui.pages.agentWidget.inputPlaceholder")}
          disabled={isUiBusy || !selectedSessionId}
        />
        <button
          type="button"
          className="primary"
          onClick={() => void onSend()}
          disabled={isUiBusy || !selectedSessionId || !widgetInput.trim()}
        >
          {t("ui.pages.agentWidget.send")}
        </button>
      </div>

      {sessionNotice ? <p className="notice">{sessionNotice}</p> : null}
      {chatNotice ? <p className="notice">{chatNotice}</p> : null}

      {isReviewModalOpen ? (
        <div className="ui-session-modal-backdrop" role="dialog" aria-modal="true">
          <div className="ui-session-modal">
            <div className="ui-session-modal-head">
              <h4>{t("chat.sessionSelector.reviewAllTitle")}</h4>
              <button type="button" onClick={() => setIsReviewModalOpen(false)}>
                {t("chat.sessionSelector.close")}
              </button>
            </div>

            <div className="ui-session-modal-body">
              <SessionList
                sessions={reviewAllSessions}
                selectedSessionId={selectedSessionId}
                isBusy={isUiBusy}
                isLoading={isReviewAllLoading}
                emptyMessage={t("chat.sessionSelector.empty")}
                loadingLabel={t("chat.sessionSelector.loading")}
                selectLabel={t("chat.sessionSelector.select")}
                selectedLabel={t("chat.sessionSelector.selected")}
                onSelect={(session) => {
                  selectSession(session);
                  setIsReviewModalOpen(false);
                }}
              />
            </div>

            <div className="ui-session-modal-footer">
              {reviewAllNextCursor ? (
                <button type="button" onClick={() => void loadMoreReviewAllSessions()} disabled={isReviewAllLoading}>
                  {isReviewAllLoading ? t("chat.sessionSelector.loading") : t("chat.sessionSelector.loadMore")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
