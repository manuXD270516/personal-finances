---
id: TC-IDENTITY-EXPORT-003
title: "El export usa montos decimales exactos, JSON Schema y CSV neutralizado"
spec: identity/workspace-portability
related_specs: []
requirement: "Formato abierto y versionado del export"
scenario: "Montos exactos en JSON y CSV"
requirement_status: provisional
fr: [FR-IDENTITY-010]
nfr: [NFR-PORT-009, NFR-DATA-010]
invariants: [INV-001, INV-003]
priority: critical
type: integration
level: contract
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ["export", "format", "money"]
error_code: null
preconditions:
  - "Workspace \"W1\" (BOB, America/La_Paz) con OWNER \"U1\", EDITOR \"U2\" y VIEWER \"U3\""
  - "\"Bank A\" 3099.10 BOB, \"Wallet USDT\" 50.000000 USDT, tarjeta \"Visa\" con deuda 520.00 BOB"
  - "Tasa PARALLEL USDT/BOB 12.02 vigente"
  - "Gasto de 45.90 BOB con descripción \"=HYPERLINK(\\\"x\\\")\""
  - "Conversión de 100.000000 USDT"
input:
  formatVersion: 1
steps:
  - "Exportar"
  - "Validar manifest.json, sha256 de cada archivo y cada registro contra contracts/export/v1"
  - "Leer csv/transactions.csv"
expected_result:
  - "manifest con format \"pfos-export\", formatVersion 1, secciones con count y sha256 correctos"
  - "JSON y CSV contienen \"45.90\" y \"100.000000\" exactos"
  - "Todo registro valida contra su esquema"
  - "La descripción aparece neutralizada en el CSV (prefijo de comilla simple)"
created: 2026-10-05
updated: 2026-10-05
---

# TC-IDENTITY-EXPORT-003 — El export usa montos decimales exactos, JSON Schema y CSV neutralizado

## Intención

NFR-PORT-009: formato abierto, versionado y verificable, sin pérdida de precisión.

## Escenario

```gherkin
Dado un gasto de 45.90 BOB y una conversión de 100.000000 USDT
Cuando se exporta "W1"
Entonces el JSON y el CSV contienen "45.90" y "100.000000" exactos
  Y cada archivo valida contra el esquema de la versión 1
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
