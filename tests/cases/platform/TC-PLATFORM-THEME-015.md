---
id: TC-PLATFORM-THEME-015
title: "axe en oscuro no informa violaciones serias ni críticas en las pantallas principales"
spec: platform/web-interface
related_specs: []
requirement: "Contraste en los temas claro y oscuro"
scenario: "Análisis de accesibilidad en oscuro"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-101", "NFR-USAB-103"]
invariants: []
priority: high
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/a11y.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["theme", "a11y", "axe"]
error_code: null
preconditions:
  - "Minimal Seed con un gasto de 60.00 BOB en \"Banco BOB\""
input:
  monto: "60.00"
  moneda: "BOB"
steps:
  - "con colorScheme dark se analizan Inicio, Transacciones, alta, detalle de un gasto de 60.00 BOB, Presupuestos, Reportes, recorrido y Preferencias"
expected_result:
  - "axe no informa violaciones serious ni critical (incluida color-contrast)"
  - "capturas a 360 px y a 1280 px adjuntadas"
created: 2026-11-25
updated: 2026-11-27
---

# TC-PLATFORM-THEME-015 — axe en oscuro no informa violaciones serias ni críticas en las pantallas principales

## Intención

Verifica el requirement «Contraste en los temas claro y oscuro» del change `add-dark-theme` (lote L3 de docs/78).

## Escenario

```gherkin
Dado Minimal Seed con un gasto de 60.00 BOB en "Banco BOB"
Cuando con colorScheme dark se analizan Inicio, Transacciones, alta, detalle de un gasto de 60.00 BOB, Presupuestos, Reportes, recorrido y Preferencias
Entonces axe no informa violaciones serious ni critical (incluida color-contrast)
  Y capturas a 360 px y a 1280 px adjuntadas
```

## Notas

- Change `add-dark-theme` (lote L3, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
