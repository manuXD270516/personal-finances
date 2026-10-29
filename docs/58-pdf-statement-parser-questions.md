# 58: Preguntas del change de lectura de extractos PDF (add-pdf-statement-parser)

> **Estado:** Resuelto por el owner el 2026-10-29 (D347–D358, al final; adoptó todas las recomendaciones) · **Fecha:** 2026-10-29 · **Relacionado:** `docs/57-phase-6-consolidation-decisions.md` (D324, PR #189), [56-phase-6-consolidation-questions.md](56-phase-6-consolidation-questions.md) (pregunta 14), [statement-formats](statement-formats/README.md), change [`add-pdf-statement-parser`](../openspec/changes/add-pdf-statement-parser/proposal.md), [`add-import-pipeline`](../openspec/changes/add-import-pipeline/proposal.md), [`add-document-attachments`](../openspec/changes/add-document-attachments/proposal.md), [38-estado-y-pendientes.md](38-estado-y-pendientes.md)

Por D324 se abre el change 57: leer los extractos PDF con texto de los bancos del owner para cumplir el criterio de salida de Phase 6 (3 meses reales sin duplicados). El design adopta la recomendación de cada pregunta; se puede revertir antes de implementar el grupo que la usa. **[B]** marca las que bloquean: la 1 bloquea la tarea 3.4 y la 4 bloquea el archivado. Las respuestas irán en el siguiente doc de decisiones.

## Preguntas

### 1. [B: tarea 3.4] Qué pasa si los saldos del extracto no cuadran con los movimientos leídos

El lector verifica `saldo inicial + Σ movimientos = saldo final`, los totales por sección o columna, que se leyeron todas las páginas y que no quedaron líneas sin reconocer. Si algo no cuadra, casi seguro el lector perdió o leyó mal un movimiento.

- a) **Falla cerrada:** la importación queda en «falló la lectura» con `IMPORT_PDF_TOTALS_MISMATCH`, la diferencia y las páginas y líneas no reconocidas, sin filas. Se corrige el diseño (versión nueva) y se reintenta.
- b) Vista previa con una advertencia bloqueante: se puede aprobar solo con una confirmación explícita («acepto la diferencia de X BOB»), y la reconciliación final mostrará la diferencia.
- c) Solo advertencia, sin confirmación.

**Recomendación: a.** El criterio de salida es «sin duplicados» y sin movimientos perdidos; el usuario no puede reparar en la UI una fila que el lector no vio, y aprobar con diferencia deja un saldo erróneo que después hay que buscar a mano. La b se puede agregar más adelante si la a resulta demasiado estricta con los extractos reales.

### 2. BISA

La muestra de BISA no tiene movimientos: solo se conocen los encabezados de columna y la ficha dice que el parser no debe escribirse sin una muestra con actividad.

- a) **Fuera de este change** hasta que el owner comparta (solo en la conversación, D281) un extracto con al menos un depósito, un retiro, un interés y un cargo; entonces se agrega `bo.bisa.cuenta@1` con su fixture sintético.
- b) Un diseño solo para el caso «Sin actividad en el periodo» (útil para verificar el saldo, no importa movimientos).
- c) Un diseño especulativo a partir de los encabezados.

**Recomendación: a.** La b no aporta al criterio de salida y la c es una suposición (como D330 para las plantillas CSV).

### 3. BNB

La ficha advierte que el texto plano de BNB se desordena entre líneas. El design lo resuelve con coordenadas y el monto como ancla de cada fila, pero solo se validó con un fixture sintético que imita el desorden.

- a) **Se implementa en este change y se publica solo si el diagnóstico local (pregunta 9) sobre un extracto real de BNB da coherencia correcta;** si no, el diseño no se publica y la entidad queda `NOT_ELIGIBLE/UNSTABLE_FORMAT` en el catálogo.
- b) Sacar BNB de este change.
- c) Publicarlo sin validación real.

**Recomendación: a.** El costo de implementarlo es bajo (mismo motor con otra ancla) y la decisión de publicar se toma con evidencia.

### 4. [B: archivado] Prioridad y fase de FR-IMPORTS-016

docs/01 tiene FR-IMPORTS-016 (parsers de PDF por institución) como **Could de Phase 11**. D324 abrió el change en Phase 6 porque el criterio de salida depende de él; las requirements del change son Must salvo el saldo inicial contra la cuenta y el rendimiento (Should) y el diagnóstico (Could).

- a) **Must de Phase 6** en docs/01.
- b) Should de Phase 6.
- c) Mantener Could de Phase 11 y tratar este change como adelanto.

**Recomendación: a.** Es la única vía hoy para cumplir el criterio de salida con los extractos reales (no hay evidencia de CSV o XLS, docs/38 §2); si el owner confirma una exportación CSV/XLS de su banco, se puede bajar a Should.

### 5. Límites del lector

Tiempo máximo de extracción 30 s, 200 páginas, 300 000 fragmentos de texto y 4 MiB de texto, 192 MiB de memoria del hilo aislado, y una página con menos de 20 caracteres se considera «sin texto».

- a) **Aceptarlos** (configurables con `IMPORT_PDF_*`).
- b) Otros valores.

**Recomendación: a.** Un extracto mensual real tiene 1 a 6 páginas; 200 páginas cubren 5 000 movimientos (D329) con margen, y 192 MiB caben en el host de 2 GB con una extracción a la vez.

### 6. Misma biblioteca para la inspección de DOCUMENTS

`add-document-attachments` dejó abierta la biblioteca para inspeccionar la estructura del PDF (`pdf-lib` o `pdfjs-dist`). Este change elige `pdfjs-dist` (Apache-2.0, Mozilla, JS puro, sin binarios nativos) para extraer el texto.

- a) **Usar `pdfjs-dist` también en la inspección de DOCUMENTS** (una sola biblioteca de PDF que vigilar y actualizar).
- b) Que cada change elija la suya.

**Recomendación: a.** Menos superficie de CVE y una sola configuración endurecida (`isEvalSupported: false`, sin render, en un hilo con límites).

### 7. Extracto de otra cuenta

El lector compara los últimos 4 dígitos del número de cuenta del encabezado con los registrados en la cuenta destino.

- a) **Si difieren, la importación falla** con `IMPORT_PDF_ACCOUNT_MISMATCH`; si la cuenta no tiene dígitos registrados, sigue con la advertencia `IMPORT_PDF_ACCOUNT_UNVERIFIED`.
- b) Si difieren, solo una advertencia que exige confirmación.

**Recomendación: a.** Importar el extracto en la cuenta equivocada mueve saldos de dos cuentas; se corrige eligiendo la cuenta correcta. Recomendación anexa: registrar los últimos 4 dígitos en las cuentas bancarias del owner para que la verificación sea efectiva.

### 8. Anotaciones variables en las glosas de Ganadero

La ficha de Ganadero observa anotaciones de estado en las transferencias recibidas («Aún falta 350», «Completado»). No se sabe si el banco las recalcula al volver a descargar el mismo mes; si lo hace, la huella de la fila cambiaría y la re-importación mostraría posibles duplicados en vez de «ya importadas».

- a) **Declararlas como fragmentos variables** en `bo.ganadero.cuenta@1`: se quitan de la descripción usada en la huella (la transacción conserva la glosa completa).
- b) No declararlas hasta tener evidencia.

**Recomendación: a.** El costo es mínimo (dos movimientos iguales el mismo día se siguen distinguiendo por el ordinal) y evita falsos posibles duplicados en el criterio de salida.

### 9. Diagnóstico local de los extractos reales

Para validar los diseños con los PDF reales sin que entren al repositorio ni a la conversación, el change agrega (Could) `pnpm imports:pdf:probe <ruta>`, que imprime solo la estructura: diseño, páginas, filas reconocidas, líneas no reconocidas y coherencia `OK`/`MISMATCH`, sin montos, descripciones ni cuentas.

- a) **Incluirlo** y que el owner lo corra sobre un extracto de cada banco y comparta solo la salida.
- b) No incluirlo; el owner comparte de nuevo los PDF en la conversación (D281) cuando haya que validar.

**Recomendación: a.** Menos exposición de datos reales y el owner puede repetir la verificación cuando el banco cambie el formato.

### 10. PDF de tarjetas de crédito

Las fichas son de cajas de ahorro y cuentas corrientes. Los estados de cuenta de tarjeta tienen otro formato (cargos, pagos, cuotas, fecha de cierre).

- a) **Fuera de este change**; si el owner los necesita para los 3 meses, comparte una muestra y se hace la ficha y un diseño nuevo.
- b) Incluirlos sin muestra.

**Recomendación: a.**

### 11. ADR para la lectura de PDF no confiables

La elección de la biblioteca y del aislamiento está en el design del change.

- a) Solo en el design.
- b) **Un ADR corto «Lectura de PDF no confiables»** que fije la biblioteca, las opciones endurecidas y el aislamiento para DOCUMENTS y IMPORTS.

**Recomendación: b** si la respuesta a la pregunta 6 es a (afecta a dos contextos); si no, a.

### 12. Dónde se verifica el criterio de salida con los extractos reales

- a) **En el entorno del owner** (su stack local o el despliegue N1 cuando exista): importa los 3 meses, revisa que no haya duplicados, re-importa uno y registra el resultado en docs/38 sin datos.
- b) En CI con extractos reales cifrados.

**Recomendación: a.** La b contradice D255 y D281 (los extractos reales nunca entran al repositorio ni a CI).

## Notas

- Los TC-IMPORTS-STMT-001..005 (oráculo de los fixtures sintéticos del change 41) referencian requirements que no existen en `imports/import-pipeline` (advertencias R1 preexistentes de `pnpm traceability:check`). Este change reutiliza sus `expected.json` como oráculo del lector (TC-IMPORTS-PDF-045) pero no los toca; corregir su referencia queda para el cierre del change 41.

## Decisiones del owner (2026-10-29)

| ID | Pregunta | Decisión |
|---|---|---|
| D347 | 1. Qué pasa si los saldos del extracto no cuadran con los movimientos leídos | Se acepta la recomendación: a. El criterio de salida es «sin duplicados» y sin movimientos perdidos; el usuario no puede reparar en la UI una fila que el lector no vio, y aprobar con diferencia deja un saldo erróneo que después hay que buscar a mano. La b se puede agregar más adelante si la a resulta demasiado estricta con los extractos reales. |
| D348 | 2. BISA | Se acepta la recomendación: a. La b no aporta al criterio de salida y la c es una suposición (como D330 para las plantillas CSV). |
| D349 | 3. BNB | Se acepta la recomendación: a. El costo de implementarlo es bajo (mismo motor con otra ancla) y la decisión de publicar se toma con evidencia. |
| D350 | 4. Prioridad y fase de FR-IMPORTS-016 | Se acepta la recomendación: a. Es la única vía hoy para cumplir el criterio de salida con los extractos reales (no hay evidencia de CSV o XLS, docs/38 §2); si el owner confirma una exportación CSV/XLS de su banco, se puede bajar a Should. |
| D351 | 5. Límites del lector | Se acepta la recomendación: a. Un extracto mensual real tiene 1 a 6 páginas; 200 páginas cubren 5 000 movimientos (D329) con margen, y 192 MiB caben en el host de 2 GB con una extracción a la vez. |
| D352 | 6. Misma biblioteca para la inspección de DOCUMENTS | Se acepta la recomendación: a. Menos superficie de CVE y una sola configuración endurecida (`isEvalSupported: false`, sin render, en un hilo con límites). |
| D353 | 7. Extracto de otra cuenta | Se acepta la recomendación: a. Importar el extracto en la cuenta equivocada mueve saldos de dos cuentas; se corrige eligiendo la cuenta correcta. Recomendación anexa: registrar los últimos 4 dígitos en las cuentas bancarias del owner para que la verificación sea efectiva. |
| D354 | 8. Anotaciones variables en las glosas de Ganadero | Se acepta la recomendación: a. El costo es mínimo (dos movimientos iguales el mismo día se siguen distinguiendo por el ordinal) y evita falsos posibles duplicados en el criterio de salida. |
| D355 | 9. Diagnóstico local de los extractos reales | Se acepta la recomendación: a. Menos exposición de datos reales y el owner puede repetir la verificación cuando el banco cambie el formato. |
| D356 | 10. PDF de tarjetas de crédito | Se acepta la recomendación: a. |
| D357 | 11. ADR para la lectura de PDF no confiables | Se acepta la recomendación: b si la respuesta a la pregunta 6 es a (afecta a dos contextos); si no, a. |
| D358 | 12. Dónde se verifica el criterio de salida con los extractos reales | Se acepta la recomendación: a. La b contradice D255 y D281 (los extractos reales nunca entran al repositorio ni a CI). |
