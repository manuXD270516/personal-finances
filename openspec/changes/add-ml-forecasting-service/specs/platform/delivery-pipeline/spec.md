## ADDED Requirements

### Requirement: Gate del servicio de pronósticos en el pull request
Toda pull request que cambie el servicio de pronósticos o su contrato DEBE (MUST) ejecutar y aprobar el lint y el chequeo de tipos del servicio, sus tests (incluidas las propiedades de los intervalos y el determinismo con semilla fija), la verificación de que el contrato publicado coincide con el que expone el servicio, los tests de contrato del lado del monolito contra los mismos ejemplos y el escaneo de sus dependencias con lockfile.
Trace: NFR-MAINT-001, NFR-SEC-013, FR-FORECAST-006 · Priority: Must

#### Scenario: Contrato desalineado
- **CUANDO** una pull request agrega un campo obligatorio a la respuesta del servicio sin actualizar el contrato publicado
- **ENTONCES** falla la verificación del contrato y la pull request no puede fusionarse

#### Scenario: Propiedad de intervalos rota
- **CUANDO** un cambio en el servicio produce un límite inferior mayor que el valor esperado para alguna serie de los ejemplos
- **ENTONCES** fallan los tests del servicio

### Requirement: Imagen del servicio de pronósticos promovida por digest
La imagen del servicio de pronósticos DEBE (MUST) construirse una sola vez por commit en la rama principal, ejecutarse sin privilegios de root y con el sistema de archivos de solo lectura, escanearse con el mismo criterio de vulnerabilidades críticas que las demás imágenes, publicarse con su SBOM y desplegarse por digest junto con las demás imágenes de la versión.
Trace: NFR-PORT-006, NFR-SEC-013, NFR-SEC-014 · Priority: Must

#### Scenario: Imagen con vulnerabilidad crítica
- **CUANDO** el escaneo de la imagen del servicio de pronósticos reporta una vulnerabilidad crítica con corrección disponible y sin excepción registrada
- **ENTONCES** el pipeline de la rama principal falla y la imagen no se publica

#### Scenario: Despliegue por digest
- **CUANDO** se despliega una versión con el perfil `ml` habilitado en el host
- **ENTONCES** el servicio de pronósticos ejecuta la imagen con el digest que produjo la corrida exitosa de la rama principal

### Requirement: Despliegue opcional del servicio de pronósticos en el host
El despliegue en el host DEBE (MUST) admitir el servicio de pronósticos como opcional: habilitado, corre con límites de memoria y CPU propios, sin puertos públicos y con la credencial de servicio montada como secreto de archivo; deshabilitado, el despliegue y el resto del producto DEBEN (MUST) funcionar sin él.
Trace: NFR-PORT-006, NFR-REL-010, FR-FORECAST-006 · Priority: Should

#### Scenario: Host sin el servicio de pronósticos
- **CUANDO** se despliega una versión en el host con el servicio de pronósticos deshabilitado
- **ENTONCES** el despliegue termina con todos los demás servicios healthy y la función de pronóstico informa que no está habilitada
