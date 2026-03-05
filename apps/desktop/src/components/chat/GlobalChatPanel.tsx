import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "@repo/types";
import { useChatContext } from "../../context/ChatContext";
import { useNavigation } from "../../context/NavigationContext";
import { useSessionSelector } from "../../context/SessionSelectorContext";
import { BlogGenerationCard, readBlogGenerationCardMeta } from "./BlogGenerationCard";
import { InstagramGenerationCard, readInstagramGenerationCardMeta } from "./InstagramGenerationCard";

const PANEL_DEFAULT_WIDTH = 360;
const PANEL_MIN_WIDTH = 280;
const PANEL_MAX_WIDTH = 560;
const WIDTH_STORAGE_KEY = "ddohago:globalChatWidth";
const COLLAPSED_STORAGE_KEY = "ddohago:globalChatCollapsed";
const DIRECT_INPUT_CHOICE = "직접 입력";

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

const isDirectInputChoice = (value: string): boolean => value.trim() === DIRECT_INPUT_CHOICE;

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

export const GlobalChatPanel = () => {
  const { activePage, navigate } = useNavigation();
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
  const [isSkillMenuOpen, setIsSkillMenuOpen] = useState(false);
  const [selectedSkillTrigger, setSelectedSkillTrigger] = useState<string | null>(null);
  const [chatSkillOptions, setChatSkillOptions] = useState<ChatSkillOption[]>(DEFAULT_CHAT_SKILL_OPTIONS);
  const [pendingBlogTopic, setPendingBlogTopic] = useState("");
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const skillMenuRef = useRef<HTMLDivElement | null>(null);

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

  const selectedSkill = useMemo(
    () => chatSkillOptions.find((entry) => entry.id === selectedSkillTrigger) ?? null,
    [chatSkillOptions, selectedSkillTrigger]
  );
  const latestBlogGeneration = useMemo(() => {
    for (let index = timelineMessages.length - 1; index >= 0; index -= 1) {
      const parsed = readBlogGenerationCardMeta(timelineMessages[index]);
      if (parsed) {
        return parsed;
      }
    }
    return null;
  }, [timelineMessages]);
  const isBlogGenerationLoading =
    isActionPending &&
    (selectedSkillTrigger === "naverblog_generation" || selectedSession?.state?.active_skill === "naverblog_generation");

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
          const displayName =
            typeof entry.display_name === "string" && entry.display_name.trim() ? entry.display_name.trim() : id;
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

  useEffect(() => {
    const node = timelineRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [selectedSessionId, timelineMessages.length]);

  useEffect(() => {
    if (!latestBlogGeneration) {
      return;
    }
    setPendingBlogTopic("");
  }, [latestBlogGeneration]);

  if (isCollapsed) {
    return (
      <aside className="ui-global-chat-collapsed">
        <button type="button" onClick={() => setIsCollapsed(false)} aria-label="Open chat panel">
          {"<"}
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
              {">"}
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
          {isBlogGenerationLoading ? (
            <div className="chat-item chat-assistant chat-blog-generation-loading">
              <p>네이버 블로그 글 생성 중...</p>
              <small>주제: {pendingBlogTopic || "요청 처리 중"}</small>
            </div>
          ) : null}
          {timelineMessages.map((message) => {
            const surveyPromptMeta = readSurveyPromptMeta(message);
            const blogGenerationMeta = readBlogGenerationCardMeta(message);
            const instagramGenerationMeta = readInstagramGenerationCardMeta(message);
            return (
              <div key={message.id} className={`chat-item chat-${message.role}`}>
                {blogGenerationMeta ? (
                  <BlogGenerationCard
                    meta={blogGenerationMeta}
                    onOpenEditor={(contentId) =>
                      navigate("scheduler", {
                        workspaceHandoff: {
                          focusContentId: contentId
                        }
                      })
                    }
                  />
                ) : instagramGenerationMeta ? (
                  <InstagramGenerationCard
                    meta={instagramGenerationMeta}
                    onOpenEditor={(contentId) =>
                      navigate("scheduler", {
                        workspaceHandoff: {
                          focusContentId: contentId
                        }
                      })
                    }
                  />
                ) : (
                  <p>{message.content || "-"}</p>
                )}
                {surveyPromptMeta ? (
                  <div className="chat-survey-options">
                    {surveyPromptMeta.choices.map((choice) => (
                      <button
                        key={`${message.id}:${surveyPromptMeta.questionId}:${choice}`}
                        type="button"
                        className={`chat-survey-option ${isDirectInputChoice(choice) ? "is-direct-input" : ""}`}
                        disabled={isUiBusy || !selectedSessionId}
                        onClick={() => {
                          if (isDirectInputChoice(choice)) {
                            setChatInput("직접입력: ");
                            return;
                          }
                          void sendMessage({
                            content: choice,
                            uiContext: {
                              source: "global-chat-panel",
                              pageId: activePage
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
          })}
        </div>

        <div className="chat-input-row chat-input-with-skill">
          <div className="chat-skill-picker" ref={skillMenuRef}>
            <button
              type="button"
              className={`chat-skill-plus ${selectedSkill ? "is-active" : ""}`}
              aria-label="Select skill"
              disabled={isUiBusy || !selectedSessionId}
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
            placeholder="Type a message..."
            disabled={isUiBusy || !selectedSessionId}
          />
          <button
            className="primary"
            disabled={isUiBusy || !selectedSessionId || !chatInput.trim()}
            onClick={() => {
              const prompt = chatInput.trim();
              if (!prompt) {
                return;
              }

              if (selectedSkillTrigger === "naverblog_generation" || selectedSession?.state?.active_skill === "naverblog_generation") {
                setPendingBlogTopic(prompt.slice(0, 90));
              }

              void sendMessage({
                ...(selectedSkillTrigger ? { skillTrigger: selectedSkillTrigger } : {}),
                uiContext: {
                  source: "global-chat-panel",
                  pageId: activePage
                }
              });
            }}
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
