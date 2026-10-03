---
id: TC-FX-PROVIDER-017
title: "El provider de respaldo tiene su propio umbral de obsolescencia (FX_STALE_AFTER_FALLBACK, 180 min)"
spec: fx/market-rate-providers
related_specs: ["fx/market-rates"]
requirement: "Selección de la tasa de valoración con fallback entre providers"
scenario: "Respaldo con retraso de publicación"
requirement_status: confirmed
fr: ["FR-FX-010","FR-FX-006"]
nfr: []
invariants: ["INV-020"]
priority: critical
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/fx/src/domain/valuation-rate-selector.test.ts
  - packages/contexts/fx/src/application/provider-settings.test.ts
  - packages/contexts/fx/src/application/market-rate-providers.test.ts
status: automated
regression_suite: true
phase: 1
tags: ["fx","provider","fallback","staleness","config"]
error_code: null
preconditions:
  - "Preferencia USD/BOB = PARALLEL; FX_STALE_AFTER_PARALLEL = 60m; FX_STALE_AFTER_FALLBACK = 180m (default); ventana 7 días"
  - "paralelo.bo (principal) 12.02 con asOf 2026-10-02T08:53:07.532Z y fallando desde las 09:00Z; bo.dolarapi.com (respaldo) 12.055 con asOf 2026-10-02T09:01:00Z (~2 h de retraso de fechaActualizacion)"
input: {"amount": "100.00 USD", "cases": [{"t": "2026-10-02T11:00:00Z", "expected": "1205.50 BOB", "selection": "FALLBACK", "ageSeconds": 7140}, {"t": "2026-10-02T12:30:00Z", "selection": "LAST_KNOWN_STALE", "ageSeconds": 12540}]}
steps:
  - "Valorar 100.00 USD en BOB en cada instante"
  - "Consultar GetProviderStatus a las 11:00Z"
  - "Repetir con roles invertidos y con FX_STALE_AFTER_FALLBACK = 60m"
expected_result:
  - "11:00Z: 1205.50 BOB con bo.dolarapi.com, selection FALLBACK, stale false, ageSeconds 7140 (119 min ≤ 180)"
  - "12:30Z: la misma tasa se informa LAST_KNOWN_STALE, stale true (209 min > 180)"
  - "El principal sigue usando 60 min (a las 10:00Z, 67 min ⇒ obsoleto); OFFICIAL sigue usando 48 h"
  - "Con roles invertidos (dolarapi principal, paralelo respaldo) el umbral propio aplica a paralelo.bo, no a dolarapi"
  - "FX_STALE_AFTER_FALLBACK es configurable (60m vuelve al comportamiento anterior) y un valor inválido informa FX_PROVIDER_CONFIG_INVALID"
  - "GetProviderStatus informa el feed PARALLEL del respaldo con ageSeconds 7140 y stale false"
created: 2026-10-03
updated: 2026-10-03
---

# TC-FX-PROVIDER-017 — El provider de respaldo tiene su propio umbral de obsolescencia (FX_STALE_AFTER_FALLBACK, 180 min)

## Intención

Decisión del owner (2026-10-03): la `fechaActualizacion` de bo.dolarapi.com va unas 2 h por detrás; con el umbral de 60 min el respaldo casi nunca serviría. Un umbral propio (180 min por defecto) lo mantiene útil sin relajar al principal.

## Escenario

```gherkin
Dado paralelo.bo falla desde las 09:00Z
  Y la última tasa de bo.dolarapi.com es 12.055 con vigencia 09:01Z
Cuando valoro 100.00 USD a las 11:00Z
Entonces obtengo 1205.50 BOB con nivel respaldo, no obsoleta, 119 minutos de antigüedad
```

## Notas

- El umbral propio aplica al provider que cumple el rol de RESPALDO de `PARALLEL` (y a su compra/venta), según la configuración; nunca al principal ni a `OFFICIAL`.
- Variable documentada en el contrato único de configuración (`docs/config-reference.md`) y en `.env.example`.
- Fechas fijas con `FixedClock`; instantes en UTC (America/La_Paz = UTC−4). Sin red en CI.
