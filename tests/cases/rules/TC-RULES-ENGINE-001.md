---
id: TC-RULES-ENGINE-001
title: "Crear una regla nace activa en la versión 1 con disparadores por defecto"
spec: rules/rule-engine
related_specs: []
requirement: "Definición de reglas WHEN/THEN"
scenario: "Crear una regla de supermercado"
requirement_status: provisional
fr: ["FR-RULES-001", "FR-RULES-009"]
nfr: []
invariants: []
priority: high
type: api
level: api
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
input: {"name":"Supermercado","priority":100,"conditions":[{"field":"DESCRIPTION","operator":"contains","value":"hipermaxi"}],"actions":[{"type":"SET_CATEGORY","category":"Supermercado"}]}
steps:
  - "POST W/rules con la definición, sin triggers e Idempotency-Key"
expected_result:
  - "201 con enabled = true, version = 1, priority = 100"
  - "triggers = [IMPORT, RETROACTIVE] (sin MANUAL_CREATE)"
  - "Registro de auditoría de la creación"
created: 2026-10-29
updated: 2026-10-29
---

# TC-RULES-ENGINE-001 — Crear una regla nace activa en la versión 1 con disparadores por defecto

## Intención

FR-RULES-001 y FR-RULES-009: una regla nueva queda activa, versionada y con la creación manual como opt-in (pregunta 5).

## Escenario

```gherkin
Dado el catálogo de categorías del workspace
Cuando creo la regla "Supermercado" sin indicar disparadores
Entonces queda activa en la versión 1
  Y sus disparadores son importación y ejecución retroactiva
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
