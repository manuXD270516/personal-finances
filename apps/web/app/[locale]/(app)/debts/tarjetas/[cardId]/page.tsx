import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { one } from '../../../../../../src/ui/common/search-params';
import { CardDetailPage } from '../../../../../../src/ui/debt/cards/CardDetail';

/** `?statementId=` (enlace de la notificación de vencimiento) abre ese estado de cuenta. */
export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; cardId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, cardId } = use(params);
  setRequestLocale(locale);
  const statementId = one(use(searchParams)['statementId']);
  return <CardDetailPage cardId={cardId} {...(statementId ? { statementId } : {})} />;
}
