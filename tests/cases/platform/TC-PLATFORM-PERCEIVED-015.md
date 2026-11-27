---
id: TC-PLATFORM-PERCEIVED-015
title: "Sin explicaciones solo en el atributo de título"
spec: platform/web-interface
related_specs: []
requirement: "Explicaciones accesibles sin depender del puntero"
scenario: "Sin explicaciones solo en el atributo de título"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-101", "NFR-USAB-102", "NFR-USAB-105", "NFR-USAB-006"]
invariants: []
priority: medium
type: unit
level: unit
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["toggletip", "static"]
error_code: null
preconditions:
  - "código fuente de `apps/web/src`"
input: {}
steps:
  - "se revisan los componentes de la interfaz"
expected_result:
  - "ningún texto explicativo vive solo en un atributo de título, salvo las excepciones marcadas y justificadas"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PERCEIVED-015 — Sin explicaciones solo en el atributo de título

## Intención

Verifica el requirement «Explicaciones accesibles sin depender del puntero» del change `refine-perceived-performance` (lote L7 de docs/78).

## Escenario

```gherkin
Dado código fuente de `apps/web/src`
Cuando se revisan los componentes de la interfaz
Entonces ningún texto explicativo vive solo en un atributo de título, salvo las excepciones marcadas y justificadas
```

## Notas

- Change `refine-perceived-performance` (lote L7 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
