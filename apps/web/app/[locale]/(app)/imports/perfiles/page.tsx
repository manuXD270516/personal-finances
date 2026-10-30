import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { ImportProfilesPage } from '../../../../../src/ui/imports/ProfilesPage';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return <ImportProfilesPage />;
}
