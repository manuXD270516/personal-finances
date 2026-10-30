# 57: Decisiones del owner de la consolidación de Phase 6

> **Fecha:** 2026-10-29 · **Relacionado:** [56-phase-6-consolidation-questions.md](56-phase-6-consolidation-questions.md) (pregunta N → D(310+N)), [03-openspec-strategy.md](03-openspec-strategy.md) §7

El owner respondió las 9 bloqueantes con la recomendación y aceptó en bloque las 27 restantes. Por D324 se abre un change nuevo de lectura de extractos PDF. Las specs ya estaban escritas con las recomendaciones.

| ID | Pregunta | Decisión |
|---|---|---|
| D311 | Q1 ¿La fila del benchmark del import con la configuración del host pasa a bloqueante? | Sí: la fila con la configuración del host bloquea el nightly; la de la concurrencia del código queda informativa. |
| D312 | Q2 Umbrales por consumidor de la fila de throughput con handler real (D300) | Se acepta la recomendación: preliminar: usar como umbral el drenado de la ráfaga del import (≤ 120 s por consumidor, configuración del host) y dejar el throughput sobre el backlog de 1,39 M del Large Seed como informativo, porque mide un estado que el producto no produce en uso real. |
| D313 | Q3 Descarga solo por la API (cambia FR-DOCUMENTS-004, NFR-SEC-012 y ADR-0009) | Solo por la API: cifrado de sobre de la aplicación y descarga en streaming, siempre como adjunto; se redacta un ADR nuevo que matiza ADR-0009. |
| D314 | Q4 Antimalware en Phase 6 | ClamAV como puerto y adapter apagado en producción (host de 2 GB) y encendido en la suite del nightly; los demás controles corren en producción. |
| D315 | Q5 Documentos en el export del workspace | Archivo aparte: metadatos y vínculos en el ZIP del export; los contenidos en un archivo opcional, restaurable de forma idempotente. D100 no cambia. |
| D316 | Q6 Endpoint público para la subida en producción | Se acepta (a): Hostname propio `PF_DOMAIN_FILES` en Caddy limitado a PUT firmados al bucket de cuarentena. |
| D317 | Q7 Límites por defecto | Se acepta (a): 15 MiB documentos, 20 MiB extractos a importar, tope duro 25 MiB, cuota 5 GiB por workspace, 20 subidas pendientes, 20 adjuntos por elemento. |
| D318 | Q8 Purga de documentos sin vínculo (FR-DOCUMENTS-007) | Se acepta (a): Se purgan los disponibles, sin vínculo y no archivados tras 30 días; la UI avisa y archivar los conserva. |
| D319 | Q9 PDF con contraseña | Se acepta (a): Rechazar los que exigen contraseña para abrirse; aceptar los que solo tienen contraseña de propietario. |
| D320 | Q10 Metadatos EXIF de imágenes (docs/12 §8.4, "propuesto") | Se acepta (a): Conservar el original |
| D321 | Q11 Tipos de destino | Se acepta (a): Los 7 de FR ahora; el CHECK se amplía cuando haya un uso. |
| D322 | Q12 (Para `add-import-pipeline`) Ruta multipart del CSV básico | Se acepta (a): Se conserva sin cambios y se marca `deprecated` cuando la UI use `documentId`. |
| D323 | Q13 XLS (Excel 97-2003) | Se acepta (a): Fuera; se reevalúa si un banco del owner solo exporta XLS (change 41, tarea pendiente del owner). |
| D324 | Q14 Extractos reales del owner en PDF | Se abre ya un change de lectura de extractos PDF con texto; en paralelo el owner confirma si su banco exporta CSV o XLS. |
| D325 | Q15 Candidatos de confianza baja | Se acepta (a): Siguen exigiendo decisión — el criterio de salida es «sin duplicados» y (b) crearía duplicados en silencio cuando el banco trunca glosas; la edición en lote reduce el costo. |
| D326 | Q16 Instante de referencia de una conversión importada sin hora | Se acepta (a): Fin del día de negocio — determinista, sin pedir datos que el extracto no tiene; la conversión muestra «referencia del día» y el usuario puede elegir otra referencia como en una conversión manual. |
| D327 | Q17 Ventana y tolerancia de duplicados para tarjetas | Se acepta (a): ±3 días y monto exacto para todas las cuentas — hasta tener extractos reales de tarjeta; es configuración, se cambia sin migración. |
| D328 | Q18 Deshacer con transacciones bloqueadas | Se acepta (a): Todo o nada por omisión con deshacer parcial explícito — . |
| D329 | Q19 Filas por importación | Se acepta (a): 5 000 — 3 meses de un banco son cientos de filas; subir el tope exige medir de nuevo la vista previa y la ráfaga de eventos. |
| D330 | Q20 Plantillas de perfiles de bancos bolivianos | Se acepta (a): Solo cuando el owner comparta un CSV o XLS exportable — una plantilla sin muestra real es una suposición. |
| D331 | Q21 Prioridad de XLSX | Se acepta la recomendación: mantener Could y subirla con esa evidencia. Nota: XLS binario (BIFF) no está en la lista de DOCUMENTS; se pediría exportar XLSX o CSV. |
| D332 | Q22 Ruta `multipart` del CSV básico | Se acepta la recomendación: conservarla y marcarla `deprecated` en OpenAPI cuando la UI use solo documentos (tarea 6.4); retirarla exige un change con versión mayor de la API. |
| D333 | Q23 Semántica de evaluación | Acumulativa, primer escritor gana por campo, con `stopProcessing`. |
| D334 | Q24 Qué cuenta como "clasificada por reglas" para el 70 % | Solo cuentan las transacciones con `category_origin = RULE` vigente; las corregidas a mano no suman. |
| D335 | Q25 Acciones de FR-RULES-005 fuera de Phase 6 | Se acepta (a): diferirlas a Phase 7 — , con nota en docs/01. |
| D336 | Q26 Reglas sobre transferencias y conversiones | Se acepta (a): fuera de Phase 6: el pipeline ofrece marcar la fila como transferencia a mano — para Phase 6; si en los 3 meses del owner esas filas pesan en el 25–30 % restante, se agrega (b) como change aparte. |
| D337 | Q27 Disparador de creación manual por defecto | Se acepta (a): las reglas nuevas no lo traen — . |
| D338 | Q28 Aplicación asíncrona posterior (ARCHITECTURE §7) | Se acepta (a): no hay aplicación asíncrona en Phase 6 — sin consumidor nuevo (D249) y sin cambiar lo aprobado. |
| D339 | Q29 Límites | Se acepta la recomendación: aceptarlos; son configurables (`RULES_*` en `@pf/platform`). |
| D340 | Q30 Ampliar el alcance a datos privados de exchanges | Empezar por los archivos de historial exportados por el owner (sin credenciales), compartidos solo en la conversación; la API privada después, con ADR-0031. |
| D341 | Q31 Qué exchanges y qué reportes | Binance y Bybit, con una exportación real de cada uno compartida en la conversación y nunca en el repositorio. |
| D342 | Q32 Custodia de la clave privada del worker | Se acepta (b): archivo montado con permisos 0400 fuera del repositorio — en N1 (no aparece en `docker inspect`), (c) en Phase 9. |
| D343 | Q33 Depósitos y retiros | Se acepta (a): ingreso o gasto con señal "posible transferencia" — ; (b) bloquearía imports por movimientos con wallets externas que no están en PFOS. |
| D344 | Q34 Recompensas y staking | Se acepta (a): ingreso "sin categoría de ingreso" clasificable por reglas — una categoría de sistema nueva es un cambio en `classification/categories` (FR-CLASSIFICATION-003) sin necesidad para el owner hoy. |
| D345 | Q35 Ventana máxima de la primera sincronización | Se acepta la recomendación: 365 días (`CONNECTION_SYNC_MAX_DAYS`), configurable. |
| D346 | Q36 Auto-aprobación | Se acepta la recomendación: no en Phase 6; siempre vista previa. |
