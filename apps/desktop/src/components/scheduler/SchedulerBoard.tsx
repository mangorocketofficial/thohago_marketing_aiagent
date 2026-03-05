import type { DragEvent } from "react";
import type { Content } from "@repo/types";
import type { WorkflowLinkHint } from "../../context/ChatContext";
import { SLOT_STATUS_LABEL, type SlotStatus } from "./status-model";

type SchedulerBoardItem = {
  slotId: string | null;
  content: Content;
  workflowHint: WorkflowLinkHint | null;
  slotStatus: SlotStatus;
  dateKey: string;
  scheduledTime: string | null;
};

type SchedulerBoardProps = {
  items: SchedulerBoardItem[];
  selectedContentId: string | null;
  viewMode: "week" | "month" | "list";
  windowStartDate: string;
  isRescheduling: boolean;
  onSelectContent: (contentId: string) => void;
  onOpenDayDetail: (dateKey: string) => void;
  onRescheduleSlot: (params: { slotId: string; targetDate: string }) => void;
  onCreateContent: () => void;
};

const MONTH_VISIBLE_LIMIT = 3;

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

const weekdayColumns = (windowStartDate: string): string[] => {
  const parsed = new Date(`${windowStartDate}T00:00:00.000Z`);
  const monday = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const columns: string[] = [];
  for (let index = 0; index < 7; index += 1) {
    const next = new Date(monday.getTime());
    next.setUTCDate(monday.getUTCDate() + index);
    columns.push(next.toISOString().slice(0, 10));
  }
  return columns;
};

const monthCells = (windowStartDate: string): Array<{ dateKey: string; isCurrentMonth: boolean }> => {
  const start = new Date(`${windowStartDate}T00:00:00.000Z`);
  const today = new Date();
  const monthStart = Number.isNaN(start.getTime())
    ? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
    : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0));

  const startDay = monthStart.getUTCDay();
  const mondayOffset = startDay === 0 ? -6 : 1 - startDay;
  const gridStart = new Date(monthStart.getTime());
  gridStart.setUTCDate(gridStart.getUTCDate() + mondayOffset);

  const endDay = monthEnd.getUTCDay();
  const sundayOffset = endDay === 0 ? 0 : 7 - endDay;
  const gridEnd = new Date(monthEnd.getTime());
  gridEnd.setUTCDate(gridEnd.getUTCDate() + sundayOffset);

  const cells: Array<{ dateKey: string; isCurrentMonth: boolean }> = [];
  for (let cursor = new Date(gridStart.getTime()); cursor <= gridEnd; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    cells.push({
      dateKey: cursor.toISOString().slice(0, 10),
      isCurrentMonth: cursor.getUTCMonth() === monthStart.getUTCMonth()
    });
  }

  return cells;
};

const extractSlotIdFromDrag = (event: DragEvent<HTMLElement>): string | null => {
  const payload = event.dataTransfer.getData("text/plain");
  if (!payload) {
    return null;
  }

  try {
    const parsed = JSON.parse(payload) as { slotId?: unknown };
    return typeof parsed.slotId === "string" && parsed.slotId.trim() ? parsed.slotId.trim() : null;
  } catch {
    return null;
  }
};

const handleDateDrop = (
  event: DragEvent<HTMLElement>,
  dateKey: string,
  onRescheduleSlot: (params: { slotId: string; targetDate: string }) => void
): void => {
  event.preventDefault();
  const slotId = extractSlotIdFromDrag(event);
  if (!slotId) {
    return;
  }
  onRescheduleSlot({
    slotId,
    targetDate: dateKey
  });
};

const renderCard = (params: {
  item: SchedulerBoardItem;
  isSelected: boolean;
  isRescheduling: boolean;
  onSelectContent: (contentId: string) => void;
}) => {
  const { item, isSelected, isRescheduling, onSelectContent } = params;
  const title = item.content.body?.trim() ? item.content.body.slice(0, 72) : "(No body)";

  return (
    <button
      key={item.content.id}
      type="button"
      className={`ui-scheduler-card ${isSelected ? "is-selected" : ""}`}
      draggable={!!item.slotId && !isRescheduling}
      onDragStart={(event) => {
        if (!item.slotId) {
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(
          "text/plain",
          JSON.stringify({
            slotId: item.slotId
          })
        );
      }}
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

const renderToolbar = (onCreateContent: () => void) => (
  <div className="ui-scheduler-toolbar">
    <h2>Scheduler Board</h2>
    <button type="button" className="primary" onClick={onCreateContent}>
      + Content
    </button>
  </div>
);

export const SchedulerBoard = ({
  items,
  selectedContentId,
  viewMode,
  windowStartDate,
  isRescheduling,
  onSelectContent,
  onOpenDayDetail,
  onRescheduleSlot,
  onCreateContent
}: SchedulerBoardProps) => {
  if (viewMode === "list") {
    return (
      <section className="ui-scheduler-board">
        {renderToolbar(onCreateContent)}
        <div className="ui-scheduler-list">
          {items.length === 0 ? <p className="empty">No scheduled content yet.</p> : null}
          {items.map((item) =>
            renderCard({
              item,
              isSelected: selectedContentId === item.content.id,
              isRescheduling,
              onSelectContent
            })
          )}
        </div>
      </section>
    );
  }

  if (viewMode === "month") {
    const cells = monthCells(windowStartDate);
    return (
      <section className="ui-scheduler-board">
        {renderToolbar(onCreateContent)}

        <div className="ui-scheduler-month-grid">
          {cells.map((cell) => {
            const dayItems = items
              .filter((item) => item.dateKey === cell.dateKey)
              .sort((left, right) => (left.scheduledTime ?? "").localeCompare(right.scheduledTime ?? ""));
            const visibleItems = dayItems.slice(0, MONTH_VISIBLE_LIMIT);
            const overflowCount = Math.max(0, dayItems.length - visibleItems.length);
            return (
              <article
                key={cell.dateKey}
                className={`ui-scheduler-day-column ui-scheduler-day-column-month ${cell.isCurrentMonth ? "" : "is-muted"}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => handleDateDrop(event, cell.dateKey, onRescheduleSlot)}
              >
                <header>
                  <strong>{formatDateLabel(cell.dateKey)}</strong>
                </header>
                <div className="ui-scheduler-day-list">
                  {visibleItems.map((item) =>
                    renderCard({
                      item,
                      isSelected: selectedContentId === item.content.id,
                      isRescheduling,
                      onSelectContent
                    })
                  )}
                  {overflowCount > 0 ? (
                    <button type="button" className="ui-scheduler-more-link" onClick={() => onOpenDayDetail(cell.dateKey)}>
                      +{overflowCount} more
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    );
  }

  const columns = weekdayColumns(windowStartDate);

  return (
    <section className="ui-scheduler-board">
      {renderToolbar(onCreateContent)}

      <div className="ui-scheduler-week-grid">
        {columns.map((dateKey) => {
          const dayItems = items
            .filter((item) => item.dateKey === dateKey)
            .sort((left, right) => (left.scheduledTime ?? "").localeCompare(right.scheduledTime ?? ""));
          return (
            <article key={dateKey} className="ui-scheduler-day-column">
              <header>
                <strong>{formatDateLabel(dateKey)}</strong>
              </header>
              <div
                className="ui-scheduler-day-list"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => handleDateDrop(event, dateKey, onRescheduleSlot)}
              >
                {dayItems.length === 0 ? <p className="empty">-</p> : null}
                {dayItems.map((item) =>
                  renderCard({
                    item,
                    isSelected: selectedContentId === item.content.id,
                    isRescheduling,
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
