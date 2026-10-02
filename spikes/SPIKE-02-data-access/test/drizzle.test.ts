import { createDrizzleRepo } from '../src/drizzle/repo.js';
import { ledgerSuite } from './suite.js';

ledgerSuite('drizzle', (o) => createDrizzleRepo(o));
