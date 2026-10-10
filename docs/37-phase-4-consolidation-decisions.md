# 37 — Decisiones del owner de la consolidación de Phase 4

> **Fecha:** 2026-10-10 · **Relacionado:** [36-phase-4-consolidation-questions.md](36-phase-4-consolidation-questions.md) (pregunta N → D(152+N)), [03-openspec-strategy.md](03-openspec-strategy.md) §7

El owner respondió las 10 bloqueantes con la recomendación y aceptó en bloque las 56 restantes. Para el criterio de salida de préstamos (D154) cargará la tabla real de su banco en la app al probar. Las specs ya estaban escritas con las recomendaciones: no requieren cambios.

| ID | Pregunta | Decisión |
|---|---|---|
| D153 | Q1 Cuota con ACT/360, ACT/365 o primer periodo irregular | Se acepta la recomendación: cuota nivelada solo con ACT/360, ACT/365 o primer periodo irregular; 30/360 regular con la fórmula estándar. |
| D154 | Q2 Tabla real del banco del owner para el exit criterion | El owner cargará la tabla real de su banco en la app al probar (nunca en el repositorio); la implementación arranca con 30/360 y la comparación cuota a cuota. |
| D155 | Q3 Orden de imputación por defecto | Se acepta (a): fijo con ese orden en Phase 4 |
| D156 | Q4 Cuenta del préstamo | Se acepta (a): elegir una existente o crearla en el mismo acto (puerto `AccountProvisioningPort`) |
| D157 | Q5 Préstamo en USD pagado desde una cuenta en BOB | Se acepta (a): rechazar con `CURRENCY_MISMATCH`; registrar antes la conversión a una cuenta USD |
| D158 | Q6 Movimientos manuales en la cuenta del préstamo | Se acepta (a): permitidos y mostrados como diferencia no registrada en el detalle |
| D159 | Q7 Morosidad | Se acepta la recomendación: fuera de Phase 4; la cuota atrasada se ve en el detalle y en próximos pagos (estado atrasada del motor). |
| D160 | Q8 Ajuste de vencimientos por fin de semana o feriado | Se acepta la recomendación: fuera de este change; la comparación lo detecta como diferencia de fechas; si la tabla del owner lo requiere, se agrega `businessDayAdjustment: NONE/NEXT` reutilizando la regla del motor (D130: feriados fuera). |
| D161 | Q9 Cargos `RATE_ON_BALANCE` | Se acepta la recomendación: aceptar y validar con la pregunta 2. |
| D162 | Q10 Pagar una cuota desde la pantalla de recurrentes | Se acepta (a): `RECURRING_MANAGED_EXTERNALLY` y la UI ofrece "Registrar pago" que abre el formulario del préstamo prellenado |
| D163 | Q11 Recorrido (D37) del préstamo como Should en este change | Se acepta la recomendación: sí. |
| D164 | Q12 Comisión de originación no retenida | Se acepta la recomendación: se registra como gasto normal en "Comisiones de préstamo"; solo la retenida va en el desembolso. |
| D165 | Q13 Vencimientos de tarjeta en Q4/Q8 | Se acepta (a): Plan de pago = definición `CARD_PAYMENT` administrada (`managedBy = DEBT`), opcional por cuenta y activado por defecto en el alta si se indica cuenta de origen |
| D166 | Q14 Transferencias recurrentes del usuario hacia la tarjeta | Se acepta (a): Rechazar el plan con `CARD_PAYMENT_PLAN_CONFLICT` mientras exista una activa; el usuario la termina y activa el plan |
| D167 | Q15 Adoptar una transferencia existente como plan | Se acepta la recomendación: no en este change (como D141). |
| D168 | Q16 Valores por defecto del plan | Se acepta la recomendación: `NO_INTEREST` + `PENDING_APPROVAL`. |
| D169 | Q17 Crédito usado | Se acepta la recomendación: así. |
| D170 | Q18 Pagos que cuentan contra el estado de cuenta | Se acepta la recomendación: así; el saldo facturado del banco (Could) corrige casos raros. |
| D171 | Q19 Bimoneda Must | Se acepta la recomendación: confirmarlo; el diseño ya lo soporta sin costo extra. |
| D172 | Q20 Historia de estados de cuenta al registrar | Se acepta la recomendación: así. |
| D173 | Q21 Interés rotativo | Se acepta la recomendación: así en Phase 4 (RISK-005); estimarlo con días de financiamiento sería un change posterior. |
| D174 | Q22 Destinatarios y recordatorio | Se acepta la recomendación: así. |
| D175 | Q23 Cuotas con interés | Se acepta la recomendación: así, Could. |
| D176 | Q24 Días 29–31 | Se acepta la recomendación: 1–31. |
| D177 | Q25 `CARD_PAYMENT` como kind de transacción | Se acepta la recomendación: dejarlo reservado sin uso; el pago sigue siendo `TRANSFER` (D27). |
| D178 | Q26 Recorrido (D37) | Se acepta la recomendación: no en este change. |
| D179 | Q27 Estado `closed` | Se acepta (a): agregar `closed` (`achieved → closed`, terminal, libera reservas) |
| D180 | Q28 ¿Los aportes reales que siguen en una cuenta líquida cuentan como reservados? | Se acepta (a): sí: reservado = reservas + aportes reales netos en la cuenta |
| D181 | Q29 Ingresos directos en una cuenta vinculada como aporte | Se acepta (a): solo transferencias en Phase 4 |
| D182 | Q30 Aporte recurrente sobre el motor de recurrencia | Se acepta (a): definición `TRANSFER` administrada por la meta (`managedBy = GOAL`) con el puerto público `RecurringDefinitionPort` compartido con Debt |
| D183 | Q31 Saldo base del límite de reservas | Se acepta (a): saldo contable |
| D184 | Q32 Tolerancia del estado y periodos del ritmo | Se acepta la recomendación: por meta con esos defaults. |
| D185 | Q33 Criterio del estado `behind`/`on-track`/`ahead` | Se acepta (a): progreso real vs. esperado lineal desde la fecha de inicio |
| D186 | Q34 Hitos repetidos | Se acepta (a): una vez por meta e hito, para siempre |
| D187 | Q35 Destinatarios | Se acepta la recomendación: esos. |
| D188 | Q36 Meta alcanzada por el tipo de cambio | Se acepta (a): la reevaluación diaria puede marcarla alcanzada; una baja posterior no la reabre |
| D189 | Q37 Retiro vinculado a un gasto por un monto parcial | Se acepta (a): monto ≤ el de la transacción |
| D190 | Q38 Recorrido de la meta (D37) | Se acepta (a): Sí, máquina `SavingsGoal` en `audit/lifecycle-timeline`, Should |
| D191 | Q39 Notificar sugerencias de aporte | Se acepta la recomendación: no; contador en la UI (D135 por analogía). |
| D192 | Q40 Cuenta archivada o cerrada con fondos de metas | Se acepta (a): no bloquear en Phase 4: cerrar exige saldo 0, así que la cuenta queda sobre-asignada y se avisa; las reservas de una cuenta archivada se listan para liberarlas |
| D193 | Q41 Aportes planificados en el plan mensual | Se acepta (a): sección de solo lectura "Aportes a metas" sin crear líneas |
| D194 | Q42 Interés del periodo en que cae un prepago | Se acepta (a): aplicar el prepago a la frontera del periodo: el interés de la cuota siguiente se calcula sobre el saldo reducido completo |
| D195 | Q43 Vigencia de un cambio de tasa dentro de un periodo ya iniciado | Se acepta (a): la tasa nueva aplica desde el primer periodo que empieza en o después de la vigencia (sin prorrateo) |
| D196 | Q44 Recálculo de préstamos custom | Se acepta (a): no se recalculan: prepago y cambio de tasa ⇒ `LOAN_SCHEDULE_IS_CUSTOM`; el usuario carga la tabla nueva del banco |
| D197 | Q45 Simulador entre monedas | Se acepta (a): solo participan los préstamos en la moneda del extra; los demás se informan fuera de la estrategia |
| D198 | Q46 Tarjetas de crédito en avalanche/snowball | Se acepta (a): no en este change; solo préstamos |
| D199 | Q47 Comisión por prepago | Se acepta la recomendación: aceptar. |
| D200 | Q48 Rollover de cuotas liberadas en snowball y avalanche | Se acepta la recomendación: sí, por omisión, sin opción para desactivarlo (es la definición estándar de ambas estrategias). |
| D201 | Q49 Reducir cuota en capital fijo con balloon | Se acepta (a): reducir el principal por cuota en proporción al saldo y dejar que el balloon absorba |
| D202 | Q50 Guardar simulaciones | Se acepta la recomendación: no (FR-DEBT-010 dice "sin persistir"); la UI permite exportar la tabla comparativa a CSV. |
| D203 | Q51 Prioridad | Se acepta (a): Subir a Should y hacerlo el último change de Phase 4 |
| D204 | Q52 Saldo a favor | Se acepta (a): Aparte, sin restar del total adeudado |
| D205 | Q53 Pasivos excluidos del patrimonio neto | Se acepta (a): Incluirlos marcados |
| D206 | Q54 Año del interés pagado | Se acepta (a): Año calendario (1 de enero) en la zona del workspace |
| D207 | Q55 Ubicación en el Home | Se acepta (a): Sección "Metas y deudas" junto a la tarjeta de metas (docs/28 §3) |
| D208 | Q56 Supuesto de la fecha libre de deudas para tarjetas | Se acepta (a): Pagar el total facturado y no comprar más |
| D209 | Q57 Base de Q5 | Se acepta (a): ambas vistas: libre de compromisos como cifra principal y "según tu presupuesto" como segunda |
| D210 | Q58 Horizonte | Se acepta (a): periodo financiero que contiene hoy |
| D211 | Q59 Vencidos de periodos anteriores | Se acepta (a): restarlos |
| D212 | Q60 Pendientes con fecha anterior al periodo | Se acepta (a): Restar todas las pendientes de egreso con fecha ≤ fin del periodo |
| D213 | Q61 Tarjetas sin plan de pago | Se acepta (a): así, con aviso "N tarjetas sin pago programado" |
| D214 | Q62 Reserva mínima en otra moneda | Se acepta la recomendación: así. |
| D215 | Q63 Cuentas `SEMI_LIQUID` | Se acepta la recomendación: así. |
| D216 | Q64 Tope del reservado en el saldo de la cuenta | Se acepta (a): tope |
| D217 | Q65 Capability | Se acepta (a): `reporting/dashboard` |
| D218 | Q66 Aviso de disponible negativo | Se acepta la recomendación: no en Phase 4; el riesgo de déficit con alerta es FR-REPORTING-015 (Phase 7). |

No quedan preguntas del owner abiertas en los changes de Phase 4.
