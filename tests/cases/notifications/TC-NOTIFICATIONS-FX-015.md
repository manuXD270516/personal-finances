---
id: TC-NOTIFICATIONS-FX-015
title: "Muestras retenidas de dos pares en el mismo ciclo generan un aviso por par"
spec: notifications/alerts
related_specs: ["fx/market-rate-providers"]
requirement: "Notificación de muestra anómala retenida"
scenario: "Varios pares en el mismo ciclo"
requirement_status: provisional
fr: ["FR-NOTIFY-004"]
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
  - "USDT/BOB y BTC/USDT configurados, sin muestras pendientes; provider cripto simulado"
input: {"pairs": ["USDT/BOB", "BTC/USDT"]}
steps:
  - "Correr un ciclo que retiene muestras de los dos pares"
  - "GET W/notifications como OWNER"
expected_result:
  - "El OWNER tiene dos notificaciones nuevas: una de USDT/BOB y otra de BTC/USDT"
created: 2026-10-13
updated: 2026-10-13
---

# TC-NOTIFICATIONS-FX-015 — Muestras retenidas de dos pares en el mismo ciclo generan un aviso por par

## Intención

Recomendación adoptada (pregunta 2 de design.md): un aviso por par, no uno por ciclo.

## Escenario

```gherkin
Dado muestras retenidas de USDT/BOB y BTC/USDT en el mismo ciclo
Cuando se notifica
Entonces hay un aviso por par
```

## Notas

- Change: `refine-rate-anomaly-alert-grouping` (borrador).
