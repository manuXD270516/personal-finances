---
id: TC-PLATFORM-TABLES-017
title: "La suite informa el INP de los cuatro flujos con el extracto de 2 000 filas"
spec: platform/web-interface
related_specs: []
requirement: "Medición de la respuesta a interacciones"
scenario: "Informe de la medición"
requirement_status: confirmed
fr: []
nfr: ["NFR-PERF-004"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["performance", "inp"]
error_code: null
preconditions:
  - "extracto sintético de 2 000 filas generado por el test, sin datos reales"
input: {}
steps:
  - "corre inp.spec.ts en Chromium con el extracto sintético de 2 000 filas"
expected_result:
  - "el informe adjunto tiene el INP en ms de abrir fila, filtrar, aprobar y edición masiva"
  - "cada fila muestra el objetivo de 200 ms y el aviso de 500 ms"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-TABLES-017 — La suite informa el INP de los cuatro flujos con el extracto de 2 000 filas

## Intención

Verifica el requirement «Medición de la respuesta a interacciones» del change `refine-data-tables` (lote L5 de docs/78).

## Escenario

```gherkin
Dado extracto sintético de 2 000 filas generado por el test, sin datos reales
Cuando corre inp.spec.ts en Chromium con el extracto sintético de 2 000 filas
Entonces el informe adjunto tiene el INP en ms de abrir fila, filtrar, aprobar y edición masiva
  Y cada fila muestra el objetivo de 200 ms y el aviso de 500 ms
```

## Notas

- Change `refine-data-tables` (lote L5, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
