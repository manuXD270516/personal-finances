---
id: TC-GOALS-SAVINGS-045
title: "Los hitos 25/50/75 % se notifican una vez por meta con el mayor hito cruzado"
spec: notifications/alerts
related_specs: ["goals/savings-goals"]
requirement: "Notificación de hito de una meta"
scenario: "Cruce del 50 %"
requirement_status: provisional
fr: ["FR-NOTIFY-004", "FR-GOALS-008"]
nfr: []
invariants: ["INV-028"]
priority: medium
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "notifications", "milestones"]
error_code: null
preconditions:
  - "Workspace con OWNER, EDITOR y VIEWER"
input: {"events": [{"goal": "Fondo de emergencia", "percentBefore": "46.67", "percentAfter": "53.33"}, {"goal": "Laptop", "percentBefore": "20.00", "percentAfter": "55.56"}, {"goal": "Fondo de emergencia", "percentBefore": "48.00", "percentAfter": "52.00"}, {"goal": "Viaje a Cusco", "percentBefore": "20.00", "percentAfter": "30.00", "progressComplete": false}]}
steps:
  - "Entregar los hechos de movimiento en orden"
expected_result:
  - "Hito 50 % de \"Fondo de emergencia\" para cada miembro"
  - "\"Laptop\": una sola notificación del 50 % que también informa 25 %"
  - "Tercer hecho: sin notificación (50 % ya notificado)"
  - "Progreso incompleto: sin hitos"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-045 — Los hitos 25/50/75 % se notifican una vez por meta con el mayor hito cruzado

## Intención

FR-GOALS-008 (hitos derivados) sin ruido.

## Escenario

```gherkin
Cuando un aporte lleva "Fondo de emergencia" de 46.67 % a 53.33 %
Entonces cada miembro tiene una notificación del hito 50 %
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
