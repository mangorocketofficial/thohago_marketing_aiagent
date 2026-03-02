# Phase 2-3 Patch v1.1: Channel-Aware Tier-2 Content Retrieval

- Version: v1.1
- Date: 2026-03-02
- Status: Ready for implementation

## Problem

In `apps/api/src/orchestrator/rag-context.ts`, Tier-2 `content` retrieval does not prioritize channel match. This can pull Naver Blog-style examples while generating Instagram content, which degrades output format and CTA style consistency.

## Patch Summary

This patch applies three concrete fixes:

1. Replace generic content retrieval with a 2-stage channel-aware strategy.
2. Remove unsupported `created_after` usage (not supported by current `RagSearchOptions` / RPC contract).
3. Use app-side filtering for cross-channel fallback (RPC supports `@>` only; no `$ne`).

## Stage Design

### Stage 1: Same-channel priority

- Query `source_types: ["content"]` with `metadata_filter: { channel }`.
- Threshold: `min_similarity = 0.65`.
- `top_k = 3`.

### Stage 2: Cross-channel fallback (conditional)

- Only run when Stage-1 results are fewer than `2`.
- Run broad `content` search with stricter threshold `0.75`.
- Filter client-side:
  - exclude same-channel rows
  - exclude IDs already returned by Stage-1
- Keep up to `2` rows.

## Prompt Section Split

Tier-2 content must be split into separate sections:

- `Same-channel past content (format + hashtags reference)`
- `Cross-channel related content (message only; ignore format)`

This gives explicit instruction boundaries to the model.

## Budget Split

Within existing `env.ragTier2ContentBudget`:

- Same-channel: `content_budget - 300`
- Cross-channel: `300` (capped by available content budget)

This preserves total Tier-2 budget and keeps cross-channel context lightweight.

## Implementation Notes

- No DB migration required.
- No RPC signature change required.
- Latency impact is conditional: Stage-2 runs only when same-channel coverage is insufficient.

## Acceptance Criteria

- Same-channel retrieval is attempted first.
- Cross-channel query runs only when same-channel count `< 2`.
- Cross-channel threshold is stricter than same-channel.
- Prompt sections are clearly separated by same vs cross-channel intent.
- No `created_after` field is used in retriever calls.
- No `$ne` metadata filter is used in RPC calls.
