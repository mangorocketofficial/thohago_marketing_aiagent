import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { HttpError } from "../src/lib/errors";
import {
  encodeScheduledContentCursor,
  parseScheduledContentQuery,
  type ParsedScheduledContentQuery
} from "../src/scheduler/http/scheduled-content-query";
import {
  isSlotTransitionAllowed,
  resolveTargetSlotStatus,
  resolveWorkflowTransitionEvent,
  type SlotTransitionEvent
} from "../src/orchestrator/scheduler-slot-transition-model";
import type { ScheduleSlotStatus, WorkflowStatus } from "../src/orchestrator/scheduler-status";

type GoldenMeta = {
  scenario: string;
  description: string;
  is_deterministic: "yes" | "no" | "uncertain";
  created_at: string;
  approved_by: string;
  version: string;
};

type HappyQueryGolden = GoldenMeta & {
  input: {
    query: Record<string, string>;
    cursor_payload: {
      scheduled_date: string;
      id: string;
    };
  };
  output: ParsedScheduledContentQuery;
};

type ErrorQueryGolden = GoldenMeta & {
  input: {
    query: Record<string, string>;
  };
  output_error: {
    status: number;
    code: string;
    message: string;
  };
};

type TransitionCheck = {
  from: ScheduleSlotStatus;
  to: ScheduleSlotStatus;
};

type TargetStatusCheck = {
  event: SlotTransitionEvent;
  publishedAt?: string;
};

type WorkflowEventCheck = {
  workflowStatus: WorkflowStatus;
};

type TransitionModelGolden = GoldenMeta & {
  input: {
    allowed_checks: TransitionCheck[];
    target_status_checks: TargetStatusCheck[];
    workflow_event_checks: WorkflowEventCheck[];
  };
  output: {
    allowed_checks: Array<TransitionCheck & { allowed: boolean }>;
    target_status_checks: Array<TargetStatusCheck & { target: ScheduleSlotStatus }>;
    workflow_event_checks: Array<WorkflowEventCheck & { event: SlotTransitionEvent }>;
  };
};

/**
 * Reads a 6-3a golden JSON snapshot from tests/golden.
 */
const loadGolden = <T>(fileName: string): T => {
  const raw = readFileSync(new URL(`./golden/${fileName}`, import.meta.url), "utf8");
  return JSON.parse(raw) as T;
};

describe("Phase 6-3a golden snapshots", () => {
  it("matches happy query parsing output golden", () => {
    const golden = loadGolden<HappyQueryGolden>("phase6-3a-happy-scheduled-content-query-20260305-v1.golden.json");
    const cursorToken = encodeScheduledContentCursor(golden.input.cursor_payload);
    const parsed = parseScheduledContentQuery({
      ...golden.input.query,
      cursor: cursorToken
    });
    assert.deepEqual(parsed, golden.output);
  });

  it("matches invalid date range error golden", () => {
    const golden = loadGolden<ErrorQueryGolden>("phase6-3a-error-invalid-date-range-20260305-v1.golden.json");
    assert.throws(
      () => parseScheduledContentQuery(golden.input.query),
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

  it("matches transition model output golden", () => {
    const golden = loadGolden<TransitionModelGolden>("phase6-3a-happy-slot-transition-model-20260305-v1.golden.json");
    const actualOutput = {
      allowed_checks: golden.input.allowed_checks.map((check) => ({
        ...check,
        allowed: isSlotTransitionAllowed(check.from, check.to)
      })),
      target_status_checks: golden.input.target_status_checks.map((check) => ({
        ...check,
        target: resolveTargetSlotStatus({
          event: check.event,
          publishedAt: check.publishedAt
        })
      })),
      workflow_event_checks: golden.input.workflow_event_checks.map((check) => ({
        ...check,
        event: resolveWorkflowTransitionEvent(check.workflowStatus)
      }))
    };

    assert.deepEqual(actualOutput, golden.output);
  });
});
