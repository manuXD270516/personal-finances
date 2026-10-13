---
id: TC-NOTIFICATIONS-FX-003
title: "La recuperación de un par notifica una sola vez por episodio con severidad informativa"
spec: notifications/alerts
related_specs: []
requirement: "Notificación de recuperación de un par"
scenario: "USDT/BOB recuperado"
requirement_status: provisional
fr: ["FR-NOTIFY-004", "FR-NOTIFY-005"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["notifications", "fx", "recovery"]
error_code: null
preconditions:
  - "Hecho de recuperación del episodio E1 con nueva vigencia 2026-10-13T15:58:00Z"
input: {"pair": "USDT/BOB"}
steps:
  - "Planificar la notificación del hecho de recuperación"
  - "Repetir con el mismo episodio"
expected_result:
  - "OWNER y EDITOR: FX_RATE_FEED_RECOVERED, severidad INFO, \"USDT/BOB volvió a tener tasa automática\""
  - "La repetición no crea otra notificación"
created: 2026-10-13
updated: 2026-10-13
---

# TC-NOTIFICATIONS-FX-003 — La recuperación de un par notifica una sola vez por episodio con severidad informativa

## Intención

D233: aviso de recuperación al volver.

## Escenario

```gherkin
Dado el hecho de recuperación de E1
Cuando NOTIFY lo recibe
Entonces hay una notificación informativa
```

## Notas

