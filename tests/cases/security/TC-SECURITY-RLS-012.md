---
id: TC-SECURITY-RLS-012
title: "Una brecha con plan distinto en la consulta real de saldos sigue fallando el benchmark de RLS aunque la fila de índice sea informativa"
spec: security/access-control
related_specs: ["platform/delivery-pipeline"]
requirement: "Sobrecosto de RLS de la consulta de índice de saldo por cuenta como dato informativo"
scenario: "La consulta real de saldos sigue siendo bloqueante"
requirement_status: confirmed
fr: []
nfr: [NFR-SEC-003, NFR-PERF-005]
invariants: []
priority: high
type: platform
level: unit
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 5
tags: ["rls", "nightly", "perf"]
error_code: null
preconditions:
  - "Criterio de sobrecosto de RLS vigente (200 pares, IC95, 10 % y piso de 0.5 ms; D286)"
  - "Suite nightly.perf.ts del job perf con la fila de índice INCLUDE informativa"
input:
  query: "consulta real de saldos en lote"
  overhead: "46.8 %"
  plan_with_rls: "Index Scan sobre journal_entry"
  plan_without_rls: "Bitmap Heap Scan sobre journal_entry"
steps:
  - "Calcular el resultado de RLS de la consulta real con esos pares y planes, sin indicar gate"
  - "Generar el reporte"
  - "Leer en nightly.perf.ts la declaración de las consultas reales de saldos y de la página de transacciones"
expected_result:
  - "La fila es brecha (plan distinto) y el reporte falla mostrando la consulta, la diferencia y ambos métodos de acceso"
  - "Las consultas reales de saldos en lote y de saldo por cuenta y la página de transacciones siguen bloqueantes en nightly.perf.ts"
created: 2026-10-24
updated: 2026-10-24
---

# TC-SECURITY-RLS-012 — Una brecha con plan distinto en la consulta real de saldos sigue fallando el benchmark de RLS aunque la fila de índice sea informativa

## Intención

D298 pasa a informativa solo la fila de índice INCLUDE. El objetivo < 10 % de D43 se mide sobre la consulta real, que es lo que delató a la forma V2 (run 39931324467). Este caso impide que la consulta real o la página de transacciones pasen a informativas por arrastre.

## Escenario

```gherkin
Dada la fila de índice INCLUDE informativa
Cuando la consulta real de saldos en lote mide un sobrecosto del 46.8 % con otro método de acceso
Entonces el benchmark falla indicando la consulta, la diferencia y ambos métodos de acceso
  Y la fila informativa no cambia ese resultado
```

## Notas

- Change `optimize-rls-policy-overhead` (D298, [docs/49](../../../docs/49-rls-no-migration-decision.md)), tarea 4.1, en `apps/api/test/perf/perf-report.test.ts`. Complementa TC-PLATFORM-PIPELINE-016 y 017, que fijan el criterio genérico.
