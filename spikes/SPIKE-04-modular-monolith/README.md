# SPIKE-04 — Modular monolith con NestJS como composition root

> Código **descartable**. Workspace pnpm propio (no se mezcla con el producto). Sin contenedores.
> Fecha: 2026-10-01 · ADRs: [0002](../../docs/adr/0002-architecture-style-modular-monolith.md), [0003](../../docs/adr/0003-module-boundaries-and-extraction-criteria.md), [0018](../../docs/adr/0018-monorepo-and-build-tooling.md)

## 1. Pregunta

¿Podemos tener contextos como paquetes pnpm (`@pf/<ctx>`) con capas `domain → application → infrastructure/interface` + `contracts`, donde:

1. el dominio no conoce NestJS y Nest solo aparece en `interface` (y el composition root `apps/api`), cableando puertos → adapters con tokens;
2. un contexto solo consume a otro vía `@pf/<ctx>/contracts` (con `package.json#exports` bloqueando deep imports) y un puerto propio;
3. hay llamadas síncronas en la **misma transacción** entre contextos (Accounts → Ledger) mediante una Unit of Work;
4. las reglas de arquitectura de docs/16 §5.17 se verifican con dependency-cruiser y **fallan** ante violaciones;
5. Vitest prueba el dominio sin Nest y un e2e de Nest con SWC;
6. Turborepo cachea builds de forma medible?

**Respuesta corta: sí.** Todo funciona con las versiones actuales (NestJS 12.1, TypeScript 7.0, Vitest 5, Turborepo 2.11, pnpm 12.4, dependency-cruiser 18.5), con cuatro hallazgos de tooling que conviene fijar en el ADR-0018 (§8 Riesgos).

## 2. Setup

| Herramienta | Versión (verificada con `npm view` el 2026-10-01) | Nota |
|---|---|---|
| Node | 22.23.1 | Windows 11 |
| pnpm | 12.4.2 | `catalog:`, `allowBuilds`, `minimumReleaseAge` por defecto |
| Turborepo | 2.11.6 | `agentGuidance: false` (si no, crea `AGENTS.md`) |
| TypeScript (paquetes) | **7.0.2** (compilador nativo) | build + typecheck |
| TypeScript (raíz, tooling) | **6.0.3** | lo usan dependency-cruiser y typescript-eslint (aún no soportan la API de TS 7) |
| NestJS | 12.1.2 (`@nestjs/core` es `"type": "module"`, ESM) | |
| Vitest | 5.0.3 (Vite 8 / Oxc) | |
| unplugin-swc / @swc/core | 2.0.0 / **1.15.47** | 1.16.x no carga en esta máquina (ver §8) |
| dependency-cruiser | 18.5.0 | |
| eslint / eslint-plugin-boundaries | 10.11.0 / 7.2.0 | solo para la comparación |

Estructura:

```
SPIKE-04-modular-monolith/
├─ pnpm-workspace.yaml        # workspace propio + catalog + allowBuilds
├─ turbo.json                 # build (^build), typecheck/test (^transit)
├─ tsconfig.base.json         # strict, NodeNext, exactOptionalPropertyTypes…
├─ .dependency-cruiser.cjs    # reglas §5.17 (+3 extra)
├─ eslint.config.js           # comparación eslint-plugin-boundaries
├─ fixtures/arch-violations/  # un fixture prohibido por regla (*.ts.txt, inertes)
├─ scripts/prove-arch-rules.mjs
├─ evidence/                  # salidas capturadas
├─ apps/api/                  # composition root NestJS (AppModule, PlatformModule, filtro DomainError→422)
└─ packages/
   ├─ shared-kernel/          # Money (bigint), DomainError, IdGenerator — sin deps
   ├─ platform/               # puerto UnitOfWork + tokens (.)  |  InMemoryUnitOfWork (./in-memory)
   └─ contexts/
      ├─ ledger/src/{domain,application,infrastructure,interface,contracts}
      └─ accounts/src/{domain,application/ports,infrastructure,interface,contracts}
```

### Cómo se resuelven los paquetes internos ("live types")

Cada paquete expone solo sus entry points públicos con una **condición custom** `@pf/source`:

```json
"exports": {
  "./contracts": { "@pf/source": "./src/contracts/index.ts", "types": "./dist/contracts/index.d.ts", "default": "./dist/contracts/index.js" },
  "./nest":      { "@pf/source": "./src/interface/ledger.module.ts", "types": "…", "default": "…" }
}
```

- `tsconfig.json` (IDE/typecheck) usa `customConditions: ["@pf/source"]` → lee `src/*.ts` sin build previo.
- `vitest.config.ts` usa `resolve.conditions: ['@pf/source']` → tests sin build previo.
- `.dependency-cruiser.cjs` usa `conditionNames: ['@pf/source', …]` → analiza fuentes.
- `tsconfig.build.json` **no** usa la condición → compila contra `dist/*.d.ts` de las dependencias (orden vía `^build` de Turbo).
- Node en runtime usa `default` → `dist/*.js`.

## 3. Comandos

```bash
cd spikes/SPIKE-04-modular-monolith
pnpm install
pnpm build                       # turbo run build
pnpm typecheck                   # turbo run typecheck
pnpm test                        # turbo run test (dominio sin Nest + e2e Nest/SWC)
pnpm arch                        # dependency-cruiser (gate de CI)
pnpm arch:prove                  # cada regla: falla con su fixture, pasa sin él
npx eslint packages apps         # comparación eslint-plugin-boundaries
PORT=61040 node apps/api/dist/main.js   # smoke manual (puerto rango 61xxx)
```

## 4. Qué se demuestra (diseño)

### 4.1 Dominio framework-free; Nest solo en `interface`

- `Account`, `JournalEntry`, `Money` son clases TS planas. **Ni los application services** (`OpenAccountService`, `LedgerService`) llevan `@Injectable`.
- `interface/<ctx>.module.ts` cablea con `useFactory` + `inject: [TOKEN…]`. Los tokens son `Symbol.for('pf.<ctx>.<Nombre>')` definidos en `contracts`/`platform`, es decir, **agnósticos de Nest**.
- Los controllers usan `@Inject(TOKEN)` explícito → el wiring **no depende de `design:paramtypes`** (decorator metadata).
- Test `ledger/test/journal-entry.test.ts` comprueba además que al cargar el dominio `Reflect.getMetadata` no existe (no se cargó `reflect-metadata` ni Nest).

### 4.2 Accounts → Ledger solo vía `contracts` + puerto

```
accounts/application/ports/ledger-posting.port.ts   ← puerto PROPIEDAD de Accounts (habla en Money/AccountType)
accounts/infrastructure/ledger-posting.adapter.ts   ← única pieza que importa '@pf/ledger/contracts'
ledger/contracts/index.ts                           ← LedgerPostingApi, PostJournalEntryCommand (strings, no number), tokens
ledger/application/ledger.service.ts                ← implementa LedgerPostingApi
```

`AccountsModule.register({ ledger: LedgerModule })`: Accounts **no importa el módulo Nest de Ledger**; el composition root decide quién provee `LEDGER_POSTING_API` (hoy in-process; mañana un cliente HTTP si Ledger se extrajera, sin tocar `application`/`domain`).

Deep import bloqueado en **tres niveles** (ver §5.3): Node (`ERR_PACKAGE_PATH_NOT_EXPORTED`), TypeScript (`TS2307`) y dependency-cruiser (`not-to-unresolvable`). El bypass por ruta relativa (`../../../ledger/src/domain/…`) lo detecta `no-cross-context-internals`.

### 4.3 Transacción compartida (Unit of Work)

- `@pf/platform` exporta el puerto `UnitOfWork { run(work) }` y el token `UNIT_OF_WORK`.
- `@pf/platform/in-memory` implementa un fake con `AsyncLocalStorage`: `run` abre transacción (copia del estado), las llamadas anidadas **se unen** a la transacción activa, commit = publicar la copia, error = descartar.
- `OpenAccountService.openAccount` hace `uow.run(...)` → guarda la cuenta → llama al puerto → `LedgerService.postJournalEntry` hace `uow.run(...)` anidado (se une) → guarda el asiento. Un único COMMIT.
- Rollback probado: Ledger tiene un invariante que Accounts no conoce (`LEDGER_AMOUNT_OUT_OF_RANGE`); al abrir una cuenta con saldo 10^16, Ledger lanza `DomainError`, la cuenta **no** queda persistida y la API responde 422 (filtro en `apps/api`).
- El mismo patrón (ALS + transacción Kysely) es el que se usará con PostgreSQL (ADR-0007, SPIKE-02).

## 5. Resultados

### 5.1 Tests (Vitest 5) — `evidence/tests.txt`

```
@pf/ledger:test:  ✓ test/journal-entry.test.ts (3 tests) 4ms          ← dominio puro, sin Nest/SWC
@pf/accounts:test:  ✓ test/open-account.test.ts (3 tests) 5ms        ← dominio + application + UoW fake (commit y rollback)
@pf/api:test:  ✓ test/decorator-metadata.test.ts (1 test) 193ms      ← Nest + SWC
@pf/api:test:  ✓ test/app.e2e.test.ts (2 tests) 144ms                ← Nest TestingModule + supertest: 201 + 1 commit; 422 + rollback
 Tasks:    5 successful, 5 total     Time: 2.722s
 (2ª ejecución)  Cached: 5 cached, 5 total   Time: 21ms >>> FULL TURBO
```

Smoke del build (`node apps/api/dist/main.js`):
`POST /accounts` → 201 con `openingJournalEntryId`; `GET /ledger/entries` → asiento `+2500 / -2500 EUR`; `POST /accounts` con 10^16 → `422 {"title":"LEDGER_AMOUNT_OUT_OF_RANGE"}`.

### 5.2 NestJS 12 + Vitest + SWC: situación del decorator metadata

| Escenario (test `decorator-metadata.test.ts`, inyección **por tipo** sin `@Inject`) | `design:paramtypes` | Resultado |
|---|---|---|
| Vitest + unplugin-swc (`legacyDecorator`, `decoratorMetadata`) | presente | ✓ |
| Vitest **sin** SWC (Vite 8/Oxc) con `emitDecoratorMetadata: true` en tsconfig | presente | ✓ |
| Vitest **sin** SWC y **sin** `emitDecoratorMetadata` en tsconfig | AUSENTE → `clock=undefined` | ✗ |
| e2e del spike (todo con `@Inject(TOKEN)`), sin SWC | no se necesita | ✓ |
| `tsc` 7.0.2 build (`experimentalDecorators` + `emitDecoratorMetadata`) | emite `__metadata` | ✓ (smoke OK) |

Conclusiones: (a) con Vite 8 el transformador Oxc ya respeta `emitDecoratorMetadata` del tsconfig, así que SWC **ya no es imprescindible**; (b) se recomienda mantener SWC en `apps/api` igualmente (paridad con el build y con `class-validator`/`ValidationPipe`), y (c) la regla de "tokens explícitos + `useFactory`" hace que el wiring de contextos sea inmune a cambios de transformador. NestJS 12 sigue usando decoradores **legacy** (`experimentalDecorators`), no los decoradores estándar TC39.

### 5.3 dependency-cruiser — `pnpm arch` y `pnpm arch:prove`

Código limpio (`evidence/depcruise-clean.txt`):

```
✔ no dependency violations found (25 modules, 50 dependencies cruised)
```

Prueba por regla (`evidence/arch-prove.txt`; reporter `err`, exit code = nº de errores):

| Regla | Con fixture (exit / reglas disparadas) | Sin fixture (exit) | Resultado |
|---|---|---|---|
| `domain-no-infra` | 2 / domain-only-shared-kernel, domain-no-infra | 0 | OK |
| `domain-no-framework` | 4 / domain-only-shared-kernel, domain-no-framework | 0 | OK |
| `domain-only-shared-kernel` | 1 / domain-only-shared-kernel | 0 | OK |
| `application-no-infra` | 1 / application-no-infra | 0 | OK |
| `no-cross-context-internals` | 1 / no-cross-context-internals | 0 | OK |
| `not-to-unresolvable` (deep import `@pf/ledger/src/...`) | 1 / not-to-unresolvable | 0 | OK |
| `no-circular` | 1 / no-circular | 0 | OK |
| `composition-root-only-public-entrypoints` (extra) | 1 / composition-root-only-public-entrypoints | 0 | OK |
| `shared-kernel-pure` | 1 / shared-kernel-pure | 0 | OK |

```
tsc (accounts) con deep import: exit=1 → error TS2307: Cannot find module '@pf/ledger/src/domain/journal-entry.js' …
node import('@pf/ledger/src/domain/journal-entry.js'): exit=1 → ERR_PACKAGE_PATH_NOT_EXPORTED
```

Salidas literales de dos casos:

```
  error domain-no-framework: packages/contexts/ledger/src/domain/__violation.ts → node_modules/.pnpm/@nestjs+common@12.1.2_…/node_modules/@nestjs/common/index.js
  error domain-no-framework: packages/contexts/ledger/src/domain/__violation.ts → fs
x 4 dependency violations (4 errors, 0 warnings). 27 modules, 52 dependencies cruised.   (exit=4)

  error no-circular: packages/contexts/accounts/src/contracts/__violation_cycle_a.ts →
      packages/contexts/ledger/src/contracts/__violation_cycle_b.ts →
      packages/contexts/accounts/src/contracts/__violation_cycle_a.ts
x 1 dependency violations (1 errors, 0 warnings). 27 modules, 52 dependencies cruised.   (exit=1)
```

Detalles de configuración aprendidos (ya aplicados en `.dependency-cruiser.cjs`):
- **No** poner `node_modules` en `options.exclude`: `exclude` elimina también las aristas y `domain-no-framework` deja de dispararse en silencio (lo detectó el propio fixture). Basta `doNotFollow`.
- `$1` (group matching) permite `no-cross-context-internals` y `domain-only-shared-kernel` con una sola regla para todos los contextos.
- dependency-cruiser 18.5 **no soporta TypeScript 7** (`missing-typescript-transpiler … typescript: >=2.0.0 <7.0.0`): se instala `typescript@6.0.3` en la raíz solo para tooling.
- `enhancedResolveOptions` no acepta `extensionAlias`; los imports `./x.js` → `x.ts` se resuelven bien con el parser de TS.

### 5.4 Build con Turborepo (tsc 7 por paquete)

| Medición (5 paquetes, Windows 11) | Tiempo turbo | Wall clock |
|---|---|---|
| Build en frío (sin `dist/`, sin `.turbo/`), 3 corridas | 2.53 s / 2.48 s / 2.50 s | 5.1 s / 3.7 s / 3.8 s |
| `--force` (sin caché, con `dist/` previos), 3 corridas | 2.53 s / 2.30 s / 2.90 s | — |
| Build caliente (todo en caché), 3 corridas | 26 ms / 25 ms / 28 ms (`FULL TURBO`) | ~1.1 s |
| `dist/` borrados + caché local → restaura | 58 ms (`5 cached`) | 1.1 s |
| Cambio en `ledger/src/domain` | 2.36 s (`2 cached`: shared-kernel, platform) | — |
| Cambio solo en `apps/api` | 0.74 s (`4 cached`) | — |
| Typecheck secuencial 5 paquetes: TS 6.0.3 vs **TS 7.0.2** | 7.9 s vs **0.97 s** | — |

El ~1 s de wall clock en caliente es el arranque de `npx`/turbo. Objetivo ADR-0018 (build caliente < 30 s) cumplido con amplio margen; habrá que remedirlo con ~22 paquetes.

Se eligió **`tsc -p tsconfig.build.json` por paquete orquestado por Turbo** (no project references, no tsup): Turbo ya calcula el orden y cachea; project references duplicaría el grafo en `tsconfig` (`references`) y en `package.json`; tsup/esbuild no emite decorator metadata (Nest lo necesita en `dist`). Con TS 7 el coste de tsc deja de ser argumento para un bundler.

**Trampa de caché encontrada:** con `test`/`typecheck` sin `dependsOn`, cambiar `ledger/src` **no invalidaba** la caché de `accounts:test` ni `api:test` (consumen el código fuente de ledger vía `@pf/source`, pero Turbo no lo sabe) → `Cached: 4 cached, 5 total` = resultado obsoleto. Solución aplicada: tarea vacía `transit` con `dependsOn: ["^transit"]` y `test`/`typecheck` con `dependsOn: ["^transit"]` → tras el cambio, `2 cached` (solo los que no dependen de ledger).

## 6. ESLint boundaries vs dependency-cruiser

Se probó `eslint-plugin-boundaries@7.2.0` (`eslint.config.js`) con los mismos fixtures:

| Regla | dependency-cruiser | eslint-plugin-boundaries |
|---|---|---|
| domain-no-infra / application-no-infra / domain-only-shared-kernel / shared-kernel-pure / composition root | ✓ | ✓ |
| domain-no-framework (externos y `node:*`) | ✓ | ✓ **solo** con `checkAllOrigins: true` + política `disallow` explícita; sin eso, pasa en silencio |
| no-cross-context-internals | ✓ (`$1`) | ✓ con plantilla `captured: { context: '!{{ from.element.captured.context }}' }` |
| deep import bloqueado por `exports` | ✓ (`not-to-unresolvable`) | (lo detecta TS) |
| **no-circular** | ✓ | ✗ (no detecta ciclos; haría falta `import/no-cycle`, lento) |
| Tiempo (código limpio) | ~2–6 s (incluye npx) | ~2.5 s |

- **boundaries**: feedback en el editor; sintaxis de selectores/políticas potente pero cambiante (v7 depreca `mode`, `element-types` → `dependencies`; un `origin: { anyOf }` provocó un crash interno `template.replaceAll is not a function`); depende de `typescript-eslint` (que tampoco soporta TS 7: `typescript >=4.8.4 <6.1.0`).
- **dependency-cruiser**: grafo completo (ciclos, huérfanos, reachability), regex con grupos, reporters para CI y gráficos, independiente del linter.

**Recomendación:** dependency-cruiser como **gate bloqueante** (fuente de verdad, ya previsto en docs/16). eslint-plugin-boundaries **opcional** solo por el feedback en IDE, con un subconjunto de reglas; no duplicar la lógica en ambos al inicio.

## 7. pnpm + Turborepo vs Nx (nota breve)

Lo que este spike necesitó de un orquestador: orden topológico, caché local, `--affected`/filtros y `prune` para Docker. Turborepo 2.11 lo cubre con un `turbo.json` de ~30 líneas y no impone estructura (quitar Turbo deja un workspace pnpm funcional). Nx aportaría `enforce-module-boundaries` (redundante con dependency-cruiser), generadores y plugins Nest; a cambio añade conceptos (executors, inferred tasks, `project.json`) y acopla versiones de Nest/Next a su ciclo de plugins — más relevante ahora que Nest 12 cambió a ESM. Para 1 persona y ~22 paquetes, **se mantiene pnpm + Turborepo** (ADR-0018). Reabrir solo si se necesita caché remota distribuida avanzada o generadores a escala.

## 8. Riesgos y hallazgos

| # | Riesgo / hallazgo | Impacto | Mitigación |
|---|---|---|---|
| R1 | **TypeScript 7** (nativo) no tiene aún API JS estable: dependency-cruiser y typescript-eslint requieren TS < 7 | Dos versiones de TS en el monorepo | `typescript@7` en paquetes (`catalog:`) y `typescript@6.0.x` en la raíz solo para tooling; revisar cada trimestre |
| R2 | `@swc/core` 1.16.x falla al cargar el binario nativo en esta máquina: valida las ACL del directorio de caché (`%LOCALAPPDATA%\swc`) y lo rechaza porque hereda permisos para un SID de AppContainer | Tests Nest con SWC rotos en Windows | Fijar `@swc/core` 1.15.47 en el catálogo, o prescindir de SWC (Vite 8/Oxc ya emite metadata) |
| R3 | Caché de Turbo obsoleta para `test`/`typecheck` cuando se consumen fuentes de otros paquetes | Falsos verdes en CI | Patrón `transit` (aplicado) |
| R4 | `exclude: node_modules` en dependency-cruiser silencia reglas de frameworks | Falsos verdes en CI | No excluir; **cada regla con su fixture** (`arch:prove`) en CI |
| R5 | pnpm 12 bloquea scripts de build (`allowBuilds`) y añade `minimumReleaseAgeExclude` automáticamente al instalar versiones recientes | Fricción en `pnpm install` / Renovate | Lista `allowBuilds` revisada; política de antigüedad mínima documentada |
| R6 | Turborepo 2.11 crea/actualiza `AGENTS.md` cuando detecta un agente IA | Cambios no pedidos en el repo | `"agentGuidance": false` en `turbo.json` |
| R7 | Nest 12 es ESM (`"type": "module"`) | Imports con extensión `.js`, top-level await en `main.ts` | `module: NodeNext` + `verbatimModuleSyntax` ya en la base |
| R8 | Ceremonia: puerto + adapter + token + factory por dependencia cruzada | Velocidad de desarrollo | Plantilla/generador simple (§9); contextos *Generic* con variante simplificada |
| R9 | UoW con `AsyncLocalStorage`: si algún adapter se ejecuta fuera del contexto ALS (callbacks de librerías, timers) escribe fuera de la transacción | Pérdida de atomicidad | Test de integración con PG real (SPIKE-02) y regla: los adapters solo obtienen el ejecutor vía la UoW |

## 9. Recomendación

1. **Aceptar** el estilo de ADR-0002/0003 tal cual: el spike demuestra dominio sin Nest, consumo cruzado solo vía `contracts` + puerto, transacción compartida por UoW y reglas verificables que fallan ante violaciones.
2. Adoptar para Phase 1: condición `@pf/source` en `exports`; tokens `Symbol.for` en `contracts`/`platform`; application services sin decoradores, cableados con `useFactory`; `Contexto.register({ ... })` para dependencias cruzadas decididas en `apps/api`.
3. dependency-cruiser en CI con la configuración de este spike + `arch:prove` (fixtures) como test TC-PLATFORM-ARCH-001/002.
4. Build: `tsc` por paquete orquestado por Turbo con TS 7; `transit` para `test`/`typecheck`.
5. Ajustar ADR-0018: TS 7 en paquetes + TS 6 para tooling; `@swc/core` fijado; `agentGuidance: false`; `allowBuilds`.

### Plantilla recomendada `packages/contexts/<ctx>`

```
packages/contexts/<ctx>/
├─ package.json            # "name": "@pf/<ctx>", exports: "./contracts" y "./nest" (con condición @pf/source)
├─ tsconfig.json           # typecheck: customConditions ["@pf/source"], include src+test
├─ tsconfig.build.json     # build: rootDir src → dist, sin customConditions
├─ vitest.config.ts        # resolve.conditions ['@pf/source']; sin SWC salvo que el paquete tenga controllers
├─ src/
│  ├─ domain/              # agregados, VOs, eventos de dominio, puertos de repositorio — solo @pf/shared-kernel
│  ├─ application/
│  │  ├─ ports/            # puertos "driven" propios (p. ej. LedgerPostingPort, Clock)
│  │  └─ *.service.ts      # casos de uso; implementan las interfaces de contracts; usan UnitOfWork de @pf/platform
│  ├─ infrastructure/      # repositorios Kysely (schema <ctx>), adapters hacia @pf/<otro>/contracts, outbox
│  ├─ interface/
│  │  ├─ <ctx>.module.ts   # @Module / static register(): providers useFactory + tokens (ÚNICO import Nest del contexto)
│  │  └─ *.controller.ts   # @Inject(TOKEN) explícito, DTOs HTTP
│  └─ contracts/
│     └─ index.ts          # commands, queries, DTOs (dinero como string), interfaces de API, tokens Symbol.for, eventos
└─ test/
   ├─ domain/              # unitarios puros (sin Nest)
   └─ application/         # casos de uso con UoW/repos en memoria
```

## 10. Impacto en ADRs / docs

- ADR-0002 y ADR-0003: sección *Resultado del spike* añadida (siguen en **Propuesto**).
- ADR-0018: pendiente de incorporar §8 R1, R2, R5, R6 y la decisión "tsc por paquete + Turbo" (no project references).
- docs/16 §5.17: añadir `composition-root-only-public-entrypoints`, `contracts-are-leaves`, `application-no-framework`, `not-to-unresolvable` y el requisito de "fixture por regla".
