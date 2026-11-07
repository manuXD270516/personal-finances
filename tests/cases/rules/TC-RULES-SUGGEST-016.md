---
id: TC-RULES-SUGGEST-016
title: "La vista previa cuenta coincidencias sin modificar nada"
spec: rules/rule-engine
related_specs: []
requirement: "Vista previa de una sugerencia sin efectos"
scenario: "Vista previa de Tigo"
requirement_status: confirmed
fr: ["FR-RULES-011","FR-RULES-008"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/rules/src/application/rule-proposals.service.test.ts
  - apps/api/test/api/rule-suggestions.api.test.ts
  - apps/web/src/ui/rules/rules.test.tsx
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
  - "9 gastos coinciden con la sugerencia de Tigo: 4 MANUAL en \"Telefonía\", 3 \"sin categoría\" y 2 en \"Recargas\" por la categoría por defecto de su contraparte"
input: {}
steps:
  - "POST W/rules/suggestions/preview con la huella y el patrón"
expected_result:
  - "matched 9, wouldFill 3, alreadyInCategory 4, otherCategory 2"
  - "Ninguna transacción, regla ni registro de auditoría nuevo"
created: 2026-11-04
updated: 2026-11-04
---

# TC-RULES-SUGGEST-016 — La vista previa cuenta coincidencias sin modificar nada

## Intención

Mismo evaluador que el dry-run, regla transitoria.

## Escenario

```gherkin
Dada la sugerencia de Tigo
Cuando la pruebo
Entonces veo los conteos y nada cambia
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-suggestions`.
