import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { TemplatesPage } from '../../../../../src/ui/planning/TemplatesPage';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return <TemplatesPage />;
}
