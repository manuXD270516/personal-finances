## ADDED Requirements

### Requirement: Servicio de pronósticos en el perfil ml
El perfil `ml` DEBE (MUST) levantar el servicio de pronósticos con la misma imagen que producción, con su chequeo de salud, sin credenciales de la base de datos ni del almacenamiento de objetos y en una red interna compartida solo con el worker; su puerto DEBE (MUST) publicarse en el host solo en la dirección de loopback. Ningún servicio del perfil `core` DEBE (MUST) depender del servicio de pronósticos para arrancar ni para quedar healthy.
Trace: NFR-PORT-001, NFR-REL-010, FR-FORECAST-006 · Priority: Must

#### Scenario: Stack sin el perfil ml
- **CUANDO** el desarrollador levanta solo el perfil `core`
- **ENTONCES** todos los servicios de `core` quedan healthy y el servicio de pronósticos no se inicia

#### Scenario: Stack con el perfil ml
- **CUANDO** el desarrollador levanta `core` junto con `ml`
- **ENTONCES** el servicio de pronósticos queda healthy y el worker lo alcanza por la red interna
- **Y** el servicio no tiene variables de conexión a la base de datos ni al almacenamiento de objetos
