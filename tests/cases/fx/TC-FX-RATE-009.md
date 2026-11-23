---
id: TC-FX-RATE-009
title: "La resolución de tasas por lote indexada devuelve exactamente lo mismo que la búsqueda lineal anterior"
spec: fx/market-rates
related_specs: ["fx/market-rate-providers", "reporting/financial-reports"]
requirement: "Resolución de tasas por lote con costo acotado"
scenario: "Misma tasa que la consulta individual"
requirement_status: provisional
fr: ["FR-FX-004", "FR-FX-005", "FR-FX-006"]
nfr: ["NFR-PERF-006"]
invariants: ["INV-020", "INV-032"]
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 7
tags: ["fx", "valuation", "pbt", "equivalence", "perf", "fix-trends-report-perf"]
error_code: null
preconditions:
  - "Oráculo: copia literal de `RateResolver` de `main` 4cdc7689 (antes de este change), conservada solo en el archivo de test"
  - "Generador de candidatas: pares entre BOB, USD, USDT y BTC en ambas orientaciones; tipos PARALLEL, OFFICIAL, MARKET, PARALLEL_BUY, PARALLEL_SELL y de institución; fuentes PROVIDER (primario, respaldo y obsoleta), MANUAL y USER_CONVERSION; reemplazadas, anómalas confirmadas y sin confirmar; varias con el mismo `asOf` (empates) y `asOf` con milisegundos y distinto desfase horario"
  - "Solicitudes generadas: instantes antes, dentro, en el borde exacto y después de la ventana; con y sin preferencia de tipo; con y sin cruzada por pivote; ventana de 1 a 30 días"
input: {}
steps:
  - "Para cada caso generado (fast-check, ≥ 300 corridas, semilla fija y timeout explícito) resolver cada solicitud con el oráculo y con el resolvedor nuevo, por `tryResolve`, `resolve` y `resolveForConversion`"
  - "Comparar el resultado completo: valor exacto de la tasa, derivación, `fxRateId`, componentes, tipo usado y pedido, fuente, `asOf`, `effectiveDate`, edad, `approx`, provider, selección y `stale`; o `null` (o `FX_RATE_NOT_FOUND`) en ambos"
expected_result:
  - "Igualdad profunda en todas las solicitudes, incluida la elección entre candidatas con el mismo `asOf`"
  - "Los tests existentes de `rate-resolver.test.ts` y `fx.properties.test.ts` siguen en verde sin cambios"
created: 2026-11-23
updated: 2026-11-23
---

# TC-FX-RATE-009 — Equivalencia del resolvedor de tasas indexado

## Intención

`fix-trends-report-perf` indexa las candidatas del resolvedor por par y por instante para no recorrerlas todas en cada solicitud. La regla de la tasa vigente (FR-FX-004), la inversa vinculada (INV-032), la cruzada solo para valoración y la selección con fallback entre providers no cambian: este caso lo prueba contra la implementación anterior.

## Escenario

```gherkin
Dado un conjunto generado de tasas de varios pares, tipos y fuentes, con reemplazos, anomalías y empates de vigencia
Cuando se resuelve un lote de solicitudes con el resolvedor anterior y con el indexado
Entonces cada solicitud obtiene la misma tasa, con la misma derivación, fuente, vigencia y selección, o ninguna en ambos
```

## Notas

- Datos ficticios; tasas como strings decimales.
- Change `fix-trends-report-perf`.
