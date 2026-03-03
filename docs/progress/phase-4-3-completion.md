# Phase 4-3 Completion Report

- Phase: 4-3
- Title: Test Harness Consolidation (P1)
- Status: Done
- Completed On: 2026-03-03

## 1) Goals and Scope

- Goal:
  - Consolidate duplicated smoke-test runtime utilities into a shared harness and keep all existing smoke scenarios green.
- In Scope:
  - Shared process/env/health/report helper extraction.
  - Refactor all maintained `smoke-phase-*` scripts to consume the shared harness.
  - Preserve scenario-specific assertions/flows per script.
- Out of Scope:
  - Scenario logic redesign.
  - CI pipeline redesign.

## 2) Requested Refinements Applied

1. Harness is option-driven:
   - health timeout/interval/body-check/request-timeout options
   - API spawn args/log buffer options
   - report latest/timestamp prefix options
2. Windows command robustness:
   - centralized argument quoting/spawn handling moved to harness
   - validated against `pnpm --filter @repo/api dev` path after quote rule correction
3. Migration order used for validation:
   - `smoke:2-4` -> `smoke:2-2` -> `smoke:2-5a` -> `smoke:2-1` -> `smoke:1-5a`

## 3) Implemented Deliverables

- Added shared harness:
  - `scripts/lib/smoke-harness.mjs`
  - utilities:
    - `spawnProcess`, `runCommandCapture`
    - `loadEnvFile`, `parseEnvMap`, `readSupabaseStatusEnv`
    - `fetchJson`, `requestJson`, `waitForHealth`
    - `startApiServer`, `stopProcessTree`, `tailLines`
    - `createReport`, `addCheck`, `withCheck`, `writeJsonReport`
    - `createUserWithToken`, `assert`, `sleep`, `nowIso`

- Refactored maintained smoke scripts to consume harness:
  - `scripts/smoke-phase-1-5a.mjs`
  - `scripts/smoke-phase-2-1.mjs`
  - `scripts/smoke-phase-2-2.mjs`
  - `scripts/smoke-phase-2-4.mjs`
  - `scripts/smoke-phase-2-5a.mjs`

- Result:
  - Common boilerplate removed from script-local definitions.
  - Scenario-specific checks and payload assertions remained in each script.

## 4) Validation Executed

- `pnpm smoke:2-4` -> PASS
- `pnpm smoke:2-2` -> PASS
- `pnpm smoke:2-5a` -> PASS
- `pnpm smoke:2-1` -> PASS
- `pnpm smoke:1-5a` -> PASS
- `pnpm type-check` -> PASS

## 5) Acceptance Check

1. Shared harness used by all maintained smoke scripts -> Met.
2. Existing smoke scripts still pass -> Met.

## 6) Final Result

- Phase 4-3 consolidation is complete.
- Smoke-script maintenance surface is reduced while preserving behavior.
