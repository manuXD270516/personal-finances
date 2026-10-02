---
id: TC-FX-CURRENCY-001
title: "El catálogo de monedas expone tipo y escala de BOB, USD, USDT, BTC y ETH"
spec: fx/market-rates
related_specs: []
requirement: "Catálogo de monedas con tipo y escala"
scenario: "Catálogo base disponible"
requirement_status: confirmed
fr: ["FR-FX-001"]
nfr: []
invariants: ["INV-003"]
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["fx","currency"]
error_code: null
preconditions:
  - "Usuario con rol VIEWER en el workspace"
  - "Datos de referencia del catálogo cargados por migración"
input: {"filter_kind":"CRYPTO"}
steps:
  - "Consultar el catálogo de monedas sin filtro"
  - "Consultar el catálogo filtrando por tipo CRYPTO"
expected_result:
  - "BOB FIAT escala 2; USD FIAT escala 2; USDT CRYPTO escala 6; BTC CRYPTO escala 8; ETH CRYPTO escala 18"
  - "El filtro CRYPTO devuelve USDT, BTC y ETH y no devuelve BOB ni USD"
  - "La respuesta lleva ETag"
created: 2026-10-02
updated: 2026-10-02
---

# TC-FX-CURRENCY-001 — El catálogo de monedas expone tipo y escala de BOB, USD, USDT, BTC y ETH

## Intención

La escala de cada moneda es la base de la validación de montos (INV-003); si el catálogo la expone mal, toda la captura multi-moneda falla.

## Escenario

```gherkin
Dado el catálogo base de monedas
Cuando consulto las monedas del workspace
Entonces veo BOB y USD como FIAT con escala 2
  Y USDT, BTC y ETH como CRYPTO con escalas 6, 8 y 18
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
