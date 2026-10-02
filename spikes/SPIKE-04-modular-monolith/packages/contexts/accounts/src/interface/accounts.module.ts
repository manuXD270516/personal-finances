import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Module,
  NotFoundException,
  Param,
  Post,
  type DynamicModule,
  type ModuleMetadata,
} from '@nestjs/common';
import { ID_GENERATOR, UNIT_OF_WORK } from '@pf/platform';
import type { InMemoryUnitOfWork } from '@pf/platform/in-memory';
import { LEDGER_POSTING_API } from '@pf/ledger/contracts';
import { OpenAccountService } from '../application/open-account.service.js';
import { InMemoryAccountRepository } from '../infrastructure/in-memory-account.repository.js';
import { LedgerPostingAdapter } from '../infrastructure/ledger-posting.adapter.js';
import { ACCOUNTS_API, type AccountsApi, type OpenAccountCommand } from '../contracts/index.js';

const ACCOUNT_REPOSITORY = Symbol('accounts.AccountRepository');
const LEDGER_POSTING_PORT = Symbol('accounts.LedgerPostingPort');

@Controller('accounts')
export class AccountsController {
  // @Inject explícito con token: no depende de design:paramtypes (decorator metadata).
  constructor(@Inject(ACCOUNTS_API) private readonly accounts: AccountsApi) {}

  @Post()
  @HttpCode(201)
  open(@Body() body: OpenAccountCommand) {
    return this.accounts.openAccount(body);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const a = await this.accounts.getAccount(id);
    if (!a) throw new NotFoundException();
    return a;
  }
}

type ModuleImport = NonNullable<ModuleMetadata['imports']>[number];

/**
 * Accounts NO importa el módulo Nest de Ledger: el composition root (apps/api) decide
 * qué módulo provee LEDGER_POSTING_API (in-process hoy; cliente HTTP si algún día se extrae).
 */
@Module({})
export class AccountsModule {
  static register(opts: { ledger: ModuleImport }): DynamicModule {
    return {
      module: AccountsModule,
      imports: [opts.ledger],
      controllers: [AccountsController],
      providers: [
        {
          provide: ACCOUNT_REPOSITORY,
          useFactory: (uow: InMemoryUnitOfWork) => new InMemoryAccountRepository(uow),
          inject: [UNIT_OF_WORK],
        },
        {
          provide: LEDGER_POSTING_PORT,
          useFactory: (api) => new LedgerPostingAdapter(api),
          inject: [LEDGER_POSTING_API],
        },
        {
          provide: ACCOUNTS_API,
          useFactory: (uow, repo, ledger, ids) => new OpenAccountService(uow, repo, ledger, ids),
          inject: [UNIT_OF_WORK, ACCOUNT_REPOSITORY, LEDGER_POSTING_PORT, ID_GENERATOR],
        },
      ],
      exports: [ACCOUNTS_API],
    };
  }
}
