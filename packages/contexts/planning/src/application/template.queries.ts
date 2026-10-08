import { DomainError } from '@pf/shared-kernel';
import type { TemplateStatus } from '../domain/index.js';
import type { BudgetsDeps } from './ports/index.js';
import {
  toSummaryDto,
  toTemplateDto,
  toVersionDto,
  type TemplateDto,
  type TemplateSummaryDto,
  type TemplateVersionDto,
} from './template-view.js';

/** Consultas de templates (VIEWER+): lista, template con su versión vigente y versiones, y una versión concreta. */
export class TemplateQueries {
  constructor(private readonly deps: BudgetsDeps) {}

  list(workspaceId: string, status?: TemplateStatus): Promise<TemplateSummaryDto[]> {
    return this.deps.uow.run(workspaceId, async () =>
      (await this.deps.templates.list(workspaceId, status)).map(toSummaryDto),
    );
  }

  get(workspaceId: string, templateId: string): Promise<TemplateDto> {
    return this.deps.uow.run(workspaceId, async () => {
      const template = await this.deps.templates.findById(workspaceId, templateId);
      if (!template) throw new DomainError('RESOURCE_NOT_FOUND', `budget template ${templateId} not found`);
      return toTemplateDto(template, await this.deps.templates.listVersions(workspaceId, templateId));
    });
  }

  getVersion(workspaceId: string, templateId: string, versionNo: number): Promise<TemplateVersionDto> {
    return this.deps.uow.run(workspaceId, async () => {
      const template = await this.deps.templates.findById(workspaceId, templateId);
      if (!template) throw new DomainError('RESOURCE_NOT_FOUND', `budget template ${templateId} not found`);
      const version = await this.deps.templates.findVersion(workspaceId, templateId, versionNo);
      if (!version) {
        throw new DomainError(
          'RESOURCE_NOT_FOUND',
          `version ${versionNo} of template ${templateId} not found`,
        );
      }
      return toVersionDto(version);
    });
  }
}
