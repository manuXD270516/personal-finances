---
id: TC-PLATFORM-MOBNAV-001
title: "A 360 px el EDITOR ve los cinco destinos con Plan como sección actual"
spec: platform/web-interface
related_specs: []
requirement: "Barra de navegación inferior en pantallas angostas"
scenario: "EDITOR en el teléfono"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-006", "NFR-USAB-106"]
invariants: []
priority: high
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["mobile", "navigation", "i18n"]
error_code: null
preconditions:
  - "EDITOR con sesión"
input: {}
steps:
  - "un EDITOR abre Presupuestos a 360 × 800"
expected_result:
  - "la barra inferior tiene, en orden, Inicio, Transacciones, «＋ Registrar», Plan y Más"
  - "Plan tiene aria-current=\"page\""
  - "cada destino mide ≥ 44 × 44 px"
  - "document.documentElement.scrollWidth ≤ 360"
  - "textos en es, en y pt sin desbordar; captura adjuntada"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-MOBNAV-001 — A 360 px el EDITOR ve los cinco destinos con Plan como sección actual

## Intención

Verifica el requirement «Barra de navegación inferior en pantallas angostas» del change `refine-mobile-navigation` (lote L4 de docs/78).

## Escenario

```gherkin
Dado EDITOR con sesión
Cuando un EDITOR abre Presupuestos a 360 × 800
Entonces la barra inferior tiene, en orden, Inicio, Transacciones, «＋ Registrar», Plan y Más
  Y Plan tiene aria-current="page"
  Y cada destino mide ≥ 44 × 44 px
  Y document.documentElement.scrollWidth ≤ 360
  Y textos en es, en y pt sin desbordar; captura adjuntada
```

## Notas

- Change `refine-mobile-navigation` (lote L4, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
