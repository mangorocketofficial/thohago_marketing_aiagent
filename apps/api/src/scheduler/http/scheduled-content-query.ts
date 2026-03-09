import { ANALYTICS_CHANNELS, isAnalyticsChannel } from "@repo/analytics";
import { HttpError } from "../../lib/errors";
import type { ScheduleSlotStatus } from "../../orchestrator/scheduler-status";
import type { ScheduledContentCursor } from "../queries/list-scheduled-content";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHANNEL_SET = new Set(ANALYTICS_CHANNELS);
const SLOT_STATUS_SET: Set<ScheduleSlotStatus> = new Set([
  "scheduled",
  "generating",
  "pending_approval",
  "approved",
  "published",
  "skipped",
  "failed"
]);

export type ParsedScheduledContentQuery = {
  startDate: string;
  endDate: string;
  timezone: string;
  campaignId: string | "adhoc" | null;
  channel: string | null;
  status: ScheduleSlotStatus | null;
  limit: number;
  cursor: ScheduledContentCursor | null;
};

const asQueryString = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry !== "string") {
        continue;
      }
      const trimmed = entry.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }
  return null;
};

const parseDate = (value: string, field: string): string => {
  if (!ISO_DATE_RE.test(value)) {
    throw new HttpError(400, "invalid_payload", `${field} must be YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, "invalid_payload", `${field} is invalid.`);
  }
  return value;
};

const parsePositiveInt = (value: unknown, field: string, fallback: number, max: number): number => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const raw = asQueryString(value);
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    throw new HttpError(400, "invalid_payload", `${field} must be a positive integer.`);
  }
  return Math.max(1, Math.min(max, parsed));
};

const parseTimezone = (value: unknown): string => {
  const candidate = asQueryString(value) ?? "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    throw new HttpError(400, "invalid_payload", "timezone must be a valid IANA timezone.");
  }
};

const getDatePartsInTimeZone = (timeZone: string, base: Date): { year: number; month: number; day: number } => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(base);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "0");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "0");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "0");
  return { year, month, day };
};

const dateOffsetInTimezone = (timeZone: string, offsetDays: number): string => {
  const now = new Date();
  const parts = getDatePartsInTimeZone(timeZone, now);
  const utcDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  utcDate.setUTCDate(utcDate.getUTCDate() + offsetDays);
  return utcDate.toISOString().slice(0, 10);
};

const parseCampaignId = (value: unknown): string | "adhoc" | null => {
  const raw = asQueryString(value);
  if (!raw) {
    return null;
  }
  if (raw.toLowerCase() === "adhoc") {
    return "adhoc";
  }
  if (!UUID_RE.test(raw)) {
    throw new HttpError(400, "invalid_payload", "campaign_id must be a UUID or \"adhoc\".");
  }
  return raw;
};

const parseChannel = (value: unknown): string | null => {
  const raw = asQueryString(value);
  if (!raw) {
    return null;
  }
  const normalized = raw.toLowerCase();
  if (!isAnalyticsChannel(normalized) || !CHANNEL_SET.has(normalized)) {
    throw new HttpError(400, "invalid_payload", "channel is not supported.");
  }
  return normalized;
};

const parseStatus = (value: unknown): ScheduleSlotStatus | null => {
  const raw = asQueryString(value);
  if (!raw) {
    return null;
  }
  if (!SLOT_STATUS_SET.has(raw as ScheduleSlotStatus)) {
    throw new HttpError(400, "invalid_payload", "status is not a valid slot status.");
  }
  return raw as ScheduleSlotStatus;
};

export const parseScheduledContentCursor = (value: unknown): ScheduledContentCursor | null => {
  const encoded = asQueryString(value);
  if (!encoded) {
    return null;
  }

  try {
    const raw = Buffer.from(encoded, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const scheduledDate = parseDate(asQueryString(parsed.scheduled_date) ?? "", "cursor.scheduled_date");
    const id = asQueryString(parsed.id) ?? "";
    if (!UUID_RE.test(id)) {
      throw new HttpError(400, "invalid_payload", "cursor.id is invalid.");
    }
    return {
      scheduled_date: scheduledDate,
      id
    };
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(400, "invalid_payload", "cursor is invalid.");
  }
};

export const encodeScheduledContentCursor = (cursor: ScheduledContentCursor): string =>
  Buffer.from(
    JSON.stringify({
      scheduled_date: cursor.scheduled_date,
      id: cursor.id
    }),
    "utf8"
  ).toString("base64url");

export const parseScheduledContentQuery = (query: Record<string, unknown>): ParsedScheduledContentQuery => {
  const timezone = parseTimezone(query.timezone);
  const defaultStartDate = dateOffsetInTimezone(timezone, -7);
  const defaultEndDate = dateOffsetInTimezone(timezone, 30);

  const startDate = parseDate(asQueryString(query.start_date) ?? defaultStartDate, "start_date");
  const endDate = parseDate(asQueryString(query.end_date) ?? defaultEndDate, "end_date");
  if (startDate > endDate) {
    throw new HttpError(400, "invalid_payload", "start_date must be on or before end_date.");
  }

  return {
    startDate,
    endDate,
    timezone,
    campaignId: parseCampaignId(query.campaign_id),
    channel: parseChannel(query.channel),
    status: parseStatus(query.status),
    limit: parsePositiveInt(query.limit, "limit", 200, 500),
    cursor: parseScheduledContentCursor(query.cursor)
  };
};
