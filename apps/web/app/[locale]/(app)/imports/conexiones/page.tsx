import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { ImportConnectionsPage } from '../../../../../src/ui/imports/ConnectionsPage';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return <ImportConnectionsPage />;
}
