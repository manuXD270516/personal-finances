// Graceful shutdown helper shared by api and worker (stand-in for the real NestJS hooks).
const log = (...a) => console.log(new Date().toISOString(), `[${process.env.PF_PROCESS ?? 'app'} pid=${process.pid}]`, ...a);
export { log };

export function installShutdown(name, drain) {
  if (process.env.PF_NO_HANDLER === '1') {
    log('NO SIGTERM handler installed (experiment)');
    return;
  }
  let shuttingDown = false;
  const handler = async (sig) => {
    if (shuttingDown) return;
    shuttingDown = true;
    const t0 = Date.now();
    log(`SHUTDOWN_HANDLER_START signal=${sig}`);
    try {
      await drain();
      log(`SHUTDOWN_HANDLER_DONE in ${Date.now() - t0}ms -> exit 0`);
      process.exit(0);
    } catch (e) {
      log('SHUTDOWN_HANDLER_ERROR', e);
      process.exit(1);
    }
  };
  process.on('SIGTERM', handler);
  process.on('SIGINT', handler);
  log(`SIGTERM handler installed for ${name}`);
}
