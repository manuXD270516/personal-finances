## MODIFIED Requirements

### Requirement: Salida de red del worker en el entorno en contenedores
En el entorno local en contenedores (producto completo), el proceso que consulta a los providers DEBE (MUST) poder abrir conexiones HTTPS salientes hacia paralelo.bo y bo.dolarapi.com y DEBE (MUST) recibir la configuración de providers del contrato único de configuración, sin valores fijados en la definición de contenedores; las suites de prueba DEBEN (MUST) seguir sin red con los providers deshabilitados. La única red interna (sin salida a Internet) a la que el worker puede conectarse además de las redes con salida es `ml-internal`, compartida con el servicio de pronósticos (ADR-0033).
Trace: FR-FX-009, FR-FX-015 · Priority: Should

#### Scenario: Stack en contenedores
- **CUANDO** el producto completo se levanta en contenedores con la configuración de `.env`
- **ENTONCES** el contenedor del worker está conectado al menos a una red con salida (no interna), y la única red interna a la que se conecta es `ml-internal`
- **Y** sus variables `FX_*` son las del `.env`

#### Scenario: Suite de contenedores sin red
- **CUANDO** se ejecuta la suite de contenedores del stack
- **ENTONCES** los providers figuran deshabilitados y no se envía ninguna solicitud externa
