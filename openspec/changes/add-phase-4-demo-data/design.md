# Diseño

## Contexto

`add-demo-data` (Phase 1, archivado) creó el workspace de demostración dedicado (ADR-0026): carga explícita del OWNER, marca `is_demo` inmutable, job `demo.load` con el `DemoDataLoader`, limpieza inmediata y purga física acotada. Su dataset (`apps/api/src/demo/dataset/demo-plan.ts`, v1, 21 meses 2025-01-01 → 2026-09-30, ancla fija 2026-09-30, PRNG mulberry32 sembrado con 20260930, montos en enteros de unidades mínimas y `golden-summary.json`) solo usa CLASSIFICATION, ACCOUNTS, FX y TRANSACTIONS. Desde entonces Phases 3 y 4 agregaron compromisos (`commitments/recurrence-engine`, `commitments/subscriptions`), tarjetas (`debt/credit-cards`), préstamos y amortización (`debt/loans`, `debt/amortization`, fusionados y sin archivar), metas (`goals/savings-goals`), el resumen de deudas (FR-DEBT-018) y el disponible para gastar (Q5, `reporting/dashboard`). Cada change dejó sus datos demo como tarea Could no hecha (proposal.md, tabla de origen); D223 los reúne aquí.

Reglas que se respetan (docs/29 §1 y §3): datos 100 % ficticios; generación **solo por casos de uso públicos** (application services) de cada contexto, nunca SQL crudo ni repositorios, para que toda invariante (INV-001..INV-020) se cumpla por construcción y se escriban auditoría, recorrido y outbox; determinismo total (semilla fija, reloj simulado, mismas fechas y montos en cada corrida; los IDs de fila no son deterministas, igual que en v1); dinero en enteros de unidades mínimas convertidos a Decimal y HALF_EVEN solo en los casos de uso; RLS y `platform.workspace_scoped_table` (RISK-026).

| Contexto | Elemento | Capa | Cambio |
|---|---|---|---|
| apps/api (demo) | `demo-plan.ts` v2: operaciones nuevas del plan y generadores de compromisos, deudas y metas | composición | Ampliado |
| apps/api (demo) | `demo-module-executor.ts`: ejecuta las operaciones nuevas con los casos de uso públicos | composición | Nuevo |
| apps/api (demo) | `demo-data-loader.ts`: lotes por mes con operaciones de todos los módulos, *ticks* de los runners de tiempo, verificación por módulo | composición | Ampliado |
| apps/api (demo) | `golden-summary.json` v2 (saldos + bloque `modules`) | datos | Reemplazado |
| apps/api (seed) | `run-seed.ts`: perfil `demo` con `datasetVersion` 2 | composición | Ajuste |
| COMMITMENTS, DEBT, GOALS, NOTIFICATIONS | Casos de uso y runners diarios existentes; si un runner no está expuesto en el módulo `interface` del contexto, se expone ahí (sin endpoint ni cambio de comportamiento) | interface | Consumo (exposición mínima) |
| apps/web | Texto de "Cargar datos de demostración" con lo que incluye (es/en/pt) | interface | Ajuste |

`apps/api/src/demo/plan-executor.ts` (`applyPlanOp`) también lo usa el seed `large`: no cambia; las operaciones nuevas viven en el ejecutor de módulos de la demo.

## Objetivos / No objetivos

**Objetivos:**
- Que cada pantalla de Phases 3 y 4 tenga contenido realista en la demo: suscripciones, próximos pagos, ocurrencias, tarjetas, préstamos, simulador, metas, resumen de deudas y Q5.
- Cubrir la variedad de estados de cada elemento (activa, trial, pausada, cancelada; emitido, pagado parcial, vencido; en mora, saldado, con pago extraordinario; en curso, en riesgo, alcanzada, sobre-asignada) en BOB, USD y USDT.
- Cifras verificables a mano con la ancla fija 2026-09-30, y estados estables con cualquier ancla.
- Cerrar las tareas Could de datos demo de Phases 3 y 4.

**No objetivos:**
- Presupuestos, plantillas y cierres de mes demo (Phase 2; pregunta 4).
- Datos de Phase 5 (precios `MARKET`, tasas `BANK_BUY`/`BANK_SELL`, catálogo de referencia de instituciones).
- Cambiar comportamiento de cualquier contexto, endpoints, eventos o tablas.
- Conservar el dataset v1 o migrar workspaces demo v1 ya cargados.
- Cambiar los seeds `minimal` y `large`.

## Decisiones

1. **Dataset Demo v2, versión mayor.** `DEMO_MANIFEST.datasetVersion = '2'`, `generatorVersion = '2.0.0'`, `modules` agrega `commitments`, `debt` y `goals` (9 módulos). Cambian el préstamo vehicular (de pagos simples a préstamo francés de DEBT), los pagos de "Tarjeta Andina Demo" (de transferencias planas a ocurrencias del pago administrado de la tarjeta), los gastos de StreamFlix/MúsicaYa/NubeSegura (de gastos sueltos a cargos de suscripciones) y los gastos fijos de los últimos 6 meses (de gastos sueltos a ocurrencias de definiciones recurrentes). Todo lo demás de v1 (salario, servicios, efectivo, compras con tarjeta, conversiones, reembolsos, split, ediciones, anulación, pendientes, tasas) se conserva con la misma semilla por módulo (`SeededRandom.derive(seed, módulo)`), así que sus montos no cambian. Un job `demo.load` v1 que quede encolado al desplegar termina en `FAILED` con `DEMO_DATASET_UNKNOWN` (comportamiento existente) y se limpia; los workspaces demo v1 ya cargados siguen como están hasta que el usuario los limpie.

2. **Solo casos de uso públicos.** Operaciones nuevas del plan (unión cerrada, solo de la demo): `subscription` (crear), `subscriptionPrice` (cambio de precio con vigencia), `subscriptionStatus` (pausar, cancelar, programar cancelación), `recurring` (crear definición), `occurrence` (materializar, vincular una transacción existente, editar monto antes de aprobar, dejar sin resolver), `card` (registrar perfil sobre cuentas `CREDIT_CARD`, habilitar el pago administrado), `installments` (plan de cuotas sobre un gasto ya posteado), `loan` (registrar y desembolsar), `loanPayment`, `loanPrepayment`, `goal` (crear), `goalPlan` (plan mensual y aporte programado), `goalMovement` (aporte real, reserva, retiro), `notificationPrefs` (canal email apagado) y `tick` (runners de tiempo, decisión 3). Cada una llama al servicio de aplicación público del contexto a través de `financeRuntimes` (los mismos que usa la API), dentro de la unidad de trabajo de la carga (ver el riesgo de los bloqueos con los consumidores), con el actor técnico `system:demo` en auditoría, recorrido y outbox. Ninguna escribe tablas directamente; la regla ESLint de determinismo (`pf/no-nondeterminism`) cubre los archivos nuevos.

3. **Reloj simulado y runners de tiempo.** El cargador ya ejecuta cada operación con un `FixedClock` en la fecha simulada. Lo que en producción hace un job periódico (generar ocurrencias dentro del horizonte, transicionar trials y renovar suscripciones, emitir estados de cuenta y fijar su estado al vencer, evaluar metas) se ejecuta con operaciones `tick` en el plan, en las fechas en que algo cambia (cierres y vencimientos de tarjetas más un día, fechas de ocurrencias, fines de mes y la ancla), llamando al runner público del contexto con el reloj simulado, nunca con el reloj real. Así los estados quedan fijados durante la carga y no dependen del momento en que corra el worker. Los consumidores asíncronos del outbox (notificaciones, sugerencias de coincidencia, periodos de PLANNING) convergen después de `READY`, como en v1; los tests esperan su drenaje.

4. **Fechas relativas a la ancla.** Sea A la fecha ancla. Los flujos heredados de v1 siguen desplazándose en días (`A − 2026-09-30`). Los elementos nuevos se fechan con una **fecha de referencia** `A − n días` y pasos de un mes hacia atrás o adelante con el mismo día del mes (último día si no existe), igual que la regla de los cronogramas, para que el plan y los motores de cada contexto coincidan. Con la ancla fija (A = 2026-09-30):

   | Elemento | Regla | Fechas con A = 2026-09-30 |
   |---|---|---|
   | "Tarjeta Andina Demo": cierre y vencimiento | cierre = día de `A − 5`, vencimiento = día de `A + 15` | cierre 25, vence 15; estado de cuenta del 2026-09-25 `ISSUED` hasta 2026-10-15 |
   | "Tarjeta Kantuta Demo": cierres K1 y K2 | K2 = `A − 12`; K1 = cierre anterior; vencimiento = día de `A + 8` | K1 2026-08-18 (vence 2026-09-08), K2 2026-09-18 (vence 2026-10-08) |
   | Compras y pago de "Tarjeta Kantuta Demo" | `K1 − 24`, `K1 − 13`, `K1 − 8`, `K1 + 7`; pago `K1 + 14` | 2026-07-25, 2026-08-05, 2026-08-10, 2026-08-25; pago 2026-09-01 |
   | "Préstamo vehicular" | cuota 19 = día 1 del mes de A | desembolso 2025-02-01, cuotas desde 2025-03-01 |
   | "Préstamo de consumo" | cuota 6 = `A − 9`; cuotas 5 y 6 sin pagar | desembolso 2026-03-21, cuotas desde 2026-04-21 |
   | "Préstamo familiar" | cuota 3 = día 10 del mes `A − 7 meses` | desembolso 2025-11-10, cuotas 2025-12-10 a 2026-02-10 |
   | "Crédito educativo" | cuota 8 = `A − 20`; pago extraordinario el día de la cuota 3 | desembolso 2026-01-10, cuotas desde 2026-02-10, extraordinario 2026-04-10 |
   | "Internet Fibra Kantuta Demo" | ocurrencia sin resolver = `A − 2` | 2026-09-28 |
   | "Fondo de emergencia" | inicio = `A − 364`; aportes el día de `A − 25`; fecha objetivo = inicio + 607 días | inicio 2025-10-01, aportes día 5, objetivo 2027-05-31 |
   | "Viaje" | inicio = `A − 182`; objetivo = inicio + 274 días; última reserva en A | inicio 2026-04-01, objetivo 2026-12-31 |
   | "Curso Kantuta Demo" | fin de trial = `A + 5` | 2026-10-05 |

   Ninguna operación de la demo tiene fecha posterior a A; lo futuro (ocurrencias, cuotas, cargos de cuotas, renovaciones) lo generan los cronogramas. Las operaciones fechadas en A se registran al inicio del día A en la zona del workspace (no al mediodía) para no quedar en el futuro si la carga corre temprano; las tasas de cierre se fechan en `A − 1`. Con otra ancla los estados se conservan (scenario "Otra fecha ancla conserva los estados"); las cifras exactas solo se garantizan con A = 2026-09-30.

5. **Contenido del dataset v2.** Instituciones nuevas (además de Banco Andino Demo, P2P Exchange Demo y Cold Wallet Demo): **Cooperativa Illimani Demo** y **Billetera Altiplano Demo**. Contrapartes nuevas, todas ficticias: Gimnasio Sajama Demo, Antivirus Escudo Demo, Revista Andina Demo, Curso Kantuta Demo, VPN Cóndor Demo, Seguros Illampu Demo, Hotel Salar Demo, Electro Kantuta Demo, Fondo Educativo Demo y "Tía Carmen (ficticia)". Cuentas nuevas: "Banco Andino Demo — Caja de ahorro BOB" (`SAVINGS`, BOB, `DEMO-BAD-0003`), "Tarjeta Kantuta Demo BOB" y "Tarjeta Kantuta Demo USD" (`CREDIT_CARD`, `DEMO-TKD-0001/0002`), "Billetera Altiplano Demo" (`DIGITAL_WALLET`, líquida por defecto, BOB, `DEMO-BAL-0001`) y las cuentas de préstamo que crea DEBT al registrar cada préstamo (`DEMO-LOAN-0001..0004` en las notas).

   **Suscripciones** (COMMITMENTS):

   | Suscripción | Precio y ciclo | Cuenta | Estado al 2026-09-30 |
   |---|---|---|---|
   | StreamFlix Demo | 9.99 USD mensual, día 3; 11.99 USD desde 2025-10-03 | Ahorro USD | `active` |
   | MúsicaYa Demo | 5.99 USD mensual, día 8 | Ahorro USD | `paused` desde 2026-08-20 |
   | NubeSegura Demo | 2.99 USD mensual, día 15; último cargo 3.49 USD ⇒ propuesta de precio pendiente | Ahorro USD | `active` |
   | Antivirus Escudo Demo | 39.99 USD anual, desde 2025-10-12 | Ahorro USD | `active` |
   | VPN Cóndor Demo | 5.000000 USDT mensual, día 20 | Billetera USDT | `active` |
   | Gimnasio Sajama Demo | 250.00 BOB mensual, día 10 | Tarjeta Andina Demo | `active` |
   | Revista Andina Demo | 120.00 BOB anual, desde 2025-02-01 | Cuenta corriente BOB | `cancelled` desde 2026-06-30 |
   | Curso Kantuta Demo | 15.00 USD mensual tras trial hasta `A + 5` | Ahorro USD | `trial` |

   Costo con las tasas de cierre (USD/BOB 7.00, USDT/BOB 6.95): 83.93 + 20.93 + 23.3275 + 34.75 + 250.00 = 412.9375 ⇒ **412.94 BOB al mes** y **4955.25 BOB al año**; trial aparte 15.00 × 7.00 = **105.00 BOB al mes**. Los cargos pasados se materializan desde sus ocurrencias (modo aprobación) con el monto del precio vigente; el último cargo de NubeSegura se edita a 3.49 USD antes de aprobarlo (o se vincula un gasto de 3.49 USD, según el camino que dispare la detección de cambio de precio en `commitments/subscriptions`).

   **Definiciones recurrentes** (creadas en `A − 6 meses`, día 1; sus ocurrencias de los 6 meses se resuelven y reemplazan los gastos sueltos de v1 de esos meses con los mismos montos y fechas): Sueldo (ingreso, automático, día 31 con ajuste `PREVIOUS`), Alquiler 3700.00 BOB (aprobación, día 5), Internet Fibra Kantuta Demo 199.00 BOB (aprobación, día de `A − 2`; la última queda sin aprobar), Luz Altiplano Demo `ESTIMATED` 180.00 BOB (solo aviso; se vincula el gasto real de v1), Retiro de efectivo 600.00 BOB (transferencia automática, día 2) y Seguro vehicular Seguros Illampu Demo 450.00 BOB trimestral (automático, día de `A − 45`).

   **Tarjetas** (DEBT): "Tarjeta Andina Demo" (cuenta v1) recibe perfil al inicio de la ventana con límite separado 15000.00 BOB, mínimo 5.00 % con piso 50.00 BOB y pago administrado desde la cuenta corriente: cada mes se aprueba la ocurrencia del pago por el total facturado, salvo el mes 9 de la ventana (2025-09), que paga el 60 % (≥ mínimo, queda `PARTIALLY_PAID`); el plan calcula esos montos con sus propias compras y el cargador los compara con los del motor (si difieren, `FAILED`). "Tarjeta Kantuta Demo" (bimoneda BOB/USD, emitida por Cooperativa Illimani Demo, límite compartido 20000.00 BOB, mínimos 5.00 % con pisos 50.00 BOB y 10.00 USD, sin pago administrado), abierta en K1 − 60 días sin saldo inicial:

   | Fecha | Movimiento | Cuenta |
   |---|---|---|
   | 2026-07-25 | Compra "Refrigerador" Electro Kantuta Demo 4800.00 BOB, plan de 6 cuotas sin interés de 800.00 BOB | BOB |
   | 2026-08-05 | Compra Hotel Salar Demo 200.00 USD | USD |
   | 2026-08-10 | Compra Supermercado Kantuta Demo 320.50 BOB | BOB |
   | 2026-08-25 | Compra Farmacia Chacaltaya Demo 150.00 BOB | BOB |
   | 2026-09-01 | Pago 500.00 BOB desde la cuenta corriente | BOB |

   Estado de cuenta BOB del 2026-08-18: saldo al cierre 5120.50, facturado 5120.50 − 5 × 800.00 = 1120.50, mínimo 1120.50 × 5 % = 56.025 ⇒ 56.02 BOB; con el pago de 500.00 queda `PARTIALLY_PAID` con 620.50 BOB pendientes. USD del 2026-08-18: facturado 200.00, mínimo máx(10.00, 10.00) = 10.00 USD, sin pago ⇒ `OVERDUE`. BOB del 2026-09-18: 5120.50 + 150.00 − 500.00 = 4770.50, facturado 4770.50 − 4 × 800.00 = 1570.50, mínimo 78.525 ⇒ 78.52 BOB, `ISSUED`, vence 2026-10-08. Cargos futuros: 800.00 BOB al 2026-11-08, 2026-12-08, 2027-01-08 y 2027-02-08.

   **Préstamos** (DEBT; 30/360, mensual, sin ajuste de fin de semana, pagos desde la cuenta del préstamo indicada):

   | Préstamo | Condiciones | Pagos | Estado al 2026-09-30 |
   |---|---|---|---|
   | Préstamo vehicular (Banco Andino Demo) | francés, 50000.00 BOB, 9.00 %, 36 cuotas de 1589.99 BOB; cuota 1: interés 375.00, principal 1214.99 | cuotas 1–19 al vencimiento desde la cuenta corriente | principal pendiente 25288.74 BOB; próxima cuota 20 del 2026-10-01 (interés 189.67, principal 1400.32); interés 2026 (cuotas 11–19) 2166.91 BOB; última cuota 2028-02-01 |
   | Préstamo de consumo (Cooperativa Illimani Demo) | alemán, 12000.00 BOB, 12.00 %, 12 cuotas: 1120.00, 1110.00, … 1010.00 | cuotas 1–4 | principal pendiente 8000.00 BOB; en mora 1080.00 (2026-08-21) y 1070.00 (2026-09-21); interés 2026 420.00 BOB |
   | Préstamo familiar (Tía Carmen, ficticia) | francés, 1000.00 BOB, 12.00 %, 3 cuotas: 340.02, 340.02, 340.03 | cuotas 1–3 | saldado; interés 2026 6.70 + 3.37 = 10.07 BOB |
   | Crédito educativo (Fondo Educativo Demo) | francés, 12000.00 USD, 12.00 %, 12 cuotas de 1066.19 USD, a la cuenta Ahorro USD | cuotas 1–3, pago extraordinario 3000.00 USD reduciendo plazo, cuotas 4–8 | versión 2: cuotas 4–9, última 1017.22 USD el 2026-10-10 (interés 10.07, principal 1007.15); ahorro de interés 247.49 USD; interés 2026 536.67 USD |

   El simulador del préstamo vehicular queda con 17 cuotas por pagar (1740.99 BOB de interés restante): simular hoy un pago extra de 5000.00 BOB reduciendo plazo da 14 cuotas y 1118.96 BOB de interés (ahorro 622.03 BOB), sin persistir nada.

   **Metas** (GOALS):

   | Meta | Datos | Fondos | Estado al 2026-09-30 |
   |---|---|---|---|
   | Fondo de emergencia (`emergency_fund`, prioridad 1) | 30000.00 BOB, 2025-10-01 → 2027-05-31, vinculada a la Caja de ahorro BOB | plan 1500.00 BOB/mes real, programado como transferencia administrada día 5 desde la cuenta corriente; 12 aportes | 18000.00 BOB, 60.00 %, `on-track` (esperado 30000 × 364 / 607 = 17990.12; +0.05 %); pendiente del periodo 0.00 |
   | Viaje (`travel`, prioridad 2) | 2000.00 USD, 2026-04-01 → 2026-12-31 | plan 150.00 USD/mes en reservas sobre Ahorro USD; reservas de 100.00 USD de abril a agosto y 50.00 USD en A | 550.00 USD, `behind` (esperado 2000 × 182 / 274 = 1328.47; −58.60 %); pendiente del periodo 100.00 USD |
   | Laptop (`purchase`, prioridad 3) | 8000.00 BOB, sin fecha objetivo | reservas sobre la cuenta corriente: 2000.00 BOB por mes de mayo a agosto de 2026 | `achieved` al llegar a 8000.00 BOB |
   | Regalos (`custom`, prioridad 4) | 1000.00 BOB, sin fecha objetivo | Billetera Altiplano Demo abierta en `A − 91` con 600.00 BOB; reserva 500.00 BOB en `A − 90`; gasto 300.00 BOB en `A − 72` (sobre-asignada, faltante 200.00 BOB, un hecho); transferencia de 400.00 BOB desde la cuenta corriente en `A − 56` (se resuelve) | 500.00 BOB reservados, saldo de la billetera 700.00 BOB, sin sobre-asignación |

   **Notificaciones:** antes de cualquier otro módulo, el cargador apaga el canal email de todos los tipos en las preferencias del usuario para el workspace demo (`notifications/alerts`, requirement "Preferencias por tipo y canal"); el in-app queda activo (pregunta 2).

6. **Instituciones: sin adoptar el catálogo de referencia.** Se evaluó adoptar entradas de `apps/api/reference/institutions/demo/BO.json` (change 41) como instituciones adoptadas. Se descarta: (a) el catálogo es del **entorno** (`ACCOUNTS_INSTITUTION_CATALOG_DIR`): en staging o producción, si el owner habilitara la demo, sería el `BO.json` real y la demo adoptaría entidades reales, contra docs/29 §1; (b) la adopción y el estado de soporte pertenecen a un change aún abierto (41) cuyas tareas esperan al owner; (c) la demo no necesita el enlace al catálogo para ninguna pantalla de Phases 3 y 4. Las instituciones de la demo se crean como instituciones normales del workspace con `createInstitution`, con los mismos nombres ficticios que el catálogo ficticio y la seed `minimal`, sin código de catálogo. Si el owner prefiere mostrar la adopción, la pregunta 1 propone cómo hacerlo sin depender del entorno.

7. **Tasas: solo manuales ficticias.** Se conservan las 210 tasas manuales "Demo" de v1 (paralelas semanales USD/BOB y USDT/BOB, oficial mensual y BTC/USD mensual) y se agregan tasas de cierre en `A − 1`: USD/BOB `PARALLEL` 7.00, USDT/BOB `PARALLEL` 6.95 y BTC/USD `PARALLEL` 60000.00, para que la valoración de "hoy" (ventana `REPORTING_RATE_VALIDITY_WINDOW`, 7 días) sea completa y verificable a mano. No se registran tasas `BANK_BUY`/`BANK_SELL` ni `MARKET`, ni observaciones de proveedores, ni se configuran pares de proveedores: llevan la fuente del proveedor y simularlas haría pasar datos inventados por cotizaciones publicadas. Las conversiones de v1 ya generan sus observaciones `USER_CONVERSION` por el consumidor de FX (change 40), como cualquier conversión.

8. **Resumen de deudas y Q5 no triviales.** Con A = 2026-09-30 (periodo de septiembre, sin plan de presupuesto):
   - Deudas en USD: 1007.15 + 200.00 = **1207.15 USD**, consolidadas a 7.00 = **8450.05 BOB**. En BOB: 25288.74 (vehicular) + 8000.00 (consumo) + 4770.50 (Kantuta) + el saldo de "Tarjeta Andina Demo" del resumen de referencia. "Préstamo familiar" no se lista. Fecha libre de deudas **2028-02-01**.
   - Interés pagado en 2026: 2166.91 + 420.00 + 10.07 = **2596.98 BOB** y **536.67 USD**.
   - Q5 comprometido en BOB: 1080.00 + 1070.00 (cuotas en mora, de una cuenta líquida a una no líquida) + 199.00 (ocurrencia atrasada) = **2349.00 BOB**; en USD y USDT 0 (todo lo del periodo está resuelto; las compras con tarjeta y las suscripciones cargadas a ella no cuentan).
   - Reservado para metas: 18000.00 (Caja de ahorro) + 8000.00 (cuenta corriente) + 500.00 (billetera) = **26500.00 BOB** y **550.00 USD**; aportes planificados pendientes **100.00 USD**.
   - Los saldos líquidos y el disponible consolidado quedan en el resumen de referencia (dependen del generador aleatorio sembrado de v1).

9. **Verificación.** Al terminar, el cargador (con el reloj simulado en el final del día A): verifica saldos contra el plan y el balance de comprobación en cero (v1); verifica un **resumen estructural por módulo** que el plan calcula para cualquier ancla (suscripciones por estado, ocurrencias atrasadas, estados de cuenta por estado, préstamos por estado y cuotas en mora, metas por estado y avance); y, solo con A = 2026-09-30, las cifras exactas del bloque `modules` de `golden-summary.json` (cifras de la decisión 5 y 8). Una discrepancia ⇒ `FAILED` (nunca `READY` parcial). El progreso informa `completedModules` por módulo como hoy, con `totalModules = 9`; `failAt` admite los módulos nuevos (`commitments/<YYYY-MM>`, `debt/<YYYY-MM>`, `goals/<YYYY-MM>`) para TC-IDENTITY-DEMO-008.

10. **Purga y RISK-026.** El change no crea tablas: las de COMMITMENTS, DEBT, GOALS y las preferencias de NOTIFICATIONS ya están en `platform.workspace_scoped_table` (el test de catálogo de TC-IDENTITY-DEMO-005 lo exige). Pero hasta hoy la purga nunca encontró filas demo en ellas, así que el orden de borrado entre tablas con FKs (p. ej. préstamo → definición recurrente, plan de cuotas → transacción, movimiento de meta → transferencia) no se ha ejercitado con datos. TC-IDENTITY-DEMO-011 se ejecuta con el dataset v2; si falla por orden, la corrección es una migración expand que actualiza el orden de esas filas del registro (sin tablas ni columnas nuevas), con timestamp posterior a la última de `main`.

11. **Rendimiento.** Presupuesto de la carga desde la UI: < 2 min (docs/29; D41: si se supera, recortar la ventana a 6 meses). v2 agrega ~400 operaciones (cargos de suscripciones, ocurrencias, pagos, *ticks*). Mitigación: *ticks* solo en las fechas de la decisión 4 (no diarios) y runners acotados al workspace demo. Se mide en CI (`demo.duration_ms`) y se registra en tasks; si se supera, primero se reducen los *ticks* y luego se consulta al owner antes de recortar la ventana (pregunta 5).

12. **UI.** Sin pantallas nuevas: la demo se ve en `/recurring/suscripciones`, `/recurring/occurrences`, `/pagos-proximos`, `/debts`, `/debts/tarjetas`, `/debts/simulador`, `/goals`, `/disponible` y el Home. La descripción de "Cargar datos de demostración" en la configuración enumera los módulos incluidos (claves i18n es/en/pt).

## Contratos

- **OpenAPI** (`contracts/openapi/finance-api.v1.yaml`): sin cambios. `DemoDataStatus.datasetVersion` es `string` (pasa a `"2"`) y `progress.totalModules` es un entero; ambos ya admiten los valores nuevos. Si se actualiza el ejemplo de `datasetVersion` a `'2'`, es un cambio de documentación sin efecto en oasdiff.
- **Códigos de error:** ninguno nuevo (`DEMO_DATASET_UNKNOWN` y `DEMO_LOAD_FAILED` ya existen como códigos de fallo de la carga).
- **Eventos:** ninguno nuevo. Los hechos de los contextos se publican con el actor `system:demo`; los consumidores existentes los procesan dentro del workspace demo, con la idempotencia que ya tienen.
- **Contratos entre módulos:** si un runner diario no está en el módulo `interface` de su contexto, se exporta desde ahí para `apps/api`; no se agregan exports a `contracts`.

## Riesgos / Trade-offs

- **Estados que dependen del día de la ancla** (p. ej. si A es día 3, la cuota 6 del préstamo de consumo vence en el mes anterior): mitigado con la decisión 4 (fechas de referencia `A − n` días); las cifras exactas solo se prometen con la ancla fija. TC-IDENTITY-DEMO-020 lo vigila con dos anclas.
- **Divergencia entre el plan y los motores** (estados de cuenta, cronogramas, cuotas): el plan repite los cálculos con enteros y el cargador compara con lo que devuelve cada contexto; una diferencia hace fallar la carga y lo muestra el test, en vez de dejar una demo incoherente.
- **Runners no expuestos** o que leen el reloj real: se exponen en `interface` con el `Clock` inyectado; si un runner no admite reloj inyectado, se corrige en ese contexto como deuda técnica (sin cambiar su comportamiento) o se marca la parte del dataset como no cubierta, con nota en tasks.
- **Episodio de sobre-asignación**: si la detección de GOALS es asíncrona y lee el saldo actual (no el del instante), al drenar el outbox después de la carga no vería el episodio. Mitigación: el *tick* de metas se ejecuta en la fecha del gasto con el reloj simulado; si aun así no se registra el hecho, el episodio se omite (Could) con nota en tasks y la meta "Regalos" queda solo con su reserva.
- **Purga con filas reales de Phases 3 y 4** (RISK-026): decisión 10.
- **Duración de la carga**: decisión 11.
- **Bloqueos con los consumidores asíncronos (implementado):** con un lote por mes, el relay publicaba los hechos de cada mes mientras el cargador seguía y los consumidores (`debt.card-activity`, cargos de suscripciones, metas) tomaban los mismos bloqueos `FOR UPDATE` (tarjeta, definición, meta) en otro orden: deadlock `40P01` que abortaba la carga. Por eso la ejecución completa del plan corre en UNA unidad de trabajo: el outbox solo se publica al confirmar y una falla a mitad de la carga no deja datos parciales. El progreso por módulo se registra al terminar. Consecuencias: (a) el aporte recurrente de "Fondo de emergencia" se resuelve con la ocurrencia y, en la misma unidad de trabajo, se vincula como movimiento de la meta (`goals.movements.link`), así la meta está al día en `READY` y el consumidor asíncrono, que haría lo mismo, lo encuentra registrado (sin sugerencias de aporte duplicadas); (b) lo que sigue siendo asíncrono (cargos de suscripciones y la propuesta de precio de NubeSegura) converge después de `READY`; (c) el job `demo.purge` espera a los consumidores en vuelo del workspace (`settleWorkspaceEvents`, hasta 4 min) antes de borrar, para que no reaparezcan filas después de la purga (TC-IDENTITY-DEMO-011). `failAt` conserva la forma `<módulo>/<YYYY-MM>` y dispara al empezar el mes que tiene operaciones de ese módulo.
- **Ruido de notificaciones**: la carga genera avisos in-app (renovaciones, vencimientos, meta alcanzada, sobre-asignación, cambio de precio); se acepta porque muestran esas funciones, y el email queda apagado.
- **Trade-off v1 → v2 sin compatibilidad:** se descarta mantener v1 (dos generadores y dos resúmenes de referencia) porque la demo es removible y recargable.

## Plan de migración

1. Sin migraciones de esquema (salvo la corrección de orden de purga de la decisión 10, si hiciera falta).
2. Despliegue: el job `demo.load` usa v2 desde el despliegue; un job v1 encolado termina en `FAILED` y se limpia. Los workspaces demo v1 ya cargados siguen visibles con sus datos v1 hasta que su OWNER los limpie y recargue.
3. Seed local/CI: `pnpm db:seed -- --profile=demo` registra la versión 2 en `platform.seed_run`; en una BD con la demo v1 hay que limpiar primero (un workspace demo por usuario).
4. Rollback: revertir el código vuelve a v1; los workspaces demo v2 cargados se limpian con la acción existente (la purga no depende del dataset).

## Preguntas abiertas

Ninguna bloquea la implementación: el diseño adopta la recomendación de cada una y el owner puede revertirla antes de que se implemente.

1. **¿La demo adopta instituciones del catálogo de referencia?** Contexto: change 41 trae un catálogo por país con adopción por entrada; en desarrollo es ficticio, en staging/producción sería real. Opciones: (a) no adoptar; crear instituciones normales con nombres ficticios (adoptada, decisión 6); (b) adoptar del catálogo solo si el catálogo cargado está marcado `fictitious`, y si no, caer a (a); (c) adoptar siempre. Recomendación: (a); (b) es viable más adelante si el owner quiere ver la adopción en la demo. (c) se descarta por docs/29 §1.
2. **Notificaciones de la demo.** Contexto: la demo genera avisos de renovaciones, vencimientos, mora y metas con datos ficticios; por defecto el email está activo. Opciones: (a) apagar el email en las preferencias del workspace demo durante la carga, in-app activo (adoptada); (b) dejar los defaults; (c) apagar también el in-app. Recomendación: (a).
3. **"Pago anticipado simulado" en los préstamos.** Contexto: el owner pidió un pago anticipado simulado; una simulación no se persiste. Opciones: (a) registrar un pago extraordinario real en "Crédito educativo" y dejar el préstamo vehicular listo para simular (adoptada); (b) no registrar ninguno y depender solo del simulador; (c) registrar también uno en el préstamo vehicular. Recomendación: (a): muestra la versión 2 del cronograma y el simulador sigue teniendo un caso no trivial.
4. **Presupuestos y cierres de mes demo (Phase 2).** Contexto: D223 limita el change a suscripciones, tarjetas, metas y préstamos; el disponible usa el mes calendario sin plan. Opciones: (a) fuera de este change; si el owner lo quiere, un change aparte de datos demo de Phase 2 (adoptada); (b) incluir presupuestos mensuales sin cierres; (c) incluir presupuestos y cierres (un cierre bloquea rangos del ledger y complica la carga). Recomendación: (a).
5. **Si la carga supera 2 minutos.** Contexto: D41 prevé recortar la ventana a 6 meses si la carga desde la UI supera 2 min. Opciones: (a) primero reducir *ticks* y operaciones redundantes; si sigue por encima, consultar al owner antes de recortar (adoptada); (b) recortar automáticamente a 6 meses; (c) aceptar hasta 3 min para la demo. Recomendación: (a).
6. **Nombre de la tarjeta bimoneda.** Contexto: la tarea 8.3 de `add-credit-cards` dice "Visa Oro", que es una marca real. Opciones: (a) "Tarjeta Kantuta Demo" (adoptada); (b) "Visa Oro Demo"; (c) otro nombre ficticio que elija el owner. Recomendación: (a), por docs/29 §1 (sin nombres reales).
