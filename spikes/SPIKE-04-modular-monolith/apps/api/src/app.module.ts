import { randomUUID } from 'node:crypto';
import { Catch, Global, Module, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { DomainError, type IdGenerator } from '@pf/shared-kernel';
import { ID_GENERATOR, UNIT_OF_WORK } from '@pf/platform';
import { InMemoryDatabase, InMemoryUnitOfWork } from '@pf/platform/in-memory';
// Composition root: solo puede importar `@pf/<ctx>/nest` y `@pf/<ctx>/contracts`.
import { LedgerModule } from '@pf/ledger/nest';
import { AccountsModule } from '@pf/accounts/nest';

@Catch(DomainError)
export class DomainErrorFilter implements ExceptionFilter {
  catch(err: DomainError, host: ArgumentsHost) {
    // Tipado mínimo para no depender de @types/express en el spike.
    const res = host.switchToHttp().getResponse<{ status(n: number): { json(b: unknown): void } }>();
    res.status(422).json({ type: 'about:blank', title: err.code, detail: err.message, status: 422 });
  }
}

/** Plataforma: UnitOfWork + IdGenerator, globales para todos los módulos de contexto. */
@Global()
@Module({
  providers: [
    { provide: InMemoryDatabase, useValue: new InMemoryDatabase() },
    { provide: UNIT_OF_WORK, useFactory: (db: InMemoryDatabase) => new InMemoryUnitOfWork(db), inject: [InMemoryDatabase] },
    { provide: ID_GENERATOR, useValue: { next: () => randomUUID() } satisfies IdGenerator },
  ],
  exports: [InMemoryDatabase, UNIT_OF_WORK, ID_GENERATOR],
})
export class PlatformModule {}

@Module({
  imports: [PlatformModule, LedgerModule, AccountsModule.register({ ledger: LedgerModule })],
  providers: [{ provide: APP_FILTER, useClass: DomainErrorFilter }],
})
export class AppModule {}
