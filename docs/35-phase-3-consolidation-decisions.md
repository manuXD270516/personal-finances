# 35 — Decisiones del owner de la consolidación de Phase 3

> **Fecha:** 2026-10-10 · **Relacionado:** [34-phase-3-consolidation-questions.md](34-phase-3-consolidation-questions.md) (pregunta N → D(113+N)), [03-openspec-strategy.md](03-openspec-strategy.md) §7

El owner respondió las 9 bloqueantes y aceptó en bloque las recomendaciones de las 29 restantes. Única variación: en la pregunta 4 eligió la lectura directa pero pidió dejar documentado el modelo por eventos con métricas y alerta que indiquen cuándo aplicarlo (D117). Las specs ya estaban escritas con las recomendaciones; D117 agregó un requirement a `add-upcoming-payments`.

| ID | Pregunta | Decisión |
|---|---|---|
| D114 | Q1 Aprobación pendiente vs. solo aviso | Se acepta (a): `NOTIFY_ONLY` no entra en la bandeja de aprobación pero la ocurrencia se puede aprobar o vincular igual. |
| D115 | Q2 Montos `VARIABLE` en el comprometido y en próximos pagos | Se acepta (a): no suman y se informa "N pagos sin monto". |
| D116 | Q3 `LOAN_PAYMENT` y `CARD_PAYMENT` | Se acepta (a): reservados en el contrato y rechazados con `RECURRING_KIND_NOT_AVAILABLE`; el pago de tarjeta de hoy se modela como `TRANSFER` a la cuenta pasivo (D27). |
| D117 | Q4 Lectura directa o read model para próximos pagos | **Lectura directa** en Phase 3. El read model por eventos queda **documentado** en `add-upcoming-payments` (design.md § "Evolución a read model") con métricas de duración y volumen y la alerta `UpcomingPaymentsReadModelRecommended` (p95 > 300 ms durante 15 min o > 5 000 ocurrencias por consulta) que indica cuándo conviene migrar (requirement "Métricas y alerta para evolucionar a un read model", TC-REPORTING-UPCOMING-022). |
| D118 | Q5 Evento `SubscriptionPriceChanged.v1` | Se acepta (a): un solo evento con `origin` (`DETECTED`/`MANUAL`/`CORRECTION`); aceptar una propuesta no lo vuelve a publicar. |
| D119 | Q6 Doble aviso del mismo cobro (motor y suscripción) | Se acepta (a): NOTIFY omite el aviso genérico del motor para ocurrencias de suscripciones que no requieren aprobación y conserva el de "por aprobar". |
| D120 | Q7 Tolerancias por omisión del matching | Se acepta la recomendación: esas. |
| D121 | Q8 Auto-confirmar sugerencias en imports | Se acepta (a): nunca, el usuario siempre confirma. |
| D122 | Q9 Importación CSV básica: ¿Phase 3 o Phase 6? | Se acepta (a): último change de Phase 3, solo si los Must de la fase están terminados; si no, pasa intacto a Phase 6; (b) si el owner empieza con saldos iniciales y no carga historia. |
| D123 | Q10 "Esta y las siguientes" y ediciones individuales | Se acepta la recomendación: sí, informando cuántas. |
| D124 | Q11 Periodo de una ocurrencia | Se acepta la recomendación: vencimiento ajustado. |
| D125 | Q12 Horizonte de generación | Se acepta la recomendación: 90 días, configurable por entorno (`COMMITMENTS_HORIZON_DAYS`), no por workspace. |
| D126 | Q13 Destinatarios del aviso de pago próximo/por aprobar | Se acepta la recomendación: OWNER y EDITOR. |
| D127 | Q14 Transferencias en el comprometido | Se acepta la recomendación: solo las de una cuenta líquida a una no líquida (p. ej. pago de tarjeta); entre líquidas no cuentan. Aplica igual en próximos pagos. |
| D128 | Q15 Archivar definiciones terminadas | Se acepta la recomendación: no en Phase 3. |
| D129 | Q16 Creación automática en periodo o cuenta cerrados | Se acepta la recomendación: la ocurrencia queda atrasada con el error visible; no se crea nada. |
| D130 | Q17 Feriados | Se acepta la recomendación: fuera de Phase 3. |
| D131 | Q18 Definiciones con inicio en el pasado | Se acepta la recomendación: generar desde el inicio del periodo financiero actual, no desde el inicio de la definición. |
| D132 | Q19 Sugerencias de confianza baja | Se acepta la recomendación: se muestran, con su confianza en texto. |
| D133 | Q20 Pagos combinados o parciales | Se acepta la recomendación: fuera de Phase 3. |
| D134 | Q21 Recorrido de ciclo de vida de la sugerencia | Se acepta la recomendación: no. |
| D135 | Q22 Notificar sugerencias | Se acepta la recomendación: no; solo un contador en la UI. |
| D136 | Q23 Re-proponer tras una edición compatible | Se acepta la recomendación: sí; las descartadas nunca. |
| D137 | Q24 Detección de cambio de precio entre monedas | Se acepta la recomendación: detectar solo con el monto del extracto en la moneda del precio; el costo de una suscripción en USD se valora con el precio en USD por la tasa de hoy. |
| D138 | Q25 Recorrido de ciclo de vida (D37) | Se acepta la recomendación: sí, Should, máquina `Subscription`. |
| D139 | Q26 Cancelación al fin del ciclo | Se acepta la recomendación: atributo, sin estado `pending_cancellation`. |
| D140 | Q27 Estado `expired` | Se acepta la recomendación: fuera de Phase 3. |
| D141 | Q28 Adoptar una definición recurrente existente | Se acepta la recomendación: no en este change. |
| D142 | Q29 Cambiar la moneda del precio | Se acepta la recomendación: no; se cancela y se registra otra suscripción. |
| D143 | Q30 Valores por defecto de recordatorios | Se acepta la recomendación: N = 3 días; renovación y fin de trial para OWNER, EDITOR y VIEWER; posible cambio de precio solo OWNER y EDITOR. |
| D144 | Q31 Tolerancia de precio | Se acepta la recomendación: contra el precio vigente, estrictamente mayor que el límite (1.00 %), configurable por suscripción. |
| D145 | Q32 Compromisos en el plan mensual | Se acepta la recomendación: sección de solo lectura "Comprometido del periodo" por categoría, sin crear líneas, en un change posterior de `planning/budgets`. |
| D146 | Q33 Vencidos de periodos anteriores en Q4 | Se acepta la recomendación: se muestran aparte y no suman. |
| D147 | Q34 Adelantar el saldo proyectado (FR-LEDGER-013) a Phase 3 | Se acepta la recomendación: sí. |
| D148 | Q35 Horizonte de la tarjeta Q8 del Home | Se acepta la recomendación: 7 días fijos, hasta 5 ítems, con enlace a la vista completa (30 días por defecto). |
| D149 | Q36 Estado y categoría de las transacciones importadas | Se acepta la recomendación: `POSTED` (no `CLEARED`), sin categoría; se categorizan después con la edición masiva. |
| D150 | Q37 Transferencias propias en el extracto | Se acepta la recomendación: detectarlas como posible duplicado y advertir; no convertir filas en transferencias. |
| D151 | Q38 Límites, mapeo y recorrido | Se acepta la recomendación: 2 MiB y 5 000 filas; mapeo síncrono (plan B en el worker); solo auditoría del job en Phase 3, máquina de estados en Phase 6. |

No quedan preguntas del owner abiertas en los changes de Phase 3.
