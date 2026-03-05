import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage } from "@repo/types";
import { useChatContext } from "../../context/ChatContext";
import { useNavigation } from "../../context/NavigationContext";

type WorkspaceChatPanelProps = {
  formatDateTime: (iso: string | null | undefined) => string;
};

type ChatSkillOption = {
  id: string;
  label: string;
  description: string;
};

type SurveyPromptMeta = {
  questionId: string;
  choices: string[];
  directInputHint: string | null;
};

const DEFAULT_CHAT_SKILL_OPTIONS: ChatSkillOption[] = [
  {
    id: "campaign_plan",
    label: "캠페인계획",
    description: "캠페인 계획 스킬 모드로 시작"
  }
];

const DIRECT_INPUT_CHOICE = "직접 입력";

const isDirectInputChoice = (value: string): boolean => value.trim() === DIRECT_INPUT_CHOICE;

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
  const [isSkillMenuOpen, setIsSkillMenuOpen] = useState(false);
  const [selectedSkillTrigger, setSelectedSkillTrigger] = useState<string | null>(null);
  const [chatSkillOptions, setChatSkillOptions] = useState<ChatSkillOption[]>(DEFAULT_CHAT_SKILL_OPTIONS);
  const skillMenuRef = useRef<HTMLDivElement | null>(null);

  const timelineMessages = useMemo(
    () => messages.filter((message) => message.message_type !== "action_card"),
    [messages]
  );
  const selectedSkill = useMemo(
    () => chatSkillOptions.find((entry) => entry.id === selectedSkillTrigger) ?? null,
    [chatSkillOptions, selectedSkillTrigger]
  );

  useEffect(() => {
    const node = timelineRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [selectedSessionId, timelineMessages.length]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!skillMenuRef.current) {
        return;
      }
      if (skillMenuRef.current.contains(event.target as Node)) {
        return;
      }
      setIsSkillMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadSkills = async () => {
      const response = await window.desktopRuntime.chat.listSkills();
      if (cancelled || !response.ok) {
        return;
      }
      const normalized = (response.items ?? [])
        .map((entry) => {
          const id = typeof entry.id === "string" ? entry.id.trim() : "";
          if (!id) {
            return null;
          }
          const displayName = typeof entry.display_name === "string" && entry.display_name.trim()
            ? entry.display_name.trim()
            : id;
          return {
            id,
            label: displayName,
            description: `${displayName} 스킬 모드로 시작`
          } satisfies ChatSkillOption;
        })
        .filter((entry): entry is ChatSkillOption => !!entry);
      if (normalized.length > 0) {
        setChatSkillOptions(normalized);
      }
    };
    void loadSkills();
    return () => {
      cancelled = true;
    };
  }, []);

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

  const readSurveyPromptMeta = (message: ChatMessage): SurveyPromptMeta | null => {
    if (message.role !== "assistant") {
      return null;
    }
    const metadata = message.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      return null;
    }
    const row = metadata as Record<string, unknown>;
    const surveyPrompt =
      row.survey_prompt && typeof row.survey_prompt === "object" && !Array.isArray(row.survey_prompt)
        ? (row.survey_prompt as Record<string, unknown>)
        : null;
    if (!surveyPrompt) {
      return null;
    }

    const questionId = typeof surveyPrompt.question_id === "string" ? surveyPrompt.question_id.trim() : "";
    if (!questionId) {
      return null;
    }

    const choices = Array.isArray(surveyPrompt.choices)
      ? surveyPrompt.choices
          .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
          .filter((entry) => !!entry)
      : [];
    if (choices.length === 0) {
      return null;
    }

    const directInputHint =
      typeof surveyPrompt.direct_input_hint === "string" && surveyPrompt.direct_input_hint.trim()
        ? surveyPrompt.direct_input_hint.trim()
        : null;

    return {
      questionId,
      choices,
      directInputHint
    };
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
            const surveyPromptMeta = readSurveyPromptMeta(message);
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
                {surveyPromptMeta ? (
                  <div className="chat-survey-options">
                    {surveyPromptMeta.choices.map((choice) => (
                      <button
                        key={`${message.id}:${choice}`}
                        type="button"
                        className={`chat-survey-option ${isDirectInputChoice(choice) ? "is-direct-input" : ""}`}
                        disabled={isSessionMutating || !selectedSessionId}
                        onClick={() => {
                          if (isDirectInputChoice(choice)) {
                            setChatInput("직접입력: ");
                            return;
                          }
                          void sendMessage({
                            content: choice,
                            uiContext: {
                              source: "workspace-chat",
                              pageId: "scheduler"
                            }
                          });
                        }}
                      >
                        {choice}
                      </button>
                    ))}
                    {surveyPromptMeta.directInputHint ? (
                      <small className="chat-survey-direct-hint">{surveyPromptMeta.directInputHint}</small>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {!selectedSessionId ? <p className="empty">{t("chat.sessionSelector.noSelection")}</p> : null}
      {chatNotice ? <p className="notice">{chatNotice}</p> : null}

      <div className="chat-input-row chat-input-with-skill">
        <div className="chat-skill-picker" ref={skillMenuRef}>
          <button
            type="button"
            className={`chat-skill-plus ${selectedSkill ? "is-active" : ""}`}
            aria-label="Select skill"
            disabled={isSessionMutating || !selectedSessionId}
            onClick={() => setIsSkillMenuOpen((prev) => !prev)}
          >
            +
          </button>
          {isSkillMenuOpen ? (
            <div className="chat-skill-menu">
              {chatSkillOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`chat-skill-menu-item ${selectedSkillTrigger === option.id ? "is-selected" : ""}`}
                  onClick={() => {
                    setSelectedSkillTrigger(option.id);
                    setIsSkillMenuOpen(false);
                  }}
                >
                  <strong>{option.label}</strong>
                  <span>{option.description}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {selectedSkill ? (
          <button
            type="button"
            className="chat-skill-chip"
            title="Clear selected skill"
            onClick={() => setSelectedSkillTrigger(null)}
          >
            {selectedSkill.label} ×
          </button>
        ) : null}
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
              ...(selectedSkillTrigger ? { skillTrigger: selectedSkillTrigger } : {}),
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
