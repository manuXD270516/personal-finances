---
id: TC-RULES-ENGINE-031
title: "La vista previa de un import muestra la regla y versión de cada propuesta"
spec: rules/rule-engine
related_specs: ["imports/import-pipeline"]
requirement: "Evaluación sin efectos en la importación"
scenario: "Tres filas, dos clasificadas por reglas"
requirement_status: provisional
fr: ["FR-RULES-009", "FR-IMPORTS-008"]
nfr: []
invariants: []
priority: high
type: integration
level: import
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
  - "Regla \"Supermercado\" v1 (prioridad 100): descripción contiene `hipermaxi` ⇒ categoría Supermercado, etiqueta \"hogar\", contraparte \"Hipermaxi\""
  - "Regla \"Telefonía\" v1 (prioridad 100): descripción contiene `tigo` y monto ≤ 150.00 BOB ⇒ categoría Telefonía"
  - "Cuenta \"Banco BOB\"; import en vista previa (add-import-pipeline)"
input: {"rows":["HIPERMAXI SUC 12 185.40","TIGO MONEY RECARGA 100.00","TRANSF 99812 300.00"]}
steps:
  - "Previsualizar el import"
expected_result:
  - "Fila 1: Supermercado (Supermercado v1); fila 2: Telefonía (Telefonía v1); fila 3: sin categoría sin regla"
  - "Ninguna escritura en rules.*"
created: 2026-10-29
updated: 2026-10-29
---

# TC-RULES-ENGINE-031 — La vista previa de un import muestra la regla y versión de cada propuesta

## Intención

FR-IMPORTS-008 desde el lado de las reglas.

## Escenario

```gherkin
Dadas las reglas Supermercado y Telefonía
Cuando previsualizo tres filas
Entonces dos muestran su regla y versión
  Y la tercera queda sin categoría
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
