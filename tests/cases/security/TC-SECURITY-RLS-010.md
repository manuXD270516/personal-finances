---
id: TC-SECURITY-RLS-010
title: "En el benchmark nocturno la fila saldo por cuenta (índice INCLUDE) deja de ser brecha demostrada con la política reescrita"
spec: security/access-control
related_specs: ["platform/delivery-pipeline"]
requirement: "Las políticas de aislamiento no agregan trabajo por fila al plan"
scenario: "Sobrecosto medido en el benchmark nocturno"
requirement_status: confirmed
fr: []
nfr: [NFR-SEC-003, NFR-PERF-005]
invariants: []
priority: high
type: platform
level: performance
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["rls", "nightly", "perf"]
error_code: null
preconditions:
  - "Job perf del nightly con el Large Seed y la migración de las políticas reescritas"
  - "Línea base: run 39669892721 con 0.805 ms de diferencia (IC95 0.800 a 0.811 ms; 2.80 vs 1.99 ms)"
input:
  pairs: 200
  max_ratio: "10 %"
  floor_ms: "0.5"
steps:
  - "nightly por workflow_dispatch desde la rama del PR"
  - "Primera corrida programada tras fusionar"
expected_result:
  - "La fila saldo por cuenta (índice INCLUDE) no tiene veredicto brecha demostrada ni plan distinto"
  - "El reporte publica la diferencia y su IC95 para compararlos con la línea base"
  - "Las filas de PgBalanceQuery siguen en OK"
created: 2026-10-21
updated: 2026-10-21
---

# TC-SECURITY-RLS-010 — En el benchmark nocturno la fila saldo por cuenta (índice INCLUDE) deja de ser brecha demostrada con la política reescrita

## Intención

Medición antes y después con el mismo criterio (D286): la optimización solo vale si el benchmark que detectó el sobrecosto deja de demostrarlo.

## Escenario

```gherkin
Dada la política reescrita
Cuando el benchmark nocturno mide 200 pares de la consulta de saldo por cuenta
Entonces la fila no es brecha demostrada ni plan distinto
  Y el reporte publica la diferencia frente a los 0.805 ms de la línea base
```

## Notas

- Change `optimize-rls-policy-overhead` (D287), decisión 6. Sin Docker en la sesión: lo mide el nightly.
