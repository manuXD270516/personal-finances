import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { SpendableSettingsPage } from '../../../../../src/ui/spendable/SpendableSettings';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return <SpendableSettingsPage />;
}
