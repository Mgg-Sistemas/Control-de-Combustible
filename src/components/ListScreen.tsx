import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from './ui';
import { ConfigBanner } from './ConfigBanner';
import { RecordForm, Field } from './RecordForm';
import { useTable } from '../hooks/useTable';
import { colors, spacing, radius } from '../theme';

type Props<T> = {
  title: string;
  table: string;
  orderBy?: string;
  select?: string;
  emptyTitle: string;
  emptySubtitle?: string;
  renderItem: (item: T) => React.ReactNode;
  /** Si se define, muestra el botón "+ Nuevo" y un formulario de alta. */
  formFields?: Field[];
  formTitle?: string;
  autoUserField?: string;
};

/** Pantalla genérica que lista filas de una tabla de Supabase y permite crear nuevas. */
export function ListScreen<T extends { id: string }>({
  title,
  table,
  orderBy = 'created_at',
  select = '*',
  emptyTitle,
  emptySubtitle,
  renderItem,
  formFields,
  formTitle,
  autoUserField,
}: Props<T>) {
  const { data, loading, refetch } = useTable<T>(table, { orderBy, select });
  const [formOpen, setFormOpen] = useState(false);

  return (
    <Screen>
      <ConfigBanner />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>{title}</SectionTitle>
        {formFields ? (
          <TouchableOpacity
            style={{
              backgroundColor: colors.primary,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.xs,
              borderRadius: radius.pill,
            }}
            onPress={() => setFormOpen(true)}
          >
            <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>+ Nuevo</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {loading ? (
        <Loading />
      ) : data.length === 0 ? (
        <EmptyState title={emptyTitle} subtitle={emptySubtitle} />
      ) : (
        data.map((item) => <Card key={item.id}>{renderItem(item)}</Card>)
      )}

      {formFields ? (
        <RecordForm
          visible={formOpen}
          title={formTitle ?? `Nuevo: ${title}`}
          table={table}
          fields={formFields}
          autoUserField={autoUserField}
          onClose={() => setFormOpen(false)}
          onSaved={refetch}
        />
      ) : null}
    </Screen>
  );
}
