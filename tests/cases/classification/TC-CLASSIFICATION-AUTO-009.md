---
id: TC-CLASSIFICATION-AUTO-009
title: "Si una regla clasificará el gasto la consulta no sugiere"
spec: classification/auto-classification
related_specs: []
requirement: "Las reglas y la elección del usuario siempre ganan"
scenario: "Una regla clasifica el gasto"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-014","FR-RULES-006","FR-RULES-009"]
nfr: []
invariants: []
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["category-suggestions"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios; historial clasificado por el usuario (origen manual) salvo que el escenario diga otro"
input: {}
steps:
  - "la regla activa \"Supermercado\" con el disparador de alta manual fija \"Supermercado\" para \"HIPERMAXI\" y el historial sugeriría \"Hogar\""
  - "se pide la sugerencia para un gasto \"HIPERMAXI\""
expected_result:
  - "la respuesta es RULE_APPLIES con el id de la regla \"Supermercado\" y suggestion null"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-AUTO-009 — Si una regla clasificará el gasto la consulta no sugiere

## Intención

Verifica el scenario "Una regla clasifica el gasto" del requirement "Las reglas y la elección del usuario siempre ganan" de `classification/auto-classification` (FR-CLASSIFICATION-014, FR-RULES-006, FR-RULES-009).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas
Cuando la regla activa "Supermercado" con el disparador de alta manual fija "Supermercado" para "HIPERMAXI" y el historial sugeriría "Hogar"
Y se pide la sugerencia para un gasto "HIPERMAXI"
Entonces la respuesta es RULE_APPLIES con el id de la regla "Supermercado" y suggestion null
```

## Notas

- Change `add-category-suggestions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
