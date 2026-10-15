---
id: TC-FX-INSTRATE-004
title: "Los valores publicados por entidad se leen exactos sin punto flotante"
spec: fx/market-rate-providers
related_specs: []
requirement: "Compra y venta por institución como tipos de tasa propios"
scenario: "Valor con más decimales de los habituales"
requirement_status: confirmed
fr: ["FR-FX-002"]
nfr: ["NFR-DATA-006"]
invariants: ["INV-001"]
priority: high
type: unit
level: unit
automation_status: automated
automated_tests:
  - apps/api/test/api/fx-institution-rates.api.test.ts
  - packages/contexts/fx/src/application/institution-rate-providers.test.ts
  - packages/contexts/fx/src/domain/institution-rates.test.ts
  - packages/contexts/fx/test/integration/institution-rates.int.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["fx", "bank-rates", "precision"]
error_code: null
preconditions:
  - "Fixture sintético del proveedor (sin red)"
input: {"BAD": {"compra": "11.8537", "venta": "11.95"}}
steps:
  - "Parsear el fixture"
expected_result:
  - "BANK_SELL 11.8537 exacto y BANK_BUY 11.95 con código BAD"
created: 2026-10-13
updated: 2026-10-15
---

# TC-FX-INSTRATE-004 — Los valores publicados por entidad se leen exactos sin punto flotante

## Intención

INV-001: ningún valor pasa por number.

## Escenario

```gherkin
Dado 11.8537 publicado
Cuando se parsea
Entonces se registra 11.8537 exacto
```

## Notas

- Datos ficticios: catálogo "BO" de prueba con fuente "Registro Demo" y entidades "Banco Andino Demo" (`BAD`), "Banco Boliviano Demo" (`BBD`), "Cooperativa Illimani Demo" (`CID`) y "Billetera Altiplano Demo" (`BAL`). Nunca entidades ni montos reales del owner.
- Change: `add-exchange-house-rate-providers`.
