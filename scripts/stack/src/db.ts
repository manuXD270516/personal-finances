// pnpm db:migrate [-- --host]            migraciones (contenedor por defecto; --host = modo A con el binario local)
// pnpm db:seed [-- --profile=minimal]    seed one-shot (`docker compose --profile core run --rm seed`)
import { option, parseArgs } from './lib/args.js';
import { runMain, UsageError } from './lib/cli.js';
import { composeContext } from './lib/compose.js';
import { buildApi, migrateInContainer, runApiCommandOnHost, seedInContainer } from './lib/db.js';
import { loadEnvFile } from './lib/dotenv.js';

runMain(async () => {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest, ['profile']);
  const onHost = args.flags.has('host');
  const env = () => loadEnvFile(composeContext().envFile, process.env);
  switch (command) {
    case 'migrate':
      if (onHost) {
        await buildApi();
        await runApiCommandOnHost('migrate', env());
      } else {
        await migrateInContainer();
      }
      return 0;
    case 'seed': {
      const profile = option(args, 'profile') ?? 'minimal';
      if (onHost) await runApiCommandOnHost('seed', env(), [`--profile=${profile}`]);
      else await seedInContainer(profile);
      return 0;
    }
    default:
      throw new UsageError('uso: db.ts migrate|seed [--host] [--profile=minimal]');
  }
});
