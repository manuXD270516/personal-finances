---
id: TC-IDENTITY-EXPORT-008
title: "El OWNER elimina un export antes de su expiración"
spec: identity/workspace-portability
related_specs: []
requirement: "Eliminar un export antes de su expiración"
scenario: "Eliminar el export de hoy"
requirement_status: confirmed
fr: [FR-IDENTITY-010]
nfr: [NFR-COMP-002]
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags: ["export", "retention"]
error_code: "EXPORT_EXPIRED"
preconditions:
  - "Export de \"W1\" READY hoy"
input:
  action: "discard"
steps:
  - "POST W/exports/{id}/discard"
  - "Descargar"
expected_result:
  - "Objeto eliminado; estado DISCARDED; auditoría de la eliminación"
  - "Descarga: 410 EXPORT_EXPIRED"
created: 2026-10-05
updated: 2026-10-08
---

# TC-IDENTITY-EXPORT-008 — El OWNER elimina un export antes de su expiración

## Intención

Permite al usuario reducir la exposición sin esperar la expiración.

## Escenario

```gherkin
Dado un export de "W1" terminado hoy
Cuando el OWNER lo elimina
Entonces el archivo deja de existir y la descarga se rechaza con "EXPORT_EXPIRED"
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
