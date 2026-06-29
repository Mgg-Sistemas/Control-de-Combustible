import React from 'react';
import { Screen, Card, SectionTitle, EmptyState, Loading } from './ui';
import { ConfigBanner } from './ConfigBanner';
import { useTable } from '../hooks/useTable';

type Props<T> = {
  title: string;
  table: string;
  orderBy?: string;
  select?: string;
  emptyTitle: string;
  emptySubtitle?: string;
  renderItem: (item: T) => React.ReactNode;
};

/** Pantalla genérica que lista filas de una tabla de Supabase como tarjetas. */
export function ListScreen<T extends { id: string }>({
  title,
  table,
  orderBy = 'created_at',
  select = '*',
  emptyTitle,
  emptySubtitle,
  renderItem,
}: Props<T>) {
  const { data, loading } = useTable<T>(table, { orderBy, select });
  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>{title}</SectionTitle>
      {loading ? (
        <Loading />
      ) : data.length === 0 ? (
        <EmptyState title={emptyTitle} subtitle={emptySubtitle} />
      ) : (
        data.map((item) => <Card key={item.id}>{renderItem(item)}</Card>)
      )}
    </Screen>
  );
}
