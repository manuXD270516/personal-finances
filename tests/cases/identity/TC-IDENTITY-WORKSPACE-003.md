---
id: TC-IDENTITY-WORKSPACE-003
title: El OWNER configura el workspace y los valores inválidos se rechazan sin cambios
spec: identity/workspace-membership
related_specs: []
requirement: Configuración del workspace por el OWNER
scenario: null
requirement_status: confirmed
fr:
- FR-IDENTITY-005
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
- packages/contexts/identity/src/application/identity.service.test.ts
- apps/api/test/api/identity.api.test.ts
status: automated
regression_suite: false
phase: 1
tags:
- workspace
- settings
error_code: INVALID_TIMEZONE
preconditions:
- W1 Personal Demo en versión 1, owner autenticado
input:
- If-Match: '"1"'
  body:
    name: Finanzas personales
    locale: es-BO
    fiscalMonthStartDay: 5
- If-Match: '"2"'
  body:
    timezone: GMT-4 Bolivia
- If-Match: '"2"'
  body:
    fiscalMonthStartDay: 29
- If-Match: '"2"'
  body:
    baseCurrency: XYZ
steps:
- PATCH /api/v1/workspaces/{W1} con cada cuerpo en orden
- GET /api/v1/workspaces/{W1}
- Leer platform.outbox
expected_result:
- 'Primer PATCH: 200 con los valores nuevos y ETag "2"; se escribe identity.WorkspaceSettingsChanged.v1'
- 'Zona inválida: 422 INVALID_TIMEZONE'
- 'Día 29: 400 VALIDATION_FAILED'
- 'Moneda XYZ: 422 REFERENCE_NOT_FOUND'
- El workspace final mantiene la versión 2 y los valores del primer PATCH
created: 2026-10-02
updated: 2026-10-03
---

# TC-IDENTITY-WORKSPACE-003 — El OWNER configura el workspace y los valores inválidos se rechazan sin cambios

## Intención

La zona horaria y el inicio de mes determinan límites de periodo; valores inválidos producirían totales incorrectos (US-004).

## Escenario

```gherkin
Dado el OWNER de "W1 Personal Demo"
Cuando cambia el día de inicio del mes a 5
Entonces el workspace devuelve el valor nuevo con una versión nueva
Cuando envía la zona horaria "GMT-4 Bolivia"
Entonces la respuesta es 422 con código "INVALID_TIMEZONE"
```

## Notas

- Desde `add-event-outbox` (2026-10-03) el test de API verifica además el outbox real: `identity.WorkspaceCreated` (versión de agregado 1) y un único `identity.WorkspaceSettingsChanged.v1` (versión 2, actor = el OWNER) leídos como `pf_worker` y validados contra `contracts/events`; los PATCH rechazados no escriben eventos.
