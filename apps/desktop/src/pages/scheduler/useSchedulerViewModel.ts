import { useEffect, useMemo, useState } from "react";
import type { Content } from "@repo/types";
import type { WorkflowLinkHint } from "../../context/ChatContext";
import { formatDateKey, resolveSlotStatus, type SlotStatus } from "../../components/scheduler/status-model";
import type { SchedulerFilterState } from "../../components/scheduler/SchedulerFilters";
import type { ScheduledContentItem } from "./scheduler-helpers";

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

type SchedulerItem = {
  content: Content;
  workflowHint: WorkflowLinkHint | null;
  slotStatus: SlotStatus;
  dateKey: string;
  scheduledTime: string | null;
};

type SchedulerViewModelParams = {
  scheduledItems: ScheduledContentItem[];
  pendingContents: Content[];
  pendingContentWorkflowHints: Record<string, WorkflowLinkHint>;
  activeWindow: { startDate: string; endDate: string };
  filters: SchedulerFilterState;
  workspaceHandoff: { focusWorkflowItemId?: string } | null;
  clearWorkspaceHandoff: () => void;
};

export const useSchedulerViewModel = ({
  scheduledItems,
  pendingContents,
  pendingContentWorkflowHints,
  activeWindow,
  filters,
  workspaceHandoff,
  clearWorkspaceHandoff
}: SchedulerViewModelParams): {
  schedulerItems: SchedulerItem[];
  selectedItem: SchedulerItem | null;
  selectedContentId: string | null;
  setSelectedContentId: (contentId: string | null) => void;
} => {
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null);

  const schedulerItems = useMemo(() => {
    const withinWindow = (dateKey: string): boolean => dateKey >= activeWindow.startDate && dateKey <= activeWindow.endDate;
    const matchesStatus = (slotStatus: SlotStatus): boolean => (filters.status === "all" ? true : slotStatus === filters.status);
    const matchesChannel = (channel: string): boolean =>
      filters.channel === "all" ? true : channel.toLowerCase() === filters.channel;
    const matchesCampaign = (campaignId: string | null): boolean => {
      if (filters.campaignId === "all") {
        return true;
      }
      if (filters.campaignId === "adhoc") {
        return !campaignId;
      }
      return campaignId === filters.campaignId;
    };

    const byId = new Map<string, SchedulerItem>();

    for (const raw of scheduledItems) {
      if (!raw.content?.id) {
        continue;
      }
      const content = raw.content;
      const workflowHint = pendingContentWorkflowHints[content.id] ?? null;
      const slotStatus = getScheduledSlotStatus(raw, content);
      const dateKey = raw.scheduled_date || formatDateKey(content.scheduled_at || content.created_at);
      if (!withinWindow(dateKey)) {
        continue;
      }
      if (!matchesStatus(slotStatus) || !matchesChannel(content.channel) || !matchesCampaign(raw.campaign_id ?? content.campaign_id)) {
        continue;
      }
      byId.set(content.id, {
        content,
        workflowHint,
        slotStatus,
        dateKey,
        scheduledTime: raw.scheduled_time || content.scheduled_at || null
      });
    }

    for (const content of pendingContents) {
      if (byId.has(content.id)) {
        continue;
      }
      const workflowHint = pendingContentWorkflowHints[content.id] ?? null;
      const slotStatus = resolveSlotStatus({
        contentStatus: content.status,
        workflowStatus: workflowHint?.workflowStatus
      });
      const dateKey = formatDateKey(content.scheduled_at || content.created_at);
      if (!withinWindow(dateKey)) {
        continue;
      }
      if (!matchesStatus(slotStatus) || !matchesChannel(content.channel) || !matchesCampaign(content.campaign_id)) {
        continue;
      }
      byId.set(content.id, {
        content,
        workflowHint,
        slotStatus,
        dateKey,
        scheduledTime: content.scheduled_at || null
      });
    }

    return [...byId.values()].sort((left, right) => {
      if (left.dateKey === right.dateKey) {
        return (left.scheduledTime ?? "").localeCompare(right.scheduledTime ?? "");
      }
      return left.dateKey.localeCompare(right.dateKey);
    });
  }, [
    activeWindow.endDate,
    activeWindow.startDate,
    filters.campaignId,
    filters.channel,
    filters.status,
    pendingContentWorkflowHints,
    pendingContents,
    scheduledItems
  ]);

  const selectedItem = useMemo(() => {
    if (!selectedContentId) {
      return null;
    }
    return schedulerItems.find((item) => item.content.id === selectedContentId) ?? null;
  }, [schedulerItems, selectedContentId]);

  useEffect(() => {
    if (!selectedContentId) {
      return;
    }
    if (schedulerItems.some((item) => item.content.id === selectedContentId)) {
      return;
    }
    setSelectedContentId(null);
  }, [schedulerItems, selectedContentId]);

  useEffect(() => {
    if (!workspaceHandoff?.focusWorkflowItemId) {
      return;
    }
    const workflowItemId = workspaceHandoff.focusWorkflowItemId.trim();
    if (!workflowItemId) {
      clearWorkspaceHandoff();
      return;
    }
    const target = schedulerItems.find((item) => item.workflowHint?.workflowItemId === workflowItemId);
    if (target) {
      setSelectedContentId(target.content.id);
    }
    clearWorkspaceHandoff();
  }, [clearWorkspaceHandoff, schedulerItems, workspaceHandoff]);

  return {
    schedulerItems,
    selectedItem,
    selectedContentId,
    setSelectedContentId
  };
};
