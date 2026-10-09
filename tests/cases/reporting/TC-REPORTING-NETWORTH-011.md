---
id: TC-REPORTING-NETWORTH-011
title: "La serie informa la variación mensual del patrimonio"
spec: reporting/net-worth
related_specs: []
requirement: "Variación mensual del patrimonio"
scenario: "Variación de febrero y marzo"
requirement_status: confirmed
fr: [FR-REPORTING-006, FR-REPORTING-018]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/net-worth-history.api.test.ts
  - apps/web/src/ui/networth/networth.test.tsx
  - packages/contexts/reporting/src/application/net-worth-history.queries.test.ts
  - packages/contexts/reporting/src/domain/net-worth-series.test.ts
status: automated
regression_suite: false
phase: 2
tags: ["net-worth", "variation"]
error_code: null
preconditions:
  - "Workspace \"W1\" (BOB, America/La_Paz); cuentas \"Banco BOB\", \"Wallet USDT\" y tarjeta \"Visa\" incluidas en el patrimonio"
  - "Al 2026-01-31: 2000.00 BOB, 100.000000 USDT, deuda 300.00 BOB; USDT/BOB PARALLEL 10.00"
  - "Al 2026-02-28: 2500.00 BOB, 100.000000 USDT, deuda 0.00 BOB; USDT/BOB 10.50"
  - "Al 2026-03-31: 2400.00 BOB, 120.000000 USDT, deuda 150.00 BOB; USDT/BOB 11.00"
  - "FixedClock 2026-04-12T12:00:00-04:00"
input:
  from: "2026-01"
  to: "2026-03"
steps:
  - "Pedir la serie"
expected_result:
  - "Enero sin variación (primer punto)"
  - "Febrero +850.00 BOB y marzo +20.00 BOB, comparables"
created: 2026-10-05
updated: 2026-10-09
---

# TC-REPORTING-NETWORTH-011 — La serie informa la variación mensual del patrimonio

## Intención

Q7 del Home extendido al patrimonio.

## Escenario

```gherkin
Dado la serie de enero a marzo de 2026
Cuando se calcula la variación
Entonces febrero informa +850.00 BOB y marzo +20.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
