import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { NotificationDetail } from '../../../../../src/ui/notifications/NotificationDetail';

export default function Page({ params }: { params: Promise<{ locale: string; notificationId: string }> }) {
  const { locale, notificationId } = use(params);
  setRequestLocale(locale);
  return <NotificationDetail notificationId={notificationId} />;
}
