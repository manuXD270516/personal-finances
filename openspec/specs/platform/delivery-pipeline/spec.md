# platform/delivery-pipeline Specification

## Purpose
Garantiza que ningún cambio llegue a la rama principal sin pasar los quality gates acordados y que exactamente el mismo artefacto de contenedor se promueva entre entornos.

## Requirements

### Requirement: Quality gate de pull request
Toda pull request a la rama principal DEBE (MUST) ejecutar y aprobar: validación estricta de OpenSpec, formato, lint, type check, tests unitarios y de dominio, tests de integración contra dependencias reales en contenedores, chequeos de arquitectura, build de imagen, escaneo de dependencias, de imagen y de secretos.
Trace: NFR-MAINT-001, NFR-MAINT-006, NFR-MAINT-008 · Priority: Must

#### Scenario: Una spec inválida bloquea el merge
- **CUANDO** una pull request contiene un change de OpenSpec con un requirement sin scenario
- **ENTONCES** falla la validación de OpenSpec
- **Y** la pull request no puede mergearse

#### Scenario: Una violación de arquitectura bloquea el merge
- **CUANDO** una pull request agrega un import desde una capa de dominio hacia un módulo de infraestructura o un paquete de framework
- **ENTONCES** el chequeo de arquitectura falla indicando el import infractor

### Requirement: Vulnerabilidades críticas bloquean el gate
El pipeline DEBE (MUST) fallar cuando un escaneo de dependencias o de imagen reporte una vulnerabilidad de severidad crítica con corrección disponible, salvo que exista una excepción documentada y con vencimiento.
Trace: NFR-SEC-013 · Priority: Must

#### Scenario: CVE crítico con corrección
- **CUANDO** el escaneo de imagen reporta una vulnerabilidad crítica con corrección disponible y no hay excepción registrada
- **ENTONCES** el pipeline falla

### Requirement: Construir una vez, promover por digest
Cada imagen de aplicación DEBE (MUST) construirse una sola vez por commit, etiquetarse con el identificador del commit, y todo entorno posterior DEBE (MUST) desplegar esa misma imagen por su digest de contenido; las diferencias entre entornos DEBEN (MUST) venir solo de configuración y secretos.
Trace: NFR-PORT-006 · Priority: Must

#### Scenario: Staging y producción ejecutan el mismo artefacto
- **CUANDO** un commit se promueve de staging a producción
- **ENTONCES** el despliegue de producción referencia el mismo digest de imagen que pasó los smoke tests de staging
- **Y** no ocurre ninguna reconstrucción de imagen durante la promoción

### Requirement: Migraciones de base de datos controladas
Las migraciones DEBEN (MUST) ejecutarse como un paso separado antes de que arranque la nueva versión de la aplicación, y las migraciones clasificadas como destructivas DEBEN (MUST) requerir aprobación manual explícita antes de ejecutarse en cualquier entorno compartido.
Trace: NFR-DATA-013, NFR-REL-013 · Priority: Must

#### Scenario: Una migración destructiva requiere aprobación
- **CUANDO** una release contiene una migración que elimina una columna o una tabla
- **ENTONCES** el despliegue se pausa a la espera de aprobación manual antes de ejecutarla

### Requirement: El benchmark nocturno mide sin interferencia de carga de fondo
Cada benchmark de latencia o de throughput del pipeline programado DEBE (MUST) empezar sin eventos pendientes ni trabajos de consumidores que provengan de una carga o de una suite anterior, de modo que solo mida el trabajo de su propia suite. El reporte DEBE (MUST) publicar, para cada suite, la carga de fondo al empezar: eventos pendientes de publicar, trabajos pendientes por consumidor, conexiones activas a la base y carga del host. Si al empezar una suite queda carga de fondo ajena que no se pudo eliminar, la suite DEBE (MUST) fallar indicando la interferencia medida y NO DEBE (MUST NOT) publicar su medición como válida.
Trace: NFR-PERF-004, NFR-PERF-008 · Priority: Must

#### Scenario: Disponible para gastar después del Large Seed
- **CUANDO** el job de rendimiento carga el Large Seed, que deja 470 165 eventos pendientes de publicar, y después corre la suite de disponible para gastar
- **ENTONCES** al empezar esa suite no queda ningún evento pendiente ni ningún trabajo de consumidor de la carga anterior
- **Y** el reporte publica para la suite 0 eventos pendientes al empezar, las conexiones activas y la carga del host, junto al p95 medido frente a 300 ms

#### Scenario: Ráfaga del matcher sin backlog ajeno
- **CUANDO** la suite de compromisos publica una ráfaga de 1 050 eventos de transacciones importadas (1 000 más 50 reentregados) hacia el matcher de compromisos
- **ENTONCES** al empezar la medición la cola del matcher contiene solo los eventos de esa ráfaga
- **Y** el throughput se calcula solo con los eventos de la ráfaga y el tiempo que tardó en procesarlos

#### Scenario: Interferencia que no se pudo eliminar
- **CUANDO** al empezar la suite de disponible para gastar quedan 12 000 eventos pendientes de una carga anterior
- **ENTONCES** la suite falla indicando la interferencia y los 12 000 eventos pendientes
- **Y** el reporte no publica su p95 como una medición válida

### Requirement: Causa de los rojos de rendimiento documentada antes de cambiar un umbral
Todo benchmark bloqueante del pipeline programado que falle en dos corridas seguidas DEBE (MUST) tener registrada en la documentación del pipeline una causa medida, con la evidencia que la sostiene, y un camino: arreglo del benchmark, arreglo del producto en un change, ajuste de umbral aprobado por el owner o change de optimización. Los umbrales de los benchmarks DEBEN (MUST) coincidir con los de los requisitos no funcionales, y NO DEBEN (MUST NOT) cambiarse ni volverse informativos sin una decisión del owner registrada; el test de política del pipeline DEBE (MUST) rechazar ese cambio en el gate de pull request.
Trace: NFR-PERF-004, NFR-PERF-008, NFR-MAINT-005 · Priority: Should

#### Scenario: Rojo con causa medida y camino
- **CUANDO** el benchmark de disponible para gastar da un p95 de 352.2 ms frente a 300 ms en dos corridas nocturnas seguidas
- **ENTONCES** la documentación del pipeline registra para ese benchmark la causa medida, las mediciones con y sin carga de fondo que la sostienen y el camino elegido
- **Y** el test case del benchmark enlaza ese registro

#### Scenario: Se intenta relajar un umbral sin decisión del owner
- **CUANDO** una pull request cambia el umbral del p95 de disponible para gastar de 300 ms a 400 ms, o el throughput mínimo por consumidor de 42 a 5 eventos por segundo, sin una decisión del owner registrada
- **ENTONCES** el test de política del pipeline falla en el gate indicando el benchmark, el umbral nuevo y el umbral de los requisitos no funcionales

### Requirement: Financial Regression Suite con el contexto de ejecución del gate
El pipeline programado DEBE (MUST) ejecutar completo y en su orden cada archivo de test que contiene un test case de la Financial Regression Suite, igual que el gate de pull request, y NO DEBE (MUST NOT) filtrar los tests de un archivo por su nombre. El fallo de cualquier test de esos archivos, nombre o no un test case, DEBE (MUST) hacer fallar su grupo y la corrida, y el reporte DEBE (MUST) indicar por grupo los archivos ejecutados y su resultado.
Trace: NFR-MAINT-005, NFR-MAINT-007 · Priority: Must

#### Scenario: Un test case que necesita el estado de un test anterior del mismo archivo
- **CUANDO** un archivo de integración contiene primero un test que crea los periodos "2026-10" a "2027-01" de un workspace y después un test case de la suite que intenta insertar un periodo "2026-10" solapado en ese workspace
- **ENTONCES** el pipeline programado ejecuta ambos tests en ese orden
- **Y** el test case de la suite obtiene el rechazo por solapamiento, el mismo resultado que en el gate de pull request

#### Scenario: Falla un test sin test case dentro de un archivo de la suite
- **CUANDO** en un archivo de la suite falla un test cuyo nombre no contiene ningún identificador de test case
- **ENTONCES** el grupo de ese archivo queda en rojo y la corrida del pipeline programado falla
- **Y** el reporte indica el paquete y el archivo del grupo fallido

#### Scenario: El comando de un grupo no filtra por nombre
- **CUANDO** el ejecutor arma el comando de un grupo de tests unitarios o de integración de la suite
- **ENTONCES** el comando nombra los archivos del grupo y no incluye ningún patrón de filtro por nombre de test

### Requirement: Cobertura del núcleo compartido sin rebajar umbrales
El pipeline programado DEBE (MUST) medir la cobertura del núcleo compartido solo con sus propios tests y fallar si queda por debajo de 95 % de líneas o de 90 % de ramas. Esos umbrales NO DEBEN (MUST NOT) rebajarse ni el paso de cobertura marcarse como no bloqueante sin un change aprobado por el owner; una caída de cobertura DEBE (MUST) corregirse agregando tests al núcleo compartido.
Trace: NFR-MAINT-002 · Priority: Must

#### Scenario: Un módulo sin tests propios baja la cobertura
- **CUANDO** el núcleo compartido tiene un módulo nuevo sin tests propios y la cobertura total queda en 89.86 % de líneas y 84.07 % de ramas
- **ENTONCES** el paso de cobertura del pipeline programado falla indicando ambas métricas frente a 95 % y 90 %
- **Y** el resumen de la corrida publica las métricas medidas

#### Scenario: Se intenta rebajar el umbral
- **CUANDO** una pull request cambia el umbral de líneas del núcleo compartido de 95 % a 89 % o marca el paso de cobertura como no bloqueante
- **ENTONCES** el test de política del pipeline falla en el gate de pull request indicando el umbral o el paso modificado

### Requirement: Sobrecosto de RLS con un criterio robusto al ruido de medición
El benchmark de sobrecosto de la seguridad a nivel de fila DEBE (MUST) comparar cada consulta con y sin la política en al menos 200 pares de ejecuciones intercaladas, y DEBE (MUST) declarar brecha en una consulta bloqueante solo cuando el límite inferior del intervalo de confianza del 95 % de la diferencia alcanza a la vez el 10 % de la mediana sin la política y el piso de 0.5 ms, o cuando la política cambia el método de acceso o el índice del plan. El reporte DEBE (MUST) publicar la diferencia, su intervalo y el motivo del veredicto.
Trace: NFR-SEC-003, NFR-PERF-005 · Priority: Should

#### Scenario: Diferencia pequeña dentro del ruido
- **CUANDO** una consulta bloqueante mide una mediana de 1.02 ms sin la política y de 1.58 ms con la política, con una mediana de las diferencias por par de 0.56 ms y un intervalo de confianza del 95 % de 0.31 ms a 0.79 ms, y el mismo plan en ambos casos
- **ENTONCES** la consulta no se declara como brecha porque el límite inferior del intervalo (0.31 ms) no alcanza el piso absoluto de 0.5 ms
- **Y** el reporte muestra la diferencia, su intervalo y el motivo "no demostrada sobre el piso absoluto"

#### Scenario: Sobrecosto real demostrado
- **CUANDO** una consulta bloqueante mide una mediana de 10.00 ms sin la política y de 13.00 ms con la política, con un intervalo de confianza del 95 % de la diferencia por par de 2.70 ms a 3.30 ms
- **ENTONCES** la consulta se declara como brecha (al menos 27 % y 2.70 ms demostrados, sobre el 10 % y el piso de 0.5 ms)
- **Y** el benchmark de rendimiento falla indicando la consulta y la diferencia medida

#### Scenario: La política cambia el plan de la consulta
- **CUANDO** sin la política la consulta de saldo por cuenta usa un acceso solo por índice sobre el índice de saldos y con la política usa un recorrido secuencial de la tabla de postings
- **ENTONCES** la consulta se declara como brecha aunque la diferencia de tiempo no esté demostrada
- **Y** el reporte muestra ambos métodos de acceso

### Requirement: Los benchmarks no miden la política de cuotas
Toda instancia de la API que levante un benchmark del pipeline programado DEBE (MUST) arrancar con las cuotas de lecturas, escrituras y operaciones costosas por minuto relajadas por encima del número de solicitudes del benchmark, mediante una única configuración compartida por todos los benchmarks. Una suite de benchmarks que configure la API sin esa configuración compartida DEBE (MUST) ser rechazada por el test de política del pipeline en el gate de pull request.
Trace: NFR-PERF-004 · Priority: Should

#### Scenario: El simulador de estrategias no recibe rechazos por cuota
- **CUANDO** el benchmark del simulador de estrategias de deuda envía 200 solicitudes de simulación en menos de un minuto, por encima de las cuotas por defecto de una instancia normal (120 escrituras y 10 operaciones costosas por minuto)
- **ENTONCES** ninguna respuesta es un rechazo por cuota
- **Y** el benchmark mide el p95 de las 200 simulaciones frente a su umbral de 300 ms

#### Scenario: Una suite nueva sin la configuración compartida
- **CUANDO** una pull request agrega una suite de benchmarks que configura la API con las cuotas por defecto
- **ENTONCES** el test de política del pipeline falla indicando el archivo de la suite

### Requirement: Cobertura del núcleo compartido también en el gate de pull request
El job de tests unitarios del gate de pull request, que ya es un check requerido, DEBE (MUST) medir además la cobertura del núcleo compartido con sus propios tests y fallar si queda por debajo de 95 % de líneas o de 90 % de ramas, los mismos umbrales que el pipeline programado. Esa verificación NO DEBE (MUST NOT) agregar un check requerido, cambiar el nombre del job ni su tiempo máximo, ni marcarse como no bloqueante; el test de política del pipeline DEBE (MUST) rechazar una pull request que la quite del job o la vuelva no bloqueante.
Trace: NFR-MAINT-002, NFR-MAINT-001 · Priority: Must

#### Scenario: Una pull request baja la cobertura del núcleo compartido
- **CUANDO** una pull request agrega al núcleo compartido un módulo sin tests propios y la cobertura del núcleo queda en 94.20 % de líneas y 91.00 % de ramas
- **ENTONCES** el job de tests unitarios del gate falla indicando las líneas medidas frente al umbral de 95 %
- **Y** la pull request no puede fusionarse mientras ese check siga en rojo

#### Scenario: Se quita la verificación de cobertura del job de tests unitarios
- **CUANDO** una pull request elimina del job de tests unitarios el paso de cobertura del núcleo compartido, o le agrega una condición o una tolerancia de error que lo vuelve no bloqueante
- **ENTONCES** el test de política del pipeline falla en el gate indicando el job y el paso modificado

#### Scenario: La verificación no cambia los checks requeridos
- **CUANDO** se inspecciona el workflow del gate de pull request con la verificación de cobertura agregada
- **ENTONCES** el job de tests unitarios conserva su identificador y su nombre de check y su tiempo máximo de 15 minutos
- **Y** la verificación es un paso dentro de ese job y no un job nuevo

### Requirement: Aviso por issue de los fallos de regresión y de mutación del pipeline programado
Cuando falla el job de la suite de regresión financiera o el de cobertura y mutación del pipeline programado, el pipeline DEBE (MUST) abrir un issue de aviso con un título fijo propio de ese job y el resumen de la corrida, o comentar el issue abierto con ese título si ya existe, sin abrir duplicados. Cada job DEBE (MUST) avisar en su propio issue, sin tocar el de los demás. El permiso de escritura de issues DEBE (MUST) declararse solo en los jobs que avisan y NO DEBE (MUST NOT) concederse a nivel de todo el pipeline.
Trace: NFR-MAINT-002, NFR-MAINT-005 · Priority: Should

#### Scenario: Falla la suite de regresión sin aviso abierto
- **CUANDO** el job de la suite de regresión del pipeline programado falla con el grupo de integración de Planning en rojo y no hay un issue abierto titulado "nightly regression: falló"
- **ENTONCES** se abre un issue con ese título que incluye el enlace a la corrida y el resumen de la suite con el paquete y los archivos de los grupos en rojo
- **Y** si la corrida siguiente vuelve a fallar con ese issue abierto, se agrega un comentario al mismo issue y no se abre otro

#### Scenario: Falla la cobertura del núcleo compartido
- **CUANDO** el job de cobertura y mutación del pipeline programado falla porque la cobertura del núcleo compartido queda en 94.10 % de líneas, y en la misma corrida la suite de regresión pasa
- **ENTONCES** se abre o se comenta el issue titulado "nightly mutation: falló" con el enlace a la corrida y las métricas medidas
- **Y** el issue "nightly regression: falló" no recibe ningún comentario de esa corrida

#### Scenario: Permisos de los jobs que avisan
- **CUANDO** se inspecciona el workflow del pipeline programado
- **ENTONCES** el permiso de escritura de issues está declarado solo en los jobs de regresión, de cobertura y mutación, de rendimiento y de prueba en vivo de providers
- **Y** el workflow no lo concede a nivel de todo el pipeline

### Requirement: El benchmark del import mide dentro de su presupuesto de conexiones
Antes de medir, el benchmark nocturno del import de 5 000 filas DEBE (MUST) verificar que la suma de los tamaños máximos de los pools de conexiones que abre (API, worker, sus colas de trabajos y el propio harness) cabe en el máximo de conexiones del servidor de base de datos del benchmark menos las conexiones reservadas; si no cabe, DEBE (MUST) fallar sin medir, indicando la suma, el límite y el detalle por pool. Durante la medición, el reporte DEBE (MUST) publicar por pool el máximo, el pico de conexiones en uso, el pico de adquisiciones en espera y la espera máxima de adquisición, y del servidor el pico de conexiones frente a su máximo. Si una adquisición de conexión vence, la suite DEBE (MUST) fallar con el veredicto `conexiones`, indicando el pool, las conexiones en uso, su máximo y la espera, y NO DEBE (MUST NOT) reportarlo como un fallo del drenado de los consumidores. El máximo de conexiones del servidor del benchmark NO DEBE (MUST NOT) ampliarse sin la suma medida que lo justifique.
Trace: NFR-PERF-007, NFR-PERF-008 · Priority: Must

#### Scenario: Presupuesto del benchmark que no cabe en el servidor
- **CUANDO** la suite del import va a medir con pools máximos de 52 conexiones para la API, 52 para el worker, 4 para cada cola de trabajos y 3 para el harness (115 en total) frente a un servidor con 100 conexiones máximas y 3 reservadas
- **ENTONCES** la suite falla antes de subir el archivo indicando 115 conexiones frente a un límite de 97 y el tamaño de cada pool
- **Y** el reporte no publica ninguna medición del import como válida

#### Scenario: Adquisición de conexión vencida durante el drenado
- **CUANDO** durante el drenado el pool del worker tiene 34 de 34 conexiones en uso y una adquisición espera más de 2 000 ms
- **ENTONCES** la suite falla con el veredicto `conexiones` indicando el pool del worker, 34 de 34 conexiones en uso y la espera medida
- **Y** el reporte publica el pico de conexiones del servidor frente a su máximo, separado del resultado del drenado

### Requirement: El drenado del benchmark del import se publica por consumidor
El benchmark nocturno del import de 5 000 filas DEBE (MUST) publicar, para cada consumidor de eventos, los eventos pendientes al terminar la persistencia, el tiempo hasta dejarlos en 0 medido desde la persistencia y su ritmo en eventos por segundo. Cada consumidor DEBE (MUST) dejar su backlog en 0 en 120 s o menos desde la persistencia; si el drenado los supera, la suite DEBE (MUST) fallar indicando el tiempo medido, el presupuesto de 120 s y los consumidores que terminaron después del presupuesto con sus tiempos. El presupuesto de 120 s NO DEBE (MUST NOT) cambiarse ni volverse informativo sin una decisión del owner registrada.
Trace: NFR-PERF-008 · Priority: Must

#### Scenario: Import de 5 000 filas con el drenado dentro del presupuesto
- **CUANDO** el job de rendimiento corre la suite del import con un extracto de 5 000 filas nuevas después de las demás suites
- **ENTONCES** ninguna adquisición de conexión vence y cada consumidor deja su backlog en 0 en 120 s o menos desde la persistencia
- **Y** el reporte publica para cada consumidor los eventos pendientes al terminar la persistencia, su tiempo de drenado y sus eventos por segundo

#### Scenario: Drenado marginal sobre el presupuesto
- **CUANDO** los consumidores terminan de drenar 123,5 s después de la persistencia, frente a un presupuesto de 120 s
- **ENTONCES** la suite falla indicando 123,5 s frente a 120 s y los consumidores que terminaron después de 120 s con su tiempo
- **Y** el veredicto es de drenado y no de conexiones

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
El benchmark nocturno del import de 5 000 filas DEBE (MUST) medir, además de la configuración por omisión del código, la configuración de la plantilla del host (concurrencia 1 por consumidor, pool de 34 en el worker y de 22 en la API), con la misma precondición de presupuesto de conexiones y el mismo drenado por consumidor; el reporte DEBE (MUST) mostrar ambas configuraciones por separado. Por decisión del owner (D311) la fila con la configuración de la plantilla del host DEBE (MUST) ser bloqueante —decide el veredicto del nightly— y la fila con la configuración por omisión del código DEBE (MUST) quedar informativa. Ningún umbral existente DEBE (MUST) cambiar por esta medición.
Trace: NFR-PERF-007, NFR-PERF-008 · Priority: Must

#### Scenario: Dos configuraciones en el reporte
- **CUANDO** el job de rendimiento corre el benchmark del import
- **ENTONCES** el reporte muestra una fila con la configuración del código y otra con la de la plantilla del host
- **Y** la fila del host declara concurrencia 1, pool de 34 en el worker, 22 en la API y una suma de pools de 67 conexiones frente a 97 útiles

#### Scenario: Fila del host por encima de 120 segundos
- **CUANDO** con la configuración del host un consumidor tarda 130 segundos en drenar y con la del código todos drenan en 40 segundos
- **ENTONCES** la fila del host se publica como bloqueante fallida, con el consumidor y su tiempo
- **Y** el veredicto del job lo decide la fila de la configuración del host

#### Scenario: Fila del código por encima de 120 segundos
- **CUANDO** con la configuración del código un consumidor tarda 130 segundos en drenar y con la del host todos drenan en 40 segundos
- **ENTONCES** la fila del código se publica como informativa excedida, con el consumidor y su tiempo
- **Y** el veredicto del job no cambia por esa fila

### Requirement: Actualización de dependencias agrupada y semanal
El repositorio DEBE (MUST) tener un servicio de actualización de dependencias que proponga por pull request contra la rama principal las versiones nuevas de las dependencias del workspace (manifiestos, catálogo de versiones y versión del gestor de paquetes), de la versión de Node, de las acciones de CI fijadas por SHA de commit y de las imágenes fijadas por digest. Las propuestas DEBEN (MUST) agruparse por ecosistema y abrirse solo dentro de una ventana semanal fija; las acciones DEBEN (MUST) seguir referenciadas por SHA de commit completo con el tag como comentario, y las imágenes por tag y digest. Cada pull request de actualización DEBE (MUST) pasar los mismos checks requeridos que cualquier otra, y el servicio NO DEBE (MUST NOT) modificar la protección de la rama principal ni la lista de checks requeridos.
Trace: NFR-MAINT-012, NFR-SEC-013 · Priority: Should

#### Scenario: Parches y versiones menores de la semana en un solo grupo
- **CUANDO** durante la semana se publican un parche y una versión menor de dos dependencias de desarrollo del workspace y ambas superan la antigüedad mínima
- **ENTONCES** dentro de la ventana semanal se abre una sola pull request del grupo de dependencias del workspace que actualiza los manifiestos y el lockfile
- **Y** fuera de la ventana semanal no se abre ninguna pull request por esas versiones

#### Scenario: Acción de CI fijada por SHA
- **CUANDO** se publica una versión menor de una acción de CI que los workflows usan fijada por SHA
- **ENTONCES** la pull request reemplaza el SHA por el SHA completo del commit de la versión nueva y actualiza el comentario con su tag
- **Y** todos los workflows que usan esa acción se actualizan en la misma pull request

#### Scenario: Imagen fijada por digest en varios archivos
- **CUANDO** se publica un parche de la imagen de PostgreSQL que usan el compose y los tests con contenedores
- **ENTONCES** una sola pull request actualiza el tag y el digest en todos los archivos que la referencian

#### Scenario: La configuración no toca la protección de la rama
- **CUANDO** el servicio de actualización está activo
- **ENTONCES** la protección de la rama principal sigue exigiendo los mismos checks requeridos, con rama al día y sin excepción para administradores
- **Y** el servicio no tiene una regla que agregue, quite o salte checks requeridos

### Requirement: Sin fusión automática de versiones mayores ni con checks en rojo
Una pull request de actualización a una versión mayor NO DEBE (MUST NOT) fusionarse automáticamente: DEBE (MUST) abrirse separada de los grupos semanales y quedar abierta hasta que el owner la revise. Ninguna pull request de actualización DEBE (MUST) fusionarse con un check requerido en rojo o pendiente. Si se permite la fusión automática para alguna clase de actualización, DEBE (MUST) delegarse en la fusión automática de la plataforma, que espera los checks requeridos de la rama principal, y NO DEBE (MUST NOT) saltar la protección de la rama.
Trace: NFR-SEC-013, NFR-MAINT-012 · Priority: Must

#### Scenario: Versión mayor en su propia pull request
- **CUANDO** se publica una versión mayor del compilador de TypeScript que el workspace fija en su catálogo
- **ENTONCES** se abre una pull request propia para esa versión mayor, fuera del grupo semanal
- **Y** la pull request no tiene la fusión automática activada aunque todos sus checks pasen

#### Scenario: Actualización con un check requerido en rojo
- **CUANDO** una pull request de actualización de una versión menor tiene en rojo el check de tests de integración
- **ENTONCES** la pull request no se fusiona
- **Y** queda abierta hasta que se corrija en su rama o se cierre

#### Scenario: Fusión automática permitida espera todos los checks
- **CUANDO** una pull request de una clase de actualización con fusión automática permitida tiene un check requerido todavía pendiente
- **ENTONCES** la pull request no se fusiona hasta que todos los checks requeridos estén en verde con la rama al día

### Requirement: Antigüedad mínima y lockfile verificable
El servicio de actualización NO DEBE (MUST NOT) proponer una versión publicada hace menos de la antigüedad mínima configurada, por defecto 3 días, y esa antigüedad NO DEBE (MUST NOT) ser menor que la que exige el gestor de paquetes al instalar. Cada pull request de actualización DEBE (MUST) incluir el lockfile regenerado de forma que la instalación con lockfile congelado y el escaneo de dependencias del gate pasen sin excepciones nuevas. El servicio NO DEBE (MUST NOT) agregar paquetes a la lista de dependencias con scripts de instalación permitidos, ni a las excepciones de antigüedad mínima, ni a las excepciones de vulnerabilidades.
Trace: NFR-SEC-013 · Priority: Must

#### Scenario: Versión publicada hace un día
- **CUANDO** una dependencia del workspace publicó una versión nueva hace 1 día
- **ENTONCES** el servicio no la propone en la ventana semanal de ese día
- **Y** la propone en la primera ventana semanal en la que la versión tiene al menos 3 días

#### Scenario: Dependencia nueva con scripts de instalación
- **CUANDO** una versión nueva de una dependencia trae una dependencia transitiva con un script de instalación que no está en la lista permitida
- **ENTONCES** la pull request no agrega ese paquete a la lista permitida
- **Y** si la instalación con lockfile congelado falla, la pull request queda en rojo para revisión manual

#### Scenario: Vulnerabilidad crítica introducida por la actualización
- **CUANDO** la versión propuesta tiene una vulnerabilidad crítica con corrección disponible
- **ENTONCES** el check de escaneo de dependencias falla y la pull request no se fusiona
- **Y** el servicio no crea una excepción en el archivo de excepciones de vulnerabilidades

### Requirement: Nightly de rendimiento con el Large Seed
Un pipeline programado una vez al día, que NO DEBE (MUST NOT) ser un check requerido de la rama principal, DEBE (MUST) cargar el Large Seed a escala completa a través de los casos de uso, medir el p95 del listado paginado de transacciones, de la búsqueda de texto en transacciones, de los comandos de escritura, del dashboard, del saldo as-of y de los reportes agregados, y fallar cuando algún p95 supere su umbral de los requisitos no funcionales. DEBE (MUST) publicar en cada corrida un reporte con el valor medido y el umbral de cada benchmark como artefacto, y un fallo del nightly NO DEBE (MUST NOT) bloquear las pull requests. Cuando el job de rendimiento falla, el pipeline DEBE (MUST) abrir un issue de aviso con un título fijo y el resumen de la corrida, o comentar el issue abierto con ese título si ya existe, sin abrir duplicados; el permiso de escritura de issues que esto requiere DEBE (MUST) declararse en ese job y NO DEBE (MUST NOT) concederse a nivel de todo el pipeline.
Trace: NFR-PERF-001, NFR-PERF-002, NFR-PERF-003, NFR-PERF-004, NFR-PERF-005, NFR-PERF-006 · Priority: Should

#### Scenario: Búsqueda de texto con el Large Seed
- **CUANDO** el nightly busca un texto frecuente de las compras de supermercado ("super", la descripción normalizada que genera el Large Seed) en el workspace principal del Large Seed con al menos 50 000 transacciones, con 50 resultados por página
- **ENTONCES** el reporte incluye el p95 de la búsqueda frente al umbral de 400 ms
- **Y** el nightly falla si el p95 supera 400 ms

#### Scenario: Un p95 supera su umbral
- **CUANDO** el p95 del listado paginado de transacciones es 310 ms y su umbral local es 300 ms
- **ENTONCES** el nightly falla indicando el benchmark y el valor medido
- **Y** el reporte se publica como artefacto aunque la corrida falle

#### Scenario: Nightly en rojo no bloquea pull requests
- **CUANDO** la última corrida del nightly falló
- **ENTONCES** una pull request con todos los checks requeridos en verde puede fusionarse

#### Scenario: Fallo del nightly de rendimiento abre o comenta un aviso
- **CUANDO** el job de rendimiento del nightly falla porque el p95 de la búsqueda de texto es 450 ms frente a su umbral de 400 ms y no hay un issue abierto titulado "nightly perf: umbral superado"
- **ENTONCES** se abre un issue con ese título que incluye el enlace a la corrida y el resumen del reporte con el benchmark y el valor medido
- **Y** si en la corrida siguiente vuelve a fallar con ese issue abierto, se agrega un comentario al mismo issue y no se abre otro
- **Y** el permiso de escritura de issues está declarado en el job de rendimiento y no a nivel de todo el pipeline, y los demás jobs que no avisan por issue no lo tienen

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
