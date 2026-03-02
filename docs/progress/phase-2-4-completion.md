# Phase 2-4 Completion Report

- Phase: 2-4
- Title: Local File Indexing Pipeline
- Status: Done
- Completed On: 2026-03-02

## 1) Goals and Scope

- Goal:
  - Connect desktop local-file watcher events to `local_doc` RAG ingestion.
  - Persist indexed local document context for Tier-2 retrieval.
  - Prevent unnecessary re-embedding on app restart when files are unchanged.
- In Scope:
  - Desktop text extraction/indexing modules and watcher integration.
  - API `POST/DELETE /rag/index-document` routes with auth/subscription guards.
  - Recursive watcher depth support for nested project folders.
  - Signature-based unchanged skip (`file_content_hash`, `file_modified_at`, `file_size_bytes`).
  - Phase 2-4 smoke test automation and report generation.
- Out of Scope:
  - OCR/vision extraction for scanned PDFs or image/video content.
  - HWP/PPTX full text extraction.
  - UI-level per-file indexing status dashboard.

## 2) Completed Deliverables

- Desktop text extraction module:
  - `apps/desktop/electron/text-extractor.mjs`
- Desktop RAG index client:
  - `apps/desktop/electron/rag-indexer.mjs`
- Desktop watcher/runtime integration:
  - `apps/desktop/electron/main.mjs`
  - `apps/desktop/electron/watcher.mjs`
  - `apps/desktop/electron/constants.mjs`
- API indexing routes:
  - `apps/api/src/routes/rag.ts`
  - `apps/api/src/index.ts`
- Dependency and script updates:
  - `apps/desktop/package.json`
  - `package.json`
  - `pnpm-lock.yaml`
- Smoke test:
  - `scripts/smoke-phase-2-4.mjs`
  - `docs/reports/phase-2-4-test-result.json`

## 3) Key Implementation Decisions

- Guarded indexing route:
  - Reused `requireApiSecret` to support existing token header behavior.
  - Applied `requireActiveSubscription` on both index/delete routes.
- Metadata-first safety:
  - Non-extractable/short/failed extraction files are still indexed as metadata-only chunks.
  - `text_extracted` metadata differentiates full-text vs fallback rows.
- Nested folder support:
  - Removed watcher depth cap and switched initial scan to recursive traversal.
  - `activity_folder` resolves to first directory under watch root for nested paths.
- Duplicate cost reduction:
  - Added unchanged signature check before embedding generation.
  - If unchanged, route returns `{ skipped: true, reason: "unchanged" }` and existing chunk count.
- Startup/auth resilience:
  - Added startup session refresh and watcher runtime resume after auth restoration.

## 4) Validation and Test Results

- 2026-03-02 `pnpm --filter @repo/api type-check` -> PASS
- 2026-03-02 `pnpm --filter @repo/desktop type-check` -> PASS
- 2026-03-02 `pnpm type-check` -> PASS
- 2026-03-02 `pnpm smoke:2-4` -> PASS
  - Verified:
    - 401 auth guard
    - 402 subscription guard
    - text indexing and metadata fallback
    - unchanged reindex skip (`skipped: true`, `reason: "unchanged"`)
    - delete behavior
    - `local_doc` retriever RPC visibility

## 5) Handoff

- Ready conditions:
  - Local file add/change/delete events now propagate to `local_doc` embeddings.
  - Nested project folders under watch root are indexed (not depth-limited).
  - Unchanged files are skipped to avoid redundant embedding costs on restarts.
  - Smoke coverage exists for core Phase 2-4 contracts.
