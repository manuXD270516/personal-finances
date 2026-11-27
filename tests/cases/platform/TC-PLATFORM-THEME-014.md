---
id: TC-PLATFORM-THEME-014
title: "Todos los pares de colores del tema alcanzan su contraste en claro y en oscuro"
spec: platform/web-interface
related_specs: []
requirement: "Contraste en los temas claro y oscuro"
scenario: "Pares de colores del tema"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-103"]
invariants: []
priority: high
type: unit
level: unit
automation_status: automated
automated_tests:
  - apps/web/src/ui/common/contrast.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["theme", "contrast", "tokens"]
error_code: null
preconditions:
  - "tabla de pares en el test"
input: {}
steps:
  - "el test lee app/globals.css, extrae los tokens de cada esquema y calcula el contraste WCAG 2.2 de cada par de la tabla del design"
expected_result:
  - "texto ≥ 4.5:1, texto grande ≥ 3:1, bordes de control, foco y series de gráficos ≥ 3:1 en los dos esquemas"
  - "los dos bloques oscuros (media y data-theme) declaran los mismos valores"
created: 2026-11-25
updated: 2026-11-27
---

# TC-PLATFORM-THEME-014 — Todos los pares de colores del tema alcanzan su contraste en claro y en oscuro

## Intención

Verifica el requirement «Contraste en los temas claro y oscuro» del change `add-dark-theme` (lote L3 de docs/78).

## Escenario

```gherkin
Dado tabla de pares en el test
Cuando el test lee app/globals.css, extrae los tokens de cada esquema y calcula el contraste WCAG 2.2 de cada par de la tabla del design
Entonces texto ≥ 4.5:1, texto grande ≥ 3:1, bordes de control, foco y series de gráficos ≥ 3:1 en los dos esquemas
  Y los dos bloques oscuros (media y data-theme) declaran los mismos valores
```

## Notas

- Change `add-dark-theme` (lote L3, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
