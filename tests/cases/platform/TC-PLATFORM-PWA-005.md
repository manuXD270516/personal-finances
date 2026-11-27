---
id: TC-PLATFORM-PWA-005
title: "Ícono adaptable recortado en círculo"
spec: platform/web-interface
related_specs: []
requirement: "Íconos de la aplicación instalada"
scenario: "Ícono adaptable recortado en círculo"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-005", "NFR-USAB-103"]
invariants: []
priority: low
type: unit
level: unit
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["pwa"]
error_code: null
preconditions:
  - "ícono adaptable de 512 × 512 px generado desde la fuente SVG"
input: {}
steps:
  - "el ícono adaptable se recorta con la máscara circular más chica que admite la zona segura"
expected_result:
  - "el motivo completo queda dentro del círculo"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PWA-005 — Ícono adaptable recortado en círculo

## Intención

Verifica el requirement «Íconos de la aplicación instalada» del change `add-pwa-install` (lote L6 de docs/78).

## Escenario

```gherkin
Dado ícono adaptable de 512 × 512 px generado desde la fuente SVG
Cuando el ícono adaptable se recorta con la máscara circular más chica que admite la zona segura
Entonces el motivo completo queda dentro del círculo
```

## Notas

- Change `add-pwa-install` (lote L6 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
- Se comprueba con la fuente SVG: el motivo cabe en el círculo central del 80 % del lado.
