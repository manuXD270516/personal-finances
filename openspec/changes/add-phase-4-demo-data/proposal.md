# Propuesta: add-phase-4-demo-data

## Why

El workspace de demostración (`identity/demo-data`, ADR-0026, D36) se quedó en Phase 1: el dataset Demo v1 tiene cuentas, transacciones, conversiones y tasas, pero sus suscripciones son gastos sueltos, la tarjeta no tiene perfil de tarjeta (sin ciclos, estados de cuenta ni cuotas), el préstamo vehicular es una cuenta de pasivo con pagos simples (sin cronograma) y no hay metas. Por eso, al abrir la demo, las pantallas de suscripciones, tarjetas, metas, préstamos, el resumen de deudas y el disponible para gastar (Q5) aparecen vacías o con cifras triviales, justo las capabilities que Phases 3 y 4 agregaron. Cada change de esas fases dejó su parte de "datos demo" como tarea Could no hecha; D223 (docs/41) las agrupa en este change, el último y opcional de Phase 5, que el owner pidió avanzar el 2026-10-15.

Tareas Could diferidas que este change cierra (con su origen):

| Origen | Tarea | Estado actual | Cómo la cubre este change |
|---|---|---|---|
| `add-recurrence-engine` (archivado 2026-10-10) | 8.2 (opcional): dataset demo con 6 definiciones y 6 meses de historia | `[x]` con nota "no implementada" | 6 definiciones recurrentes (sueldo, alquiler, internet, luz, retiro de efectivo, seguro trimestral) con 6 meses de ocurrencias resueltas, una atrasada |
| `add-subscriptions` (archivado 2026-10-10) | 8.3 (Could): suscripciones con un alza de precio (`SUBSCRIPTION_PRICE_HIKE`) | `[x]` "Diferida, no implementada" | 8 suscripciones en BOB, USD y USDT, con alza de precio en el historial y una propuesta de precio pendiente |
| `add-credit-cards` (archivado 2026-10-11) | 8.3 (Could): "Visa Oro" bimoneda con una compra en cuotas | `[x]` "Diferida, no implementada" | "Tarjeta Kantuta Demo" bimoneda BOB/USD (nombre ficticio: la marca de la tarea original es real) con compra en 6 cuotas y un estado de cuenta vencido, más el perfil de tarjeta de "Tarjeta Andina Demo" |
| `add-savings-goals` (archivado 2026-10-11) | 8.3 (Could): metas con aportes reales, reservas y un episodio de sobre-asignación | `[x]` "Diferida, no implementada" | 4 metas: con plan y aportes programados, en riesgo con reservas, alcanzada y una con un episodio de sobre-asignación ya resuelto |
| `add-loans` (fusionado, sin archivar) | 8.3 (Could): préstamo vehicular con 3 cuotas pagadas | `[ ]`; D223 la marca `[x]` "diferida a `add-phase-4-demo-data`" al archivar `add-loans` | 4 préstamos: francés vehicular con 19 cuotas pagadas, alemán con 2 cuotas en mora, uno liquidado y uno en USD con un pago extraordinario |

No hay otras tareas de datos demo pendientes en Phases 3 y 4: `add-basic-csv-import`, `add-commitment-matching`, `add-upcoming-payments`, `add-debt-summary` y `add-spendable-amount` no dejaron ninguna, y la tarea 7.2 de `add-loan-amortization-advanced` ("dos préstamos demo") es un E2E ya hecho con datos del propio test.

## What Changes

- **Dataset Demo v2** (versión mayor: cambia el resumen de referencia). Reemplaza en el plan determinista los pagos simples del préstamo, los pagos de la tarjeta y los gastos sueltos de suscripciones por entidades de los contextos COMMITMENTS, DEBT y GOALS, creadas **solo por sus casos de uso públicos** (nunca SQL): 8 suscripciones (activas, en trial, pausada y cancelada; mensual, anual; BOB, USD y USDT; alza de precio y propuesta pendiente), 6 definiciones recurrentes con 6 meses de historia (una ocurrencia atrasada), 2 tarjetas (una bimoneda con cuotas, un estado de cuenta emitido, uno pagado parcialmente y uno vencido; pago de tarjeta administrado), 4 metas (en curso, en riesgo, alcanzada y con un episodio de sobre-asignación) y 4 préstamos (francés, alemán con mora, liquidado y en USD con pago extraordinario reduciendo el plazo).
- **Fechas relativas a la ancla.** Los elementos nuevos se fechan respecto de la fecha ancla (hoy en la zona del workspace al cargar desde la app; 2026-09-30 en el resumen de referencia) para que sus estados (emitido, vencido, en mora, en riesgo, liquidado) se conserven con cualquier ancla; con la ancla fija, todas las cifras son verificables a mano.
- **Resumen de deudas y disponible para gastar (Q5) con cifras no triviales:** préstamos y tarjetas en BOB y USD, consolidados con una tasa de cierre ficticia, cuotas en mora y ocurrencias atrasadas que descuentan del disponible, reservas y aportes planificados de metas.
- **Instituciones y tasas ficticias, independientes del entorno:** la demo crea sus instituciones como instituciones normales del workspace (nombres inventados "… Demo"); **no** adopta entradas del catálogo de referencia de `add-exchange-house-rate-providers` (en staging o producción ese catálogo sería el real). Tasas solo manuales y marcadas "Demo" (se agregan tasas de cierre en la víspera de la ancla); sin tasas `BANK_BUY`/`BANK_SELL`, `MARKET` ni observaciones de proveedores.
- **Notificaciones de la demo solo in-app:** al cargar, la demo desactiva el canal email de todos los tipos en las preferencias del usuario para ese workspace, por el caso de uso público de preferencias (pregunta 2 de design.md).
- **Verificación ampliada:** el resumen de referencia v2 agrega un bloque por módulo (estados y cifras clave); el cargador verifica saldos e invariantes como hoy y, además, el resumen estructural por módulo.
- **Purga:** el change no agrega tablas; la purga ya cubre las tablas de COMMITMENTS, DEBT y GOALS registradas en `platform.workspace_scoped_table`, pero es la primera vez que tienen filas demo: la prueba de purga se ejecuta con el dataset v2 (RISK-026).
- **UI:** sin pantallas nuevas; el texto de "Cargar datos de demostración" enumera lo que incluye (es/en/pt). E2E que recorre las pantallas con la demo cargada.
- **Fuera de alcance:** presupuestos, plantillas y cierres de mes de demostración (Phase 2; pregunta 4 de design.md); importaciones CSV de ejemplo; datos de Phase 5 (precios cripto, tasas de instituciones, análisis de costo de conversiones más allá de lo que ya generan las conversiones de v1); adopción del catálogo de referencia de instituciones; cambiar el seed `minimal` o el `large`; endpoints nuevos; cambios de comportamiento en COMMITMENTS, DEBT, GOALS, REPORTING o NOTIFICATIONS; conservar el dataset v1.

## Capabilities

### New Capabilities
(ninguna)

### Modified Capabilities
- `identity/demo-data`: MODIFIED "Contenido demo ficticio, realista y determinista" (dataset v2 con compromisos, deudas y metas; fechas relativas a la ancla; instituciones y tasas independientes del catálogo de referencia y de los proveedores) y "Purga completa del workspace demo" (incluye compromisos, tarjetas, préstamos y metas); ADDED 5 requirements Could: suscripciones y recurrentes, tarjetas, metas, préstamos, y resumen de deudas y disponible con la demo.

## Impact

**Specs impactadas:** `identity/demo-data` (2 MODIFIED Must, 5 ADDED Could). Lee sin modificar: `commitments/subscriptions`, `commitments/recurrence-engine`, `debt/credit-cards`, `debt/loans` y `debt/amortization` (de `add-loans`, `add-loan-amortization-advanced` y `add-debt-summary`, fusionados y sin archivar), `goals/savings-goals`, `reporting/dashboard` (Q5), `notifications/alerts` (preferencias), `accounts/institutions`, `fx/market-rates`.

**Componentes/contextos impactados:** `apps/api/src/demo/` (dataset `demo-plan.ts` v2 con operaciones nuevas del plan, `demo-data-loader.ts` y un ejecutor de operaciones de módulos solo de la demo; `golden-summary.json` v2); `apps/api/src/seed/run-seed.ts` (perfil `demo`, versión 2); `apps/web` (texto de la acción de carga). Consume, sin cambiarlos, los casos de uso públicos de COMMITMENTS (suscripciones, definiciones, ocurrencias, generación), DEBT (tarjetas, cuotas, préstamos, pagos, amortización), GOALS (metas, plan, movimientos), NOTIFICATIONS (preferencias) y los runners diarios (generación de ocurrencias, suscripciones, tarjetas, metas) con reloj simulado; si alguno no está expuesto en el módulo `interface` de su contexto, se expone ahí (sin endpoint). `plan-executor.ts` compartido con el seed `large` no cambia su comportamiento.

**APIs impactadas:** ninguna. `DemoDataStatus.datasetVersion` pasa a valer `"2"` y `progress.totalModules` crece (de 6 a 9) sin cambiar el contrato; sin códigos de error nuevos.

**Tablas impactadas:** ninguna nueva. Se escriben, por los casos de uso, filas demo en las tablas existentes de `commitments.*`, `debt.*`, `goals.*` y `notifications.*` (preferencias), todas ya registradas en `platform.workspace_scoped_table`.

**Eventos impactados:** ninguno nuevo. La carga publica los hechos normales de los contextos (suscripciones, ocurrencias, tarjetas, préstamos, metas) con el actor `system:demo`, como ya ocurre con las transacciones.

**Migraciones requeridas:** ninguna prevista. Única excepción justificada: si la prueba de purga con filas v2 revela un orden de borrado incorrecto entre tablas ya registradas, una migración expand que corrige su orden en `platform.workspace_scoped_table` (sin tablas ni columnas nuevas, no destructiva).

**Invariantes afectadas:** INV-004 (cada asiento suma cero por moneda, verificado tras la carga), INV-001/002 (montos Decimal con moneda, HALF_EVEN; el plan usa enteros de unidades mínimas), INV-017 (Σ principal = principal del préstamo), INV-020 (cuotas de tarjeta suman la compra), INV-025 (aislamiento: nada se escribe fuera del workspace demo), INV-007/INV-029 (excepción acotada de purga de ADR-0026, sin cambios).

**Test cases:** AÑADIDOS — TC-IDENTITY-DEMO-015, TC-IDENTITY-DEMO-016, TC-IDENTITY-DEMO-017, TC-IDENTITY-DEMO-018, TC-IDENTITY-DEMO-019, TC-IDENTITY-DEMO-020. MODIFICADOS (al implementar) — TC-IDENTITY-DEMO-007 (resumen de referencia v2) y TC-IDENTITY-DEMO-011 (purga con filas de compromisos, deudas y metas). DEPRECADOS — ninguno.

**Impacto de regresión:** cambian el resumen de referencia del dataset Demo (v1 → v2) y los tests que lo leen (TC-IDENTITY-DEMO-001, -007, -008, -011, -014; E2E `demo-data.spec.ts`); el seed `large` comparte `applyPlanOp` y su resumen de referencia NO DEBE cambiar. La carga de la demo genera más trabajo asíncrono (consumidores de compromisos, metas, notificaciones), que los tests deben esperar. Un job `demo.load` v1 encolado al desplegar termina en `FAILED` (`DEMO_DATASET_UNKNOWN`) y se limpia.

**Riesgos introducidos:** RISK-026 (purga: primera vez con filas demo en tablas de Phases 3 y 4; sin tablas nuevas); duración de la carga por encima del presupuesto de 2 minutos (docs/29, D41); estados que dependen del día de la ancla; notificaciones por email de datos ficticios (mitigado: email desactivado en la demo).
