import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { one } from '../../../../../src/ui/common/search-params';
import { BudgetsPage } from '../../../../../src/ui/planning/BudgetsPage';

export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  setRequestLocale(use(params).locale);
  // Enlace desde una notificación (`?periodo=2026-11&linea=<id>`): periodo por etiqueta y línea a resaltar.
  const q = use(searchParams);
  const periodo = one(q['periodo']);
  const linea = one(q['linea']);
  return <BudgetsPage {...(periodo ? { periodo } : {})} {...(linea ? { linea } : {})} />;
}
