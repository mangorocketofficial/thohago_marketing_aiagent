import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getAllTemplates,
  getTemplate,
  getTemplateSummaries,
  loadPresetTemplates
} from "@repo/media-engine";

describe("Phase 7-2a template registry", () => {
  it("loads koica preset from json files", () => {
    loadPresetTemplates();

    const all = getAllTemplates();
    assert.ok(all.length >= 1);

    const koica = getTemplate("koica_cover_01");
    assert.ok(koica);
    assert.equal(koica?.size.width, 1080);
    assert.equal(koica?.size.height, 1080);
    assert.ok((koica?.photos.length ?? 0) >= 1);
    assert.ok((koica?.texts.length ?? 0) >= 1);
  });

  it("returns survey-friendly summaries", () => {
    const summaries = getTemplateSummaries();
    assert.ok(summaries.length >= 1);
    assert.ok(summaries.some((entry) => entry.id === "koica_cover_01"));
    assert.ok(summaries.every((entry) => !!entry.id && !!entry.nameKo && !!entry.thumbnail));
  });
});
