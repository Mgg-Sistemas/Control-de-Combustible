// ACARREO · Tarifario para servicio a terceros: precio por km, por tonelada,
// por hora o tarifa plana, general o por cliente/ruta.
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../../components/ui';
import { RecordForm, Field } from '../../components/RecordForm';
import { useTable } from '../../hooks/useTable';
import { HaulTariff, HaulClient, HaulLocation } from '../../types/database';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { norm, cmpText } from '../../lib/text';

const MODE_LABEL: Record<string, string> = { km: 'por km', ton: 'por tonelada', hora: 'por hora', plana: 'tarifa plana' };

const FIELDS: Field[] = [
  { key: 'mode', label: 'Modo de cobro', type: 'select', dropdown: true, required: true,
    options: [{ label: 'Por kilómetro', value: 'km' }, { label: 'Por tonelada', value: 'ton' }, { label: 'Por hora', value: 'hora' }, { label: 'Tarifa plana (por ruta)', value: 'plana' }] },
  { key: 'unit_price', label: 'Precio (USD)', type: 'number', required: true },
  { key: 'client_id', label: 'Cliente (opcional — vacío = general)', type: 'lookup', table: 'haul_clients', labelCol: 'name', dropdown: true, filter: { kind: 'externo' } },
  { key: 'route_from_id', label: 'Ruta: origen (opcional)', type: 'lookup', table: 'haul_locations', labelCol: 'name', dropdown: true },
  { key: 'route_to_id', label: 'Ruta: destino (opcional)', type: 'lookup', table: 'haul_locations', labelCol: 'name', dropdown: true },
];

export default function HaulTariffsScreen() {
  const { colors } = useTheme();
  const { data, loading, refetch } = useTable<HaulTariff>('haul_tariffs', { orderBy: 'created_at', ascending: false });
  const { data: clients } = useTable<HaulClient>('haul_clients', { orderBy: 'name' });
  const { data: locations } = useTable<HaulLocation>('haul_locations', { orderBy: 'name' });
  const [editing, setEditing] = useState<HaulTariff | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [q, setQ] = useState('');

  const nameOf = useMemo(() => {
    const c = new Map(clients.map((x) => [x.id, x.name]));
    const l = new Map(locations.map((x) => [x.id, x.name]));
    return { c, l };
  }, [clients, locations]);

  const shown = useMemo(() => {
    const nq = norm(q.trim());
    const list = nq ? data.filter((t) => norm([MODE_LABEL[t.mode], nameOf.c.get(t.client_id ?? '')].filter(Boolean).join(' ')).includes(nq)) : data;
    return list;
  }, [data, q, nameOf]);

  return (
    <Screen>
      <SectionTitle>Tarifario</SectionTitle>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
        Precios para valorizar los acarreos a clientes externos. Una tarifa por cliente/ruta gana sobre la general.
      </Text>
      <TextInput value={q} onChangeText={setQ} placeholder="🔎 Buscar por modo o cliente…" placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: spacing.sm }} />
      <TouchableOpacity onPress={() => { setEditing(null); setFormOpen(true); }}
        style={{ backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginBottom: spacing.md }}>
        <Text style={{ color: colors.primaryContrast, fontWeight: '700', fontSize: 15 }}>+ Nueva tarifa</Text>
      </TouchableOpacity>

      {loading ? (
        <Loading />
      ) : shown.length === 0 ? (
        <EmptyState title="Sin tarifas" subtitle="Agrega la primera tarifa." />
      ) : (
        shown.map((t) => (
          <Card key={t.id}>
            <TouchableOpacity activeOpacity={0.7} onPress={() => { setEditing(t); setFormOpen(true); }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>
                ${Number(t.unit_price).toFixed(2)} <Text style={{ color: colors.muted, fontWeight: '600', fontSize: 12 }}>{MODE_LABEL[t.mode] ?? t.mode}</Text>
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                {[t.client_id ? `Cliente: ${nameOf.c.get(t.client_id) ?? '—'}` : 'General',
                  (t.route_from_id || t.route_to_id) ? `Ruta: ${nameOf.l.get(t.route_from_id ?? '') ?? '?'} → ${nameOf.l.get(t.route_to_id ?? '') ?? '?'}` : null,
                ].filter(Boolean).join(' · ')}
              </Text>
            </TouchableOpacity>
          </Card>
        ))
      )}

      <RecordForm
        visible={formOpen}
        title={editing ? 'Editar tarifa' : 'Nueva tarifa'}
        table="haul_tariffs"
        fields={FIELDS}
        record={editing}
        allowDelete
        onClose={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); refetch(); }}
      />
    </Screen>
  );
}
