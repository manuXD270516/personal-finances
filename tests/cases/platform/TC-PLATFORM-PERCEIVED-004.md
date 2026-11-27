---
id: TC-PLATFORM-PERCEIVED-004
title: "Filtrar la vista previa con las mejoras activas"
spec: platform/web-interface
related_specs: []
requirement: "Respuesta a la interacción sin empeorar"
scenario: "Filtrar la vista previa con las mejoras activas"
requirement_status: confirmed
fr: []
nfr: ["NFR-PERF-004", "NFR-USAB-006"]
invariants: []
priority: medium
type: e2e
level: performance
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["inp", "performance"]
error_code: null
preconditions:
  - "extracto sintético de 2 000 filas importado y cargado en la vista previa"
  - "transiciones activas"
input: {}
steps:
  - "con 2 000 filas cargadas en la vista previa del import se mide tres veces la respuesta al filtrar con las transiciones activas"
expected_result:
  - "la mediana no supera 200 ms o la vista previa filtra sin transición"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PERCEIVED-004 — Filtrar la vista previa con las mejoras activas

## Intención

Verifica el requirement «Respuesta a la interacción sin empeorar» del change `refine-perceived-performance` (lote L7 de docs/78).

## Escenario

```gherkin
Dado extracto sintético de 2 000 filas importado y cargado en la vista previa
  Y transiciones activas
Cuando con 2 000 filas cargadas en la vista previa del import se mide tres veces la respuesta al filtrar con las transiciones activas
Entonces la mediana no supera 200 ms o la vista previa filtra sin transición
```

## Notas

- Change `refine-perceived-performance` (lote L7 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
- Proyecto `inp` de Playwright, solo Chromium y en local (mediana de 3 corridas).
