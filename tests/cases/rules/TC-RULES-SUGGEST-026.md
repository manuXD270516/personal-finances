---
id: TC-RULES-SUGGEST-026
title: "Flujo completo de sugerencia aceptada y aplicada con el dry-run"
spec: rules/rule-engine
related_specs: []
requirement: "Aceptación explícita de una sugerencia"
scenario: "Aceptar la sugerencia de Tigo"
requirement_status: confirmed
fr: ["FR-RULES-011","FR-RULES-008"]
nfr: []
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/rule-suggestions.spec.ts
status: automated
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
  - "Clasificar a mano 3 gastos \"TIGO MONEY RECARGA\" en \"Telefonía\""
  - "Abrir Reglas › Sugerencias y probar la sugerencia"
  - "Aceptar con el nombre \"Recargas Tigo\""
  - "Aplicar a transacciones existentes con el dry-run"
expected_result:
  - "La regla existe en la versión 1 con la sugerencia como origen"
  - "El dry-run completa solo los gastos \"sin categoría\" del patrón"
  - "La sugerencia ya no aparece"
created: 2026-11-04
updated: 2026-11-04
---

# TC-RULES-SUGGEST-026 — Flujo completo de sugerencia aceptada y aplicada con el dry-run

## Intención

Recorrido del usuario en la UI (con PF_E2E_PROJECT).

## Escenario

```gherkin
Dadas 3 clasificaciones manuales repetidas
Cuando acepto la sugerencia y aplico el dry-run
Entonces la regla existe y la historia se completa
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-suggestions`.
