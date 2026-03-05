import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getAllTemplates,
  getTemplate,
  getTemplateSummaries,
  loadPresetTemplates
} from "../src/media/templates/registry";

describe("Phase 7-2a template registry", () => {
  it("loads preset templates from json files", () => {
    loadPresetTemplates();

    const all = getAllTemplates();
    assert.ok(all.length >= 5);

    const center = getTemplate("center-image-bottom-text");
    assert.ok(center);
    assert.equal(center?.width, 1080);
    assert.equal(center?.height, 1080);
  });

  it("returns survey-friendly summaries", () => {
    const summaries = getTemplateSummaries();
    assert.ok(summaries.length >= 5);
    assert.ok(summaries.every((entry) => !!entry.id && !!entry.nameKo && !!entry.thumbnail));
  });
});
