# Phase 5-4 Completion Report

- Phase: 5-4
- Title: Campaign Plan Workspace UX Integration (Pre-Canvas)
- Status: Done
- Completed On: 2026-03-04

## 1) Goals and Scope

- Goal:
  - Expose campaign plan artifacts (`plan_document`, `plan_chain_data`) in Workspace Inbox/Chat UX before S5c Canvas.
- In Scope:
  - Campaign plan ready system notification projection in chat timelines.
  - Workspace Inbox data API expansion with campaign/content preview payload.
  - Campaign Inbox decision policy: Approve/Reject only.
  - Chat-native campaign revision flow:
    - user natural-language revision request
    - rerun step inference
    - cascade rerun via existing 5-3 `rerun_from_step` mechanism.
  - Frontend wiring to backend inbox API and campaign plan detail preview.
  - ko/en i18n wiring for campaign plan notification/Inbox labels.
- Out of Scope:
  - Canvas artifact editor/section-level editing (S5c scope).

## 2) Implemented Deliverables

1. Phase 5-4 plan document updated with accepted product/backend decisions:
   - `docs/phase5_campaign_plan.md/phase-5-4-workspace-ux-plan.md`
   - Approve/Reject-only Inbox policy, chat-native revision, backend changes table, acceptance criteria update.
2. Campaign skill upgraded for chat-driven revision intent handling:
   - `apps/api/src/orchestrator/skills/campaign-plan/index.ts`
   - Skill version bumped to `5.4.0`.
   - In `await_campaign_approval`, user messages are classified as:
     - revision intent -> infer rerun step (`step_a`/`step_b`/`step_c`/`step_d`) -> apply revision path.
     - non-revision -> normal conversational response path.
3. Campaign chain projection updated for campaign-ready system notifications:
   - `apps/api/src/orchestrator/chat-projection.ts`
   - `workflow_proposed` system message metadata and campaign-ready copy aligned for Workspace CTA flow.
4. Backend workflow payload and inbox aggregation expanded:
   - `apps/api/src/orchestrator/steps/campaign.ts`
   - `apps/api/src/orchestrator/service.ts`
   - Workflow payload now carries campaign plan preview data (`plan_document`, `plan_summary`, `rerun_from_step` when relevant).
   - Added org-scoped workspace inbox aggregator returning workflow + campaign/content preview.
5. Inbox API route added:
   - `apps/api/src/routes/sessions.ts`
   - `GET /orgs/:orgId/workspace-inbox-items`
6. Desktop runtime bridge added for inbox API:
   - `apps/desktop/electron/main.mjs`
   - `apps/desktop/electron/preload.mjs`
   - `apps/desktop/electron/preload.cjs`
   - `apps/desktop/src/global.d.ts`
   - Added `chat:list-inbox-items` IPC and `chat.listInboxItems()` runtime contract.
7. Frontend Inbox/Chat integration updated:
   - `apps/desktop/src/context/ChatContext.tsx`
   - `apps/desktop/src/components/workspace/InboxPanel.tsx`
   - `apps/desktop/src/components/workspace/WorkspaceChatPanel.tsx`
   - `apps/desktop/src/components/AgentChatWidget.tsx`
   - `apps/desktop/src/styles.css`
   - Campaign Inbox card now:
     - renders plan summary + expandable markdown detail
     - exposes only Approve/Reject actions
     - guides revision via chat message (no separate revision button).
8. i18n keys updated:
   - `apps/desktop/src/i18n/locales/ko.json`
   - `apps/desktop/src/i18n/locales/en.json`
   - Added/connected `campaignPlan.*` labels for CTA and Inbox texts.

## 3) Validation Executed

1. `pnpm --filter @repo/api type-check` -> PASS
2. `pnpm --filter @repo/desktop type-check` -> PASS
3. `pnpm --filter @repo/api test:unit` -> PASS (6 tests)

## 4) Acceptance Check

1. Campaign chain completion emits workflow-proposed system notification with campaign metadata -> Met.
2. Notification CTA routes user to Workspace Inbox handoff target -> Met.
3. Inbox campaign card renders summary + expandable `plan_document` markdown -> Met.
4. Campaign Inbox actions are restricted to Approve/Reject -> Met.
5. Chat natural-language revision triggers inferred rerun step and cascade rerun -> Met.
6. Inbox API returns workflow + campaign/content preview payload needed by UI -> Met.
7. CTA rendering works in both Workspace chat panel and Agent widget -> Met.
8. ko/en i18n labels are wired for campaign plan flow -> Met.
9. API/Desktop type-check and API unit tests pass -> Met.

## 5) Final Result

- Phase 5-4 is complete.
- Campaign planning UX now works end-to-end in Workspace (Inbox + Chat) without waiting for Canvas:
  - users review plans in Inbox,
  - approve/reject directly,
  - request revisions naturally in chat with backend rerun orchestration.
