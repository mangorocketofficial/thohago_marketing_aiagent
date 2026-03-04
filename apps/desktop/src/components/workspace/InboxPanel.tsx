import { useEffect, useMemo, useRef, useState } from "react";
import type { Campaign, Content, WorkflowStatus } from "@repo/types";
import { useTranslation } from "react-i18next";
import { useChatContext } from "../../context/ChatContext";
import { useNavigation } from "../../context/NavigationContext";
import { useSessionSelector } from "../../context/SessionSelectorContext";
import { getWorkflowStatusLabel } from "../../types/workflow";

type InboxPanelProps = {
  formatDateTime: (iso: string | null | undefined) => string;
};

type InboxItem =
  | {
      key: string;
      type: "campaign";
      createdAt: string;
      campaign: Campaign;
      workflowItemId: string;
      workflowStatus: WorkflowStatus;
      expectedVersion: number;
      sessionId: string | null;
      displayTitle: string | null;
    }
  | {
      key: string;
      type: "content";
      createdAt: string;
      content: Content;
      workflowItemId: string;
      workflowStatus: WorkflowStatus;
      expectedVersion: number;
      sessionId: string | null;
      displayTitle: string | null;
    };

const compareByCreatedDesc = (left: InboxItem, right: InboxItem): number => right.createdAt.localeCompare(left.createdAt);

export const InboxPanel = ({ formatDateTime }: InboxPanelProps) => {
  const { t } = useTranslation();
  const {
    draftCampaigns,
    pendingContents,
    campaignWorkflowHints,
    pendingContentWorkflowHints,
    selectedSessionId,
    isActionPending,
    dispatchCardAction
  } = useChatContext();
  const { activePage, workspaceHandoff, clearWorkspaceHandoff } = useNavigation();
  const { recentSessions, selectSession } = useSessionSelector();
  const [reasonByItem, setReasonByItem] = useState<Record<string, string>>({});
  const [editOpenByItem, setEditOpenByItem] = useState<Record<string, boolean>>({});
  const [editByItem, setEditByItem] = useState<Record<string, string>>({});
  const [noticeByItem, setNoticeByItem] = useState<Record<string, string>>({});
  const [highlightedWorkflowItemId, setHighlightedWorkflowItemId] = useState<string | null>(null);
  const itemRefByWorkflowItemId = useRef<Record<string, HTMLDivElement | null>>({});
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const inboxItems = useMemo(() => {
    const campaignItems: InboxItem[] = [];
    for (const campaign of draftCampaigns) {
      const hint = campaignWorkflowHints[campaign.id];
      if (!hint || hint.workflowStatus !== "proposed") {
        continue;
      }
      campaignItems.push({
          key: `campaign:${campaign.id}`,
          type: "campaign",
          createdAt: campaign.created_at,
          campaign,
          workflowItemId: hint.workflowItemId,
          workflowStatus: hint.workflowStatus,
          expectedVersion: hint.version,
          sessionId: hint.sessionId,
          displayTitle: hint.displayTitle
      });
    }

    const contentItems: InboxItem[] = [];
    for (const content of pendingContents) {
      const hint = pendingContentWorkflowHints[content.id];
      if (!hint || hint.workflowStatus !== "proposed") {
        continue;
      }
      contentItems.push({
          key: `content:${content.id}`,
          type: "content",
          createdAt: content.created_at,
          content,
          workflowItemId: hint.workflowItemId,
          workflowStatus: hint.workflowStatus,
          expectedVersion: hint.version,
          sessionId: hint.sessionId,
          displayTitle: hint.displayTitle
      });
    }

    return [...campaignItems, ...contentItems].sort(compareByCreatedDesc);
  }, [campaignWorkflowHints, draftCampaigns, pendingContentWorkflowHints, pendingContents]);

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
    if (activePage !== "workspace" || !workspaceHandoff?.focusWorkflowItemId) {
      return;
    }
    const targetWorkflowItemId = workspaceHandoff.focusWorkflowItemId.trim();
    if (!targetWorkflowItemId) {
      clearWorkspaceHandoff();
      return;
    }
    setHighlightedWorkflowItemId(targetWorkflowItemId);
    const targetNode = itemRefByWorkflowItemId.current[targetWorkflowItemId];
    if (targetNode) {
      targetNode.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedWorkflowItemId((current) => (current === targetWorkflowItemId ? null : current));
      highlightTimerRef.current = null;
    }, 2400);
    clearWorkspaceHandoff();
  }, [activePage, clearWorkspaceHandoff, workspaceHandoff]);

  useEffect(() => {
    const handoffSessionId =
      typeof workspaceHandoff?.focusSessionId === "string" && workspaceHandoff.focusSessionId.trim()
        ? workspaceHandoff.focusSessionId.trim()
        : "";
    if (!handoffSessionId) {
      return;
    }
    const nextSession = recentSessions.find((session) => session.id === handoffSessionId);
    if (nextSession) {
      selectSession(nextSession);
    }
  }, [recentSessions, selectSession, workspaceHandoff]);

  const resolveInboxTitle = (item: InboxItem): string => {
    if (item.displayTitle && item.displayTitle.trim()) {
      return item.displayTitle.trim();
    }
    if (item.type === "campaign") {
      return item.campaign.activity_folder?.trim() || item.campaign.title;
    }
    return `${item.content.channel} draft`;
  };

  const submitItemAction = async (params: {
    item: InboxItem;
    actionId: "approve" | "request_revision" | "reject";
    eventType: "campaign_approved" | "campaign_rejected" | "content_approved" | "content_rejected";
    mode?: "revision";
  }) => {
    const reason = (reasonByItem[params.item.key] ?? "").trim();
    if (params.mode === "revision" && !reason) {
      setNoticeByItem((previous) => ({ ...previous, [params.item.key]: "Revision reason is required." }));
      return;
    }

    const sessionId = params.item.sessionId ?? selectedSessionId;
    if (!sessionId) {
      setNoticeByItem((previous) => ({
        ...previous,
        [params.item.key]: "No session context found for this item. Open related chat first."
      }));
      return;
    }

    const basePayload = {
      sessionId,
      workflowItemId: params.item.workflowItemId,
      expectedVersion: params.item.expectedVersion,
      actionId: params.actionId,
      eventType: params.eventType
    } as const;

    setNoticeByItem((previous) => ({ ...previous, [params.item.key]: "" }));

    if (params.item.type === "campaign") {
      await dispatchCardAction({
        ...basePayload,
        campaignId: params.item.campaign.id,
        ...(params.mode === "revision" ? { mode: "revision", reason } : {}),
        ...(params.actionId === "reject" && reason ? { reason } : {})
      });
      return;
    }

    const originalBody = (params.item.content.body ?? "").trim();
    const editedBody = (editByItem[params.item.key] ?? originalBody).trim();
    const hasEditedBody = params.actionId === "approve" && editedBody && editedBody !== originalBody;

    await dispatchCardAction({
      ...basePayload,
      contentId: params.item.content.id,
      ...(params.mode === "revision" ? { mode: "revision", reason } : {}),
      ...(params.actionId === "reject" && reason ? { reason } : {}),
      ...(hasEditedBody ? { editedBody } : {})
    });
  };

  return (
    <aside className="ui-workspace-inbox subpanel">
      <div className="ui-workspace-panel-head">
        <h2>{t("ui.pages.workspace.inboxTitle")}</h2>
        <p className="sub-description">{t("ui.pages.workspace.inboxDescription")}</p>
      </div>

      <div className="queue-list">
        {inboxItems.length === 0 ? (
          <p className="empty">{t("ui.pages.workspace.inboxEmpty")}</p>
        ) : (
          inboxItems.map((item) => {
            const reason = reasonByItem[item.key] ?? "";
            const notice = noticeByItem[item.key] ?? "";
            const isHighlighted = highlightedWorkflowItemId === item.workflowItemId;
            return (
              <div
                key={item.key}
                ref={(node) => {
                  itemRefByWorkflowItemId.current[item.workflowItemId] = node;
                }}
                className={`queue-item ui-workspace-inbox-item ${isHighlighted ? "is-handoff-target" : ""}`}
              >
                {item.type === "campaign" ? (
                  <>
                    <div className="queue-meta">
                      <p>
                        <strong>{resolveInboxTitle(item)}</strong>
                      </p>
                      <p>Session: {item.sessionId ?? "-"}</p>
                      <p>Channels: {item.campaign.channels.join(", ") || "-"}</p>
                      <p>
                        Posts: {item.campaign.plan.post_count} / Days: {item.campaign.plan.duration_days}
                      </p>
                      <p>Created: {formatDateTime(item.campaign.created_at)}</p>
                    </div>
                    <span className={`queue-badge is-${item.workflowStatus}`}>
                      {getWorkflowStatusLabel(item.workflowStatus)} v{item.expectedVersion}
                    </span>
                  </>
                ) : (
                  <>
                    <div className="queue-meta">
                      <p>
                        <strong>{resolveInboxTitle(item)}</strong>
                      </p>
                      <p>Session: {item.sessionId ?? "-"}</p>
                      <p>Type: {item.content.channel} | {item.content.content_type}</p>
                      <p>Status: {item.content.status}</p>
                      <p>Campaign: {item.content.campaign_id ?? "-"}</p>
                      <p>Created: {formatDateTime(item.content.created_at)}</p>
                    </div>
                    <span className={`queue-badge is-${item.workflowStatus}`}>
                      {getWorkflowStatusLabel(item.workflowStatus)} v{item.expectedVersion}
                    </span>
                    {item.content.body ? <p className="queue-body">{item.content.body}</p> : null}
                  </>
                )}

                <textarea
                  className="chat-card-reason"
                  placeholder="Optional reason (required for Request Revision)"
                  value={reason}
                  onChange={(event) =>
                    setReasonByItem((previous) => ({ ...previous, [item.key]: event.target.value }))
                  }
                  disabled={isActionPending}
                />

                {item.type === "content" ? (
                  <div className="chat-card-editor-wrap">
                    <button
                      className="chat-card-editor-toggle"
                      onClick={() => {
                        const isOpen = editOpenByItem[item.key] ?? false;
                        setEditOpenByItem((previous) => ({ ...previous, [item.key]: !isOpen }));
                        if (!(item.key in editByItem)) {
                          setEditByItem((previous) => ({ ...previous, [item.key]: item.content.body ?? "" }));
                        }
                      }}
                      disabled={isActionPending}
                    >
                      {editOpenByItem[item.key] ? "Hide Edited Body" : "Edit Body Before Approve"}
                    </button>
                    {editOpenByItem[item.key] ? (
                      <textarea
                        className="chat-card-editor"
                        placeholder="Edit full content body before approval"
                        value={editByItem[item.key] ?? item.content.body ?? ""}
                        onChange={(event) =>
                          setEditByItem((previous) => ({ ...previous, [item.key]: event.target.value }))
                        }
                        disabled={isActionPending}
                      />
                    ) : null}
                  </div>
                ) : null}

                <div className="button-row">
                  <button
                    type="button"
                    className="primary"
                    disabled={isActionPending}
                    onClick={() =>
                      void submitItemAction({
                        item,
                        actionId: "approve",
                        eventType: item.type === "campaign" ? "campaign_approved" : "content_approved"
                      })
                    }
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={isActionPending}
                    onClick={() =>
                      void submitItemAction({
                        item,
                        actionId: "request_revision",
                        eventType: item.type === "campaign" ? "campaign_rejected" : "content_rejected",
                        mode: "revision"
                      })
                    }
                  >
                    Request Revision
                  </button>
                  <button
                    type="button"
                    disabled={isActionPending}
                    onClick={() =>
                      void submitItemAction({
                        item,
                        actionId: "reject",
                        eventType: item.type === "campaign" ? "campaign_rejected" : "content_rejected"
                      })
                    }
                  >
                    Reject
                  </button>
                </div>

                {notice ? <p className="notice">{notice}</p> : null}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
