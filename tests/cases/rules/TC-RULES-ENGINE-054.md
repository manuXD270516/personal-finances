---
id: TC-RULES-ENGINE-054
title: "Crear regla desde una fila prellena sin guardar hasta confirmar"
spec: rules/rule-engine
related_specs: []
requirement: "Crear una regla desde una transacción o fila importada"
scenario: "Regla desde una fila de Tigo"
requirement_status: provisional
fr: ["FR-RULES-001", "FR-RULES-007"]
nfr: []
invariants: []
priority: low
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["rules", "rule-engine"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Supermercado\", \"Restaurantes\", \"Telefonía\", \"Hogar\", \"Internet\", \"Regalos\" y de ingreso \"Reembolsos varios\"; etiquetas \"hogar\" y \"comida\"; contraparte \"Hipermaxi\""
input: {"row":"TIGO MONEY RECARGA 77712345","category":"Telefonía"}
steps:
  - "En la vista previa, elegir \"crear regla\" sobre la fila"
expected_result:
  - "Editor con \"descripción contiene tigo money recarga\", \"tipo = gasto\" y \"categoría = Telefonía\""
  - "Ninguna regla nueva hasta guardar"
created: 2026-10-29
updated: 2026-10-29
---

# TC-RULES-ENGINE-054 — Crear regla desde una fila prellena sin guardar hasta confirmar

## Intención

Could: acelera llegar al 70 %.

## Escenario

```gherkin
Dada la fila TIGO MONEY RECARGA 77712345
Cuando elijo crear regla
Entonces se abre prellenada sin el número
  Y no se guarda hasta confirmar
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
