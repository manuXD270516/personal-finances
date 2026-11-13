## ADDED Requirements

### Requirement: El benchmark del import publica el desglose de la persistencia
El benchmark nocturno del import de 5 000 filas DEBE (MUST) publicar, para cada configuración, la persistencia descompuesta en: la espera desde la aprobación hasta que empieza la persistencia, la duración de cada lote con la de cada uno de sus pasos (lectura de las filas preparadas, transacciones, asientos y movimientos, vínculos, auditoría, recorrido, eventos, progreso de la importación y confirmación), el cierre de la importación y la diferencia hasta que la prueba observa el estado final. La suma de esas partes DEBE (MUST) coincidir con la persistencia medida con una tolerancia de ±5 %. Durante la persistencia el benchmark DEBE (MUST) muestrear y publicar las esperas de la base por tipo, el mantenimiento concurrente de la base (limpieza automática de tablas y puntos de control), los trabajos que el relay encoló para los consumidores y la carga del host. Un lote que tarde más del triple de la mediana de los lotes DEBE (MUST) marcarse como atípico. El desglose NO DEBE (MUST NOT) cambiar el umbral ni el veredicto de la fila, que siguen decidiéndose con la persistencia total.
Trace: NFR-PERF-007 · Priority: Must

#### Scenario: Desglose de una persistencia de 19 949 ms
- **CUANDO** la fila con la configuración del host mide una persistencia de 19 949 ms para 5 000 filas en 25 lotes de 200
- **ENTONCES** el reporte publica la espera inicial, los 25 lotes con su duración y la de cada paso, el cierre y la observación final
- **Y** la suma de las partes queda entre 18 952 ms y 20 946 ms
- **Y** el veredicto de la fila lo decide la persistencia total de 19 949 ms frente a 20 000 ms

#### Scenario: Lote atípico con sus esperas
- **CUANDO** la mediana de los 25 lotes es 610 ms y el lote 17 tarda 2 400 ms
- **ENTONCES** el reporte marca el lote 17 como atípico por superar 1 830 ms
- **Y** publica para ese lote la duración de cada paso y las esperas de la base muestreadas mientras corría

#### Scenario: Mantenimiento de la base durante la persistencia
- **CUANDO** durante la persistencia corren una limpieza automática de la tabla de trabajos de la cola y un punto de control
- **ENTONCES** el reporte publica ambos con su inicio y su duración dentro de la ventana de la persistencia
- **Y** la medición se publica como válida

### Requirement: Huella del runner publicada en el reporte de rendimiento
El job de rendimiento DEBERÍA (SHOULD) publicar, al empezar y antes del benchmark del import, la huella del runner: modelo y cantidad de CPU, memoria total, una calibración de CPU de carga fija y una calibración de confirmaciones de la base, cada calibración con su factor relativo frente a la referencia registrada en la documentación del pipeline. La huella DEBE (MUST) ser informativa: NO DEBE (MUST NOT) cambiar ningún umbral ni el veredicto de ninguna fila, ni repetir o invalidar una medición.
Trace: NFR-PERF-007, NFR-MAINT-005 · Priority: Should

#### Scenario: Runner más lento que la referencia
- **CUANDO** la calibración de CPU tarda 123 ms frente a una referencia de 54 ms y la fila del host mide una persistencia de 32 723 ms
- **ENTONCES** el reporte publica la huella con el factor de CPU 2,28 junto a la fila del import
- **Y** la fila del host se publica como fallida frente a 20 000 ms, sin repetirse ni invalidarse

#### Scenario: Runner de referencia
- **CUANDO** la calibración de CPU tarda 54 ms frente a una referencia de 54 ms
- **ENTONCES** el reporte publica el factor de CPU 1,00
- **Y** ninguna fila cambia su veredicto por la huella

### Requirement: Una suite informativa no decide el veredicto aunque su preparación no termine
Una suite informativa del pipeline programado (la ráfaga del import y el costo por consumidor) que no completa su preparación dentro de su tope DEBE (MUST) publicarse como informativa «sin completar», con el paso que no terminó y un diagnóstico del outbox: eventos pendientes por tipo, intentos de publicación, último error, antigüedad del pendiente más viejo y la transacción abierta más larga de la base. Esa suite NO DEBE (MUST NOT) cambiar el veredicto del job. Las filas bloqueantes NO DEBEN (MUST NOT) cambiar por esta regla.
Trace: NFR-PERF-008 · Priority: Must

#### Scenario: Outbox que no llega a 0 en la preparación
- **CUANDO** en la preparación de la ráfaga el outbox conserva 37 eventos pendientes al vencer el tope de 600 s
- **ENTONCES** la suite se publica «sin completar» con el paso de publicación del outbox, los 37 eventos por tipo, sus intentos y su último error
- **Y** el veredicto del job no cambia por esa suite

#### Scenario: Fila bloqueante intacta
- **CUANDO** la suite de la ráfaga queda «sin completar» y la fila del host del import mide una persistencia de 21 300 ms
- **ENTONCES** el job falla por la fila del host frente a 20 000 ms
- **Y** el reporte publica ambas filas por separado

### Requirement: El benchmark del import mide sin trabajos programados ajenos
El worker del benchmark del import DEBERÍA (SHOULD) arrancar sin las pasadas de arranque de los trabajos programados ajenos a la importación y a la entrega de eventos (entre ellos la vigilancia del flujo de caja y el digest del Home), igual que ya arranca sin las del mantenimiento del ledger o el relleno de tasas. El reporte DEBE (MUST) publicar los trabajos programados que corrieron dentro de la ventana de la persistencia y del drenado, con su inicio y su duración; si uno corrió, la medición DEBE (MUST) publicarse como válida, sin repetirse.
Trace: NFR-PERF-007 · Priority: Should

#### Scenario: Arranque sin pasadas ajenas
- **CUANDO** el benchmark arranca el worker con la configuración del host
- **ENTONCES** no se encola ninguna pasada de arranque de la vigilancia del flujo de caja ni del digest del Home
- **Y** el reporte publica 0 trabajos programados dentro de la ventana medida

#### Scenario: Trabajo horario dentro de la ventana
- **CUANDO** la vigilancia horaria del flujo de caja corre durante la persistencia y tarda 4 200 ms
- **ENTONCES** el reporte publica ese trabajo con su inicio y su duración junto a la fila del import
- **Y** la fila decide su veredicto con la persistencia medida, sin repetirse

### Requirement: Cada configuración del benchmark del import parte de una base en reposo
El benchmark del import DEBE (MUST), antes de medir cada configuración (la del código y la de la plantilla del host) y con el worker anterior detenido: purgar el backlog que dejó la configuración anterior (eventos pendientes del outbox y trabajos abiertos de las colas `events.*`), vaciar y analizar las tablas que esa purga ensucia, esperar la quietud del host y verificar que la base está en reposo (0 eventos pendientes, 0 trabajos `events.*` abiertos y ninguna consulta ajena activa). Si la configuración bloqueante no queda en reposo dentro del tope, DEBE (MUST) fallar con el motivo en lugar de medir sobre un backlog ajeno. El reporte DEBE (MUST) publicar esa preparación y el seguimiento del outbox durante la persistencia y el drenado; si el drenado no termina dentro de su tope, DEBE (MUST) publicar un diagnóstico del outbox en lugar de lanzar un error. Un drenado que no termina en la fila informativa NO DEBE (MUST NOT) cambiar el veredicto del job ni contaminar la medición de la fila bloqueante.
Trace: NFR-PERF-007, NFR-PERF-008 · Priority: Must

#### Scenario: Backlog de la configuración anterior
- **CUANDO** la configuración del código termina con 12 201 eventos pendientes en el outbox y se prepara la configuración del host
- **ENTONCES** el benchmark purga ese backlog con el worker detenido, vacía y analiza las tablas afectadas y no empieza a medir hasta que el outbox y las colas de eventos están en 0
- **Y** la persistencia del host no incluye la espera por el drenado de la configuración anterior

#### Scenario: Drenado que no termina en la fila informativa
- **CUANDO** el drenado de la configuración del código no llega a 0 en 180 s con 12 201 eventos pendientes
- **ENTONCES** el reporte publica la fila con el seguimiento del outbox y el diagnóstico (pendientes por tipo, intentos, antigüedad, transacción abierta más larga y plan de la consulta del relay) en lugar de lanzar un error
- **Y** el veredicto del job lo deciden solo las filas bloqueantes
