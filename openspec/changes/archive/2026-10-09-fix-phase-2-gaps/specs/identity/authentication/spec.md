## MODIFIED Requirements

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
