---
id: TC-AUDIT-GLOBAL-006
title: "La vista de seguridad muestra solo eventos de seguridad"
spec: audit/audit-trail
related_specs: ["identity/workspace-portability"]
requirement: "Vista de eventos de seguridad"
scenario: "Eventos de seguridad de una semana"
requirement_status: confirmed
fr: [FR-AUDIT-005, FR-AUDIT-006]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags: ["audit", "security"]
error_code: null
preconditions:
  - "En la semana: 2 inicios de sesión, 1 fallo de autorización, 1 export solicitado, terminado y descargado, 10 transacciones registradas"
input:
  category: "SECURITY"
steps:
  - "GET W/audit-log?category=SECURITY"
  - "Test de catálogo: toda acción emitida tiene categoría"
expected_result:
  - "Los 2 inicios de sesión, el fallo de autorización y los registros del export"
  - "Ningún registro de transacciones"
  - "El test de catálogo pasa"
created: 2026-10-05
updated: 2026-10-08
---

# TC-AUDIT-GLOBAL-006 — La vista de seguridad muestra solo eventos de seguridad

## Intención

FR-AUDIT-005: los eventos de seguridad se revisan juntos.

## Escenario

```gherkin
Dado una semana con sesiones, un fallo de autorización, una exportación y 10 transacciones
Cuando el OWNER filtra eventos de seguridad
Entonces obtiene solo los eventos de seguridad
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
