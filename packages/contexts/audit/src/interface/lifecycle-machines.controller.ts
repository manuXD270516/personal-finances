import { Controller, Get, Inject, Param } from '@nestjs/common';
import { ApiProblem } from '@pf/platform/api';
import { LIFECYCLE_QUERY, type LifecycleQuery } from '../contracts/index.js';
import { isLifecycleAggregateType } from '../application/lifecycle-queries.js';

/**
 * `GET /api/v1/workspaces/{workspaceId}/lifecycle-machines/{aggregateType}` (`getLifecycleMachine`,
 * add-lifecycle-timeline § Contratos): definición vigente de la máquina de estados de un tipo de agregado. VIEWER+
 * (`x-required-role`, lo aplica el guard de identidad); el contrato valida el enum de `aggregateType`.
 */
@Controller()
export class LifecycleMachinesController {
  constructor(@Inject(LIFECYCLE_QUERY) private readonly lifecycle: LifecycleQuery) {}

  @Get('workspaces/:workspaceId/lifecycle-machines/:aggregateType')
  machine(@Param('aggregateType') aggregateType: string) {
    if (!isLifecycleAggregateType(aggregateType)) {
      throw new ApiProblem('RESOURCE_NOT_FOUND', `no lifecycle machine for ${aggregateType}`);
    }
    return this.lifecycle.machineOf(aggregateType);
  }
}
