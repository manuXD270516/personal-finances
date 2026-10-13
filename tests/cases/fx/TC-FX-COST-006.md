---
id: TC-FX-COST-006
title: "La exportación CSV tiene una fila por grupo, montos decimales y celdas neutralizadas"
spec: fx/conversion-pricing
related_specs: []
requirement: "Exportación CSV del análisis de costo"
scenario: "Exportar octubre"
requirement_status: provisional
fr: ["FR-FX-011"]
nfr: ["NFR-SEC-015", "NFR-SEC-011"]
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["fx", "conversion-cost", "csv", "security"]
error_code: null
preconditions:
  - "Grupos \"Binance P2P\" y \"Sin canal\" en \"2026-10\"; una contraparte llamada \"=HYPERLINK(1)\""
input: {}
steps:
  - "GET W/reports/conversion-costs/export como VIEWER"
  - "Enviar 11 exportaciones en un minuto"
expected_result:
  - "CSV con encabezado y 2 filas de datos; la de \"Binance P2P\" con \"4800.00\", \"28.00\", \"2.00\", \"30.00\" y 1 excluida"
  - "La contraparte \"=HYPERLINK(1)\" queda como texto"
  - "La exportación 11 responde 429 RATE_LIMITED (cuota costosa)"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-COST-006 — La exportación CSV tiene una fila por grupo, montos decimales y celdas neutralizadas

## Intención

Exportación segura contra inyección de fórmulas, como el CSV de auditoría.

## Escenario

```gherkin
Dado el análisis de octubre
Cuando el VIEWER lo exporta
Entonces obtiene 2 filas con montos decimales
```

## Notas

- Cubre el scenario "Contraparte con fórmula".
