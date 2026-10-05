---
id: TC-PLANNING-SNAPSHOT-002
title: La base de datos rechaza modificar o eliminar un snapshot de cierre
spec: planning/month-closing
related_specs: []
requirement: Snapshot de cierre inmutable
scenario: Intento de modificar un snapshot en la base de datos
requirement_status: provisional
fr:
  - FR-PLANNING-004
nfr:
  - NFR-DATA-006
invariants:
  - INV-007
priority: critical
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 2
tags:
  - month-closing
  - snapshot
  - immutability
error_code: null
preconditions:
  - Snapshot 1 de "2026-10" con Bank A 5200.00 BOB
  - Rol pf_app
input:
  - update:
      account: Bank A
      from: "5200.00"
      to: "5000.00"
      currency: BOB
  - delete: snapshot 1
steps:
  - UPDATE del saldo del snapshot
  - DELETE del snapshot
  - Releer el snapshot
expected_result:
  - Ambas sentencias se rechazan (42501 por grants o PF003 por trigger)
  - El snapshot sigue con 5200.00 BOB
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-SNAPSHOT-002 — La base de datos rechaza modificar o eliminar un snapshot de cierre

## Intención

NFR-DATA-006: los snapshots de cierre nunca se modifican; corregir = reabrir y re-cerrar.

## Escenario

```gherkin
Dado el snapshot 1 de "2026-10" con 5200.00 BOB en "Bank A"
Cuando el rol de aplicación intenta cambiarlo a 5000.00 BOB o eliminarlo
Entonces la base de datos rechaza ambas sentencias
```

## Notas

- Mismo patrón que TC-LEDGER-IMMUTABILITY-001.
