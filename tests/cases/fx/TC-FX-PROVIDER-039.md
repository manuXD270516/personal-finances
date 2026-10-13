---
id: TC-FX-PROVIDER-039
title: "Una tasa fresca cierra el episodio con un único hecho de recuperación y una tasa manual no lo cierra"
spec: fx/market-rate-providers
related_specs: []
requirement: "Episodios de obsolescencia por par configurado"
scenario: "Recuperación del par"
requirement_status: confirmed
fr: ["FR-FX-010"]
nfr: []
invariants: []
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - packages/contexts/fx/src/application/rate-feed-alerts.test.ts
  - packages/contexts/fx/src/domain/feed-freshness.test.ts
  - packages/contexts/fx/test/integration/rate-feed-alerts.int.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["fx", "staleness", "recovery"]
error_code: null
preconditions:
  - "Episodio abierto de USDT/BOB en W1 (TC-FX-PROVIDER-038)"
input: {"manual": "12.00", "providerRate": "12.05", "asOf": "2026-10-13T15:58:00Z"}
steps:
  - "El EDITOR registra USDT/BOB P2P 12.00 manual y corre un ciclo"
  - "paralelo.bo publica 12.05 y corre el ciclo de las 16:00Z"
  - "Repetir el ciclo de las 16:15Z"
  - "Simular otra caída de más de 6 h"
expected_result:
  - "Con la tasa manual el episodio sigue abierto"
  - "A las 16:00Z el episodio se cierra con recovered_rate_id y se escribe un único fx.RateFeedRecovered.v1"
  - "A las 16:15Z no hay otro hecho de recuperación"
  - "La nueva caída abre un episodio nuevo"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-PROVIDER-039 — Una tasa fresca cierra el episodio con un único hecho de recuperación y una tasa manual no lo cierra

## Intención

D233 incluye el aviso de recuperación; las manuales no cuentan como tasa de provider.

## Escenario

```gherkin
Dado el episodio abierto
Cuando llega 12.05 de paralelo.bo
Entonces el episodio se cierra una sola vez
```

## Notas

- Cubre "Tasa manual no evita el episodio".
