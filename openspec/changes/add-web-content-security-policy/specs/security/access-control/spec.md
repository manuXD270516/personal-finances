## ADDED Requirements

### Requirement: Política de seguridad de contenido con nonce por petición en las páginas de la web
Toda respuesta HTML de la web DEBE (MUST) declarar una política de seguridad de contenido aplicada (no solo informativa) en la que los scripts se autoricen únicamente con un nonce aleatorio de al menos 128 bits, distinto en cada petición, y DEBE (MUST) llevar ese nonce en todos los scripts que la propia web emite. En producción la política NO DEBE (MUST NOT) permitir scripts en línea sin nonce ni la evaluación dinámica de código.
Trace: NFR-SEC-008 · Priority: Must

#### Scenario: Scripts de la página con el nonce de la cabecera
- **CUANDO** un usuario con sesión abre el Home de la web en producción
- **ENTONCES** la respuesta trae la cabecera de política de seguridad de contenido aplicada con un nonce en la directiva de scripts
- **Y** todos los elementos de script del HTML llevan ese mismo nonce
- **Y** la directiva de scripts no contiene la autorización de scripts en línea ni la de evaluación dinámica

#### Scenario: Nonce distinto en cada petición
- **CUANDO** el usuario carga dos veces la misma página
- **ENTONCES** las dos respuestas traen nonces distintos

#### Scenario: Página pública también protegida
- **CUANDO** un visitante sin sesión abre la página de error de login
- **ENTONCES** la respuesta trae la misma política con un nonce propio y sus scripts lo llevan

### Requirement: Orígenes permitidos por la política de la web
La política de la web DEBE (MUST) limitar todos los recursos al propio origen, salvo las conexiones del navegador, que DEBEN (MUST) permitir además solo el origen público de subida de documentos configurado; DEBE (MUST) prohibir objetos embebidos, la etiqueta de URL base y los envíos de formularios a otros orígenes. Las imágenes PUEDEN venir además de URL `data:` y `blob:`.
Trace: NFR-SEC-008, FR-DOCUMENTS-001 · Priority: Must

#### Scenario: Subida de un documento al hostname de archivos
- **CUANDO** el origen público de subida configurado es el hostname de archivos y el usuario adjunta un PDF a una transacción
- **ENTONCES** la directiva de conexiones de la política incluye ese origen
- **Y** la subida directa termina sin ninguna violación de la política

#### Scenario: Origen no autorizado
- **CUANDO** una página intenta conectarse a un origen que no es el propio ni el de subida
- **ENTONCES** el navegador bloquea la conexión y registra una violación de la política

### Requirement: La web no se puede enmarcar desde ningún origen
Toda respuesta de los hostnames de la web y de subida de archivos, sea una página, una respuesta del BFF, un recurso estático o un error, DEBE (MUST) prohibir que otro documento la enmarque; el borde NO DEBE (MUST NOT) reemplazar la política propia que traiga una respuesta.
Trace: NFR-SEC-008 · Priority: Must

#### Scenario: Página enmarcada por un sitio ajeno
- **CUANDO** un sitio ajeno incrusta el Home de la web en un iframe
- **ENTONCES** el navegador no muestra la página porque la política declara que ningún origen puede enmarcarla

#### Scenario: Respuesta sin política propia
- **CUANDO** el navegador pide un recurso estático de la web o una ruta inexistente del hostname de archivos
- **ENTONCES** la respuesta trae una política por omisión que no permite contenido y prohíbe el enmarcado

#### Scenario: La descarga de un documento conserva su política
- **CUANDO** el usuario descarga un documento por la API
- **ENTONCES** la respuesta conserva su política propia de entorno aislado y el borde no la reemplaza

### Requirement: Estilos bajo la política de la web
Las hojas y elementos de estilo de la web DEBEN (MUST) venir del propio origen o llevar el nonce de la petición; la política DEBE (MUST) permitir los atributos de estilo en línea que la web genera al renderizar en el servidor, de modo que ninguna pantalla pierda estilos por la política.
Trace: NFR-SEC-008 · Priority: Must

#### Scenario: Vista con gráfico y estilos propios
- **CUANDO** el usuario abre el calendario de flujo de caja de 30 días
- **ENTONCES** la vista se muestra con sus estilos y su gráfico sin ninguna violación de la política

#### Scenario: Elemento de estilo sin nonce
- **CUANDO** una página contiene un elemento de estilo en línea sin el nonce de la petición
- **ENTONCES** el navegador no lo aplica y registra una violación de la política

### Requirement: Cabeceras complementarias en el borde de la web
El borde DEBE (MUST) agregar en las respuestas de la web una política de permisos que deshabilite cámara, micrófono, geolocalización, pagos y USB, y el aislamiento de la ventana respecto de otros orígenes, sin impedir el login ni el logout por redirección con el proveedor de identidad.
Trace: NFR-SEC-008, NFR-SEC-001 · Priority: Should

#### Scenario: Cabeceras en el Home
- **CUANDO** se pide el Home de la web por el borde de producción
- **ENTONCES** la respuesta trae la política de permisos con esas cinco funciones deshabilitadas y el aislamiento de ventana del mismo origen

#### Scenario: Login y logout con las cabeceras
- **CUANDO** el usuario inicia sesión y luego la cierra
- **ENTONCES** las dos redirecciones con el proveedor de identidad terminan en la web sin errores
