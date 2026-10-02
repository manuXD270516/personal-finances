---
id: TC-FX-PROVIDER-010
title: "Una muestra con variación mayor al umbral queda retenida hasta que un editor la confirma"
spec: fx/market-rate-providers
related_specs: ["fx/market-rates","audit/audit-trail"]
requirement: "Detección de tasas anómalas"
scenario: "Salto anómalo retenido"
requirement_status: confirmed
fr: ["FR-FX-010"]
nfr: []
invariants: ["INV-011","INV-029"]
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["fx","provider","anomaly","audit"]
error_code: "FX_RATE_ANOMALY_ALREADY_REVIEWED"
preconditions:
  - "FX_ANOMALY_THRESHOLD_PCT = 5"
  - "Tasa aceptada anterior de paralelo.bo USD/BOB PARALLEL = 12.02 (asOf 2026-10-02T08:53:07.532Z)"
  - "Usuarios OWNER, EDITOR y VIEWER en el workspace"
input: {"sample": {"median": "13.50", "timestamp": "2026-10-02T09:08:00.000Z"}, "normal_sample": {"median": "12.10"}, "review": {"decision": "CONFIRM", "reason": "devaluación anunciada"}}
steps:
  - "Procesar la muestra 13.50 a las 09:15Z"
  - "Valorar 100.00 USD a las 09:20Z"
  - "VIEWER intenta confirmar (debe fallar con 403)"
  - "EDITOR confirma con motivo"
  - "Valorar 100.00 USD de nuevo"
  - "Intentar revisar otra vez la misma tasa"
  - "Variante: procesar 12.10 contra la base 12.02"
expected_result:
  - "La tasa 13.50 se registra con anomaly.status PENDING, variationPct 12.3128, thresholdPct 5, baselineRateId = id de 12.02"
  - "Mientras está pendiente: 100.00 USD = 1202.00 BOB con 12.02"
  - "VIEWER recibe 403 INSUFFICIENT_ROLE"
  - "Tras confirmar: 100.00 USD = 1350.00 BOB con 13.50; la auditoría registra actor, instante y motivo en la misma transacción"
  - "La segunda revisión responde 409 FX_RATE_ANOMALY_ALREADY_REVIEWED"
  - "Variante: 12.10 (+0.6656 %) se usa sin confirmación"
created: 2026-10-02
updated: 2026-10-02
---

# TC-FX-PROVIDER-010 — Una muestra con variación mayor al umbral queda retenida hasta que un editor la confirma

## Intención

Un error del provider (o una manipulación del P2P) no debe mover el patrimonio del usuario sin que lo vea.

## Escenario

```gherkin
Dada la tasa aceptada 12.02
Cuando llega una muestra de 13.50 (+12.31 %)
Entonces se registra marcada como anómala
  Y la valoración sigue usando 12.02 hasta que un editor la confirme
```

## Notas

- Variación: (13.50 − 12.02) / 12.02 × 100 = 12.312811…; persistida HALF_EVEN a 4 decimales (12.3128) y mostrada a 2 (12.31 %).
- Una anomalía rechazada nunca se usa y no pasa a ser línea base.
- Fechas fijas con `FixedClock`; instantes en UTC (America/La_Paz = UTC−4). Sin red en CI: providers simulados con fixtures grabados.
