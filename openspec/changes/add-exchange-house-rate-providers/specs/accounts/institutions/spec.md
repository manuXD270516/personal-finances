## ADDED Requirements

### Requirement: Catálogo de referencia de instituciones por país
El producto DEBE (MUST) ofrecer, por país, un catálogo de referencia de instituciones de solo lectura, versionado como dato y no como código, en el que cada entrada tenga código (la sigla del registro oficial), nombre, categoría regulatoria, tipo de institución, sitio web opcional y estado en el registro (`ACTIVE` o `DELISTED`), y en el que el catálogo declare la fuente oficial, su fecha de corte y la fecha de consulta. El catálogo NO DEBE (MUST NOT) contener datos de ningún usuario ni workspace, logos ni marcas, y cualquier miembro del workspace DEBE (MUST) poder consultarlo con filtros por categoría y por texto.
Trace: FR-ACCOUNTS-012 · Priority: Must

#### Scenario: Consultar el catálogo de un país
- **CUANDO** la instalación tiene el catálogo "BO" versión "2026-09-30" con fuente "Registro Demo", fecha de corte 2026-09-30 y tres entradas ("Banco Andino Demo" `BAD`, categoría banco múltiple; "Cooperativa Illimani Demo" `CID`, cooperativa; "Billetera Altiplano Demo" `BAL`, servicio de pago móvil) y un VIEWER lo consulta
- **ENTONCES** recibe las tres entradas con su código, categoría, tipo y estado `ACTIVE`
- **Y** la respuesta informa la fuente, la fecha de corte 2026-09-30 y la versión "2026-09-30"

#### Scenario: Filtrar por categoría
- **CUANDO** el VIEWER consulta el catálogo "BO" filtrando por la categoría de cooperativas
- **ENTONCES** recibe solo "Cooperativa Illimani Demo"

#### Scenario: El catálogo no se mezcla con las instituciones del workspace
- **CUANDO** un workspace nuevo sin instituciones consulta el catálogo "BO"
- **ENTONCES** el catálogo muestra sus tres entradas
- **Y** el listado de instituciones del workspace sigue vacío

### Requirement: Adopción de instituciones desde el catálogo
Un EDITOR DEBE (MUST) poder adoptar una o más entradas del catálogo de referencia; cada entrada adoptada DEBE (MUST) crear en el workspace una institución normal (editable y archivable como cualquier otra) con el nombre, tipo, país y sitio web de la entrada y vinculada a su código y versión de catálogo, en una sola operación auditada. Adoptar una entrada ya vinculada a una institución activa del workspace NO DEBE (MUST NOT) crear otra; un código inexistente DEBE (MUST) rechazarse con `INSTITUTION_CATALOG_ENTRY_UNKNOWN` sin crear ninguna institución, y una entrada cuyo nombre ya usa otra institución activa no vinculada DEBE (MUST) informarse como conflicto `NAME_TAKEN` sin impedir las demás.
Trace: FR-ACCOUNTS-012 · Priority: Must

#### Scenario: Adoptar dos entradas
- **CUANDO** un EDITOR adopta `BAD` y `BAL` del catálogo "BO" en un workspace sin instituciones
- **ENTONCES** el workspace tiene "Banco Andino Demo" (tipo `BANK`, país "BO") y "Billetera Altiplano Demo" (tipo `WALLET_PROVIDER`), ambas vinculadas a su código y a la versión "2026-09-30"
- **Y** existe un registro de auditoría de la adopción con los dos códigos

#### Scenario: Adopción repetida
- **CUANDO** "Banco Andino Demo" ya está vinculada a `BAD` y el EDITOR vuelve a adoptar `BAD`
- **ENTONCES** no se crea otra institución y la respuesta la informa como ya vinculada

#### Scenario: Código desconocido
- **CUANDO** el EDITOR adopta `BAD` y `ZZZ`, que no existe en el catálogo "BO"
- **ENTONCES** se rechaza con `INSTITUTION_CATALOG_ENTRY_UNKNOWN` y no se crea ninguna institución

#### Scenario: Nombre ya usado por una institución propia
- **CUANDO** el workspace tiene "Banco Andino Demo" creada a mano y sin vínculo, y el EDITOR adopta `BAD` y `CID`
- **ENTONCES** se crea "Cooperativa Illimani Demo" vinculada a `CID`
- **Y** `BAD` se informa como conflicto `NAME_TAKEN` con el id de la institución existente, que el EDITOR puede vincular de forma explícita

#### Scenario: La institución adoptada es editable
- **CUANDO** el EDITOR renombra la institución adoptada de `BAD` a "Mi banco"
- **ENTONCES** la institución se llama "Mi banco" en ese workspace y conserva su vínculo con `BAD`
- **Y** el catálogo de referencia sigue mostrando "Banco Andino Demo"

#### Scenario: VIEWER no adopta
- **CUANDO** un VIEWER intenta adoptar `BAD`
- **ENTONCES** se rechaza con `INSUFFICIENT_ROLE`

### Requirement: Entrada retirada del registro oficial
Cuando una versión nueva del catálogo marque una entrada como `DELISTED` (por ejemplo, entidad intervenida, fusionada o sin licencia), las instituciones del workspace vinculadas a ella NO DEBEN (MUST NOT) archivarse, renombrarse ni desvincularse automáticamente, sus cuentas DEBEN (MUST) conservar saldo y asociación, y la institución DEBE (MUST) mostrarse con la indicación de que ya no figura en el registro desde la fecha de corte de esa versión. Una entrada `DELISTED` NO DEBE (MUST NOT) poder adoptarse.
Trace: FR-ACCOUNTS-012, FR-ACCOUNTS-013 · Priority: Should

#### Scenario: Entidad retirada con cuentas
- **CUANDO** "Bank A" (saldo 1000.00 BOB) está asociada a la institución adoptada de `BAD` y la versión "2026-12-31" del catálogo marca `BAD` como `DELISTED`
- **ENTONCES** la institución sigue activa en el workspace y "Bank A" conserva 1000.00 BOB
- **Y** la institución se muestra como "no figura en el registro desde 2026-12-31"

#### Scenario: Adoptar una entrada retirada
- **CUANDO** el EDITOR adopta `BAD` con la versión "2026-12-31" del catálogo
- **ENTONCES** se rechaza con `VALIDATION_FAILED` y no se crea ninguna institución

### Requirement: Estado de soporte por institución y dimensión
Cada entrada del catálogo DEBE (MUST) declarar su estado de soporte en dos dimensiones, tasas de cambio (`rates`) e importación de extractos (`statementImport`), con uno de los valores `SUPPORTED`, `IN_VERIFICATION`, `NOT_ELIGIBLE` o `NOT_APPLICABLE` y, solo en importación, también `GENERIC_ONLY` o `PENDING_SAMPLE`. Un estado `NOT_ELIGIBLE` DEBE (MUST) llevar una razón de un conjunto cerrado y la fecha de la evaluación; un estado `SUPPORTED` en tasas DEBE (MUST) referenciar al menos un proveedor con términos verificados; y la interfaz DEBE (MUST) mostrar el estado y la razón junto a cada entrada y a cada institución adoptada, sin presentar como soportada una dimensión que no lo está.
Trace: FR-ACCOUNTS-012, FR-FX-009, FR-IMPORTS-005 · Priority: Must

#### Scenario: Estados de una entrada
- **CUANDO** el catálogo declara para `BAD` tasas `IN_VERIFICATION` e importación `PENDING_SAMPLE`, y para `BAL` tasas `NOT_APPLICABLE` e importación `GENERIC_ONLY`
- **ENTONCES** la consulta del catálogo devuelve esos estados por entrada
- **Y** la institución adoptada de `BAD` muestra "tasas: en verificación" e "importación: pendiente de muestra"

#### Scenario: No apta sin razón
- **CUANDO** una versión del catálogo declara `CID` con tasas `NOT_ELIGIBLE` sin razón
- **ENTONCES** la validación del catálogo falla y esa versión no puede publicarse

#### Scenario: Soportada sin proveedor verificado
- **CUANDO** una versión del catálogo declara `BAD` con tasas `SUPPORTED` y un proveedor sin verificación de términos registrada
- **ENTONCES** la validación del catálogo falla

### Requirement: Medición del soporte completo
El producto DEBE (MUST) calcular, para el catálogo de un país y por categoría, la cobertura del censo oficial (entradas del catálogo frente a las entidades declaradas en la fuente a su fecha de corte) y, por dimensión, cuántas entradas están resueltas (`SUPPORTED`, `GENERIC_ONLY`, `NOT_ELIGIBLE` o `NOT_APPLICABLE`) y cuántas pendientes (`IN_VERIFICATION` o `PENDING_SAMPLE`), con el porcentaje redondeado HALF_EVEN a dos decimales. El soporte del país DEBE (MUST) informarse como completo solo cuando la cobertura del censo es 100.00 % y ninguna entrada activa está pendiente en ninguna dimensión; el informe DEBE (MUST) mostrar aparte cuántas entradas son `NOT_ELIGIBLE` y por qué razón.
Trace: FR-ACCOUNTS-012, FR-FX-009 · Priority: Must

#### Scenario: Soporte incompleto
- **CUANDO** el censo "BO" declara 3 entidades, el catálogo tiene las 3, y en tasas `BAD` está `IN_VERIFICATION`, `CID` `NOT_ELIGIBLE` y `BAL` `NOT_APPLICABLE`
- **ENTONCES** la cobertura del censo es 100.00 %
- **Y** en tasas hay 2 entradas resueltas y 1 pendiente (66.67 % resuelto), con 1 `NOT_ELIGIBLE` informada aparte con su razón
- **Y** el soporte del país se informa como no completo

#### Scenario: Soporte completo
- **CUANDO** ninguna entrada activa de "BO" está `IN_VERIFICATION` ni `PENDING_SAMPLE` y el catálogo cubre las 3 entidades del censo
- **ENTONCES** el soporte del país se informa como completo, con el desglose por estado y razón

#### Scenario: Las entradas retiradas no cuentan
- **CUANDO** `CID` está `DELISTED` e `IN_VERIFICATION` en tasas, y las demás entradas activas están resueltas
- **ENTONCES** `CID` no cuenta como pendiente y el soporte del país se informa como completo

### Requirement: Completitud del catálogo frente al censo oficial
Cada versión del catálogo DEBE (MUST) declarar, por categoría del alcance, el número de entidades del censo oficial a la fecha de corte, y la validación del catálogo DEBE (MUST) fallar si alguna categoría tiene menos entradas activas que su censo, si hay códigos repetidos o si falta la fuente, la fecha de corte o la fecha de consulta. Una entidad del censo que no pueda confirmarse en la fuente primaria DEBE (MUST) marcarse como pendiente de verificación en la versión y NO DEBE (MUST NOT) inventarse.
Trace: FR-ACCOUNTS-012, NFR-COMP-007 · Priority: Must

#### Scenario: Falta una entidad del censo
- **CUANDO** una versión declara un censo de 2 bancos múltiples y solo contiene `BAD` en esa categoría
- **ENTONCES** la validación del catálogo falla indicando la categoría y la diferencia de 1 entidad

#### Scenario: Código repetido
- **CUANDO** una versión contiene dos entradas con el código `BAD`
- **ENTONCES** la validación del catálogo falla

#### Scenario: Catálogo sin fecha de corte
- **CUANDO** una versión no declara la fecha de corte de su fuente
- **ENTONCES** la validación del catálogo falla
