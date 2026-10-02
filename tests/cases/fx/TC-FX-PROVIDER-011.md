---
id: TC-FX-PROVIDER-011
title: "El cliente de providers respeta el límite de solicitudes, la caché declarada y el intervalo mínimo"
spec: fx/market-rate-providers
related_specs: ["fx/market-rates"]
requirement: "Respeto de los límites de uso y la caché de los providers"
scenario: "Límite excedido"
requirement_status: confirmed
fr: ["FR-FX-017"]
nfr: ["NFR-COMP-007"]
invariants: []
priority: high
type: integration
level: container-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["fx","provider","rate-limit","cache","tos"]
error_code: "PROVIDER_RATE_LIMITED"
preconditions:
  - "Servidor HTTP local que simula paralelo.bo y cuenta solicitudes"
  - "FixedClock controlable"
input: {"cases": [{"at": "2026-10-02T09:00:00Z", "response": "429", "Retry-After": "120"}, {"at": "2026-10-02T09:00:00Z", "response": "200", "Cache-Control": "public, max-age=60", "second_request_at": "2026-10-02T09:00:30Z"}, {"FX_POLL_INTERVAL": "30s"}, {"burst": 100}]}
steps:
  - "Caso 429: ejecutar ciclos a las 09:00:00, 09:01:00 y 09:02:00"
  - "Caso caché: pedir dos lecturas a las 09:00:00 y 09:00:30"
  - "Caso intervalo: arrancar el worker con FX_POLL_INTERVAL=30s"
  - "Caso ráfaga: solicitar 100 lecturas en 1 minuto (p. ej. reintentos manuales)"
expected_result:
  - "429: ninguna solicitud a paralelo.bo antes de las 09:02:00Z; retry_after_until persistido en fx.provider_run (sobrevive a un reinicio); la valoración usa el respaldo mientras tanto"
  - "Caché: una sola solicitud HTTP; la segunda lectura reutiliza la respuesta"
  - "Intervalo 30s: los providers no se inician; el estado muestra FX_PROVIDER_CONFIG_INVALID; la API y el resto del worker siguen funcionando"
  - "Ráfaga: como máximo 60 solicitudes por minuto a paralelo.bo"
created: 2026-10-02
updated: 2026-10-02
---

# TC-FX-PROVIDER-011 — El cliente de providers respeta el límite de solicitudes, la caché declarada y el intervalo mínimo

## Intención

paralelo.bo publica Ratelimit-Limit 60/min y max-age 60; usar la fuente conforme a sus términos es condición de NFR-COMP-007.

## Escenario

```gherkin
Dado paralelo.bo responde 429 con Retry-After 120 a las 09:00Z
Cuando llegan los ciclos de 09:01Z
Entonces no se envía ninguna solicitud a paralelo.bo antes de las 09:02Z
```

## Notas

- Cabeceras verificadas en vivo el 2026-10-02: `Cache-Control: public, max-age=60`, `Ratelimit-Limit: 60`.
- Fechas fijas con `FixedClock`; instantes en UTC (America/La_Paz = UTC−4). Sin red en CI: providers simulados con fixtures grabados.
