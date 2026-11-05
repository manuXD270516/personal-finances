---
id: TC-RULES-SUGGEST-008
title: "Transacciones de varios splits y administradas por Deudas no son evidencia"
spec: rules/rule-engine
related_specs: []
requirement: "Evidencia de clasificación manual"
scenario: "Transacciones de varios splits y préstamos excluidas"
requirement_status: confirmed
fr: ["FR-RULES-011"]
nfr: []
invariants: []
priority: medium
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - apps/api/test/api/rule-suggestions.api.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["rules","rule-suggestions"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-11-04T10:00:00-04:00 (ventana de 180 días: 2026-05-08..2026-11-04)"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Telefonía\", \"Supermercado\", \"Farmacia\", \"Restaurantes\", \"Taxi\", \"Viajes\", \"Gimnasio\" y \"Recargas\"; contraparte \"Farmacorp\""
  - "3 gastos \"PAGO CUOTA\" administrados por Deudas (managedBy DEBT)"
  - "3 gastos \"SUPER CENTER\" con 2 splits cada uno, origen MANUAL"
input: {}
steps:
  - "Calcular sugerencias"
expected_result:
  - "listEvidence no devuelve ninguno de los 6"
  - "Ninguna sugerencia"
created: 2026-11-04
updated: 2026-11-04
---

# TC-RULES-SUGGEST-008 — Transacciones de varios splits y administradas por Deudas no son evidencia

## Intención

Las acciones de split solo aplican a transacciones de un split (requirement vigente).

## Escenario

```gherkin
Dados gastos con varios splits o de préstamos
Cuando calculo sugerencias
Entonces no cuentan
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-suggestions`.
