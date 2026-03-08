import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMetricsCursorFilter,
  encodeMetricsCursor,
  parseMetricsCursor
} from "../src/routes/metrics-helpers";

describe("metrics cursor helpers", () => {
  it("round-trips metrics cursors through base64 encoding", () => {
    const cursor = {
      created_at: "2026-03-07T09:10:00.000Z",
      id: "content-a"
    };

    const encoded = encodeMetricsCursor(cursor);
    const decoded = parseMetricsCursor(encoded);

    assert.deepEqual(decoded, cursor);
  });

  it("builds a tie-safe cursor filter using created_at and id", () => {
    const filter = buildMetricsCursorFilter({
      created_at: "2026-03-07T09:10:00.000Z",
      id: "content-a"
    });

    assert.equal(
      filter,
      "created_at.lt.2026-03-07T09:10:00.000Z,and(created_at.eq.2026-03-07T09:10:00.000Z,id.lt.content-a)"
    );
  });
});
