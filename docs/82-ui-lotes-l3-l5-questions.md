# 82: Preguntas para el owner sobre los lotes de UI L3, L4 y L5

> **Fecha:** 2026-11-25 · **Changes:** [`add-dark-theme`](../openspec/changes/add-dark-theme/proposal.md) (79, L3), [`refine-mobile-navigation`](../openspec/changes/refine-mobile-navigation/proposal.md) (80, L4) y [`refine-data-tables`](../openspec/changes/refine-data-tables/proposal.md) (81, L5) · **Relacionado:** [docs/78](78-propuesta-mejora-ui-ux-modern-web.md) (propuesta y viabilidad, § 11), [docs/79](79-ui-ux-modern-web-decisions.md) (D500–D512), [docs/28](28-ui-ux-design-system.md) §2.1, [docs/03](03-openspec-strategy.md) §7, [docs/38](38-estado-y-pendientes.md)

Al redactar los lotes L3 a L5 quedaron siete puntos que D500–D512 no cubren. Cada pregunta trae contexto, opciones y una recomendación. Las respuestas irán en el `docs/NN-…-decisions.md` siguiente.

## Resumen

| # | Lote | Tema | ¿Bloquea? | Recomendación |
|---|---|---|---|---|
| 1 | L3 | Color del gasto en el Home | No | (A) Conservar el gris del Home como token propio |
| 2 | L3 | Marca del tema al cerrar sesión | No | (A) Conservarla |
| 3 | L3 | Tema oscuro en el inicio de sesión de Keycloak | No | (A) Fuera de alcance; change aparte si se quiere |
| 4 | L4 | Grupo de Flujo de caja, Gastos atípicos y Clasificación | **Sí: tareas 5.2 y 5.3 del change 80** | (A) Planificar, Analizar y Organizar |
| 5 | L4 | Selector de workspace en el teléfono | **Sí: tarea 5.6 del change 80** | (A) En el cajón «Más» |
| 6 | L4 | «Registrar» de la barra superior en el teléfono | No | (A) Mantenerlo también arriba |
| 7 | L5 | Vista previa del import si la medición no confirma | No (solo si se da el caso) | (A) No paginar y retirar el requirement |

**Bloquean:** la 4 y la 5, solo dentro del change 80 (L4), que además espera al change 78. El resto del change 80 (barra inferior, alto dinámico, foco, teclado virtual, menú y transiciones) avanza sin ellas. Ninguna bloquea el orden de docs/03 §7 ni los changes 79 y 81.

## L3: `add-dark-theme`

### 1. Color del gasto en el Home

**Contexto.** El Home redeclara sus propios tokens (`dashboard/home.css:2-15`), y ese bloque se borra porque dejaría el Home en claro con el tema oscuro (docs/78 § 11.4, hallazgo 1). Uno de esos tokens es el color del gasto: en el Home es gris pizarra (`#334155`) y en el resto de la app casi negro (`#0f172a`). docs/78 pide no unificarlo en silencio.

**Opciones.**
- **(A)** La diferencia fue intencional: el Home conserva el gris con un token propio, `--pf-fin-expense-soft`, con su valor oscuro. No cambia nada visible.
- **(B)** No fue intencional: el Home usa el mismo color de gasto que el resto.

**Recomendación: (A).** Mantiene el aspecto actual y es reversible: pasar a (B) es borrar un token. El change 79 aplica (A) por omisión hasta la respuesta (tarea 8.3).

### 2. Marca del tema al cerrar sesión

**Contexto.** La cookie `pfos_theme` (`light` o `dark`, sin datos personales) hace que el servidor pinte el tema correcto desde el primer cuadro. La deja el inicio de sesión y la cambia Preferencias. Al cerrar sesión, las páginas públicas (`/auth`) siguen leyéndola.

**Opciones.**
- **(A)** Conservarla: la página de inicio de sesión sale con el último tema usado en ese navegador. El siguiente inicio de sesión la reescribe con el tema de quien entra.
- **(B)** Borrarla en el logout: las páginas públicas siguen siempre al sistema.

**Recomendación: (A).** No es sensible (dos valores posibles) y evita un cambio de tema justo al salir. El change 79 aplica (A) por omisión.

### 3. Tema oscuro en el inicio de sesión de Keycloak

**Contexto.** La pantalla de usuario y contraseña la sirve Keycloak con su propio tema, fuera de `apps/web`. Con el sistema en oscuro, el inicio de sesión se verá claro aunque la app sea oscura antes y después.

**Opciones.**
- **(A)** Fuera de alcance del change 79. Si se quiere, un change aparte sobre el tema de Keycloak (imagen `pfos-keycloak`).
- **(B)** Sumarlo al change 79.

**Recomendación: (A).** Toca otra imagen y otro ciclo de despliegue (la imagen `pfos-keycloak` es un check obligatorio de `main`, D463) y no comparte código con la web.

## L4: `refine-mobile-navigation`

### 4. Grupo de las secciones que docs/28 no ubica

**Contexto.** D503 fija los grupos de docs/28 §2.1 para el cajón «Más» (y el change 80 los usa también en la barra lateral): Día a día (Inicio, Transacciones, Cuentas), Planificar (Plan, Recurrentes, Metas, Deudas), Analizar (Reportes, Pronóstico, Cripto & FX), Organizar (Documentos, Reglas) y Ajustes. Hoy hay tres secciones que no estaban en esa tabla: **Flujo de caja** (Phase 7), **Gastos atípicos** (Phase 9) y **Clasificación** (categorías, etiquetas y contrapartes, que docs/28 ponía dentro de Ajustes).

**Opciones.**
- **(A)** Flujo de caja en Planificar, Gastos atípicos en Analizar y Clasificación en Organizar.
- **(B)** Flujo de caja en Analizar, Gastos atípicos en Analizar y Clasificación en Ajustes (como decía docs/28 para categorías).
- **(C)** Otra ubicación que indique el owner.

**Recomendación: (A).** Flujo de caja mira hacia adelante (saldo esperado y riesgo de déficit), como el plan y los recurrentes. Gastos atípicos es un análisis. Clasificación se edita a diario junto con las reglas, no es una configuración rara. **Bloquea las tareas 5.2 y 5.3 del change 80.**

### 5. Selector de workspace en el teléfono

**Contexto.** Por debajo de 640 px la barra superior ocupa dos filas porque el selector de workspace va a ancho completo (M-13). docs/78 propone sacarlo de la barra superior y ofrece dos lugares.

**Opciones.**
- **(A)** Arriba del todo en el cajón «Más», antes de los grupos.
- **(B)** Dentro del menú de usuario, junto a «Nuevo workspace».

**Recomendación: (A).** El workspace es el contexto de los datos, no una preferencia de la persona; en «Más» queda junto a las secciones de ese workspace. Con un solo workspace, el cajón solo muestra su nombre. **Bloquea solo la tarea 5.6 del change 80** (Could).

### 6. «Registrar» de la barra superior en el teléfono

**Contexto.** El change 78 (L2) pone «＋ Registrar» en la barra superior de todas las páginas, y D503 lo pone también en la barra inferior del teléfono. docs/78 § 7 dibuja los dos accesos. En el teléfono habría dos «Registrar» a la vista.

**Opciones.**
- **(A)** Mantener los dos, como en docs/78 § 7. El de arriba sigue disponible cuando la barra inferior se oculta (campo con foco).
- **(B)** Por debajo de 768 px, ocultar el de la barra superior y dejar solo el de la barra inferior.

**Recomendación: (A).** Es lo que se aprobó y no obliga a modificar el requirement del change 78. Con el selector de workspace fuera de la barra (pregunta 5), la barra superior entra en una fila igual. Si el owner prefiere (B), se agrega como un cambio pequeño después de archivar el change 78.

## L5: `refine-data-tables`

### 7. Vista previa del import si la medición no confirma el problema

**Contexto.** docs/78 (M-19, § 11.1 punto 8) dice «medir primero; si se confirma, paginar». El change 81 mide el INP con un extracto sintético de 2 000 filas y pagina la vista previa solo si «abrir fila» o «filtrar» superan 200 ms (mediana de 3 corridas locales). El requirement de las páginas ya está redactado para no esperar a otra ronda de diseño.

**Opciones.**
- **(A)** Si la medición no lo confirma, no se pagina y el requirement se retira del change antes de archivarlo (sus TC se deprecan).
- **(B)** Paginar igual, aunque la medición no lo pida, para acotar el DOM con extractos aún más grandes.

**Recomendación: (A).** Sigue el criterio aprobado en docs/78 y evita cambiar un flujo que funciona. **No bloquea:** solo se pregunta si se da el caso.
