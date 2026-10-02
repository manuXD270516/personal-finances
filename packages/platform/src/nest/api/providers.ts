import type { Provider } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import {
  ConditionalRequestInterceptor,
  ContractValidationInterceptor,
  DeprecationInterceptor,
  IdempotencyInterceptor,
  RateLimitGuard,
} from './interceptors.js';
import { API_CONVENTIONS, type ApiConventionsOptions } from './options.js';
import { ProblemDetailsFilter } from './problem-details.filter.js';

/**
 * Registra las convenciones de API como componentes globales, en este orden (design §1):
 * `RateLimitGuard` → `ContractValidationInterceptor` → `DeprecationInterceptor` → `IdempotencyInterceptor` →
 * `ConditionalRequestInterceptor` → handler; `ProblemDetailsFilter` renderiza todo error. Ningún controller
 * necesita código específico: basta con que su operación esté en el contrato.
 */
export function apiConventionsProviders(options: ApiConventionsOptions): Provider[] {
  return [
    { provide: API_CONVENTIONS, useValue: options },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: ContractValidationInterceptor },
    { provide: APP_INTERCEPTOR, useClass: DeprecationInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ConditionalRequestInterceptor },
  ];
}
