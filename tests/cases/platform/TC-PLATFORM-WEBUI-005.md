---
id: TC-PLATFORM-WEBUI-005
title: "Un monto USDT con 7 decimales muestra el error al salir del campo"
spec: platform/web-interface
related_specs: []
requirement: "Validación de montos al salir del campo"
scenario: "Escala de USDT al salir del campo"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-003","NFR-USAB-101"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["a11y","forms","money","multi-currency"]
error_code: null
preconditions:
  - "un EDITOR con sesión y una cuenta activa en USDT"
  - "el formulario de gasto abierto con esa cuenta"
input:
  monto: "10.1234567"
  moneda: "USDT"
steps:
  - "el usuario escribe el monto y sale del campo con Tab"
expected_result:
  - "el campo muestra \"USDT admite hasta 6 decimales\""
  - "el campo tiene aria-invalid=\"true\""
  - "no se envió el formulario"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-WEBUI-005 — Un monto USDT con 7 decimales muestra el error al salir del campo

## Intención

Verifica que el error de escala llega al salir del campo y no después de completar el resto (M-02, NFR-USAB-003).

## Escenario

```gherkin
Dado un EDITOR con sesión y una cuenta activa en USDT
  Y el formulario de gasto abierto con esa cuenta
Cuando el usuario escribe el monto y sale del campo con Tab
Entonces el campo muestra "USDT admite hasta 6 decimales"
  Y el campo tiene aria-invalid="true"
  Y no se envió el formulario
```

## Notas

- Change `refine-web-accessibility-foundations` (lote L1, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
