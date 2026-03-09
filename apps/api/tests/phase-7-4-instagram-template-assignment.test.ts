import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadPresetTemplates } from "@repo/media-engine";
import { assignSlideTemplateIds } from "../src/orchestrator/skills/instagram-generation/template-assignment";

describe("Phase 7-4 instagram template assignment", () => {
  it("keeps the first slide on the base template and varies later slides by role", () => {
    loadPresetTemplates();

    const templateIds = assignSlideTemplateIds({
      baseTemplateId: "koica_cover_01",
      slideDrafts: [
        { role: "cover", overlayTexts: { title: "Cover" } },
        { role: "problem", overlayTexts: { title: "Problem" } },
        { role: "solution", overlayTexts: { title: "Solution" } },
        { role: "cta", overlayTexts: { title: "CTA" } }
      ]
    });

    assert.deepEqual(templateIds, ["koica_cover_01", "koica_stats_03", "koica_story_02", "koica_cta_04"]);
  });

  it("falls back to available templates when the base template is unsupported", () => {
    loadPresetTemplates();

    const templateIds = assignSlideTemplateIds({
      baseTemplateId: "unknown_template",
      slideDrafts: [
        { role: "cover", overlayTexts: { title: "Cover" } },
        { role: "cta", overlayTexts: { title: "CTA" } }
      ]
    });

    assert.deepEqual(templateIds, ["koica_cover_01", "koica_cta_04"]);
  });
});
