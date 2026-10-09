import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { AuditSettingsLink } from '../../../../src/ui/audit/AuditLink';
import { DemoDataPanel } from '../../../../src/ui/DemoDataPanel';
import { WorkspaceSettingsForm } from '../../../../src/ui/forms';
import { ClosingPolicyPanel } from '../../../../src/ui/planning/ClosingPolicyPanel';
import { ExportPanel, ImportPanel } from '../../../../src/ui/portability/PortabilityPanels';

export default function WorkspaceSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return (
    <>
      <WorkspaceSettingsForm />
      <AuditSettingsLink />
      <ClosingPolicyPanel />
      <ExportPanel />
      <ImportPanel />
      <DemoDataPanel />
    </>
  );
}
