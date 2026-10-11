import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { NewCardPage } from '../../../../../../src/ui/debt/cards/CardForm';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return <NewCardPage />;
}
