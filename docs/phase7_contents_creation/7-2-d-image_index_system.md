# Phase 7-2d: Vision-Based Image Index System for Instagram Auto Selection

- Date: 2026-03-05
- Status: In Progress
- Scope: Replace filename-based image auto-selection with vision-grounded indexing and retrieval.
- Depends on: Phase 7-2a, 7-2b, 7-2.1, 7-2.2
- Constraints: `local_files` table is removed; watcher + pipeline trigger flow is the active source of file events.

---

## 1) Problem

Current auto mode selects images from filename/path heuristics.
This fails on opaque names (`1.jpg`, `IMG_1024.jpg`) and produces unstable relevance.

---

## 2) Goal

Build a deterministic image selection system based on vision metadata, not filename semantics.

Success criteria for auto mode:

1. Retrieval uses visual meaning (summary, objects, scene, OCR, safety), not filename.
2. Selection remains robust for opaque filenames.
3. Generation does not break when index coverage is missing/late (controlled fallback).

---

## 3) Non-Goals

1. No redesign of Instagram template rendering.
2. No replacement of manual image picker UX.
3. No fully offline vision inference on client.

---

## 4) Architecture

### Ingestion path

`Desktop Watcher -> GPT Vision call -> API /image-index/upsert -> activity_image_indexes`

1. Watcher detects image add/change/delete.
2. Desktop calls OpenAI GPT API for vision extraction.
3. Desktop submits normalized payload to API internal upsert endpoint.
4. API stores versioned index row and maintains latest-row pointer.
5. Delete events call API delete endpoint and soft-delete the latest row.

### Retrieval path (Instagram auto mode)

`topic + campaign context -> indexed query -> deterministic scoring -> diversity guard -> top-k`

1. Build query text from topic/campaign context.
2. Retrieve latest ready rows in same `activity_folder`.
3. Rank using weighted deterministic score.
4. Apply diversity guard to avoid near-duplicates.
5. Return top `requiredCount`.

---

## 5) Data Model (New)

Create `public.activity_image_indexes`:

1. Identity/scope: `id`, `org_id`, `source_id(relative_path)`, `activity_folder`, `file_name`
2. File versioning: `file_size_bytes`, `file_modified_at`, `file_content_hash`
3. Index status: `status(ready|failed|deleted)`, `last_error`, `indexed_at`, `updated_at`
4. Vision payload: `vision_model`, `schema_version`, `summary_text`, `objects_json`, `scene_tags`, `ocr_text`, `ocr_language`, `safety_json`
5. Retrieval helpers: `search_text`, `is_latest`

Unique/version strategy:

1. Immutable version key: `(org_id, source_id, file_content_hash)`
2. Retrieval pointer: `is_latest=true` on one active version per `(org_id, source_id)`
3. Selector only reads `is_latest=true` rows for deterministic behavior and simple query plans.

---

## 6) Vision Provider Decision

Vision API provider is fixed to **OpenAI GPT API** for this phase.

1. Desktop watcher calls GPT vision model directly.
2. Model is configurable by env (default lightweight GPT vision-capable model).
3. API layer stores normalized output only; API does not read local files directly.

---

## 7) Vision Index Contract (JSON, strict)

Payload is schema-versioned and must pass strict validation:

```json
{
  "schema_version": "1",
  "summary_text": "Korean one-paragraph visual summary",
  "scene_tags": ["outdoor", "volunteer", "group-photo"],
  "objects": [
    { "label": "person", "confidence": 0.98 },
    { "label": "banner", "confidence": 0.81 }
  ],
  "ocr_text": "행사 모집 안내 ...",
  "ocr_language": "ko",
  "safety": { "adult": "unlikely", "violence": "unlikely" }
}
```

OCR normalization rules:

1. UTF-8 only
2. Unicode NFKC normalization
3. Collapse whitespace/newlines
4. Max length cap and control-char strip
5. Keep `ocr_language` for downstream ranking/diagnostics

---

## 8) Auto Selection Algorithm

### Candidate retrieval

1. Primary scope: `org_id + activity_folder + is_latest=true + status='ready'`
2. If empty: secondary scope `org_id + is_latest=true + status='ready'` (org-wide)
3. Cap candidate pool (`N=200`) before ranking

### Ranking

Score formula:

`score = 0.55 * semantic + 0.30 * keyword_match + 0.15 * recency`

Where:

1. `semantic`: embedding similarity when available, otherwise normalized token similarity on `search_text`
2. `keyword_match`: overlap on `summary + scene_tags + objects + ocr`
3. `recency`: normalized by `file_modified_at`

Deterministic tie-break (mandatory):

1. `score DESC`
2. `file_modified_at DESC`
3. `source_id ASC`

### Diversity guard

1. Penalize near-duplicate scene clusters
2. Cap per-cluster selections to avoid repeated shots

---

## 9) Safety Policy (Selection-Time)

Safety metadata is not storage-only; it affects retrieval:

1. Block explicit high-risk categories (configurable hard filter)
2. Apply score penalty to uncertain/medium-risk categories
3. Record safety filter reason in selection telemetry

---

## 10) API and Runtime Changes

### API

1. Add internal route: `POST /image-index/upsert` (API token required)
2. Add internal route: `POST /image-index/delete` (soft delete)
3. Instagram selector reads `activity_image_indexes` (not `local_files`)
4. Keep fallback path when no ready index exists

### Desktop (Watcher runtime)

1. Add image vision indexing worker branch for image files
2. Call GPT Vision API and submit strict payload to API
3. Keep async/non-blocking watcher UX
4. Cache/skip unchanged files via `file_content_hash`

---

## 11) Fallback Policy (Mandatory, staged)

If no ready rows in activity folder:

1. Stage 1: try org-wide latest ready index rows
2. Stage 2: if still empty, use recency-only fallback from latest non-deleted rows
3. Never fail Instagram generation due to missing index
4. Record telemetry reason: `image_index_unavailable`

---

## 12) Rollout Plan

### Milestone A: Schema + Contracts

1. Supabase migration for `activity_image_indexes`
2. Internal API endpoints (`upsert/delete`)
3. Strict payload validator and shared contract types

### Milestone B: Ingestion Pipeline

1. Desktop watcher event wiring to image index worker
2. GPT vision extraction + API submission
3. Observability counters: ready/failed/deleted, last_error

### Milestone C: Auto Selector Cutover

1. Replace filename-only retrieval with index-based retrieval
2. Add scoring + diversity + deterministic tie-break
3. Keep staged fallback policy for continuity

---

## 13) Validation

1. Unit tests for payload validation and ranking determinism
2. Integration tests for upsert -> query -> selection flow
3. Regression with opaque filenames (`1.jpg`, `2.jpg`, `3.jpg`) for relevance uplift
4. Manual repeatability test: same input yields stable ordered output

---

## 14) Acceptance Criteria

1. Auto mode no longer depends on filename meaning
2. Indexed images are queryable by topic/campaign intent
3. Selection quality remains acceptable with generic filenames
4. Missing index does not break generation path
5. Telemetry includes index coverage and selection source breakdown

---

## 15) Risks and Mitigations

1. Vision cost growth
Mitigation: hash-based cache + skip unchanged.

2. Bulk upload latency
Mitigation: async queue + staged fallback.

3. OCR/object extraction noise
Mitigation: multi-signal ranking + deterministic tie-break.

4. Provider/model drift
Mitigation: schema versioning + model/version metadata persistence.

---

## 16) Decision Summary

Phase 7-2d adopts a vision-index-first strategy for Instagram `auto` image selection.
Filename/path remain transport identifiers only, not semantic ranking signals.
Vision extraction provider for this phase is OpenAI GPT API.
