# 32 — Preguntas abiertas al owner de la consolidación de Phase 2

> **Estado:** Pendiente de respuesta del owner · **Fecha:** 2026-10-05 · **Relacionado:** [03-openspec-strategy.md](03-openspec-strategy.md) §7 (orden de Phase 2), [31-phase-1-consolidation-decisions.md](31-phase-1-consolidation-decisions.md), changes de Phase 2 en `openspec/changes/`

Lista única y deduplicada de las preguntas abiertas de los `design.md` de los 11 changes de Phase 2. Cada pregunta trae contexto, opciones y la recomendación de los borradores (conciliada cuando había varias). Las specs ya están escritas con la recomendación: si el owner la acepta, no hay que cambiarlas.

**Total: 52 preguntas. Bloqueantes: 13** (marcadas **[B]**), porque impiden empezar un change en el orden de implementación: 1–6 (`add-financial-periods`, el 13, primero de Phase 2); 7 (alcance de la edición en periodos cerrados: `add-custom-fields` 14, `add-reconciliation` 15, `add-bulk-edit` 20); 16 (`add-reconciliation` 15); 8 y 49 (`add-month-closing` 18); 41, 42 y 50 (`add-workspace-export` 23). Las otras 39 no bloquean: se implementan con la recomendación si el owner no responde antes del grupo de tareas que las usa.

Resueltas en la consolidación (no se cuentan): orden reconciliación → cierre (P-A9), hook de periodo creado (templates 1), hecho de cierre pendiente (alertas 4) y serie de patrimonio por periodo financiero (patrimonio 1). Ver [03 §7](03-openspec-strategy.md#7-plan-de-changes).

Abreviaturas de las referencias: FP = [`add-financial-periods`](../openspec/changes/add-financial-periods/design.md), MC = [`add-month-closing`](../openspec/changes/add-month-closing/design.md), RC = [`add-reconciliation`](../openspec/changes/add-reconciliation/design.md), BU = [`add-budgets`](../openspec/changes/add-budgets/design.md), BT = [`add-budget-templates`](../openspec/changes/add-budget-templates/design.md), AL = [`add-alerts`](../openspec/changes/add-alerts/design.md), BE = [`add-bulk-edit`](../openspec/changes/add-bulk-edit/design.md), CF = [`add-custom-fields`](../openspec/changes/add-custom-fields/design.md), GA = [`add-global-audit-view`](../openspec/changes/add-global-audit-view/design.md), NW = [`add-net-worth-evolution`](../openspec/changes/add-net-worth-evolution/design.md), WE = [`add-workspace-export`](../openspec/changes/add-workspace-export/design.md). Todas apuntan a la sección "Preguntas abiertas" de su `design.md`.

## Periodos y cierre

1. **[B] Etiqueta del periodo con día de inicio ≠ 1.** El periodo del 2026-10-25 al 2026-11-24, ¿es "2026-10" o "2026-11"? Opciones: (a) mes de inicio; (b) mes de fin. **Recomendación:** (a), determinista e igual al mes calendario con día 1. — FP P-A1
2. **[B] Varios periodos `active` pendientes de cierre.** FR-PLANNING-002 dice "un solo active que contenga hoy". Opciones: (a) permitir varios `active` terminados marcados "pendiente de cierre"; (b) estado extra `pending_close`. **Recomendación:** (a). — FP P-A2
3. **[B] Cambio del día de inicio con planes en periodos futuros.** Opciones: (a) recalcular los `draft` conservando identidad y plan; (b) bloquear el cambio si algún `draft` tiene plan. **Recomendación:** (a). — FP P-A3
4. **[B] Fecha mínima de planificación.** Un asiento muy antiguo crea periodos hacia atrás mientras no haya cierres. Opciones: (a) cobertura automática desde el asiento más antiguo; (b) setting `planningStartDate`. **Recomendación:** (a) en Phase 2; (b) en un change posterior si molesta. — FP P-A4
5. **[B] Anticipación por defecto.** Opciones: 1, 3 o más periodos `draft` futuros. **Recomendación:** 3, configurable por entorno (`PLANNING_PERIOD_LOOKAHEAD`), no por workspace. — FP P-A5
6. **[B] Provisión de los periodos iniciales.** Opciones: (a) asíncrona (consumidor de `WorkspaceCreated` + cron); (b) síncrona como el catálogo (D54). **Recomendación:** (a); (b) es posible sin cambiar specs. — FP P-A6
7. **[B] Alcance de la edición en periodos cerrados (extensión de D49).** D49 solo rechaza recategorizar. Opciones: (a) rechazar también tags, contraparte, custom fields y `clear`/`unclear`/`reconcile`/`unreconcile`, permitir notas, descripción, adjuntos y medio de pago; (b) solo categoría. **Recomendación:** (a), ya escrita una sola vez en el requirement "Alcance de la edición en periodos cerrados" de `planning/month-closing`. — MC P-A13, RC 1, BE 1, CF 2
8. **[B] ¿Las cuentas sin conciliar bloquean el cierre?** (docs/01 pregunta 5). Opciones: (a) bloqueante por defecto y configurable por el OWNER; (b) advertencia. **Recomendación:** (a), igual para transacciones `pending` (lo exige el criterio de salida). — MC P-A8
9. **Reapertura por EDITOR** (docs/10 pregunta 8). Opciones: (a) solo OWNER; (b) también EDITOR. **Recomendación:** (a); el EDITOR cierra. — MC P-A10
10. **Reapertura en cascada** (docs/04 pregunta 3). Opciones: (a) sin cascada, en orden inverso (`PERIOD_NEXT_CLOSED`); (b) cascada automática. **Recomendación:** (a). — MC P-A11
11. **Transacciones `pending` con fecha en un periodo cerrado.** No tocan el ledger pero nunca podrían postearse. Opciones: (a) rechazar crearlas o editarlas con `PERIOD_CLOSED`; (b) permitirlas. **Recomendación:** (a), como requirement nuevo de `transactions/transaction-recording`. — MC P-A12
12. **Cerrar antes del fin del periodo.** Opciones: (a) nunca (`PERIOD_NOT_ENDED`); (b) desde el último día. **Recomendación:** (a): el día aún puede recibir movimientos. — MC P-A14
13. **Cuentas exentas de conciliación (efectivo, inversiones manuales).** Opciones: (a) sin exenciones en Phase 2; (b) marca por cuenta "excluir del checklist". **Recomendación:** (a); (b) en un change posterior. — MC P-A15
14. **Definición de "sin categoría".** **Recomendación:** porciones posteadas con `UNCATEGORIZED`/`UNCATEGORIZED_INCOME` (D9); transferencias y conversiones no cuentan. — MC P-A16
15. **Patrimonio del snapshot sin tasa.** Opciones: (a) snapshot `complete: false` con montos sin convertir, sin bloquear; (b) ítem del checklist. **Recomendación:** (a) con aviso informativo; misma política de tasa que `reporting/net-worth` (D29/D48/D53). — MC P-A17

## Conciliación

16. **[B] Marcado directo `reconciled` sin sesión.** Opciones: (a) retirarlo (`RECONCILIATION_SESSION_REQUIRED`); (b) conservarlo como "reconciliación sin extracto". **Recomendación:** (a): `reconciled` = cotejado contra un extracto. — RC 2
17. **Ajuste categorizado.** ¿El ajuste puede ir a una categoría (p. ej. "Comisiones")? **Recomendación:** no en Phase 2 (FR-TRANSACTIONS-017 manda `EQUITY:ADJUSTMENTS`); registrar el gasto y volver a finalizar. — RC 3
18. **Conciliar cuentas `CLOSED`.** Opciones: (a) no; (b) solo con diferencia 0, sin ajuste. **Recomendación:** (a); se concilia antes de cerrar la cuenta. — RC 4
19. **`RECONCILED` de Phase 1 sin sesión.** Opciones: (a) dejarlas como "reconciliadas sin extracto"; (b) devolverlas a `cleared` con migración auditada. **Recomendación:** (a), no reescribir historia. — RC 5

## Presupuestos y plantillas

20. **Planes multi-moneda.** docs/04/08 preveían uno por `(periodo, moneda)`. **Recomendación:** uno por periodo en moneda base en Phase 2; la columna `currency` permite relajarlo con un *expand*. — BU 1
21. **Cambio de moneda base con planes y templates existentes.** **Recomendación:** los planes conservan su moneda y convierten el gastado; al aplicar un template, omitir líneas de otra moneda (`CURRENCY_MISMATCH`) sin convertir montos planificados; no bloquear el cambio. — BU 2, BT 3
22. **Varios umbrales cruzados a la vez.** Opciones: (a) un hecho con el más alto + `alsoCrossed`; (b) un hecho por umbral y NOTIFY agrupa. **Recomendación:** (a). — BU 3
23. **Umbrales en líneas de mínimo e ingresos.** **Recomendación:** sin umbrales en Phase 2; avisos de "mínimo no alcanzado" con los insights de Phase 7. — BU 4
24. **Umbrales con gastado incompleto (sin tasa).** **Recomendación:** evaluar con la parte convertida y reevaluar con `fx.RateRecorded.v1`; nunca 1:1. — BU 5
25. **Proyección lineal en líneas fijas** (un alquiler del día 1 proyecta 30×). Opciones: (a) proyección solo en `MAXIMUM`/`RANGE`/`PERCENT_OF_INCOME`, "pendiente/cumplido" en `FIXED`/`MINIMUM`; (b) fórmula lineal para todas (texto literal de FR-PLANNING-024, especificado hoy). **Recomendación:** (a). — BU 8
26. **"Guardar plan como template" y propagar desde un plan sin template.** **Recomendación:** rechazar con `BUDGET_NO_TEMPLATE_ORIGIN` y ofrecer en la UI "crear template con estas líneas" (`createTemplate`, sin endpoint nuevo). — BT 2
27. **Líneas quitadas del template al propagar.** **Recomendación:** quitarlas de los planes futuros en borrador solo si no fueron modificadas a mano (si lo fueron, conflicto). — BT 4
28. **Periodo de referencia al propagar desde el template.** **Recomendación:** periodos en borrador con inicio posterior a hoy en la zona del workspace. — BT 6

## Alertas y correo

29. **Proveedor de email de producción.** **Recomendación:** elegirlo en el change de despliegue con un ADR corto (relay SMTP + API HTTP con `Idempotency-Key`, plan gratuito); mientras tanto producción con `EMAIL_DRIVER=none` (solo in-app). — AL 1
30. **Email activado por defecto.** **Recomendación:** activado para ambos tipos, con detalles desactivados. — AL 2
31. **VIEWER como destinatario de umbrales.** **Recomendación:** sí; el cierre pendiente solo OWNER/EDITOR. — AL 3
32. **Aviso de violación de invariante (FR-NOTIFY-004).** **Recomendación:** change posterior cuando el job de integridad publique `ledger.IntegrityViolationDetected.v1`; tipo `CRITICAL` que ignora el horario de silencio. — AL 5
33. **Filtro de email por umbral.** **Recomendación:** no en Phase 2 (solo activar/desactivar por tipo y canal). — AL 6
34. **Auditar lectura/archivo de notificaciones.** **Recomendación:** no; sí los cambios de preferencias. — AL 7
35. **Retención de notificaciones.** **Recomendación:** 12 meses (docs/08 §13.1) para todas, archivadas incluidas. — AL 8

## Edición masiva y campos personalizados

36. **`BEST_EFFORT` y ejecución asíncrona de más de 500 ítems.** **Recomendación:** no en Phase 2; evaluar con imports (Phase 6). — BE 2
37. **Deshacer una edición masiva.** **Recomendación:** no en Phase 2; la auditoría por `bulkOperationId` permite revertir con otra edición masiva. — BE 3
38. **Tipos `MULTI_SELECT` y `MONEY` de custom fields.** **Recomendación:** no en Phase 2 (`MULTI_SELECT` ≈ tags; `MONEY` exige moneda y escala). — CF 1
39. **Custom fields en transferencias y conversiones.** **Recomendación:** no en Phase 2; valor de cabecera en un change posterior si hace falta. — CF 3

## Export/import

40. **Cifrado del archivo descargado con frase del usuario.** **Recomendación:** no en Phase 2 (docs/30 §11: Phase 7+); descarga por HTTPS con advertencia en la UI. — WE 2
41. **[B] Importar un export de workspace demo.** Opciones: (a) rechazar con `EXPORT_FORMAT_UNSUPPORTED`; (b) importar como no demo con confirmación. **Recomendación:** (a) (D36). — WE 3
42. **[B] Atomicidad del import con volúmenes grandes.** Opciones: (a) una transacción, límite 200 MB; (b) lotes + purga con la función de ADR-0026. **Recomendación:** (a) en Phase 2. — WE 4
43. **Preservar IDs al restaurar en una instancia nueva.** **Recomendación:** no; siempre remapear (un solo camino probado). — WE 5
44. **Retención del export.** Opciones: 7 días (docs/30) o 24 h. **Recomendación:** 7 días configurable, con eliminación anticipada. — WE 6

## Reportes y auditoría

45. **Historia de `includeInNetWorth`.** **Recomendación:** valor vigente para toda la serie con aviso en la UI; los periodos cerrados usan el valor congelado en su snapshot. — NW 2
46. **Ubicación del gráfico de patrimonio.** **Recomendación:** tarjeta compacta en el Home (6 periodos) con enlace a la vista completa (12). — NW 3
47. **¿EDITOR usa la vista global de auditoría?** FR-AUDIT-006 dice solo OWNER; D28 y docs/10 permiten leer a EDITOR. **Recomendación:** consulta para OWNER y EDITOR; export CSV solo OWNER. — GA 1
48. **Auditar fallos de autorización de no miembros.** **Recomendación:** sí, en el workspace objetivo, con límite de 1 registro por minuto. — GA 2

## Decisiones de arquitectura/ADR

49. **[B] ADR-0028: bloqueo del ledger por el rango del periodo financiero** (enmienda D10). Opciones: (a) aceptar; (b) prohibir cerrar con día de inicio ≠ 1 (Opción 2 del ADR). **Recomendación:** (a). — MC P-A7, [ADR-0028](adr/0028-bloqueo-del-ledger-por-rango-del-periodo-financiero.md)
50. **[B] Capability `identity/workspace-portability`.** Opciones: (a) capability nueva (ya en ARCHITECTURE §14 y docs/01); (b) mantener FR-IDENTITY-010 en `identity/workspace-membership`. **Recomendación:** (a). — WE 1
51. **Ubicación de la valoración de flujos.** Opciones: (a) extraer `FlowValuation` al shared-kernel; (b) query nueva en `@pf/reporting/contracts`. **Recomendación:** (a): (b) crea un ciclo Planning ↔ Reporting en Phase 7. — BU 7
52. **Recorrido de ciclo de vida (D37) para planes y templates.** **Recomendación:** no declarar máquina para `Budget` (sigue al periodo) ni para templates en este change; historia en el audit log; un change pequeño de `audit/lifecycle-timeline` si el owner lo pide. — BU 6, BT 5
