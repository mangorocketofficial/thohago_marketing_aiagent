import type { Channel } from "@repo/types";

export const ANALYTICS_CHANNELS = [
  "instagram",
  "threads",
  "naver_blog",
  "facebook",
  "youtube"
] as const satisfies readonly Channel[];

export const ANALYTICS_CHANNEL_DISPLAY_ORDER = [
  "naver_blog",
  "instagram",
  "youtube",
  "facebook",
  "threads"
] as const satisfies readonly Channel[];

export const VIEW_BASED_CHANNELS = ["naver_blog", "youtube"] as const satisfies readonly Channel[];

export const isAnalyticsChannel = (value: unknown): value is Channel =>
  typeof value === "string" && ANALYTICS_CHANNELS.includes(value.trim().toLowerCase() as Channel);

export const isViewBasedChannel = (channel: Channel): boolean =>
  VIEW_BASED_CHANNELS.includes(channel as (typeof VIEW_BASED_CHANNELS)[number]);

export const toOrderedAnalyticsChannels = (
  channels: string[],
  order: readonly Channel[] = ANALYTICS_CHANNEL_DISPLAY_ORDER
): Channel[] => {
  const known = new Set(order);
  const normalized = new Set(channels.map((channel) => channel.trim().toLowerCase()).filter(isAnalyticsChannel));
  const ordered = order.filter((channel) => normalized.has(channel));
  const extras = [...normalized].filter((channel) => !known.has(channel)).sort((left, right) => left.localeCompare(right));
  return [...ordered, ...extras];
};
