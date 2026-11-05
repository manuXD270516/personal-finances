---
id: TC-RULES-SUGGEST-007
title: "Clave de descripción sin números, asteriscos ni palabras de un carácter"
spec: rules/rule-engine
related_specs: []
requirement: "Patrones por descripción normalizada y por contraparte"
scenario: "Clave sin números de tarjeta ni de sucursal"
requirement_status: provisional
fr: ["FR-RULES-011","FR-RULES-003"]
nfr: []
invariants: []
priority: medium
type: unit
level: unit
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["rules","rule-suggestions"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-11-04T10:00:00-04:00 (ventana de 180 días: 2026-05-08..2026-11-04)"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Telefonía\", \"Supermercado\", \"Farmacia\", \"Restaurantes\", \"Taxi\", \"Viajes\", \"Gimnasio\" y \"Recargas\"; contraparte \"Farmacorp\""
input: {"vectores":{"COMPRA TARJ ****1234 FARMACORP SUC 3":"compra tarj farmacorp suc","TIGO MONEY RECARGA 77712345":"tigo money recarga","PAGO QR  CAFÉ Alexander":"pago qr cafe alexander","A 12345":null}}
steps:
  - "Calcular DescriptionKey de cada vector"
expected_result:
  - "Cada clave igual a la esperada"
  - "\"A 12345\" sin clave (menos de 3 letras)"
  - "Mismos resultados que ruleTextFromDescription de la UI para los vectores de TC-RULES-ENGINE-054"
created: 2026-11-04
updated: 2026-11-04
---

# TC-RULES-SUGGEST-007 — Clave de descripción sin números, asteriscos ni palabras de un carácter

## Intención

Normalización canónica compartida con "crear regla desde una fila".

## Escenario

```gherkin
Dada una glosa bancaria con números
Cuando calculo su clave
Entonces quedan solo las palabras útiles
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-suggestions`.
