# 34 — Preguntas abiertas al owner de la consolidación de Phase 3

> **Estado:** Resuelto por el owner el 2026-10-10 — decisiones D114–D151 en [35-phase-3-consolidation-decisions.md](35-phase-3-consolidation-decisions.md) · **Fecha:** 2026-10-09 · **Relacionado:** [03-openspec-strategy.md](03-openspec-strategy.md) §7 (orden de Phase 3), [24-roadmap.md](24-roadmap.md) §5.3, [33-phase-2-consolidation-decisions.md](33-phase-2-consolidation-decisions.md), changes de Phase 3 en `openspec/changes/`

Lista única y deduplicada de las preguntas abiertas de los `design.md` de los 5 changes de Phase 3. Cada pregunta trae opciones y la recomendación de los borradores. Las specs ya están escritas con la recomendación: si el owner la acepta, no hay que cambiarlas.

**Total: 38 preguntas. Bloqueantes: 9** (marcadas **[B]**): 1–3 (`add-recurrence-engine`, el 26, primero de Phase 3), 4 (`add-upcoming-payments` 27), 5–6 (`add-subscriptions` 28), 7–8 (`add-commitment-matching` 29) y 9 (`add-basic-csv-import` 30). Las demás se implementan con la recomendación si el owner no responde antes del grupo de tareas que las usa.

Resueltas en la consolidación (no se cuentan):
- **Quién une ocurrencias y transacciones pendientes** (UP 2): Commitments, en montos nativos, con `UpcomingPaymentsQuery` y `CommittedQuery` (el motor ya adoptó esos contratos); Reporting solo valora y presenta.
- **Definición de SM-07** (CM, UP 6): la define `add-upcoming-payments` (pagos que resolvieron una ocurrencia generada el mismo día del pago o después); matching la alimenta.
- **Campos que Subscriptions pide al motor** (SU N9 y otros): `managedBy` en `RecurringOccurrenceDue.v1` y `occurrenceDate`/`managedBy` en `RecurringOccurrenceMaterialized.v1`, ya incorporados.

Abreviaturas: RE = [`add-recurrence-engine`](../openspec/changes/add-recurrence-engine/design.md), CM = [`add-commitment-matching`](../openspec/changes/add-commitment-matching/design.md), SU = [`add-subscriptions`](../openspec/changes/add-subscriptions/design.md), UP = [`add-upcoming-payments`](../openspec/changes/add-upcoming-payments/design.md), CSV = [`add-basic-csv-import`](../openspec/changes/add-basic-csv-import/design.md).

## Bloqueantes

1. **[B] Aprobación pendiente vs. solo aviso.** Opciones: (a) `NOTIFY_ONLY` no entra en la bandeja de aprobación pero la ocurrencia se puede aprobar o vincular igual; (b) `NOTIFY_ONLY` solo avisa, sin acciones. **Recomendación:** (a). — RE 1 → **Decisión: [D114](35-phase-3-consolidation-decisions.md)**
2. **[B] Montos `VARIABLE` en el comprometido y en próximos pagos.** Opciones: (a) no suman y se informa "N pagos sin monto"; (b) suman el último monto pagado. **Recomendación:** (a). — RE 2, UP → **Decisión: [D115](35-phase-3-consolidation-decisions.md)**
3. **[B Phase 4] `LOAN_PAYMENT` y `CARD_PAYMENT`.** Opciones: (a) reservados en el contrato y rechazados con `RECURRING_KIND_NOT_AVAILABLE`; el pago de tarjeta de hoy se modela como `TRANSFER` a la cuenta pasivo (D27); (b) no exponerlos hasta Phase 4. **Recomendación:** (a). — RE 6 → **Decisión: [D116](35-phase-3-consolidation-decisions.md)**
4. **[B] Lectura directa o read model para próximos pagos.** Opciones: (a) leer los contratos de Commitments/Transactions/Ledger/FX en la transacción de lectura, como el Home actual (read-your-writes); (b) read model alimentado por eventos. **Recomendación:** (a); el volumen es pequeño. — UP 1 → **Decisión: [D117](35-phase-3-consolidation-decisions.md)**
5. **[B] Evento `SubscriptionPriceChanged.v1`.** Opciones: (a) un solo evento con `origin` (`DETECTED`/`MANUAL`/`CORRECTION`); aceptar una propuesta no lo vuelve a publicar; (b) eventos separados por origen. **Recomendación:** (a). — SU 1 → **Decisión: [D118](35-phase-3-consolidation-decisions.md)**
6. **[B] Doble aviso del mismo cobro (motor y suscripción).** Opciones: (a) NOTIFY omite el aviso genérico del motor para ocurrencias de suscripciones que no requieren aprobación y conserva el de "por aprobar"; (b) dos avisos. **Recomendación:** (a). — SU 2 → **Decisión: [D119](35-phase-3-consolidation-decisions.md)**
7. **[B] Tolerancias por omisión del matching.** `FIXED` ±2 %, `ESTIMATED` ±25 %, `MIN_MAX` ±5 % sobre el rango, ventana ±5 días. **Recomendación:** esas. — CM 1 → **Decisión: [D120](35-phase-3-consolidation-decisions.md)**
8. **[B Phase 6] Auto-confirmar sugerencias en imports.** Opciones: (a) nunca, el usuario siempre confirma; (b) con confianza alta. **Recomendación:** (a). — CM 2 → **Decisión: [D121](35-phase-3-consolidation-decisions.md)**
9. **[B] Importación CSV básica: ¿Phase 3 o Phase 6?** Es Could (FR-IMPORTS-003). Opciones: (a) último change de Phase 3, solo si los Must de la fase están terminados; si no, pasa intacto a Phase 6; (b) diferirla a Phase 6. **Recomendación:** (a); (b) si el owner empieza con saldos iniciales y no carga historia. — CSV 1 → **Decisión: [D122](35-phase-3-consolidation-decisions.md)**

## Motor de recurrencia

10. **"Esta y las siguientes" y ediciones individuales.** ¿Se descartan las ediciones hechas a ocurrencias futuras? **Recomendación:** sí, informando cuántas. — RE 3 → **Decisión: [D123](35-phase-3-consolidation-decisions.md)**
11. **Periodo de una ocurrencia.** Opciones: fecha nominal o vencimiento ajustado (fin de semana). **Recomendación:** vencimiento ajustado. — RE 4 → **Decisión: [D124](35-phase-3-consolidation-decisions.md)**
12. **Horizonte de generación.** **Recomendación:** 90 días, configurable por entorno (`COMMITMENTS_HORIZON_DAYS`), no por workspace. — RE 5 → **Decisión: [D125](35-phase-3-consolidation-decisions.md)**
13. **Destinatarios del aviso de pago próximo/por aprobar.** **Recomendación:** OWNER y EDITOR. — RE 7 → **Decisión: [D126](35-phase-3-consolidation-decisions.md)**
14. **Transferencias en el comprometido.** **Recomendación:** solo las de una cuenta líquida a una no líquida (p. ej. pago de tarjeta); entre líquidas no cuentan. Aplica igual en próximos pagos. — RE 8, UP → **Decisión: [D127](35-phase-3-consolidation-decisions.md)**
15. **Archivar definiciones terminadas.** **Recomendación:** no en Phase 3. — RE 9 → **Decisión: [D128](35-phase-3-consolidation-decisions.md)**
16. **Creación automática en periodo o cuenta cerrados.** **Recomendación:** la ocurrencia queda atrasada con el error visible; no se crea nada. — RE 10 → **Decisión: [D129](35-phase-3-consolidation-decisions.md)**
17. **Feriados.** **Recomendación:** fuera de Phase 3. — RE 11 → **Decisión: [D130](35-phase-3-consolidation-decisions.md)**
18. **Definiciones con inicio en el pasado.** **Recomendación:** generar desde el inicio del periodo financiero actual, no desde el inicio de la definición. — RE 12 → **Decisión: [D131](35-phase-3-consolidation-decisions.md)**

## Matching

19. **Sugerencias de confianza baja.** **Recomendación:** se muestran, con su confianza en texto. — CM 3 → **Decisión: [D132](35-phase-3-consolidation-decisions.md)**
20. **Pagos combinados o parciales.** **Recomendación:** fuera de Phase 3. — CM 4 → **Decisión: [D133](35-phase-3-consolidation-decisions.md)**
21. **Recorrido de ciclo de vida de la sugerencia.** **Recomendación:** no. — CM 5 → **Decisión: [D134](35-phase-3-consolidation-decisions.md)**
22. **Notificar sugerencias.** **Recomendación:** no; solo un contador en la UI. — CM 6 → **Decisión: [D135](35-phase-3-consolidation-decisions.md)**
23. **Re-proponer tras una edición compatible.** **Recomendación:** sí; las descartadas nunca. — CM 7 → **Decisión: [D136](35-phase-3-consolidation-decisions.md)**

## Suscripciones

24. **Detección de cambio de precio entre monedas.** **Recomendación:** detectar solo con el monto del extracto en la moneda del precio; el costo de una suscripción en USD se valora con el precio en USD por la tasa de hoy. — SU 3 → **Decisión: [D137](35-phase-3-consolidation-decisions.md)**
25. **Recorrido de ciclo de vida (D37).** **Recomendación:** sí, Should, máquina `Subscription`. — SU 4 → **Decisión: [D138](35-phase-3-consolidation-decisions.md)**
26. **Cancelación al fin del ciclo.** **Recomendación:** atributo, sin estado `pending_cancellation`. — SU 5 → **Decisión: [D139](35-phase-3-consolidation-decisions.md)**
27. **Estado `expired`.** **Recomendación:** fuera de Phase 3. — SU 6 → **Decisión: [D140](35-phase-3-consolidation-decisions.md)**
28. **Adoptar una definición recurrente existente.** **Recomendación:** no en este change. — SU 7 → **Decisión: [D141](35-phase-3-consolidation-decisions.md)**
29. **Cambiar la moneda del precio.** **Recomendación:** no; se cancela y se registra otra suscripción. — SU 8 → **Decisión: [D142](35-phase-3-consolidation-decisions.md)**
30. **Valores por defecto de recordatorios.** **Recomendación:** N = 3 días; renovación y fin de trial para OWNER, EDITOR y VIEWER; posible cambio de precio solo OWNER y EDITOR. — SU 9 → **Decisión: [D143](35-phase-3-consolidation-decisions.md)**
31. **Tolerancia de precio.** **Recomendación:** contra el precio vigente, estrictamente mayor que el límite (1.00 %), configurable por suscripción. — SU 10 → **Decisión: [D144](35-phase-3-consolidation-decisions.md)**

## Próximos pagos

32. **Compromisos en el plan mensual.** **Recomendación:** sección de solo lectura "Comprometido del periodo" por categoría, sin crear líneas, en un change posterior de `planning/budgets`. — UP 3 → **Decisión: [D145](35-phase-3-consolidation-decisions.md)**
33. **Vencidos de periodos anteriores en Q4.** **Recomendación:** se muestran aparte y no suman. — UP 4 → **Decisión: [D146](35-phase-3-consolidation-decisions.md)**
34. **Adelantar el saldo proyectado (FR-LEDGER-013) a Phase 3.** **Recomendación:** sí. — UP 5 → **Decisión: [D147](35-phase-3-consolidation-decisions.md)**
35. **Horizonte de la tarjeta Q8 del Home.** **Recomendación:** 7 días fijos, hasta 5 ítems, con enlace a la vista completa (30 días por defecto). — UP 7 → **Decisión: [D148](35-phase-3-consolidation-decisions.md)**

## Importación CSV básica (si entra en Phase 3)

36. **Estado y categoría de las transacciones importadas.** **Recomendación:** `POSTED` (no `CLEARED`), sin categoría; se categorizan después con la edición masiva. — CSV 2, 3 → **Decisión: [D149](35-phase-3-consolidation-decisions.md)**
37. **Transferencias propias en el extracto.** **Recomendación:** detectarlas como posible duplicado y advertir; no convertir filas en transferencias. — CSV 4 → **Decisión: [D150](35-phase-3-consolidation-decisions.md)**
38. **Límites, mapeo y recorrido.** **Recomendación:** 2 MiB y 5 000 filas; mapeo síncrono (plan B en el worker); solo auditoría del job en Phase 3, máquina de estados en Phase 6. — CSV 5, 6, 7 → **Decisión: [D151](35-phase-3-consolidation-decisions.md)**
