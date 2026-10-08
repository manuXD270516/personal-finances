---
id: TC-IDENTITY-RESTORE-006
title: "La importación rechaza el export de un workspace de demostración"
spec: identity/workspace-portability
related_specs: ["identity/demo-data"]
requirement: "Rechazo de archivos de export inválidos"
scenario: "Export de un workspace de demostración"
requirement_status: confirmed
fr: [FR-IDENTITY-017]
nfr: [NFR-PORT-009]
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ["restore", "validation", "demo"]
error_code: "EXPORT_FORMAT_UNSUPPORTED"
preconditions:
  - "Workspace demo \"Demo\" de \"U1\" cargado por la acción explícita (D36) y exportado; su manifiesto tiene isDemo: true"
  - "\"U1\" autenticado hace 1 minuto"
input:
  manifest: {"isDemo": true, "formatVersion": 1}
steps:
  - "POST /workspace-imports con el archivo del export demo e Idempotency-Key"
  - "Listar los workspaces de \"U1\""
expected_result:
  - "422 EXPORT_FORMAT_UNSUPPORTED en la validación previa (antes de abrir la transacción)"
  - "No se crea ningún workspace (ni en estado RESTORING) ni se ofrece importarlo como workspace real"
  - "La solicitud de importación rechazada queda auditada sin contenido del archivo"
created: 2026-10-08
updated: 2026-10-08
---

# TC-IDENTITY-RESTORE-006 — La importación rechaza el export de un workspace de demostración

## Intención

Decisión del owner docs/33 D99 (pregunta 41 de docs/32): los datos demo nunca entran a un workspace real (D36). Sin este caso, un export demo podría restaurarse como workspace normal y mezclar bancos y personas ficticios con datos reales.

## Escenario

```gherkin
Dado el export del workspace demo "Demo" de "U1", marcado como demostración en el manifiesto
Cuando "U1" lo importa
Entonces se rechaza con "EXPORT_FORMAT_UNSUPPORTED"
  Y no se crea ningún workspace
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
