# Phase 1-7d Completion Report

- Phase: 1-7d
- Title: Instagram Graph Business Discovery Crawler Replacement
- Status: Done
- Completed On: 2026-03-01

## 1) Goals and Scope

- Goal:
  - Replace unstable Instagram scraping path with Graph Business Discovery as the primary data source.
  - Keep onboarding compatibility by preserving fallback behavior and response shape.
- In Scope:
  - Instagram crawler replacement in desktop onboarding crawl pipeline.
  - Business account ID resolution hardening for Graph API calls.
  - Environment key canonicalization guidance and test script alignment.
- Out of Scope:
  - Instagram publishing/comment/DM APIs.
  - Webhook integration.
  - Non-Instagram crawler redesign.

## 2) Completed Deliverables

- Desktop crawler replacement:
  - `apps/desktop/electron/crawler/instagram.mjs`
- Test harness alignment:
  - `scripts/test-instagram-graph-api.mjs`
- Environment template update:
  - `.env.example`
- Progress documentation:
  - `agent.md`
  - `docs/progress/phase-index.md`
  - `docs/progress/phase-1-7d-completion.md`

## 3) Key Implementation Decisions

- Source priority changed to:
  - Graph Business Discovery (primary)
  - Legacy Instagram JSON endpoint (fallback)
  - HTML metadata fallback (last resort)
- Business account ID resolution order:
  - Explicit env ID (`INSTAGRAM_BUSINESS_ACCOUNT_ID` and aliases)
  - `/me?fields=instagram_business_account{id,username}`
  - `/me/accounts?fields=id,name,instagram_business_account{id,username}`
- Canonical runtime env keys:
  - `GRAPH_META_ACCESS_TOKEN`
  - `INSTAGRAM_BUSINESS_ACCOUNT_ID`
  - `INSTAGRAM_GRAPH_VERSION` (optional, default `v23.0`)
- Output compatibility:
  - Preserved `status/data/error` envelope and existing onboarding crawl contract.
  - Added Graph-origin fields without breaking fallback consumption (`source`, counts, profile fields, recent posts).

## 4) Contract and Compatibility

- Preserved:
  - `runOnboardingCrawl` source contract (`done|partial|failed` + `data` + `error`)
  - Existing onboarding synthesize flow input shape from crawler aggregate
- No API endpoint or DB schema change introduced.

## 5) Validation and Test Results

- `node --check apps/desktop/electron/crawler/instagram.mjs` -> PASS
- `node --check scripts/test-instagram-graph-api.mjs` -> PASS
- Runtime functional check (`crawlInstagram` with Graph token + business account id) -> PASS
  - `status: done`
  - `source: graph_api_business_discovery`
  - Counts and recent posts returned
- Integration check (`runOnboardingCrawl` with Instagram URL) -> PASS
  - `sources.instagram.status: done`
  - `sources.instagram.data.source: graph_api_business_discovery`

## 6) Risks and Follow-up

- Remaining risks:
  - Token expiration and permission drift can break Graph path.
  - Missing/incorrect business account ID or page linkage causes fallback to legacy paths.
  - Graph rate limits and target privacy settings may reduce available fields.
- Follow-up recommendations:
  - Add proactive token/permission preflight in onboarding diagnostics.
  - Add telemetry for Graph success rate vs fallback rate.
  - Add alerting for repeated `business_discovery` permission failures.

## 7) Handoff

- Ready conditions:
  - Instagram crawl path is Graph-first and verified in local runtime.
  - Legacy fallbacks remain available for resilience.
  - Env key guidance has been normalized for operation.
- Runtime minimum:
  - `GRAPH_META_ACCESS_TOKEN`
  - `INSTAGRAM_BUSINESS_ACCOUNT_ID`
