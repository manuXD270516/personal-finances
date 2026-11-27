---
id: TC-PLATFORM-PERCEIVED-008
title: "Página abierta en segundo plano"
spec: platform/web-interface
related_specs: []
requirement: "Consultas periódicas en pausa con la pestaña oculta"
scenario: "Página abierta en segundo plano"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-006", "NFR-PERF-004"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/web/src/ui/common/polling.test.ts
  - tests/e2e/specs/perceived-performance.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["polling", "visibility"]
error_code: null
preconditions:
  - "OWNER con sesión y una corrida de pronósticos en curso"
input: {}
steps:
  - "el OWNER abre Pronósticos en una pestaña de fondo con una corrida en curso"
expected_result:
  - "la página no consulta la corrida hasta que el OWNER la mira"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PERCEIVED-008 — Página abierta en segundo plano

## Intención

Verifica el requirement «Consultas periódicas en pausa con la pestaña oculta» del change `refine-perceived-performance` (lote L7 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión y una corrida de pronósticos en curso
Cuando el OWNER abre Pronósticos en una pestaña de fondo con una corrida en curso
Entonces la página no consulta la corrida hasta que el OWNER la mira
```

## Notas

- Change `refine-perceived-performance` (lote L7 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
