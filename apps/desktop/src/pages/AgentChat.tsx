import { useEffect, useMemo, useRef, useState } from "react";
import {
  isActionCardMessage,
  type ChatActionCardDispatchInput,
  type ChatMessage,
  type WorkflowActionCardMetadata
} from "@repo/types";
import { useNavigation } from "../context/NavigationContext";

type AgentChatPageProps = {
  messages: ChatMessage[];
  chatInput: string;
  chatNotice: string;
  chatConfigMessage: string;
  activeSessionId: string | null;
  isActionPending: boolean;
  formatDateTime: (iso: string | null | undefined) => string;
  onChatInputChange: (value: string) => void;
  onSendMessage: () => void;
  onDispatchCardAction: (payload: Omit<ChatActionCardDispatchInput, "campaignId" | "contentId">) => void;
};

const STATUS_LABEL: Record<string, string> = {
  proposed: "Proposed",
  revision_requested: "Revision Requested",
  approved: "Approved",
  rejected: "Rejected"
};

const toTextArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string" && !!entry.trim());
};

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const renderCampaignDetails = (cardData: Record<string, unknown>) => {
  const channels = toTextArray(cardData.channels);
  const postCount = typeof cardData.post_count === "number" ? cardData.post_count : null;
  const dateRange = toRecord(cardData.date_range);
  const start = typeof dateRange.start === "string" ? dateRange.start : "-";
  const end = typeof dateRange.end === "string" ? dateRange.end : "-";

  return (
    <div className="chat-card-meta">
      <p>Channels: {channels.join(", ") || "-"}</p>
      <p>Posts: {postCount ?? "-"}</p>
      <p>
        Date: {start} ~ {end}
      </p>
    </div>
  );
};

const renderContentDetails = (cardData: Record<string, unknown>) => {
  const channel = typeof cardData.channel === "string" ? cardData.channel : "-";
  const preview = typeof cardData.body_preview === "string" ? cardData.body_preview : "";
  const violations = toTextArray(cardData.forbidden_violations);

  return (
    <div className="chat-card-meta">
      <p>Channel: {channel}</p>
      {preview ? <p className="chat-card-preview">{preview}</p> : null}
      {violations.length > 0 ? (
        <div className="chat-card-chip-row">
          {violations.map((entry) => (
            <span key={entry} className="chat-card-chip">
              {entry}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export const AgentChatPage = ({
  messages,
  chatInput,
  chatNotice,
  chatConfigMessage,
  activeSessionId,
  isActionPending,
  formatDateTime,
  onChatInputChange,
  onSendMessage,
  onDispatchCardAction
}: AgentChatPageProps) => {
  const { activePage, agentChatHandoff, clearAgentChatHandoff } = useNavigation();
  const [collapsedCards, setCollapsedCards] = useState<Record<string, boolean>>({});
  const [reasonByCard, setReasonByCard] = useState<Record<string, string>>({});
  const [editByCard, setEditByCard] = useState<Record<string, string>>({});
  const [editOpenByCard, setEditOpenByCard] = useState<Record<string, boolean>>({});
  const [cardNoticeByCard, setCardNoticeByCard] = useState<Record<string, string>>({});
  const [highlightedCardMessageId, setHighlightedCardMessageId] = useState<string | null>(null);
  const cardElementByMessageIdRef = useRef<Record<string, HTMLDivElement | null>>({});
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const latestVersionByWorkflowItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const message of messages) {
      if (!isActionCardMessage(message)) {
        continue;
      }
      const itemId = message.metadata.workflow_item_id;
      const version = Math.max(1, Math.floor(message.metadata.expected_version));
      const previous = map.get(itemId) ?? 0;
      if (version > previous) {
        map.set(itemId, version);
      }
    }
    return map;
  }, [messages]);

  const latestActionCardMessageByWorkflowItem = useMemo(() => {
    const map = new Map<
      string,
      ChatMessage & { message_type: "action_card"; metadata: WorkflowActionCardMetadata }
    >();
    for (const message of messages) {
      if (!isActionCardMessage(message)) {
        continue;
      }
      const itemId = message.metadata.workflow_item_id;
      const candidateVersion = Math.max(1, Math.floor(message.metadata.expected_version));
      const existing = map.get(itemId);
      if (!existing) {
        map.set(itemId, message);
        continue;
      }
      const existingVersion = Math.max(1, Math.floor(existing.metadata.expected_version));
      if (candidateVersion > existingVersion) {
        map.set(itemId, message);
      } else if (candidateVersion === existingVersion && message.created_at > existing.created_at) {
        map.set(itemId, message);
      }
    }
    return map;
  }, [messages]);

  useEffect(
    () => () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
    },
    []
  );

  useEffect(() => {
    if (activePage !== "agent-chat" || !agentChatHandoff) {
      return;
    }

    const focusWorkflowItemId = agentChatHandoff.focusWorkflowItemId?.trim();
    if (!focusWorkflowItemId) {
      clearAgentChatHandoff();
      return;
    }

    const targetMessage = latestActionCardMessageByWorkflowItem.get(focusWorkflowItemId);
    if (!targetMessage) {
      return;
    }

    setCollapsedCards((prev) => ({
      ...prev,
      [targetMessage.id]: false
    }));

    const targetNode = cardElementByMessageIdRef.current[targetMessage.id];
    if (targetNode) {
      targetNode.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    setHighlightedCardMessageId(targetMessage.id);
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedCardMessageId((current) => (current === targetMessage.id ? null : current));
      highlightTimerRef.current = null;
    }, 2400);

    clearAgentChatHandoff();
  }, [activePage, agentChatHandoff, clearAgentChatHandoff, latestActionCardMessageByWorkflowItem]);

  const toggleCard = (messageId: string) => {
    setCollapsedCards((prev) => ({ ...prev, [messageId]: !prev[messageId] }));
  };

  return (
    <div className="app-shell ui-dashboard-shell">
      <section className="panel">
        <p className="eyebrow">Agent Chat</p>
        <h1>Conversation</h1>
        <p className="description">Realtime assistant conversation and action approvals.</p>
      </section>

      <section className="panel">
        <article className="subpanel">
          {chatConfigMessage ? <p className="notice">{chatConfigMessage}</p> : null}

          <div className="chat-list">
            {messages.length === 0 ? (
              <p className="empty">No chat messages yet.</p>
            ) : (
              messages.map((message) => {
                if (!isActionCardMessage(message)) {
                  return (
                    <div key={message.id} className={`chat-item chat-${message.role}`}>
                      <div className="chat-head">
                        <strong>{message.role}</strong>
                        <span>{formatDateTime(message.created_at)}</span>
                      </div>
                      <p>{message.content}</p>
                    </div>
                  );
                }

                const cardData = toRecord(message.metadata.card_data);
                const title = typeof cardData.title === "string" ? cardData.title : "Action Card";
                const workflowStatus = message.metadata.workflow_status;
                const statusLabel = STATUS_LABEL[workflowStatus] ?? workflowStatus;
                const currentVersion = Math.max(1, Math.floor(message.metadata.expected_version));
                const latestVersion =
                  latestVersionByWorkflowItem.get(message.metadata.workflow_item_id) ?? currentVersion;
                const isLatestVersion = currentVersion >= latestVersion;
                const isResolved = workflowStatus !== "proposed";
                const defaultCollapsed = !isLatestVersion || isResolved;
                const collapsed = collapsedCards[message.id] ?? defaultCollapsed;

                const cardReason = reasonByCard[message.id] ?? "";
                const contentBodyFromCard = typeof cardData.body_full === "string" ? cardData.body_full : "";
                const editedBody = editByCard[message.id] ?? contentBodyFromCard;
                const isEditOpen = editOpenByCard[message.id] ?? false;
                const cardNotice = cardNoticeByCard[message.id] ?? "";
                const isHandoffTarget = highlightedCardMessageId === message.id;

                const onActionClick = (params: {
                  actionId: "approve" | "request_revision" | "reject";
                  eventType: "campaign_approved" | "campaign_rejected" | "content_approved" | "content_rejected";
                  mode?: "revision";
                }) => {
                  const normalizedReason = cardReason.trim();
                  if (params.mode === "revision" && !normalizedReason) {
                    setCardNoticeByCard((prev) => ({ ...prev, [message.id]: "Revision reason is required." }));
                    return;
                  }

                  const normalizedEditedBody = editedBody.trim();
                  const normalizedOriginalBody = contentBodyFromCard.trim();
                  const editedBodyPayload =
                    message.metadata.card_type === "content_draft" &&
                    params.actionId === "approve" &&
                    isEditOpen &&
                    normalizedEditedBody &&
                    normalizedEditedBody !== normalizedOriginalBody
                      ? normalizedEditedBody
                      : undefined;

                  setCardNoticeByCard((prev) => ({ ...prev, [message.id]: "" }));
                  onDispatchCardAction({
                    sessionId: message.metadata.session_id,
                    workflowItemId: message.metadata.workflow_item_id,
                    expectedVersion: currentVersion,
                    actionId: params.actionId,
                    eventType: params.eventType,
                    ...(params.mode === "revision" ? { mode: "revision", reason: normalizedReason } : {}),
                    ...(params.actionId === "reject" && normalizedReason ? { reason: normalizedReason } : {}),
                    ...(editedBodyPayload ? { editedBody: editedBodyPayload } : {})
                  });
                };

                return (
                  <div
                    key={message.id}
                    ref={(node) => {
                      cardElementByMessageIdRef.current[message.id] = node;
                    }}
                    className={`chat-item chat-action-card ${isResolved ? "is-resolved" : ""}${isHandoffTarget ? " is-handoff-target" : ""}`}
                  >
                    <div className="chat-head">
                      <strong>assistant</strong>
                      <span>{formatDateTime(message.created_at)}</span>
                    </div>

                    <div className="chat-card-top">
                      <div>
                        <p className="chat-card-title">{title}</p>
                        <p className="chat-card-subtitle">
                          v{currentVersion} / {statusLabel}
                        </p>
                      </div>
                      <button className="chat-card-toggle" onClick={() => toggleCard(message.id)} disabled={isActionPending}>
                        {collapsed ? "Expand" : "Collapse"}
                      </button>
                    </div>

                    {collapsed ? (
                      <p className="chat-card-collapsed">{message.content || "Action card is collapsed."}</p>
                    ) : (
                      <>
                        {message.metadata.card_type === "campaign_plan"
                          ? renderCampaignDetails(cardData)
                          : renderContentDetails(cardData)}

                        <textarea
                          className="chat-card-reason"
                          placeholder="Optional reason (required for Request Revision)"
                          value={cardReason}
                          onChange={(event) =>
                            setReasonByCard((prev) => ({ ...prev, [message.id]: event.target.value }))
                          }
                          disabled={isActionPending || isResolved}
                        />

                        {message.metadata.card_type === "content_draft" ? (
                          <div className="chat-card-editor-wrap">
                            <button
                              className="chat-card-editor-toggle"
                              onClick={() => {
                                setEditOpenByCard((prev) => ({ ...prev, [message.id]: !isEditOpen }));
                                if (!(message.id in editByCard)) {
                                  setEditByCard((prev) => ({ ...prev, [message.id]: contentBodyFromCard }));
                                }
                              }}
                              disabled={isActionPending || isResolved}
                            >
                              {isEditOpen ? "Hide Edited Body" : "Edit Body Before Approve"}
                            </button>
                            {isEditOpen ? (
                              <textarea
                                className="chat-card-editor"
                                placeholder="Edit full content body before approval"
                                value={editedBody}
                                onChange={(event) =>
                                  setEditByCard((prev) => ({ ...prev, [message.id]: event.target.value }))
                                }
                                disabled={isActionPending || isResolved}
                              />
                            ) : null}
                          </div>
                        ) : null}

                        <div className="button-row">
                          {message.metadata.actions.map((action) => {
                            const actionDisabled =
                              isActionPending || action.disabled === true || !isLatestVersion || isResolved;
                            return (
                              <button
                                key={`${message.id}:${action.id}`}
                                className={action.id === "approve" ? "primary" : ""}
                                disabled={actionDisabled}
                                onClick={() =>
                                  onActionClick({
                                    actionId: action.id,
                                    eventType: action.event_type,
                                    ...(action.mode === "revision" ? { mode: "revision" } : {})
                                  })
                                }
                              >
                                {action.label}
                              </button>
                            );
                          })}
                        </div>

                        {cardNotice ? <p className="notice">{cardNotice}</p> : null}
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {!activeSessionId ? (
            <p className="empty">
              No active session yet. Add a file under an activity folder (example:{" "}
              <code>tanzania-activity/photo01.jpg</code>) or place a file at watch-root.
            </p>
          ) : null}

          <div className="chat-input-row">
            <input
              value={chatInput}
              onChange={(event) => onChatInputChange(event.target.value)}
              placeholder="Type a reply for the assistant..."
              disabled={isActionPending}
            />
            <button className="primary" disabled={isActionPending || !chatInput.trim()} onClick={onSendMessage}>
              Send
            </button>
          </div>

          {chatNotice ? <p className="notice">{chatNotice}</p> : null}
        </article>
      </section>
    </div>
  );
};
