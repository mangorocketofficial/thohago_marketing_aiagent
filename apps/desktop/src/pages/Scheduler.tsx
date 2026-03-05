import { useEffect, useMemo, useState } from "react";
import type { Content } from "@repo/types";
import { useChatContext } from "../context/ChatContext";
import { useNavigation } from "../context/NavigationContext";
import { ContentEditor } from "../components/scheduler/ContentEditor";
import { SchedulerBoard } from "../components/scheduler/SchedulerBoard";
import { formatDateKey, resolveSlotStatus, type SlotStatus } from "../components/scheduler/status-model";

type ScheduledContentItem = Awaited<
  ReturnType<Window["desktopRuntime"]["chat"]["listScheduledContent"]>
>["items"][number];

const isSlotStatus = (value: unknown): value is SlotStatus =>
  value === "scheduled" ||
  value === "generating" ||
  value === "pending_approval" ||
  value === "approved" ||
  value === "published" ||
  value === "skipped" ||
  value === "failed";

const getScheduledSlotStatus = (item: ScheduledContentItem, content: Content): SlotStatus => {
  if (isSlotStatus(item.slot_status)) {
    return item.slot_status;
  }
  return resolveSlotStatus({
    contentStatus: content.status,
    workflowStatus: item.workflow_status ?? undefined
  });
};

export const SchedulerPage = () => {
  const {
    pendingContents,
    pendingContentWorkflowHints,
    selectedSessionId,
    isActionPending,
    dispatchCardAction,
    setChatInput
  } = useChatContext();
  const { workspaceHandoff, clearWorkspaceHandoff } = useNavigation();

  const [viewMode, setViewMode] = useState<"week" | "list">("week");
  const [statusFilter, setStatusFilter] = useState<"all" | "review" | "scheduled">("all");
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null);
  const [scheduledItems, setScheduledItems] = useState<ScheduledContentItem[]>([]);
  const [scheduleNotice, setScheduleNotice] = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const response = await window.desktopRuntime.chat.listScheduledContent({ limit: 300 });
      if (cancelled) {
        return;
      }

      if (!response.ok) {
        setScheduleNotice(response.message ?? "Failed to load scheduled content.");
        return;
      }

      setScheduleNotice("");
      setScheduledItems(response.items ?? []);
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [pendingContents.length]);

  const schedulerItems = useMemo(() => {
    const byId = new Map<
      string,
      {
        content: Content;
        workflowHint: (typeof pendingContentWorkflowHints)[string] | null;
        slotStatus: SlotStatus;
        dateKey: string;
      }
    >();

    for (const raw of scheduledItems) {
      if (!raw.content?.id) {
        continue;
      }
      const content = raw.content;
      const workflowHint = pendingContentWorkflowHints[content.id] ?? null;
      byId.set(content.id, {
        content,
        workflowHint,
        slotStatus: getScheduledSlotStatus(raw, content),
        dateKey: raw.scheduled_date || formatDateKey(content.scheduled_at || content.created_at)
      });
    }

    for (const content of pendingContents) {
      if (byId.has(content.id)) {
        continue;
      }
      const workflowHint = pendingContentWorkflowHints[content.id] ?? null;
      byId.set(content.id, {
        content,
        workflowHint,
        slotStatus: resolveSlotStatus({
          contentStatus: content.status,
          workflowStatus: workflowHint?.workflowStatus
        }),
        dateKey: formatDateKey(content.scheduled_at || content.created_at)
      });
    }

    return [...byId.values()].sort((left, right) => {
      if (left.dateKey === right.dateKey) {
        return right.content.created_at.localeCompare(left.content.created_at);
      }
      return left.dateKey.localeCompare(right.dateKey);
    });
  }, [pendingContentWorkflowHints, pendingContents, scheduledItems]);

  const filteredItems = useMemo(() => {
    if (statusFilter === "review") {
      return schedulerItems.filter((item) => item.slotStatus === "pending_approval");
    }
    if (statusFilter === "scheduled") {
      return schedulerItems.filter((item) => item.slotStatus === "scheduled");
    }
    return schedulerItems;
  }, [schedulerItems, statusFilter]);

  const selectedItem = useMemo(() => {
    if (!selectedContentId) {
      return null;
    }
    return filteredItems.find((item) => item.content.id === selectedContentId) ?? null;
  }, [filteredItems, selectedContentId]);

  useEffect(() => {
    if (!selectedContentId) {
      return;
    }
    if (filteredItems.some((item) => item.content.id === selectedContentId)) {
      return;
    }
    setSelectedContentId(null);
  }, [filteredItems, selectedContentId]);

  useEffect(() => {
    if (!workspaceHandoff?.focusWorkflowItemId) {
      return;
    }

    const workflowItemId = workspaceHandoff.focusWorkflowItemId.trim();
    if (!workflowItemId) {
      clearWorkspaceHandoff();
      return;
    }

    const target = filteredItems.find((item) => item.workflowHint?.workflowItemId === workflowItemId);
    if (target) {
      setSelectedContentId(target.content.id);
    }
    clearWorkspaceHandoff();
  }, [clearWorkspaceHandoff, filteredItems, workspaceHandoff]);

  const handleCreateContent = () => {
    setChatInput("Create content for today.");
    window.dispatchEvent(new CustomEvent("ui:open-global-chat"));
  };

  return (
    <div className="app-shell ui-page-shell">
      <section className="panel ui-page-panel ui-scheduler-shell">
        <div className="ui-scheduler-head">
          <div>
            <p className="eyebrow">Scheduler</p>
            <h1>Scheduler</h1>
            <p className="description">Daily management board for scheduled content and approvals.</p>
          </div>

          <div className="ui-scheduler-controls">
            <select value={viewMode} onChange={(event) => setViewMode(event.target.value as "week" | "list")}>
              <option value="week">Week</option>
              <option value="list">List</option>
            </select>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "all" | "review" | "scheduled")}
            >
              <option value="all">All</option>
              <option value="review">Pending Review</option>
              <option value="scheduled">Scheduled</option>
            </select>
          </div>
        </div>

        {scheduleNotice ? <p className="notice">{scheduleNotice}</p> : null}

        {!selectedItem ? (
          <SchedulerBoard
            items={filteredItems}
            selectedContentId={selectedContentId}
            viewMode={viewMode}
            onSelectContent={setSelectedContentId}
            onCreateContent={handleCreateContent}
          />
        ) : (
          <ContentEditor
            content={selectedItem.content}
            workflowHint={selectedItem.workflowHint}
            slotStatus={selectedItem.slotStatus}
            selectedSessionId={selectedSessionId}
            isActionPending={isActionPending}
            onBack={() => setSelectedContentId(null)}
            onSubmitAction={(payload) => dispatchCardAction(payload)}
          />
        )}
      </section>
    </div>
  );
};
