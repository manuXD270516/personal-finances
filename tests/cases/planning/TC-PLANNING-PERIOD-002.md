---
id: TC-PLANNING-PERIOD-002
title: Los periodos son contiguos, sin solapamiento y cada fecha pertenece a exactamente uno
spec: planning/financial-periods
related_specs: []
requirement: Periodos contiguos y sin solapamiento
scenario: Secuencia de periodos con día de inicio 25
requirement_status: provisional
fr:
  - FR-PLANNING-001
  - FR-PLANNING-002
nfr: []
invariants:
  - INV-015
priority: critical
type: property
level: property
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 2
tags:
  - financial-periods
  - pbt
error_code: null
preconditions:
  - Generador de días de inicio 1..28, secuencias de cambios del día de inicio y ventanas de fechas
input:
  startDays: 1..28
  windowMonths: 1..36
  runs: 100 en PR, 10000 nightly
steps:
  - Generar periodos para la ventana con cambios aleatorios del día de inicio aplicados hacia adelante
  - Comprobar contigüidad, no solapamiento, unicidad de etiqueta y pertenencia de cada fecha
  - Intentar insertar en la BD un periodo 2026-10-15..2026-11-14 sobre 2026-10-01..2026-10-31
expected_result:
  - Para todo par de periodos consecutivos, fin + 1 día = inicio del siguiente
  - Cada fecha de la ventana pertenece a exactamente un periodo; con día 25, 2026-11-24 es de "2026-10" y 2026-11-25 de "2026-11"
  - Las etiquetas son únicas
  - La inserción solapada se rechaza en la BD y los periodos no cambian
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-PERIOD-002 — Los periodos son contiguos, sin solapamiento y cada fecha pertenece a exactamente uno

## Intención

Si dos periodos se solapan o queda un hueco, el bloqueo del ledger por periodo dejaría fechas sin protección o bloquearía de más. Es la base de INV-015 para periodos financieros.

## Escenario

```gherkin
Dado cualquier día de inicio entre 1 y 28 y cualquier secuencia de cambios hacia adelante
Cuando se generan los periodos de una ventana de fechas
Entonces cada fecha pertenece a exactamente un periodo
  Y el día siguiente al fin de un periodo es el inicio del siguiente
```

## Notas

- La parte de BD usa el scenario "Escritura que solaparía periodos" (exclusión gist).
