import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isSlotTransitionAllowed,
  resolveTargetSlotStatus,
  resolveWorkflowTransitionEvent
} from "../src/orchestrator/scheduler-slot-transition-model";

describe("Phase 6-3a scheduler slot transition model", () => {
  it("keeps the canonical status path valid", () => {
    assert.equal(isSlotTransitionAllowed("scheduled", "generating"), true);
    assert.equal(isSlotTransitionAllowed("generating", "pending_approval"), true);
    assert.equal(isSlotTransitionAllowed("pending_approval", "approved"), true);
    assert.equal(isSlotTransitionAllowed("approved", "published"), true);
  });

  it("rejects invalid direct jumps", () => {
    assert.equal(isSlotTransitionAllowed("scheduled", "published"), false);
    assert.equal(isSlotTransitionAllowed("pending_approval", "published"), false);
    assert.equal(isSlotTransitionAllowed("published", "scheduled"), false);
  });

  it("resolves workflow approval target based on publish context", () => {
    assert.equal(
      resolveTargetSlotStatus({
        event: "workflow_approved"
      }),
      "approved"
    );
    assert.equal(
      resolveTargetSlotStatus({
        event: "workflow_approved",
        publishedAt: "2026-03-05T09:00:00Z"
      }),
      "published"
    );
  });

  it("maps workflow status to transition event", () => {
    assert.equal(resolveWorkflowTransitionEvent("approved"), "workflow_approved");
    assert.equal(resolveWorkflowTransitionEvent("rejected"), "workflow_rejected");
    assert.equal(resolveWorkflowTransitionEvent("revision_requested"), "workflow_revision_requested");
    assert.equal(resolveWorkflowTransitionEvent("proposed"), "workflow_resubmitted");
  });
});
