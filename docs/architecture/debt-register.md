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
