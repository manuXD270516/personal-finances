---
id: TC-PLATFORM-CLIENTNAV-001
title: "Informe de la navegación"
spec: platform/web-interface
related_specs: []
requirement: "Medición de la navegación entre secciones"
scenario: "Informe de la navegación"
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
tags: ["navigation", "performance"]
error_code: null
preconditions:
  - "OWNER con sesión y un gasto de 45.00 BOB"
  - "proyecto `inp` de Playwright en Chromium"
input: {}
steps:
  - "termina la medición de la navegación desde Inicio hacia Transacciones, Presupuestos, Reportes y el detalle de un gasto de 45.00 BOB"
expected_result:
  - "el informe muestra para cada destino el tiempo hasta el contenido propio y la mayor pintura de contenido en ms, en los dos perfiles, con su estado frente a 2.5 s"
  - "la suite no falla aunque un valor supere 2.5 s"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-CLIENTNAV-001 — Informe de la navegación

## Intención

Verifica el requirement «Medición de la navegación entre secciones» del change `adopt-client-navigation` (P12 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión y un gasto de 45.00 BOB
  Y proyecto `inp` de Playwright en Chromium
Cuando termina la medición de la navegación desde Inicio hacia Transacciones, Presupuestos, Reportes y el detalle de un gasto de 45.00 BOB
Entonces el informe muestra para cada destino el tiempo hasta el contenido propio y la mayor pintura de contenido en ms, en los dos perfiles, con su estado frente a 2.5 s
  Y la suite no falla aunque un valor supere 2.5 s
```

## Notas

- Change `adopt-client-navigation` (P12 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
- Etapa 1 (sin condición). Parte unitaria del informe en `tests/e2e/src/navigation-timing.test.ts`.
