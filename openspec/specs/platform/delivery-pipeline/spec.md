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
