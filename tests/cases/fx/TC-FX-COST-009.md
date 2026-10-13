---
id: TC-FX-COST-009
title: "De punta a punta: conversiones registradas, análisis por canal y exportación desde la UI"
spec: fx/conversion-pricing
related_specs: []
requirement: "Análisis de costo de conversiones por canal, par y periodo"
scenario: null
requirement_status: confirmed
fr: ["FR-FX-011"]
nfr: ["NFR-USAB-001"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/web/src/ui/fx/conversion-costs.test.tsx
  - tests/e2e/specs/fx-conversion-costs.spec.ts
status: automated
regression_suite: false
phase: 5
tags: ["fx", "conversion-cost", "ui", "e2e"]
error_code: null
preconditions:
  - "EDITOR autenticado; tasas USDT/BOB 12.00 registradas"
input: {}
steps:
  - "Registrar las dos ventas por \"Binance P2P\" y la compra sin contraparte"
  - "Abrir Reportes → Costo de conversiones para octubre"
  - "Exportar CSV"
expected_result:
  - "La tabla muestra \"Binance P2P\" con 0.5833 % y 30.00 BOB y \"Sin canal\" con 1.6667 %"
  - "El CSV se descarga"
  - "Sin violaciones de axe ni scroll horizontal en móvil"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-COST-009 — De punta a punta: conversiones registradas, análisis por canal y exportación desde la UI

## Intención

US-183: ver spread y fees promedio por canal.

## Escenario

```gherkin
Dado tres conversiones de octubre
Cuando el EDITOR abre el análisis
Entonces ve los dos canales con sus cifras
```

## Notas

- Ejecutar con PF_E2E_PROJECT=pfos-e2e-<nombre>.
