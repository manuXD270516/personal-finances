---
id: TC-CLASSIFICATION-AUTO-007
title: "La contraparte gana a la descripción con mayor confianza"
spec: classification/auto-classification
related_specs: []
requirement: "Patrones por contraparte y por descripción"
scenario: "Contraparte frente a descripción"
requirement_status: confirmed
fr: ["FR-CLASSIFICATION-014","FR-RULES-011"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/rules/src/domain/category-suggester.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["category-suggestions"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios; historial clasificado por el usuario (origen manual) salvo que el escenario diga otro"
input: {}
steps:
  - "los 4 gastos con la contraparte \"Farmacorp\" están en \"Farmacia\" y de los 4 gastos con la clave `compra tarj farmacorp suc` 3 están en \"Salud\""
  - "se pide la sugerencia para \"COMPRA TARJ ****1234 FARMACORP SUC 3\" con la contraparte \"Farmacorp\""
expected_result:
  - "se sugiere \"Farmacia\" con confianza 1.0000 y base COUNTERPARTY"
  - "la clave de descripción calculada es `compra tarj farmacorp suc`"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-AUTO-007 — La contraparte gana a la descripción con mayor confianza

## Intención

Verifica el scenario "Contraparte frente a descripción" del requirement "Patrones por contraparte y por descripción" de `classification/auto-classification` (FR-CLASSIFICATION-014, FR-RULES-011).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas
Cuando los 4 gastos con la contraparte "Farmacorp" están en "Farmacia" y de los 4 gastos con la clave `compra tarj farmacorp suc` 3 están en "Salud"
Y se pide la sugerencia para "COMPRA TARJ ****1234 FARMACORP SUC 3" con la contraparte "Farmacorp"
Entonces se sugiere "Farmacia" con confianza 1.0000 y base COUNTERPARTY
Y la clave de descripción calculada es `compra tarj farmacorp suc`
```

## Notas

- Change `add-category-suggestions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
