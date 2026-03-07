import { SLOT_STATUS_LABEL, type SlotStatus } from "./status-model";

type ChannelTone = "instagram" | "threads" | "naver-blog" | "youtube" | "facebook" | "generic";

type ChannelPresentation = {
  label: string;
  tone: ChannelTone;
};

type CampaignPresentation = {
  label: string;
  tone: "campaign" | "adhoc";
};

type SlotBadgePresentation = {
  className: string;
  label: string;
};

const CHANNEL_PRESENTATION: Record<string, ChannelPresentation> = {
  naver_blog: {
    label: "Naver Blog",
    tone: "naver-blog"
  },
  instagram: {
    label: "Instagram",
    tone: "instagram"
  },
  threads: {
    label: "Threads",
    tone: "threads"
  },
  youtube: {
    label: "YouTube",
    tone: "youtube"
  },
  facebook: {
    label: "Facebook",
    tone: "facebook"
  }
};

/**
 * Resolve channel display label + color tone for scheduler cards.
 */
export const resolveChannelPresentation = (channel: string): ChannelPresentation => {
  const normalized = channel.trim().toLowerCase();
  const mapped = CHANNEL_PRESENTATION[normalized];
  if (mapped) {
    return mapped;
  }
  return {
    label: normalized || "Unknown",
    tone: "generic"
  };
};

/**
 * Resolve campaign chip label from campaign id/title map.
 */
export const resolveCampaignPresentation = (
  campaignId: string | null | undefined,
  campaignTitleById: Record<string, string>
): CampaignPresentation => {
  const normalized = campaignId?.trim();
  if (!normalized) {
    return {
      label: "Ad-hoc",
      tone: "adhoc"
    };
  }
  const title = campaignTitleById[normalized]?.trim();
  return {
    label: title ? `Campaign - ${title}` : `Campaign - ${normalized.slice(0, 8)}`,
    tone: "campaign"
  };
};

/**
 * Resolve status badge label/class with naver draft exception.
 */
export const resolveSlotBadgePresentation = (params: { channel: string; slotStatus: SlotStatus }): SlotBadgePresentation => {
  const normalizedChannel = params.channel.trim().toLowerCase();
  if (normalizedChannel === "naver_blog" && params.slotStatus === "pending_approval") {
    return {
      className: "is-draft",
      label: "Draft"
    };
  }
  return {
    className: `is-${params.slotStatus}`,
    label: SLOT_STATUS_LABEL[params.slotStatus]
  };
};

/**
 * Convert raw content type to compact readable label.
 */
export const formatContentTypeLabel = (contentType: string): string => {
  const normalized = contentType.trim().toLowerCase();
  if (!normalized) {
    return "Unknown";
  }
  if (normalized === "text") {
    return "Text";
  }
  if (normalized === "image") {
    return "Image";
  }
  if (normalized === "video") {
    return "Video";
  }
  return normalized.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
};
