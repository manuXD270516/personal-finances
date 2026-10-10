import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { ImportDetailPage } from '../../../../../src/ui/imports/ImportWizard';

export default function Page({ params }: { params: Promise<{ locale: string; importId: string }> }) {
  const { locale, importId } = use(params);
  setRequestLocale(locale);
  return <ImportDetailPage importId={importId} />;
}
