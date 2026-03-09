import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getAllTemplates,
  getTemplate,
  getTemplateSummaries,
  loadPresetTemplates
} from "@repo/media-engine";

describe("Phase 7-2a template registry", () => {
  it("loads koica preset family from json files", () => {
    loadPresetTemplates();

    const all = getAllTemplates();
    assert.ok(all.length >= 4);

    for (const templateId of ["koica_cover_01", "koica_story_02", "koica_stats_03", "koica_cta_04"]) {
      const template = getTemplate(templateId);
      assert.ok(template);
      assert.equal(template?.size.width, 1080);
      assert.equal(template?.size.height, 1080);
      assert.ok((template?.photos.length ?? 0) >= 1);
      assert.ok((template?.texts.length ?? 0) >= 1);
    }
  });

  it("returns survey-friendly summaries", () => {
    const summaries = getTemplateSummaries();
    assert.ok(summaries.length >= 4);
    assert.ok(summaries.some((entry) => entry.id === "koica_cover_01"));
    assert.ok(summaries.some((entry) => entry.id === "koica_story_02"));
    assert.ok(summaries.some((entry) => entry.id === "koica_stats_03"));
    assert.ok(summaries.some((entry) => entry.id === "koica_cta_04"));
    assert.ok(summaries.every((entry) => !!entry.id && !!entry.nameKo && !!entry.thumbnail));
  });
});
