---
id: TC-NOTIFICATIONS-FX-013
title: "Revisar la muestra más antigua del grupo no abre un aviso nuevo"
spec: notifications/alerts
related_specs: ["fx/market-rate-providers"]
requirement: "Notificación de muestra anómala retenida"
scenario: "Revisión parcial del grupo"
requirement_status: confirmed
fr: ["FR-NOTIFY-005"]
nfr: []
invariants: ["INV-011", "INV-028"]
priority: medium
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - packages/contexts/fx/src/application/rate-feed-alerts.test.ts
  - packages/contexts/fx/test/integration/rate-feed-alerts.int.test.ts
  - packages/contexts/fx/src/domain/anomaly-group-resolver.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["notifications", "fx", "anomaly", "grouping"]
error_code: null
preconditions:
  - "Workspace W1 en America/La_Paz con OWNER, EDITOR y VIEWER activos, providers simulados (paralelo.bo principal, bo.dolarapi.com respaldo) y FixedClock"
  - "Grupo de USDT/BOB con varias muestras pendientes y su aviso"
input: {"review": "CONFIRM de la muestra más antigua"}
steps:
  - "POST W/fx-rates/{id}/anomaly-review con CONFIRM sobre la muestra más antigua del grupo"
  - "Correr un ciclo que retiene otra muestra de USDT/BOB"
  - "GET W/notifications como OWNER"
expected_result:
  - "Sigue habiendo una sola notificación del grupo, actualizada con las muestras pendientes"
  - "Su enlace lleva a la muestra pendiente más antigua (ya no a la confirmada)"
created: 2026-10-13
updated: 2026-10-13
---

# TC-NOTIFICATIONS-FX-013 — Revisar la muestra más antigua del grupo no abre un aviso nuevo

## Intención

El grupo dura mientras el par tenga muestras pendientes sin interrupción; una revisión parcial no lo corta.

## Escenario

```gherkin
Dado el grupo de USDT/BOB con varias pendientes
Cuando el OWNER confirma la más antigua y llega otra muestra retenida
Entonces se actualiza el mismo aviso
```

## Notas

- Change: `refine-rate-anomaly-alert-grouping`.
