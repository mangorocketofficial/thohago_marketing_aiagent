import type { SchedulerViewMode } from "./date-window";

export type SchedulerFilterState = {
  campaignId: "all" | "adhoc" | string;
  channel: "all" | "instagram" | "threads" | "naver_blog" | "facebook" | "youtube";
  status: "all" | "scheduled" | "generating" | "pending_approval" | "approved" | "published" | "skipped" | "failed";
};

type CampaignSummary = {
  id: string;
  title: string;
};

type SchedulerFiltersProps = {
  viewMode: SchedulerViewMode;
  currentDateKey: string;
  filters: SchedulerFilterState;
  campaigns: CampaignSummary[];
  isLoading: boolean;
  connectionState: "online" | "reconnecting" | "offline";
  onViewModeChange: (viewMode: SchedulerViewMode) => void;
  onDateShift: (direction: "prev" | "next") => void;
  onJumpToToday: () => void;
  onFiltersChange: (next: SchedulerFilterState) => void;
};

const STATUS_LABEL: Record<SchedulerFilterState["status"], string> = {
  all: "All statuses",
  scheduled: "Scheduled",
  generating: "Generating",
  pending_approval: "Pending Review",
  approved: "Approved",
  published: "Published",
  skipped: "Skipped",
  failed: "Failed"
};

const CONNECTION_LABEL: Record<SchedulerFiltersProps["connectionState"], string> = {
  online: "Live",
  reconnecting: "Reconnecting",
  offline: "Offline"
};

export const SchedulerFilters = ({
  viewMode,
  currentDateKey,
  filters,
  campaigns,
  isLoading,
  connectionState,
  onViewModeChange,
  onDateShift,
  onJumpToToday,
  onFiltersChange
}: SchedulerFiltersProps) => (
  <div className="ui-scheduler-controls">
    <div className="ui-scheduler-controls-row ui-scheduler-controls-row-nav">
      <select
        className="ui-scheduler-select-view"
        aria-label="View mode"
        value={viewMode}
        onChange={(event) => onViewModeChange(event.target.value as SchedulerViewMode)}
      >
        <option value="week">Week</option>
        <option value="month">Month</option>
        <option value="list">List</option>
      </select>

      <button className="ui-scheduler-nav-button" type="button" onClick={() => onDateShift("prev")} disabled={isLoading}>
        Prev
      </button>
      <button className="ui-scheduler-nav-button" type="button" onClick={onJumpToToday} disabled={isLoading}>
        Today
      </button>
      <button className="ui-scheduler-nav-button" type="button" onClick={() => onDateShift("next")} disabled={isLoading}>
        Next
      </button>
    </div>

    <div className="ui-scheduler-controls-row ui-scheduler-controls-row-filters">
      <select
        className="ui-scheduler-select-campaign"
        aria-label="Campaign filter"
        value={filters.campaignId}
        onChange={(event) =>
          onFiltersChange({
            ...filters,
            campaignId: event.target.value as SchedulerFilterState["campaignId"]
          })
        }
      >
        <option value="all">All campaigns</option>
        <option value="adhoc">Ad-hoc only</option>
        {campaigns.map((campaign) => (
          <option key={campaign.id} value={campaign.id}>
            {campaign.title}
          </option>
        ))}
      </select>

      <select
        className="ui-scheduler-select-channel"
        aria-label="Channel filter"
        value={filters.channel}
        onChange={(event) =>
          onFiltersChange({
            ...filters,
            channel: event.target.value as SchedulerFilterState["channel"]
          })
        }
      >
        <option value="all">All channels</option>
        <option value="instagram">Instagram</option>
        <option value="threads">Threads</option>
        <option value="naver_blog">Naver Blog</option>
        <option value="facebook">Facebook</option>
        <option value="youtube">YouTube</option>
      </select>

      <select
        className="ui-scheduler-select-status"
        aria-label="Status filter"
        value={filters.status}
        onChange={(event) =>
          onFiltersChange({
            ...filters,
            status: event.target.value as SchedulerFilterState["status"]
          })
        }
      >
        {Object.keys(STATUS_LABEL).map((status) => (
          <option key={status} value={status}>
            {STATUS_LABEL[status as SchedulerFilterState["status"]]}
          </option>
        ))}
      </select>
    </div>

    <div className="ui-scheduler-controls-row ui-scheduler-controls-row-meta">
      <p className="ui-scheduler-window-label">{currentDateKey}</p>
      <span className={`ui-connection-pill is-${connectionState}`}>{CONNECTION_LABEL[connectionState]}</span>
      {isLoading ? <span className="ui-scheduler-loading">Loading...</span> : null}
    </div>
  </div>
);
