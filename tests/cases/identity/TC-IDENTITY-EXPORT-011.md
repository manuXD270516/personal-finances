---
id: TC-IDENTITY-EXPORT-011
title: "El aviso de export terminado no contiene cifras ni nombres de cuentas"
spec: identity/workspace-portability
related_specs: ["notifications/alerts"]
requirement: "Aviso de export terminado"
scenario: "Export listo"
requirement_status: confirmed
fr: [FR-IDENTITY-010]
nfr: [NFR-COMP-001]
invariants: []
priority: low
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags: ["export", "notifications"]
error_code: null
preconditions:
  - "notifications/alerts aplicado (pf-p2b)"
  - "Export de \"W1\" en curso"
input:
  event: "identity.WorkspaceExportCompleted.v1"
steps:
  - "Terminar el export"
  - "Leer las notificaciones del OWNER"
expected_result:
  - "Aviso \"Tu exportación está lista\" con enlace"
  - "Sin montos, nombres de cuentas ni contenido"
created: 2026-10-05
updated: 2026-10-08
---

# TC-IDENTITY-EXPORT-011 — El aviso de export terminado no contiene cifras ni nombres de cuentas

## Intención

Avisos sin datos financieros (docs/12 §13.3).

## Escenario

```gherkin
Dado un export de "W1" en curso
Cuando termina
Entonces el OWNER ve un aviso sin cifras con enlace a la descarga
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
