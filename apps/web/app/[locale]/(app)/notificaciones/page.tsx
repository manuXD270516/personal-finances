import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { NotificationInbox } from '../../../../src/ui/notifications/NotificationInbox';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return <NotificationInbox />;
}
