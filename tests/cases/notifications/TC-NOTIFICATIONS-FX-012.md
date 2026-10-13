---
id: TC-NOTIFICATIONS-FX-012
title: "Un salto que persiste en ciclos siguientes actualiza el aviso sin crear otro"
spec: notifications/alerts
related_specs: ["fx/market-rate-providers"]
requirement: "Notificación de muestra anómala retenida"
scenario: "Salto que persiste en ciclos siguientes"
requirement_status: provisional
fr: ["FR-NOTIFY-005", "FR-FX-010"]
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
  - "Aviso de USDT/BOB con 5 muestras pendientes sin revisar"
input: {"cycle": "2026-10-13T14:15:00Z", "newSamples": 3}
steps:
  - "Correr el ciclo de las 14:15Z con tres muestras nuevas de USDT/BOB (vigencia nueva) que vuelven a quedar retenidas"
  - "GET W/notifications como OWNER"
expected_result:
  - "La notificación de USDT/BOB muestra 8 muestras pendientes"
  - "No hay notificación ni entrega de email nueva"
created: 2026-10-13
updated: 2026-10-13
---

# TC-NOTIFICATIONS-FX-012 — Un salto que persiste en ciclos siguientes actualiza el aviso sin crear otro

## Intención

La línea base no cambia mientras nadie revise, así que cada ciclo retiene muestras nuevas; antes del cambio cada una avisaba.

## Escenario

```gherkin
Dado el grupo de USDT/BOB con 5 muestras pendientes
Cuando el ciclo siguiente retiene 3 muestras más
Entonces el aviso existente muestra 8 pendientes
```

## Notas

- Change: `refine-rate-anomaly-alert-grouping` (borrador).
