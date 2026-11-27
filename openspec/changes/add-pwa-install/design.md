# Diseño: add-pwa-install

## Contexto

Lote L6 de [docs/78](../../../docs/78-propuesta-mejora-ui-ux-modern-web.md) (change 82 de docs/03 §7). Reúne M-33 y M-22 con la viabilidad de § 11.1 punto 10. Decisiones del owner en [docs/79](../../../docs/79-ui-ux-modern-web-decisions.md): D500 (Baseline Widely como piso, Newly solo como mejora progresiva, sin polyfills), D504 (solo instalable, sin service worker) y D512 (lo implementa el agente `frontend`). Preguntas nuevas en [docs/85](../../../docs/85-ui-lotes-l6-l7-questions.md) (1 a 3).

Estado de `origin/main` (2026-11-27):

- `apps/web/public/` no existe o está vacío; `docker/web.Dockerfile` ya copia `apps/web/public`.
- `proxy.ts` excluye de su `matcher` todo path con punto (`'/((?!api|_next|_vercel|.*\\..*).*)'`): `/manifest.webmanifest` y los `*.png` no pasan por la redirección al login ni reciben la CSP de la página.
- CSP (`src/security/csp.ts`): `default-src 'self'` cubre `manifest-src`; `img-src 'self' data: blob:` cubre los íconos. `worker-src` no se declara y no se toca.
- `app/[locale]/layout.tsx` ya emite `color-scheme` y `theme-color` por esquema con `generateViewport` (change 79). El título del producto es «PFOS — Finanzas personales» (`Metadata.title` en `messages/es.json`).
- La guía `pwa/install-web-app` marca el manifiesto y `beforeinstallprompt` como **Limited availability**; `<install>` y `navigator.install()` no tienen soporte en ningún motor estable.

## Objetivos / No objetivos

**Objetivos**

- Que el owner pueda instalar PFOS en Android (Chrome) y en iOS (Safari, «Agregar a inicio») y abrirla con un toque, con el atajo «Registrar gasto».
- Un solo manifiesto, independiente del dominio y del idioma.
- Cero cambios de CSP, de cookie de sesión y de contrato.

**No objetivos**

- Service worker, caché o funcionamiento sin conexión (D504). La cola de altas sin conexión es otro change.
- Notificaciones push, `share_target`, `file_handlers`, capturas para tiendas.
- `<install>` o `navigator.install()` (sin soporte); se revisarán cuando lleguen a Newly.
- Migración de origen (M-34): solo si cambia el dominio después de instalada.

## Decisiones

1. **Manifiesto como ruta de metadatos de Next (`app/manifest.ts`).** Next lo sirve en `/manifest.webmanifest` con `Content-Type: application/manifest+json` y agrega `<link rel="manifest">` a todas las páginas sin código en el layout. Vive en la raíz de `app/`, fuera de `[locale]`, así que no depende del idioma. Alternativa descartada: `public/manifest.webmanifest` (exige el `<link>` a mano y no se tipa).
2. **Contenido del manifiesto** (todo relativo al origen):

   | Campo | Valor | Motivo |
   |---|---|---|
   | `id` | `/` | Identidad estable aunque cambie `start_url`; relativo, no depende del dominio |
   | `name` / `short_name` | «PFOS — Finanzas personales» / «PFOS» | El título actual del producto (`Metadata.title`) |
   | `start_url` / `scope` | `/` / `/` | next-intl (`localePrefix: 'as-needed'` y cookie `NEXT_LOCALE`) lleva al idioma del usuario |
   | `display` | `standalone` | Sin barra del navegador |
   | `lang` / `dir` | `es-BO` / `ltr` | Producto en español primero (NFR-USAB-001) |
   | `theme_color` / `background_color` | `THEME_COLOR.light` (`#ffffff`) | Respaldo hasta la primera pintura; después manda el `theme-color` por esquema (decisión 6) |
   | `icons` | 192, 512 (`purpose: any`) y 512 (`purpose: maskable`) | Mínimo de Chromium para instalar; adaptable para Android |
   | `shortcuts` | «Registrar gasto» → `/transacciones/nueva`, con el ícono de 192 | Atajo del flujo de captura (NFR-USAB-007) |

   El nombre del atajo va solo en español: el manifiesto es uno para los tres idiomas (§ 11.1 punto 10). `THEME_COLOR` se importa de `src/ui/common/theme.ts` (ya validado contra `globals.css` por el test de contraste del change 79), sin colores literales nuevos.
3. **Íconos.** Fuente SVG en `apps/web/src/ui/brand/app-icon.svg` (motivo dentro de la zona segura: círculo central del 80 % del lado) y PNG generados una vez y versionados: `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` y `app/apple-icon.png` (180 × 180, convención de Next que emite `<link rel="apple-touch-icon">`). La generación es un script de una sola vez documentado en la tarea, sin dependencia nueva en `package.json` (por ejemplo con el Chromium de Playwright, que ya está instalado, renderizando el SVG a cada tamaño). **El diseño del motivo espera al owner** (pregunta 1 de docs/85, bloquea las tareas 5.2 y 5.3): sin íconos Chromium no ofrece instalar. Un test unitario lee los PNG y comprueba firma y dimensiones (TC-PLATFORM-PWA-004).
4. **Botón «Instalar la aplicación» en Mis preferencias.** Componente cliente `InstallAppButton` con la lógica en `src/ui/common/install.ts` (pura y testeable): escucha `beforeinstallprompt` en `window`, llama a `preventDefault()`, guarda el evento y muestra el botón; al usarlo llama a `prompt()` y espera `userChoice`; con `appinstalled` o `matchMedia('(display-mode: standalone)').matches` lo oculta. El evento llega una sola vez por documento y puede llegar antes de montar el componente: la escucha se registra en un módulo cargado por `AppFrame` que guarda el evento hasta que el botón lo pida. Ubicación en Mis preferencias (sección «Aplicación»): es el lugar de los ajustes del dispositivo, no ensucia la barra y el owner lo ve una vez. Sin aviso del navegador y sin estar instalada, la sección muestra un texto fijo para iPhone y iPad («Compartir → Agregar a pantalla de inicio»), sin detectar el navegador y sin botón ni enlace (pregunta 3 de docs/85, opción B, aplicada el 2026-11-27 por la recomendación); instalada, no se renderiza nada. Antes de hidratar tampoco se renderiza nada (`useSyncExternalStore` con instantánea de servidor `unknown`), para no desajustar el marcado. Tipos: `BeforeInstallPromptEvent` no está en `lib.dom.d.ts`; se declara una interfaz local de pocas líneas, sin dependencias.
5. **Sin service worker (D504).** Nada llama a `navigator.serviceWorker.register`. Un test E2E comprueba `navigator.serviceWorker.getRegistrations()` vacío y la igualdad de las directivas de la CSP con la base (`content-security-policy.spec.ts` ya fija la política; se agrega la aserción de que no aparece `worker-src` ni cambia `manifest-src`).
6. **Colores en la aplicación instalada (M-22).** En `standalone`, Chrome Android y Safari iOS usan el `<meta name="theme-color">` vigente de la página, que ya emite `generateViewport` por esquema o por la cookie `pfos_theme`. El `theme_color` del manifiesto solo vale para la pantalla de arranque y la barra antes de la primera pintura: por eso es el claro. Verificación del tema oscuro en la app instalada: manual en un dispositivo (TC-PLATFORM-PWA-016).
7. **Sesión.** La app instalada usa el mismo flujo del BFF: `/` sin sesión redirige al login (Keycloak, otro hostname fuera del `scope`), y el callback vuelve a `/`. Android abre el tramo fuera de alcance en una pestaña con barra mínima y vuelve a la app al regresar al alcance. iOS aísla las cookies de la app instalada de las de Safari: hay que iniciar sesión dentro de la app. La cookie `__Host-pfos_sid` no se toca (D516 lo dejó explícito para el E2E; aquí tampoco). Verificación: E2E del atributo de la cookie (TC-PLATFORM-PWA-014) y prueba manual en dispositivo (TC-PLATFORM-PWA-013).
8. **Pruebas E2E.** Spec nuevo `tests/e2e/specs/pwa.spec.ts` (Chromium): manifiesto y sus campos con `request.get` sin cookies, enlace en es/en/pt, íconos, botón con un `beforeinstallprompt` sintético despachado desde la página (`new Event('beforeinstallprompt')` con `prompt` y `userChoice` simulados, porque Playwright no dispara el real), oculto sin el evento, oculto con `display-mode: standalone` emulado (`page.emulateMedia` no lo cubre; se simula con un `addInitScript` que sobrescribe `matchMedia` solo para esa consulta) y desaparición con `appinstalled`. Sin conexión: `context.setOffline(true)` y recarga. Lo que exige instalar de verdad (013 y 016) queda manual, con la ficha en el TC.

## Riesgos / Trade-offs

- **Origen provisional (M-34).** Si alguien instala desde un dominio que luego cambia, la app instalada queda huérfana. Mitigación: el código es independiente del dominio y el owner instala solo desde el dominio definitivo de D452 (pregunta 2 de docs/85).
- **iOS sin aviso de instalación.** Safari no emite `beforeinstallprompt`: en iPhone no aparece el botón y la instalación es por «Compartir → Agregar a inicio». Aceptado por D504; la ayuda es el texto fijo de la pregunta 3 (opción B).
- **Inicio de sesión fuera del alcance.** Keycloak vive en otro hostname. Si un navegador abriera el login fuera de la app y no volviera, la sesión quedaría en el navegador. Mitigación: prueba manual en Android e iOS antes de archivar.
- **Tipos de `beforeinstallprompt`.** API no estándar de Chromium; la interfaz local puede quedar desactualizada. Riesgo bajo: solo se usan `prompt()` y `userChoice`.

## Plan de migración

Sin migraciones de datos ni de contratos. Archivos nuevos y un componente; vuelta atrás: revertir el PR (las apps ya instaladas siguen abriendo el sitio como acceso directo). Se puede partir en dos PR dentro de la rama: (1) manifiesto, botón, pruebas con íconos de marcador de posición **no fusionado a `main`** hasta tener los definitivos, o (2) todo junto cuando el owner apruebe los íconos.

## Preguntas abiertas

En [docs/85](../../../docs/85-ui-lotes-l6-l7-questions.md):

1. **Diseño de los íconos** (bloquea las tareas 5.2 y 5.3; sin ellas el change no se puede archivar).
2. **Dominio definitivo antes de instalar** (no bloquea la implementación).
3. **Ayuda para instalar en iPhone** (no bloquea).
