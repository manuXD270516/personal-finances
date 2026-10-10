---
id: TC-COMMITMENTS-RECUR-027
title: 'Editar monto y fecha de una ocurrencia no afecta a la definición ni a las demás'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Editar una ocurrencia'
scenario: 'Alquiler de noviembre con recargo'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-008']
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/recurring.api.test.ts
  - apps/web/src/ui/recurring/recurring.test.tsx
  - packages/contexts/commitments/src/application/recurrence.service.test.ts
  - packages/contexts/commitments/src/domain/generation.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['recurrence', 'edit']
error_code: null
preconditions:
  - 'Alquiler FIXED 3500.00 BOB con ocurrencias 2026-11-05 y 2026-12-05 SCHEDULED'
input:
  amount: '3650.00 BOB'
  dueDate: '2026-11-07'
steps:
  - 'Editar la ocurrencia del 2026-11-05'
expected_result:
  - 'Espera 3650.00 BOB con vencimiento 2026-11-07 y nominal 2026-11-05'
  - 'amountOverridden y dateOverridden true'
  - 'La de 2026-12-05 sigue en 3500.00 BOB'
  - 'Anotación EDIT en el recorrido'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-027 — Editar monto y fecha de una ocurrencia no afecta a la definición ni a las demás

## Intención

FR-COMMITMENTS-008: excepción puntual sin versionar la definición.

## Escenario

```gherkin
Dado el "Alquiler" de 3500.00 BOB
Cuando el EDITOR cambia la ocurrencia del 2026-11-05 a 3650.00 BOB con vencimiento 2026-11-07
Entonces esa ocurrencia espera 3650.00 BOB y conserva la fecha nominal
  Y la del 2026-12-05 sigue en 3500.00 BOB
```

## Notas

