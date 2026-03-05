# Decision Index

## D-001

Phase  
6-3a

Decision  
Enforce scheduler slot status updates through a single transition module.

Reason  
Status mutations were occurring from multiple paths, causing drift risk between workflow/content/slot states; a canonical transition table reduces regressions and keeps invariants explicit.
