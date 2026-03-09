import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rankAndSelectCandidates, type ImageSelectionCandidate } from "../src/orchestrator/skills/instagram-generation/image-selection-ranking";

const buildCandidate = (overrides: Partial<ImageSelectionCandidate>): ImageSelectionCandidate => ({
  fileId: overrides.fileId ?? "file-id",
  fileName: overrides.fileName ?? "sample.jpg",
  relativePath: overrides.relativePath ?? "activity/sample.jpg",
  fileSize: overrides.fileSize ?? 1024,
  detectedAt: overrides.detectedAt ?? "2026-03-05T10:00:00.000Z",
  modifiedAtMs: overrides.modifiedAtMs ?? Date.parse("2026-03-05T10:00:00.000Z"),
  searchText: overrides.searchText ?? "outdoor volunteer group photo",
  sceneTags: overrides.sceneTags ?? ["outdoor", "group"],
  safety: overrides.safety ?? {},
  fileContentHash: overrides.fileContentHash ?? "abc123"
});

describe("Phase 7-2d image selection ranking", () => {
  it("keeps deterministic tie-break order for same score and timestamp", () => {
    const selected = rankAndSelectCandidates({
      queryText: "outdoor volunteer",
      requiredCount: 2,
      candidates: [
        buildCandidate({
          fileId: "b",
          relativePath: "activity/b.jpg",
          modifiedAtMs: 1000
        }),
        buildCandidate({
          fileId: "a",
          relativePath: "activity/a.jpg",
          modifiedAtMs: 1000
        })
      ]
    });

    assert.equal(selected.length, 2);
    assert.equal(selected[0]?.fileId, "a");
    assert.equal(selected[1]?.fileId, "b");
  });

  it("applies diversity guard before filling remaining slots", () => {
    const selected = rankAndSelectCandidates({
      queryText: "volunteer outdoor campaign",
      requiredCount: 2,
      candidates: [
        buildCandidate({
          fileId: "c1",
          relativePath: "activity/c1.jpg",
          searchText: "volunteer outdoor campaign banner",
          sceneTags: ["outdoor", "group"],
          modifiedAtMs: 3000
        }),
        buildCandidate({
          fileId: "c2",
          relativePath: "activity/c2.jpg",
          searchText: "volunteer outdoor campaign people",
          sceneTags: ["outdoor", "group"],
          modifiedAtMs: 2000
        }),
        buildCandidate({
          fileId: "c3",
          relativePath: "activity/c3.jpg",
          searchText: "indoor meeting campaign",
          sceneTags: ["indoor", "meeting"],
          modifiedAtMs: 2500
        })
      ]
    });

    assert.equal(selected.length, 2);
    assert.deepEqual(
      selected.map((entry) => entry.fileId),
      ["c1", "c3"]
    );
  });

  it("blocks likely unsafe candidates", () => {
    const selected = rankAndSelectCandidates({
      queryText: "festival volunteer",
      requiredCount: 1,
      candidates: [
        buildCandidate({
          fileId: "unsafe",
          relativePath: "activity/unsafe.jpg",
          safety: { adult: "likely" },
          modifiedAtMs: 5000
        }),
        buildCandidate({
          fileId: "safe",
          relativePath: "activity/safe.jpg",
          safety: { adult: "unlikely" },
          modifiedAtMs: 1000
        })
      ]
    });

    assert.equal(selected.length, 1);
    assert.equal(selected[0]?.fileId, "safe");
  });

  it("supports carousel-sized selections above four images", () => {
    const selected = rankAndSelectCandidates({
      queryText: "volunteer outdoor campaign",
      requiredCount: 6,
      candidates: Array.from({ length: 6 }, (_, index) =>
        buildCandidate({
          fileId: `carousel-${index + 1}`,
          relativePath: `activity/carousel-${index + 1}.jpg`,
          searchText: `volunteer outdoor campaign image ${index + 1}`,
          sceneTags: [`cluster-${index + 1}`],
          modifiedAtMs: 6000 - index
        })
      )
    });

    assert.equal(selected.length, 6);
    assert.deepEqual(
      selected.map((entry) => entry.fileId),
      ["carousel-1", "carousel-2", "carousel-3", "carousel-4", "carousel-5", "carousel-6"]
    );
  });
});
