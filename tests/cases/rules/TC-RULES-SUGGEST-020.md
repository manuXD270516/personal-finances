---
id: TC-RULES-SUGGEST-020
title: "Listar y probar sugerencias no crea reglas ni auditoría"
spec: rules/rule-engine
related_specs: []
requirement: "Sin creación ni aplicación automática de reglas sugeridas"
scenario: "Listar sugerencias no cambia nada"
requirement_status: provisional
fr: ["FR-RULES-011","FR-RULES-009"]
nfr: []
invariants: ["INV-029"]
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["rules","rule-suggestions"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-11-04T10:00:00-04:00 (ventana de 180 días: 2026-05-08..2026-11-04)"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Telefonía\", \"Supermercado\", \"Farmacia\", \"Restaurantes\", \"Taxi\", \"Viajes\", \"Gimnasio\" y \"Recargas\"; contraparte \"Farmacorp\""
input: {}
steps:
  - "Contar reglas, versiones, transacciones y auditoría"
  - "Listar sugerencias y probar la de Tigo"
  - "Volver a contar"
expected_result:
  - "Mismos conteos antes y después"
  - "Ningún job ni consumidor registrado por el change"
created: 2026-11-04
updated: 2026-11-04
---

# TC-RULES-SUGGEST-020 — Listar y probar sugerencias no crea reglas ni auditoría

## Intención

Nada en segundo plano ni automático (D338, D346).

## Escenario

```gherkin
Dadas sugerencias disponibles
Cuando las listo y pruebo
Entonces nada cambia
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-suggestions`.
