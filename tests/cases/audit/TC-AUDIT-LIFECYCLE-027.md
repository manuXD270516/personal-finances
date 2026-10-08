---
id: TC-AUDIT-LIFECYCLE-027
title: "La conciliación sin extracto es una transición propia y el cotejo posterior una anotación"
spec: audit/lifecycle-timeline
related_specs: ["transactions/reconciliation"]
requirement: "Conciliación sin extracto en el recorrido de una transacción"
scenario: "Recorrido de un gasto conciliado sin extracto y cotejado después"
requirement_status: confirmed
fr: [FR-AUDIT-009, FR-AUDIT-010, FR-TRANSACTIONS-030]
nfr: []
invariants: [INV-029]
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ["lifecycle", "without-statement"]
error_code: null
preconditions:
  - "Cuenta \"Bank A\" (ASSET, BOB) con la sesión al 2026-03-31 por 3304.10 BOB"
  - "Gasto G2 de 45.90 BOB del 2026-03-20 registrado posteado"
  - "FixedClock 2026-04-05T12:00:00-04:00 (America/La_Paz)"
input:
  flow: "RECORD → CLEAR → RECONCILE_WITHOUT_STATEMENT → cotejo por la sesión"
steps:
  - "Consultar la definición lifecycle-machines/Transaction"
  - "Confirmar G2, conciliarlo sin extracto y finalizar la sesión"
  - "GET W/transactions/{G2}/lifecycle"
expected_result:
  - "La definición declara RECONCILE_WITHOUT_STATEMENT (CLEARED → RECONCILED, guarda modo explícito y periodo abierto) separada de RECONCILE (guarda sesión)"
  - "Recorrido de G2: RECORD, CLEAR y RECONCILE_WITHOUT_STATEMENT en orden, con actor e instante"
  - "Anotación RECONCILIATION_VERIFIED que enlaza la sesión al 2026-03-31, sin transición nueva"
created: 2026-10-08
updated: 2026-10-08
---

# TC-AUDIT-LIFECYCLE-027 — La conciliación sin extracto es una transición propia y el cotejo posterior una anotación

## Intención

Decisión docs/33 D74 + D37: la conciliación sin extracto se distingue en el recorrido de la conciliación contra extracto.

## Escenario

```gherkin
Dado un gasto confirmado, conciliado sin extracto y cotejado luego por una sesión
Cuando se consulta su recorrido
Entonces muestra registrar, confirmar y conciliar sin extracto
  Y una anotación de cotejo con la sesión
```

## Notas

- Datos ficticios; montos como strings decimales; fechas fijas con `FixedClock` en America/La_Paz.
