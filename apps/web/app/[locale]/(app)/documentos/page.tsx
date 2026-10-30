import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { DocumentsPageView } from '../../../../src/ui/documents/DocumentsPage';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return <DocumentsPageView />;
}
