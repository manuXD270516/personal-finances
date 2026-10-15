---
id: TC-FX-INSTRATE-005
title: "La valoración ignora las tasas por institución salvo preferencia explícita del par"
spec: fx/market-rate-providers
related_specs: []
requirement: "Las tasas por institución no valoran por defecto"
scenario: "Valoración sin preferencia"
requirement_status: confirmed
fr: ["FR-FX-006"]
nfr: []
invariants: ["INV-012"]
priority: critical
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/fx-institution-rates.api.test.ts
  - packages/contexts/fx/src/domain/institution-rates.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["fx", "valuation", "bank-rates"]
error_code: null
preconditions:
  - "USD/BOB PARALLEL 12.02 y BANK_SELL 11.85 (BAD) con la misma vigencia"
  - "Sin preferencia para USD/BOB"
input: {"amount": "100.00 USD"}
steps:
  - "Valorar 100.00 USD"
  - "Fijar BANK_SELL como preferencia del par y valorar otra vez"
expected_result:
  - "Sin preferencia: 1202.00 BOB con PARALLEL"
  - "Con preferencia: 1185.00 BOB con BANK_SELL de BAD"
created: 2026-10-13
updated: 2026-10-15
---

# TC-FX-INSTRATE-005 — La valoración ignora las tasas por institución salvo preferencia explícita del par

## Intención

D29 sigue vigente: las tasas por institución no cambian la valoración por defecto.

## Escenario

```gherkin
Dado PARALLEL 12.02 y BANK_SELL 11.85
Cuando se valoran 100.00 USD sin preferencia
Entonces el resultado es 1202.00 BOB
```

## Notas

- Datos ficticios: catálogo "BO" de prueba con fuente "Registro Demo" y entidades "Banco Andino Demo" (`BAD`), "Banco Boliviano Demo" (`BBD`), "Cooperativa Illimani Demo" (`CID`) y "Billetera Altiplano Demo" (`BAL`). Nunca entidades ni montos reales del owner.
- Change: `add-exchange-house-rate-providers`.
