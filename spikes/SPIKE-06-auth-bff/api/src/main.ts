import 'reflect-metadata';
import { Catch, HttpException, Module, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { JwtAuthGuard, WorkspaceRoleGuard } from './guards.js';
import { HealthController, MeController, WorkspaceController } from './controllers.js';

/** Errores RFC 9457 (application/problem+json). */
@Catch()
class ProblemFilter implements ExceptionFilter {
  catch(ex: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const status = ex instanceof HttpException ? ex.getStatus() : 500;
    const raw = ex instanceof HttpException ? ex.getResponse() : {};
    const { message: _m, error: _e, statusCode: _s, ...extra } = (typeof raw === 'object' && raw ? raw : {}) as Record<string, unknown>;
    if (status === 500) console.error(ex);
    const title = status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : status === 404 ? 'Not Found' : 'Error';
    res.status(status).type('application/problem+json').send(JSON.stringify({ type: 'about:blank', status, title, ...extra }));
  }
}

@Module({
  controllers: [HealthController, MeController, WorkspaceController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard }, // 1) authN: JWT
    { provide: APP_GUARD, useClass: WorkspaceRoleGuard }, // 2) authZ: rol por workspace
    { provide: APP_FILTER, useClass: ProblemFilter },
  ],
})
class AppModule {}

const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
await app.listen(config.port, '127.0.0.1');
console.log(`finance-api (spike) escuchando en http://127.0.0.1:${config.port}`);
