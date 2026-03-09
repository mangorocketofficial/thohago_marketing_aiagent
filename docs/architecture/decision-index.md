# Decision Index

## D-001

Phase  
6-3a

Decision  
Enforce scheduler slot status updates through a single transition module.

Reason  
Status mutations were occurring from multiple paths, causing drift risk between workflow/content/slot states; a canonical transition table reduces regressions and keeps invariants explicit.

## D-002

Phase  
6-4a

Decision  
Ship 6-4a as scheduler-scale core first (month overflow/day drawer/window-aware reschedule) and defer deep editor wiring to follow-up.

Reason  
Separating board-scale hardening from editor expansion kept API/IPC/realtime/UI changes testable in smaller slices and reduced cross-surface regression risk.

## D-003

Phase  
6-4a Patch

Decision  
Ship session continuity defaults and deterministic session titles together with scheduler/chat UI polish.

Reason  
Users needed immediate relaunch continuity and readable multi-session context; coupling default-session restore, fixed title generation, and control alignment removed key navigation friction in one release slice.

## D-004

Phase  
5-5

Decision  
Adopt explicit-choice-first survey with mandatory direct-input option and direct-input-only LLM mapping fallback.

Reason  
Campaign survey reliability required deterministic state progression; explicit canonical choices remove ambiguous parsing loops while still allowing flexible user input through a controlled direct-input path.

## D-005

Phase  
7-1a

Decision  
Deliver Naver Blog generation as backend-contract-first (intent/slot/persistence/fallback/metadata) and defer renderer local-save execution to follow-up.

Reason  
Stabilizing deterministic backend outputs first lowers integration risk across API, orchestrator routing, IPC metadata, and upcoming 7-1b/7-2 UI flows.

## D-006

Phase  
7-1b

Decision  
Implement Naver blog editor UX on top of a new optimistic-concurrency save-body API and content-level scheduler handoff.

Reason  
Editor copy/save/regenerate UX needed deterministic cross-surface state; adding `content:save-body` and `focusContentId` handoff avoided UI-only divergence between chat, scheduler, and storage.

## D-007

Phase  
7-1b Patch

Decision  
Treat `skill_trigger` as a preferred hint and require LLM actionability gating before entering generation skills.

Reason  
Forced routing on explicit skill selection produced wrong-topic generation for low-context user messages; deferring trigger execution until context sufficiency is confirmed prevents premature generation.

## D-008

Phase  
7-2a

Decision  
Ship Instagram generation as a backend-contract slice first (intent, survey, media composition, storage) and defer desktop survey/signed-URL UX integration to 7-2b.

Reason  
Decoupling generation reliability from desktop rollout reduced cross-surface regression risk while allowing 7-2b to integrate on stable API and golden-test contracts.

## D-009

Phase  
7-2b

Decision  
Use server-side Sharp re-compose + signed URL refresh as the canonical preview path, with client latest-wins gating for async updates.

Reason  
Keeping composition on the API avoids renderer/output drift from duplicate canvas logic, while request ordering guards prevent stale previews during fast overlay/template/image edits.

## D-010

Phase  
7-2.1

Decision  
Extract Instagram composition contracts into shared `@repo/media-engine` and route API/Desktop to the same engine.

Reason  
One shared engine removes API/Desktop drift risk and makes local compose behavior deterministic across scheduler editor and chat preview.

## D-011

Phase  
7-2.2

Decision  
Adopt asset-native template schema (`size + overlays.photos/texts/badge + header`) and retire fixed `main/sub` slot assumptions.

Reason  
Real templates require variable text/photo slot counts and id-addressable overlays; fixed two-slot schema blocked editor scalability and badge support.

## D-012

Phase  
7-2.2

Decision  
Lock the runtime render contract to `size + photos + texts` and persist overlay text only as `overlay_texts`.

Reason  
Style-specific runtime fields caused composer/editor branching and metadata drift; strict render fields with non-rendering `meta` keep composition deterministic while template visuals scale through baked assets.

## D-013

Phase  
7-2.2 Patch

Decision  
Honor explicit `skill_trigger` as deterministic initial routing and move actionability checks to skill execution flow.

Reason  
Deferring explicit trigger through LLM gating caused false misses and generic fallback responses; deterministic routing plus skill-level clarification preserves user intent and runtime stability.

## D-014

Phase  
7-2d

Decision  
Adopt vision-index-first image retrieval (`activity_image_indexes`) with deterministic tie-break and staged fallback, and set OpenAI GPT API as the phase vision provider.

Reason  
Filename semantics are unreliable on opaque assets; versioned vision metadata plus `is_latest` lookup and fixed ordering keeps selection quality stable and explainable without breaking generation continuity.

## D-015

Phase  
6-4b

Decision  
Unify campaign planning interaction around explicit campaign naming + staged multi-select survey actions, and compact scheduler channel identity to logo icons.

Reason  
This combination reduced campaign title ambiguity and removed dense card label overflow in the scheduler while preserving quick scanability for channel/status/campaign state.

## D-016

Phase  
8-1

Decision  
Use append-only `content_metrics` snapshots with latest-score reads, and run large-batch RAG/insight follow-up asynchronously.

Reason  
Snapshot history preserves performance trend context while keeping scoring/retrieval contracts stable; async follow-up prevents large metric uploads from blocking request latency.

## D-017

Phase
7-4

Decision
Make `slides[]` the canonical Instagram carousel model and derive legacy top-level overlay/image fields from slide 0.

Reason
This keeps carousel storage aligned with template-level multi-image slot semantics while preserving compatibility with existing single-image readers, cache paths, and lightweight preview surfaces.

## D-018

Phase
8-3

Decision
Use DB-backed report and run tables as the canonical autonomous analytics loop, with file export and RAG copies treated as derived outputs.

Reason
The loop needed durable retries, cooldown enforcement, report history, and UI-readable full markdown without depending on local filesystem state or process-local memory.

## D-019

Phase
7-4 Patch

Decision
Backfill Instagram carousel drafts with a repair LLM pass and deterministic 4-slide fallback when the first generation result omits `slides`.

Reason
User-visible failure was not storage or editor support but generation reliability; repairing the draft after the first miss preserved existing downstream carousel contracts while making normal feed generation consistently multi-slide.
