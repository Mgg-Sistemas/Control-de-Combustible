// ACARREO · Flota: bateas / lowboys / remolques.
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../../components/ui';
import { RecordForm, Field } from '../../components/RecordForm';
import { useTable } from '../../hooks/useTable';
import { HaulTrailer } from '../../types/database';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { norm, cmpText } from '../../lib/text';

const KIND: Record<string, string> = { batea: 'Batea', lowboy: 'Lowboy', remolque: 'Remolque' };
const STATUS: Record<string, string> = { operativo: '🟢 Operativo', taller: '🟠 En taller', inactivo: '⚫ Inactivo' };

const FIELDS: Field[] = [
  { key: 'plate', label: 'Placa', type: 'text', required: true },
  { key: 'kind', label: 'Tipo', type: 'select', dropdown: true,
    options: [{ label: 'Batea', value: 'batea' }, { label: 'Lowboy', value: 'lowboy' }, { label: 'Remolque', value: 'remolque' }] },
  { key: 'axles', label: 'Ejes', type: 'number' },
  { key: 'max_load_ton', label: 'Capacidad de carga (toneladas)', type: 'number' },
  { key: 'deck_len_m', label: 'Largo útil (m)', type: 'number' },
  { key: 'deck_width_m', label: 'Ancho útil (m)', type: 'number' },
  { key: 'deck_height_m', label: 'Alto útil (m)', type: 'number' },
  { key: 'status', label: 'Estado', type: 'select', dropdown: true,
    options: [{ label: 'Operativo', value: 'operativo' }, { label: 'En taller', value: 'taller' }, { label: 'Inactivo', value: 'inactivo' }] },
];

export default function HaulTrailersScreen() {
  const { colors } = useTheme();
  const { data, loading, refetch } = useTable<HaulTrailer>('haul_trailers', { orderBy: 'plate', ascending: true });
  const [editing, setEditing] = useState<HaulTrailer | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [q, setQ] = useState('');

  const open = (t: HaulTrailer | null) => { setEditing(t); setFormOpen(true); };

  const shown = useMemo(() => {
    const nq = norm(q.trim());
    const list = nq ? data.filter((t) => norm([t.plate, KIND[t.kind]].filter(Boolean).join(' ')).includes(nq)) : data;
    return [...list].sort((a, b) => cmpText(a.plate, b.plate));
  }, [data, q]);

  return (
    <Screen>
      <SectionTitle>Bateas / lowboys / remolques</SectionTitle>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="🔎 Buscar por placa o tipo…"
        placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: spacing.sm, marginTop: spacing.sm }}
      />
      <TouchableOpacity
        onPress={() => open(null)}
        style={{ backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginBottom: spacing.md }}
      >
        <Text style={{ color: colors.primaryContrast, fontWeight: '700', fontSize: 15 }}>+ Nueva batea / lowboy</Text>
      </TouchableOpacity>

      {loading ? (
        <Loading />
      ) : shown.length === 0 ? (
        <EmptyState title="Sin remolques" subtitle="Agrega la primera batea o lowboy." />
      ) : (
        shown.map((t) => (
          <Card key={t.id} style={t.status === 'inactivo' ? { opacity: 0.6 } : undefined}>
            <TouchableOpacity activeOpacity={0.7} onPress={() => open(t)}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>
                🛻 {t.plate}
                <Text style={{ color: colors.muted, fontWeight: '600', fontSize: 12 }}>{'  · '}{KIND[t.kind] ?? t.kind}{'  · '}{STATUS[t.status] ?? t.status}</Text>
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                {[t.max_load_ton != null ? `Carga ${t.max_load_ton} t` : null, t.axles != null ? `${t.axles} ejes` : null,
                  (t.deck_len_m || t.deck_width_m || t.deck_height_m) ? `${t.deck_len_m ?? '?'}×${t.deck_width_m ?? '?'}×${t.deck_height_m ?? '?'} m` : null,
                ].filter(Boolean).join(' · ') || 'Sin datos'}
              </Text>
            </TouchableOpacity>
          </Card>
        ))
      )}

      <RecordForm
        visible={formOpen}
        title={editing ? 'Editar remolque' : 'Nueva batea / lowboy'}
        table="haul_trailers"
        fields={FIELDS}
        record={editing}
        uniqueField={{ key: 'plate', labelCol: 'plate', labelName: 'placa' }}
        allowDelete
        onClose={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); refetch(); }}
      />
    </Screen>
  );
}
