// ENTRYPOINT de la imagen finance-api (ADR-0011: una imagen, varios comandos):
//   node dist/entrypoint.js api | worker | migrate | seed [--profile=minimal]
// Forma exec + `init: true` en Compose (SPIKE-08): node recibe SIGTERM directamente y los handlers de apagado
// ordenado de api/worker se ejecutan. Sin imports estáticos: OpenTelemetry (si OTEL_ENABLED=true) debe
// registrarse ANTES de cargar Nest, pg, etc.
const COMMANDS = {
  api: { module: './main.api.js', otel: true, service: 'finance-api' },
  worker: { module: './main.worker.js', otel: true, service: 'finance-worker' },
  migrate: { module: './main.migrate.js', otel: false, service: 'finance-api' },
  seed: { module: './main.seed.js', otel: false, service: 'finance-api' },
} as const;

type Command = keyof typeof COMMANDS;

const requested = process.argv[2] ?? 'api';
if (!(requested in COMMANDS)) {
  process.stderr.write(
    JSON.stringify({
      level: 'fatal',
      time: new Date().toISOString(),
      msg: `unknown command "${requested}" (expected: ${Object.keys(COMMANDS).join(' | ')})`,
    }) + '\n',
  );
  process.exit(64);
}

const command = COMMANDS[requested as Command];
if (command.otel) {
  // El register deduce el service.name de argv[1]; con el dispatcher se fija explícitamente por comando.
  // eslint-disable-next-line no-restricted-properties
  process.env['OTEL_SERVICE_NAME'] ||= command.service;
  await import('@pf/platform/otel/register');
}
await import(command.module);
