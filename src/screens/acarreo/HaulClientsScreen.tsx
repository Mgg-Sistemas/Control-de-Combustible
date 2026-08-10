// ACARREO · Clientes / proyectos (emisor y receptor, internos o externos).
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../../components/ui';
import { RecordForm, Field } from '../../components/RecordForm';
import { useTable } from '../../hooks/useTable';
import { HaulClient } from '../../types/database';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { norm, cmpText } from '../../lib/text';

const FIELDS: Field[] = [
  { key: 'name', label: 'Nombre del cliente / proyecto', type: 'text', required: true },
  { key: 'kind', label: 'Tipo', type: 'select', dropdown: true, required: true,
    options: [{ label: 'Interno', value: 'interno' }, { label: 'Externo (se factura)', value: 'externo' }] },
  { key: 'tax_id', label: 'RIF / ID fiscal', type: 'text' },
  { key: 'contact', label: 'Persona de contacto', type: 'text' },
  { key: 'phone', label: 'Teléfono', type: 'text' },
];

export default function HaulClientsScreen() {
  const { colors } = useTheme();
  const { data, loading, refetch } = useTable<HaulClient>('haul_clients', { orderBy: 'name', ascending: true });
  const [editing, setEditing] = useState<HaulClient | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [q, setQ] = useState('');

  const open = (c: HaulClient | null) => { setEditing(c); setFormOpen(true); };

  const shown = useMemo(() => {
    const nq = norm(q.trim());
    const list = nq
      ? data.filter((c) => norm([c.name, c.tax_id, c.contact, c.phone].filter(Boolean).join(' ')).includes(nq))
      : data;
    return [...list].sort((a, b) => cmpText(a.name, b.name));
  }, [data, q]);

  return (
    <Screen>
      <SectionTitle>Clientes y proyectos</SectionTitle>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
        Emisor y receptor de los acarreos. Los externos (a los que se factura) usan tarifario.
      </Text>

      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="🔎 Buscar por nombre, RIF, contacto…"
        placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: spacing.sm }}
      />

      <TouchableOpacity
        onPress={() => open(null)}
        style={{ backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginBottom: spacing.md }}
      >
        <Text style={{ color: colors.primaryContrast, fontWeight: '700', fontSize: 15 }}>+ Nuevo cliente</Text>
      </TouchableOpacity>

      {loading ? (
        <Loading />
      ) : shown.length === 0 ? (
        <EmptyState title="Sin clientes" subtitle="Agrega el primer cliente o proyecto." />
      ) : (
        shown.map((c) => (
          <Card key={c.id}>
            <TouchableOpacity activeOpacity={0.7} onPress={() => open(c)}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>
                {c.kind === 'externo' ? '🏢' : '🏠'} {c.name}
                <Text style={{ color: colors.muted, fontWeight: '600', fontSize: 12 }}>{'  · '}{c.kind === 'externo' ? 'Externo' : 'Interno'}</Text>
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                {[c.tax_id ? `RIF ${c.tax_id}` : null, c.contact, c.phone].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
              </Text>
            </TouchableOpacity>
          </Card>
        ))
      )}

      <RecordForm
        visible={formOpen}
        title={editing ? 'Editar cliente' : 'Nuevo cliente'}
        table="haul_clients"
        fields={FIELDS}
        record={editing}
        allowDelete
        onClose={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); refetch(); }}
      />
    </Screen>
  );
}
