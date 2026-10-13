---
id: TC-FX-COST-010
title: "El análisis usa solo la revisión vigente y excluye conversiones anuladas y pendientes"
spec: fx/conversion-pricing
related_specs: ["transactions/conversions"]
requirement: "Análisis de costo de conversiones por canal, par y periodo"
scenario: "Conversión revisada"
requirement_status: provisional
fr: ["FR-FX-011", "FR-FX-007"]
nfr: []
invariants: []
priority: high
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["fx", "conversion-cost", "revision", "void"]
error_code: null
preconditions:
  - "Conversiones de TC-FX-COST-001 posteadas en PostgreSQL"
input: {}
steps:
  - "Revisar la venta de 300.000000 USDT a 250.000000 USDT y consultar"
  - "En otro escenario, anular la de 100.000000 USDT y consultar"
  - "Registrar una conversión pendiente y consultar"
expected_result:
  - "Con la revisión: 4200.00 BOB convertidos y 25.00 BOB de spread"
  - "Con la anulación: 1 conversión, 3600.00 BOB y 0.5000 %"
  - "La pendiente no cuenta"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-COST-010 — El análisis usa solo la revisión vigente y excluye conversiones anuladas y pendientes

## Intención

La consulta pública de TRANSACTIONS debe devolver la revisión vigente de conversiones con asiento activo.

## Escenario

```gherkin
Dado la venta revisada a 250.000000 USDT
Cuando se consulta el análisis
Entonces cuenta solo la revisión vigente
```

## Notas

- Cubre el scenario "Conversión anulada".
