---
id: TC-NOTIFICATIONS-FX-011
title: "Las muestras del provider de respaldo en el mismo ciclo actualizan el mismo aviso sin otro email"
spec: notifications/alerts
related_specs: ["fx/market-rate-providers"]
requirement: "Notificación de muestra anómala retenida"
scenario: "Respaldo en el mismo ciclo"
requirement_status: provisional
fr: ["FR-NOTIFY-005"]
nfr: []
invariants: ["INV-028"]
priority: high
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["notifications", "fx", "anomaly", "grouping"]
error_code: null
preconditions:
  - "Workspace W1 en America/La_Paz con OWNER, EDITOR y VIEWER activos, providers simulados (paralelo.bo principal, bo.dolarapi.com respaldo) y FixedClock"
  - "Aviso de USDT/BOB con 3 muestras pendientes de paralelo.bo del ciclo de las 14:00Z"
input: {"provider": "bo.dolarapi.com", "samples": {"PARALLEL": "12.82", "PARALLEL_BUY": "12.72"}}
steps:
  - "En el mismo ciclo, registrar las dos muestras retenidas de bo.dolarapi.com"
  - "Contar notificaciones y entregas de email por destinatario"
expected_result:
  - "Cada destinatario sigue con una sola notificación de USDT/BOB, con 5 muestras pendientes y providers bo.dolarapi.com y paralelo.bo"
  - "No hay notificaciones ni entregas de email nuevas"
created: 2026-10-13
updated: 2026-10-13
---

# TC-NOTIFICATIONS-FX-011 — Las muestras del provider de respaldo en el mismo ciclo actualizan el mismo aviso sin otro email

## Intención

Los dos providers ven el mismo salto en transacciones distintas del mismo ciclo; el grupo es por par, no por provider.

## Escenario

```gherkin
Dado el aviso de USDT/BOB con 3 muestras de paralelo.bo
Cuando bo.dolarapi.com retiene dos muestras más en el mismo ciclo
Entonces el mismo aviso muestra 5 pendientes y no hay email nuevo
```

## Notas

- Change: `refine-rate-anomaly-alert-grouping` (borrador).
