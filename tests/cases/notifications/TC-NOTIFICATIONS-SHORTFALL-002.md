---
id: TC-NOTIFICATIONS-SHORTFALL-002
title: "Un episodio entregado dos veces genera una sola notificación y su cierre no notifica"
spec: notifications/alerts
related_specs: []
requirement: "Notificación de riesgo de déficit"
scenario: "Hecho entregado dos veces"
requirement_status: provisional
fr: ["FR-NOTIFY-005","FR-NOTIFY-004"]
nfr: []
invariants: []
priority: high
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["notifications","shortfall","idempotency"]
error_code: null
preconditions:
  - "Workspace \"W1\" con OWNER y EDITOR"
input: {}
steps:
  - "Entregar el mismo episodio dos veces"
  - "Cerrar el episodio y abrir otro"
expected_result:
  - "Una notificación por destinatario"
  - "Cierre sin notificación; episodio nuevo con notificación nueva"
created: 2026-11-04
updated: 2026-11-04
---

# TC-NOTIFICATIONS-SHORTFALL-002 — Un episodio entregado dos veces genera una sola notificación y su cierre no notifica

## Intención

FR-NOTIFY-005: deduplicación por (tipo, episodio, destinatario).

## Escenario

```gherkin
Dado Workspace "W1" con OWNER y EDITOR
Cuando Entregar el mismo episodio dos veces
Entonces Una notificación por destinatario
  Y Cierre sin notificación; episodio nuevo con notificación nueva
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Notificación de riesgo de déficit" de `notifications/alerts`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
