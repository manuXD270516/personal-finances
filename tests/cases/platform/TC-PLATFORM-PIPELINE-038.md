---
id: TC-PLATFORM-PIPELINE-038
title: "Con 37 eventos pendientes al vencer los 600 s la ráfaga se publica «sin completar» con el diagnóstico del outbox y el job no falla por ella"
spec: platform/delivery-pipeline
related_specs: ["imports/import-pipeline"]
requirement: "Una suite informativa no decide el veredicto aunque su preparación no termine"
scenario: "Outbox que no llega a 0 en la preparación"
requirement_status: confirmed
fr: []
nfr: ["NFR-PERF-008"]
invariants: []
priority: high
type: platform
level: unit
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["nightly", "perf", "imports", "stabilize-import-persist-perf"]
error_code: null
preconditions:
  - "Resultado sintético del benchmark del import de 5 000 filas (sin Docker; reporte del harness de rendimiento)"
  - "Datos ficticios; ningún dato de extractos reales del owner (D255, D281)"
input: {"outbox_pending":37,"preparation_cap_ms":600000}
steps:
  - "Simular el vencimiento de la espera del outbox en la preparación de la ráfaga con los 37 pendientes del input"
expected_result:
  - "La suite se publica «sin completar» con el paso de publicación del outbox, los 37 eventos por tipo, sus intentos y su último error"
  - "El veredicto del job no cambia por esa suite"
created: 2026-11-09
updated: 2026-11-09
---

# TC-PLATFORM-PIPELINE-038 — Con 37 eventos pendientes al vencer los 600 s la ráfaga se publica «sin completar» con el diagnóstico del outbox y el job no falla por ella

## Intención

Requirement «Una suite informativa no decide el veredicto aunque su preparación no termine» de `platform/delivery-pipeline` (change `stabilize-import-persist-perf`).

## Escenario

```gherkin
Dado Resultado sintético del benchmark del import de 5 000 filas (sin Docker; reporte del harness de rendimiento)
Cuando en la preparación de la ráfaga el outbox conserva 37 eventos pendientes al vencer el tope de 600 s
Entonces la suite se publica «sin completar» con el paso de publicación del outbox, los 37 eventos por tipo, sus intentos y su último error
  Y el veredicto del job no cambia por esa suite
```

## Notas

- Síntoma del nightly programado 42483000755 (2026-11-08): la preparación de la fase A cortó por tiempo en la espera del outbox. Aplica D300 y D359.
- El umbral de 20 s de NFR-PERF-007 no cambia (decisión del owner del 2026-11-09).
