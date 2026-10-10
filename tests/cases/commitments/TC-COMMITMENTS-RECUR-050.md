---
id: TC-COMMITMENTS-RECUR-050
title: 'La creación automática se audita con actor de proceso y origen recurrente en la misma transacción'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Permisos y auditoría de los compromisos'
scenario: 'Creación automática auditada como proceso'
requirement_status: confirmed
fr: ['FR-AUDIT-001', 'FR-COMMITMENTS-007']
nfr: []
invariants: ['INV-029']
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - apps/api/test/api/recurring.api.test.ts
  - packages/contexts/commitments/src/application/recurrence.service.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['recurrence', 'audit']
error_code: null
preconditions:
  - 'Internet AUTO_CREATE; hoy 2026-10-20'
input: {}
steps:
  - 'Ejecutar el job'
  - 'Forzar un fallo en el insert de auditoría en una segunda corrida sobre otra ocurrencia'
expected_result:
  - 'audit_log con actor WORKER commitments.generate-occurrences y origin recurring para la ocurrencia y la transacción'
  - 'Con fallo de auditoría no persiste ni la transacción ni la ocurrencia'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-050 — La creación automática se audita con actor de proceso y origen recurrente en la misma transacción

## Intención

INV-029: auditoría en la misma unidad de trabajo.

## Escenario

```gherkin
Cuando el worker crea el gasto del "Internet" del 2026-10-20
Entonces la auditoría registra la materialización con actor de proceso y origen recurrente
```

## Notas

