---
id: TC-SECURITY-RLS-011
title: "El quality gate falla si una migración agrega una política de aislamiento sin la forma canónica"
spec: security/access-control
related_specs: []
requirement: "Forma canónica obligatoria de las políticas de aislamiento"
scenario: "Migración con una política en la forma anterior"
requirement_status: provisional
fr: []
nfr: [NFR-SEC-003]
invariants: []
priority: high
type: security
level: architecture
automation_status: not_automated
automated_tests: []
status: deprecated
deprecated_by_change: optimize-rls-policy-overhead
deprecation_reason: "No hay forma canónica nueva de las políticas (D298, docs/49): no se adopta la forma V2 ni se agrega una regla de catálogo para ella."
regression_suite: false
phase: 5
tags: ["rls", "catalog", "ci"]
error_code: null
preconditions:
  - "Base migrada con todas las migraciones del repositorio"
  - "Fixture: tabla con workspace_id y política forzada para pf_app en la forma anterior (sin la forma canónica)"
input: {}
steps:
  - "Ejecutar la regla de forma canónica sin el fixture"
  - "Crear el fixture y ejecutar la regla"
expected_result:
  - "Sin fixture la regla no informa violaciones"
  - "Con el fixture la regla falla nombrando la tabla y la política"
created: 2026-10-21
updated: 2026-10-24
---

# TC-SECURITY-RLS-011 — El quality gate falla si una migración agrega una política de aislamiento sin la forma canónica

## Intención

Sin una regla, la próxima tabla copiaría la forma anterior y volvería el trabajo por fila. Igual que TC-SECURITY-RLS-004 para el `FORCE`.

## Escenario

```gherkin
Dada una pull request que agrega una tabla de negocio con una política en la forma anterior
Cuando corre el chequeo de catálogo
Entonces el quality gate falla indicando la tabla y la política
```

## Notas

- Change `optimize-rls-policy-overhead` (D287), decisión 5. La regla aplica a todas las políticas que usan el contexto de workspace (D294 de [docs/48](../../../docs/48-perf-and-rls-owner-decisions.md)).
- **Descartado por decisión del owner (D298, [docs/49](../../../docs/49-rls-no-migration-decision.md), 2026-10-24).** No se migran las políticas, así que la regla de forma canónica V2 no tiene objeto y el requirement «Forma canónica obligatoria de las políticas de aislamiento» salió del delta del change. Queda con `requirement_status: provisional` solo mientras existan en `main` los tests omitidos que lo citan; en la tarea 4.2 pasa a `deprecated` (`deprecated_by_change: optimize-rls-policy-overhead`) en el mismo commit que los retira, para no romper la regla R5 de trazabilidad.
