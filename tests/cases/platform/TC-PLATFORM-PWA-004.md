---
id: TC-PLATFORM-PWA-004
title: "Íconos declarados y servidos"
spec: platform/web-interface
related_specs: []
requirement: "Íconos de la aplicación instalada"
scenario: "Íconos declarados y servidos"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-005", "NFR-USAB-103"]
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
  - "persona sin sesión"
  - "manifiesto publicado"
input: {}
steps:
  - "se piden sin sesión todos los íconos que declaran el manifiesto y las páginas"
expected_result:
  - "cada uno responde con estado 200, tipo de imagen PNG y las dimensiones que declara"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PWA-004 — Íconos declarados y servidos

## Intención

Verifica el requirement «Íconos de la aplicación instalada» del change `add-pwa-install` (lote L6 de docs/78).

## Escenario

```gherkin
Dado persona sin sesión
  Y manifiesto publicado
Cuando se piden sin sesión todos los íconos que declaran el manifiesto y las páginas
Entonces cada uno responde con estado 200, tipo de imagen PNG y las dimensiones que declara
```

## Notas

- Change `add-pwa-install` (lote L6 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
- Parte unitaria en `src/ui/brand/icons.test.ts` (firma y dimensiones de los PNG).
