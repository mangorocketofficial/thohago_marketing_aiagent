import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  encodeScheduledContentCursor,
  parseScheduledContentCursor,
  parseScheduledContentQuery
} from "../src/scheduler/http/scheduled-content-query";

describe("Phase 6-3a scheduled-content query parser", () => {
  it("parses full filter payload and cursor", () => {
    const encodedCursor = encodeScheduledContentCursor({
      scheduled_date: "2026-03-04",
      id: "11111111-1111-4111-8111-111111111111"
    });

    const parsed = parseScheduledContentQuery({
      start_date: "2026-03-03",
      end_date: "2026-03-09",
      timezone: "Asia/Bangkok",
      campaign_id: "adhoc",
      channel: "instagram",
      status: "pending_approval",
      limit: "220",
      cursor: encodedCursor
    });

    assert.equal(parsed.startDate, "2026-03-03");
    assert.equal(parsed.endDate, "2026-03-09");
    assert.equal(parsed.timezone, "Asia/Bangkok");
    assert.equal(parsed.campaignId, "adhoc");
    assert.equal(parsed.channel, "instagram");
    assert.equal(parsed.status, "pending_approval");
    assert.equal(parsed.limit, 220);
    assert.deepEqual(parsed.cursor, {
      scheduled_date: "2026-03-04",
      id: "11111111-1111-4111-8111-111111111111"
    });
  });

  it("supports cursor decode helper roundtrip", () => {
    const token = encodeScheduledContentCursor({
      scheduled_date: "2026-03-05",
      id: "22222222-2222-4222-8222-222222222222"
    });
    const decoded = parseScheduledContentCursor(token);
    assert.deepEqual(decoded, {
      scheduled_date: "2026-03-05",
      id: "22222222-2222-4222-8222-222222222222"
    });
  });

  it("applies safe defaults when optional filters are omitted", () => {
    const parsed = parseScheduledContentQuery({});
    assert.match(parsed.startDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(parsed.endDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(parsed.timezone, "UTC");
    assert.equal(parsed.campaignId, null);
    assert.equal(parsed.channel, null);
    assert.equal(parsed.status, null);
    assert.equal(parsed.limit, 200);
    assert.equal(parsed.cursor, null);
    assert.ok(parsed.startDate <= parsed.endDate);
  });

  it("rejects invalid date ranges", () => {
    assert.throws(
      () =>
        parseScheduledContentQuery({
          start_date: "2026-03-10",
          end_date: "2026-03-09"
        }),
      /start_date must be on or before end_date/
    );
  });
});
