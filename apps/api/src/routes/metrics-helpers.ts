import { ANALYTICS_CHANNELS, ANALYTICS_METRIC_FIELDS, normalizeMetricsForStorage } from "@repo/analytics";
import type { Response } from "express";
import type { Channel, ContentMetricsInput } from "@repo/types";
import { HttpError, toHttpError } from "../lib/errors";
import { parseOptionalString, parseRequiredString } from "../lib/request-parsers";
import { updateAccumulatedInsights } from "../rag/compute-insights";
import { invalidateMemoryCache } from "../rag/memory-service";
import { type RawMetrics } from "../rag/performance-scorer";
import { syncPerformanceScoreToRag } from "../rag/rag-score-sync";

export const PUBLISHED_STATUSES = ["published", "historical"] as const;
const CHANNEL_SET = new Set<Channel>(ANALYTICS_CHANNELS);
const FIELD_ORDER = ANALYTICS_METRIC_FIELDS;

export const MAX_BATCH_ENTRIES = 100;
export const MAX_LIST_LIMIT = 50;
export const SYNC_FOLLOWUP_ENTRY_LIMIT = 20;

export type MetricsCursor = {
  created_at: string;
  id: string;
};

export type ParsedMetricsInput = ContentMetricsInput & {
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  follower_delta: number | null;
  views: number | null;
};

export const sendMetricsError = (res: Response, error: unknown): void => {
  const httpError = toHttpError(error);
  res.status(httpError.status).json({
    ok: false,
    error: httpError.code,
    message: httpError.message,
    ...(httpError.details ? { details: httpError.details } : {})
  });
};

export const parsePositiveInt = (value: unknown, field: string, fallback: number, max: number): number => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number.parseInt(value.trim(), 10)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new HttpError(400, "invalid_payload", `${field} must be a positive integer.`);
  }
  return Math.min(max, Math.floor(parsed));
};

const parseOptionalMetricInt = (value: unknown, field: string, allowNegative = false): number | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number.parseInt(value.trim(), 10)
        : Number.NaN;
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new HttpError(400, "invalid_payload", `${field} must be an integer.`);
  }
  if (!allowNegative && parsed < 0) {
    throw new HttpError(400, "invalid_payload", `${field} must be >= 0.`);
  }
  return Math.floor(parsed);
};

export const parseOptionalChannel = (value: unknown, field: string): Channel | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const normalized = parseRequiredString(value, field).toLowerCase() as Channel;
  if (!CHANNEL_SET.has(normalized)) {
    throw new HttpError(400, "invalid_payload", `${field} is invalid.`);
  }
  return normalized;
};

export const encodeMetricsCursor = (cursor: MetricsCursor): string =>
  Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");

export const parseMetricsCursor = (value: unknown): MetricsCursor | null => {
  const encoded = parseOptionalString(value);
  if (!encoded) {
    return null;
  }
  try {
    const raw = Buffer.from(encoded, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      created_at: parseRequiredString(parsed.created_at, "cursor.created_at"),
      id: parseRequiredString(parsed.id, "cursor.id")
    };
  } catch {
    throw new HttpError(400, "invalid_payload", "cursor is invalid.");
  }
};

export const buildMetricsCursorFilter = (cursor: MetricsCursor): string =>
  `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`;

const hasAnyMetric = (entry: ParsedMetricsInput): boolean =>
  FIELD_ORDER.some((field) => typeof (entry as Record<string, unknown>)[field] === "number");

export const parseMetricsEntries = (value: unknown): ParsedMetricsInput[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, "invalid_payload", "entries must be a non-empty array.");
  }
  if (value.length > MAX_BATCH_ENTRIES) {
    throw new HttpError(400, "invalid_payload", `entries must contain at most ${MAX_BATCH_ENTRIES} items.`);
  }

  const parsedRows = value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new HttpError(400, "invalid_payload", `entries[${index}] must be an object.`);
    }
    const row = entry as Record<string, unknown>;
    const parsed: ParsedMetricsInput = {
      content_id: parseRequiredString(row.content_id, `entries[${index}].content_id`),
      likes: parseOptionalMetricInt(row.likes, `entries[${index}].likes`),
      comments: parseOptionalMetricInt(row.comments, `entries[${index}].comments`),
      shares: parseOptionalMetricInt(row.shares, `entries[${index}].shares`),
      saves: parseOptionalMetricInt(row.saves, `entries[${index}].saves`),
      follower_delta: parseOptionalMetricInt(row.follower_delta, `entries[${index}].follower_delta`, true),
      views: parseOptionalMetricInt(row.views, `entries[${index}].views`)
    };
    if (!hasAnyMetric(parsed)) {
      throw new HttpError(400, "invalid_payload", `entries[${index}] has no metric values.`);
    }
    return parsed;
  });

  const dedupedByContent = new Map<string, ParsedMetricsInput>();
  for (const row of parsedRows) {
    dedupedByContent.set(row.content_id, row);
  }
  return [...dedupedByContent.values()];
};

export const toCanonicalMetrics = (channel: Channel, entry: ParsedMetricsInput): RawMetrics => {
  return normalizeMetricsForStorage(channel, entry);
};

export const parseRequestIdempotencyKey = (body: Record<string, unknown>): string | null => {
  const raw = parseOptionalString(body.request_idempotency_key ?? body.requestIdempotencyKey);
  if (!raw) {
    return null;
  }
  if (!/^[A-Za-z0-9:_-]{8,120}$/.test(raw)) {
    throw new HttpError(
      400,
      "invalid_payload",
      "request_idempotency_key must match /^[A-Za-z0-9:_-]{8,120}$/."
    );
  }
  return raw;
};

export const runMetricsFollowUp = async (orgId: string, scoresByContent: Map<string, number>): Promise<void> => {
  await Promise.all(
    [...scoresByContent.entries()].map(([contentId, score]) => syncPerformanceScoreToRag(orgId, contentId, score))
  );
  await updateAccumulatedInsights(orgId);
  await invalidateMemoryCache(orgId);
};
