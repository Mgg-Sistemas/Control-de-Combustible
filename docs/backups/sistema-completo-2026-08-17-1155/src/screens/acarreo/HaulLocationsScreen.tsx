// ACARREO · Ubicaciones (obras, almacenes, talleres, minas, pozos).
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../../components/ui';
import { RecordForm, Field } from '../../components/RecordForm';
import { useTable } from '../../hooks/useTable';
import { HaulLocation } from '../../types/database';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { norm, cmpText } from '../../lib/text';

const TIPO_LABEL: Record<string, string> = {
  obra: '🏗️ Obra', almacen: '🏬 Almacén', taller: '🔧 Taller', mina: '⛏️ Mina', pozo: '🛢️ Pozo', otro: '📍 Otro',
};

const FIELDS: Field[] = [
  { key: 'name', label: 'Nombre de la ubicación', type: 'text', required: true },
  { key: 'type', label: 'Tipo', type: 'select', dropdown: true,
    options: [
      { label: 'Obra', value: 'obra' }, { label: 'Almacén', value: 'almacen' },
      { label: 'Taller', value: 'taller' }, { label: 'Mina', value: 'mina' },
      { label: 'Pozo', value: 'pozo' }, { label: 'Otro', value: 'otro' },
    ] },
  { key: 'client_id', label: 'Cliente / proyecto (opcional)', type: 'lookup', table: 'haul_clients', labelCol: 'name', dropdown: true },
  { key: 'latitude', label: 'Latitud (opcional)', type: 'number' },
  { key: 'longitude', label: 'Longitud (opcional)', type: 'number' },
];

export default function HaulLocationsScreen() {
  const { colors } = useTheme();
  const { data, loading, refetch } = useTable<HaulLocation>('haul_locations', { orderBy: 'name', ascending: true });
  const [editing, setEditing] = useState<HaulLocation | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [q, setQ] = useState('');

  const open = (l: HaulLocation | null) => { setEditing(l); setFormOpen(true); };

  const shown = useMemo(() => {
    const nq = norm(q.trim());
    const list = nq ? data.filter((l) => norm([l.name, l.type].filter(Boolean).join(' ')).includes(nq)) : data;
    return [...list].sort((a, b) => cmpText(a.name, b.name));
  }, [data, q]);

  return (
    <Screen>
      <SectionTitle>Ubicaciones</SectionTitle>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
        Puntos de origen y destino de los acarreos.
      </Text>

      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="🔎 Buscar por nombre o tipo…"
        placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: spacing.sm }}
      />

      <TouchableOpacity
        onPress={() => open(null)}
        style={{ backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginBottom: spacing.md }}
      >
        <Text style={{ color: colors.primaryContrast, fontWeight: '700', fontSize: 15 }}>+ Nueva ubicación</Text>
      </TouchableOpacity>

      {loading ? (
        <Loading />
      ) : shown.length === 0 ? (
        <EmptyState title="Sin ubicaciones" subtitle="Agrega la primera ubicación." />
      ) : (
        shown.map((l) => (
          <Card key={l.id}>
            <TouchableOpacity activeOpacity={0.7} onPress={() => open(l)}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>
                {l.name}
                <Text style={{ color: colors.muted, fontWeight: '600', fontSize: 12 }}>{'  · '}{TIPO_LABEL[l.type ?? 'otro'] ?? 'Otro'}</Text>
              </Text>
              {l.latitude != null && l.longitude != null ? (
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>📌 {l.latitude}, {l.longitude}</Text>
              ) : null}
            </TouchableOpacity>
          </Card>
        ))
      )}

      <RecordForm
        visible={formOpen}
        title={editing ? 'Editar ubicación' : 'Nueva ubicación'}
        table="haul_locations"
        fields={FIELDS}
        record={editing}
        allowDelete
        onClose={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); refetch(); }}
      />
    </Screen>
  );
}
