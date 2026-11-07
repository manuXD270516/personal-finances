---
id: TC-NOTIFICATIONS-DIGEST-006
title: "Un digest no enviado se recupera dentro de la misma semana y no se envía atrasado después"
spec: notifications/alerts
related_specs: []
requirement: "Digest con horario de silencio y una sola vez por periodo"
scenario: "Worker caído el lunes"
requirement_status: confirmed
fr: ["FR-NOTIFY-007"]
nfr: ["NFR-REL-008"]
invariants: []
priority: medium
type: integration
level: repository-integration
automation_status: automated
automated_tests:
  - packages/contexts/notifications/src/application/send-home-digests.test.ts
  - packages/contexts/notifications/src/domain/home-digest.test.ts
  - packages/contexts/notifications/test/integration/cash-flow-digest.int.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["notifications","digest","catch-up"]
error_code: null
preconditions:
  - "OWNER con digest semanal; worker detenido el lunes 2026-11-02"
input: {"job":"notifications.digest"}
steps:
  - "Correr el job el 2026-11-04 10:00"
  - "En otra corrida, volver recién el 2026-11-09 08:05"
expected_result:
  - "Digest de la semana 2026-W45 enviado el 2026-11-04"
  - "El 2026-11-09 solo el de 2026-W46"
created: 2026-11-04
updated: 2026-11-07
---

# TC-NOTIFICATIONS-DIGEST-006 — Un digest no enviado se recupera dentro de la misma semana y no se envía atrasado después

## Intención

Recuperación acotada sin acumular digests viejos.

## Escenario

```gherkin
Dado OWNER con digest semanal; worker detenido el lunes 2026-11-02
Cuando Correr el job el 2026-11-04 10:00
Entonces Digest de la semana 2026-W45 enviado el 2026-11-04
  Y El 2026-11-09 solo el de 2026-W46
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Digest con horario de silencio y una sola vez por periodo" de `notifications/alerts`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
