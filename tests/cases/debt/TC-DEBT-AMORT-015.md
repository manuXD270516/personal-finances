---
id: TC-DEBT-AMORT-015
title: 'La tabla del banco pegada se guarda como referencia versionada sin cambiar el cronograma'
spec: debt/amortization
related_specs: []
requirement: 'Cargar la tabla del banco como referencia'
scenario: 'Tabla del banco pegada desde la planilla'
requirement_status: provisional
fr: ['FR-DEBT-003', 'FR-DEBT-006']
nfr: []
invariants: []
priority: critical
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['amortization', 'reference', 'exit-criterion']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR pega 24 filas con separador decimal coma y fechas `dd/mm/aaaa` para el "Préstamo vehicular" y mapea las columnas "Nro", "Fecha", "Capital", "Interés" y "Cuota"'
expected_result:
  - 'Se guarda la referencia versión 1 con 24 filas y el cronograma del préstamo no cambia'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-015 — La tabla del banco pegada se guarda como referencia versionada sin cambiar el cronograma

## Intención

Exit criterion de Phase 4: hace falta cargar la tabla real para compararla.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR pega 24 filas con separador decimal coma y fechas `dd/mm/aaaa` para el "Préstamo vehicular" y mapea las columnas "Nro", "Fecha", "Capital", "Interés" y "Cuota"
Entonces se guarda la referencia versión 1 con 24 filas y el cronograma del préstamo no cambia
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
