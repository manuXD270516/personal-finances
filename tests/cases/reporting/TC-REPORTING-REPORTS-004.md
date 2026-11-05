---
id: TC-REPORTING-REPORTS-004
title: "Transferencias, conversiones, pagos de tarjeta y pendientes no son ingreso ni gasto; las comisiones sí"
spec: reporting/financial-reports
related_specs: []
requirement: "Reglas de flujos comunes a los reportes"
scenario: "Movimientos que no son ingreso ni gasto"
requirement_status: confirmed
fr: ["FR-REPORTING-008", "FR-TRANSACTIONS-016"]
nfr: []
invariants: ["INV-021", "INV-024"]
priority: critical
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/domain/reports.domain.test.ts
  - packages/contexts/transactions/test/integration/pg-nominal-portions.int.test.ts
status: automated
regression_suite: true
phase: 7
tags: ["flow-rules"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "En 2026-10: sueldo 12000.00 BOB, transferencia 1000.00 BOB a \"Plazo fijo\", pago de tarjeta 500.00 BOB, conversión 100.000000 USDT → 1190.00 BOB con comisión 2.00 BOB, gasto pendiente 300.00 BOB"
  - "Gasto 400.00 BOB en \"Supermercado\" el 2026-09-28 reembolsado el 2026-10-02"
input: {}
steps:
  - "Calcular ingresos y gastos de 2026-09 y 2026-10"
expected_result:
  - "Ingreso 2026-10 = 12000.00 BOB"
  - "Gasto 2026-10 de esas operaciones = 2.00 BOB en la categoría de comisiones"
  - "\"Supermercado\" = 400.00 BOB en 2026-09 y −400.00 BOB en 2026-10"
created: 2026-11-04
updated: 2026-11-05
---

# TC-REPORTING-REPORTS-004 — Transferencias, conversiones, pagos de tarjeta y pendientes no son ingreso ni gasto; las comisiones sí

## Intención

docs/14 §4.3: sin estas reglas los reportes contarían dos veces el dinero que solo cambia de cuenta.

## Escenario

```gherkin
Dado una transferencia, un pago de tarjeta, una conversión con comisión y un gasto pendiente en 2026-10
Cuando se calcula el reporte de 2026-10
Entonces el ingreso es 12000.00 BOB
  Y el gasto es 2.00 BOB en comisiones
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
