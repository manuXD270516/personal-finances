import { createKyselyRepo } from '../src/kysely/repo.js';
import { ledgerSuite } from './suite.js';

ledgerSuite('kysely', (o) => createKyselyRepo(o));
