// Worker plano (sin Nest ni BullMQ): recibe un job por HTTP, responde 202 y lo procesa async
// extrayendo el traceparent DESDE LOS DATOS DEL JOB (como haría con job.data en BullMQ).
import { createServer } from 'node:http';
import { context, propagation, trace, metrics, SpanKind, ROOT_CONTEXT } from '@opentelemetry/api';
import { als, createLogger } from '../logger.js';

const log = createLogger('worker');
const tracer = trace.getTracer('pf-spike-worker');
const meter = metrics.getMeter('pf-spike-worker');
const jobDuration = meter.createHistogram('pf.queue.job.duration', { unit: 's' });
const API_URL = process.env.API_URL ?? 'http://127.0.0.1:61980';

type Job = { eventId: string; type: string; correlationId: string; traceContext: Record<string, string>; payload: unknown };

async function processJob(job: Job) {
  const parent = propagation.extract(ROOT_CONTEXT, job.traceContext);
  const t0 = performance.now();
  await context.with(parent, () =>
    tracer.startActiveSpan(
      `job.process ${job.type}`,
      {
        kind: SpanKind.CONSUMER,
        attributes: { 'messaging.operation.type': 'process', 'pf.event_id': job.eventId, 'job.queue': 'spike.in-memory' },
      },
      async (span) => {
        await als.run({ correlationId: job.correlationId }, async () => {
          log.info({ event_id: job.eventId, event_type: job.type, job: { queue: 'spike.in-memory' } }, 'job processing');
          await new Promise((r) => setTimeout(r, 20 + Math.random() * 30)); // "proyección"
          await fetch(`${API_URL}/internal/ack`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ eventId: job.eventId }),
          });
          log.info({ event_id: job.eventId }, 'job completed');
        });
        jobDuration.record((performance.now() - t0) / 1000, { queue: 'spike.in-memory', outcome: 'completed' });
        span.end();
      },
    ),
  );
}

const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/jobs') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const job = JSON.parse(raw) as Job;
      res.writeHead(202).end();
      // handoff async: se procesa fuera del request (simula cola); el contexto viene de job.traceContext
      setTimeout(
        () => context.with(ROOT_CONTEXT, () => processJob(job).catch((e) => log.error({ err: e }, 'job failed'))),
        10,
      );
    });
    return;
  }
  if (req.url === '/health/live') return void res.writeHead(200).end('ok');
  res.writeHead(404).end();
});
const port = Number(process.env.PORT ?? 61981);
server.listen(port, '127.0.0.1', () => log.info(`worker listening on ${port}`));
