---
id: TC-PLANNING-REPORT-003
title: El reporte de cierre se exporta en CSV y PDF con montos decimales y su moneda
spec: planning/month-closing
related_specs: []
requirement: Exportación del reporte de cierre
scenario: Exportar el snapshot 1 de octubre en CSV
requirement_status: confirmed
fr:
  - FR-PLANNING-004
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags:
  - month-closing
  - report
  - export
error_code: null
preconditions:
  - '"2026-10" con snapshots 1 y 2'
  - Usuarios VIEWER y OWNER
input:
  - actor: VIEWER
    format: csv
    closeNo: 1
  - actor: OWNER
    format: pdf
    closeNo: 2
steps:
  - GET …/close-report/export?format=csv&closeNo=1
  - GET …/close-report/export?format=pdf&closeNo=2
expected_result:
  - CSV con fila "Bank A" 5200.00 BOB, fila "Binance USDT" 800.000000 USDT, versión 1 y fecha de cierre
  - PDF con KPIs, saldos por cuenta y aviso de versión anterior
  - Content-Type text/csv y application/pdf con Content-Disposition
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-REPORT-003 — El reporte de cierre se exporta en CSV y PDF con montos decimales y su moneda

## Intención

FR-PLANNING-004 exige un reporte de cierre exportable; los montos nunca pierden escala.

## Escenario

```gherkin
Dado el snapshot 1 de "2026-10"
Cuando un VIEWER lo exporta en CSV
Entonces el archivo contiene "Bank A" con 5200.00 y BOB
```

## Notas

- Cubre "Exportar en PDF". Reutiliza el renderizador de add-lifecycle-timeline (D52).
