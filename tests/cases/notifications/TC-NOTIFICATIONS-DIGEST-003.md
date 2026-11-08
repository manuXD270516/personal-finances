---
id: TC-NOTIFICATIONS-DIGEST-003
title: "El digest mensual sale el primer día del periodo financiero y una pregunta sin datos se indica como tal"
spec: notifications/alerts
related_specs: []
requirement: "Digest periódico del Home por email"
scenario: "Digest mensual con día de inicio 25"
requirement_status: confirmed
fr: ["FR-NOTIFY-007","FR-REPORTING-001"]
nfr: []
invariants: []
priority: medium
type: integration
level: repository-integration
automation_status: automated
automated_tests:
  - packages/contexts/notifications/src/application/send-home-digests.test.ts
  - packages/contexts/notifications/src/domain/home-digest.test.ts
  - packages/contexts/notifications/test/integration/cash-flow-digest.int.test.ts
  - packages/contexts/reporting/src/application/home-digest.query.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["notifications","digest","periods"]
error_code: null
preconditions:
  - "EDITOR con digest mensual; día de inicio 25; workspace sin metas"
input: {"job":"notifications.digest"}
steps:
  - "Correr el job el 2026-10-25 08:05 y el 2026-11-01 08:05 (La Paz)"
expected_result:
  - "Digest el 2026-10-25; ninguno el 2026-11-01"
  - "Q9 indica que no hay metas, sin 0 %"
created: 2026-11-04
updated: 2026-11-07
---

# TC-NOTIFICATIONS-DIGEST-003 — El digest mensual sale el primer día del periodo financiero y una pregunta sin datos se indica como tal

## Intención

Periodos financieros (RISK-020) y nunca un cero sustituto (FR-REPORTING-001).

## Escenario

```gherkin
Dado EDITOR con digest mensual; día de inicio 25; workspace sin metas
Cuando Correr el job el 2026-10-25 08:05 y el 2026-11-01 08:05 (La Paz)
Entonces Digest el 2026-10-25; ninguno el 2026-11-01
  Y Q9 indica que no hay metas, sin 0 %
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Digest periódico del Home por email" de `notifications/alerts`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
