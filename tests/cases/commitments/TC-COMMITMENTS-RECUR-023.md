---
id: TC-COMMITMENTS-RECUR-023
title: 'Aprobar una ocurrencia estimada con el monto real crea el gasto posteado y la materializa'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Aprobar una ocurrencia crea su transacción'
scenario: 'Aprobar la luz con el monto real'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-008']
nfr: []
invariants: ['INV-029']
priority: critical
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/recurring.api.test.ts
  - apps/web/src/ui/recurring/recurring.test.tsx
  - packages/contexts/commitments/src/application/recurrence.service.test.ts
  - tests/e2e/specs/recurring.spec.ts
status: automated
regression_suite: true
phase: 3
tags: ['recurrence', 'materialize']
error_code: null
preconditions:
  - 'Luz ESTIMATED 150.00 BOB, cuenta Banco BOB, categoría Servicios'
  - 'Hoy 2026-10-25'
input:
  amount: '163.40'
  currency: 'BOB'
steps:
  - 'POST W/recurring/occurrences/{id}/materialize con Idempotency-Key y amount 163.40 BOB'
expected_result:
  - '201 con transactionId'
  - 'Gasto POSTED de 163.40 BOB, fecha 2026-10-25, categoría Servicios, source RECURRING'
  - 'Ocurrencia MATERIALIZED'
  - 'Auditoría y transición MATERIALIZE en el mismo commit'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-023 — Aprobar una ocurrencia estimada con el monto real crea el gasto posteado y la materializa

## Intención

FR-COMMITMENTS-008: aprobar = crear la transacción con los datos de la versión de la ocurrencia.

## Escenario

```gherkin
Dado la ocurrencia del 2026-10-25 de la "Luz" estimada en 150.00 BOB
Cuando el EDITOR la aprueba indicando 163.40 BOB
Entonces se crea un gasto POSTED de 163.40 BOB con fecha 2026-10-25
  Y la ocurrencia queda materializada
```

## Notas

- Reenviar la misma Idempotency-Key devuelve la misma respuesta.
