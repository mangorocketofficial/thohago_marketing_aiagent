import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useChatContext } from "../context/ChatContext";
import type { PageId } from "../types/navigation";

type AgentChatWidgetProps = {
  pageId: PageId;
};

export const AgentChatWidget = ({ pageId }: AgentChatWidgetProps) => {
  const { t } = useTranslation();
  const { messages, chatNotice, activeSessionId, isActionPending, sendMessage } = useChatContext();
  const [widgetInput, setWidgetInput] = useState("");

  const recentMessages = useMemo(() => messages.slice(-20), [messages]);

  const onSend = async () => {
    const content = widgetInput.trim();
    if (!content) {
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

      <div className="ui-agent-widget-list">
        {recentMessages.length === 0 ? (
          <p className="empty">{t("ui.pages.agentWidget.empty")}</p>
        ) : (
          recentMessages.map((message) => (
            <div key={message.id} className={`ui-agent-widget-item is-${message.role}`}>
              <strong>{message.role}</strong>
              <p>{message.content || "-"}</p>
            </div>
          ))
        )}
      </div>

      {!activeSessionId ? <p className="empty">{t("ui.pages.agentWidget.noActiveSession")}</p> : null}

      <div className="ui-agent-widget-input-row">
        <input
          value={widgetInput}
          onChange={(event) => setWidgetInput(event.target.value)}
          placeholder={t("ui.pages.agentWidget.inputPlaceholder")}
          disabled={isActionPending}
        />
        <button type="button" className="primary" onClick={() => void onSend()} disabled={isActionPending || !widgetInput.trim()}>
          {t("ui.pages.agentWidget.send")}
        </button>
      </div>

      {chatNotice ? <p className="notice">{chatNotice}</p> : null}
    </div>
  );
};
