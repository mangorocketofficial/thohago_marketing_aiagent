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
