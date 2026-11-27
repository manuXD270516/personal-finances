---
id: TC-PLATFORM-PERCEIVED-009
title: "Contador de notificaciones"
spec: platform/web-interface
related_specs: []
requirement: "Consultas de fondo con prioridad baja"
scenario: "Contador de notificaciones"
requirement_status: confirmed
fr: []
nfr: ["NFR-PERF-004", "NFR-USAB-005"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["fetch-priority"]
error_code: null
preconditions:
  - "OWNER con sesión y notificaciones sin leer"
input: {}
steps:
  - "Inicio pide el número de notificaciones sin leer"
expected_result:
  - "la petición sale con prioridad baja"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PERCEIVED-009 — Contador de notificaciones

## Intención

Verifica el requirement «Consultas de fondo con prioridad baja» del change `refine-perceived-performance` (lote L7 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión y notificaciones sin leer
Cuando Inicio pide el número de notificaciones sin leer
Entonces la petición sale con prioridad baja
```

## Notas

- Change `refine-perceived-performance` (lote L7 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
- Prioridad leída por CDP (`Network.requestWillBeSent`, `request.initialPriority`), solo Chromium.
