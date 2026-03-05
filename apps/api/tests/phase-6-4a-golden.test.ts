import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { HttpError } from "../src/lib/errors";
import { parseRescheduleSlotRequest, type ParsedRescheduleSlotRequest } from "../src/scheduler/http/reschedule-slot-request";
import {
  parseScheduledContentDayQuery,
  type ParsedScheduledContentDayQuery
} from "../src/scheduler/http/scheduled-content-day-query";
import { encodeScheduledContentCursor } from "../src/scheduler/http/scheduled-content-query";

type GoldenMeta = {
  scenario: string;
  description: string;
  is_deterministic: "yes" | "no" | "uncertain";
  created_at: string;
  approved_by: string;
  version: string;
};

type HappyDayQueryGolden = GoldenMeta & {
  input: {
    query: Record<string, string>;
    cursor_payload: {
      scheduled_date: string;
      id: string;
    };
  };
  output: ParsedScheduledContentDayQuery;
};

type HappyRescheduleRequestGolden = GoldenMeta & {
  input: {
    body: Record<string, unknown>;
  };
  output: ParsedRescheduleSlotRequest;
};

type ErrorRescheduleRequestGolden = GoldenMeta & {
  input: {
    body: Record<string, unknown>;
  };
  output_error: {
    status: number;
    code: string;
    message: string;
  };
};

/**
 * Reads a 6-4a golden JSON snapshot from tests/golden.
 */
const loadGolden = <T>(fileName: string): T => {
  const raw = readFileSync(new URL(`./golden/${fileName}`, import.meta.url), "utf8");
  return JSON.parse(raw) as T;
};

describe("Phase 6-4a golden snapshots", () => {
  it("matches day query parsing output golden", () => {
    const golden = loadGolden<HappyDayQueryGolden>("phase6-4a-happy-scheduled-content-day-query-20260305-v1.golden.json");
    const cursorToken = encodeScheduledContentCursor(golden.input.cursor_payload);
    const parsed = parseScheduledContentDayQuery({
      ...golden.input.query,
      cursor: cursorToken
    });

    assert.deepEqual(parsed, golden.output);
  });

  it("matches reschedule request parsing output golden", () => {
    const golden = loadGolden<HappyRescheduleRequestGolden>("phase6-4a-happy-reschedule-slot-request-20260305-v1.golden.json");
    const parsed = parseRescheduleSlotRequest(golden.input.body);
    assert.deepEqual(parsed, golden.output);
  });

  it("matches reschedule invalid window range error golden", () => {
    const golden = loadGolden<ErrorRescheduleRequestGolden>("phase6-4a-error-reschedule-window-range-20260305-v1.golden.json");
    assert.throws(
      () => parseRescheduleSlotRequest(golden.input.body),
      (error: unknown) => {
        assert.equal(error instanceof HttpError, true);
        if (!(error instanceof HttpError)) {
          return false;
        }
        assert.equal(error.status, golden.output_error.status);
        assert.equal(error.code, golden.output_error.code);
        assert.equal(error.message, golden.output_error.message);
        return true;
      }
    );
  });
});
