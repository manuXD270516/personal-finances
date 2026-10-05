---
id: TC-REPORTING-NETWORTH-009
title: "Un mes cerrado muestra el patrimonio del snapshot de cierre"
spec: reporting/net-worth
related_specs: ["planning/month-closing"]
requirement: "Meses cerrados desde el snapshot de cierre"
scenario: "Tasa registrada después del cierre de marzo"
requirement_status: provisional
fr: [FR-REPORTING-006, FR-PLANNING-004]
nfr: [NFR-DATA-006]
invariants: []
priority: medium
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags: ["net-worth", "month-closing"]
error_code: null
preconditions:
  - "Workspace \"W1\" (BOB, America/La_Paz); cuentas \"Banco BOB\", \"Wallet USDT\" y tarjeta \"Visa\" incluidas en el patrimonio"
  - "Al 2026-01-31: 2000.00 BOB, 100.000000 USDT, deuda 300.00 BOB; USDT/BOB PARALLEL 10.00"
  - "Al 2026-02-28: 2500.00 BOB, 100.000000 USDT, deuda 0.00 BOB; USDT/BOB 10.50"
  - "Al 2026-03-31: 2400.00 BOB, 120.000000 USDT, deuda 150.00 BOB; USDT/BOB 11.00"
  - "FixedClock 2026-04-12T12:00:00-04:00"
  - "Marzo de 2026 cerrado con snapshot de patrimonio 3570.00 BOB (pf-p2a)"
  - "Después del cierre se registra USDT/BOB manual 11.20 con fecha 2026-03-31"
input:
  from: "2026-03"
  to: "2026-03"
steps:
  - "Pedir la serie"
expected_result:
  - "Marzo 3570.00 BOB con source SNAPSHOT y closed true"
created: 2026-10-05
updated: 2026-10-05
---

# TC-REPORTING-NETWORTH-009 — Un mes cerrado muestra el patrimonio del snapshot de cierre

## Intención

Los cierres son inmutables (FR-PLANNING-004): la serie no los contradice.

## Escenario

```gherkin
Dado marzo de 2026 cerrado con patrimonio 3570.00 BOB
Cuando después se registra una tasa USDT/BOB de 11.20 para el 2026-03-31
Entonces el punto de marzo sigue en 3570.00 BOB marcado como cerrado
```

## Notas

- Requiere planning/month-closing (pf-p2a); sin él, probar con un doble de ClosingSnapshotQuery.
