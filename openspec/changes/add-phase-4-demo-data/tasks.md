# Tareas

> Requiere fusionados (no archivados) `add-demo-data`, `add-recurrence-engine`, `add-subscriptions`, `add-credit-cards`, `add-savings-goals`, `add-loans`, `add-loan-amortization-advanced`, `add-debt-summary` y `add-spendable-amount`; todos lo están. El delta solo toca `identity/demo-data`, así que este change puede archivarse sin esperar la cadena de archivado de Phase 4. Sin preguntas bloqueantes: design.md adopta la recomendación de las preguntas 1–6. Sin Docker, `pnpm test:integration` y `pnpm test:e2e` los valida CI (decirlo en el informe).

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar el delta de `identity/demo-data` y las preguntas 1–6 de design.md; `openspec validate add-phase-4-demo-data --strict`
- [ ] 1.2 Recalcular a mano (Decimal, HALF_EVEN) las cifras de TC-IDENTITY-DEMO-015..020 con la ancla 2026-09-30 y pasarlos a `ready` y `requirement_status: confirmed`; `pnpm traceability:check` sin errores ni advertencias
- [ ] 1.3 Actualizar las precondiciones de TC-IDENTITY-DEMO-007 (resumen de referencia v2) y TC-IDENTITY-DEMO-011 (purga con filas de compromisos, deudas y metas) y su `updated`

## 2. DATASET Y SEED (TDD, funciones puras)

- [ ] 2.1 `DEMO_MANIFEST` v2 (`datasetVersion: '2'`, `generatorVersion: '2.0.0'`, `modules` con `commitments`, `debt`, `goals`) y tipos de las operaciones nuevas del plan (design.md decisión 2) como unión cerrada solo de la demo; `PlanOp` y `applyPlanOp` del seed `large` sin cambios
- [ ] 2.2 Test-first: generador de fechas relativas a la ancla (fecha de referencia `A − n` y pasos de un mes con el último día si no existe) con la tabla de design.md decisión 4; PBT: con cualquier ancla de 2026-01-01 a 2027-12-31 ninguna operación queda después de A y se conservan los estados declarados (TC-IDENTITY-DEMO-020)
- [ ] 2.3 Test-first: suscripciones y definiciones recurrentes del plan (design.md decisión 5) y cálculo puro del costo esperado (412.9375 ⇒ 412.94 BOB/mes, 4955.25 BOB/año, trial 105.00) en enteros (TC-IDENTITY-DEMO-015)
- [ ] 2.4 Test-first: tarjetas del plan: ciclos, compras, cuotas, pagos y estados esperados de "Tarjeta Kantuta Demo" (1120.50 / 56.02 / 620.50; 10.00 USD `OVERDUE`; 4770.50 / 1570.50 / 78.52) y montos del pago administrado de "Tarjeta Andina Demo" calculados con sus compras (TC-IDENTITY-DEMO-016)
- [ ] 2.5 Test-first: préstamos del plan: cronogramas francés y alemán, pagos, mora, saldado y pago extraordinario reduciendo plazo (1589.99; 375.00/1214.99; 25288.74; 8000.00; 1017.22/1007.15; 247.49), con Σ principal = principal (INV-017) (TC-IDENTITY-DEMO-018)
- [ ] 2.6 Test-first: metas del plan: aportes, reservas, avance esperado (17990.12, +0.05 %; 1328.47, −58.60 %), alcanzada y episodio de sobre-asignación (TC-IDENTITY-DEMO-017)
- [ ] 2.7 Reemplazar en el plan los pagos simples del préstamo vehicular, los pagos planos de "Tarjeta Andina Demo", los gastos sueltos de suscripciones y los gastos fijos de los últimos 6 meses por las operaciones nuevas; tasas de cierre en `A − 1` (USD/BOB 7.00, USDT/BOB 6.95, BTC/USD 60000.00); instituciones y contrapartes nuevas ficticias (design.md decisión 5); test: ningún nombre fuera de la lista ficticia y todo identificador con `DEMO-`
- [ ] 2.8 `golden-summary.json` v2: saldos, conteos y bloque `modules` (design.md decisiones 5 y 8); test de que `buildDemoPlan('2026-09-30')` lo reproduce bit a bit; verificar que el resumen de referencia del seed `large` no cambia

## 3. APLICACIÓN (cargador)

- [ ] 3.1 `demo-module-executor.ts`: cada operación nueva llama al caso de uso público del contexto vía `financeRuntimes` (suscripciones, definiciones, ocurrencias, tarjetas, cuotas, préstamos, pagos, pago extraordinario, metas, plan, movimientos, preferencias de notificaciones), en la unidad de trabajo del lote, con actor `system:demo`; sin SQL ni repositorios
- [ ] 3.2 Operaciones `tick`: invocar con el `FixedClock` simulado los runners de generación de ocurrencias, suscripciones, tarjetas y metas en las fechas del plan; exponer en el módulo `interface` de su contexto el runner que no lo esté (sin endpoint ni cambio de comportamiento) y registrar aquí cuál se expuso
- [ ] 3.3 Operaciones fechadas en A al inicio del día en la zona del workspace; tasas de cierre en `A − 1`
- [ ] 3.4 Verificación final (design.md decisión 9): saldos y balance de comprobación, resumen estructural por módulo para cualquier ancla y bloque `modules` exacto con la ancla fija; discrepancia ⇒ `FAILED`; comparación del pago administrado de "Tarjeta Andina Demo" con el motor
- [ ] 3.5 Progreso con 9 módulos y `failAt` para `commitments/<YYYY-MM>`, `debt/<YYYY-MM>` y `goals/<YYYY-MM>` (TC-IDENTITY-DEMO-008 sigue en verde)
- [ ] 3.6 `run-seed.ts`: perfil `demo` con `datasetVersion` 2

## 4. INTEGRACIÓN (Testcontainers)

- [ ] 4.1 Cargar la demo con ancla 2026-09-30 y consultar con el reloj en ese día: suscripciones, costo, historial de precios y ocurrencia atrasada (TC-IDENTITY-DEMO-015)
- [ ] 4.2 Tarjetas: estados de cuenta, pagos mínimos, calendario de cargos futuros y pago administrado (TC-IDENTITY-DEMO-016)
- [ ] 4.3 Metas: montos, avance, alcanzada, hecho único de sobre-asignación ya resuelto (TC-IDENTITY-DEMO-017); si el episodio no puede reproducirse con el reloj simulado, omitirlo con nota (Could)
- [ ] 4.4 Préstamos: cronogramas, mora, saldado, versión 2 y simulación sin persistir (TC-IDENTITY-DEMO-018)
- [ ] 4.5 Resumen de deudas y Q5 de la demo (TC-IDENTITY-DEMO-019), esperando el drenaje de los consumidores asíncronos
- [ ] 4.6 Dos anclas (2026-09-30 y 2026-10-05) conservan los estados e instituciones independientes del catálogo de referencia (TC-IDENTITY-DEMO-020)
- [ ] 4.7 Determinismo con v2 (TC-IDENTITY-DEMO-007) y aislamiento del workspace real (TC-IDENTITY-DEMO-014) en verde
- [ ] 4.8 Purga con el dataset v2: cero filas del workspace demo en todas las tablas registradas y filas eliminadas > 0 en compromisos, deudas y metas (TC-IDENTITY-DEMO-011); si falla por el orden de borrado, migración expand que corrige el orden en `platform.workspace_scoped_table` (timestamp posterior a la última de `main`) y TC-IDENTITY-DEMO-005 en verde
- [ ] 4.9 Medir la duración de la carga (`demo.duration_ms`) en CI y anotarla aquí; si supera 2 min, aplicar design.md decisión 11 y pregunta 5

## 5. API

- [ ] 5.1 Sin cambios de contrato: `pnpm contract:breaking`, Spectral y Redocly limpios; el test de API de la demo (TC-IDENTITY-DEMO-001) acepta `datasetVersion` "2" y `progress.totalModules` 9

## 6. UI

- [ ] 6.1 Descripción de "Cargar datos de demostración" con los módulos incluidos (suscripciones, tarjetas, metas y préstamos) en es/en/pt; sin pantallas nuevas

## 7. TESTS AUTOMATIZADOS Y E2E

- [ ] 7.1 E2E (`tests/e2e/specs/demo-data.spec.ts`, con `PF_E2E_PROJECT`): con la demo cargada, el indicador "Datos de demostración" está en `/recurring/suscripciones`, `/debts`, `/debts/tarjetas`, `/goals` y `/disponible`, y se ven "StreamFlix Demo", "Tarjeta Kantuta Demo" con un estado de cuenta vencido, "Préstamo de consumo" en mora y "Viaje" atrasada (TC-IDENTITY-DEMO-015..019 en su parte de UI)
- [ ] 7.2 `pnpm test:integration` dos veces seguidas en verde y `pnpm test:e2e`; marcar TC-IDENTITY-DEMO-015..020 `automated` con sus `automated_tests`

## 8. DOCUMENTACIÓN

- [ ] 8.1 docs/29 §2.2: nota as-built del dataset Demo v2 (módulos, elementos, fechas relativas a la ancla, instituciones y tasas ficticias, decisión de no adoptar el catálogo de referencia) y tabla "Contenido del workspace principal" actualizada
- [ ] 8.2 docs/14 §13: el resumen de referencia v2 de la demo como oráculo del resumen de deudas y de Q5 (cifras de design.md decisión 8)
- [ ] 8.3 docs/38: estado del change 44 y la línea de "Diferidos por decisión" de datos demo; anotar que la tarea 8.3 de `add-loans` se marca `[x]` al archivarlo (D223) y que las tareas Could de `add-recurrence-engine` 8.2, `add-subscriptions` 8.3, `add-credit-cards` 8.3 y `add-savings-goals` 8.3 quedan cubiertas
- [ ] 8.4 `pnpm spec:validate`, `pnpm traceability:check`, `pnpm format:check` y `pnpm config:docs:check` en verde
