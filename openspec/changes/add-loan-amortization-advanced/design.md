# Diseño

## Contexto

`add-loans` crea el contexto DEBT (`@pf/debt`, schema `debt`) con el AR `Loan`, el `AmortizationCalculator` francés, el cronograma **versionado** (`debt.loan_schedule_version` + `debt.loan_installment`, append-only, con el estado de pago derivado de `debt.loan_payment_allocation`), el `PaymentAllocator`, la tabla del banco como referencia (`debt.loan_reference_schedule`) y el compromiso de cuotas con **calendario explícito** en COMMITMENTS (`RecurringDefinitionPort`, `managedBy = DEBT`, N3 de su design). Ese change ya dejó preparado lo que este necesita: `method` admite `GERMAN|FIXED_PRINCIPAL|CUSTOM` (hoy rechazados con `LOAN_METHOD_NOT_AVAILABLE`), las versiones del cronograma, el `ScheduleComparator`/parser de la tabla del banco y la operación `replaceSchedule` del puerto de compromisos. Este change agrega los sistemas restantes, el cronograma custom, los recálculos (prepago y tasa variable) y el payoff simulator (FR-DEBT-004, 005, 008, 009, 010; todos Should). Motivación: proposal.md — Why.

Reglas que se respetan: las de `add-loans` (Decimal precisión 40 con un solo redondeo HALF_EVEN por componente, INV-016/INV-017, transacciones administradas por el préstamo, auditoría y outbox en la misma UoW, RLS, expand-only) y, en especial, **una versión de cronograma nunca se reescribe**: los recálculos crean versiones nuevas (docs/08 §5.9: "las cuotas de un cronograma reemplazado … nunca se borran").

| Contexto | Elemento | Capa | Cambio |
|---|---|---|---|
| DEBT | `AmortizationCalculator` (estrategias `GERMAN`, `FIXED_PRINCIPAL`; `CUSTOM` = cuotas dadas), `CustomScheduleValidator`, `ScheduleRecalculator`, `PayoffSimulator`; entidad `RateChange` | domain | extensión / nuevo |
| DEBT | `DefineCustomSchedule`, `AdoptReferenceSchedule`, `RecordPrepayment`, `ChangeLoanRate`, `VoidLoanPayment` (prepagos); queries `PreviewRecalculation`, `ListScheduleVersions`, `ListRateChanges`, `SimulatePayoff` | application | nuevo / extensión |
| DEBT | repos, controller `loans` (operaciones nuevas), `debt.loan_rate_change` | infrastructure / interface | nuevo |
| COMMITMENTS | `RecurringDefinitionPort.replaceSchedule` (si `add-loans` no la implementó) | application | extensión |
| `apps/web` | Deudas → Préstamo (prepago, tasa, custom, versiones) y Deudas → Simulador | interface | nuevo |

## Objetivos / No objetivos

**Objetivos:**
- Modelar los préstamos reales del owner que no son franceses de tasa fija: alemán, capital fijo con balloon, tablas del banco irreproducibles (custom).
- Prepagos y cambios de tasa con cronograma futuro recalculado **sin tocar** lo pagado y con el historial completo.
- Responder "¿cuánto ahorro si adelanto X?" y "¿a qué deuda le pongo el extra?" sin efectos.

**No objetivos:**
- Tarjetas de crédito en el simulador (pregunta 5); refinanciación; reestructuración del plazo sin prepago; prorrateo de interés por días dentro del periodo salvo que se apruebe la pregunta 1; simulaciones guardadas; estrategias de orden manual; conversión de moneda en el simulador.

## Decisiones

1. **Estrategias del calculador.** El `AmortizationCalculator` de `add-loans` se parametriza por sistema:
   - **GERMAN:** `principalPorCuota = HALF_EVEN(P / n)`; cuota k = principal + interés (sobre saldo por convención) + cargos; la última absorbe el residuo del principal. Con P = 10000.00 y n = 3 ⇒ 3333.33, 3333.33, 3333.34.
   - **FIXED_PRINCIPAL:** el usuario indica `fixedPrincipalAmount` (escala de la moneda); cuotas 1..n−1 con ese principal; la cuota n (balloon) = saldo restante; validación `fixedPrincipalAmount × (n − 1) < P` (si no, `VALIDATION_FAILED`: el balloon sería ≤ 0).
   - **CUSTOM:** sin cálculo; las cuotas vienen del usuario o de la referencia del banco (decisión 2).
   - PBT compartido con `add-loans` (Σ principal = P, componentes ≥ 0, total = Σ componentes) + específicos: alemán con cuota no creciente (a tasa y convención 30/360 regulares) y capital fijo con principal = `fixedPrincipalAmount` en 1..n−1.

2. **Cronograma custom.** `DefineCustomSchedule(rows[])` y `AdoptReferenceSchedule(referenceId)` pasan por `CustomScheduleValidator`: Σ principal = principal del préstamo (en `DRAFT`) o principal pendiente (en `ACTIVE`, desde la primera cuota no pagada), vencimientos estrictamente crecientes y posteriores al desembolso (o a la última cuota pagada), componentes ≥ 0, escala, total = Σ componentes; error `CUSTOM_SCHEDULE_INVALID` con `details.rows[]` y `details.principalSum`. En `DRAFT` la vista previa usa las cuotas custom y `DisburseLoan` fija la versión 1 con ellas; en `ACTIVE` crea una versión nueva (`CUSTOM_DEFINED` o `CUSTOM_ADOPTED`) desde la primera cuota no pagada, conservando la numeración. Adoptar la referencia exige que su numeración cubra las cuotas no pagadas. La **prevalencia** se garantiza porque el `PaymentAllocator`, el detalle y el compromiso leen siempre la versión vigente, sea calculada o custom; `RecordPrepayment` y `ChangeLoanRate` sobre `CUSTOM` ⇒ `LOAN_SCHEDULE_IS_CUSTOM` (pregunta 3).

3. **`ScheduleRecalculator` (puro, TDD).** Entrada: versión vigente, cuotas pagadas (derivadas de imputaciones), evento (prepago con opción, cambio de tasa, restitución). Salida: cuotas de la versión nueva desde la cuota `k0` = primera no pagada.
   - **Precondición común:** ninguna cuota parcialmente pagada y todas las cuotas con vencimiento ≤ fecha del evento pagadas (`LOAN_INSTALLMENTS_PENDING`). Así el recálculo empieza siempre en una frontera de periodo y no hay que repartir imputaciones.
   - **Prepago reducir plazo (`REDUCE_TERM`):** saldo' = saldo − prepago; misma cuota `A` (francés) o mismo principal por cuota (alemán/capital fijo) hasta saldar; última absorbe; las fechas siguen la regla del préstamo. **Reducir cuota (`REDUCE_INSTALLMENT`):** mismo número de cuotas restantes y mismas fechas; francés: `A' = HALF_EVEN(saldo'·i / (1 − (1+i)^−m))`; alemán: `HALF_EVEN(saldo'/m)`; capital fijo: el principal por cuota se reduce proporcionalmente (`HALF_EVEN(fixed × saldo'/saldo)`) y el balloon absorbe.
   - **Interés del periodo en que cae el prepago:** este diseño aplica el prepago a la frontera del periodo (el interés de la cuota siguiente se calcula sobre el saldo reducido completo). Si el prepago se registra entre dos vencimientos, el interés de la cuota siguiente igualmente se calcula sobre el saldo nuevo: es una simplificación (favorable al deudor por los días previos al prepago). Pregunta 1 [B].
   - **Cambio de tasa:** aplica a las cuotas cuyo `periodStart ≥ effectiveFrom`; `effectiveFrom` debe ser ≥ `periodStart` de `k0` (`LOAN_CHANGE_DATE_INVALID`) y la tasa se recalcula manteniendo número y fechas (francés: nueva `A` sobre el saldo y las cuotas restantes; alemán y capital fijo: mismo principal, interés nuevo). Una vigencia dentro de un periodo ya iniciado no se prorratea (pregunta 2). Solo `rateType = VARIABLE` (`LOAN_RATE_FIXED`).
   - **Restitución (`PREPAYMENT_VOIDED`):** al anular el prepago más reciente (regla "solo el último" de `add-loans`), se recalcula desde `k0` con el saldo restituido y los parámetros de la versión anterior al prepago; el resultado se guarda como versión nueva (nunca se "reactiva" una versión vieja). Con los datos del ejemplo coincide cuota a cuota con la versión 1.
   - PBT: para todo préstamo, secuencia válida de pagos y evento, Σ principal de la versión nueva = principal pendiente en `k0`, cuotas pagadas idénticas antes y después, y reducir plazo nunca da más interés restante que reducir cuota.

4. **Versiones.** `debt.loan_schedule_version` gana los motivos `PREPAYMENT`, `PREPAYMENT_VOIDED`, `RATE_CHANGE`, `CUSTOM_DEFINED`, `CUSTOM_ADOPTED` y guarda `effective_from`, `from_installment_no` y `parameters` (opción, monto, tasa, referencia). `loan.current_schedule_version` apunta a la vigente; el cronograma "efectivo" = cuotas de versiones anteriores con `n < from_installment_no` de la versión siguiente + cuotas de la vigente. `GET …/installments?version=` y `GET …/schedule-versions` exponen el historial. `LoanScheduleGenerated.v1` se publica por versión con su `reason`.

5. **Pago extraordinario (`RecordPrepayment`).** En una UoW con `FOR UPDATE` del préstamo: precondiciones de la decisión 3; `prepayment ≤ principal pendiente` (`LOAN_OVERPAYMENT`); `LoanTransactionsPort.recordPayment` con principal = prepago, comisión por prepago como `fees` (split `LOAN_FEES`) y los demás componentes en cero (la pata de la cuenta de pago = prepago + comisión); `debt.loan_payment.kind = PREPAYMENT` con `prepayment_option` y sin imputaciones a cuotas; versión nueva (decisión 3); `replaceSchedule` del compromiso (decisión 6); si el pendiente llega a 0 ⇒ `PAY_OFF` (`end` del compromiso, `LoanPaidOff.v1`), sin versión nueva. `PreviewRecalculation` corre ambas opciones sin persistir y devuelve cuota, fin, interés restante y ahorro frente a la vigente.

6. **Compromisos.** `RecurringDefinitionPort.replaceSchedule(definitionId, effectiveFrom, items[])` crea una versión de la definición con el calendario nuevo: las ocurrencias **no resueltas** con fecha nominal ≥ `effectiveFrom` se cancelan con motivo `SUPERSEDED` y se generan las nuevas (claves por fecha; si la fecha coincide se actualiza el monto esperado de la ocurrencia no resuelta en vez de cancelar y recrear, para conservar su identidad); las resueltas no se tocan. Reducir plazo deja sin ocurrencias las fechas posteriores a la nueva última cuota.

7. **`PayoffSimulator` (puro, sin persistencia).** Entrada: préstamos (de `LoanPortfolioQuery` + cronograma vigente) y escenario: `{loanId, extras: [{type: ONE_TIME, installmentNo, amount} | {type: MONTHLY, fromInstallmentNo, amount}]}` o `{strategy: AVALANCHE|SNOWBALL|NONE, monthlyExtra: Money}`. Reglas (las mismas del scenario de la spec):
   - Cada mes, en la fecha de cuota, se paga la cuota programada vigente (interés sobre el saldo por la convención del préstamo, cuota del sistema); después se aplica el extra al principal (reducir plazo, sin comisión).
   - **Avalanche:** el extra va al préstamo de mayor tasa (desempate: menor saldo, luego menor id); **snowball:** al de menor saldo (desempate: mayor tasa, luego menor id). El sobrante cuando un préstamo se salda pasa al siguiente en el mismo mes. Las cuotas de los préstamos saldados se suman al extra desde el mes siguiente (rollover).
   - Solo participan préstamos `ACTIVE` no custom en la moneda del extra; el resto se informa como "fuera de la estrategia" con su cronograma vigente (pregunta 4). Los préstamos custom se proyectan con sus cuotas pero no reciben extra (no hay regla de recálculo).
   - Horizonte máximo 600 meses; los meses se alinean por la fecha de cuota de cada préstamo (para préstamos con días de vencimiento distintos, el "mes" es el mes calendario de la fecha de cuota).
   - Salida por estrategia: interés total, fin de cada préstamo, fecha libre de deudas, ahorro frente a `NONE`, y la serie mensual (saldo total) para el gráfico.
   - El simulador reutiliza el calculador (mismo redondeo) y se valida con los números de la spec (cálculo de referencia independiente: 3425.46 / 1815.57 / 2000.08 BOB).

8. **Autorización, idempotencia, auditoría, recorrido.** Simular y previsualizar: VIEWER+ sin auditoría (no hay cambio). Prepago, cambio de tasa, custom: EDITOR/OWNER, `Idempotency-Key` (prepago) e `If-Match` (tasa, custom), auditoría `debt.loan.*` en la misma UoW. Cada versión nueva y cada cambio de tasa son anotaciones del recorrido del préstamo (D37), no transiciones de estado; el prepago que salda es la transición `PAY_OFF`.

9. **Zona horaria y periodos.** Fechas de prepago y vigencias son fechas de negocio; "hoy" en la zona del workspace; un prepago en periodo cerrado falla con `PERIOD_CLOSED` (Ledger) sin crear versión.

### Modelo de datos (expand-only)

| Tabla | Cambio |
|---|---|
| `debt.loan` | `fixed_principal_amount numeric(38,18) NULL` (CHECK: no nulo si y solo si `method = 'FIXED_PRINCIPAL'`) |
| `debt.loan_schedule_version` | CHECK `reason IN ('INITIAL','PREPAYMENT','PREPAYMENT_VOIDED','RATE_CHANGE','CUSTOM_DEFINED','CUSTOM_ADOPTED')`; columnas `from_installment_no`, `source_payment_id NULL`, `source_rate_change_id NULL`, `source_reference_id NULL` |
| `debt.loan_payment` | `kind text NOT NULL DEFAULT 'REGULAR' CHECK (kind IN ('REGULAR','PREPAYMENT'))`, `prepayment_option NULL CHECK IN ('REDUCE_TERM','REDUCE_INSTALLMENT')`, `prepayment_fee NULL` |
| `debt.loan_rate_change` (nueva) | `id, workspace_id, loan_id, annual_rate, effective_from, schedule_version, created_by, created_at`; `UNIQUE (loan_id, effective_from)`; append-only (`forbid_mutation`); RLS WS-RO |

## Contratos

| Operación | Método y ruta | Rol | Notas |
|---|---|---|---|
| Cronograma custom | `PUT W/loans/{id}/custom-schedule` | EDITOR+ | `If-Match`; filas; `DRAFT` o `ACTIVE` |
| Adoptar referencia | `POST W/loans/{id}/custom-schedule/adopt` | EDITOR+ | `{referenceId}` |
| Prepago | `POST W/loans/{id}/prepayments` | EDITOR+ | `Idempotency-Key`; `{amount, businessDate, accountId?, option, fee?, paymentMethod?}` |
| Vista previa del prepago | `POST W/loans/{id}/prepayments/preview` | VIEWER+ | ambas opciones |
| Cambio de tasa | `POST W/loans/{id}/rate-changes`, `GET …/rate-changes`, `POST …/rate-changes/preview` | EDITOR+ / VIEWER+ | `If-Match` |
| Versiones | `GET W/loans/{id}/schedule-versions` | VIEWER+ | motivo, vigencia, desde la cuota, parámetros |
| Simulación | `POST W/loans/payoff-simulations` | VIEWER+ | sin efectos; `{scenario}` (decisión 7) |

La anulación de un prepago usa `POST W/loans/{id}/payments/{paymentId}/void` de `add-loans`. `LoanMethod`: `GERMAN`, `FIXED_PRINCIPAL`, `CUSTOM` dejan de devolver `LOAN_METHOD_NOT_AVAILABLE`.

**Códigos nuevos:** `CUSTOM_SCHEDULE_INVALID` (422, `details.rows[]`, `details.principalSum`), `LOAN_SCHEDULE_IS_CUSTOM` (409), `LOAN_INSTALLMENTS_PENDING` (409, `details.installmentNos[]`), `LOAN_RATE_FIXED` (409), `LOAN_CHANGE_DATE_INVALID` (422).

**Eventos:** `debt.LoanScheduleGenerated.v1` con `reason` ampliado y `fromInstallmentNo` (opcional, aditivo); `debt.LoanPaymentRecorded.v1` con `kind` opcional (`REGULAR` por omisión) y `prepaymentOption`; `debt.LoanRateChanged.v1` (**nuevo**): `loanId, rateChangeId, previousRate, newRate, effectiveFrom, scheduleVersion` — clave `(loanId, rateChangeId)`.

## Dependencias con otros changes de Phase 4

- **`add-loans`** (obligatorio, antes): contexto, tablas, calculador, `PaymentAllocator`, referencias, `replaceSchedule` (N3) y la regla "solo el último pago se anula".
- **`add-credit-cards`** (otro agente): el simulador no incluye tarjetas en este change (pregunta 5); si se aprueba incluirlas, las tarjetas deben exponer en `@pf/debt` saldo, tasa y pago mínimo (`CardPortfolioQuery`).
- **Resumen de deudas (TC-DEBT-SUMMARY)**: la fecha estimada libre de deudas (FR-DEBT-018, Could) puede reutilizar `PayoffSimulator` con `NONE`; coordinar para no duplicar la proyección.

## Riesgos / Trade-offs

- [Sobre-modelar (RISK-005)] → simulador puro sin persistencia; custom sin recálculo; sin prorrateos salvo decisión del owner; una sola precondición de frontera de periodo para todos los recálculos.
- [El banco prorratea el interés del prepago por días] → diferencia de centavos en la cuota siguiente; la comparación con la tabla del banco (de `add-loans`) la muestra; pregunta 1.
- [Divergencia entre compromiso y cronograma tras recalcular] → `replaceSchedule` en la misma UoW; test de integración que compara ocurrencias no resueltas con las cuotas no pagadas de la versión vigente.
- [Redondeo acumulado en recálculos (RISK-001)] → cada versión se calcula desde el saldo exacto (suma de principal pagado), nunca desde cuotas redondeadas de versiones previas; PBT.
- [Simulación lenta con 600 meses × N préstamos] → cálculo en memoria O(meses × préstamos); límite de 20 préstamos por simulación; p95 < 300 ms con 10 préstamos (test de rendimiento ligero).

## Plan de migración

Expand-only: columnas nullable con default, CHECKs ampliados (`NOT VALID` + `VALIDATE`), tabla `debt.loan_rate_change` con RLS forzada, grants `SELECT, INSERT` + `platform.forbid_mutation()`, `platform.workspace_scoped_table`, sección en `@pf/debt/contracts/portability.ts`. Sin datos que migrar (los préstamos existentes son `FRENCH` con `kind = REGULAR`).

**Dependencias con otros changes:** requiere aplicado `add-loans` (y por transitividad sus dependencias).

## Cambios a docs compartidos

- **docs/01 §10**: FR-DEBT-008 — "reducir plazo o reducir cuota; precondición: cuotas vencidas pagadas"; FR-DEBT-009 — "solo préstamos de tasa variable; vigencia desde el inicio de un periodo no pagado"; FR-DEBT-010 — reglas del simulador (extra después de la cuota, rollover, misma moneda).
- **docs/04 §3.9**: `ScheduleRecalculator` con las opciones; entidad `RateChange`; `PayoffSimulator`; comandos `DefineCustomSchedule`, `AdoptReferenceSchedule`, `RecordPrepayment`, `ChangeLoanRate`; `BULLET` reemplazado por `FIXED_PRINCIPAL`.
- **docs/08 §5.9**: columnas y tabla de § Modelo de datos; `loan_schedule_change` de docs/08 queda absorbida por `loan_schedule_version` (motivo + parámetros).
- **docs/10 §9.1 y §13**: códigos nuevos y operaciones (reemplaza `POST …/{id}/schedule-changes` por `prepayments`, `rate-changes` y `custom-schedule`).
- **docs/11**: `LoanRateChanged.v1` nuevo; `reason` y `kind` ampliados.
- **docs/28**: Deudas → Simulador (escenarios, tabla comparativa y gráfico de saldo total) y acciones de prepago y cambio de tasa en el préstamo.
- **docs/03 §7**: `add-loan-amortization-advanced` después de `add-loans`; último change de deudas de la fase (Should: si la fase se aprieta, pasa entero a la siguiente).

## Preguntas abiertas

1. **[B] Interés del periodo en que cae un prepago.** Opciones: (a) **aplicar el prepago a la frontera del periodo: el interés de la cuota siguiente se calcula sobre el saldo reducido completo** (simple; leve beneficio al deudor por los días previos); (b) prorratear por días según la convención (saldo anterior hasta la fecha del prepago y saldo nuevo después), más fiel a la mayoría de bancos; (c) exigir que el prepago se registre en la fecha de una cuota. **Recomendación: (b) si la tabla del banco del owner muestra prorrateo (pregunta 2 de `add-loans`); si no, (a).** Bloquea el `ScheduleRecalculator` de prepagos.
2. **Vigencia de un cambio de tasa dentro de un periodo ya iniciado.** (a) **la tasa nueva aplica desde el primer periodo que empieza en o después de la vigencia (sin prorrateo)**; (b) prorrateo por días. **Recomendación: (a)**, alineada con la pregunta 1.
3. **Recálculo de préstamos custom.** (a) **no se recalculan: prepago y cambio de tasa ⇒ `LOAN_SCHEDULE_IS_CUSTOM`; el usuario carga la tabla nueva del banco**; (b) recalcular las cuotas restantes con francés sobre el saldo. **Recomendación: (a)** (si el banco entrega la tabla, es la fuente de verdad).
4. **Simulador entre monedas.** (a) **solo participan los préstamos en la moneda del extra; los demás se informan fuera de la estrategia**; (b) convertir saldos y extra con la tasa de valoración de hoy. **Recomendación: (a)** (comparar tasas entre monedas mezcla riesgo cambiario).
5. **Tarjetas de crédito en avalanche/snowball.** (a) **no en este change; solo préstamos**; (b) incluirlas con su saldo, tasa y pago mínimo cuando `add-credit-cards` exponga un `CardPortfolioQuery`. **Recomendación: (a)** ahora y (b) como Could en Phase 7 junto al resumen de deudas.
6. **Comisión por prepago.** Monto ingresado por el usuario como gasto "Comisiones de préstamo" (no porcentaje configurado). **Recomendación:** aceptar.
7. **Rollover de cuotas liberadas en snowball y avalanche.** **Recomendación:** sí, por omisión, sin opción para desactivarlo (es la definición estándar de ambas estrategias).
8. **Reducir cuota en capital fijo con balloon.** (a) **reducir el principal por cuota en proporción al saldo y dejar que el balloon absorba**; (b) mantener el principal por cuota y reducir solo el balloon (equivale a reducir plazo de forma parcial). **Recomendación: (a).**
9. **Guardar simulaciones.** **Recomendación:** no (FR-DEBT-010 dice "sin persistir"); la UI permite exportar la tabla comparativa a CSV.
