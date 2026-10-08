// Re-exportaciones de dominio para las pruebas de integración (evita rutas relativas largas en cada archivo).
export { Budget, BudgetLine, BudgetTemplate } from '../../src/domain/index.js';
export { currency as currencyOf } from '@pf/shared-kernel';
