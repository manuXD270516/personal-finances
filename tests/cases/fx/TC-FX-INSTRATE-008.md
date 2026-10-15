---
id: TC-FX-INSTRATE-008
title: "El estado informa la razón de las instituciones adoptadas sin proveedor"
spec: fx/market-rate-providers
related_specs: []
requirement: "Estado de las tasas por institución consultable"
scenario: "Institución adoptada sin proveedor"
requirement_status: confirmed
fr: ["FR-FX-016"]
nfr: []
invariants: []
priority: low
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/fx-institution-rates.api.test.ts
  - packages/contexts/fx/src/application/institution-rate-providers.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["fx", "provider-status"]
error_code: null
preconditions:
  - "W1 adoptó CID, con tasas NOT_ELIGIBLE (NO_PUBLICATION)"
input: {"code": "CID"}
steps:
  - "GET del estado de providers"
expected_result:
  - "institutions[] incluye CID sin tasas automáticas, con estado NOT_ELIGIBLE y razón NO_PUBLICATION"
created: 2026-10-13
updated: 2026-10-15
---

# TC-FX-INSTRATE-008 — El estado informa la razón de las instituciones adoptadas sin proveedor

## Intención

El owner ve por qué una entidad suya no tiene tasa automática.

## Escenario

```gherkin
Dado CID adoptada y no apta
Cuando se consulta el estado
Entonces figura con su razón
```

## Notas

- Datos ficticios: catálogo "BO" de prueba con fuente "Registro Demo" y entidades "Banco Andino Demo" (`BAD`), "Banco Boliviano Demo" (`BBD`), "Cooperativa Illimani Demo" (`CID`) y "Billetera Altiplano Demo" (`BAL`). Nunca entidades ni montos reales del owner.
- Change: `add-exchange-house-rate-providers`.
