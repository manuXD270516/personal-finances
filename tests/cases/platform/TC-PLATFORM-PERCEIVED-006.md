---
id: TC-PLATFORM-PERCEIVED-006
title: "Persistencia del import con la pestaña oculta"
spec: platform/web-interface
related_specs: []
requirement: "Consultas periódicas en pausa con la pestaña oculta"
scenario: "Persistencia del import con la pestaña oculta"
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
  - "OWNER con sesión y un extracto sintético de 2 000 filas listo para confirmar"
input: {}
steps:
  - "el OWNER confirma un import de 2 000 filas y pasa a otra pestaña durante 30 s"
expected_result:
  - "en esos 30 s la página no consulta el estado del import"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PERCEIVED-006 — Persistencia del import con la pestaña oculta

## Intención

Verifica el requirement «Consultas periódicas en pausa con la pestaña oculta» del change `refine-perceived-performance` (lote L7 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión y un extracto sintético de 2 000 filas listo para confirmar
Cuando el OWNER confirma un import de 2 000 filas y pasa a otra pestaña durante 30 s
Entonces en esos 30 s la página no consulta el estado del import
```

## Notas

- Change `refine-perceived-performance` (lote L7 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
- Parte unitaria de `createVisiblePoller` en `src/ui/common/polling.test.ts`.
