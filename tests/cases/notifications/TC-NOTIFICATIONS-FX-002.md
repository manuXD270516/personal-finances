---
id: TC-NOTIFICATIONS-FX-002
title: "El mismo episodio entregado dos veces produce una sola notificación por destinatario"
spec: notifications/alerts
related_specs: []
requirement: "Notificación de par sin tasa fresca"
scenario: "Hecho reentregado"
requirement_status: confirmed
fr: ["FR-NOTIFY-005"]
nfr: ["NFR-REL-007"]
invariants: []
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - packages/contexts/notifications/src/application/notification-intake.test.ts
  - packages/contexts/notifications/test/integration/notification-intake.int.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["notifications", "fx", "dedup"]
error_code: null
preconditions:
  - "Hecho de obsolescencia del episodio E1"
input: {"factKey": "E1"}
steps:
  - "Llamar dos veces a NotificationIntakePort.notify con el mismo hecho"
  - "Llamarlo en paralelo desde dos transacciones"
expected_result:
  - "Cada destinatario tiene una sola notificación de E1"
  - "Una sola entrega de email por destinatario"
created: 2026-10-13
updated: 2026-10-13
---

# TC-NOTIFICATIONS-FX-002 — El mismo episodio entregado dos veces produce una sola notificación por destinatario

## Intención

Sin inbox de consumidor (D249), la deduplicación descansa en la clave de negocio (FR-NOTIFY-005).

## Escenario

```gherkin
Dado el hecho de E1
Cuando se entrega dos veces
Entonces hay una notificación por destinatario
```

## Notas

