## ADDED Requirements

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
Un pipeline programado una vez al día, que NO DEBE (MUST NOT) ser un check requerido de la rama principal, DEBE (MUST) cargar el Large Seed a escala completa a través de los casos de uso, medir el p95 del listado paginado de transacciones, de la búsqueda de texto en transacciones, de los comandos de escritura, del dashboard, del saldo as-of y de los reportes agregados, y fallar cuando algún p95 supere su umbral de los requisitos no funcionales. DEBE (MUST) publicar en cada corrida un reporte con el valor medido y el umbral de cada benchmark como artefacto, y un fallo del nightly NO DEBE (MUST NOT) bloquear las pull requests.
Trace: NFR-PERF-001, NFR-PERF-002, NFR-PERF-003, NFR-PERF-004, NFR-PERF-005, NFR-PERF-006 · Priority: Should

#### Scenario: Búsqueda de texto con el Large Seed
- **CUANDO** el nightly busca el texto "supermercado" en el workspace principal del Large Seed con al menos 50 000 transacciones, con 50 resultados por página
- **ENTONCES** el reporte incluye el p95 de la búsqueda frente al umbral de 400 ms
- **Y** el nightly falla si el p95 supera 400 ms

#### Scenario: Un p95 supera su umbral
- **CUANDO** el p95 del listado paginado de transacciones es 310 ms y su umbral local es 300 ms
- **ENTONCES** el nightly falla indicando el benchmark y el valor medido
- **Y** el reporte se publica como artefacto aunque la corrida falle

#### Scenario: Nightly en rojo no bloquea pull requests
- **CUANDO** la última corrida del nightly falló
- **ENTONCES** una pull request con todos los checks requeridos en verde puede fusionarse
