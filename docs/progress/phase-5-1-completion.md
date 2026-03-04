# Phase 5-1 Completion Report

- Phase: 5-1
- Title: File Detection to Quiet Folder Updates
- Status: Done
- Completed On: 2026-03-04

## 1) Goals and Scope

- Goal:
  - Convert file detection from auto-session kickoff into a quiet context signal and surface it as folder-level pending updates in Workspace Session Rail.
- In Scope:
  - Stop trigger ingestion from creating orchestration sessions.
  - Remove detect-time AI message generation path.
  - Add folder update list/acknowledge API and desktop IPC wiring.
  - Add Session Rail "New Files" badges with chat prompt prefill flow.
  - Add shared folder-context/folder-diff types.
- Out of Scope:
  - Skill intent routing redesign (covered in Phase 5-0).
  - Legacy session completion flow changes.

## 2) Implemented Deliverables

1. Trigger ingest no longer auto-starts sessions:
   - `apps/api/src/orchestrator/service.ts`
   - Removed pending-trigger queue/start logic (`enqueueTrigger`, `startSessionForTrigger`, `tryStartNextPendingForOrg`).
   - Added folder update query/ack services:
     - `listPendingFolderUpdatesForOrg`
     - `acknowledgePendingFolderUpdatesForFolder`
2. Detect-time LLM path removed:
   - `apps/api/src/orchestrator/ai.ts`
   - Removed `generateDetectMessage`.
3. Trigger routes expanded for folder updates:
   - `apps/api/src/routes/trigger.ts`
   - `POST /trigger` now insert-only (compatibility response keeps `session_id: null`, `queued: false`).
   - Added:
     - `GET /orgs/:orgId/folder-updates`
     - `POST /orgs/:orgId/folder-updates/:activityFolder/acknowledge`
4. Folder context utility introduced:
   - `apps/api/src/orchestrator/folder-context.ts`
   - Added safe live folder scan and deterministic diff helpers.
5. API/shared type surface updated:
   - `apps/api/src/orchestrator/types.ts`
   - `packages/types/src/index.ts`
   - Added pending-folder summary and folder context/diff contracts.
6. Desktop runtime + UI integrated:
   - Electron IPC:
     - `apps/desktop/electron/main.mjs`
     - `apps/desktop/electron/preload.mjs`
     - `apps/desktop/electron/preload.cjs`
   - Renderer wiring:
     - `apps/desktop/src/global.d.ts`
     - `apps/desktop/src/context/SessionSelectorContext.tsx`
     - `apps/desktop/src/components/workspace/SessionRailPanel.tsx`
     - `apps/desktop/src/i18n/locales/en.json`
     - `apps/desktop/src/i18n/locales/ko.json`
     - `apps/desktop/src/styles.css`
   - Added Session Rail `New Files` section:
     - grouped folder badges
     - badge click prefill prompt (i18n template)
     - acknowledge pending rows and refresh.

## 3) Validation Executed

1. `pnpm --filter @repo/types type-check` -> PASS
2. `pnpm --filter @repo/api type-check` -> PASS
3. `pnpm --filter @repo/desktop type-check` -> PASS
4. `node --check apps/desktop/electron/main.mjs` -> PASS
5. `node --check apps/desktop/electron/preload.mjs` -> PASS
6. `node --check apps/desktop/electron/preload.cjs` -> PASS

## 4) Acceptance Check

1. File detection still writes `pipeline_triggers` without auto-session creation -> Met.
2. Detect-time AI generation path removed -> Met.
3. Session Rail shows grouped pending folder updates -> Met.
4. Badge click pre-fills folder prompt and acknowledges pending rows -> Met.
5. Existing resume/session flow remains available for already-running sessions -> Met.

## 5) Final Result

- Phase 5-1 is complete.
- File detection is now a low-cost notification signal, and campaign initiation is driven explicitly by user action from Workspace.

