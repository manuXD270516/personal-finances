import type { LoggerService } from '@nestjs/common';
import type { Logger } from '../logging/index.js';

/** Adapta el logger pino de plataforma a `LoggerService` para que también los logs internos de Nest sean JSON. */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, ...params: unknown[]): void {
    this.write('info', message, params);
  }
  error(message: unknown, ...params: unknown[]): void {
    this.write('error', message, params);
  }
  warn(message: unknown, ...params: unknown[]): void {
    this.write('warn', message, params);
  }
  debug(message: unknown, ...params: unknown[]): void {
    this.write('debug', message, params);
  }
  verbose(message: unknown, ...params: unknown[]): void {
    this.write('trace', message, params);
  }
  fatal(message: unknown, ...params: unknown[]): void {
    this.write('fatal', message, params);
  }

  private write(
    level: 'info' | 'error' | 'warn' | 'debug' | 'trace' | 'fatal',
    message: unknown,
    params: unknown[],
  ) {
    const context = typeof params.at(-1) === 'string' ? (params.at(-1) as string) : undefined;
    const fields: Record<string, unknown> = context ? { context } : {};
    if (message instanceof Error) {
      this.logger[level]({ ...fields, err: message }, message.message);
    } else if (typeof message === 'string') {
      this.logger[level](fields, message);
    } else {
      this.logger[level]({ ...fields, detail: message }, 'nest log');
    }
  }
}
