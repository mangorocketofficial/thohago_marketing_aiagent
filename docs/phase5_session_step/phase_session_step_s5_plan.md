# Step S5 Development Plan (Workspace UX Unification: Queue + Canvas + Chat)

- Date: 2026-03-04
- Scope: Phase Session Redesign - Step S5
- Status: Draft for implementation

## 1) Objective

Unify the user workflow around a single, explicit Workspace surface and remove session ambiguity by separating:

1. Approval execution (`Work Queue`)
2. Conversational instruction/editing (`Session Chat`)
3. Artifact preview/editing (`Canvas`)

S5 completes the transition from "multi-page chat surfaces" to "single Workspace operating model."

## 2) Problem Statement (Current UX Gaps)

1. Users cannot reliably understand which session they are currently operating in.
2. Action-card approval state and normal chat interaction conflict, creating blocked-message confusion.
3. The current page structure suggests chat should be fragmented by board/page context.
4. End-to-end user workflow is not clearly expressed in UI despite having two practical operation families:
   - A) Campaign pipeline (plan approval -> scheduling -> automation)
   - B) On-demand single content generation/edit

## 3) Product Direction (Decisions Finalized)

1. Keep `A-B-C` layout structure as the persistent workspace shell:
   - A: `Work Queue`
   - B: `Work Surface` (`Canvas` + `Session Chat` stacked)
   - C: `Session/Context Rail` (session management only)
2. Remove standalone global `Agent Chat` page as a primary navigation destination.
3. Keep chat persistent and session-scoped, but never auto-switch sessions by navigation.
4. Approval gating applies to queue actions only, not to general chat input in unrelated active work.
5. Treat workflow A and B as separate work modes sharing one unified workspace shell.

## 4) Information Architecture

### 4.1 Top-level Navigation

Use top bar primary routes:

1. `Workspace` (operational surface for creation/approval/editing)
2. `Dashboard` (runtime/ops visibility)
3. `Brand Review` (reference context)
4. `Analytics` (performance reporting)
5. `Settings`

`Workspace` is the only place where queue/canvas/chat session operations occur.

### 4.2 Workspace Layout

1. Left (`A`): Work Queue
   - Campaign approvals
   - Content approvals
   - System suggestions
2. Center (`B`): Work Surface
   - Top: Canvas (preview/editor)
   - Bottom: Session Chat (same active session, linked artifact context)
3. Right (`C`): Session/Context Rail
   - Session identity + metadata
   - Session switch/new session/recent/all list
   - No duplicate full chat UI

### 4.3 Mobile/Narrow Behavior

1. Preserve model, not layout:
   - Primary surface defaults to Canvas
   - Queue and Session Rail as drawers/tabs
   - Chat as docked bottom sheet
2. Keep a single active session/artifact context across all toggles.

## 5) Workflow Model

### 5.1 Flow A (Campaign Pipeline)

1. Trigger source:
   - User manual request or folder-detected trigger
2. AI proposes campaign plan
3. Queue approval/reject/revise actions
4. On approval: scheduling and automation execution

### 5.2 Flow B (On-demand Content)

1. User requests immediate content via chat
2. Artifact is generated and opened in Canvas
3. User edits directly or iterates through chat
4. Optional approval path when required by policy

### 5.3 Key Unification Rule

Flow A and B share the same workspace shell and same session continuity model.  
Difference is work intent and policy, not UI location.

## 6) Session and State Rules

1. `selectedSessionId` remains explicit and user-controlled.
2. No implicit session switch on page navigation.
3. Queue item focus can suggest a session/artifact but requires explicit switch action.
4. Session chat remains available while queue contains pending approvals.
5. "Approval-required" guard applies to queue actions, not as a global hard stop for all messaging.
6. Legacy messages stay read-only and isolated.

## 7) Artifact-Chat Linking Model

Do not require LLM chat to be the direct execution engine for all artifact creation.  
Use provenance linking regardless of source (worker/CLI/chat/user).

### 7.1 Proposed Domain Objects

1. `work_items`
   - unit of user-visible work context
   - includes mode (`campaign_pipeline` | `on_demand_content`)
2. `artifacts`
   - concrete outputs (image/caption/plan/etc.)
   - versioned
3. `artifact_links` (or equivalent relation table)
   - links artifact to session/message/action-card/trigger provenance

### 7.2 UI Contract

1. Opening "linked artifact" from queue or chat resolves to the same Canvas deep link.
2. Chat messages from Canvas context carry `artifact_id` and `work_item_id` metadata.
3. Canvas version history reflects source (`worker`, `ai`, `user`) and change reason.

## 8) UI Behavior Contract

### 8.1 Queue (A)

1. Approval-focused actions only.
2. Card can open linked artifact in Canvas.
3. Card can navigate to related workflow context without forcing hidden auto-switch.

### 8.2 Work Surface (B)

1. Canvas and chat are co-visible (stacked split).
2. Default split ratio: `Canvas 70% / Chat 30%`, user-adjustable.
3. Chat input is context-bound to current session and optional linked artifact.

### 8.3 Session Rail (C)

1. Current session metadata always visible.
2. Explicit actions:
   - `Select session`
   - `New session`
   - `Open linked work`
3. No duplicate full message timeline here.

## 9) Scope

In scope:

1. Workspace IA/UI unification with A-B-C persistent shell.
2. Agent Chat page deprecation from primary navigation.
3. Canvas + chat co-visible center layout.
4. Queue/chat policy separation to remove hard UX conflict.
5. Artifact provenance linking contract.
6. Session clarity improvements and explicit switching contract.

Out of scope:

1. Full collaborative multi-user editing policy redesign.
2. External publishing orchestration redesign beyond current integration boundary.
3. Non-essential API expansion unrelated to workspace unification.

## 10) Implementation Plan

1. Navigation restructuring:
   - Move operation focus into `Workspace` route.
   - Remove standalone Agent Chat nav item (temporary redirect allowed).
2. Workspace shell refactor:
   - Introduce A-B-C persistent composition.
3. Work Surface refactor:
   - Implement Canvas + Chat stacked panel in B.
4. Queue policy adjustment:
   - Keep approval gating in queue actions.
   - Remove unrelated global messaging blockage semantics.
5. Session rail cleanup:
   - Keep session selector/list/recommend/new logic in C.
6. Artifact linking:
   - Add/extend provenance metadata and deep-link resolver.
7. i18n/style/accessibility updates.
8. Backward compatibility and migration patching.

## 11) File-Level Plan (Initial Target)

1. `apps/desktop/src/layouts/MainLayout.tsx`
2. `apps/desktop/src/components/Sidebar.tsx`
3. `apps/desktop/src/components/ContextPanel.tsx` (or successor workspace rail component)
4. `apps/desktop/src/pages/AgentChat.tsx` (deprecation/redirect strategy)
5. `apps/desktop/src/pages/*` top navigation integration
6. `apps/desktop/src/context/NavigationContext.tsx`
7. `apps/desktop/src/context/SessionSelectorContext.tsx`
8. `apps/desktop/src/context/ChatContext.tsx`
9. `apps/desktop/src/components/session/*`
10. `apps/desktop/src/styles.css`
11. `apps/desktop/src/i18n/locales/en.json`
12. `apps/desktop/src/i18n/locales/ko.json`
13. `apps/api/src/orchestrator/*` (state/policy and provenance support where needed)

## 12) Validation Plan

Automated:

1. `pnpm type-check`
2. Existing session smoke baseline (`pnpm smoke:s3`) where environment is available
3. New S5 smoke coverage:
   - queue -> linked artifact -> canvas open
   - canvas chat edits with artifact context
   - explicit session switch persistence
   - no forced chat blockage from unrelated pending queue state

Manual QA:

1. User can always identify current active session and linked artifact.
2. Queue approval actions do not silently hijack chat session.
3. Chat remains usable while approvals are pending (within policy boundaries).
4. Opening artifact from queue and chat resolves to same canvas state.
5. Removing standalone Agent Chat does not break operational tasks.
6. Desktop and mobile/narrow layouts preserve context continuity.

## 13) Acceptance Criteria

1. Workspace becomes the single operational surface for queue/canvas/chat workflows.
2. Session identity is continuously visible and explicit-switch only.
3. Pending approvals no longer create misleading "chat blocked" confusion for unrelated work.
4. Artifact editing supports both direct user edits and AI-assisted chat iterations in one continuous UX.
5. Queue and chat connect through shared artifact/work-item provenance.
6. Legacy behavior remains safe and read-only where applicable.
7. System is ready for folder-based routing expansion with minimal IA change.

## 14) Rollout and Risk Control

1. Roll out behind feature flag for workspace unification.
2. Keep temporary redirect from old Agent Chat route.
3. Preserve existing session selector persistence contract.
4. Keep rollback path at UI composition layer first, then policy toggles second.

## 15) Open Questions (To Resolve Before Build Freeze)

1. Exact schema for `work_items/artifacts/artifact_links` (new tables vs metadata extension).
2. Approval policy exceptions for specific content classes in flow B.
3. Final mobile breakpoint behavior and interaction density for stacked chat.

