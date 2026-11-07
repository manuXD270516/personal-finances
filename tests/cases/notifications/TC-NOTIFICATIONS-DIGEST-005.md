---
id: TC-NOTIFICATIONS-DIGEST-005
title: "El digest respeta el horario de silencio y sale una sola vez aunque el job corra dos veces"
spec: notifications/alerts
related_specs: []
requirement: "Digest con horario de silencio y una sola vez por periodo"
scenario: "Silencio hasta las 09:00"
requirement_status: confirmed
fr: ["FR-NOTIFY-007","FR-NOTIFY-003","FR-NOTIFY-005"]
nfr: []
invariants: []
priority: high
type: integration
level: repository-integration
automation_status: automated
automated_tests:
  - packages/contexts/notifications/src/application/send-home-digests.test.ts
  - packages/contexts/notifications/test/integration/cash-flow-digest.int.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["notifications","digest","quiet-hours"]
error_code: null
preconditions:
  - "OWNER con digest semanal y silencio de 22:00 a 09:00 (La Paz)"
input: {"job":"notifications.digest"}
steps:
  - "Correr el job a las 08:05 y a las 09:05 del 2026-11-02"
expected_result:
  - "Una sola entrega, con envío a las 09:00"
created: 2026-11-04
updated: 2026-11-07
---

# TC-NOTIFICATIONS-DIGEST-005 — El digest respeta el horario de silencio y sale una sola vez aunque el job corra dos veces

## Intención

Silencio (FR-NOTIFY-003) e idempotencia por ventana.

## Escenario

```gherkin
Dado OWNER con digest semanal y silencio de 22:00 a 09:00 (La Paz)
Cuando Correr el job a las 08:05 y a las 09:05 del 2026-11-02
Entonces Una sola entrega, con envío a las 09:00
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Digest con horario de silencio y una sola vez por periodo" de `notifications/alerts`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
