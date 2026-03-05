import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpError } from "../src/lib/errors";
import { parseRescheduleSlotRequest } from "../src/scheduler/http/reschedule-slot-request";
import { parseScheduledContentDayQuery } from "../src/scheduler/http/scheduled-content-day-query";
import { encodeScheduledContentCursor } from "../src/scheduler/http/scheduled-content-query";

describe("Phase 6-4a scheduler day query and reschedule parser", () => {
  it("parses scheduled-content day query with filters and cursor", () => {
    const cursor = encodeScheduledContentCursor({
      scheduled_date: "2026-03-12",
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    });

    const parsed = parseScheduledContentDayQuery({
      date: "2026-03-12",
      timezone: "Asia/Bangkok",
      campaign_id: "adhoc",
      channel: "instagram",
      status: "pending_approval",
      limit: "180",
      cursor
    });

    assert.equal(parsed.date, "2026-03-12");
    assert.equal(parsed.startDate, "2026-03-12");
    assert.equal(parsed.endDate, "2026-03-12");
    assert.equal(parsed.timezone, "Asia/Bangkok");
    assert.equal(parsed.campaignId, "adhoc");
    assert.equal(parsed.channel, "instagram");
    assert.equal(parsed.status, "pending_approval");
    assert.equal(parsed.limit, 180);
    assert.deepEqual(parsed.cursor, {
      scheduled_date: "2026-03-12",
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    });
  });

  it("rejects missing date in day query", () => {
    assert.throws(
      () => parseScheduledContentDayQuery({}),
      (error: unknown) => {
        assert.equal(error instanceof HttpError, true);
        if (!(error instanceof HttpError)) {
          return false;
        }
        assert.equal(error.status, 400);
        assert.equal(error.code, "invalid_payload");
        assert.equal(error.message, "date is required.");
        return true;
      }
    );
  });

  it("parses reschedule request payload with timezone and window context", () => {
    const parsed = parseRescheduleSlotRequest({
      target_date: "2026-03-20",
      target_time: "2026-03-20T09:00:00+07:00",
      timezone: "Asia/Bangkok",
      idempotency_key: "demo-key",
      window_start: "2026-03-03",
      window_end: "2026-03-09"
    });

    assert.equal(parsed.targetDate, "2026-03-20");
    assert.equal(parsed.targetTime, "2026-03-20T09:00:00+07:00");
    assert.equal(parsed.timezone, "Asia/Bangkok");
    assert.equal(parsed.idempotencyKey, "demo-key");
    assert.equal(parsed.windowStart, "2026-03-03");
    assert.equal(parsed.windowEnd, "2026-03-09");
  });

  it("rejects invalid target_time payload", () => {
    assert.throws(
      () =>
        parseRescheduleSlotRequest({
          target_date: "2026-03-20",
          target_time: "not-a-date"
        }),
      /target_time must be a valid ISO datetime/
    );
  });

  it("rejects invalid window range", () => {
    assert.throws(
      () =>
        parseRescheduleSlotRequest({
          target_date: "2026-03-20",
          window_start: "2026-03-10",
          window_end: "2026-03-09"
        }),
      /window_start must be on or before window_end/
    );
  });
});
