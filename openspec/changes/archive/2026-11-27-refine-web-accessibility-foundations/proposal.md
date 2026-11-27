# Propuesta: refine-web-accessibility-foundations

## Why

La auditoría de [docs/78](../../../docs/78-propuesta-mejora-ui-ux-modern-web.md) (guías de Modern Web Guidance) encontró brechas de accesibilidad que afectan a casi todas las pantallas. El formulario de transacciones valida solo al enviar y deja el foco en el botón: quien usa lector de pantalla o el teclado del teléfono no sabe qué campo falla. Las confirmaciones de acciones irreversibles (anular, revertir un import, reabrir un periodo) son paneles en línea que enfocan el contenedor, ponen «Confirmar» antes que «Cancelar» y pierden el foco al cancelar. Además, una regla global de movimiento reducido fuerza duraciones de 0,01 ms en todo, algo que la guía prohíbe. El ítem activo de la navegación desaparece en colores forzados, y las pestañas saltan de fila en el teléfono. Son incumplimientos de NFR-USAB-101, -102 y -107 (Must). Es el lote L1 de docs/78 y el owner lo aprobó el 2026-11-25 ([docs/79](../../../docs/79-ui-ux-modern-web-decisions.md), D500–D512).

## What Changes

- **Foco al primer error (M-01):** utilidad común para todos los formularios con validación propia. Tras un envío fallido, el foco va al primer campo inválido en el orden visual. En los formularios largos (préstamo, tarjeta, mapeo del import) se agrega un resumen de errores con enlaces a cada campo.
- **Validación al salir del campo (M-02):** en los montos de transacción, transferencia y conversión, el error de formato o de escala aparece al salir del campo y se limpia mientras el usuario corrige. Un campo obligatorio que no se tocó no muestra error hasta el envío.
- **Diálogo de confirmación (M-06):** `ConfirmDialog` sobre el `<dialog>` nativo con `showModal()` (Widely), con la misma firma que `ConfirmPanel` y `role="alertdialog"`. El foco inicial queda en «Cancelar» y vuelve al disparador al cerrar. Lo usan las acciones irreversibles o con efecto contable (≈ 30 de los 39 usos; inventario en design.md, decisión 6). Las confirmaciones reversibles siguen en línea, pero ahora devuelven el foco y empiezan en la acción segura.
- **Movimiento reducido por componente (M-26):** se quita la regla global; cada animación declara su variante junto a la regla y anima solo `opacity` y `transform`.
- **Colores forzados (M-14):** el ítem activo de la navegación se marca con un borde real.
- **Pestañas en una fila (M-15):** desplazamiento horizontal, peso de fuente constante e indicador con borde.
- **Enter con composición (M-04, Could):** la búsqueda no se dispara a mitad de una composición de texto.
- **WebKit en E2E (D509, condicionado):** spike de inicio de sesión en WebKit. Si pasa, se agrega un proyecto `webkit` con ≈ 5 specs al job `e2e`. Si falla, la decisión vuelve al owner y el resto del change sigue sin WebKit.
- **Documentación:** `CLAUDE.md` ya declara la política de navegadores (D500). docs/28 se actualiza al as-built (D505, D506, D508).
- **Fuera de alcance:** tema oscuro (L3), navegación móvil y menú con popover (L4), tablas (L5), PWA (L6), transiciones, toggletips y el resto de L7, la región de avisos y el alta rápida (L2), migrar los 1 291 `style={{…}}` (deuda transversal), Firefox en E2E y cualquier cambio de atributos de la cookie de sesión.

## Capabilities

### New Capabilities
- `platform/web-interface`: patrones transversales de la interfaz web (accesibilidad de formularios, diálogos de confirmación, movimiento, navegación, pestañas y cobertura de navegadores). 10 ADDED (5 Must, 4 Should, 1 Could). La agregan ARCHITECTURE §14 y docs/79 (decisión de diseño derivada).

### Modified Capabilities

Ninguna. Las acciones que pasan a confirmarse en un diálogo (anular, revertir, reabrir, archivar, eliminar) mantienen las reglas de negocio de sus capabilities; solo cambia cómo se pide la confirmación.

## Impact

**Specs impactadas:** `platform/web-interface` (nueva, 10 ADDED). Lee sin modificar: `transactions/transaction-recording` (anulación), `imports/import-pipeline` (reversión), `planning/financial-periods` (reapertura de periodos), `security/access-control` (CSP con nonce).

**Componentes/contextos impactados:** solo `apps/web` (capa interface): `src/ui/common/ui.tsx` (`Field`, `ConfirmPanel`, `ConfirmDialog` nuevo), `src/ui/common/Tabs.tsx`, `src/ui/common/` (utilidad de foco y resumen de errores), los formularios con `noValidate`, los ≈ 30 usos de confirmación que pasan a diálogo, `src/ui/recurring/OccurrenceActionPanel.tsx` (Enter con composición), `app/globals.css` y `src/ui/dashboard/home.css` (movimiento, colores forzados, diálogo y pestañas), los catálogos `messages/{es,en,pt}.json`, `tests/e2e` (specs nuevos, revisión de 7 specs que usan `alertdialog` y proyecto `webkit` condicionado) y `.github/workflows/pr.yml` (instalación de WebKit, condicionada). Ningún contexto de dominio.

**APIs impactadas:** ninguna. `contracts/openapi` no cambia.

**Tablas impactadas:** ninguna.

**Eventos impactados:** ninguno.

**Migraciones requeridas:** ninguna.

**Test cases:** AÑADIDOS — TC-PLATFORM-WEBUI-001..020 (20). MODIFICADOS — ninguno. DEPRECADOS — ninguno.

**Impacto de regresión:** toda la UI con formularios y confirmaciones. El orden de los botones cambia («Cancelar» primero) y las confirmaciones irreversibles pasan a la capa superior. Los locators por `data-testid` y por rol `alertdialog` siguen valiendo, pero los que usan `.first()` sobre botones del panel cambian. La suite E2E completa y `a11y.spec.ts` corren en verde antes de fusionar. No hay cambios en la API, el ledger ni los datos.

**Riesgos introducidos:** sin RISK-id registrado. (1) `autoFocus` de React no enfoca dentro de un `<dialog>` cerrado: se enfoca por script después de `showModal()` y se prueba por E2E. (2) El spike de WebKit puede fallar por la cookie `Secure` sobre `http` de loopback: no se cambia ningún atributo sin el owner (D509). (3) El job `e2e` crece unos 5–8 minutos con WebKit, dentro de su límite de 40 minutos.

**Invariantes afectadas:** ninguna (no toca dinero, ledger, FX ni periodos).
