---
id: TC-NOTIFICATIONS-FX-010
title: "Un salto con mediana, compra y venta retenidas genera un solo aviso por destinatario y tres eventos"
spec: notifications/alerts
related_specs: ["fx/market-rate-providers"]
requirement: "Notificación de muestra anómala retenida"
scenario: "Salto con mediana, compra y venta"
requirement_status: provisional
fr: ["FR-NOTIFY-004", "FR-NOTIFY-005", "FR-FX-010"]
nfr: []
invariants: ["INV-028"]
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["notifications", "fx", "anomaly", "grouping"]
error_code: null
preconditions:
  - "Workspace W1 en America/La_Paz con OWNER, EDITOR y VIEWER activos, providers simulados (paralelo.bo principal, bo.dolarapi.com respaldo) y FixedClock"
  - "USDT/BOB sin muestras retenidas pendientes; líneas base PARALLEL 12.05, PARALLEL_BUY 12.00 y PARALLEL_SELL 12.10"
input: {"cycle": "2026-10-13T14:00:00Z", "samples": {"PARALLEL": "12.80", "PARALLEL_BUY": "12.70", "PARALLEL_SELL": "12.90"}}
steps:
  - "Correr el ciclo de las 14:00Z con las tres muestras de paralelo.bo"
  - "GET W/notifications como OWNER, EDITOR y VIEWER"
  - "Leer el outbox del ciclo"
expected_result:
  - "OWNER y EDITOR tienen cada uno una sola notificación FX_RATE_ANOMALY_RETAINED de USDT/BOB con 3 muestras pendientes"
  - "La mayor variación mostrada es PARALLEL_SELL 12.90 frente a 12.10 (+6.61 %) de paralelo.bo; el enlace lleva a la muestra pendiente más antigua"
  - "El VIEWER no tiene notificaciones"
  - "El outbox tiene tres fx.RateAnomalyRetained.v1, uno por muestra"
created: 2026-10-13
updated: 2026-10-13
---

# TC-NOTIFICATIONS-FX-010 — Un salto con mediana, compra y venta retenidas genera un solo aviso por destinatario y tres eventos

## Intención

Respuesta del owner (2026-10-13): agrupar los avisos que hoy son uno por muestra (hasta 3 por par y salto).

## Escenario

```gherkin
Dado tres muestras de USDT/BOB retenidas en el mismo ciclo
Cuando se notifica el salto
Entonces OWNER y EDITOR tienen un solo aviso con 3 muestras pendientes y se publican tres eventos
```

## Notas

- Change: `refine-rate-anomaly-alert-grouping` (borrador).
