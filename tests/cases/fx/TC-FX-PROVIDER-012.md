---
id: TC-FX-PROVIDER-012
title: "Toda tasa de provider y todo monto valorado con ella muestran la atribución de la fuente"
spec: fx/market-rate-providers
related_specs: ["fx/market-rates","reporting/dashboard"]
requirement: "Atribución visible de la fuente de la tasa"
scenario: "Dinero disponible valorado con paralelo.bo"
requirement_status: confirmed
fr: ["FR-FX-014"]
nfr: ["NFR-COMP-007"]
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["fx","provider","attribution","cc-by","license"]
error_code: null
preconditions:
  - "USDT/BOB PARALLEL 12.02 de paralelo.bo vigente; tasa manual USD/BOB P2P 11.98 con fuente \"Casa de cambio centro\""
  - "Cuenta líquida \"Wallet USDT\" 50.000000 USDT"
input: {"endpoints": ["GET /fx-rates/latest?base=USDT&quote=BOB", "GET /fx-rates/{id}", "GET /reports/summary"]}
steps:
  - "Consultar la tasa resuelta USDT/BOB"
  - "Consultar la tasa por id"
  - "Consultar el resumen del dashboard"
  - "Renderizar RateSourceBadge en la UI"
  - "Consultar una tasa manual"
expected_result:
  - "ResolvedRate.attribution = {provider PARALELO_BO, text \"Fuente: paralelo.bo\", url \"https://paralelo.bo\", license \"CC BY 4.0\", licenseUrl \"https://creativecommons.org/licenses/by/4.0/\"}"
  - "FxRate.attribution igual al anterior"
  - "ReportSummary.meta.attributions contiene la atribución de paralelo.bo una sola vez"
  - "La UI muestra \"Fuente: paralelo.bo\" como enlace junto a la tasa 12.02 y la licencia CC BY 4.0"
  - "Para bo.dolarapi.com el texto es \"Fuente: bo.dolarapi.com\" con enlace https://bo.dolarapi.com"
  - "La tasa manual muestra \"Casa de cambio centro\" y attribution null"
created: 2026-10-02
updated: 2026-10-02
---

# TC-FX-PROVIDER-012 — Toda tasa de provider y todo monto valorado con ella muestran la atribución de la fuente

## Intención

La licencia CC BY 4.0 exige atribución; sin ella el uso de los datos de paralelo.bo no es conforme.

## Escenario

```gherkin
Dado el dinero disponible valorado con USDT/BOB 12.02 de paralelo.bo
Cuando consulto el Home
Entonces junto a la tasa veo "Fuente: paralelo.bo" con enlace y licencia CC BY 4.0
```

## Notas

- Texto de atribución pedido por paralelo.bo (verificado el 2026-10-02): "paralelo.bo (https://paralelo.bo)".
- Fechas fijas con `FixedClock`; instantes en UTC (America/La_Paz = UTC−4). Sin red en CI: providers simulados con fixtures grabados.
