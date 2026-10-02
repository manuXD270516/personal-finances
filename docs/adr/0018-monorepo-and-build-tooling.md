# ADR-0018: Monorepo y build tooling — pnpm workspaces + Turborepo, TypeScript estricto

- Estado: Aceptado (2026-10-02, tras SPIKE-04; decisión del owner)
- Fecha: 2026-10-01
- Decisores: Owner (Product/Tech Lead)
- Relacionado: docs/ARCHITECTURE.md §5, §6; ADR-0002, ADR-0003, ADR-0011, ADR-0015, ADR-0016, ADR-0019

## Contexto y problema

PFOS contiene: `apps/web` (Next.js), `apps/api` (NestJS composition root), ~18 paquetes de contexto (`packages/contexts/*`), `packages/shared-kernel`, `packages/platform`, contratos (`contracts/`), scripts TS y un servicio Python (`services/ml-forecasting`). Los contextos como paquetes son la base del enforcement de fronteras (ADR-0003). Necesitamos gestión de dependencias eficiente, builds incrementales y cacheados, ejecución "solo lo afectado" en CI, y una configuración TypeScript coherente.

## Drivers de decisión

- Paquetes con `exports` reales y dependencias explícitas (fronteras).
- Velocidad de install/build/test (cache local y remoto).
- Simplicidad: poca configuración y poca "magia".
- Buen soporte en Windows.
- Compatibilidad con Docker (`prune`) y CI (`--affected`).
- Evitar lock-in fuerte.

## Opciones consideradas

1. **pnpm workspaces + Turborepo** (elegida).
2. **Nx** (con pnpm).
3. **pnpm workspaces solos** (scripts recursivos `pnpm -r`, sin orquestador).
4. npm/Yarn workspaces (+ Turborepo o no).
5. Polyrepo.

## Decisión

- **pnpm** como package manager (versión fijada vía `packageManager` + Corepack), `pnpm-workspace.yaml` con `apps/*`, `packages/*`, `packages/contexts/*`, `scripts`. `node-linker` aislado por defecto (sin hoisting accidental: un paquete solo puede importar lo que declara).
- **Turborepo** como orquestador de tareas: `build`, `typecheck`, `lint`, `test`, `test:integration` con `dependsOn` y `outputs`; cache local y **remote cache opcional** (self-hosted o Vercel) — no requerido.
- **TypeScript estricto** (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`), `tsconfig.base.json` compartido, **project references** o builds por paquete con `tsc -b`/tsup según SPIKE-04; ESM como formato objetivo.
- Paquetes internos **no se publican** a npm; versión `workspace:*`.
- `catalog:` de pnpm para unificar versiones de dependencias comunes (TypeScript, Vitest, Kysely, decimal.js).
- Lint con ESLint (flat config) + reglas propias (prohibir `number` en dinero, imports de internals) y formato con Prettier (o Biome, a decidir en Phase 1 sin ADR nuevo).
- `services/ml-forecasting` (Python) queda fuera del grafo pnpm, con su propio toolchain (uv); Turborepo puede invocarlo vía scripts wrapper si conviene.
- Docker usa `turbo prune <app> --docker` para contextos de build mínimos (ADR-0011).

## Análisis de opciones

### 1. pnpm + Turborepo (elegida)
- **Pros:** pnpm es rápido, eficiente en disco y **estricto** con dependencias no declaradas (refuerza fronteras); Turborepo es configuración mínima (`turbo.json`), cache de tareas, `--affected`, `prune` para Docker; ambos funcionan bien en Windows; bajo lock-in (quitar Turbo deja un pnpm workspace funcional).
- **Contras:** Turborepo no aporta generadores ni reglas de fronteras (lo hace dependency-cruiser); remote cache gestionado ligado a Vercel (alternativas self-hosted existen).
- **Costo:** 0. **Complejidad operativa:** baja.

### 2. Nx
- **Pros:** grafo de proyectos rico, `affected` preciso, generadores, `enforce-module-boundaries`, plugins Nest/Next, Nx Cloud.
- **Contras:** más configuración y conceptos (executors, plugins, inferred tasks); los plugins pueden atar versiones de Nest/Next a ciclos de Nx; mayor lock-in; las ventajas (boundaries) ya se cubren con dependency-cruiser.
- **Costo:** 0 OSS; Nx Cloud de pago a escala. **Complejidad operativa:** media.

### 3. pnpm solo
- **Pros:** mínimo número de herramientas.
- **Contras:** sin cache de tareas ni `affected` → CI más lento conforme crecen los ~22 paquetes; orden topológico manual en algunos casos.
- **Costo:** 0. **Complejidad:** baja; escala peor.

### 4. npm/Yarn workspaces
- npm: hoisting permisivo (dependencias fantasma rompen fronteras), más lento. Yarn Berry PnP: estricto pero fricciones con herramientas (Next, Nest, IDEs). Sin ventaja sobre pnpm.

### 5. Polyrepo
- Rompe la facilidad de refactor entre contextos, versionado coordinado y CI único; incoherente con un monolito modular. Descartado.

## Consecuencias

**Positivas**
- Builds y tests incrementales; CI rápido con `--affected`.
- Dependencias explícitas por paquete → fronteras más fuertes.
- Setup comprensible para un nuevo contribuyente o agente.

**Negativas**
- ~22 `package.json`/`tsconfig.json` a mantener (mitigable con plantillas/generador simple propio).
- Configuración de TypeScript multi-paquete (references/paths) requiere cuidado para que IDE, tests y build coincidan.

**Riesgos**
- Divergencia de versiones entre paquetes. *Mitigación:* `catalog:` de pnpm + Renovate agrupado + `syncpack`/check en CI.
- Cache de Turborepo envenenada/incorrecta. *Mitigación:* `outputs` e `inputs` declarados con precisión; `--force` en builds de release.

## Validación

- SPIKE-04: monorepo con 2 contextos + api + web; `pnpm install` en Windows y Linux; `turbo run build test --affected`; `turbo prune` en Docker build.
- Métricas: `pnpm install` en frío < 60 s en CI con cache; build completo con cache caliente < 30 s.

## Notas

- Versiones actuales de pnpm (incl. soporte de `catalog:`) y Turborepo: a verificar en SPIKE-04 (no verificadas por web en esta redacción).

## Resultado del spike (SPIKE-04, 2026-10-02)

pnpm 12 + Turborepo 2.11 validados en un mini-monorepo con NestJS 12 (ESM) y TypeScript 7: build cold ~2.5 s / warm ~25 ms. Ajustes necesarios: (1) dependency-cruiser y typescript-eslint aún no soportan TS 7 → fijar TS 6.0.x para tooling (o todo el repo) hasta que lo soporten; (2) tarea `transit` en Turbo para invalidar `test`/`typecheck` ante cambios en dependencias; (3) `agentGuidance` desactivado para que Turbo no genere `AGENTS.md`; (4) SWC innecesario con Vite 8 (emite metadata de decorators); si se usa, fijar `@swc/core` 1.15.x. Nx descartado. Evidencia: [spikes/SPIKE-04-modular-monolith](../../spikes/SPIKE-04-modular-monolith/README.md).
