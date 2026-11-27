---
id: TC-PLATFORM-PERCEIVED-019
title: "Monto sin partir"
spec: platform/web-interface
related_specs: []
requirement: "Diseño que respeta el tamaño de texto del sistema"
scenario: "Monto sin partir"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-107", "NFR-USAB-006"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/web/src/ui/common/perceived-css.test.ts
  - tests/e2e/specs/perceived-performance.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["text-scale"]
error_code: null
preconditions:
  - "OWNER con sesión, un gasto de 12345.67 BOB y el texto al 200 %"
input: {}
steps:
  - "con el texto al 200 % se muestra un gasto de 12345.67 BOB en una columna angosta"
expected_result:
  - "«Bs 12.345,67» queda en una sola línea"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PERCEIVED-019 — Monto sin partir

## Intención

Verifica el requirement «Diseño que respeta el tamaño de texto del sistema» del change `refine-perceived-performance` (lote L7 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión, un gasto de 12345.67 BOB y el texto al 200 %
Cuando con el texto al 200 % se muestra un gasto de 12345.67 BOB en una columna angosta
Entonces «Bs 12.345,67» queda en una sola línea
```

## Notas

- Change `refine-perceived-performance` (lote L7 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
