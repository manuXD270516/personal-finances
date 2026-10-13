---
id: TC-NOTIFICATIONS-FX-001
title: "La obsolescencia de un par notifica a OWNER y EDITOR con enlace al estado de tasas y no al VIEWER"
spec: notifications/alerts
related_specs: ["fx/market-rate-providers"]
requirement: "Notificación de par sin tasa fresca"
scenario: "USDT/BOB sin tasa fresca"
requirement_status: provisional
fr: ["FR-NOTIFY-004", "FR-FX-010"]
nfr: []
invariants: []
priority: critical
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["notifications", "fx", "staleness"]
error_code: null
preconditions:
  - "W1 con OWNER, EDITOR y VIEWER activos"
input: {"pair": "USDT/BOB", "lastRateAsOf": "2026-10-13T08:00:00Z", "detectedAt": "2026-10-13T14:15:00Z"}
steps:
  - "Planificar la notificación del hecho de obsolescencia"
expected_result:
  - "OWNER y EDITOR: notificación no leída FX_RATE_FEED_STALE, severidad WARNING, \"USDT/BOB lleva más de 6 horas sin tasa automática\""
  - "Enlace al estado de las tasas automáticas"
  - "El VIEWER no la recibe"
created: 2026-10-13
updated: 2026-10-13
---

# TC-NOTIFICATIONS-FX-001 — La obsolescencia de un par notifica a OWNER y EDITOR con enlace al estado de tasas y no al VIEWER

## Intención

D235: piden acción (revisar la fuente o cargar una tasa), como D126 y D174.

## Escenario

```gherkin
Dado el hecho de obsolescencia de USDT/BOB
Cuando NOTIFY lo recibe
Entonces OWNER y EDITOR tienen la notificación
```

## Notas

