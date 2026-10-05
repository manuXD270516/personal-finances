---
id: TC-TRANSACTIONS-RECONCILIATION-013
title: "Finalizar con una versión obsoleta de la sesión se rechaza"
spec: transactions/reconciliation
related_specs: []
requirement: "Bloqueo optimista de la sesión"
scenario: "Finalizar con una versión obsoleta"
requirement_status: provisional
fr: [FR-TRANSACTIONS-011, FR-TRANSACTIONS-030]
nfr: [NFR-DATA-014]
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags: ["reconciliation", "concurrency"]
error_code: "PRECONDITION_FAILED"
preconditions:
  - "Cuenta \"Bank A\" (ASSET, BOB, ACTIVE) con saldo inicial 1000.00 BOB al 2026-02-28"
  - "Gasto G1 cleared de 150.00 BOB del 2026-03-05; ingreso I1 cleared de 2500.00 BOB del 2026-03-10"
  - "Gasto G2 posted de 45.90 BOB del 2026-03-20; gasto G3 cleared de 200.00 BOB del 2026-04-02"
  - "FixedClock 2026-04-05T12:00:00-04:00 (America/La_Paz)"
  - "Sesión de \"Bank A\" en versión 3"
input:
  - "{\"tab\":\"A\",\"action\":\"toggle\",\"ifMatch\":\"3\"}"
  - "{\"tab\":\"B\",\"action\":\"complete\",\"ifMatch\":\"3\"}"
steps:
  - "Pestaña A confirma un gasto (versión 4)"
  - "Pestaña B finaliza con If-Match 3"
  - "Corregir G1 a 155.00 BOB y finalizar con la versión vigente"
expected_result:
  - "412 PRECONDITION_FAILED; sesión IN_PROGRESS"
  - "Tras la corrección: saldo confirmado 3500.00 BOB y 422 RECONCILIATION_DIFFERENCE_NOT_ZERO con difference \"-150.00\""
created: 2026-10-05
updated: 2026-10-05
---

# TC-TRANSACTIONS-RECONCILIATION-013 — Finalizar con una versión obsoleta de la sesión se rechaza

## Intención

Evita finalizar sobre un estado que el usuario no vio y evalúa el estado vigente al completar.

## Escenario

```gherkin
Dado dos pestañas con la sesión en la versión 3
Cuando una confirma un gasto y la otra finaliza con la versión 3
Entonces la finalización se rechaza con "PRECONDITION_FAILED"
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
