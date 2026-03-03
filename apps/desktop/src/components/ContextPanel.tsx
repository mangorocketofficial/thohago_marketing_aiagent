import { useTranslation } from "react-i18next";
import { AgentChatWidget } from "./AgentChatWidget";
import type { ContextPanelMode, PageId } from "../types/navigation";

type ContextPanelProps = {
  activePage: PageId;
  mode: ContextPanelMode;
  isCollapsed: boolean;
  onModeChange: (mode: ContextPanelMode) => void;
  onToggleCollapsed: () => void;
};

export const ContextPanel = ({ activePage, mode, isCollapsed, onModeChange, onToggleCollapsed }: ContextPanelProps) => {
  const { t } = useTranslation();
  const contextTitle = t(`ui.contextPanel.titleByPage.${activePage}`);

  return (
    <aside className={`ui-context-panel ${isCollapsed ? "is-collapsed" : ""}`}>
      <button
        type="button"
        className="ui-context-toggle"
        onClick={onToggleCollapsed}
        aria-label={isCollapsed ? "Expand context panel" : "Collapse context panel"}
      >
        {isCollapsed ? "<" : ">"}
      </button>

      {!isCollapsed ? (
        <div className="ui-context-inner">
          <h3>{contextTitle}</h3>
          <p className="ui-context-mode">
            {t("ui.contextPanel.modeLabel")}: {mode === "agent-chat" ? t("ui.contextPanel.modeMiniChat") : t("ui.contextPanel.modePageContext")}
          </p>

          {mode === "agent-chat" ? (
            <>
              <button type="button" onClick={() => onModeChange("page-context")}> 
                {t("ui.contextPanel.closeMiniChat")}
              </button>
              <AgentChatWidget pageId={activePage} />
            </>
          ) : (
            <>
              <p>{t("ui.contextPanel.description")}</p>
              <button type="button" onClick={() => onModeChange("agent-chat")}> 
                {t("ui.contextPanel.openMiniChat")}
              </button>
            </>
          )}
        </div>
      ) : null}
    </aside>
  );
};
