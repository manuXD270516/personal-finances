---
id: TC-NOTIFICATIONS-FX-014
title: "Tras revisar todas las muestras, un salto nuevo crea un aviso nuevo"
spec: notifications/alerts
related_specs: ["fx/market-rate-providers"]
requirement: "Notificación de muestra anómala retenida"
scenario: "Salto nuevo tras revisar todo el grupo"
requirement_status: confirmed
fr: ["FR-NOTIFY-004", "FR-NOTIFY-005"]
nfr: []
invariants: ["INV-028"]
priority: high
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
  - "Todas las muestras del grupo de USDT/BOB revisadas a las 2026-10-13T15:00:00Z"
input: {"retainedAt": "2026-10-13T18:00:00Z"}
steps:
  - "Correr el ciclo de las 18:00Z con una muestra retenida de USDT/BOB"
  - "GET W/notifications como OWNER y EDITOR"
expected_result:
  - "Cada destinatario tiene una notificación nueva no leída de USDT/BOB con 1 muestra pendiente"
  - "Se programa su email según preferencias"
created: 2026-10-13
updated: 2026-10-13
---

# TC-NOTIFICATIONS-FX-014 — Tras revisar todas las muestras, un salto nuevo crea un aviso nuevo

## Intención

Un grupo nuevo empieza cuando el par no tenía ninguna muestra pendiente.

## Escenario

```gherkin
Dado ninguna muestra pendiente de USDT/BOB
Cuando se retiene una muestra nueva
Entonces cada destinatario recibe un aviso nuevo
```

## Notas

- Change: `refine-rate-anomaly-alert-grouping`.
