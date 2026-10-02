export { checkModel, loadModel, runCheck } from './check.js';
export type { CheckOptions, CheckResult, LoadOptions } from './check.js';
export { loadCatalog, parseCaseFile } from './catalog.js';
export { main } from './cli.js';
export { buildMatrix, renderMatrixMarkdown, writeMatrix } from './matrix.js';
export type { MatrixJson } from './matrix.js';
export { loadRequirements, parseSpecMarkdown, parseTrace } from './openspec.js';
export { scanTests } from './tests-scan.js';
export type * from './types.js';
