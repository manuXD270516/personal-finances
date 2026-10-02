# @pf/shared-kernel

Núcleo compartido entre bounded contexts (ADR-0002/0003): value objects puros (p. ej. `Money`, identificadores,
`DomainError`). **Sin** NestJS, sin Kysely, sin I/O de Node.

Estado: vacío (solo `src/index.ts`). Todo dinero se representará con `Money` (decimal.js, ADR-0006) cuando lo
introduzca el change correspondiente de Phase 1.

| Script | Efecto |
|---|---|
| `pnpm build` | `tsc -p tsconfig.build.json` → `dist/` |
| `pnpm typecheck` | `tsc` contra las fuentes (`@pf/source`) |
| `pnpm test` | Vitest (unitarios colocados `src/**/*.test.ts`) |
