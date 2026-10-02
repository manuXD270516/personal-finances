---
id: TC-FX-PROVIDER-015
title: "El estado de los providers informa salud, última tasa, fallas y carga histórica"
spec: fx/market-rate-providers
related_specs: ["fx/market-rates"]
requirement: "Estado de los providers consultable"
scenario: "Principal con fallas recientes"
requirement_status: confirmed
fr: ["FR-FX-016"]
nfr: ["NFR-OBS-004"]
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["fx","provider","status","observability"]
error_code: null
preconditions:
  - "paralelo.bo: éxito a las 2026-10-02T09:00:00Z (muestra 08:53:07.532Z) y fallas a las 09:15, 09:30 y 09:45 (HTTP 503)"
  - "bo.dolarapi.com: éxito en cada ciclo"
  - "Carga histórica completada con 787 días completos (788 puntos publicados)"
input: {"at": "2026-10-02T09:45:30Z", "endpoint": "GET /workspaces/{workspaceId}/fx-providers/status"}
steps:
  - "Consultar el estado como VIEWER"
  - "Variante: consultar con todos los providers en none"
expected_result:
  - "PARALELO_BO: enabled true, health DEGRADED, consecutiveFailures 3, lastSuccessAt 09:00:00Z, lastError {code PROVIDER_UNAVAILABLE, httpStatus 503, at 09:45:00Z}"
  - "Feed PARALLEL USD/BOB de PARALELO_BO: role PRIMARY, lastRate 12.02, ageSeconds 3142, stale false"
  - "DOLARAPI_BO: health HEALTHY con feeds PARALLEL (FALLBACK) y OFFICIAL USD/BOB (PRIMARY)"
  - "backfill de PARALELO_BO: COMPLETED, pointsImported 787, from 2024-08-06, to 2026-10-01"
  - "attribution presente en cada provider"
  - "Variante: ambos providers con health DISABLED y nextAttemptAt null"
created: 2026-10-02
updated: 2026-10-02
---

# TC-FX-PROVIDER-015 — El estado de los providers informa salud, última tasa, fallas y carga histórica

## Intención

El usuario necesita saber por qué ve una tasa de respaldo u obsoleta sin leer logs.

## Escenario

```gherkin
Dado paralelo.bo con 3 fallas consecutivas desde su último éxito de las 09:00Z
Cuando consulto el estado a las 09:45:30Z
Entonces paralelo.bo figura degradado con 3 fallas
  Y su última tasa tiene 52 minutos y no está obsoleta
```

## Notas

- ageSeconds = 09:45:30 − 08:53:07.532 = 3142.468 s → 3142 (52 min). Cubre también el scenario "Providers deshabilitados".
- Fechas fijas con `FixedClock`; instantes en UTC (America/La_Paz = UTC−4). Sin red en CI: providers simulados con fixtures grabados.
