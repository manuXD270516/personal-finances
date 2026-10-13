---
id: TC-NOTIFICATIONS-FX-018
title: "El aviso por muestra creado antes de la agrupación se convierte en el aviso del grupo"
spec: notifications/alerts
related_specs: ["fx/market-rate-providers"]
requirement: "Notificación de muestra anómala retenida"
scenario: "Aviso creado antes de la agrupación"
requirement_status: confirmed
fr: ["FR-NOTIFY-005"]
nfr: []
invariants: ["INV-028"]
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - packages/contexts/notifications/src/application/notification-intake.test.ts
  - packages/contexts/notifications/test/integration/notification-intake.int.test.ts
  - packages/contexts/notifications/src/domain/fx-rate-notifications.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["notifications", "fx", "anomaly", "migration"]
error_code: null
preconditions:
  - "Workspace W1 en America/La_Paz con OWNER, EDITOR y VIEWER activos, providers simulados (paralelo.bo principal, bo.dolarapi.com respaldo) y FixedClock"
  - "Tres notificaciones v1 de USDT/BOB (una por muestra, dedupeKey fx-rate-anomaly-retained:<rateId>) con las tres muestras pendientes"
input: {"newSamples": 1}
steps:
  - "Retener una cuarta muestra del mismo grupo"
  - "Leer las notificaciones de USDT/BOB del OWNER"
expected_result:
  - "La notificación de la muestra más antigua pasa al mensaje v2 con 4 muestras pendientes"
  - "Las otras dos notificaciones v1 no cambian y se siguen mostrando"
  - "No se crea ninguna notificación ni email nuevo"
created: 2026-10-13
updated: 2026-10-13
---

# TC-NOTIFICATIONS-FX-018 — El aviso por muestra creado antes de la agrupación se convierte en el aviso del grupo

## Intención

Migración sin datos: la clave del grupo es la misma dedupeKey de la notificación de su primera muestra.

## Escenario

```gherkin
Dado tres avisos por muestra anteriores al cambio
Cuando llega una cuarta muestra del grupo
Entonces el aviso de la más antigua pasa a ser el del grupo
```

## Notas

- Change: `refine-rate-anomaly-alert-grouping`.
