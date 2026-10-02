import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { acceptRequestId, runWithCorrelation, uuidv7 } from './correlation.js';
import { createLogger } from './logger.js';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(...chunk.toString('utf8').split('\n').filter(Boolean));
      cb();
    },
  });
  const logger = createLogger({
    service: 'finance-api',
    role: 'api',
    environment: 'ci',
    level: 'debug',
    destination: stream,
  });
  return { logger, lines, records: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>) };
}

const TOKEN = 'token-ficticio-de-prueba';

describe('logger estructurado (docs/18 §3)', () => {
  it('[TC-PLATFORM-OBS-002] cada línea es JSON con time, level, service, entorno y correlation_id del contexto', () => {
    const { logger, records } = capture();
    runWithCorrelation({ correlationId: 'corr-00000001', requestId: 'corr-00000001' }, () =>
      logger.info('hola'),
    );
    logger.info('fuera de contexto');
    const [inside, outside] = records();
    expect(inside).toMatchObject({
      level: 'info',
      msg: 'hola',
      'service.name': 'finance-api',
      'deployment.environment': 'ci',
      'process.role': 'api',
      correlation_id: 'corr-00000001',
      request_id: 'corr-00000001',
    });
    expect(new Date(String(inside!['time'])).toISOString()).toBe(inside!['time']);
    expect(outside).not.toHaveProperty('correlation_id');
  });

  it('[TC-PLATFORM-OBS-003] redacta Authorization, cookies, tokens y contenido de documentos', () => {
    const { logger, lines } = capture();
    logger.info(
      {
        req: { headers: { authorization: `Bearer ${TOKEN}`, cookie: `pf_session=${TOKEN}` } },
        res: { headers: { 'set-cookie': `pf_session=${TOKEN}` } },
        headers: { authorization: `Bearer ${TOKEN}` },
        token: TOKEN,
        auth: { accessToken: TOKEN, refresh_token: TOKEN, password: TOKEN },
        upload: { content: `CONTENIDO-${TOKEN}`, documentContent: TOKEN },
        input: { amount: '7731.42', description: `glosa ${TOKEN}` },
        body: { anything: TOKEN },
        nested: { deeper: { token: TOKEN, apiKey: TOKEN } },
      },
      'intento deliberado de loguear datos sensibles',
    );
    const out = lines.join('\n');
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain('7731.42');
    expect(out).toContain('[REDACTED]');
  });

  it('acepta solo X-Request-Id opacos y genera UUIDv7 ordenables', () => {
    expect(acceptRequestId('0191f0c2-0000-7000-8000-000000000001')).toBe(
      '0191f0c2-0000-7000-8000-000000000001',
    );
    expect(acceptRequestId('a b\n{"level":"fatal"}')).toBeUndefined();
    expect(acceptRequestId('x'.repeat(200))).toBeUndefined();
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });
});
