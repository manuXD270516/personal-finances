---
id: TC-RULES-ENGINE-047
title: "Criterio de salida de Phase 6 con los extractos reales del owner"
spec: rules/rule-engine
related_specs: []
requirement: "Cobertura de clasificación por reglas"
scenario: null
requirement_status: confirmed
fr: ["FR-RULES-010", "FR-IMPORTS-008"]
nfr: []
invariants: []
priority: critical
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 6
tags: ["rules", "exit-criterion", "owner"]
error_code: null
preconditions:
  - "Instancia del owner (no CI)"
  - "Reglas del owner creadas"
  - "3 meses de extractos reales importados (add-import-pipeline)"
input: {"from":"<primer día del trimestre>","to":"<último día>"}
steps:
  - "El owner consulta GET W/rules/coverage del rango"
  - "Registra en la tarea 7.5 la fecha, el rango y ruleCoverage (sin montos ni descripciones)"
expected_result:
  - "ruleCoverage ≥ 0.7000"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-047 — Criterio de salida de Phase 6 con los extractos reales del owner

## Intención

Evidencia del criterio de salida de docs/24 §5.6; análogo a TC-PLANNING-EXIT-001. Pasa a manual cuando el owner lo registra.

## Escenario

```gherkin
Dados 3 meses de extractos reales importados con las reglas del owner
Cuando consulta la cobertura del rango
Entonces el cociente es al menos 0.7000
```

## Notas

- Los extractos y las cifras del owner nunca se suben al repositorio.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
