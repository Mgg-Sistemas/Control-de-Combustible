// ACARREO · Flota: chutos / camiones de arrastre.
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../../components/ui';
import { RecordForm, Field } from '../../components/RecordForm';
import { useTable } from '../../hooks/useTable';
import { HaulTruck } from '../../types/database';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { norm, cmpText } from '../../lib/text';

const STATUS: Record<string, string> = { operativo: '🟢 Operativo', taller: '🟠 En taller', inactivo: '⚫ Inactivo' };

const FIELDS: Field[] = [
  { key: 'plate', label: 'Placa', type: 'text', required: true },
  { key: 'brand', label: 'Marca', type: 'text' },
  { key: 'model', label: 'Modelo', type: 'text' },
  { key: 'max_tow_ton', label: 'Capacidad de arrastre (toneladas)', type: 'number' },
  { key: 'odometer_km', label: 'Kilometraje actual (km)', type: 'number' },
  { key: 'maint_interval_km', label: 'Intervalo de mantenimiento (km)', type: 'number' },
  { key: 'status', label: 'Estado', type: 'select', dropdown: true,
    options: [{ label: 'Operativo', value: 'operativo' }, { label: 'En taller', value: 'taller' }, { label: 'Inactivo', value: 'inactivo' }] },
];

export default function HaulTrucksScreen() {
  const { colors } = useTheme();
  const { data, loading, refetch } = useTable<HaulTruck>('haul_trucks', { orderBy: 'plate', ascending: true });
  const [editing, setEditing] = useState<HaulTruck | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [q, setQ] = useState('');

  const open = (t: HaulTruck | null) => { setEditing(t); setFormOpen(true); };

  const shown = useMemo(() => {
    const nq = norm(q.trim());
    const list = nq ? data.filter((t) => norm([t.plate, t.brand, t.model].filter(Boolean).join(' ')).includes(nq)) : data;
    return [...list].sort((a, b) => cmpText(a.plate, b.plate));
  }, [data, q]);

  return (
    <Screen>
      <SectionTitle>Chutos / camiones de arrastre</SectionTitle>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="🔎 Buscar por placa, marca, modelo…"
        placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: spacing.sm, marginTop: spacing.sm }}
      />
      <TouchableOpacity
        onPress={() => open(null)}
        style={{ backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginBottom: spacing.md }}
      >
        <Text style={{ color: colors.primaryContrast, fontWeight: '700', fontSize: 15 }}>+ Nuevo chuto</Text>
      </TouchableOpacity>

      {loading ? (
        <Loading />
      ) : shown.length === 0 ? (
        <EmptyState title="Sin chutos" subtitle="Agrega el primer camión de arrastre." />
      ) : (
        shown.map((t) => {
          const faltaMant = t.maint_interval_km != null && t.maint_interval_km > 0
            ? Math.max(0, Number(t.maint_interval_km) - (Number(t.odometer_km) % Number(t.maint_interval_km)))
            : null;
          return (
            <Card key={t.id} style={t.status === 'inactivo' ? { opacity: 0.6 } : undefined}>
              <TouchableOpacity activeOpacity={0.7} onPress={() => open(t)}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>
                  🚛 {t.plate}
                  <Text style={{ color: colors.muted, fontWeight: '600', fontSize: 12 }}>{'  · '}{STATUS[t.status] ?? t.status}</Text>
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                  {[[t.brand, t.model].filter(Boolean).join(' '), t.max_tow_ton != null ? `Arrastre ${t.max_tow_ton} t` : null, t.odometer_km != null ? `${t.odometer_km} km` : null].filter(Boolean).join(' · ') || 'Sin datos'}
                </Text>
                {faltaMant != null ? (
                  <Text style={{ color: faltaMant < 1000 ? colors.danger : colors.muted, fontSize: 12, marginTop: 2, fontWeight: faltaMant < 1000 ? '700' : '400' }}>
                    🛠️ Faltan {Math.round(faltaMant).toLocaleString('es-VE')} km para mantenimiento
                  </Text>
                ) : null}
              </TouchableOpacity>
            </Card>
          );
        })
      )}

      <RecordForm
        visible={formOpen}
        title={editing ? 'Editar chuto' : 'Nuevo chuto'}
        table="haul_trucks"
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
