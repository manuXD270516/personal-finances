import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  Body,
  type CallHandler,
  Controller,
  type ExecutionContext,
  Get,
  Headers,
  HttpCode,
  Inject,
  Injectable,
  Module,
  type NestInterceptor,
  Post,
} from '@nestjs/common';
import { getRPCMetadata, RPCType } from '@opentelemetry/core';
import { NestFactory } from '@nestjs/core';
import { LoggerModule, PinoLogger, Logger } from 'nestjs-pino';
import { context, metrics, propagation, SpanStatusCode, trace } from '@opentelemetry/api';
import { als, baseLoggerOptions } from '../logger.js';

const WORKER_URL = process.env.WORKER_URL ?? 'http://127.0.0.1:61981';
const tracer = trace.getTracer('pf-spike-api');
const meter = metrics.getMeter('pf-spike-api');
const txCounter = meter.createCounter('pf.transactions.recorded', {
  description: 'Transacciones registradas (sin montos)',
});

// "Outbox" en memoria: occurred_at de eventos aún no confirmados por el worker
const pendingOutbox = new Map<string, number>();
meter
  .createObservableGauge('pf.outbox.lag', { unit: 's', description: 'now - min(occurred_at) de pendientes' })
  .addCallback((r) => {
    const oldest = Math.min(...pendingOutbox.values());
    r.observe(Number.isFinite(oldest) ? (Date.now() - oldest) / 1000 : 0);
  });
meter.createObservableGauge('pf.outbox.pending').addCallback((r) => r.observe(pendingOutbox.size));

@Injectable()
class RecordTransaction {
  constructor(@Inject(PinoLogger) private readonly log: PinoLogger) {}

  async execute(kind: string, correlationId: string) {
    // span manual de caso de uso (en prod: wrapper en capa application vía puerto Tracer)
    return tracer.startActiveSpan('usecase.RecordTransaction', async (span) => {
      try {
        const eventId = randomUUID();
        span.setAttributes({ 'pf.use_case': 'RecordTransaction', 'pf.event_id': eventId, 'pf.kind': kind });
        txCounter.add(1, { kind });
        pendingOutbox.set(eventId, Date.now());
        // Envelope del evento: el traceparent viaja EN LOS DATOS (patrón outbox/BullMQ), no solo en headers HTTP
        const traceContext: Record<string, string> = {};
        propagation.inject(context.active(), traceContext);
        const job = { eventId, type: 'transactions.TransactionPosted.v1', correlationId, traceContext, payload: { kind } };
        this.log.info({ event_id: eventId, event_type: job.type }, 'transaction recorded');
        const res = await fetch(`${WORKER_URL}/jobs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(job),
        });
        if (!res.ok) throw new Error(`worker ${res.status}`);
        return { eventId, correlationId, traceId: span.spanContext().traceId };
      } catch (e) {
        span.recordException(e as Error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw e;
      } finally {
        span.end();
      }
    });
  }
}

@Controller()
class AppController {
  constructor(
    @Inject(RecordTransaction) private readonly uc: RecordTransaction,
    @Inject(PinoLogger) private readonly log: PinoLogger,
  ) {}

  @Get('ping')
  ping() {
    return { ok: true };
  }

  @Get('health/live')
  live() {
    return { status: 'ok' };
  }

  @Post('transactions')
  @HttpCode(201)
  async record(
    @Body() body: { kind?: string; amount?: string; description?: string },
    @Headers('x-request-id') rid?: string,
  ) {
    const correlationId = rid ?? randomUUID();
    return als.run({ correlationId }, () => {
      // intento deliberado de loguear datos sensibles -> deben salir [REDACTED]
      this.log.info({ input: { amount: body.amount, description: body.description } }, 'record transaction requested');
      return this.uc.execute(body.kind ?? 'expense', correlationId);
    });
  }

  // El worker confirma el procesamiento -> sale del outbox
  @Post('internal/ack')
  @HttpCode(204)
  ack(@Body() body: { eventId: string }) {
    pendingOutbox.delete(body.eventId);
  }
}

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        ...baseLoggerOptions('api'),
        genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
        autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/health') },
        quietReqLogger: true,
      },
    }),
  ],
  controllers: [AppController],
  providers: [RecordTransaction],
})
class AppModule {}

// Sin instrumentation-express (ruido) y sin instrumentation-nestjs-core (no soporta Nest 12: '>=4 <12'),
// el span HTTP no recibe http.route. Este interceptor la fija -> span "POST /transactions" y label http_route
// en http.server.request.duration (plantilla, nunca la URL con ids).
@Injectable()
class OtelRouteInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler) {
    const req = ctx.switchToHttp().getRequest<{ route?: { path?: string }; method: string }>();
    const rpc = getRPCMetadata(context.active());
    if (rpc?.type === RPCType.HTTP && req.route?.path) {
      rpc.route = req.route.path;
      rpc.span.updateName(`${req.method} ${req.route.path}`);
    }
    return next.handle();
  }
}

const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.useLogger(app.get(Logger));
app.useGlobalInterceptors(new OtelRouteInterceptor());
const port = Number(process.env.PORT ?? 61980);
await app.listen(port, '127.0.0.1');
app.get(Logger).log(`api listening on ${port}`);
