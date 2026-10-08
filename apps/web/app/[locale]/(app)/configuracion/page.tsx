import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { DemoDataPanel } from '../../../../src/ui/DemoDataPanel';
import { WorkspaceSettingsForm } from '../../../../src/ui/forms';
import { ClosingPolicyPanel } from '../../../../src/ui/planning/ClosingPolicyPanel';

export default function WorkspaceSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return (
    <>
      <WorkspaceSettingsForm />
      <ClosingPolicyPanel />
      <DemoDataPanel />
    </>
  );
}
