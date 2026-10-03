# Diseño

## Contexto

Motivación y alcance: ver proposal.md. Se apoya por completo en el agregado `Transaction` de `add-transaction-recording` (estados, amend con reversa, void, versionado, idempotencia, auditoría, outbox) y añade el kind `TRANSFER`. Referencias: ARCHITECTURE §4.1/§4.3, docs/09 §6.4, §6.8, §6.17, §15.2, docs/08 §5.4 ("no hay tabla `transfer`"), docs/10 §13 (`/transfers` es una fachada), docs/11 §3.2.

Capas afectadas:

| Capa | Cambios |
|---|---|
| domain | Factory `Transaction.recordTransfer(from, to, amount, fee?)` con invariantes: misma moneda (INV-002), cuentas distintas, monto y comisión positivos con escala válida; legs `SOURCE` = −(monto + comisión) y `TARGET` = +monto; split único de comisión (categoría *Fees* o la indicada, que debe ser de gasto). `TransactionPostingTranslator` para `TRANSFER`: +destino, −origen [+`EXPENSE:<CCY>` con `splitId` de la comisión]. |
| application | Comando `RecordTransfer` (Unit of Work idéntico a `RecordTransaction`); la emisión de `TransferCompleted` se agrega a los handlers de posteo (`RecordTransfer` posted/cleared, `PostTransaction` y `AmendTransaction` cuando `kind=TRANSFER`). |
| infrastructure | Constraint trigger diferido `txn.assert_transfer_consistency()`. Sin tablas nuevas. |
| interface | Controller `POST W/transfers` (fachada que devuelve `Transaction`); UI: formulario de transferencia con atajo "Pagar tarjeta" (destino filtrado a cuentas LIABILITY de la misma moneda). |

Puertos: `AccountDirectory` (moneda, naturaleza, estado), `ClassificationValidator` (categoría *Fees* y kind de la categoría de comisión), `LedgerPostingPort`, `AuditPort` (ver design de `add-transaction-recording`).

## Objetivos / No objetivos

**Objetivos:** transferencias misma moneda (ASSET↔ASSET, ASSET→LIABILITY, LIABILITY→ASSET p. ej. avance de efectivo) con comisión opcional; INV-009 verificable por PBT; evento para Goals/Debt/Reporting.

**No objetivos:** conversiones, emparejamiento de importadas (`LinkAsTransfer`, Phase 6), kind `CARD_PAYMENT` y vínculo con estados de cuenta de tarjeta (Phase 4), transferencias entre workspaces.

## Decisiones

1. **Una transacción, un asiento.** Una transferencia es `kind='TRANSFER'` con dos legs (`SOURCE`, `TARGET`) y un solo asiento (docs/09 §6.4). Alternativa — dos transacciones espejo (gasto + ingreso) — descartada: infla ingresos/gastos y rompe INV-009 ante una edición parcial.
2. **Comisión en el mismo asiento.** La comisión sale del origen: leg `SOURCE` = −(monto + comisión); posting `EXPENSE:<CCY>` +comisión con `splitId` de un split en *Fees* (o en la categoría de gasto indicada; categoría de ingreso ⇒ `CATEGORY_KIND_MISMATCH`). Σ por moneda = 0 (p. ej. 1000.00 + 10.00 − 1010.00). ΔPatrimonio = −comisión (INV-009). Comisiones en otra moneda u otra cuenta quedan fuera (se registran como gasto aparte o como conversión; docs/31 D37, **propuesta pendiente de confirmación del owner**).
3. **Validaciones y códigos.** `from = to` ⇒ `TRANSFER_SAME_ACCOUNT` (422); moneda distinta ⇒ `TRANSFER_CURRENCY_MISMATCH` (422) con extensión `suggestedOperationId: createConversion` en el problem detail (la UI ofrece abrir el formulario de conversión prellenado); cuenta archivada/cerrada ⇒ `ACCOUNT_ARCHIVED`/`ACCOUNT_CLOSED` (409); `AMOUNT_NOT_POSITIVE`/`AMOUNT_SCALE_EXCEEDED` (422). Se prefiere un código específico a `CURRENCY_MISMATCH` porque el cliente necesita distinguir "usa una conversión" de "moneda distinta a la de la cuenta".
4. **Pago de tarjeta.** Es una transferencia normal con destino de naturaleza `LIABILITY` (docs/09 §6.8, INV-030): `LIABILITY:<card>` +monto, `ASSET:<bank>` −monto, sin EXPENSE. En Phase 1 el kind se mantiene `TRANSFER`; `CARD_PAYMENT` (enumerado en el OpenAPI) se reserva para `debt/credit-cards` (Phase 4), que podrá enriquecerlo sin cambiar el asiento.
5. **Estados.** Mismo ciclo que cualquier transacción (`add-transaction-recording`): `pending` sin asiento ni `TransferCompleted`; al quedar posteada se postea el asiento y se emite `TransferCompleted`. Void ⇒ reversa + `TransactionVoided` (los consumidores revierten el efecto). Amend de monto/comisión/cuentas ⇒ reversa + nuevo asiento; cambiar una cuenta a otra moneda ⇒ `TRANSFER_CURRENCY_MISMATCH`.
6. **`TransferCompleted` tras un amend.** Se emite nuevamente con el `journalEntryId` activo (idempotencia natural `(transactionId, journalEntryId)`, docs/11); los consumidores deben tratarlo como *upsert* por `transactionId` (el último reemplaza al anterior). **Reemplazada por docs/31 D37 (owner, 2026-10-03):** `TransferCompleted` se emite **una sola vez**, en el primer posteo; cada edición financiera (reversa + nueva revisión) emite `transactions.TransferRevised.v1` con los asientos revertido, de reversa y nuevo, y la anulación sigue con `TransactionVoided`. El cambio se implementa en el change `add-lifecycle-timeline` (requirement "Revisión de una transferencia como transición explícita" de `transactions/transfers`); hasta entonces rige el comportamiento implementado (re-emisión con upsert).
7. **Consistencia en BD.** Constraint trigger diferido `txn.assert_transfer_consistency()` en `txn.transaction_leg`: para `kind='TRANSFER'` y legs vigentes, exactamente un `SOURCE` (< 0) y un `TARGET` (> 0), cuentas distintas y misma moneda. Segunda barrera del dominio, igual que el cuadre por moneda en Ledger.
8. **Listados.** `kind=TRANSFER` se excluye de los totales de ingresos/gastos; la comisión sí cuenta como gasto (split *Fees*). El filtro `accountId` del listado devuelve la transferencia en ambas cuentas.

### Modelo de datos

| Tabla | Cambio | RLS / grants |
|---|---|---|
| `txn.transaction` | Sin cambios de columnas (usa `kind='TRANSFER'`). | WS (sin cambios) |
| `txn.transaction_leg` | Sin columnas nuevas; nuevo constraint trigger diferido `txn.assert_transfer_consistency()`. | WS (sin cambios) |
| `txn.transaction_split` | Solo split de comisión para `TRANSFER` (la regla Σ splits = nominal de INV-021 no aplica a la parte transferida). | WS (sin cambios) |

Migración `txn_0002_transfers` (expand, no destructiva).

### Eventos

| Evento | Cuándo | Idempotencia |
|---|---|---|
| `transactions.TransactionCreated.v1` | Al aceptar la transferencia (pending/posted/cleared) | natural `transactionId` |
| `transactions.TransactionPosted.v1` | Al postear (creación, `pending→posted`, amend) | `(transactionId, revision)` |
| `transactions.TransferCompleted.v1` | Mismo momento que `TransactionPosted` para `kind=TRANSFER`; `fee` = comisión o `null`; `matchedTransactionIds = []` | `(transactionId, journalEntryId)` |
| `transactions.TransactionVoided.v1` | Al anular | `transactionId` |

Todos en `platform.outbox` en la misma transacción BD. Consumidores: REPORTING (Phase 1), GOALS y DEBT (Phase 4).

## Contratos

Cambios **exactos** requeridos (no se editan aquí):

**`contracts/openapi/finance-api.v1.yaml`**

1. `components.schemas.ErrorCode`: agregar `TRANSFER_CURRENCY_MISMATCH` (422). Documentar en docs/10 §9.1 (contexto transactions).
2. `components.schemas.Problem` (o el schema de problem details vigente de `add-api-conventions`): agregar propiedad opcional `suggestedOperationId` (string, p. ej. `createConversion`) como extensión RFC 9457.
3. `components.schemas.TransferCreate`: agregar `postingDate` (`LocalDate`, opcional); documentar en `fee.categoryId` que debe ser categoría de gasto (`CATEGORY_KIND_MISMATCH`) y que el default es la categoría de sistema *Fees*.
4. `createTransfer`: documentar errores 409 `ACCOUNT_ARCHIVED|ACCOUNT_CLOSED|CATEGORY_ARCHIVED`, 422 `TRANSFER_SAME_ACCOUNT|TRANSFER_CURRENCY_MISMATCH|AMOUNT_NOT_POSITIVE|AMOUNT_SCALE_EXCEEDED|CATEGORY_KIND_MISMATCH|REFERENCE_NOT_FOUND`; agregar ejemplos `samePeriodTransfer` (300.00 BOB A→B), `transferWithFee` (1000.00 BOB + fee 10.00 BOB) y `creditCardPayment` (350.00 BOB Bank A → Credit Card); documentar que la respuesta `Transaction` tiene `kind=TRANSFER`, legs `SOURCE`/`TARGET` y, si hubo comisión, un split en *Fees*.

**`contracts/events/`**

- Sin cambios: `transactions/TransferCompleted.v1.schema.json` ya cubre `fromAccountId`, `toAccountId`, `amount`, `fee` y `matchedTransactionIds`. Se agrega solo un segundo `examples[]` con comisión (`fee: {amount: "10.00", currency: "BOB"}`) para los tests de consumidores.

> Consolidado en contracts/ el 2026-10-02.

## Dependencias con otros changes de Phase 1

- **Requiere (aplicar antes):** `add-transaction-recording` (agregado, estados, amend/void, idempotencia, `TransactionUpdated`), `add-accounts-management` (naturaleza `LIABILITY` de `credit_card`, estado `closed`/`archived`), `add-ledger-core` (`LedgerPostingPort`), `add-classification` (categoría de sistema *Fees*), `add-api-conventions` (problem details extensible).
- **Relacionado:** `add-manual-conversions` (destino de la orientación de `TRANSFER_CURRENCY_MISMATCH`); `add-basic-dashboard` (excluye `TRANSFER` de ingresos/gastos).
- TC-LEDGER-TRANSFER-001 pertenece al change del ledger y ya apunta al requirement "Transferencia entre cuentas propias" de esta capability.

## Riesgos / Trade-offs

- [Reportes que sumen legs en vez de splits contarían el pago de tarjeta como salida de gasto] → Reporting deriva gastos de postings `EXPENSE` (INV-034); TC-TRANSACTIONS-CARDPAYMENT-001 lo protege.
- [Comisión en moneda distinta a la transferida no soportada] → aceptado: se registra como gasto aparte; documentado en la UI.
- [Re-emisión de `TransferCompleted` tras amend] → resuelto por docs/31 D37: emisión única + `TransferRevised.v1` por edición (change `add-lifecycle-timeline`).

## Plan de migración

Expand-only: `txn_0002_transfers` crea el constraint trigger de consistencia. Sin datos existentes que migrar. Rollback = revertir el commit y dropear el trigger.

## Preguntas abiertas

1. ~~¿`TransferCompleted` debe re-emitirse tras un amend?~~ — resuelta por el owner el 2026-10-03 (docs/31 D37): editar = reversa + nueva revisión como transición trazable; `TransferCompleted` una sola vez y `TransferRevised.v1` por edición (change `add-lifecycle-timeline`).
2. ¿Se necesitan comisiones de transferencia pagadas desde una tercera cuenta o en otra moneda en Phase 1? — **Propuesta (docs/31 D37), pendiente de confirmación del owner:** no en Phase 1; la comisión en otra moneda se registra como conversión o gasto aparte.
3. ~~Código para transferencia entre monedas~~ — resuelta por el owner el 2026-10-03 (docs/31 D37): se mantiene `TRANSFER_CURRENCY_MISMATCH`.
