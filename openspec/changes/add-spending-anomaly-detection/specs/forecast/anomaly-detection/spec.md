## ADDED Requirements

### Requirement: Gastos atípicos para su categoría
El sistema DEBE (MUST) marcar como atípica la porción de un gasto cuyo monto en la moneda de reporte, comparado con las porciones de gasto de la misma categoría de los 365 días anteriores a su fecha (sin contarse a sí misma), cumpla a la vez: puntaje robusto 0.6745 × (monto − mediana) / MAD de al menos 3.5 y monto de al menos 3 veces la mediana, donde MAD es la mediana de las desviaciones absolutas respecto de la mediana. Con MAD igual a cero DEBE (MUST) bastar la segunda condición. Con menos de 8 porciones de historia en la categoría, la porción NO DEBE (MUST NOT) evaluarse por categoría. Los cálculos DEBEN (MUST) hacerse con Decimal y los valores mostrados redondearse con HALF_EVEN.
Trace: FR-FORECAST-010, NFR-DATA-001, NFR-DATA-002 · Priority: Should

#### Scenario: Cena muy por encima de lo habitual
- **CUANDO** "Restaurantes" tiene 12 gastos en los 365 días anteriores con mediana 80.00 BOB y MAD 7.50 BOB y el 2026-11-12 se registra un gasto de 304.00 BOB en "Restaurantes"
- **ENTONCES** el gasto queda marcado como atípico por categoría con 3.8 veces la mediana de "Restaurantes"

#### Scenario: Alto pero no tanto
- **CUANDO** con la misma historia se registra un gasto de 200.00 BOB en "Restaurantes"
- **ENTONCES** el gasto no se marca: el puntaje robusto supera 3.5 pero el monto es 2.5 veces la mediana

#### Scenario: Historia insuficiente
- **CUANDO** "Regalos" tiene 5 gastos en los 365 días anteriores y se registra un gasto de 900.00 BOB en "Regalos"
- **ENTONCES** el gasto no se evalúa por categoría

#### Scenario: Montos siempre iguales
- **CUANDO** "Lavandería" tiene 10 gastos de 40.00 BOB en los 365 días anteriores y se registra uno de 132.00 BOB
- **ENTONCES** el gasto queda marcado como atípico por categoría con 3.3 veces la mediana

### Requirement: Gastos atípicos para su contraparte
El sistema DEBE (MUST) aplicar el mismo criterio a cada gasto con contraparte, con el monto total del gasto en la moneda de reporte comparado con los gastos con esa contraparte de los 365 días anteriores, con el mismo mínimo de 8 gastos de historia. Un gasto atípico por categoría y por contraparte DEBE (MUST) quedar como un solo gasto atípico con los dos motivos.
Trace: FR-FORECAST-010 · Priority: Should

#### Scenario: Atípico por contraparte y por categoría
- **CUANDO** los 10 gastos con "Pizzería Demo" de los 365 días anteriores tienen mediana 95.00 BOB y MAD 10.00 BOB y el gasto de 304.00 BOB en "Restaurantes" es con "Pizzería Demo"
- **ENTONCES** hay un solo gasto atípico con dos motivos: 3.8 veces la mediana de "Restaurantes" y 3.2 veces la mediana de "Pizzería Demo"

### Requirement: Contraparte nueva con monto alto
El sistema DEBE (MUST) marcar como atípico un gasto cuya contraparte no tiene gastos en los 365 días anteriores y cuyo monto en la moneda de reporte es al menos el percentil 95 (por rango más cercano) de todos los gastos del workspace de esos 365 días, cuando ese periodo tiene al menos 8 gastos. Un gasto sin contraparte NO DEBE (MUST NOT) evaluarse con este criterio.
Trace: FR-FORECAST-010 · Priority: Should

#### Scenario: Compra grande con una tienda desconocida
- **CUANDO** el percentil 95 de los gastos de los 365 días anteriores es 900.00 BOB y el 2026-11-14 se registra un gasto de 1450.00 BOB con "Tienda Online Nueva", sin gastos previos
- **ENTONCES** el gasto queda marcado como atípico por contraparte nueva con monto alto

#### Scenario: Contraparte nueva con monto común
- **CUANDO** con el mismo percentil se registra un gasto de 120.00 BOB con otra contraparte nueva
- **ENTONCES** el gasto no se marca

### Requirement: Gastos que se evalúan
Solo DEBEN (MUST) evaluarse los gastos en estado posteado, conciliado o reconciliado, no anulados, no administrados por otro módulo (préstamos, cargos de tarjeta o metas) y no vinculados a una ocurrencia de un compromiso; cada porción de un gasto con varias porciones DEBE (MUST) evaluarse en su categoría, y las porciones en «sin categoría» NO DEBEN (MUST NOT) evaluarse por categoría. Un gasto en otra moneda DEBE (MUST) convertirse a la moneda de reporte con la tasa de su fecha; sin tasa disponible NO DEBE (MUST NOT) evaluarse. Ingresos, reembolsos, transferencias y conversiones NO DEBEN (MUST NOT) evaluarse.
Trace: FR-FORECAST-010, FR-FORECAST-003 · Priority: Should

#### Scenario: Gasto en dólares
- **CUANDO** se registra un gasto de 50.00 USD en "Restaurantes" el 2026-11-12, la tasa USD/BOB de esa fecha es 6.96 y la historia de "Restaurantes" tiene mediana 80.00 BOB y MAD 7.50 BOB
- **ENTONCES** el gasto se evalúa como 348.00 BOB y queda marcado con 4.4 veces la mediana

#### Scenario: Pago de una suscripción y cuota de préstamo
- **CUANDO** el pago de la suscripción "Streaming" quedó vinculado a su ocurrencia y la cuota de un préstamo es una transacción administrada por Deudas
- **ENTONCES** ninguna de las dos se evalúa

#### Scenario: Gasto sin tasa
- **CUANDO** se registra un gasto de 30.00 USDT y no hay tasa USDT/BOB para su fecha
- **ENTONCES** el gasto no se evalúa y no queda marcado

### Requirement: Motivo explicable de cada gasto atípico
Cada gasto atípico DEBE (MUST) mostrar, por cada motivo, el criterio (categoría, contraparte o contraparte nueva), la referencia (mediana o percentil 95 en la moneda de reporte), la cantidad de gastos de historia y, por categoría y contraparte, cuántas veces la mediana es el monto con un decimal; el texto DEBE (MUST) generarse por plantilla, sin modelos de lenguaje, y NO DEBE (MUST NOT) presentar la marca como un error o un fraude confirmado.
Trace: FR-FORECAST-010, FR-FORECAST-004 · Priority: Should

#### Scenario: Texto del motivo
- **CUANDO** un gasto de 304.00 BOB en "Restaurantes" es atípico frente a una mediana de 80.00 BOB sobre 12 gastos
- **ENTONCES** el motivo dice que el gasto es 3,8 veces la mediana de "Restaurantes" (80,00 BOB en los últimos 12 meses, 12 gastos) con los formatos de es-BO

### Requirement: Detección diaria sin depender del servicio de pronósticos
La detección DEBE (MUST) correr en el trabajo diario de pronósticos sobre los gastos con fecha en los últimos 7 días hasta hoy, en la zona del workspace, que no se hayan evaluado en su versión vigente, de a un workspace por vez; DEBE (MUST) funcionar con el servicio de pronósticos apagado y con los pronósticos deshabilitados en la instalación, y DEBE (MUST) poder deshabilitarse por separado. NO DEBE (MUST NOT) consumir eventos ni sumar consumidores o conexiones al presupuesto vigente, y la falla de la detección en un workspace NO DEBE (MUST NOT) impedir las corridas de pronóstico ni la detección en los demás.
Trace: FR-FORECAST-010, FR-FORECAST-006, NFR-REL-010 · Priority: Must

#### Scenario: Pronósticos deshabilitados
- **CUANDO** la instalación tiene los pronósticos deshabilitados y la detección habilitada, y el 2026-11-12 se registró un gasto atípico
- **ENTONCES** el trabajo diario del 2026-11-13 marca ese gasto y no crea corridas de pronóstico

#### Scenario: Gasto registrado tarde
- **CUANDO** el 2026-11-13 se registra un gasto atípico con fecha 2026-11-09
- **ENTONCES** el trabajo diario del 2026-11-14 lo evalúa y lo marca

#### Scenario: Presupuesto de conexiones intacto
- **CUANDO** el worker arranca con la plantilla del host y la detección habilitada
- **ENTONCES** la cantidad de consumidores y las conexiones validadas al arrancar son las mismas que sin la detección

### Requirement: La detección nunca bloquea ni modifica transacciones
La detección NO DEBE (MUST NOT) bloquear, demorar ni rechazar el registro, la edición, la importación o la anulación de una transacción, ni modificar sus datos, su estado o sus asientos; marcar o descartar un gasto atípico NO DEBE (MUST NOT) cambiar ninguna cifra del Home, los reportes, los presupuestos ni los pronósticos.
Trace: FR-FORECAST-010, FR-FORECAST-006 · Priority: Must

#### Scenario: Gasto atípico registrado
- **CUANDO** un EDITOR registra un gasto de 304.00 BOB que la detección marcará como atípico
- **ENTONCES** el gasto se registra como cualquier otro y su versión, su estado y sus asientos no cambian al marcarse

### Requirement: Lista de gastos atípicos y marca en la transacción
Todo miembro del workspace DEBE (MUST) poder ver la lista de gastos atípicos abiertos, del más reciente al más antiguo, con la fecha, el monto, la categoría, la contraparte y los motivos, filtrable por estado y por rango de fechas, y la marca de atípico con su motivo en el listado y el detalle de cada transacción marcada.
Trace: FR-FORECAST-010 · Priority: Should

#### Scenario: Lista con dos gastos atípicos
- **CUANDO** "W1" tiene dos gastos atípicos abiertos del 2026-11-12 y del 2026-11-14 y un VIEWER abre la lista
- **ENTONCES** ve primero el del 2026-11-14 y luego el del 2026-11-12, cada uno con sus motivos

#### Scenario: Marca en el detalle
- **CUANDO** un miembro abre el detalle del gasto de 304.00 BOB marcado como atípico
- **ENTONCES** el detalle muestra la marca de atípico con el motivo y el enlace a la lista

### Requirement: Descartar y restaurar un gasto atípico
El OWNER o EDITOR DEBE (MUST) poder descartar un gasto atípico («no es atípico») con un motivo opcional y restaurarlo; un gasto descartado NO DEBE (MUST NOT) mostrarse entre los abiertos ni marcarse otra vez en la misma versión de la transacción; repetir un descarte o una restauración DEBE (MUST) ser inocuo.
Trace: FR-FORECAST-010 · Priority: Should

#### Scenario: Descarte de un falso positivo
- **CUANDO** el EDITOR descarta el gasto atípico de 304.00 BOB con el motivo «gasto puntual esperado»
- **ENTONCES** deja de figurar entre los abiertos, figura entre los descartados con quien lo descartó y la fecha, y la marca no se muestra en la transacción

#### Scenario: Restaurar
- **CUANDO** el EDITOR restaura ese gasto descartado
- **ENTONCES** vuelve a figurar entre los abiertos con su marca

### Requirement: Cambios de la transacción después de la detección
Si la transacción de un gasto atípico se anula, su gasto atípico NO DEBE (MUST NOT) mostrarse. Si se edita dentro de la ventana de evaluación, el gasto atípico anterior DEBE (MUST) quedar reemplazado y la versión nueva DEBE (MUST) evaluarse otra vez; si se edita después, el gasto atípico DEBE (MUST) indicar que la transacción cambió desde la detección.
Trace: FR-FORECAST-010 · Priority: Should

#### Scenario: Monto corregido
- **CUANDO** el gasto atípico de 304.00 BOB del 2026-11-12 se corrige el 2026-11-13 a 30.40 BOB
- **ENTONCES** el trabajo diario del 2026-11-14 reemplaza el gasto atípico anterior y no marca la versión nueva

#### Scenario: Gasto anulado
- **CUANDO** se anula la transacción de un gasto atípico abierto
- **ENTONCES** la lista y la transacción dejan de mostrarlo

### Requirement: Permisos, auditoría y aislamiento de los gastos atípicos
Ver la lista DEBE (MUST) estar permitido a todo miembro; descartar y restaurar, solo al OWNER y al EDITOR (403 para el VIEWER). Cada descarte y restauración DEBE (MUST) auditarse con el actor, el valor anterior y el nuevo. Los gastos atípicos DEBEN (MUST) quedar aislados por workspace con seguridad a nivel de fila forzada: un gasto atípico de otro workspace DEBE (MUST) responderse como inexistente (404 `RESOURCE_NOT_FOUND`).
Trace: FR-FORECAST-010, FR-IDENTITY-006, FR-AUDIT-001, NFR-SEC-003 · Priority: Must

#### Scenario: VIEWER intenta descartar
- **CUANDO** un VIEWER intenta descartar un gasto atípico
- **ENTONCES** se rechaza con 403 y el gasto atípico sigue abierto

#### Scenario: Gasto atípico de otro workspace
- **CUANDO** el OWNER de "W1" intenta descartar un gasto atípico de "W2" por su id
- **ENTONCES** se responde 404 `RESOURCE_NOT_FOUND` y nada cambia

### Requirement: Retención y portabilidad de los gastos atípicos
El sistema DEBE (MUST) purgar los gastos atípicos cuya transacción tiene fecha de hace más de 25 meses, por el rol de mantenimiento en el trabajo diario. La exportación del workspace NO DEBE (MUST NOT) incluir gastos atípicos ni sus descartes, porque se recalculan desde las transacciones; un workspace importado DEBE (MUST) empezar sin gastos atípicos.
Trace: FR-FORECAST-010, FR-IDENTITY-010, NFR-COMP-002 · Priority: Should

#### Scenario: Workspace importado
- **CUANDO** se importa en un workspace nuevo la exportación de "W1", que tenía 4 gastos atípicos
- **ENTONCES** el workspace nuevo no tiene gastos atípicos hasta el siguiente trabajo diario, que solo evalúa los últimos 7 días

### Requirement: Evaluación contra las anomalías etiquetadas del Large Seed
El nightly DEBE (MUST) evaluar la detección sobre toda la historia del workspace principal del Large Seed, cada gasto con sus 365 días anteriores y sin persistir resultados, contra las etiquetas `OUTLIER` y `NEW_COUNTERPARTY_FRAUD` exportadas fuera de la base, y DEBE (MUST) fallar si la precisión es menor que 0.60 o el recall menor que 0.70; los gastos con otras etiquetas NO DEBEN (MUST NOT) contar en la precisión. El informe NO DEBE (MUST NOT) incluir montos ni descripciones.
Trace: FR-FORECAST-010, FR-FORECAST-007 · Priority: Should

#### Scenario: Umbrales cumplidos
- **CUANDO** la evaluación marca 140 gastos, de los cuales 100 tienen etiqueta `OUTLIER` o `NEW_COUNTERPARTY_FRAUD`, 10 tienen otra etiqueta y 30 ninguna, y hay 125 gastos con esas dos etiquetas
- **ENTONCES** la precisión es 0.7692 (100 de 130), el recall 0.8000 (100 de 125) y la fila del nightly pasa

### Requirement: Rendimiento y métricas de la detección
La pasada diaria de la detección DEBE (MUST) tardar como máximo 10 s por workspace con el volumen del workspace principal del Large Seed, y DEBE (MUST) publicar métricas de gastos evaluados, marcados, descartados y restaurados y de la duración de la pasada, sin montos ni identificadores de transacciones en las etiquetas.
Trace: FR-FORECAST-010, NFR-PERF-012, NFR-OBS-004 · Priority: Should

#### Scenario: Workspace grande
- **CUANDO** el trabajo diario evalúa el workspace principal del Large Seed con 7 días de gastos nuevos
- **ENTONCES** la pasada de ese workspace tarda como máximo 10 s y las métricas registran los gastos evaluados y marcados
