import { asString, isSlotStatus, type ScheduledContentItem } from "../../pages/scheduler/scheduler-helpers";
import { formatContentTypeLabel, resolveCampaignPresentation, resolveChannelPresentation, resolveSlotBadgePresentation } from "./card-presentation";
import { ChannelLogoIcon } from "./ChannelLogoIcon";

type DayDetailDrawerProps = {
  isOpen: boolean;
  dateKey: string | null;
  items: ScheduledContentItem[];
  isLoading: boolean;
  hasMore: boolean;
  isOffline: boolean;
  campaignTitleById: Record<string, string>;
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
  campaignTitleById,
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
          const channel = resolveChannelPresentation(item.channel);
          const campaign = resolveCampaignPresentation(item.campaign_id, campaignTitleById);
          const statusBadge = resolveSlotBadgePresentation({
            channel: item.channel,
            slotStatus
          });
          const contentId = (item.content?.id ?? item.content_id ?? "").trim();
          return (
            <button
              key={item.slot_id}
              type="button"
              className={`ui-scheduler-card is-channel-${channel.tone}`}
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
                <span className={`ui-channel-pill is-${channel.tone}`} aria-label={channel.label} title={channel.label}>
                  <ChannelLogoIcon channel={item.channel} />
                </span>
                <span className={`ui-slot-badge ${statusBadge.className}`}>{statusBadge.label}</span>
              </span>
              <span className="ui-scheduler-card-body">{resolveRowTitle(item)}</span>
              <span className="ui-scheduler-card-meta">
                <span className={`ui-scheduler-meta-pill is-${campaign.tone}`}>{campaign.label}</span>
                <span className="ui-scheduler-meta-pill">{formatContentTypeLabel(item.content_type)}</span>
              </span>
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
