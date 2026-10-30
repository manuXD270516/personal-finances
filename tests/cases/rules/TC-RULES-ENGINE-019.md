---
id: TC-RULES-ENGINE-019
title: "La primera regla fija la categoría y otra posterior suma su etiqueta"
spec: rules/rule-engine
related_specs: []
requirement: "Prioridad y resolución acumulativa determinista"
scenario: "Dos reglas con categorías distintas"
requirement_status: confirmed
fr: ["FR-RULES-006"]
nfr: []
invariants: []
priority: critical
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/rules/src/domain/rule-evaluator.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["rules", "rule-engine"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Supermercado\", \"Restaurantes\", \"Telefonía\", \"Hogar\", \"Internet\", \"Regalos\" y de ingreso \"Reembolsos varios\"; etiquetas \"hogar\" y \"comida\"; contraparte \"Hipermaxi\""
  - "Regla \"Restaurantes\" prioridad 10: contiene `pollos` ⇒ Restaurantes"
  - "Regla \"Comida\" prioridad 20: contiene `pollos` ⇒ Supermercado y etiqueta \"comida\""
input: {"subject":"POLLOS COPACABANA 64.00 BOB"}
steps:
  - "Evaluar"
expected_result:
  - "category = Restaurantes (origen Restaurantes)"
  - "addTags = [comida] (origen Comida)"
  - "matched = [Restaurantes, Comida]"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-019 — La primera regla fija la categoría y otra posterior suma su etiqueta

## Intención

Semántica acumulativa con primer escritor por campo (design decisión 2).

## Escenario

```gherkin
Dadas Restaurantes (10) y Comida (20)
Cuando evalúo POLLOS COPACABANA de 64.00 BOB
Entonces la categoría es Restaurantes
  Y la etiqueta comida la agrega Comida
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
