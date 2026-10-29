## ADDED Requirements

### Requirement: Costo por evento de cada consumidor con handler real publicado
El benchmark nocturno DEBERÍA (SHOULD) publicar, para cada consumidor que recibe los eventos de las transacciones importadas, la duración por evento con su handler real (p50 y p95), el ritmo de procesamiento con ese consumidor como único activo, las esperas por bloqueos de base de datos observadas durante su drenado y, si está agrupado, los eventos por invocación. Esas filas DEBEN (MUST) quedar marcadas como informativas y NO DEBEN (MUST NOT) cambiar el veredicto del job mientras el owner no fije umbrales por consumidor.
Trace: NFR-PERF-008 · Priority: Should

#### Scenario: Publicación del costo por consumidor
- **CUANDO** el job de rendimiento mide la ráfaga de 5 000 transacciones importadas
- **ENTONCES** el resumen publica, para cada uno de los consumidores que reciben esos eventos, la duración p50 y p95 por evento, el ritmo con el consumidor como único activo y las esperas por bloqueos
- **Y** cada una de esas filas está marcada como informativa

#### Scenario: Consumidor lento sin umbral decidido
- **CUANDO** un consumidor rinde 30 eventos por segundo con su handler real y el owner todavía no fijó umbrales por consumidor
- **ENTONCES** el resumen lo muestra como el consumidor más lento
- **Y** el veredicto del job no cambia por esa fila

### Requirement: El benchmark del import mide también con la configuración del host
El benchmark nocturno del import de 5 000 filas DEBERÍA (SHOULD) medir, además de la configuración por omisión del código, la configuración de la plantilla del host (concurrencia 1 por consumidor, pool de 34 en el worker y de 22 en la API), con la misma precondición de presupuesto de conexiones y el mismo drenado por consumidor; el reporte DEBE (MUST) mostrar ambas configuraciones por separado y la de la plantilla del host DEBE (MUST) quedar informativa mientras el owner no decida que sea bloqueante. Ningún umbral existente DEBE (MUST) cambiar por esta medición.
Trace: NFR-PERF-007, NFR-PERF-008 · Priority: Should

#### Scenario: Dos configuraciones en el reporte
- **CUANDO** el job de rendimiento corre el benchmark del import
- **ENTONCES** el reporte muestra una fila con la configuración del código y otra con la de la plantilla del host
- **Y** la fila del host declara concurrencia 1, pool de 34 en el worker, 22 en la API y una suma de pools de 67 conexiones frente a 97 útiles

#### Scenario: Fila del host por encima de 120 segundos
- **CUANDO** con la configuración del host un consumidor tarda 130 segundos en drenar y con la del código todos drenan en 40 segundos
- **ENTONCES** la fila del host se publica como informativa excedida, con el consumidor y su tiempo
- **Y** el veredicto del job lo decide la fila de la configuración del código
