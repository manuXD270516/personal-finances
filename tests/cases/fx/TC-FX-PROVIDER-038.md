---
id: TC-FX-PROVIDER-038
title: "Un par configurado sin tasa aceptada por más de 6 horas abre un único episodio de obsolescencia"
spec: fx/market-rate-providers
related_specs: []
requirement: "Episodios de obsolescencia por par configurado"
scenario: "Par sin tasa fresca por más de 6 horas"
requirement_status: confirmed
fr: ["FR-FX-010", "FR-NOTIFY-005"]
nfr: []
invariants: []
priority: critical
type: property
level: property
automation_status: automated
automated_tests:
  - packages/contexts/fx/src/application/rate-feed-alerts.test.ts
  - packages/contexts/fx/src/domain/feed-freshness.test.ts
  - packages/contexts/fx/test/integration/rate-feed-alerts.int.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["fx", "staleness", "episode", "pbt"]
error_code: null
preconditions:
  - "W1 configura USDT/BOB; última tasa PARALLEL aceptada con vigencia 2026-10-13T08:00:00Z"
  - "paralelo.bo y bo.dolarapi.com simulados con error desde las 08:10Z; N = 6 h"
input: {"checks": ["2026-10-13T14:00:00Z", "2026-10-13T14:15:00Z", "2026-10-13T14:30:00Z", "2026-10-13T15:00:00Z"]}
steps:
  - "Evaluar la frescura en cada instante"
  - "PBT: secuencias aleatorias de muestras y verificaciones (timeout explícito)"
expected_result:
  - "A las 14:00Z (6 h exactas) no se abre episodio"
  - "A las 14:15Z se abre un episodio desde 08:00Z y se emite un hecho de obsolescencia"
  - "A las 14:30Z y 15:00Z no se abre otro ni se emite otro hecho"
  - "PBT: nunca hay dos episodios abiertos del mismo par"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-PROVIDER-038 — Un par configurado sin tasa aceptada por más de 6 horas abre un único episodio de obsolescencia

## Intención

D233: una alerta por episodio, no una por ciclo; es el criterio de salida "alertas de obsolescencia funcionando".

## Escenario

```gherkin
Dado USDT/BOB sin tasa desde las 08:00Z
Cuando se verifica a las 14:15Z y después
Entonces hay un solo episodio y un solo hecho
```

## Notas

- Cubre también "Verificación repetida durante el episodio".
