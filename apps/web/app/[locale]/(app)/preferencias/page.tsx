import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { PreferencesForm } from '../../../../src/ui/forms';

export default function PreferencesPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return <PreferencesForm />;
}
