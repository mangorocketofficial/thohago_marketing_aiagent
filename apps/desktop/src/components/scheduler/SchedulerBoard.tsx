import type { Content } from "@repo/types";
import type { WorkflowLinkHint } from "../../context/ChatContext";
import { SLOT_STATUS_LABEL, type SlotStatus } from "./status-model";

type SchedulerBoardItem = {
  content: Content;
  workflowHint: WorkflowLinkHint | null;
  slotStatus: SlotStatus;
  dateKey: string;
};

type SchedulerBoardProps = {
  items: SchedulerBoardItem[];
  selectedContentId: string | null;
  viewMode: "week" | "list";
  onSelectContent: (contentId: string) => void;
  onCreateContent: () => void;
};

const formatDateLabel = (dateKey: string): string => {
  const parsed = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return dateKey;
  }
  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
};

const weekdayColumns = (): string[] => {
  const today = new Date();
  const day = today.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);

  const columns: string[] = [];
  for (let index = 0; index < 7; index += 1) {
    const next = new Date(monday);
    next.setDate(monday.getDate() + index);
    columns.push(next.toISOString().slice(0, 10));
  }
  return columns;
};

const renderCard = (params: {
  item: SchedulerBoardItem;
  isSelected: boolean;
  onSelectContent: (contentId: string) => void;
}) => {
  const { item, isSelected, onSelectContent } = params;
  const title = item.content.body?.trim() ? item.content.body.slice(0, 72) : "(No body)";

  return (
    <button
      key={item.content.id}
      type="button"
      className={`ui-scheduler-card ${isSelected ? "is-selected" : ""}`}
      onClick={() => onSelectContent(item.content.id)}
    >
      <span className="ui-scheduler-card-head">
        <strong>{item.content.channel}</strong>
        <span className={`ui-slot-badge is-${item.slotStatus}`}>{SLOT_STATUS_LABEL[item.slotStatus]}</span>
      </span>
      <span className="ui-scheduler-card-body">{title}</span>
      <span className="ui-scheduler-card-meta">{item.content.content_type}</span>
    </button>
  );
};

export const SchedulerBoard = ({
  items,
  selectedContentId,
  viewMode,
  onSelectContent,
  onCreateContent
}: SchedulerBoardProps) => {
  if (viewMode === "list") {
    return (
      <section className="ui-scheduler-board">
        <div className="ui-scheduler-toolbar">
          <h2>Scheduler Board</h2>
          <button type="button" className="primary" onClick={onCreateContent}>
            + Content
          </button>
        </div>
        <div className="ui-scheduler-list">
          {items.length === 0 ? <p className="empty">No scheduled content yet.</p> : null}
          {items.map((item) =>
            renderCard({
              item,
              isSelected: selectedContentId === item.content.id,
              onSelectContent
            })
          )}
        </div>
      </section>
    );
  }

  const columns = weekdayColumns();

  return (
    <section className="ui-scheduler-board">
      <div className="ui-scheduler-toolbar">
        <h2>Scheduler Board</h2>
        <button type="button" className="primary" onClick={onCreateContent}>
          + Content
        </button>
      </div>

      <div className="ui-scheduler-week-grid">
        {columns.map((dateKey) => {
          const dayItems = items.filter((item) => item.dateKey === dateKey);
          return (
            <article key={dateKey} className="ui-scheduler-day-column">
              <header>
                <strong>{formatDateLabel(dateKey)}</strong>
              </header>
              <div className="ui-scheduler-day-list">
                {dayItems.length === 0 ? <p className="empty">-</p> : null}
                {dayItems.map((item) =>
                  renderCard({
                    item,
                    isSelected: selectedContentId === item.content.id,
                    onSelectContent
                  })
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};
