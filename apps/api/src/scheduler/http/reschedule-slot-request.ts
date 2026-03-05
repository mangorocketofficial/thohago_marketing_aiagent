import { HttpError } from "../../lib/errors";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const asString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const parseDate = (value: unknown, field: string): string | null => {
  const normalized = asString(value);
  if (!normalized) {
    return null;
  }
  if (!ISO_DATE_RE.test(normalized)) {
    throw new HttpError(400, "invalid_payload", `${field} must be YYYY-MM-DD.`);
  }

  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new HttpError(400, "invalid_payload", `${field} is invalid.`);
  }
  return normalized;
};

const parseTimezone = (value: unknown): string => {
  const normalized = asString(value) || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format(new Date());
    return normalized;
  } catch {
    throw new HttpError(400, "invalid_payload", "timezone must be a valid IANA timezone.");
  }
};

const parseTargetTime = (value: unknown): string | null => {
  const normalized = asString(value);
  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, "invalid_payload", "target_time must be a valid ISO datetime.");
  }
  return normalized;
};

export type ParsedRescheduleSlotRequest = {
  targetDate: string;
  targetTime: string | null;
  timezone: string;
  idempotencyKey: string | null;
  windowStart: string | null;
  windowEnd: string | null;
};

export const parseRescheduleSlotRequest = (body: unknown): ParsedRescheduleSlotRequest => {
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "invalid_payload", "Request body is required.");
  }
  const row = body as Record<string, unknown>;

  const targetDate = parseDate(row.target_date, "target_date");
  if (!targetDate) {
    throw new HttpError(400, "invalid_payload", "target_date is required.");
  }

  const windowStart = parseDate(row.window_start, "window_start");
  const windowEnd = parseDate(row.window_end, "window_end");
  if (windowStart && windowEnd && windowStart > windowEnd) {
    throw new HttpError(400, "invalid_payload", "window_start must be on or before window_end.");
  }

  const idempotencyKey = asString(row.idempotency_key) || null;

  return {
    targetDate,
    targetTime: parseTargetTime(row.target_time),
    timezone: parseTimezone(row.timezone),
    idempotencyKey,
    windowStart,
    windowEnd
  };
};
