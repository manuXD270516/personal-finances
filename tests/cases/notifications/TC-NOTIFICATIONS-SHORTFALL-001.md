---
id: TC-NOTIFICATIONS-SHORTFALL-001
title: "Al abrirse un episodio el OWNER y el EDITOR reciben el riesgo de déficit con severidad según el mínimo y el VIEWER no"
spec: notifications/alerts
related_specs: []
requirement: "Notificación de riesgo de déficit"
scenario: "Déficit bajo cero"
requirement_status: confirmed
fr: ["FR-NOTIFY-004","FR-REPORTING-015"]
nfr: []
invariants: []
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/notifications.api.test.ts
  - apps/web/src/ui/notifications/notifications.test.tsx
  - packages/contexts/notifications/src/application/cash-flow-notifications.test.ts
  - packages/contexts/notifications/src/domain/cash-flow-notifications.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["notifications","shortfall"]
error_code: null
preconditions:
  - "Workspace \"W1\" con OWNER, EDITOR y VIEWER activos"
input: {"type":"CASH_FLOW_SHORTFALL_RISK"}
steps:
  - "Entregar el episodio de BOB con mínimo −679.00 BOB, primera fecha 2026-11-01 y umbral 1500.00 BOB"
  - "Entregar otro episodio con mínimo 621.00 BOB"
expected_result:
  - "OWNER y EDITOR: notificación CRITICAL con BOB, 2026-11-01 y enlace al calendario; VIEWER: ninguna"
  - "Mínimo 621.00: severidad WARNING"
created: 2026-11-04
updated: 2026-11-07
---

# TC-NOTIFICATIONS-SHORTFALL-001 — Al abrirse un episodio el OWNER y el EDITOR reciben el riesgo de déficit con severidad según el mínimo y el VIEWER no

## Intención

FR-NOTIFY-004 (riesgo de déficit, Phase 7) por NotificationIntakePort.

## Escenario

```gherkin
Dado Workspace "W1" con OWNER, EDITOR y VIEWER activos
Cuando Entregar el episodio de BOB con mínimo −679.00 BOB, primera fecha 2026-11-01 y umbral 1500.00 BOB
Entonces OWNER y EDITOR: notificación CRITICAL con BOB, 2026-11-01 y enlace al calendario; VIEWER: ninguna
  Y Mínimo 621.00: severidad WARNING
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Notificación de riesgo de déficit" de `notifications/alerts`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
