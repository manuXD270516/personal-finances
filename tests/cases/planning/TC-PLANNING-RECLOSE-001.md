---
id: TC-PLANNING-RECLOSE-001
title: Re-cerrar genera el snapshot 2 enlazado al 1 sin alterar el 1
spec: planning/month-closing
related_specs: []
requirement: Re-cierre con nuevo snapshot versionado
scenario: Re-cierre con la comisión agregada
requirement_status: confirmed
fr:
  - FR-PLANNING-006
  - FR-PLANNING-004
nfr:
  - NFR-DATA-006
invariants:
  - INV-015
  - INV-022
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 2
tags:
  - month-closing
  - snapshot
  - exit-criteria
error_code: null
preconditions:
  - '"2026-10" reopened tras el snapshot 1 (Bank A 5200.00 BOB, gastos consolidados 8450.50 BOB)'
input:
  fee:
    account: Bank A
    amount: "15.00"
    currency: BOB
    date: 2026-10-31
  reconcile:
    account: Bank A
    statementBalance: "5185.00"
steps:
  - Registrar la comisión
  - Conciliar "Bank A" a 5185.00 BOB con diferencia 0.00 BOB
  - Cerrar "2026-10"
  - Leer snapshots 1 y 2
expected_result:
  - "Snapshot 2: Bank A 5185.00 BOB, gastos consolidados 8465.50 BOB, previousSnapshotId = snapshot 1"
  - "Snapshot 1 sin cambios: 5200.00 BOB y 8450.50 BOB"
  - El periodo tiene closeCount 2, reopenCount 1 y latestCloseNo 2
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-RECLOSE-001 — Re-cerrar genera el snapshot 2 enlazado al 1 sin alterar el 1

## Intención

Criterio de salida de Phase 2: reabrir/re-cerrar genera un snapshot nuevo sin alterar el anterior.

## Escenario

```gherkin
Dado que "2026-10" fue reabierto
Cuando se agrega una comisión de 15.00 BOB y se cierra de nuevo
Entonces se genera el snapshot 2 con "Bank A" en 5185.00 BOB
  Y el snapshot 1 sigue registrando 5200.00 BOB
```

## Notas

- Sin notas adicionales.
