---
id: TC-CLASSIFICATION-AUTO-017
title: "El motivo dice cuántas de cuántas y el patrón"
spec: classification/auto-classification
related_specs: []
requirement: "Motivo de la sugerencia"
scenario: "Motivo por descripción"
requirement_status: confirmed
fr: ["FR-CLASSIFICATION-014"]
nfr: ["NFR-USAB-001"]
invariants: []
priority: medium
type: unit
level: unit
automation_status: automated
automated_tests:
  - apps/web/src/ui/category-suggestions/category-suggestions.test.tsx
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
  - "se sugiere \"Restaurantes\" por 9 de 10 gastos con la clave `pedidosya`"
  - "se arma el motivo en es, en y pt"
expected_result:
  - "en español el motivo dice que elegiste \"Restaurantes\" en 9 de 10 gastos parecidos a \"pedidosya\""
  - "existen los textos en inglés y portugués"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-AUTO-017 — El motivo dice cuántas de cuántas y el patrón

## Intención

Verifica el scenario "Motivo por descripción" del requirement "Motivo de la sugerencia" de `classification/auto-classification` (FR-CLASSIFICATION-014).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas
Cuando se sugiere "Restaurantes" por 9 de 10 gastos con la clave `pedidosya`
Y se arma el motivo en es, en y pt
Entonces en español el motivo dice que elegiste "Restaurantes" en 9 de 10 gastos parecidos a "pedidosya"
Y existen los textos en inglés y portugués
```

## Notas

- Change `add-category-suggestions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
