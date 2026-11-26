# Diseño

## Contexto

Lote L4 de [docs/78](../../../docs/78-propuesta-mejora-ui-ux-modern-web.md) (change 80 de docs/03 §7). Reúne M-11, M-12, M-13, M-08 y M-27 con las condiciones de docs/78 § 11.1 punto 11 y el supuesto de § 11.3 (teclado virtual y área segura solo verificables en un dispositivo). Decisiones del owner ([docs/79](../../../docs/79-ui-ux-modern-web-decisions.md)): D500 (política de navegadores), D503 (barra inferior de 5 destinos y cajón «Más» con los grupos de docs/28 §2.1) y D512 (lo implementa el agente `frontend`).

As-built: `AppFrame.tsx` (cliente, dentro de `SessionProvider`) dibuja la barra superior (marca, selector de workspace, campana, menú de usuario como disclosure con escuchas propias de documento) y la barra lateral (`nav` con nombre). Bajo 768 px, un botón `.pf-nav-toggle` muestra la lista como panel en flujo (`globals.css:652-700`). `shell/nav.ts` define 16 `NAV_ITEMS` planos y `activeNav()`. `.pf-shell { min-height: 100vh }` y la barra lateral con `calc(100vh - …)`. `scroll-padding-top` ya reserva la barra superior. Los breakpoints son 640, 768 y 1024 px.

Depende del change 78 (L2) por el acceso «＋ Registrar» (enlace a `/transacciones/nueva`, solo con `ctx.canEdit`, oculto en la propia página de alta). Usa el `ConfirmDialog` y la región de avisos de los changes 77 y 78 solo para la decisión 8 (transiciones). Si el change 79 (L3) ya creó `generateViewport`, este change lo extiende; si no, lo crea.

Capa afectada: solo **interface** de `apps/web`. Sin contextos, agregados, puertos, tablas, eventos ni contratos.

## Objetivos / No objetivos

**Objetivos**
- Navegación de una mano en el teléfono, con «Registrar» a un toque.
- Las 16 secciones agrupadas por tarea, iguales en el cajón y en la barra lateral.
- Marco estable con la barra dinámica del navegador, el teclado virtual y el área segura.
- Foco nunca tapado por una barra fija.

**No objetivos**
- Alta rápida en una hoja sobre la página: el ＋ abre `/transacciones/nueva`, como en L2.
- Búsqueda global, `Ctrl+K` y atajos (NFR-USAB-008).
- `next/link` y transiciones entre documentos (change 84 y D511).
- `interactive-widget=resizes-content` (opcional en § 11.1; la barra se oculta con el foco, que resuelve el caso).

## Decisiones

1. **Grupos en `shell/nav.ts` (lógica pura).** Se agrega `NAV_GROUPS: readonly { key: NavGroupKey; items: readonly NavKey[] }[]` con `NavGroupKey = 'daily' | 'plan' | 'analyze' | 'organize' | 'settings'`, en el orden de docs/28 §2.1, y `BOTTOM_BAR: readonly ('home' | 'transactions' | 'register' | 'planning' | 'more')[]`. Ubicación de partida de las 16 secciones:

   | Grupo (docs/28) | Secciones |
   |---|---|
   | Día a día | Inicio, Transacciones, Cuentas |
   | Planificar | Planificación, Recurrentes, Metas, Deudas, **Flujo de caja** |
   | Analizar | Reportes, Pronósticos, **Gastos atípicos**, Cripto & FX |
   | Organizar | Documentos, Reglas, **Clasificación** |
   | Ajustes | Configuración |

   Las tres en negrita no figuran en docs/28 §2.1: es la **pregunta 4 de [docs/82](../../../docs/82-ui-lotes-l3-l5-questions.md), que bloquea las tareas 5.2 y 5.3**. La tabla es la recomendación. Una función `groupOf(key)` y un test garantizan que cada `NavKey` está en exactamente un grupo, así una sección nueva no queda fuera. Las secciones de fases no habilitadas siguen ocultas como hoy.

2. **Barra inferior.** `<nav aria-label="Navegación principal (móvil)">` con una lista de 5 elementos, fija abajo (`position: fixed; inset-inline: 0; bottom: 0`), visible solo con `@media (max-width: 767.98px)`. Inicio, Transacciones y Plan son enlaces con `aria-current="page"` según `activeNav()`. «＋ Registrar» es el mismo enlace del change 78 (el «＋» con `aria-hidden`, nombre accesible «Registrar») y solo se dibuja con `ctx.canEdit`. «Más» es un `<button aria-haspopup="dialog">`. Si `activeNav()` devuelve una sección que no es directa de la barra, «Más» lleva la clase `.is-current` (marca visible) y su nombre accesible pasa a «Más, sección actual: {sección}» (clave i18n con argumento). Etiquetas cortas (`BottomBar.*`, es/en/pt) con `text-overflow: ellipsis`; objetivo táctil mínimo de 2,75 rem (44 px) en alto y ancho. El panel en flujo y el botón `.pf-nav-toggle` se quitan.

   El acceso «Registrar» de la barra superior del change 78 no cambia. Si en pantallas angostas queda duplicado o se oculta es la pregunta 6 de docs/82 (no bloquea): el spec no lo toca.

3. **Cajón «Más».** `<dialog class="pf-drawer">` con `showModal()`, nombre con `aria-labelledby` a su encabezado («Más secciones», i18n). Mismo patrón que el `ConfirmDialog` del change 77: se monta al abrir, `showModal()` en un efecto con la guarda `if (!el.open)`, foco inicial en el botón «Cerrar» por script tras `showModal()` (no `autoFocus`), `onCancel` con `preventDefault()` y una sola llamada al cierre de React. Cierre por clic fuera: `onClick` en el `<dialog>` que cierra si `event.target === dialog` (el `::backdrop` recibe el clic como el propio diálogo); `closedby="any"` es Limited y no se usa (D500). El foco vuelve a «Más» al cerrarse (nativo). Contenido: cada grupo es un `<section aria-labelledby>` con un `<h2>` y una lista de enlaces con `aria-current` en la sección actual. En menos de 640 px, el selector de workspace va arriba del primer grupo (decisión 6). Al elegir un enlace, la navegación por documento completo cierra el diálogo; no hace falta lógica extra. Se presenta anclado abajo, a todo el ancho y con alto máximo `min(80dvh, 40rem)` con desplazamiento propio.

4. **Barra lateral agrupada.** Desde 768 px, la lista actual pasa a una lista por grupo con su encabezado (`<h2 class="pf-nav-group">` visible, tamaño `--pf-text-xs`, mayúsculas por CSS). La `nav` conserva su `aria-label`. El contador de «Por aprobar» de Recurrentes y el borde del ítem activo (change 77, colores forzados) no cambian.

5. **Alto dinámico, área segura y foco no tapado (M-12).**
   - `globals.css`: `min-height: 100dvh` en `.pf-shell` y `calc(100dvh - var(--pf-topbar-h))` en la barra lateral (`dvh` es Widely 2022-12-05).
   - `generateViewport`: `viewportFit: 'cover'`.
   - Token `--pf-bottombar-h: 3.5rem`. La barra tiene `padding-block-end: env(safe-area-inset-bottom, 0px)` y alto `calc(var(--pf-bottombar-h) + env(safe-area-inset-bottom, 0px))`.
   - Bajo 768 px: `html { scroll-padding-bottom: calc(var(--pf-bottombar-h) + env(safe-area-inset-bottom, 0px) + var(--pf-space-2)) }` y `main` con el mismo `padding-block-end` para que el último contenido no quede bajo la barra.
   - Con `viewport-fit=cover`, la barra superior gana `padding-block-start: env(safe-area-inset-top, 0px)` en modo horizontal con muesca.

6. **Barra superior de una fila (M-13).** Bajo 640 px, el selector de workspace se quita de la barra superior y se dibuja dentro del cajón «Más», con el mismo componente y el mismo comportamiento de cambio. Es la recomendación de la **pregunta 5 de docs/82, que bloquea solo la tarea 5.6** (la alternativa es el menú de usuario). La barra superior queda en una fila de `--pf-topbar-h`: marca, «Registrar» (L2), campana y menú de usuario.

7. **Barra oculta al escribir (§ 11.1 punto 11, c).** Regla en `globals.css`:

   ```css
   .pf-shell:has(:is(input:not([type='checkbox'], [type='radio'], [type='button'], [type='submit']), select, textarea):focus) .pf-bottombar { display: none; }
   ```

   `:has()` es Widely (2023-12-19). En `/transacciones/nueva`, `AppFrame` no dibuja la barra (misma comprobación de ruta que usa L2 para ocultar «Registrar»). Al ocultarse, `scroll-padding-bottom` deja de hacer falta, pero se mantiene: es inocuo.

8. **Menú de usuario con `popover` (M-08) y transiciones de la capa superior (M-27).**
   - Menú: el contenedor gana `popover="auto"` e `id`; el botón, `popoverTarget` (tipado en `@types/react` 19.3.0). Se quitan las escuchas de documento de `AppFrame.tsx` para clic afuera y Esc. El foco vuelve al botón al cerrarse con Esc (comportamiento nativo de `popover="auto"`). `aria-expanded` se sincroniza con `onToggle`. Respaldo (D500, ≤ 20 líneas): si `!('popover' in HTMLElement.prototype)`, se conserva el disclosure con `hidden` y las escuchas actuales, sin dependencias.
   - Transiciones: para `.pf-drawer`, `.pf-confirm-dialog` (change 77) y los avisos (change 78), dentro de `@media (prefers-reduced-motion: no-preference)`: `transition: opacity 150ms, transform 200ms, overlay 200ms allow-discrete, display 200ms allow-discrete` (con `transition-behavior: allow-discrete` como propiedad aparte), estado de entrada con `@starting-style { opacity: 0; transform: translateY(1rem) }` y lo mismo para `::backdrop` solo con `opacity`. Con `reduce`, solo `opacity` o nada. `@starting-style` es Newly (2024-08-06): sin soporte, aparecen sin animación. El test de hojas de estilo del change 77 (`styles.test.ts`) ya exige que toda transición de `transform` esté dentro de `no-preference`.

9. **i18n y CSP.** Claves nuevas en `BottomBar.*`, `Drawer.*` y `Nav.groups.*` en es, en y pt en el mismo commit. Probadas a 320, 360 y 375 px. Sin `<style>` ni `<script>` en línea, sin dependencias nuevas.

10. **Pruebas.** Spec nuevo `tests/e2e/specs/mobile-navigation.spec.ts` a 360 × 800 (y 360 × 640 donde se indica) con el TC-id al inicio de cada `test(...)`. Los objetivos táctiles se miden con `boundingBox()`. El foco no tapado se mide comparando el `boundingBox()` del elemento enfocado con el de la barra. `app-shell.spec.ts` (bloque móvil) se reescribe para la barra inferior y conserva sus capturas. Las capturas a 360 y 1280 px se guardan con `testInfo.outputPath`. Verificación manual en un teléfono Android y uno iOS (o emulación de Chrome DevTools) del teclado virtual y del área segura, anotada en la tarea 7.6 (Playwright no simula el teclado virtual, § 11.3).

## Riesgos / Trade-offs

- **Specs E2E que usan el menú móvil.** Se reescriben con la barra y el cajón. Se revisan con `grep -rn "nav-toggle\|setViewportSize" tests/e2e`.
- **Etiquetas que no entran a 320 px.** Etiquetas cortas por idioma y `text-overflow`; si una no entra en pt, se acorta el texto en el catálogo, no el objetivo táctil.
- **La barra tapa contenido al pie.** `padding-block-end` en `main` y `scroll-padding-bottom`; TC-PLATFORM-MOBNAV-010 lo prueba.
- **`popover` sin soporte.** Respaldo propio de ≤ 20 líneas (D500).
- **Grupos sin decidir.** Las tareas 5.2 y 5.3 esperan la pregunta 4; las demás (barra inferior, alto, foco, teclado) no.

## Plan de migración

Sin migraciones de datos ni de contratos. Vuelta atrás: revertir el PR. Se puede partir en dos PR dentro de la rama del change: (1) barra inferior, alto dinámico, área segura y barra oculta al escribir; (2) grupos (cuando el owner conteste la pregunta 4), barra superior de una fila (pregunta 5), menú con `popover` y transiciones.

## Preguntas abiertas

En [docs/82](../../../docs/82-ui-lotes-l3-l5-questions.md):

4. Grupo de Flujo de caja, Gastos atípicos y Clasificación. **Bloquea** las tareas 5.2 y 5.3.
5. Selector de workspace en el teléfono: cajón «Más» o menú de usuario. **Bloquea** solo la tarea 5.6.
6. «Registrar» de la barra superior en pantallas angostas: mantenerlo junto al de la barra inferior u ocultarlo. No bloquea.
