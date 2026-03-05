import { HttpError } from "../../lib/errors";
import {
  parseScheduledContentQuery,
  type ParsedScheduledContentQuery
} from "./scheduled-content-query";

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

export type ParsedScheduledContentDayQuery = ParsedScheduledContentQuery & {
  date: string;
};

export const parseScheduledContentDayQuery = (query: Record<string, unknown>): ParsedScheduledContentDayQuery => {
  const date = asQueryString(query.date);
  if (!date) {
    throw new HttpError(400, "invalid_payload", "date is required.");
  }

  const parsed = parseScheduledContentQuery({
    ...query,
    start_date: date,
    end_date: date
  });

  return {
    ...parsed,
    date
  };
};
