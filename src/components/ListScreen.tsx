import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Platform } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from './ui';
import { ConfigBanner } from './ConfigBanner';
import { RecordForm, Field } from './RecordForm';
import { useTable } from '../hooks/useTable';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

/** Campo de fecha con calendario en web; texto en nativo. */
function DateInput({ value, onChange, colors }: { value: string; onChange: (v: string) => void; colors: any }) {
  if (Platform.OS === 'web') {
    return React.createElement('input', {
      type: 'date',
      value: value || '',
      onChange: (e: any) => onChange(e.target.value),
      style: {
        padding: '9px', borderRadius: '10px', border: '1px solid ' + colors.border,
        background: colors.surface, color: colors.text, fontSize: '14px', width: '100%', boxSizing: 'border-box',
      },
    });
  }
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder="AAAA-MM-DD"
      placeholderTextColor={colors.muted}
      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }}
    />
  );
}

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
  /** Si se define, muestra un filtro por rango de fecha sobre esta columna (p. ej. intake_date). */
  dateField?: string;
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
  dateField,
}: Props<T>) {
  const { colors } = useTheme();
  const { data, loading, refetch } = useTable<T>(table, { orderBy, select });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const shown = useMemo(() => {
    if (!dateField || (!from && !to)) return data;
    return data.filter((item) => {
      const v = String((item as any)[dateField] ?? '').slice(0, 10);
      if (!v) return false;
      if (from && v < from) return false;
      if (to && v > to) return false;
      return true;
    });
  }, [data, dateField, from, to]);

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

      {dateField ? (
        <Card>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Filtrar por rango de fecha</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Desde</Text>
              <DateInput value={from} onChange={setFrom} colors={colors} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Hasta</Text>
              <DateInput value={to} onChange={setTo} colors={colors} />
            </View>
          </View>
          {from || to ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm }}>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{shown.length} resultado(s)</Text>
              <TouchableOpacity onPress={() => { setFrom(''); setTo(''); }} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, backgroundColor: colors.surfaceAlt, borderRadius: radius.md }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Limpiar</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </Card>
      ) : null}

      {loading ? (
        <Loading />
      ) : shown.length === 0 ? (
        <EmptyState title={(from || to) ? 'Sin resultados en el rango' : emptyTitle} subtitle={(from || to) ? 'Prueba con otras fechas.' : emptySubtitle} />
      ) : (
        shown.map((item) =>
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
