## ADDED Requirements

### Requirement: Drill de restore mensual en el host que avisa si falla
El host de producción DEBE (MUST) restaurar, una vez por mes y sin intervención, el último punto del repositorio de respaldos continuos en una base temporal, verificar sobre ella que los postings de cada asiento suman cero por moneda y que todo asiento tiene al menos dos postings, medir la duración, registrar el resultado y avisar al heartbeat del drill el éxito o el fallo. Cualquier error del restore, de la recuperación o de una verificación DEBE (MUST) avisar un fallo.
Trace: NFR-REL-001, NFR-REL-002, NFR-REL-005, NFR-OBS-005 · Priority: Must

#### Scenario: Drill exitoso
- **CUANDO** el día 2 del mes a las 09:00 UTC corre el drill y el último respaldo continuo restaura y recupera sin errores
- **Y** en la copia restaurada ningún asiento tiene postings que no sumen cero por moneda y ninguno tiene menos de dos postings
- **ENTONCES** el drill registra una línea con el resultado `ok`, la etiqueta del respaldo, la duración del restore, la de la recuperación y la total
- **Y** avisa éxito al heartbeat del drill con ese resumen

#### Scenario: El restore falla
- **CUANDO** el repositorio no responde o el respaldo no se puede descifrar durante el drill
- **ENTONCES** el drill registra el resultado `fail` con el motivo y avisa el fallo al heartbeat del drill

#### Scenario: Asiento descuadrado en la copia
- **CUANDO** en la copia restaurada un asiento tiene postings de +100.00 BOB y −99.99 BOB
- **ENTONCES** la verificación cuenta 1 par de asiento y moneda que no suma cero y el drill avisa el fallo

### Requirement: El drill no puede afectar la producción ni los respaldos
El drill DEBE (MUST) leer el repositorio solo con una credencial de solo lectura, DEBE (MUST) arrancar la base restaurada sin archivado de WAL, sin puertos publicados, fuera de la red del stack y con un techo de memoria propio, y DEBE (MUST) borrar la base, el volumen y la red temporales al terminar, también cuando falla.
Trace: NFR-REL-005, NFR-SEC-007 · Priority: Must

#### Scenario: La copia no escribe en el repositorio
- **CUANDO** la base restaurada termina la recuperación y promueve
- **ENTONCES** no envía WAL al repositorio y la credencial que usa no permite escribir ni borrar en él

#### Scenario: Limpieza tras un fallo
- **CUANDO** el drill falla en la verificación de integridad
- **ENTONCES** al terminar no quedan el contenedor, el volumen ni la red temporales del drill

#### Scenario: Restos de un drill interrumpido
- **CUANDO** un drill anterior se cortó por un reinicio y dejó su volumen temporal
- **ENTONCES** el drill siguiente lo borra antes de restaurar

### Requirement: Pérdida de datos del drill dentro del RPO
El drill DEBE (MUST) comparar el último posting de producción al empezar con el último posting de la copia restaurada y avisar un fallo si la diferencia supera 15 minutos.
Trace: NFR-REL-001 · Priority: Should

#### Scenario: Copia al día
- **CUANDO** el último posting de producción al empezar el drill es de las 08:58 UTC y el de la copia es de las 08:55 UTC
- **ENTONCES** la diferencia de 3 min queda registrada y el drill no falla por pérdida de datos

#### Scenario: Copia atrasada
- **CUANDO** el último posting de producción es de las 08:58 UTC y el de la copia es de las 08:30 UTC
- **ENTONCES** el drill avisa un fallo por una pérdida de 28 min, mayor que el RPO de 15 min

#### Scenario: Producción sin postings
- **CUANDO** producción todavía no tiene postings
- **ENTONCES** el drill no evalúa la pérdida de datos y lo registra

### Requirement: Duración del drill dentro del objetivo de RTO
El drill DEBE (MUST) avisar un fallo cuando la duración total, desde el inicio del restore hasta el fin de las verificaciones, supera 60 minutos, aunque la copia sea íntegra.
Trace: NFR-REL-002 · Priority: Should

#### Scenario: Drill lento
- **CUANDO** el restore y la recuperación terminan íntegros pero la duración total es de 72 min
- **ENTONCES** el drill registra la duración y avisa un fallo por superar el objetivo de 60 min

### Requirement: Espacio en disco antes del drill
Antes de restaurar, el drill DEBE (MUST) comprobar que el espacio libre del disco de los contenedores alcanza para la copia con margen, y NO DEBE (MUST NOT) restaurar si no alcanza.
Trace: NFR-REL-005, NFR-OBS-005 · Priority: Should

#### Scenario: Disco sin espacio para la copia
- **CUANDO** el último respaldo es de una base de 4 GiB y quedan 6 GiB libres, menos que los 7 GiB que pide el margen (1,25 × 4 GiB + 2 GiB)
- **ENTONCES** el drill no restaura, registra el motivo y avisa el fallo

### Requirement: Verificación semanal de los repositorios de respaldo
El host DEBE (MUST) verificar una vez por semana la integridad de los archivos de los dos repositorios de respaldo con la credencial de solo lectura, fuera del contenedor de la base, y avisar el fallo al heartbeat de la verificación si algún archivo es inválido o la verificación no termina.
Trace: NFR-REL-005, NFR-OBS-005 · Priority: Must

#### Scenario: Archivo corrupto en el repositorio mensual
- **CUANDO** la verificación del miércoles encuentra un archivo del repositorio mensual con un checksum que no coincide
- **ENTONCES** avisa el fallo al heartbeat de la verificación nombrando el repositorio

#### Scenario: Repositorios sanos
- **CUANDO** la verificación de los dos repositorios termina sin archivos inválidos
- **ENTONCES** avisa éxito al heartbeat de la verificación

### Requirement: Drill fuera del host cada trimestre
El procedimiento de operación DEBE (MUST) incluir un drill trimestral que restaure en una máquina efímera distinta del host, con la credencial de solo lectura, ejecute las mismas verificaciones de integridad y registre el RTO observado, y DEBE (MUST) indicar que el drill del host no cubre un host comprometido.
Trace: NFR-REL-002, NFR-REL-005 · Priority: Should

#### Scenario: Drill trimestral registrado
- **CUANDO** el owner ejecuta el drill fuera del host en el primer mes del trimestre
- **ENTONCES** el registro trimestral tiene la hora de inicio y fin, el RTO observado, el tamaño restaurado y el resultado de las verificaciones

### Requirement: Operaciones del host serializadas con el deploy
El drill, la verificación de los repositorios y la limpieza de imágenes NO DEBEN (MUST NOT) correr a la vez que un deploy ni entre sí; un deploy que encuentra una de ellas en curso DEBE (MUST) fallar sin cambiar nada e informar cuál es.
Trace: NFR-REL-006 · Priority: Should

#### Scenario: Deploy durante el drill
- **CUANDO** se lanza un deploy mientras corre el drill mensual
- **ENTONCES** el deploy falla sin tocar el release actual e informa que hay un drill en curso

#### Scenario: Verificación que coincide con el drill
- **CUANDO** la verificación semanal arranca mientras corre el drill
- **ENTONCES** espera a que el drill termine y después corre

### Requirement: Limpieza semanal de imágenes que conserva el release actual y el anterior
El host DEBE (MUST) borrar una vez por semana las imágenes de contenedor que no usa ningún contenedor, salvo las del release actual, las del release anterior registrado y la de la réplica de documentos, y avisar el resultado al heartbeat de la limpieza. Sin registro de releases DEBE (MUST) borrar solo las imágenes sin referencia.
Trace: NFR-REL-006, NFR-REL-013, NFR-OBS-005 · Priority: Must

#### Scenario: Tres releases en el registro
- **CUANDO** el registro de releases tiene los releases A, B y C (C es el actual) y el host conserva las imágenes de los tres
- **ENTONCES** la limpieza borra las imágenes de A y conserva las de B y C y las de los servicios en marcha
- **Y** un rollback a B arranca sin descargar sus imágenes

#### Scenario: Registro de releases ausente
- **CUANDO** el registro de releases no existe
- **ENTONCES** la limpieza borra solo las imágenes sin referencia y lo registra

### Requirement: Alerta de disco por encima del 80 %
La verificación horaria del host DEBE (MUST) avisar un fallo al heartbeat cuando cualquier sistema de archivos del sistema, de los contenedores o del estado del host supera el 80 % de uso, aunque las demás verificaciones fallen, nombrando el punto de montaje y el porcentaje.
Trace: NFR-OBS-005, NFR-REL-001 · Priority: Must

#### Scenario: Disco al 83 %
- **CUANDO** el disco del host está al 83 % de uso y el archivado de WAL está al día
- **ENTONCES** la verificación horaria avisa un fallo que nombra el punto de montaje y el 83 %

#### Scenario: Disco al 79 %
- **CUANDO** el disco está al 79 % y las demás verificaciones pasan
- **ENTONCES** la verificación horaria avisa éxito

#### Scenario: Disco lleno con el archivado caído
- **CUANDO** el disco está al 95 % y la verificación del archivado de WAL falla
- **ENTONCES** el aviso de fallo nombra las dos causas

### Requirement: Clave privada de las conexiones disponible solo para el worker
El despliegue DEBE (MUST) proveer al worker, y a ningún otro servicio, el archivo de la clave privada de las conexiones de solo lectura, legible solo por el usuario del worker; si el archivo no existe, el despliegue DEBE (MUST) crearlo vacío con esos permisos, y si existe NO DEBE (MUST NOT) cambiar su contenido.
Trace: NFR-SEC-007 · Priority: Must

#### Scenario: Primer deploy sin la clave
- **CUANDO** el host no tiene el archivo de la clave privada y se despliega un release
- **ENTONCES** el archivo existe vacío, con dueño el usuario del worker y permisos 0400, y el worker arranca sano

#### Scenario: Clave ya cargada con permisos abiertos
- **CUANDO** el archivo tiene la clave del owner con permisos 0644
- **ENTONCES** el deploy deja permisos 0400 y dueño el usuario del worker sin cambiar el contenido

#### Scenario: Solo el worker la ve
- **CUANDO** se inspeccionan los servicios del release
- **ENTONCES** solo el worker tiene montado el archivo, y la API no
