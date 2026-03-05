import { asString, isSlotStatus, type ScheduledContentItem } from "../../pages/scheduler/scheduler-helpers";
import { SLOT_STATUS_LABEL } from "./status-model";

type DayDetailDrawerProps = {
  isOpen: boolean;
  dateKey: string | null;
  items: ScheduledContentItem[];
  isLoading: boolean;
  hasMore: boolean;
  isOffline: boolean;
  onClose: () => void;
  onLoadMore: () => void;
  onSelectContent: (contentId: string) => void;
};

const resolveRowTitle = (item: ScheduledContentItem): string => {
  const fromBody = item.content?.body?.trim();
  if (fromBody) {
    return fromBody.slice(0, 120);
  }
  const fromTitle = asString(item.title).trim();
  if (fromTitle) {
    return fromTitle.slice(0, 120);
  }
  return "(No body)";
};

export const DayDetailDrawer = ({
  isOpen,
  dateKey,
  items,
  isLoading,
  hasMore,
  isOffline,
  onClose,
  onLoadMore,
  onSelectContent
}: DayDetailDrawerProps) => {
  if (!isOpen || !dateKey) {
    return null;
  }

  return (
    <aside className="ui-scheduler-day-drawer">
      <div className="ui-scheduler-day-drawer-head">
        <div>
          <h3>Day Detail</h3>
          <p className="sub-description">{dateKey}</p>
        </div>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="ui-scheduler-day-drawer-list">
        {items.length === 0 && !isLoading ? <p className="empty">No scheduled items for this day.</p> : null}
        {items.map((item) => {
          const slotStatus = isSlotStatus(item.slot_status) ? item.slot_status : "scheduled";
          const contentId = (item.content?.id ?? item.content_id ?? "").trim();
          return (
            <button
              key={item.slot_id}
              type="button"
              className="ui-scheduler-card"
              disabled={!contentId}
              onClick={() => {
                if (!contentId) {
                  return;
                }
                onSelectContent(contentId);
                onClose();
              }}
            >
              <span className="ui-scheduler-card-head">
                <strong>{item.channel}</strong>
                <span className={`ui-slot-badge is-${slotStatus}`}>{SLOT_STATUS_LABEL[slotStatus]}</span>
              </span>
              <span className="ui-scheduler-card-body">{resolveRowTitle(item)}</span>
              <span className="ui-scheduler-card-meta">{item.content_type}</span>
            </button>
          );
        })}
      </div>

      <div className="button-row">
        <button type="button" onClick={onLoadMore} disabled={!hasMore || isLoading || isOffline}>
          {isLoading ? "Loading..." : hasMore ? "Load more" : "No more"}
        </button>
      </div>
    </aside>
  );
};
