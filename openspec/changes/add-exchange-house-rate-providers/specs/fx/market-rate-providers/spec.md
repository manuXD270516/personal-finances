## ADDED Requirements

### Requirement: Proveedores de tasas por institución solo con términos verificados
Un proveedor de tasas por institución (publicación de un banco central, de una entidad o de un agregador) DEBE (MUST) habilitarse solo si su verificación de términos de uso y licencia está registrada como apta en un ADR, con fecha, URLs revisadas, atribución exigida y límites; sin esa verificación, NO DEBE (MUST NOT) enviarse ninguna solicitud a la fuente, ni siquiera de prueba en CI, y las instituciones que cubriría DEBEN (MUST) seguir `IN_VERIFICATION` en tasas. Una fuente cuyos términos prohíben la consulta automatizada DEBE (MUST) registrarse como no apta y NO DEBE (MUST NOT) consultarse por ningún medio alternativo.
Trace: FR-FX-009, FR-FX-015, NFR-COMP-007 · Priority: Must

#### Scenario: Proveedor sin verificación configurado
- **CUANDO** la configuración de la instalación habilita un proveedor de tasas por institución sin verificación registrada
- **ENTONCES** ese proveedor queda deshabilitado con `FX_PROVIDER_CONFIG_INVALID` y no envía solicitudes
- **Y** los providers ya verificados (paralela, oficial y cripto) siguen funcionando

#### Scenario: Fuente con términos que prohíben la automatización
- **CUANDO** la verificación registra que los términos de una fuente prohíben la consulta automatizada
- **ENTONCES** la fuente queda no apta con la razón "términos prohíben la automatización"
- **Y** ningún adapter la consulta y las instituciones que cubriría quedan `NOT_ELIGIBLE` con esa razón o `IN_VERIFICATION` si existe otra candidata por evaluar

### Requirement: Compra y venta por institución como tipos de tasa propios
Un proveedor verificado DEBE (MUST) registrar la cotización publicada por cada institución como tasa histórica inmutable con el código de la institución, usando `BANK_BUY` para el precio que el owner paga al comprar la moneda base y `BANK_SELL` para el precio que recibe al venderla (convención "desde el lado del owner", D39), con lectura exacta del valor publicado. NO DEBE (MUST NOT) registrar un lado que la fuente no publica ni calcular un punto medio `BANK` que la fuente no publica.
Trace: FR-FX-002, FR-FX-009, NFR-DATA-006 · Priority: Must

#### Scenario: La fuente publica solo la compra de cada entidad
- **CUANDO** una fuente verificada publica, con vigencia 2026-10-08, que la entidad `BAD` compra USD a 11.85 BOB y la entidad `BBD` a 12.03 BOB
- **ENTONCES** se registran dos tasas USD/BOB `BANK_SELL`: 11.85 con código `BAD` y 12.03 con código `BBD`, con fuente `PROVIDER`, el id del proveedor y la vigencia publicada
- **Y** no se registra ninguna tasa `BANK_BUY` ni `BANK` para esas entidades en esa fecha

#### Scenario: La fuente publica compra y venta
- **CUANDO** una fuente verificada publica que `BAD` vende USD a 11.95 BOB y compra a 11.85 BOB
- **ENTONCES** se registran USD/BOB `BANK_BUY` 11.95 y `BANK_SELL` 11.85 con código `BAD`

#### Scenario: Valor con más decimales de los habituales
- **CUANDO** la fuente publica 11.8537 para la compra de `BAD`
- **ENTONCES** se registra exactamente 11.8537 sin pasar por punto flotante

### Requirement: Las tasas por institución no valoran por defecto
La selección de la tasa de valoración NO DEBE (MUST NOT) usar tasas `BANK_BUY` ni `BANK_SELL` salvo que el workspace las haya fijado como tipo preferido del par; DEBEN (MUST) quedar disponibles en el historial de tasas, como referencia elegible para registrar una conversión y para el análisis de costo de conversiones.
Trace: FR-FX-006, FR-FX-008, FR-FX-011 · Priority: Must

#### Scenario: Valoración sin preferencia
- **CUANDO** existen USD/BOB `PARALLEL` 12.02 y `BANK_SELL` 11.85 de `BAD` con la misma vigencia y el workspace no tiene preferencia para USD/BOB
- **ENTONCES** 100.00 USD se valoran en 1202.00 BOB con la tasa `PARALLEL`

#### Scenario: Referencia de una conversión
- **CUANDO** el usuario registra la venta de 100.00 USD en "Bank A" (institución vinculada a `BAD`) y elige como referencia la tasa `BANK_SELL` 11.85 de `BAD`
- **ENTONCES** la conversión guarda esa tasa como referencia (id y versión)
- **Y** el análisis de costo compara la tasa efectiva contra 11.85

### Requirement: Estado de las tasas por institución consultable
El estado de providers DEBE (MUST) informar, para cada institución cubierta por un proveedor habilitado, su código, los tipos de tasa recibidos, la vigencia de la última tasa, su antigüedad y si está obsoleta según el umbral configurado para tasas por institución, y para las instituciones adoptadas por el workspace sin proveedor habilitado, su estado de soporte en tasas y la razón. La consulta NO DEBE (MUST NOT) llamar a ningún proveedor.
Trace: FR-FX-016 · Priority: Should

#### Scenario: Institución cubierta y obsoleta
- **CUANDO** la última tasa `BANK_SELL` de `BAD` tiene vigencia de hace 80 horas y el umbral de obsolescencia de tasas por institución es 72 horas
- **ENTONCES** el estado informa `BAD` con `BANK_SELL`, antigüedad de 80 horas y obsoleta

#### Scenario: Institución adoptada sin proveedor
- **CUANDO** el workspace adoptó `CID`, cuyo estado en tasas es `NOT_ELIGIBLE` con razón "sin publicación de tasas"
- **ENTONCES** el estado informa `CID` sin tasas automáticas con esa razón
