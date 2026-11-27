---
id: TC-PLATFORM-PWA-003
title: "Atajo para registrar un gasto"
spec: platform/web-interface
related_specs: []
requirement: "Manifiesto de la aplicación instalable"
scenario: "Atajo para registrar un gasto"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-005", "NFR-USAB-006", "NFR-SEC-008"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["pwa"]
error_code: null
preconditions:
  - "manifiesto publicado"
input: {}
steps:
  - "se lee el manifiesto"
expected_result:
  - "declara un atajo «Registrar gasto» que abre el alta de transacción dentro del alcance de la aplicación"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PWA-003 — Atajo para registrar un gasto

## Intención

Verifica el requirement «Manifiesto de la aplicación instalable» del change `add-pwa-install` (lote L6 de docs/78).

## Escenario

```gherkin
Dado manifiesto publicado
Cuando se lee el manifiesto
Entonces declara un atajo «Registrar gasto» que abre el alta de transacción dentro del alcance de la aplicación
```

## Notas

- Change `add-pwa-install` (lote L6 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
