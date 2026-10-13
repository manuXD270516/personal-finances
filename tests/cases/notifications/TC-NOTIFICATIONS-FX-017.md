---
id: TC-NOTIFICATIONS-FX-017
title: "Actualizar un aviso ya leído conserva su estado de lectura"
spec: notifications/alerts
related_specs: ["fx/market-rate-providers"]
requirement: "Notificación de muestra anómala retenida"
scenario: "Aviso ya leído"
requirement_status: provisional
fr: ["FR-NOTIFY-005"]
nfr: []
invariants: []
priority: medium
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["notifications", "fx", "anomaly", "grouping"]
error_code: null
preconditions:
  - "Workspace W1 en America/La_Paz con OWNER, EDITOR y VIEWER activos, providers simulados (paralelo.bo principal, bo.dolarapi.com respaldo) y FixedClock"
  - "El EDITOR leyó el aviso del grupo de USDT/BOB"
input: {"newSamples": 1}
steps:
  - "Retener otra muestra del mismo grupo"
  - "GET W/notifications como EDITOR"
expected_result:
  - "La notificación muestra la cantidad nueva"
  - "Sigue leída y conserva su fecha de creación; no se programa email"
created: 2026-10-13
updated: 2026-10-13
---

# TC-NOTIFICATIONS-FX-017 — Actualizar un aviso ya leído conserva su estado de lectura

## Intención

Recomendación adoptada (pregunta 5 de design.md): bajar el ruido; la obsolescencia del par avisa si nadie revisa.

## Escenario

```gherkin
Dado el aviso de USDT/BOB leído
Cuando llega otra muestra del grupo
Entonces se actualiza y sigue leído
```

## Notas

- Change: `refine-rate-anomaly-alert-grouping` (borrador).
