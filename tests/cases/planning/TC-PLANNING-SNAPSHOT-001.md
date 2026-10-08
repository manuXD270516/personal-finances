---
id: TC-PLANNING-SNAPSHOT-001
title: El snapshot de cierre registra saldos, patrimonio, flujos y tasa de ahorro exactos
spec: planning/month-closing
related_specs:
  - reporting/net-worth
  - reporting/dashboard
requirement: Contenido del snapshot de cierre
scenario: Snapshot de octubre de 2026
requirement_status: confirmed
fr:
  - FR-PLANNING-004
nfr:
  - NFR-DATA-001
  - NFR-DATA-002
invariants:
  - INV-020
  - INV-022
  - INV-031
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/month-closing.api.test.ts
  - apps/web/src/ui/planning/closing.test.tsx
  - packages/contexts/planning/src/domain/close-snapshot.test.ts
  - packages/contexts/reporting/src/application/closing-figures.queries.test.ts
status: automated
regression_suite: true
phase: 2
tags:
  - month-closing
  - snapshot
  - money
error_code: null
preconditions:
  - "Saldos al 2026-10-31: Bank A 5200.00 BOB, USD Savings 1500.00 USD, Binance USDT 800.000000 USDT, Visa BOB deuda 350.00 BOB"
  - "Tasas PARALLEL al 2026-10-31: 12.05 BOB/USD y 12.02 BOB/USDT"
  - Ingresos de octubre 12000.00 BOB; gastos 8210.50 BOB y 20.00 USD (tasa de la transacción 12.00 = 240.00 BOB)
  - Sin plan mensual ni metas
input:
  close: 2026-10
steps:
  - Cerrar "2026-10"
  - Leer el snapshot 1 (y repetir con USDT/BOB sin tasa utilizable)
expected_result:
  - "Saldos: 5200.00 BOB, 1500.00 USD, 800.000000 USDT y deuda 350.00 BOB"
  - Patrimonio neto 32541.00 BOB completo con tasas 12.05 y 12.02 y su fuente
  - Ingresos 12000.00 BOB; gastos 8210.50 BOB y 20.00 USD; gastos consolidados 8450.50 BOB; ahorro 3549.50 BOB; tasa de ahorro 29.6 %
  - "Presupuesto vs real y aportes a metas: no disponibles (null)"
  - "Sin tasa USDT/BOB: patrimonio incompleto con 800.000000 USDT sin convertir"
  - Montos como string decimal a la escala de su moneda, sin pérdida al releer
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-SNAPSHOT-001 — El snapshot de cierre registra saldos, patrimonio, flujos y tasa de ahorro exactos

## Intención

FR-PLANNING-004: el snapshot es la evidencia del mes; debe ser exacto (sin float) y coherente con el ledger (INV-022) y con la identidad de valoración (INV-031).

## Escenario

```gherkin
Dado los saldos y flujos de octubre de 2026 indicados
Cuando se cierra "2026-10"
Entonces el snapshot registra patrimonio neto de 32541.00 BOB
  Y gastos consolidados de 8450.50 BOB, ahorro de 3549.50 BOB y tasa de ahorro de 29.6 %
```

## Notas

- Cubre "Patrimonio incompleto por falta de tasa" y "Sin plan ni metas". 1500.00 x 12.05 = 18075.00; 800.000000 x 12.02 = 9616.00; 5200.00 + 18075.00 + 9616.00 - 350.00 = 32541.00.
