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
