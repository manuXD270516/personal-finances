import { defineConfig } from 'drizzle-kit';

// Solo introspección (`drizzle-kit pull`). drizzle-kit migrate/push NO se usan: dbmate es la fuente de verdad.
export default defineConfig({
  dialect: 'postgresql',
  out: './src/drizzle/pulled',
  schemaFilter: ['fx', 'iam', 'ledger'],
  dbCredentials: { url: 'postgres://pf_migrator:spike-only-migrator@127.0.0.1:61432/pf_spike' },
});
