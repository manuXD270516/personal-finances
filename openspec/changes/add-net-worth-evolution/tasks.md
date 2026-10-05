# Tareas

> Requiere aplicados: `add-basic-dashboard`, `add-ledger-core`, `add-market-rate-providers`, `add-accounts-management`. Recomendado después de `planning/month-closing` (pf-p2a) para usar los snapshots de cierre.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner los requirements añadidos a `reporting/net-worth` y las preguntas abiertas 1–3 de design.md; verificar con `openspec validate add-net-worth-evolution --strict`
- [ ] 1.2 Revisar TC-REPORTING-NETWORTH-006..012 (cifras: 2000.00 + 100.000000 × 10.00 − 300.00 = 2700.00; 2500.00 + 1050.00 = 3550.00; 2400.00 + 120.000000 × 11.00 − 150.00 = 3570.00); pasar a `ready` al aprobar

## 2. DOMAIN (TDD)

- [ ] 2.1 `NetWorthSeriesBuilder` puro, test-first: puntos, completitud, variación y comparabilidad, parcialidad del mes en curso, fuente `SNAPSHOT`/`COMPUTED` (TC-REPORTING-NETWORTH-006, -008, -009, -011)
- [ ] 2.2 PBT: el punto del mes en curso a hoy coincide con el patrimonio actual de Phase 1 para el mismo conjunto de saldos y tasas (INV-031)

## 3. APPLICATION

- [ ] 3.1 `GetNetWorthHistory` con saldos as-of en lote, tasas resueltas por fecha con `windowDays` del setting (D53) y snapshots de cierre opcionales (TC-REPORTING-NETWORTH-007, -009, -010)
- [ ] 3.2 Validación de rango y moneda de reporte (TC-REPORTING-NETWORTH-012)

## 4. INFRASTRUCTURE

- [ ] 4.1 `LedgerQueryPort.getAccountBalancesAsOf(accountIds, dates[])` con `balance_snapshot`; benchmark con dataset `large` (p95 ≤ 800 ms, 24 meses)

## 5. API

- [ ] 5.1 `getNetWorthHistory` en el contrato (`x-required-role: VIEWER`, ETag/304); tests de API por TC

## 6. UI

- [ ] 6.1 Gráfico "Evolución del patrimonio" (tarjeta en el Home y vista completa) con puntos incompletos, cerrados y parcial, tooltip con tasas y atribución; i18n es/en/pt

## 7. AUTOMATED TESTS y E2E

- [ ] 7.1 Automatizar TC-REPORTING-NETWORTH-006..012 con el TC-ID en el nombre; actualizar front matter
- [ ] 7.2 E2E: la serie de tres meses del dataset de prueba se muestra con sus valores

## 8. DOCUMENTATION

- [ ] 8.1 Actualizar docs/14 (§8 reporte 8 parcial en Phase 2, §11 endpoint), docs/10 §13, docs/01 FR-REPORTING-006, el `Purpose` de `reporting/net-worth` al archivar y la matriz de trazabilidad; ejecutar `pnpm spec:validate` y `pnpm traceability:check`
