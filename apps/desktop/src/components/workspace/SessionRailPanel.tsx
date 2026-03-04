import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useChatContext } from "../../context/ChatContext";
import { useSessionSelector } from "../../context/SessionSelectorContext";

type SessionRailPanelProps = {
  onHide: () => void;
};

const selectedWorkspaceLabel = (workspaceType: unknown, scopeId: unknown): string => {
  const type = typeof workspaceType === "string" && workspaceType.trim() ? workspaceType.trim() : "general";
  const scope = typeof scopeId === "string" && scopeId.trim() ? scopeId.trim() : "default";
  return `${type}:${scope}`;
};

const toSingleLine = (value: string): string => value.replace(/\s+/g, " ").trim();

const truncateLine = (value: string, maxLength = 72): string => {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
};

const buildSessionPreview = (session: { current_step?: string; state?: Record<string, unknown> }): string => {
  const state = session.state ?? {};
  const userMessage = typeof state.user_message === "string" ? toSingleLine(state.user_message) : "";
  const contentDraft = typeof state.content_draft === "string" ? toSingleLine(state.content_draft) : "";
  const activityFolder = typeof state.activity_folder === "string" ? toSingleLine(state.activity_folder) : "";

  if (userMessage) {
    return truncateLine(userMessage);
  }
  if (contentDraft) {
    return truncateLine(contentDraft);
  }
  if (activityFolder) {
    return truncateLine(activityFolder);
  }
  const step = typeof session.current_step === "string" ? session.current_step : "session";
  return `Step: ${step}`;
};

export const SessionRailPanel = ({ onHide }: SessionRailPanelProps) => {
  const { t } = useTranslation();
  const { selectedSessionId, selectedSession, isActionPending, isSessionMutating, setChatInput } = useChatContext();
  const {
    recentSessions,
    recommendedSession,
    isSessionLoading,
    sessionNotice,
    workspaceContext,
    pendingFolderUpdates,
    isFolderUpdatesLoading,
    createSessionForCurrentWorkspace,
    selectSession,
    dismissRecommendation,
    refreshRecentSessions,
    refreshPendingFolderUpdates,
    acknowledgeFolderUpdates
  } = useSessionSelector();

  const isUiBusy = isActionPending || isSessionMutating;

  const recentSelectableSessions = useMemo(() => {
    if (selectedSession && !recentSessions.some((entry) => entry.id === selectedSession.id)) {
      return [selectedSession, ...recentSessions].slice(0, 5);
    }
    return recentSessions.slice(0, 5);
  }, [recentSessions, selectedSession]);

  useEffect(() => {
    if (recentSessions.length > 0 || isSessionLoading) {
      return;
    }
    void refreshRecentSessions();
  }, [isSessionLoading, recentSessions.length, refreshRecentSessions]);

  const handleRefreshClick = async () => {
    await Promise.all([refreshRecentSessions(), refreshPendingFolderUpdates()]);
  };

  const handleFolderBadgeClick = async (activityFolder: string) => {
    const nextPrompt = t("chat.sessionSelector.folderPrompt", {
      folder: activityFolder
    });
    setChatInput(nextPrompt);

    if (!selectedSessionId) {
      await createSessionForCurrentWorkspace();
    }

    try {
      await acknowledgeFolderUpdates(activityFolder);
    } catch {
      void refreshPendingFolderUpdates();
    }
  };

  return (
    <aside className="ui-workspace-session-rail subpanel">
      <div className="ui-workspace-panel-head">
        <div />
        <button type="button" className="ui-session-rail-toggle-button" aria-label="Hide session rail" onClick={onHide}>
          {"<"}
        </button>
      </div>

      <p className="ui-session-selector-context">
        {t("chat.sessionSelector.workspaceContext")}: {workspaceContext.label}
      </p>

      <div className="button-row">
        <button
          type="button"
          className="ui-session-rail-icon-button"
          aria-label={t("chat.sessionSelector.newSession")}
          title={t("chat.sessionSelector.newSession")}
          onClick={() => void createSessionForCurrentWorkspace()}
          disabled={isUiBusy}
        >
          {"+"}
        </button>
        <button
          type="button"
          className="ui-session-rail-icon-button"
          aria-label={t("chat.sessionSelector.refreshList")}
          title={t("chat.sessionSelector.refreshList")}
          onClick={() => void handleRefreshClick()}
          disabled={isUiBusy || isSessionLoading || isFolderUpdatesLoading}
        >
          {"↻"}
        </button>
      </div>

      <div className="ui-session-rail-folder-block">
        <p className="ui-session-rail-section-title">{t("chat.sessionSelector.newFilesTitle")}</p>
        {isFolderUpdatesLoading && pendingFolderUpdates.length === 0 ? (
          <p className="empty">{t("chat.sessionSelector.newFilesLoading")}</p>
        ) : pendingFolderUpdates.length === 0 ? (
          <p className="empty">{t("chat.sessionSelector.newFilesEmpty")}</p>
        ) : (
          <div className="ui-session-rail-folder-list">
            {pendingFolderUpdates.map((entry) => (
              <button
                key={entry.activity_folder}
                type="button"
                className="ui-session-rail-folder-item"
                onClick={() => void handleFolderBadgeClick(entry.activity_folder)}
                disabled={isUiBusy}
                title={t("chat.sessionSelector.folderPrompt", { folder: entry.activity_folder })}
              >
                <span className="ui-session-rail-folder-title">
                  {entry.activity_folder} ({entry.pending_count})
                </span>
                <span className="ui-session-rail-folder-meta">
                  img {entry.file_type_counts.image} · vid {entry.file_type_counts.video} · doc {entry.file_type_counts.document}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {recommendedSession && recommendedSession.id !== selectedSessionId ? (
        <div className="ui-session-selector-recommendation">
          <p>
            {t("chat.sessionSelector.recommendedLabel")}: {" "}
            <strong>
              {recommendedSession.title?.trim() ||
                selectedWorkspaceLabel(recommendedSession.workspace_type, recommendedSession.scope_id)}
            </strong>
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

      <div className="agent-chat-session-block">
        {isSessionLoading && recentSelectableSessions.length === 0 ? (
          <p className="empty">{t("chat.sessionSelector.loading")}</p>
        ) : recentSelectableSessions.length === 0 ? (
          <p className="empty">{t("chat.sessionSelector.empty")}</p>
        ) : (
          <div className="ui-session-rail-list">
            {recentSelectableSessions.map((session) => {
              const contextLabelRaw = (session as Record<string, unknown>).context_label;
              const contextLabel = typeof contextLabelRaw === "string" && contextLabelRaw.trim() ? contextLabelRaw.trim() : "";
              const title =
                contextLabel ||
                session.title?.trim() ||
                selectedWorkspaceLabel(session.workspace_type, session.scope_id);
              const preview = buildSessionPreview(session as { current_step?: string; state?: Record<string, unknown> });
              const isSelected = session.id === selectedSessionId;
              return (
                <button
                  key={session.id}
                  type="button"
                  className={`ui-session-rail-item ${isSelected ? "is-active" : ""}`}
                  onClick={() => selectSession(session)}
                  disabled={isUiBusy || isSelected}
                >
                  <span className="ui-session-rail-item-title">{title}</span>
                  <span className="ui-session-rail-item-preview">{preview}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {sessionNotice ? <p className="notice">{sessionNotice}</p> : null}
    </aside>
  );
};
