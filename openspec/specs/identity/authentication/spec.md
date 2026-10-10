# identity/authentication Specification

## Purpose
Define cómo una persona inicia sesión en PFOS mediante un proveedor de identidad OIDC a través del BFF, cómo se mantiene y termina su sesión sin exponer tokens al navegador, cómo la API valida cada petición y cómo se obtiene el perfil del usuario autenticado.

## Requirements

### Requirement: Inicio de sesión OIDC mediante el BFF
El sistema DEBE (MUST) autenticar a los usuarios con OIDC Authorization Code + PKCE (S256) ejecutado por el BFF, con `state` y `nonce` de un solo uso, y DEBE (MUST) establecer la sesión del navegador solo mediante una cookie con identificador opaco marcada `HttpOnly`, `Secure` y `SameSite=Lax`.
Trace: FR-IDENTITY-001, NFR-SEC-001 · Priority: Must

#### Scenario: Usuario sin sesión es redirigido al proveedor de identidad
- **CUANDO** un usuario sin sesión abre cualquier página de la aplicación
- **ENTONCES** el BFF lo redirige al endpoint de autorización del proveedor de identidad con `response_type=code`, `code_challenge_method=S256`, `state` y `nonce`

#### Scenario: Login exitoso crea una cookie de sesión segura
- **CUANDO** el usuario completa el login y el proveedor redirige al callback del BFF con un `code` y el `state` emitido
- **ENTONCES** el BFF responde con una cookie de sesión `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, sin atributo `Domain`
- **Y** el valor de la cookie es un identificador opaco que no contiene ningún token

#### Scenario: Callback con state reutilizado es rechazado
- **CUANDO** el callback del BFF recibe un `state` que ya fue consumido o que nunca fue emitido
- **ENTONCES** el BFF rechaza el login sin crear sesión y redirige a una página de error en español

### Requirement: Tokens fuera del alcance del navegador
El sistema NO DEBE (MUST NOT) entregar access tokens, refresh tokens ni id tokens al navegador: no DEBEN (MUST) aparecer en cookies legibles por JavaScript, `localStorage`, `sessionStorage`, el HTML ni los cuerpos JSON que el BFF devuelve; el BFF DEBE (MUST) guardarlos cifrados del lado servidor.
Trace: FR-IDENTITY-001, NFR-SEC-001 · Priority: Must

#### Scenario: Ningún token es observable desde el navegador
- **CUANDO** un usuario autenticado navega por las páginas principales y el BFF atiende sus peticiones
- **ENTONCES** `document.cookie`, `localStorage` y `sessionStorage` no contienen ningún access, refresh ni id token
- **Y** ninguna respuesta HTML o JSON servida al navegador contiene un token

#### Scenario: Tokens cifrados en el almacén de sesiones
- **CUANDO** se inspecciona el registro de una sesión activa en el almacén de sesiones del BFF
- **ENTONCES** los tokens están cifrados y no son legibles en texto plano

### Requirement: Acceso autenticado a la API
La API DEBE (MUST) exigir en toda ruta bajo `/api/v1` un access token JWT válido: firma con algoritmo permitido y clave del JWKS del emisor configurado, `iss` exacto, `aud` que incluya la API, `exp`/`nbf` con tolerancia máxima de 30 s y scope de la API; ante cualquier fallo DEBE (MUST) responder 401 con código `UNAUTHENTICATED` sin revelar el motivo interno.
Trace: FR-IDENTITY-001, NFR-SEC-002 · Priority: Must

#### Scenario: Petición sin token o con token inválido
- **CUANDO** se llama a `GET /api/v1/workspaces` sin token, con un token expirado, con audiencia incorrecta, firmado con una clave desconocida o con `alg` `none`
- **ENTONCES** la respuesta es 401 `application/problem+json` con código `UNAUTHENTICATED`
- **Y** el cuerpo no contiene datos de negocio ni el detalle de qué validación falló

#### Scenario: Petición con token válido
- **CUANDO** se llama a `GET /api/v1/workspaces` con un access token válido de un usuario provisionado
- **ENTONCES** la respuesta es 200

#### Scenario: Endpoints de salud fuera de la autenticación
- **CUANDO** se llama a `GET /health/live` sin token
- **ENTONCES** la respuesta no es 401

### Requirement: Provisión del usuario en el primer acceso
En el primer acceso autenticado de una identidad (`iss`, `sub`) desconocida, el sistema DEBE (MUST) crear exactamente un usuario con su email verificado y nombre visible tomados del token; los accesos siguientes DEBEN (MUST) reutilizarlo y actualizar email y nombre si cambiaron. NO DEBE (MUST NOT) provisionar identidades cuyo email no esté verificado.
Trace: FR-IDENTITY-001, FR-IDENTITY-003, NFR-SEC-002 · Priority: Must

#### Scenario: Primer acceso crea el usuario
- **CUANDO** llega la primera petición con un token válido de `sub` "kc-0001" y email verificado "owner@demo.pfos.test"
- **ENTONCES** existe exactamente un usuario asociado a ese emisor y `sub`, con email "owner@demo.pfos.test"

#### Scenario: Accesos concurrentes no duplican el usuario
- **CUANDO** llegan simultáneamente dos primeras peticiones con el mismo emisor y `sub`
- **ENTONCES** existe exactamente un usuario para esa identidad y ambas peticiones se atienden con él

#### Scenario: Email no verificado
- **CUANDO** llega la primera petición con un token válido cuyo email no está verificado
- **ENTONCES** la respuesta es 401 con código `UNAUTHENTICATED`
- **Y** no se crea ningún usuario

### Requirement: Renovación de sesión con refresh de un solo vuelo
Cuando el access token de una sesión esté por expirar, el BFF DEBE (MUST) renovarlo usando el refresh token bajo un bloqueo exclusivo por sesión, de modo que peticiones concurrentes de la misma sesión provoquen como máximo una renovación ante el proveedor y todas usen el token renovado.
Trace: FR-IDENTITY-002, NFR-SEC-017 · Priority: Must

#### Scenario: Peticiones concurrentes con el token por expirar
- **CUANDO** una sesión cuyo access token expira en menos de 60 s envía cinco peticiones simultáneas al BFF
- **ENTONCES** el BFF realiza exactamente una renovación ante el proveedor de identidad
- **Y** las cinco peticiones se completan con éxito y la sesión sigue activa

#### Scenario: Refresh rechazado por el proveedor
- **CUANDO** el proveedor rechaza la renovación porque el refresh token fue revocado
- **ENTONCES** el BFF elimina la sesión y responde 401 con código `UNAUTHENTICATED`, exigiendo un nuevo login

### Requirement: Cierre de sesión
El sistema DEBE (MUST) permitir cerrar sesión eliminando la sesión del BFF, revocando el refresh token ante el proveedor e iniciando el cierre de sesión en el proveedor; tras el cierre, la cookie anterior NO DEBE (MUST NOT) dar acceso.
Trace: FR-IDENTITY-002, NFR-SEC-017 · Priority: Must

#### Scenario: Logout invalida la sesión
- **CUANDO** un usuario autenticado cierra sesión
- **ENTONCES** la sesión se elimina del almacén de sesiones y la cookie se borra en el navegador
- **Y** el navegador es redirigido al cierre de sesión del proveedor de identidad

#### Scenario: Reutilizar la cookie tras el logout
- **CUANDO** se envía al BFF una petición con la cookie de una sesión ya cerrada
- **ENTONCES** la respuesta es 401 con código `UNAUTHENTICATED` y no se reenvía ninguna petición a la API

### Requirement: Expiración de sesión por inactividad y duración absoluta
La sesión del BFF DEBE (MUST) expirar tras un periodo de inactividad configurable (por defecto 30 min) y tras una duración absoluta configurable desde el login (por defecto 12 h), aunque haya actividad; una sesión expirada DEBE (MUST) exigir un nuevo login.
Trace: FR-IDENTITY-002, NFR-SEC-017 · Priority: Must

#### Scenario: Expiración por inactividad
- **CUANDO** una sesión no registra actividad durante 30 min y luego el usuario intenta una acción
- **ENTONCES** el BFF responde 401 con código `UNAUTHENTICATED` y la interfaz solicita un nuevo login

#### Scenario: Expiración absoluta con actividad continua
- **CUANDO** una sesión con actividad cada 5 min alcanza 12 h desde el login
- **ENTONCES** la siguiente petición exige un nuevo login

### Requirement: Protección CSRF en mutaciones vía BFF
El BFF DEBE (MUST) rechazar con 403 toda petición con método no seguro que no traiga un token anti-CSRF válido ligado a la sesión o cuyo `Origin` no sea el de la aplicación, sin reenviarla a la API.
Trace: NFR-SEC-008 · Priority: Must

#### Scenario: Mutación sin token anti-CSRF
- **CUANDO** un usuario autenticado envía al BFF un `POST` para registrar un gasto de 75.00 BOB sin token anti-CSRF
- **ENTONCES** la respuesta es 403
- **Y** la API no recibe la petición y no se registra ningún gasto

#### Scenario: Mutación desde otro origen
- **CUANDO** el BFF recibe un `POST` con cookie de sesión válida y `Origin` de un sitio ajeno
- **ENTONCES** la respuesta es 403 y la petición no se reenvía a la API

### Requirement: Perfil del usuario autenticado
La API DEBE (MUST) exponer en `/api/v1/me` el perfil del usuario autenticado: id, nombre visible, email, locale preferido, zona horaria preferida y la lista de workspaces donde tiene membresía activa con su rol. Si el locale guardado no es uno de los idiomas soportados (es, en, pt), la consulta DEBE (MUST) responder igual, con el locale por defecto de la aplicación en su lugar.
Trace: FR-IDENTITY-003 · Priority: Must

#### Scenario: Consulta del perfil
- **CUANDO** el usuario "owner@demo.pfos.test", OWNER de "W1 Personal Demo" y de "W2 Other Demo", consulta su perfil
- **ENTONCES** la respuesta incluye su id, nombre visible, email, locale "es-BO" y zona horaria "America/La_Paz"
- **Y** la lista de membresías contiene exactamente "W1 Personal Demo" con rol OWNER y "W2 Other Demo" con rol OWNER

#### Scenario: Membresías revocadas no aparecen
- **CUANDO** un usuario tiene una membresía revocada en un workspace y consulta su perfil
- **ENTONCES** ese workspace no aparece en la lista de membresías

#### Scenario: Locale guardado no soportado
- **CUANDO** el locale guardado de un usuario es "fr-FR" y el locale por defecto de la aplicación es "es-BO"
- **ENTONCES** la consulta de su perfil responde 200 con locale "es-BO"

### Requirement: Preferencias personales del usuario
El usuario autenticado DEBE (MUST) poder actualizar su nombre visible, locale y zona horaria preferidos usando control de concurrencia optimista; una zona horaria que no sea un identificador IANA válido DEBE (MUST) rechazarse.
Trace: FR-IDENTITY-003 · Priority: Should

#### Scenario: Actualización de locale y zona horaria
- **CUANDO** el usuario cambia su locale a "en-US" y su zona horaria a "America/Sao_Paulo" enviando la versión vigente de su perfil
- **ENTONCES** el perfil devuelve locale "en-US" y zona horaria "America/Sao_Paulo" con una versión nueva

#### Scenario: Zona horaria inválida
- **CUANDO** el usuario envía la zona horaria "Bolivia/LaPaz"
- **ENTONCES** la respuesta es 422 con código `INVALID_TIMEZONE` y el perfil no cambia
