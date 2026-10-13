---
id: TC-NOTIFICATIONS-FX-016
title: "Reprocesar un ciclo no crea ni duplica avisos ni cambia la cantidad"
spec: notifications/alerts
related_specs: ["fx/market-rate-providers"]
requirement: "Notificación de muestra anómala retenida"
scenario: "Ciclo reprocesado"
requirement_status: provisional
fr: ["FR-NOTIFY-005"]
nfr: []
invariants: ["INV-028"]
priority: critical
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["notifications", "fx", "anomaly", "idempotency"]
error_code: null
preconditions:
  - "Workspace W1 en America/La_Paz con OWNER, EDITOR y VIEWER activos, providers simulados (paralelo.bo principal, bo.dolarapi.com respaldo) y FixedClock"
  - "Ciclo de las 14:00Z ya procesado: aviso de USDT/BOB con 3 muestras pendientes"
input: {"cycle": "2026-10-13T14:00:00Z"}
steps:
  - "Reprocesar el mismo ciclo con las mismas muestras (reintento del job)"
  - "Entregar dos veces la misma foto del grupo por el puerto"
expected_result:
  - "Cada destinatario sigue con una sola notificación de USDT/BOB con 3 muestras pendientes"
  - "No hay entregas de email nuevas ni eventos nuevos"
created: 2026-10-13
updated: 2026-10-13
---

# TC-NOTIFICATIONS-FX-016 — Reprocesar un ciclo no crea ni duplica avisos ni cambia la cantidad

## Intención

Idempotencia ante reintentos: la inserción de muestras es idempotente y la foto del grupo es determinista.

## Escenario

```gherkin
Dado el ciclo de las 14:00Z ya procesado
Cuando se reprocesa
Entonces nada cambia
```

## Notas

- Change: `refine-rate-anomaly-alert-grouping` (borrador).
