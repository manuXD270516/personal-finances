---
id: TC-PLATFORM-MOBNAV-006
title: "El cajón «Más» abre modal, con grupos y sin violaciones de axe"
spec: platform/web-interface
related_specs: []
requirement: "Cajón «Más» con las secciones agrupadas"
scenario: "Abrir el cajón"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-101", "NFR-USAB-102"]
invariants: []
priority: high
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["mobile", "drawer", "a11y"]
error_code: null
preconditions:
  - "OWNER con sesión"
input: {}
steps:
  - "a 360 px en Inicio, el OWNER activa «Más»"
  - "pulsa Tab 30 veces"
expected_result:
  - "hay un diálogo modal con nombre"
  - "contiene los encabezados Día a día, Planificar, Analizar, Organizar y Ajustes"
  - "el foco nunca sale del cajón"
  - "axe no informa violaciones serious ni critical; captura adjuntada"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-MOBNAV-006 — El cajón «Más» abre modal, con grupos y sin violaciones de axe

## Intención

Verifica el requirement «Cajón «Más» con las secciones agrupadas» del change `refine-mobile-navigation` (lote L4 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión
Cuando a 360 px en Inicio, el OWNER activa «Más»
  Y pulsa Tab 30 veces
Entonces hay un diálogo modal con nombre
  Y contiene los encabezados Día a día, Planificar, Analizar, Organizar y Ajustes
  Y el foco nunca sale del cajón
  Y axe no informa violaciones serious ni critical; captura adjuntada
```

## Notas

- Change `refine-mobile-navigation` (lote L4, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
