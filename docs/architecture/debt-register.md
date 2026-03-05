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
