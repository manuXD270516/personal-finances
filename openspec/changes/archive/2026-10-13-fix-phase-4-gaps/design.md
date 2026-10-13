# Diseño: fix-phase-4-gaps

## Contexto

Correcciones acotadas de Phase 4 (docs/39 §A.6, docs/38 §4) con el alcance que fija D222 (por omisión, revertible; alcance de docs/40 P4). Decisiones del owner que se respetan:

| Decisión | Efecto en este change |
|---|---|
| D219 | Phase 5 empieza con Phase 4 "completa salvo evidencias del owner"; ningún change toca `debt/loans` ni `debt/amortization` hasta el archivado encadenado. |
| D222 | Alcance: próximo vencimiento de tarjeta, ciclo con saldo inicial, aviso al anular un aporte con retiros posteriores (se **avisa**, no se bloquea), lista de préstamos sin N+1, edición del borrador desde la UI y benchmark del simulador. Sin deltas sobre `debt/loans` ni `debt/amortization`. |
| D154 | La adopción de la tabla del banco con fechas distintas queda fuera: espera la evidencia del owner. |

| Contexto | Elemento | Capa | Cambio |
|---|---|---|---|
| Debt | `CardCycleCalculator`: "otros movimientos" incluye el asiento de apertura de la cuenta | domain | Corrección (TDD) |
| Debt | DS puro `NextDueResolver` (próximo vencimiento y estados atrasados por cuenta) | domain | Nuevo (TDD), reemplaza `nextDue` de `card-views.ts` |
| Debt | Vista de tarjeta: `nextDueDate` corregido, `overdueStatements[]` | application/interface | Corrección + campo aditivo |
| Debt | `ListLoans` con los campos de la lista (próxima cuota, saldo, principal pendiente) | application/interface | Aditivo, sin cambio de spec |
| Ledger | Consulta pública de asientos de apertura por cuenta y rango (`OpeningBalanceQuery`), si `AccountMovementsQuery` no los expone | application (contracts) | Aditivo |
| Goals | DS puro `VoidImpactCalculator`; query `PreviewTransactionVoidImpact`; `negativeFunds[]` en la vista de la meta | domain/application | Nuevo (TDD) |
| apps/api | `GET W/goals/void-impact` | interface | Nuevo |
| apps/web | Diálogo de anulación de transacciones (aviso), detalle de tarjeta (atrasados), detalle de meta (faltante), lista y edición de préstamos | interface | Corrección |

## Objetivos / No objetivos

**Objetivos:**
- Ninguna fecha "próxima" en el pasado en tarjetas; los vencidos se ven como atrasados.
- Ciclos cuadrados cuando las cifras cuadran (la métrica `debt_card_cycle_mismatch_total` deja de contar falsos positivos).
- El usuario sabe antes de anular que una meta quedará con fondos negativos, y la meta lo muestra después.
- Lista de préstamos con una sola llamada; borrador editable desde la UI; p95 del simulador medido.

**No objetivos:**
- Cambios de comportamiento de préstamos que requieran spec (después del archivado encadenado).
- Bloquear la anulación (D222), ni ajustar automáticamente los fondos negativos.
- Notificar los fondos negativos (no está en D222).
- Los demás puntos de docs/38 §4 fuera de D222 (pregunta 1).

## Decisiones

1. **Saldo inicial en "otros movimientos".** El asiento de apertura de la cuenta de la tarjeta (registrado por ACCOUNTS al crear la cuenta con saldo inicial, sin transacción) no aparece en `AccountMovementsQuery`. `CardCycleCalculator` suma a `otherNet` el monto de apertura cuya fecha cae en el ciclo, obtenido de LEDGER por contrato público (`OpeningBalanceQuery.forAccounts({accountIds, from, to})`, aditivo; si `AccountMovementsQuery` ya distingue el asiento de apertura se usa esa). La invariante `previous + purchases − refunds − payments + otherNet = closing` se sigue verificando en cada cálculo; `consistent = false` solo cuando de verdad no cuadra. Estados de cuenta ya emitidos: sus cifras emitidas no cambian (requirement "Emisión única y recálculo"); la vista recalculada muestra el ciclo cuadrado sin re-emitir.
2. **Próximo vencimiento (`NextDueResolver`, puro).** Entrada: ciclos de la cuenta (emitidos con su `standing`, ciclo abierto) y `today` en la zona del workspace. `nextDueDate = min{dueDate ≥ today}` entre estados emitidos con `remainingNoInterest > 0` y el ciclo abierto; ciclos cerrados sin estado emitido (anteriores al registro de la tarjeta) nunca cuentan. `overdueStatements[]` = estados emitidos con `dueDate < today` y faltante, con su estado (`PARTIALLY_PAID`/`OVERDUE`) y lo que falta. El ciclo abierto siempre tiene `dueDate ≥ today` (su cierre es ≥ hoy y el vencimiento es posterior al cierre), así que el resultado nunca es nulo. Consumidores del campo (`CardPortfolioQuery`, Q5, Q8, resumen de deudas) se revisan con sus TC de regresión.
3. **Impacto de una anulación (`VoidImpactCalculator`, puro).** Para una transacción dada, GOALS busca los movimientos vigentes que respalda (aportes o retiros por `(transactionId, revision)`) y calcula, por meta y cuenta, `fondos actuales − monto del aporte` (o `+` para un retiro). `PreviewTransactionVoidImpact({workspaceId, transactionId})` devuelve `[{goalId, goalName, accountId, accountName, currency, currentFunds, fundsAfterVoid, negative}]`; vacío si la transacción no respalda movimientos. La UI de anulación de TRANSACTIONS la llama antes de confirmar (la composición la hace la web; TRANSACTIONS no depende de GOALS). La anulación por API sin vista previa sigue funcionando igual (el aviso es de la UI). Tras la anulación, el inverso se registra como hoy (requirement sin cambio de conducta) y la vista de la meta agrega `negativeFunds[{accountId, currency, amount}]` calculado desde los movimientos (sin columnas nuevas).
4. **Lista de préstamos sin N+1.** `ListLoans` agrega a cada fila los campos que la pantalla pedía con `GET W/loans/{id}` (próxima cuota con pendiente y atraso, saldo de la cuenta, principal pendiente; ya existen en `LoanPortfolioQuery`). Aditivo en `LoanList`; la web hace una sola llamada. Sin cambio de conducta especificada: el TC verifica el número de llamadas y que las cifras coinciden con el detalle.
5. **Edición del borrador desde la UI.** Formulario de edición sobre `PATCH W/loans/{id}` existente (`If-Match`; en `DRAFT` todos los campos, con vista previa del cronograma recalculada). Conducta ya especificada en "Registrar un préstamo con sus condiciones" de `add-loans`.
6. **Benchmark del simulador.** Prueba de rendimiento (suite `perf` nightly, como TC-REPORTING-SPENDABLE-014) sobre `POST W/loans/payoff-simulations` (pagos extra de un préstamo y estrategias avalanche/snowball), con 10 préstamos de 360 cuotas: p95 < 300 ms (objetivo del design de `add-loan-amortization-advanced`, riesgo "Simulación lenta"). El test funcional de 3 s se mantiene.

## Contratos

**`contracts/openapi/finance-api.v1.yaml`** (todo aditivo; `pnpm contract:breaking` limpio):

| Operación | Método y ruta | Rol | Notas |
|---|---|---|---|
| `previewTransactionVoidImpact` | `GET W/goals/void-impact?transactionId=` | VIEWER | 200 `GoalVoidImpact {transactionId, goals[{goalId, goalName, accountId, currency, currentFunds: Money, fundsAfterVoid: Money, negative}]}`; 404 si la transacción no existe; `x-openspec-capability: goals/savings-goals` |

Schemas modificados (campos opcionales nuevos): `CardAccount.overdueStatements[]` (`{closingDate, dueDate, status, remainingNoInterest: Money, remainingMinimum: Money}`); `GoalDetail.negativeFunds[]` (`{accountId, amount: Money}`); ítems de `LoanList` con `nextInstallment`, `accountBalance` y `outstandingPrincipal` (los que falten). Sin códigos de error nuevos.

**Eventos:** ninguno.

## Riesgos / Trade-offs

- [Cambiar `nextDueDate` mueve cifras de Q5 y Q8] → TC de regresión de `reporting/dashboard` y `reporting/cash-flow-calendar`; la fecha nueva siempre es ≥ hoy, nunca anterior a la que se mostraba para estados no vencidos.
- [Saldo inicial fuera del rango de ciclos calculados] → solo afecta al ciclo que contiene la fecha del asiento; ciclos anteriores no existen para esa cuenta.
- [Aviso solo en la UI] → la API de anulación no cambia; el faltante queda visible en la meta igualmente.
- [Benchmark ruidoso en CI] → nightly, no bloqueante del PR; timeout explícito.

## Plan de migración

Sin migraciones ni datos. Despliegue aditivo. Rollback: revertir el despliegue (ningún dato nuevo persistido).

## Preguntas abiertas

1. **Deuda de Phase 4 fuera de D222.** docs/38 §4 lista además: notas y etiquetas de transacciones `LOAN_*` no editables desde la UI, cuotas de tarjeta sin rótulo en Q8, supuestos de Q5 sin spec (mes calendario sin periodo financiero; "tarjetas sin pago programado" sin distinguir mínimo de total) y el job de metas cada hora. Opciones: (a) **dejarlos como deuda conocida y decidirlos en Phase 7** (Q5 y Q8 se rehacen con los reportes avanzados); (b) sumarlos a este change (Q5 y Q8 necesitarían deltas de `reporting/dashboard` y `reporting/cash-flow-calendar`, y las notas `LOAN_*` tocarían `debt/loans`, prohibido por D219); (c) solo especificar los supuestos de Q5 tal como están implementados. **Recomendación: (a)**; no bloquea.
2. **Notificación de fondos negativos.** D222 pide avisar al anular; no dice si avisar también por NOTIFY. (a) **Solo el aviso previo y la marca en la meta** (este diseño); (b) además una notificación in-app a OWNER y EDITOR. **Recomendación: (a)**; no bloquea.
