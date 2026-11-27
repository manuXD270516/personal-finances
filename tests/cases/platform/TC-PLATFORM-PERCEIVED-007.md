---
id: TC-PLATFORM-PERCEIVED-007
title: "Volver a la pestaña"
spec: platform/web-interface
related_specs: []
requirement: "Consultas periódicas en pausa con la pestaña oculta"
scenario: "Volver a la pestaña"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-006", "NFR-PERF-004"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["polling", "visibility"]
error_code: null
preconditions:
  - "OWNER con sesión y un import confirmado que terminó con la pestaña oculta"
input: {}
steps:
  - "el import terminó mientras la pestaña estaba oculta y el OWNER vuelve a ella"
expected_result:
  - "la página consulta enseguida y muestra el import terminado con sus 2 000 filas"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PERCEIVED-007 — Volver a la pestaña

## Intención

Verifica el requirement «Consultas periódicas en pausa con la pestaña oculta» del change `refine-perceived-performance` (lote L7 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión y un import confirmado que terminó con la pestaña oculta
Cuando el import terminó mientras la pestaña estaba oculta y el OWNER vuelve a ella
Entonces la página consulta enseguida y muestra el import terminado con sus 2 000 filas
```

## Notas

- Change `refine-perceived-performance` (lote L7 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
