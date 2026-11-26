# Propuesta: refine-mobile-navigation

## Why

En el teléfono, la navegación es un panel en flujo que empuja el contenido, lista 16 secciones planas, no deja inerte el resto y no cierra con Escape (`globals.css:518-526`, `AppFrame.tsx`, `shell/nav.ts`). «Registrar» no está a mano. El marco usa `100vh`, que salta con la barra dinámica del navegador, y no reserva el área segura de los teléfonos con gestos. En menos de 640 px la barra superior ocupa dos filas por el selector de workspace. docs/28 §2.1 ya definía una barra inferior de 5 destinos y los grupos de la barra lateral. Es el lote L4 de [docs/78](../../../docs/78-propuesta-mejora-ui-ux-modern-web.md) (M-11, M-12, M-13, M-08 y M-27), con las condiciones de § 11.1 punto 11. El owner lo aprobó el 2026-11-25 ([docs/79](../../../docs/79-ui-ux-modern-web-decisions.md), D503): barra inferior Inicio · Transacciones · ＋ Registrar · Plan · Más, con «Más» como cajón modal con los grupos de docs/28.

## What Changes

- **Barra inferior (M-11):** por debajo de 768 px, 5 destinos fijos con texto, objetivo táctil ≥ 44 px y `aria-current`. «＋ Registrar» es el mismo acceso del change 78 (L2): enlace a `/transacciones/nueva`, solo para quien puede editar. Reemplaza al panel en flujo actual.
- **Cajón «Más» (M-11):** `<dialog>` modal con `showModal()` (Widely), con los grupos de docs/28 §2.1: Día a día, Planificar, Analizar, Organizar y Ajustes. Esc, «Cerrar» y toque fuera lo cierran y devuelven el foco. La ubicación de Flujo de caja, Gastos atípicos y Clasificación, que docs/28 no agrupa, es la pregunta 4 de [docs/82](../../../docs/82-ui-lotes-l3-l5-questions.md) (**bloquea** las tareas del cajón y de la barra lateral).
- **Barra lateral agrupada:** desde 768 px, los mismos grupos con encabezados.
- **Alto y áreas seguras (M-12):** `100dvh` en lugar de `100vh`, `viewport-fit=cover` en `generateViewport`, `env(safe-area-inset-bottom)` en la barra y `scroll-padding-bottom` igual a su alto, para que el foco no quede tapado (WCAG 2.4.11).
- **Teclado virtual (§ 11.1 punto 11, c):** la barra se oculta con `:has()` (Widely) cuando hay un `input`, `select` o `textarea` con foco, y no aparece en `/transacciones/nueva`, que ya tiene su botón «Registrar».
- **Barra superior de una fila (M-13, Could):** el selector de workspace pasa al cajón «Más» en menos de 640 px (pregunta 5 de docs/82, que **bloquea** solo esta tarea).
- **Menú de usuario con `popover` (M-08, Could):** `popover="auto"` y `popovertarget` en lugar de las escuchas propias de documento: cierre por clic fuera, Esc y foco devuelto nativos.
- **Entrada y salida de la capa superior (M-27, Could):** `@starting-style` y `transition-behavior: allow-discrete` dentro de `prefers-reduced-motion: no-preference`, para el cajón, el `ConfirmDialog` (change 77) y los avisos (change 78).
- **Fuera de alcance:** sheet de alta rápida sobre la página (el ＋ abre la página de alta, como en L2), búsqueda global y `Ctrl+K`, atajos de teclado (NFR-USAB-008), `next/link` (change 84), `interactive-widget` en el viewport, Firefox y WebKit en E2E (dependen de docs/80), tema oscuro (L3) y tablas (L5).

## Capabilities

### New Capabilities

Ninguna. `platform/web-interface` la crea el change 77.

### Modified Capabilities
- `platform/web-interface`: 8 ADDED (5 Should, 3 Could): barra inferior, cajón «Más», barra lateral agrupada, alto dinámico y áreas seguras, barra oculta al escribir, barra superior de una fila, menú de usuario con cierre nativo y entrada y salida de la capa superior.

## Impact

**Specs impactadas:** `platform/web-interface` (8 ADDED). Lee sin modificar: `transactions/transaction-recording` (acceso «Registrar» del change 78, que no cambia), `identity/workspace-membership` (cambio de workspace).

**Componentes/contextos impactados:** solo `apps/web` (capa interface): `src/ui/AppFrame.tsx` (barra inferior, cajón, menú de usuario y selector de workspace), `src/ui/shell/nav.ts` (grupos y destinos de la barra inferior, lógica pura), `app/globals.css` (barra inferior, cajón, `dvh`, `safe-area`, `scroll-padding-bottom`, `:has()`, transiciones), `app/[locale]/layout.tsx` (`generateViewport` con `viewportFit: 'cover'`), `messages/{es,en,pt}.json` y `tests/e2e` (`app-shell.spec.ts` y un spec nuevo). Ningún contexto de dominio.

**APIs impactadas:** ninguna. `contracts/openapi` no cambia.

**Tablas impactadas:** ninguna.

**Eventos impactados:** ninguno.

**Migraciones requeridas:** ninguna.

**Test cases:** AÑADIDOS — TC-PLATFORM-MOBNAV-001..020 (20). MODIFICADOS — ninguno. DEPRECADOS — ninguno.

**Impacto de regresión:** el marco autenticado en todas las pantallas. Bajo 768 px desaparece el botón de menú y el panel en flujo; los specs que lo usan (`app-shell.spec.ts` móvil) se reescriben. Los specs que trabajan a 360–375 px (`accounts.spec.ts:129`, `app-shell.spec.ts:99`) pueden encontrar la barra inferior sobre el contenido: `scroll-padding-bottom` y la regla de foco lo evitan; se revisan. La suite E2E completa y `a11y.spec.ts` corren en verde antes de fusionar.

**Riesgos introducidos:** sin RISK-id registrado. (1) Playwright no simula el teclado virtual ni el área segura: se verifica a mano en un teléfono real (§ 11.3) y se anota en la tarea. (2) Con 5 destinos a 320 px y textos en español, las etiquetas pueden no entrar: etiquetas cortas con `text-overflow` y prueba en es/en/pt. (3) `popover` es Newly (2025-01-27): sin soporte, el menú de usuario cae a un respaldo propio de ≤ 20 líneas (D500).

**Invariantes afectadas:** ninguna (no toca dinero, ledger, FX ni periodos).
