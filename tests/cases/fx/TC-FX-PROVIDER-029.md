---
id: TC-FX-PROVIDER-029
title: "El provider cripto respeta su límite publicado, la caché y Retry-After también durante el backfill"
spec: fx/market-rate-providers
related_specs: []
requirement: "Respeto de los límites de uso y la caché de los providers"
scenario: null
requirement_status: provisional
fr: ["FR-FX-017"]
nfr: ["NFR-COMP-007"]
invariants: []
priority: high
type: integration
level: contract
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["fx", "crypto", "rate-limit", "retry-after"]
error_code: null
preconditions:
  - "Límite publicado del provider registrado en ADR-0029"
  - "Servidor local que responde 429 con Retry-After 120"
input: {"retryAfterSeconds": 120}
steps:
  - "Ejecutar un ciclo que recibe 429"
  - "Ejecutar el backfill paginado de 24 meses"
  - "Reiniciar el worker antes de que venza Retry-After"
expected_result:
  - "No hay solicitudes antes de vencer Retry-After, aun tras el reinicio (SKIPPED_RATE_LIMIT)"
  - "El backfill nunca supera el límite publicado en ninguna ventana de 60 s"
  - "La valoración aplica el fallback mientras tanto"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-PROVIDER-029 — El provider cripto respeta su límite publicado, la caché y Retry-After también durante el backfill

## Intención

FR-FX-017 y NFR-COMP-007 aplicados a la nueva fuente; el backfill es el caso de más solicitudes.

## Escenario

```gherkin
Dado un 429 con Retry-After 120
Cuando se reinicia el worker
Entonces no consulta al provider antes de 120 s
```

## Notas

