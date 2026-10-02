import { defineConfig } from 'prisma/config';

// Prisma 7: la URL vive en prisma.config.ts (no en schema.prisma).
// Solo se usa para `prisma db pull` (introspección); Prisma Migrate NO se usa (dbmate es la fuente de verdad).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: 'postgres://pf_migrator:spike-only-migrator@127.0.0.1:61432/pf_spike',
  },
});
