---
id: TC-IDENTITY-EXPORT-013
title: "El export e import del workspace conservan la lista de pares y las tasas MARKET sin consultar providers"
spec: identity/workspace-portability
related_specs: ["fx/market-rate-providers"]
requirement: "Pares de tasa configurados en el export"
scenario: "Ida y vuelta con pares cripto"
requirement_status: provisional
fr: ["FR-IDENTITY-010", "FR-IDENTITY-017"]
nfr: ["NFR-COMP-002"]
invariants: ["INV-011"]
priority: high
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["portability", "fx", "rate-pairs"]
error_code: null
preconditions:
  - "W1 con lista CUSTOM de cuatro pares y 217 tasas BTC/USDT MARKET"
  - "W2 con la lista por defecto"
  - "Providers en none (sin red)"
input: {}
steps:
  - "Exportar e importar W1 y W2"
expected_result:
  - "El workspace nuevo de W1 tiene los cuatro pares y las 217 tasas con los mismos valores y vigencias"
  - "El de W2 sigue con la lista por defecto"
  - "No se envía ninguna solicitud a providers; las tablas nuevas están en platform.workspace_scoped_table"
created: 2026-10-13
updated: 2026-10-13
---

# TC-IDENTITY-EXPORT-013 — El export e import del workspace conservan la lista de pares y las tasas MARKET sin consultar providers

## Intención

Regla de la consolidación de Phase 5: toda tabla nueva con workspace_id entra al export e import.

## Escenario

```gherkin
Dado W1 con pares cripto
Cuando se exporta e importa
Entonces la lista y las tasas se conservan
```

## Notas

- Cubre el scenario "Workspace con la lista por defecto".
