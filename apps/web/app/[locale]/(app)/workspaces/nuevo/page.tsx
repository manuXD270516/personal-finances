import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { CreateWorkspaceForm } from '../../../../../src/ui/forms';

export default function NewWorkspacePage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return <CreateWorkspaceForm />;
}
