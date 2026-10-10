---
id: TC-DEBT-CARD-034
title: 'Notificación de vencimiento de tarjeta a OWNER y EDITOR sin montos en el email'
spec: notifications/alerts
related_specs: ['debt/credit-cards']
requirement: 'Notificación de vencimiento de tarjeta'
scenario: 'Vencimiento de Visa Oro notificado'
requirement_status: provisional
fr: ['FR-NOTIFY-004', 'FR-NOTIFY-005', 'FR-NOTIFY-006', 'FR-DEBT-013']
nfr: []
invariants: ['INV-028']
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['notifications', 'credit-cards']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Miembros OWNER, EDITOR y VIEWER; email sin opt-in de detalles'
input:
  event: 'debt.CardPaymentDue.v1 (Visa Oro BOB, 2026-10-25, vence 2026-11-15, 1120.50 BOB)'
steps:
  - 'Entregar el hecho dos veces con eventId distintos'
expected_result:
  - 'OWNER y EDITOR con una sola notificación CARD_PAYMENT_DUE con enlace al estado de cuenta'
  - 'VIEWER sin notificación'
  - 'Email sin 1120.50 BOB ni "Visa Oro"'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-034 — Notificación de vencimiento de tarjeta a OWNER y EDITOR sin montos en el email

## Intención

FR-NOTIFY-004 (vencimiento de tarjeta, Phase 4) con dedupe de negocio y privacidad del email.

## Escenario

```gherkin
Dado el recordatorio de vencimiento de "Visa Oro BOB"
Cuando NOTIFY lo procesa dos veces
Entonces OWNER y EDITOR tienen una sola notificación
  Y el email no muestra montos
```

## Notas

- Cubre "Recordatorio entregado dos veces".
- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
