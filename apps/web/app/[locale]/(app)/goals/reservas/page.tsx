import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { one } from '../../../../../src/ui/common/search-params';
import { ReservationsPage } from '../../../../../src/ui/goals/Reservations';

/** `?accountId=` limita las reservas a una cuenta (enlace de la notificación `GOAL_RESERVATIONS`). */
export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  setRequestLocale(use(params).locale);
  const accountId = one(use(searchParams)['accountId']);
  return <ReservationsPage accountId={accountId} />;
}
