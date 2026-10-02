# packages/contexts — bounded contexts

Cada bounded context (ARCHITECTURE §3) es un paquete pnpm `@pf/<ctx>` en `packages/contexts/<ctx>/`. **Todavía no
existe ninguno**: el primero llega con su change de OpenSpec de Phase 1. Esta carpeta ya está incluida en
`pnpm-workspace.yaml`.

Estructura validada en [SPIKE-04](../../spikes/SPIKE-04-modular-monolith/README.md) (ADR-0002, ADR-0003):

```
packages/contexts/<ctx>/
├─ package.json            # "name": "@pf/<ctx>", exports "./contracts" y "./nest" con la condición "@pf/source"
├─ tsconfig.json           # typecheck: customConditions ["@pf/source"], include src
├─ tsconfig.build.json     # build: rootDir src → dist, sin customConditions
├─ vitest.config.ts        # resolve.conditions ['@pf/source']
├─ src/
│  ├─ domain/              # agregados, value objects, eventos, puertos de repositorio — solo @pf/shared-kernel
│  ├─ application/
│  │  ├─ ports/            # puertos "driven" propios (p. ej. LedgerPostingPort, Clock)
│  │  └─ *.service.ts      # casos de uso sin decoradores; usan UnitOfWork de @pf/platform
│  ├─ infrastructure/      # repositorios Kysely (schema <ctx>), adapters hacia @pf/<otro>/contracts, outbox
│  ├─ interface/
│  │  ├─ <ctx>.module.ts   # ÚNICO lugar con imports de Nest: providers useFactory + tokens, static register()
│  │  └─ *.controller.ts   # @Inject(TOKEN) explícito, DTOs HTTP (dinero como string decimal)
│  └─ contracts/
│     └─ index.ts          # commands, queries, DTOs, interfaces de API, tokens Symbol.for, eventos
└─ test/integration/       # *.int.test.ts con Testcontainers (unitarios colocados en src/**/*.test.ts)
```

Reglas (se harán ejecutables con dependency-cruiser en la tarea 5.2):

- `domain` → solo `@pf/shared-kernel`. Sin Nest, sin Kysely, sin I/O de Node.
- `application` → `domain`, puertos propios y `contracts` de otros contextos.
- Otro contexto solo se consume vía `@pf/<ctx>/contracts` (los deep imports los bloquea `package.json#exports`).
- Todo importe monetario se modela con `Money` del shared-kernel (ADR-0006); nunca `number`.
- `apps/api` (composition root) solo importa `@pf/<ctx>/nest` y `@pf/<ctx>/contracts`.
