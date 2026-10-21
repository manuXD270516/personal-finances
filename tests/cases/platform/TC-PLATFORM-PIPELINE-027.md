---
id: TC-PLATFORM-PIPELINE-027
title: "Cada benchmark rojo de perf en dos corridas seguidas tiene causa medida, evidencia y camino registrados"
spec: platform/delivery-pipeline
related_specs: ["reporting/dashboard", "commitments/recurrence-engine", "platform/event-delivery"]
requirement: "Causa de los rojos de rendimiento documentada antes de cambiar un umbral"
scenario: "Rojo con causa medida y camino"
requirement_status: confirmed
fr: []
nfr: [NFR-PERF-004, NFR-PERF-008, NFR-MAINT-005]
invariants: []
priority: medium
type: platform
level: smoke
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["nightly", "perf", "review"]
error_code: null
preconditions:
  - "Dos corridas nocturnas seguidas con el benchmark en rojo (la primera conocida para disponible para gastar: 39669892721)"
  - "Informe docs/NN-perf-under-load-findings.md publicado"
input:
  red_benchmarks:
    - "TC-REPORTING-SPENDABLE-014 / TC-PLATFORM-PIPELINE-018: p95 352.2 ms y 341.1 ms frente a 300 ms"
    - "TC-COMMITMENTS-MATCH-012: 6.2 ev/s frente a 42 ev/s"
steps:
  - "Revisión manual al cerrar el change: recorrer cada benchmark rojo del alcance"
expected_result:
  - "docs/23 §5.5 registra, por benchmark, la causa medida, las mediciones con y sin carga de fondo y el camino elegido"
  - "Las notas de TC-REPORTING-SPENDABLE-014, TC-PLATFORM-PIPELINE-018 y TC-COMMITMENTS-MATCH-012 enlazan ese registro"
  - "Ningún umbral cambió sin una decisión del owner"
created: 2026-10-21
updated: 2026-10-21
---

# TC-PLATFORM-PIPELINE-027 — Cada benchmark rojo de perf en dos corridas seguidas tiene causa medida, evidencia y camino registrados

## Intención

Criterio de salida de `investigate-perf-under-load`: un rojo no se cierra cambiando el umbral ni pasándolo a informativo, sino con una causa medida y un camino.

## Escenario

```gherkin
Dado el benchmark de disponible para gastar en rojo dos noches seguidas con p95 de 352.2 ms
Cuando se cierra la investigación
Entonces docs/23 registra la causa medida, las mediciones y el camino
  Y el TC del benchmark enlaza ese registro
```

## Notas

- Change `investigate-perf-under-load` (D290). Revisión manual (tarea 8.2); no tiene test automatizado: al cerrar el change pasa a `automation_status: manual` y `status: ready`.
