# Diseño

## Contexto

`debt/credit-cards` (change 32, archivado; ajustes del change 37) calcula ciclos y estados de cuenta desde el ledger y cuenta en «compras» los gastos cargados a la cuenta, «incluidos intereses y comisiones», pero no tiene un modo de registrarlos: el usuario anota el interés como un gasto común (`kind = EXPENSE`, `source = MANUAL` o `IMPORT`), con la categoría que elija. El requirement «Montos informados por el banco» muestra la diferencia entre el saldo facturado del banco y el del sistema, y registrarlos no crea asientos.

Los reportes ampliados (change 59, archivado) leen las porciones por `NominalFlowQuery.summarizeNominalFlows` con `groupBy ORIGIN` (tipo de transacción y rol `NOMINAL`/`FEE`). `classifyFee` (REPORTING, `domain/extended-reports.ts`) asigna `LOAN` a toda porción de un `LOAN_PAYMENT` y `FEE_CATEGORY` a las porciones nominales en la categoría de sistema `FEES`; `getDebts` informa `payments = null` para las tarjetas. El contrato interno ya declara `origin.loanComponent`, pero `pg-nominal-flows.ts` nunca lo llena. El resumen de deudas (change 35, FR-DEBT-018) atribuye a tarjetas el interés del año por categoría (`movementClass = PURCHASE` y `systemCategoryCode = INTEREST` en `AccountMovementsQuery`), una inferencia que D372 descartó para los reportes.

D372: contar los intereses de tarjeta en los reportes 9 y 10 solo si DEBT los registra como porciones con un rol identificable. Los pagos de préstamo resolvieron lo mismo con un `kind` administrado (`LOAN_PAYMENT`) y un split por componente en su categoría de sistema (add-loans, decisión 10).

## Objetivos / No objetivos

**Objetivos**
- Un cargo de tarjeta es explícito (lo registra o adopta el EDITOR), vive en el ledger como un gasto de la tarjeta y sus porciones se identifican como cargo sin inferencias.
- Los reportes de comisiones y de evolución de deudas los cuentan con una identidad de reconciliación entre ambos.
- Ledger append-only: corregir es anular (reversa) y registrar de nuevo; adoptar es una revisión de la transacción.

**No objetivos**
- Calcular el interés (método de saldo diario promedio, tasa efectiva, interés penal): cada banco lo hace distinto; el sistema registra lo que informa el banco.
- Backfill automático del histórico o inferencia por categoría (D372, pregunta 3 de docs/76).
- Cambiar el resumen de deudas ni el cálculo de ciclos: el cargo es un gasto más de la tarjeta.

## Decisiones

1. **El cargo es un `EXPENSE` con `debtRole = CARD_CHARGE`, no un `kind` nuevo (pregunta 1 de docs/76; decisión del owner del 2026-11-25, D465: opción (a)).** Un `kind` nuevo (`CARD_CHARGE`) obligaría a revisar las ~30 listas de kinds que hoy cuentan gasto (`FLOW_KINDS`, presupuestos, Q3, Q5, pronósticos, calendario de flujo, UI); olvidar una dejaría el interés fuera del gasto sin que ningún test lo note. Como `EXPENSE`, el cargo cuenta igual que hoy en todo lo que mide gasto, y lo único que cambia es la identificación. *Alternativa descartada:* kind nuevo, análogo a `LOAN_PAYMENT`; se justificaba allí porque el pago tiene principal (no gasto) y desglose, y el cargo de tarjeta es todo gasto.

2. **Identificación en TRANSACTIONS.** Columna `txn.transaction.debt_role text NULL` con `CHECK (debt_role IS NULL OR debt_role = 'CARD_CHARGE')` y `CHECK (debt_role IS NULL OR kind = 'EXPENSE')` (abierta a otros roles con un CHECK ampliado, como hizo `20261011100100_txn_loan_kinds.sql`), más `debt_card_id uuid NULL` (referencia lógica a la tarjeta, no nula si y solo si hay rol): la spec exige que el rechazo `TRANSACTION_MANAGED_EXTERNALLY` indique la tarjeta (`details {managedBy: 'CREDIT_CARD', cardId}`, publicado como extensión `details` del problema) y TRANSACTIONS no puede consultar a DEBT para saberlo. Como as-built, un `externalRef` único parcial por `debt.card-charge` se crea CONCURRENTLY en una migración aparte. El componente de cada porción es la categoría de sistema de su split: `INTEREST` → interés; `FEES` → comisiones; `INSURANCE` → seguro; `TAXES` → impuestos. Un cargo registrado tiene `source = 'DEBT'` y `externalRef = {debt.card-charge, chargeId}` (unicidad parcial por `externalRef` como los espacios de nombres de DEBT); uno adoptado conserva su `source` y su `externalRef` (p. ej. el del import), porque la idempotencia del import depende de ellos.

3. **Agregado `CardCharge` en DEBT.** Tabla `debt.card_charge`: `id uuid` (v7), `workspace_id`, `card_id`, `card_account_id` (la cuenta de la tarjeta en DEBT), `account_id` (cuenta de usuario), `transaction_id`, `business_date date`, `currency`, `interest`, `fees`, `insurance`, `taxes` (`numeric(38,18)`, ≥ 0), `origin text CHECK IN ('RECORDED','ADOPTED')`, `status text CHECK IN ('ACTIVE','VOIDED')`, `void_reason text NULL`, `created_at`, `created_by`, `voided_at`, `voided_by`, `version int`. Índices: `(workspace_id, card_account_id, business_date)` y único parcial `(workspace_id, transaction_id) WHERE status = 'ACTIVE'`. RLS forzada fail-closed con la forma vigente (D298) y registro en `platform.workspace_scoped_table`. Los componentes viven en DEBT para el detalle y la auditoría; los reportes NO leen esta tabla (decisión 6), así que no hay dos fuentes de verdad para las cifras.

4. **Registro (`CardChargesService.record`).** En una unidad de trabajo: valida (dominio puro `CardCharge.create`: componentes ≥ 0 con al menos uno > 0, escala de la moneda, fecha ≤ hoy en la zona del workspace y ≥ apertura de la cuenta, tarjeta activa y cuenta de la tarjeta → `CARD_CHARGE_INVALID`; componente negativo → `AMOUNT_NOT_POSITIVE`; escala → `AMOUNT_SCALE_EXCEEDED`), llama a `CardChargeTransactionsPort.recordCharge` (TRANSACTIONS crea el `EXPENSE` posteado con `debtRole`, `source = DEBT`, una porción por componente positivo y el asiento; `PERIOD_CLOSED` sale del ledger), inserta `debt.card_charge`, audita y responde. Idempotencia con `Idempotency-Key` (mecanismo existente). Las categorías de sistema se resuelven por código con la consulta de CLASSIFICATION que ya usan los préstamos.

5. **Adopción y anulación.** `adoptCharge` valida que la transacción sea un `EXPENSE` posteado (`POSTED|CLEARED|RECONCILED`) de una cuenta de la tarjeta, de una sola moneda, sin `debtRole`, no administrada por otro contexto, y que Σ componentes = monto; TRANSACTIONS registra una revisión que reemplaza los splits por uno por componente y fija `debt_role` (la revisión sigue las reglas existentes: splits reemplazados con `superseded_in_revision`, asiento sin cambios porque cuenta, monto y fecha no cambian; si el mapeo contable de categorías exigiera reasentar, es una reversa más un asiento nuevo). `voidCharge` llama a `voidManaged` (reversa del asiento; idempotente) y marca `VOIDED`; un cargo adoptado anulado anula su transacción (pregunta 4 de docs/76: alternativa «solo quitar la marca»).

6. **Lectura de los reportes por porciones.** `NominalFlowRowDto.origin` suma `debtRole?: 'CARD_CHARGE' | null` (SQL: `t.debt_role` en la agrupación por `ORIGIN`). `classifyFee` evalúa, en este orden: comisión de conversión, comisión de transferencia, `LOAN_PAYMENT`, **`debtRole = CARD_CHARGE` → `CARD`**, categoría `FEES` → `FEE_CATEGORY`. En `getDebts`, para las tarjetas, una consulta `summarizeNominalFlows` con `groupBy [ACCOUNT, ORIGIN]` sobre las cuentas de las tarjetas, filtrada a `debtRole = CARD_CHARGE`, separa interés (categoría `INTEREST`) del resto por el código de sistema del árbol de categorías del contexto del reporte. Una sola consulta por reporte (sin N+1), dentro de la unidad de trabajo existente y sin consultas en paralelo.

7. **Propuesta desde la diferencia (Could).** `CardStatement.chargeProposal` = `{businessDate: closingDate, total}` cuando `reported.billedBalance > current.billedBalance`; `null` si no. Solo lectura: la UI abre el formulario con el total a repartir. Nada se registra sin confirmación (la regla «registrarlos NO DEBE crear asientos» sigue intacta).

8. **Transacción administrada.** `isManagedKind(kind)` pasa a `isManaged(state) = isManagedKind(kind) || state.debtRole !== null`. Rechazo con `TRANSACTION_MANAGED_EXTERNALLY` y `details {managedBy: 'CREDIT_CARD', cardId}` para monto, cuenta, fecha, moneda, categoría de las porciones y anulación; descripción, notas, tags y contraparte siguen editables. La edición masiva y las reglas (`add-rule-engine`) ya excluyen las administradas por `isManagedKind`: se cambian a `isManaged` en el mismo PR.

9. **Sin eventos ni consumidores nuevos.** El cargo publica los eventos que TRANSACTIONS ya publica al registrar o anular una transacción; Planning y los demás consumidores existentes los procesan igual. Presupuesto de conexiones intacto (D249).

10. **Datos históricos (pregunta 3 de docs/76).** Sin backfill: la migración no toca filas existentes (`debt_role` nulo). El histórico entra por la adopción explícita. El despliegue N1 aún no ocurrió, así que en producción no hay histórico real que migrar.

## Contratos

**OpenAPI (`contracts/openapi/finance-api.v1.yaml`, aditivo; tag `Debt`, `x-openspec-capability: [debt/credit-cards]`):**

- `POST /workspaces/{workspaceId}/credit-cards/{cardId}/charges` — `createCardCharge`, `x-required-role: EDITOR`, parámetro `IdempotencyKey`. Cuerpo `CardChargeInput`: `{accountId: Uuid, businessDate?: LocalDate, interest?: DecimalString, fees?: DecimalString, insurance?: DecimalString, taxes?: DecimalString, adoptTransactionId?: Uuid, description?: string (≤ 200)}` (`additionalProperties: false`; con `adoptTransactionId`, `businessDate` no se admite y se toma la de la transacción). Respuestas: `201` `CardCharge` con `ETag` y `Location`; `400`, `401`, `403`, `404`, `409` (`PERIOD_CLOSED`), `422` (`CARD_CHARGE_INVALID`, `AMOUNT_NOT_POSITIVE`, `AMOUNT_SCALE_EXCEEDED`, `VALIDATION_FAILED`, `IDEMPOTENCY_KEY_REUSED`), `429`, `500`, `503`.
- `GET /workspaces/{workspaceId}/credit-cards/{cardId}/charges` — `listCardCharges`, `VIEWER`; query `accountId?`, `from?`, `to?` (`LocalDate`), `status?` (`ACTIVE|VOIDED`), `limit?` (1–200, 50 por omisión) y `after?` (cursor opaco de `nextCursor`), del más reciente al más antiguo. `200` `CardChargeList {items: CardCharge[], nextCursor}`.
- `POST /workspaces/{workspaceId}/credit-cards/{cardId}/charges/{chargeId}/void` — `voidCardCharge`, `EDITOR`, `IfMatch`; cuerpo `{reason: string (1–200)}`. `200` `CardCharge`; `409` (`PERIOD_CLOSED`), `412`, `428`.
- `CardCharge`: `{id, cardId, accountId, currency, businessDate, interest: Money, fees: Money, insurance: Money, taxes: Money, total: Money, origin: x-extensible-enum [RECORDED, ADOPTED], status: x-extensible-enum [ACTIVE, VOIDED], transactionId, voidReason: string|null, createdAt, version}`.
- `CardStatement`: propiedades nuevas, no requeridas: `charges` (`CardCharge[]` vigentes del ciclo) y `chargeProposal` (`{businessDate: LocalDate, total: Money}` o `null`).
- `Transaction` (y sus variantes de detalle y listado): `debtRole`, `x-extensible-enum [CARD_CHARGE]` o `null`, y `debtCardId` (`Uuid` o `null`), no requeridas.
- `FeesReport.months[].byType[].type`: `CARD` en el `x-extensible-enum` existente.
- `DebtsReport.debts[].months[]`: `interestCharged` y `chargesCharged` (`Money` o `null`; `null` en préstamos), no requeridas; `DebtsReport.consolidated[]`: `interestCharged` (`ReportAmount`), no requerida.
- `ErrorCode`: `CARD_CHARGE_INVALID` en el `x-extensible-enum`, con comentario `# 422 (add-card-interest-ledger-portions)`.

Todo es aditivo: rutas nuevas, propiedades opcionales en respuestas, valores nuevos en enums extensibles. `pnpm contract:breaking` limpio; Spectral y Redocly sin errores (las reglas `pfos-money-via-schema` exigen `Money` para montos: los componentes de entrada van como `DecimalString` porque la moneda es la de la cuenta, igual que `CardStatementReportedInput` usa `Money`; si Spectral lo marca, se usan `Money` y se valida que la moneda sea la de la cuenta).

**Contratos internos (TypeScript):**
- `@pf/transactions/contracts`: `CardChargeTransactionsPort` (`recordCharge`, `adoptCharge`, `voidCharge`) y `CARD_CHARGE_TRANSACTIONS_PORT`; `NominalFlowRowDto.origin.debtRole`; `TransactionDto.debtRole`.
- `@pf/debt/contracts`: sin cambios para REPORTING (lee porciones de TRANSACTIONS).

**Eventos:** ninguno nuevo ni versión nueva.

**Export (`contracts/export/v1`, compatible, misma `formatVersion`):** `card-charges.schema.json` (sección nueva) y `debt_role` en `transactions.schema.json`; el importador restaura la relación por el mapa de ids.

## Riesgos / Trade-offs

- **Doble registro con imports** → la UI de registro avisa si existe un gasto de la tarjeta en «Intereses pagados» o «Comisiones» en el ciclo sin adoptar, y ofrece adoptarlo; el aviso de posible duplicado del alta manual existente sigue aplicando.
- **Adopción de un gasto con porciones de varias categorías** → se reemplazan todas; la revisión anterior queda en el historial de la transacción.
- **Cambio de cifras del reporte de comisiones** → una comisión de tarjeta registrada como cargo deja `FEE_CATEGORY` y pasa a `CARD`; el total no cambia. Documentado en el scenario.
- **`origin.loanComponent` sigue sin llenarse** → fuera de alcance; se anota en docs/38 §4.

## Plan de migración

1. `YYYYMMDDHHMMSS_txn_debt_role.sql` (expand): `ADD COLUMN debt_role text NULL`, CHECK de valores y de `kind` con `NOT VALID` + `VALIDATE`, índice parcial `(workspace_id, transaction_date) WHERE debt_role IS NOT NULL` solo si el plan de la consulta del reporte lo pide (se mide con el Large Seed antes de crearlo).
2. `YYYYMMDDHHMMSS_debt_card_charge.sql` (expand): tabla, índices, RLS forzada, grants (`pf_app`, `pf_worker` lectura para el export), registro en `platform.workspace_scoped_table` y matriz de TC-SECURITY-RLS-007.
3. Sin backfill. Rollback: las columnas y la tabla nuevas se ignoran si se revierte el código (expand puro).

## Preguntas abiertas

En [docs/76](../../../docs/76-phase-9-and-card-interest-questions.md): 1 (`EXPENSE` con rol frente a `kind` nuevo), 2 (componentes), 3 (histórico: adopción frente a backfill), 4 (anular un cargo adoptado) y 5 (Demo v2 con un cargo). **Pregunta 1: resuelta por el owner el 2026-11-25, opción (a) (D465).** Las preguntas 2 a 5 se implementaron con la recomendación de docs/76, **pendientes de confirmación del owner**: componentes interés, comisiones, seguro e impuestos en las categorías de sistema `INTEREST`, `FEES`, `INSURANCE` y `TAXES`; sin backfill y con adopción explícita; anular un cargo adoptado anula su transacción; y el cargo del Demo v2 (tarea Could 7.4) quedó diferido.

## Cambios a docs compartidos

- `docs/09-ledger-design.md`: el cargo de tarjeta como gasto administrado con rol (§ transacciones administradas).
- `docs/14-reporting.md`: tipo `CARD` del reporte de comisiones y lo cargado por tarjeta en el de deudas.
- `docs/10-api-design.md` §9.1: `CARD_CHARGE_INVALID`.
- `docs/38-estado-y-pendientes.md`: cerrar el hallazgo de D372 al fusionar.
