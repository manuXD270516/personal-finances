---
id: TC-SECURITY-RLS-008
title: "Tras reescribir las políticas toda tabla de negocio sigue con RLS forzada y el registro de tablas no cambia"
spec: security/access-control
related_specs: []
requirement: "Reescritura de las políticas de aislamiento sin pérdida de aislamiento"
scenario: "Catálogo de aislamiento intacto"
requirement_status: confirmed
fr: []
nfr: [NFR-SEC-003]
invariants: []
priority: critical
type: security
level: architecture
automation_status: not_automated
automated_tests: []
status: ready
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
updated: 2026-10-23
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
