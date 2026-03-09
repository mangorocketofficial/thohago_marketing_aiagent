# Tech Debt Register

DEBT-001

Description  
Scheduler timezone resolution falls back to client timezone or UTC when org-level timezone is not explicitly configured.

Reason  
No dedicated org timezone contract/store is wired yet in scheduler API path.

Affects  
Phase 6-4a

DEBT-002

Description  
Scheduler realtime path creates an isolated Supabase client instead of reusing app-level client lifecycle.

Reason  
Delivered 6-3a quickly with minimal coupling; client lifecycle unification deferred.

Affects  
Phase 6-4a

DEBT-003

Description  
Scheduler day drawer currently uses cursor paging without list virtualization for extremely dense dates.

Reason  
6-4a focused on safe month overflow decomposition first; virtualization layer deferred to keep UI/data contract rollout smaller.

Affects  
Phase 6-4b

DEBT-004

Description  
Scheduler drag-reschedule in UI is date-first and does not expose precise time adjustment controls yet.

Reason  
6-4a prioritized window-aware move safety and reconciliation semantics over time-level interaction design.

Affects  
Phase 6-4b

DEBT-005

Description  
Naver blog generation returns `local_save_suggestion` metadata, but desktop renderer does not auto-execute local save yet.

Reason  
7-1a prioritized backend contract stability and IPC hardening first; renderer interaction wiring is scheduled in 7-1b.

Affects  
Phase 7-1b

DEBT-006

Description  
Blog generation completion chat cards currently duplicate full `generated_body` in chat metadata to support one-click copy.

Reason  
7-1b prioritized immediate copy UX without adding a separate content-body fetch path for chat cards.

Affects  
Phase 7-2a

DEBT-007

Description  
Topic clarification copy for Naver blog generation is duplicated in both general-message fallback and skill handler paths.

Reason  
7-1b patch prioritized immediate routing safety fix over centralizing channel-specific clarification templates.

Affects  
Phase 7-2a

DEBT-008

Description  
Instagram media artifacts use private bucket storage with signed URL support, but desktop UI does not yet expose signed preview/download actions.

Reason  
7-2a prioritized backend contract stability and rollback-safe storage semantics before cross-surface desktop UX wiring.

Affects  
Phase 7-2b

DEBT-009

Description  
Instagram editor action bar does not yet expose scoped regenerate execution (`all`, `caption_only`, `image_only`) even though follow-up flow expects deterministic scope control.

Reason  
7-2b prioritized safe re-compose/signed-preview/editor wiring first; regenerate scope API and UX sequencing were deferred to keep this slice shippable.

Affects  
Phase 7-2c

DEBT-010

Description  
Local compose/template-schema migration has no automated visual regression snapshot gate for composed output parity.

Reason  
7-2.1/7-2.2 prioritized contract and runtime migration first; screenshot-baseline validation was deferred to keep rollout incremental.

Affects  
Phase 7-2c

DEBT-011

Description  
Desktop watcher vision indexing calls GPT API in background but does not persist a durable retry queue/backoff state across runtime restarts.

Reason  
7-2d prioritized end-to-end ingestion cutover and fallback-safe generation continuity before adding queue durability and retry orchestration.

Affects  
Phase 7-3

DEBT-012

Description  
Phase 8-1 metrics route schedules large-batch score sync and insight refresh with process-local async follow-up.

Reason  
8-1 prioritized fast user-facing batch submission and deterministic small-batch sync behavior before introducing a durable job queue.

Affects  
Phase 8-2

DEBT-013

Description
Lightweight Instagram read surfaces such as generation-complete cards still collapse carousel metadata and preview to slide 0.

Reason
7-4 prioritized canonical slide storage, Electron compose/download, and full editor support first; secondary single-image consumers were left on compatibility fields to avoid broader UI regression.

Affects
Phase 7-4 polish

DEBT-014

Description
Autonomous analytics cadence, recovery, and dispatch still run from in-process API timers instead of a separately managed worker runtime.

Reason
8-3 prioritized durable DB queue semantics first; deployment-specific worker separation was deferred to keep the loop shippable in the current single-runtime setup.

Affects
Phase 8-3 hardening

DEBT-015

Description
Deterministic Instagram carousel fallback still uses generic role-based overlay copy when the repair LLM also misses the `slides` contract.

Reason
7-4 Patch prioritized reliably returning multi-slide drafts first; template-aware localized slide copy generation was deferred so generation never falls back to a single image again.

Affects
Phase 7-4 polish
