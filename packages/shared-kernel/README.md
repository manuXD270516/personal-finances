# @pf/shared-kernel

Núcleo compartido entre bounded contexts (ADR-0002/0003): value objects puros (p. ej. `Money`, identificadores,
`DomainError`). **Sin** NestJS, sin Kysely, sin I/O de Node.

Contenido (add-api-conventions): `DomainError` (`code` estable + `violations` con JSON Pointer), `Money`/`Currency`
(decimal.js aislado, ADR-0006: `parse` rechaza escala excedida con `AMOUNT_SCALE_EXCEEDED` sin redondear,
`toFixed`/`toJSON` en escala canónica), `LocalDate` (fecha de negocio `YYYY-MM-DD`), `Instant` (RFC 3339 UTC con `Z`) y
`Clock`/`FixedClock`. El álgebra completa de `Money` llega con `add-ledger-core`.

| Script | Efecto |
|---|---|
| `pnpm build` | `tsc -p tsconfig.build.json` → `dist/` |
| `pnpm typecheck` | `tsc` contra las fuentes (`@pf/source`) |
| `pnpm test` | Vitest (unitarios colocados `src/**/*.test.ts`, incluye property-based con fast-check) |
| `pnpm test:mutation` | Stryker (runner `command`, umbral 80 %; Vitest 5 aún no funciona con `@stryker-mutator/vitest-runner`) |
