export type PublishContentType = "text" | "image" | "video";

const CHANNEL_FORMAT_POLICY: Record<string, PublishContentType[]> = {
  naver_blog: ["text"],
  threads: ["text"],
  instagram: ["image"],
  facebook: ["text", "image"],
  youtube: ["video"]
};

const normalizeChannel = (value: string): string => {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized === "naverblog") {
    return "naver_blog";
  }
  if (normalized === "thread") {
    return "threads";
  }
  if (normalized === "face_book") {
    return "facebook";
  }
  return normalized;
};

const normalizeContentType = (value: string | null | undefined): PublishContentType | null => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "text" || normalized === "image" || normalized === "video") {
    return normalized;
  }
  return null;
};

export const getAllowedContentTypesForChannel = (channel: string): PublishContentType[] => {
  const normalized = normalizeChannel(channel);
  return CHANNEL_FORMAT_POLICY[normalized] ?? ["text"];
};

export const resolveChannelContentType = (params: {
  channel: string;
  suggestedType?: string | null;
  sequenceIndex?: number;
}): PublishContentType => {
  const allowed = getAllowedContentTypesForChannel(params.channel);
  const suggested = normalizeContentType(params.suggestedType);
  if (suggested && allowed.includes(suggested)) {
    return suggested;
  }

  const index = Math.max(0, Math.floor(params.sequenceIndex ?? 0));
  return allowed[index % allowed.length] ?? "text";
};

export const buildContentTypesForChannels = (channels: string[]): PublishContentType[] => {
  const merged = channels.flatMap((channel) => getAllowedContentTypesForChannel(channel));
  return [...new Set(merged)];
};

