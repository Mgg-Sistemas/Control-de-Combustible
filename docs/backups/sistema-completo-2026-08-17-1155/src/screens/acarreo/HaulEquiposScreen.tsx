// ACARREO · Equipos a trasladar: especificaciones de transporte (peso y
// dimensiones) sobre el catálogo de maquinaria existente. No crea máquinas
// (esas viven en el Catálogo); solo edita sus datos para el acarreo.
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../../components/ui';
import { RecordForm, Field } from '../../components/RecordForm';
import { useTable } from '../../hooks/useTable';
import { Machinery, Company } from '../../types/database';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { norm, cmpText } from '../../lib/text';

const TSTATUS: Record<string, string> = {
  operativa: '🟢 Operativa', para_reparacion: '🟠 Para reparación', chatarra: '⚫ Chatarra',
};

const FIELDS: Field[] = [
  { key: 'weight_ton', label: 'Peso (toneladas)', type: 'number' },
  { key: 'length_m', label: 'Largo (m)', type: 'number' },
  { key: 'width_m', label: 'Ancho (m)', type: 'number' },
  { key: 'height_m', label: 'Alto (m)', type: 'number' },
  { key: 'transport_status', label: 'Estado para transporte', type: 'select', dropdown: true,
    options: [
      { label: 'Operativa', value: 'operativa' }, { label: 'Para reparación', value: 'para_reparacion' },
      { label: 'Chatarra', value: 'chatarra' },
    ] },
];

export default function HaulEquiposScreen() {
  const { colors } = useTheme();
  const { data, loading, refetch } = useTable<Machinery>('machinery', { orderBy: 'code', ascending: true });
  const { data: companies } = useTable<Company>('companies', { select: 'id, name', orderBy: 'name' });
  const [editing, setEditing] = useState<Machinery | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [q, setQ] = useState('');

  const companyName = useMemo(() => {
    const map = new Map<string, string>();
    companies.forEach((c) => map.set(c.id, c.name));
    return (id: string | null) => (id ? map.get(id) ?? '' : '');
  }, [companies]);

  const shown = useMemo(() => {
    const nq = norm(q.trim());
    const activas = data.filter((m) => m.active !== false);
    // Busca por cualquier característica: código, empresa, serial, placa, modelo, clasificación.
    const list = nq
      ? activas.filter((m) => norm([m.code, companyName(m.company_id), m.serial, m.plate, m.tipo, m.clasificacion].filter(Boolean).join(' ')).includes(nq))
      : activas;
    return [...list].sort((a, b) => cmpText(a.code, b.code));
  }, [data, q, companyName]);

  return (
    <Screen>
      <SectionTitle>Equipos a trasladar</SectionTitle>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
        Toca una máquina para cargar su peso y dimensiones (se usan para validar la carga del remolque).
      </Text>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="🔎 Buscar por código, empresa, serial, placa, modelo…"
        placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: spacing.md }}
      />

      {loading ? (
        <Loading />
      ) : shown.length === 0 ? (
        <EmptyState title="Sin máquinas" subtitle="No hay equipos que coincidan." />
      ) : (
        shown.map((m) => (
          <Card key={m.id}>
            <TouchableOpacity activeOpacity={0.7} onPress={() => { setEditing(m); setFormOpen(true); }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>
                🚜 {m.code}
                {m.transport_status ? <Text style={{ color: colors.muted, fontWeight: '600', fontSize: 12 }}>{'  · '}{TSTATUS[m.transport_status] ?? m.transport_status}</Text> : null}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                {[companyName(m.company_id) || null, m.plate ? `Placa ${m.plate}` : (m.serial ? `Serial ${m.serial}` : null), m.tipo].filter(Boolean).join(' · ') || 'Sin identificación'}
              </Text>
              <Text style={{ color: m.weight_ton != null ? colors.text : colors.muted, fontSize: 12, marginTop: 2 }}>
                {m.weight_ton != null ? `⚖️ ${m.weight_ton} t` : '⚖️ Peso sin cargar'}
                {(m.length_m || m.width_m || m.height_m) ? `  ·  ${m.length_m ?? '?'}×${m.width_m ?? '?'}×${m.height_m ?? '?'} m` : ''}
              </Text>
            </TouchableOpacity>
          </Card>
        ))
      )}

      <RecordForm
        visible={formOpen}
        title={editing ? `Transporte · ${editing.code}` : 'Transporte'}
        table="machinery"
        fields={FIELDS}
        record={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); refetch(); }}
      />
    </Screen>
  );
}
