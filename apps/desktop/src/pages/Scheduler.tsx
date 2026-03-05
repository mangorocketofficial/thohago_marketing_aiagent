import { useMemo } from "react";
import { useChatContext } from "../context/ChatContext";
import { useNavigation } from "../context/NavigationContext";
import { ContentEditor } from "../components/scheduler/ContentEditor";
import { SchedulerBoard } from "../components/scheduler/SchedulerBoard";
import { SchedulerFilters } from "../components/scheduler/SchedulerFilters";
import { useSchedulerRemoteData } from "./scheduler/useSchedulerRemoteData";
import { useSchedulerViewModel } from "./scheduler/useSchedulerViewModel";

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

  const scheduleNotice = useMemo(() => {
    if (remote.isOffline) {
      return "Offline mode: showing last synced scheduler data.";
    }
    return remote.scheduleNotice;
  }, [remote.isOffline, remote.scheduleNotice]);

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

          <SchedulerFilters
            viewMode={remote.viewMode}
            currentDateKey={`${remote.activeWindow.startDate} -> ${remote.activeWindow.endDate}`}
            filters={remote.filters}
            campaigns={remote.campaignSummaries}
            isLoading={remote.isLoading || remote.isLoadingMore}
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
              weekStartDate={remote.activeWindow.startDate}
              onSelectContent={(contentId) => viewModel.setSelectedContentId(contentId)}
              onCreateContent={handleCreateContent}
            />
            {remote.viewMode === "list" && remote.hasMore ? (
              <div className="button-row">
                <button type="button" onClick={() => void remote.loadMore()} disabled={remote.isLoadingMore || remote.isOffline}>
                  {remote.isLoadingMore ? "Loading..." : "Load more"}
                </button>
              </div>
            ) : null}
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
