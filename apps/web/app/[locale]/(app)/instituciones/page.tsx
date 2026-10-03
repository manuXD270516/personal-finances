import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { InstitutionsPage } from '../../../../src/ui/accounts/InstitutionsPage';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return <InstitutionsPage />;
}
