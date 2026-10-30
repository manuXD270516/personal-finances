---
id: TC-RULES-ENGINE-040
title: "Archivar conserva las referencias y libera el nombre"
spec: rules/rule-engine
related_specs: []
requirement: "Activar, desactivar y archivar reglas"
scenario: "Regla archivada con transacciones clasificadas"
requirement_status: confirmed
fr: ["FR-RULES-001", "FR-RULES-010"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/rules.api.test.ts
  - apps/web/src/ui/rules/rules.test.tsx
  - packages/contexts/rules/src/application/rules.service.test.ts
  - packages/contexts/rules/src/domain/rule.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["rules", "rule-engine"]
error_code: "METHOD_NOT_ALLOWED"
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Supermercado\", \"Restaurantes\", \"Telefonía\", \"Hogar\", \"Internet\", \"Regalos\" y de ingreso \"Reembolsos varios\"; etiquetas \"hogar\" y \"comida\"; contraparte \"Hipermaxi\""
  - "Regla \"Supermercado\" v1 (prioridad 100): descripción contiene `hipermaxi` ⇒ categoría Supermercado, etiqueta \"hogar\", contraparte \"Hipermaxi\""
  - "40 transacciones clasificadas por Supermercado v1"
input: {"action":"archive"}
steps:
  - "DELETE W/rules/{id}"
  - "POST W/rules/{id}/archive"
  - "GET de una de las 40"
  - "POST W/rules con nombre \"Supermercado\""
expected_result:
  - "DELETE ⇒ 405"
  - "ruleRefs con ruleName Supermercado, versión 1 y archivada"
  - "La regla nueva se crea"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-040 — Archivar conserva las referencias y libera el nombre

## Intención

Archivar en lugar de borrar.

## Escenario

```gherkin
Dada la regla que clasificó 40 transacciones
Cuando la archivo
Entonces las 40 siguen mostrando la regla archivada
  Y puedo crear otra con el mismo nombre
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
