---
id: TC-FX-INSTRATE-006
title: "Una tasa por institución puede ser la referencia de una conversión y del análisis de costo"
spec: fx/market-rate-providers
related_specs: []
requirement: "Las tasas por institución no valoran por defecto"
scenario: "Referencia de una conversión"
requirement_status: confirmed
fr: ["FR-FX-008", "FR-FX-011"]
nfr: []
invariants: ["INV-011"]
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/fx-institution-rates.api.test.ts
  - apps/web/src/ui/accounts/catalog.test.tsx
  - packages/contexts/fx/src/domain/institution-rates.test.ts
  - tests/e2e/specs/institution-catalog.spec.ts
status: automated
regression_suite: false
phase: 5
tags: ["fx", "conversions", "bank-rates"]
error_code: null
preconditions:
  - "'Bank A' vinculada a BAD; tasa BANK_SELL 11.85 de BAD"
input: {"sell": "100.00 USD", "received": "1180.00 BOB", "reference": "BANK_SELL 11.85"}
steps:
  - "Registrar la conversión eligiendo la tasa BANK_SELL de BAD como referencia"
  - "Consultar el análisis de costo"
expected_result:
  - "La conversión guarda id y versión de la tasa"
  - "El análisis compara 11.80 efectiva contra 11.85"
created: 2026-10-13
updated: 2026-10-15
---

# TC-FX-INSTRATE-006 — Una tasa por institución puede ser la referencia de una conversión y del análisis de costo

## Intención

Las tasas por institución son útiles como referencia (docs/39 §B.4) sin tocar la valoración.

## Escenario

```gherkin
Dado BANK_SELL 11.85 de BAD
Cuando el usuario vende 100.00 USD por 1180.00 BOB con esa referencia
Entonces el costo se calcula contra 11.85
```

## Notas

- Datos ficticios: catálogo "BO" de prueba con fuente "Registro Demo" y entidades "Banco Andino Demo" (`BAD`), "Banco Boliviano Demo" (`BBD`), "Cooperativa Illimani Demo" (`CID`) y "Billetera Altiplano Demo" (`BAL`). Nunca entidades ni montos reales del owner.
- Change: `add-exchange-house-rate-providers`.
