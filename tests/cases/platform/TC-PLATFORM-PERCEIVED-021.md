---
id: TC-PLATFORM-PERCEIVED-021
title: "Navegador sin soporte"
spec: platform/web-interface
related_specs: []
requirement: "Campos de texto largos que crecen con su contenido"
scenario: "Navegador sin soporte"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-006", "NFR-USAB-005"]
invariants: []
priority: low
type: unit
level: unit
automation_status: automated
automated_tests:
  - apps/web/src/ui/common/perceived-css.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["forms", "field-sizing", "progressive-enhancement"]
error_code: null
preconditions:
  - "hoja `app/globals.css`"
input: {}
steps:
  - "el EDITOR escribe el mismo motivo en un navegador sin soporte"
expected_result:
  - "el campo mantiene su alto actual y se puede desplazar"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PERCEIVED-021 — Navegador sin soporte

## Intención

Verifica el requirement «Campos de texto largos que crecen con su contenido» del change `refine-perceived-performance` (lote L7 de docs/78).

## Escenario

```gherkin
Dado hoja `app/globals.css`
Cuando el EDITOR escribe el mismo motivo en un navegador sin soporte
Entonces el campo mantiene su alto actual y se puede desplazar
```

## Notas

- Change `refine-perceived-performance` (lote L7 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
- Sin soporte de `field-sizing` la regla está dentro de `@supports` y no aplica: se verifica con el test estático de CSS.
