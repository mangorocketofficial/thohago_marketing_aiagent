import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChatContext } from "../context/ChatContext";
import { useNavigation } from "../context/NavigationContext";
import { ContentEditor } from "../components/scheduler/ContentEditor";
import { DayDetailDrawer } from "../components/scheduler/DayDetailDrawer";
import { SchedulerBoard } from "../components/scheduler/SchedulerBoard";
import { SchedulerFilters } from "../components/scheduler/SchedulerFilters";
import type { ScheduledContentItem } from "./scheduler/scheduler-helpers";
import { useSchedulerRemoteData } from "./scheduler/useSchedulerRemoteData";
import { useSchedulerViewModel } from "./scheduler/useSchedulerViewModel";

const sortDayItems = (items: ScheduledContentItem[]): ScheduledContentItem[] => {
  return [...items].sort((left, right) => {
    const timeCompare = (left.scheduled_time ?? "").localeCompare(right.scheduled_time ?? "");
    if (timeCompare !== 0) {
      return timeCompare;
    }
    return left.slot_id.localeCompare(right.slot_id);
  });
};

const mergeDayItems = (prev: ScheduledContentItem[], next: ScheduledContentItem[]): ScheduledContentItem[] => {
  const byId = new Map<string, ScheduledContentItem>();
  for (const row of prev) {
    byId.set(row.slot_id, row);
  }
  for (const row of next) {
    const current = byId.get(row.slot_id);
    if (!current || row.updated_at > current.updated_at) {
      byId.set(row.slot_id, row);
    }
  }
  return sortDayItems([...byId.values()]);
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

  const remote = useSchedulerRemoteData(pendingContents.length);
  const viewModel = useSchedulerViewModel({
    scheduledItems: remote.scheduledItems,
    pendingContents,
    pendingContentWorkflowHints,
    activeWindow: remote.activeWindow,
    filters: remote.filters,
    workspaceHandoff,
    clearWorkspaceHandoff
  });

  const [dayDetailDate, setDayDetailDate] = useState<string | null>(null);
  const [dayDetailItems, setDayDetailItems] = useState<ScheduledContentItem[]>([]);
  const [dayDetailCursor, setDayDetailCursor] = useState<string | null>(null);
  const [dayDetailHasMore, setDayDetailHasMore] = useState(false);
  const [dayDetailLoading, setDayDetailLoading] = useState(false);
  const dayDetailRequestRef = useRef(0);

  const scheduleNotice = useMemo(() => {
    if (remote.isOffline) {
      return "Offline mode: showing last synced scheduler data.";
    }
    return remote.scheduleNotice;
  }, [remote.isOffline, remote.scheduleNotice]);

  const closeDayDetail = useCallback(() => {
    setDayDetailDate(null);
    setDayDetailItems([]);
    setDayDetailCursor(null);
    setDayDetailHasMore(false);
    setDayDetailLoading(false);
  }, []);

  useEffect(() => {
    if (remote.viewMode !== "month") {
      closeDayDetail();
    }
  }, [closeDayDetail, remote.viewMode]);

  const openDayDetail = useCallback(
    async (dateKey: string) => {
      const requestId = dayDetailRequestRef.current + 1;
      dayDetailRequestRef.current = requestId;
      setDayDetailDate(dateKey);
      setDayDetailItems([]);
      setDayDetailCursor(null);
      setDayDetailHasMore(false);
      setDayDetailLoading(true);

      const response = await remote.loadDayItems({
        date: dateKey,
        limit: 120
      });

      if (requestId !== dayDetailRequestRef.current) {
        return;
      }

      if (!response.ok) {
        setDayDetailLoading(false);
        return;
      }

      setDayDetailItems(sortDayItems(response.items ?? []));
      setDayDetailCursor(response.page.next_cursor ?? null);
      setDayDetailHasMore(response.page.has_more === true);
      setDayDetailLoading(false);
    },
    [remote]
  );

  const loadMoreDayDetail = useCallback(async () => {
    if (!dayDetailDate || !dayDetailCursor || dayDetailLoading) {
      return;
    }

    const requestId = dayDetailRequestRef.current + 1;
    dayDetailRequestRef.current = requestId;
    setDayDetailLoading(true);

    const response = await remote.loadDayItems({
      date: dayDetailDate,
      cursor: dayDetailCursor,
      limit: 120
    });

    if (requestId !== dayDetailRequestRef.current) {
      return;
    }

    if (!response.ok) {
      setDayDetailLoading(false);
      return;
    }

    setDayDetailItems((prev) => mergeDayItems(prev, response.items ?? []));
    setDayDetailCursor(response.page.next_cursor ?? null);
    setDayDetailHasMore(response.page.has_more === true);
    setDayDetailLoading(false);
  }, [dayDetailCursor, dayDetailDate, dayDetailLoading, remote]);

  const handleRescheduleSlot = useCallback(
    (params: { slotId: string; targetDate: string }) => {
      void (async () => {
        const response = await remote.rescheduleSlot({
          slotId: params.slotId,
          targetDate: params.targetDate
        });

        if (!response.ok || !dayDetailDate) {
          return;
        }

        if (params.targetDate !== dayDetailDate || response.window.moved_out_of_active_window) {
          setDayDetailItems((prev) => prev.filter((item) => item.slot_id !== params.slotId));
          return;
        }

        if (!response.slot) {
          return;
        }

        setDayDetailItems((prev) =>
          sortDayItems(
            prev.map((item) =>
              item.slot_id === params.slotId
                ? {
                    ...item,
                    scheduled_date: response.slot!.scheduled_date,
                    scheduled_time: response.slot!.scheduled_time,
                    slot_status: response.slot!.slot_status,
                    channel: response.slot!.channel,
                    content_type: response.slot!.content_type,
                    campaign_id: response.slot!.campaign_id,
                    workflow_item_id: response.slot!.workflow_item_id,
                    content_id: response.slot!.content_id,
                    session_id: response.slot!.session_id,
                    title: response.slot!.title,
                    metadata: response.slot!.metadata,
                    updated_at: response.slot!.updated_at
                  }
                : item
            )
          )
        );
      })();
    },
    [dayDetailDate, remote]
  );

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
          </div>

          <SchedulerFilters
            viewMode={remote.viewMode}
            currentDateKey={`${remote.activeWindow.startDate} -> ${remote.activeWindow.endDate}`}
            filters={remote.filters}
            campaigns={remote.campaignSummaries}
            isLoading={remote.isLoading || remote.isLoadingMore || remote.isRescheduling}
            connectionState={remote.connectionState}
            onViewModeChange={remote.setViewMode}
            onDateShift={remote.shiftCurrentDate}
            onJumpToToday={remote.jumpToToday}
            onFiltersChange={remote.setFilters}
          />
        </div>

        {scheduleNotice ? <p className="notice">{scheduleNotice}</p> : null}

        {!viewModel.selectedItem ? (
          <>
            <SchedulerBoard
              items={viewModel.schedulerItems}
              selectedContentId={viewModel.selectedContentId}
              viewMode={remote.viewMode}
              windowStartDate={remote.activeWindow.startDate}
              isRescheduling={remote.isRescheduling}
              onSelectContent={(contentId) => {
                viewModel.setSelectedContentId(contentId);
                closeDayDetail();
              }}
              onOpenDayDetail={(dateKey) => {
                void openDayDetail(dateKey);
              }}
              onRescheduleSlot={handleRescheduleSlot}
              onCreateContent={handleCreateContent}
            />
            {remote.viewMode === "list" && remote.hasMore ? (
              <div className="button-row">
                <button type="button" onClick={() => void remote.loadMore()} disabled={remote.isLoadingMore || remote.isOffline}>
                  {remote.isLoadingMore ? "Loading..." : "Load more"}
                </button>
              </div>
            ) : null}

            <DayDetailDrawer
              isOpen={remote.viewMode === "month" && !!dayDetailDate}
              dateKey={dayDetailDate}
              items={dayDetailItems}
              isLoading={dayDetailLoading}
              hasMore={dayDetailHasMore}
              isOffline={remote.isOffline}
              onClose={closeDayDetail}
              onLoadMore={() => {
                void loadMoreDayDetail();
              }}
              onSelectContent={(contentId) => viewModel.setSelectedContentId(contentId)}
            />
          </>
        ) : (
          <ContentEditor
            content={viewModel.selectedItem.content}
            workflowHint={viewModel.selectedItem.workflowHint}
            slotStatus={viewModel.selectedItem.slotStatus}
            selectedSessionId={selectedSessionId}
            isActionPending={isActionPending}
            onBack={() => viewModel.setSelectedContentId(null)}
            onSubmitAction={(payload) => dispatchCardAction(payload)}
          />
        )}
      </section>
    </div>
  );
};
