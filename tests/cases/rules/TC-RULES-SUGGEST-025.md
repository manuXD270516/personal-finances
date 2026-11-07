---
id: TC-RULES-SUGGEST-025
title: "Las decisiones sobre sugerencias sobreviven la ida y vuelta del export"
spec: identity/workspace-portability
related_specs: ["rules/rule-engine"]
requirement: "Decisiones sobre sugerencias de reglas en el export"
scenario: "Ida y vuelta con una sugerencia descartada"
requirement_status: confirmed
fr: ["FR-IDENTITY-010","FR-IDENTITY-017","FR-RULES-011"]
nfr: []
invariants: []
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - apps/api/test/api/rules-portability.api.test.ts
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
  - "\"W1\" descartó la sugerencia de PEDIDOSYA y aceptó la de Tigo como \"Recargas Tigo\""
input: {}
steps:
  - "Exportar \"W1\""
  - "Importar en un workspace nuevo"
  - "Listar sugerencias y leer \"Recargas Tigo\""
expected_result:
  - "PEDIDOSYA sigue descartada"
  - "\"Recargas Tigo\" conserva fromSuggestion"
created: 2026-11-04
updated: 2026-11-04
---

# TC-RULES-SUGGEST-025 — Las decisiones sobre sugerencias sobreviven la ida y vuelta del export

## Intención

Portabilidad completa (FR-IDENTITY-017).

## Escenario

```gherkin
Dadas decisiones sobre sugerencias
Cuando exporto e importo
Entonces se conservan
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-suggestions`.
