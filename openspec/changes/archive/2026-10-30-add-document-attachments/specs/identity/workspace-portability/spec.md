## ADDED Requirements

### Requirement: Documentos y adjuntos en el export
El export DEBE (MUST) incluir los metadatos de todos los documentos del workspace (nombre original, tipos declarado y detectado, tamaño, suma SHA-256, propósito, estado, fechas y archivado) y todos sus vínculos con los elementos del workspace, y NO DEBE (MUST NOT) incluir claves de datos, claves envueltas ni claves de objeto. La importación DEBE (MUST) restaurar documentos y vínculos con identificadores nuevos coherentes con los del resto del workspace; un documento disponible en el origen DEBE (MUST) quedar con "contenido pendiente de restaurar" hasta que se restaure su contenido, y un documento eliminado o rechazado DEBE (MUST) conservar su estado.
Trace: FR-IDENTITY-010, FR-DOCUMENTS-003, NFR-REL-014 · Priority: Must

#### Scenario: Ida y vuelta de metadatos y vínculos
- **CUANDO** "W1" tiene 3 documentos disponibles, 1 eliminado y 4 vínculos con dos gastos y un préstamo, y el OWNER exporta e importa
- **ENTONCES** el workspace nuevo tiene los 4 documentos con sus nombres, tamaños y sumas, y los 4 vínculos apuntan a las copias de los dos gastos y del préstamo
- **Y** los 3 documentos disponibles en el origen quedan con contenido pendiente de restaurar y el eliminado sigue eliminado

#### Scenario: Sin claves en el export
- **CUANDO** se inspecciona el export de "W1"
- **ENTONCES** no contiene claves de datos, claves envueltas, identificadores de clave maestra ni claves de objeto de los documentos

### Requirement: Archivo de contenidos de documentos del export
Al solicitar el export, el OWNER DEBE (MUST) poder pedir también el archivo de contenidos de los documentos disponibles, generado y cifrado en reposo como el export, con la suma SHA-256 de cada contenido, descargable por separado con los mismos requisitos y la misma retención que el export y sin cambiar el tamaño ni el límite del archivo principal. Sobre el workspace restaurado, el OWNER DEBE (MUST) poder restaurar ese archivo: cada contenido cuya suma coincide con la de su documento DEBE (MUST) volver a cifrarse con claves nuevas y dejar el documento disponible; un contenido alterado o ausente DEBE (MUST) dejar su documento con contenido pendiente e informarse, y repetir la restauración NO DEBE (MUST NOT) duplicar nada.
Trace: FR-IDENTITY-010, NFR-REL-014, NFR-SEC-006 · Priority: Should

#### Scenario: Restaurar los contenidos
- **CUANDO** el OWNER restaura sobre el workspace importado el archivo de contenidos de los 3 documentos disponibles de "W1"
- **ENTONCES** los 3 documentos quedan disponibles y su descarga devuelve contenidos con las sumas originales

#### Scenario: Contenido alterado en el archivo
- **CUANDO** uno de los 3 contenidos del archivo fue modificado y el OWNER lo restaura
- **ENTONCES** 2 documentos quedan disponibles, el tercero sigue con contenido pendiente y el resultado informa su identificador con el motivo suma distinta

#### Scenario: Restauración repetida
- **CUANDO** el OWNER restaura dos veces el mismo archivo de contenidos
- **ENTONCES** la segunda restauración no crea objetos ni registros nuevos y deja los 3 documentos disponibles
