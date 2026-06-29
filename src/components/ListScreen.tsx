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
  /** Si es true, tocar una tarjeta abre el formulario en modo edición. */
  editable?: boolean;
};

/** Pantalla genérica que lista filas de una tabla de Supabase y permite crear/editar. */
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
  editable = false,
}: Props<T>) {
  const { data, loading, refetch } = useTable<T>(table, { orderBy, select });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (item: T) => {
    setEditing(item);
    setFormOpen(true);
  };

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
            onPress={openNew}
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
        data.map((item) =>
          editable && formFields ? (
            <TouchableOpacity key={item.id} onPress={() => openEdit(item)} activeOpacity={0.7}>
              <Card>
                {renderItem(item)}
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>
                  Toca para editar
                </Text>
              </Card>
            </TouchableOpacity>
          ) : (
            <Card key={item.id}>{renderItem(item)}</Card>
          )
        )
      )}

      {formFields ? (
        <RecordForm
          visible={formOpen}
          title={editing ? `Editar: ${title}` : formTitle ?? `Nuevo: ${title}`}
          table={table}
          fields={formFields}
          autoUserField={autoUserField}
          record={editing as any}
          allowDelete={editable}
          onClose={() => setFormOpen(false)}
          onSaved={refetch}
        />
      ) : null}
    </Screen>
  );
}
