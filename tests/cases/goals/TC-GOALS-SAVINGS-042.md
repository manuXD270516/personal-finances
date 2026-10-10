---
id: TC-GOALS-SAVINGS-042
title: "La sobre-asignación notifica una vez por episodio a OWNER y EDITOR con el faltante y las metas"
spec: notifications/alerts
related_specs: ["goals/savings-goals"]
requirement: "Aviso de meta sobre-asignada"
scenario: "Banco BOB sobre-asignado"
requirement_status: provisional
fr: ["FR-NOTIFY-004", "FR-NOTIFY-005", "FR-GOALS-004"]
nfr: []
invariants: ["INV-028"]
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "notifications"]
error_code: null
preconditions:
  - "Workspace con OWNER, EDITOR y VIEWER activos"
  - "Consumidor notifications.goal-over-allocated"
input: {"event": "goals.EarmarkExceedsBalance.v1 de \"Banco BOB\": balance 5800.00, reserved 7000.00, shortfall 1200.00 BOB, metas Laptop y Fondo de emergencia"}
steps:
  - "Entregar el hecho dos veces con eventId distintos"
expected_result:
  - "OWNER y EDITOR con una notificación no leída GOAL_OVER_ALLOCATED cada uno, con enlace GOAL_RESERVATIONS"
  - "VIEWER sin notificación"
  - "Dedupe goal-over-allocated:<accountId>:<episodeId>"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-042 — La sobre-asignación notifica una vez por episodio a OWNER y EDITOR con el faltante y las metas

## Intención

FR-NOTIFY-004 (Phase 4): la sobre-asignación requiere acción del OWNER/EDITOR.

## Escenario

```gherkin
Cuando se publica la sobre-asignación de "Banco BOB" con faltante 1200.00 BOB
Entonces OWNER y EDITOR tienen una notificación con faltante 1200.00 BOB
  Y el VIEWER no
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
