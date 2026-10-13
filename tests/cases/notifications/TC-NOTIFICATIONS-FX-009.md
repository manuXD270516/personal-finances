---
id: TC-NOTIFICATIONS-FX-009
title: "Las alertas de tasas se crean en la unidad de trabajo del job de providers sin consumidores ni conexiones nuevas"
spec: notifications/alerts
related_specs: ["platform/event-delivery"]
requirement: "Notificación de par sin tasa fresca"
scenario: null
requirement_status: provisional
fr: ["FR-NOTIFY-004"]
nfr: ["NFR-PERF-008", "NFR-REL-007"]
invariants: []
priority: high
type: platform
level: container-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["notifications", "fx", "connections", "worker"]
error_code: null
preconditions:
  - "Worker con la plantilla del host (DATABASE_POOL_MAX=33)"
input: {}
steps:
  - "Arrancar el worker y listar las colas de consumidores"
  - "Ejecutar un ciclo que abre un episodio y forzar un error en NOTIFY dentro de la transacción"
expected_result:
  - "No existen colas events.notifications.* nuevas; assertConsumerConnectionBudget pasa sin cambiar DATABASE_POOL_MAX"
  - "Con el error, ni el episodio ni la notificación ni el evento quedan escritos para ese workspace; el ciclo siguiente reintenta"
  - "TC-PLATFORM-EVENTS-018 en verde"
created: 2026-10-13
updated: 2026-10-13
---

# TC-NOTIFICATIONS-FX-009 — Las alertas de tasas se crean en la unidad de trabajo del job de providers sin consumidores ni conexiones nuevas

## Intención

D249: las alertas reutilizan el job de providers; el presupuesto 55/60 no cambia.

## Escenario

```gherkin
Dado el worker con 33 conexiones
Cuando arranca con este change
Entonces no hay consumidores nuevos
```

## Notas

