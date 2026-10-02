import { createPrismaRepo } from '../src/prisma/repo.js';
import { ledgerSuite } from './suite.js';

ledgerSuite('prisma', (o) => createPrismaRepo(o));
