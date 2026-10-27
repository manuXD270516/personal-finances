---
id: TC-SECURITY-RLS-008
title: "Tras reescribir las políticas toda tabla de negocio sigue con RLS forzada y el registro de tablas no cambia"
spec: security/access-control
related_specs: []
requirement: "Reescritura de las políticas de aislamiento sin pérdida de aislamiento"
scenario: "Catálogo de aislamiento intacto"
requirement_status: provisional
fr: []
nfr: [NFR-SEC-003]
invariants: []
priority: critical
type: security
level: architecture
automation_status: not_automated
automated_tests: []
status: deprecated
deprecated_by_change: optimize-rls-policy-overhead
deprecation_reason: "No se migran las políticas de aislamiento (D298, docs/49): no hay migración cuyo catálogo comparar y TC-SECURITY-RLS-004 sigue cubriendo RLS forzada y política por tabla."
regression_suite: true
phase: 5
tags: ["rls", "catalog", "policy-rewrite"]
error_code: null
preconditions:
  - "Base migrada hasta la migración anterior y foto del catálogo (tablas con workspace_id, políticas por tabla, platform.workspace_scoped_table)"
input: {}
steps:
  - "Aplicar la migración de las políticas reescritas"
  - "Repetir la foto del catálogo y compararla"
expected_result:
  - "rlsCatalogViolations devuelve una lista vacía"
  - "platform.workspace_scoped_table tiene las mismas tablas en el mismo orden"
  - "Cada tabla tiene la misma cantidad de políticas, con relrowsecurity y relforcerowsecurity verdaderos"
created: 2026-10-21
updated: 2026-10-24
---

# TC-SECURITY-RLS-008 — Tras reescribir las políticas toda tabla de negocio sigue con RLS forzada y el registro de tablas no cambia

## Intención

La reescritura solo debe cambiar expresiones; nunca quitar una política, el `FORCE` ni el registro que usan la purga de la demo y la portabilidad.

## Escenario

```gherkin
Dado el catálogo antes de la migración
Cuando se aplica la reescritura de las políticas
Entonces toda tabla de negocio sigue con aislamiento habilitado y forzado
  Y el registro de tablas acotadas por workspace no cambia
```

## Notas

- Change `optimize-rls-policy-overhead` (D287). Complementa TC-SECURITY-RLS-004.
- **Descartado por decisión del owner (D298, [docs/49](../../../docs/49-rls-no-migration-decision.md), 2026-10-24).** No se migran las políticas, así que el catálogo tras la migración no tiene objeto y el requirement «Reescritura de las políticas de aislamiento sin pérdida de aislamiento» salió del delta del change. Queda con `requirement_status: provisional` solo mientras existan en `main` los tests omitidos que lo citan; en la tarea 4.2 pasa a `deprecated` (`deprecated_by_change: optimize-rls-policy-overhead`) en el mismo commit que los retira, para no romper la regla R5 de trazabilidad.
