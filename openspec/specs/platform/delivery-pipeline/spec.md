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
