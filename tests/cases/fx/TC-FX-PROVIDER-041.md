---
id: TC-FX-PROVIDER-041
title: "No se abren episodios para pares solo manuales ni con todos los providers deshabilitados"
spec: fx/market-rate-providers
related_specs: []
requirement: "Episodios de obsolescencia por par configurado"
scenario: "Providers deshabilitados"
requirement_status: confirmed
fr: ["FR-FX-010", "FR-FX-015"]
nfr: []
invariants: []
priority: medium
type: unit
level: application
automation_status: automated
automated_tests:
  - packages/contexts/fx/src/application/rate-feed-alerts.test.ts
  - packages/contexts/fx/src/domain/feed-freshness.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["fx", "staleness", "config"]
error_code: "FX_PROVIDER_CONFIG_INVALID"
preconditions:
  - "W1 configura EUR/BOB sin provider y USDT/BOB"
input: {}
steps:
  - "Evaluar con EUR/BOB sin tasas durante 2 días"
  - "Configurar todos los providers en none y verificar"
  - "Configurar FX_FEED_STALE_ALERT_AFTER menor que el intervalo de polling"
expected_result:
  - "EUR/BOB nunca abre episodio"
  - "Con providers en none no se registra la cola ni se abre ningún episodio"
  - "Un N inválido deja los providers deshabilitados con FX_PROVIDER_CONFIG_INVALID sin detener el worker"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-PROVIDER-041 — No se abren episodios para pares solo manuales ni con todos los providers deshabilitados

## Intención

El core funciona sin providers (FR-FX-015) y un par sin cobertura automática no debe alertar para siempre.

## Escenario

```gherkin
Dado EUR/BOB solo manual
Cuando pasan 2 días
Entonces no hay episodio
```

## Notas

- Cubre "Par cubierto solo por tasas manuales".
