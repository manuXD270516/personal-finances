import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { WorkspaceSettingsForm } from '../../../../src/ui/forms';

export default function WorkspaceSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return <WorkspaceSettingsForm />;
}
