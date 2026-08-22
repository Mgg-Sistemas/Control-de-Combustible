// ACARREO · Choferes / operadores de transporte pesado.
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../../components/ui';
import { RecordForm, Field } from '../../components/RecordForm';
import { useTable } from '../../hooks/useTable';
import { HaulDriver } from '../../types/database';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { norm, cmpText } from '../../lib/text';
import { caracasParts } from '../../lib/jornada';

const AVAIL: Record<string, string> = {
  disponible: '🟢 Disponible', en_ruta: '🔵 En ruta', reposo: '🟠 De reposo', suspendido: '🔴 Suspendido',
};

const FIELDS: Field[] = [
  { key: 'full_name', label: 'Nombre del chofer', type: 'text', required: true },
  { key: 'phone', label: 'Teléfono', type: 'text' },
  { key: 'license_number', label: 'N° de licencia', type: 'text' },
  { key: 'license_class', label: 'Grado / clase de licencia', type: 'text' },
  { key: 'license_expires_at', label: 'Vence la licencia', type: 'date' },
  { key: 'hazmat_expires_at', label: 'Vence certificado carga peligrosa', type: 'date' },
  { key: 'availability', label: 'Disponibilidad', type: 'select', dropdown: true,
    options: [
      { label: 'Disponible', value: 'disponible' }, { label: 'En ruta', value: 'en_ruta' },
      { label: 'De reposo', value: 'reposo' }, { label: 'Suspendido', value: 'suspendido' },
    ] },
  { key: 'user_id', label: 'Usuario del sistema (opcional)', type: 'lookup', table: 'profiles', labelCol: 'full_name', dropdown: true },
];

export default function HaulDriversScreen() {
  const { colors } = useTheme();
  const { data, loading, refetch } = useTable<HaulDriver>('haul_drivers', { orderBy: 'full_name', ascending: true });
  const [editing, setEditing] = useState<HaulDriver | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [q, setQ] = useState('');
  const hoy = caracasParts(new Date()).iso;

  const open = (d: HaulDriver | null) => { setEditing(d); setFormOpen(true); };

  const shown = useMemo(() => {
    const nq = norm(q.trim());
    const list = nq ? data.filter((d) => norm([d.full_name, d.phone, d.license_number].filter(Boolean).join(' ')).includes(nq)) : data;
    return [...list].sort((a, b) => cmpText(a.full_name, b.full_name));
  }, [data, q]);

  return (
    <Screen>
      <SectionTitle>Choferes</SectionTitle>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="🔎 Buscar por nombre, teléfono, licencia…"
        placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: spacing.sm, marginTop: spacing.sm }}
      />
      <TouchableOpacity
        onPress={() => open(null)}
        style={{ backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginBottom: spacing.md }}
      >
        <Text style={{ color: colors.primaryContrast, fontWeight: '700', fontSize: 15 }}>+ Nuevo chofer</Text>
      </TouchableOpacity>

      {loading ? (
        <Loading />
      ) : shown.length === 0 ? (
        <EmptyState title="Sin choferes" subtitle="Agrega el primer chofer." />
      ) : (
        shown.map((d) => {
          const licVencida = d.license_expires_at && d.license_expires_at < hoy;
          return (
            <Card key={d.id} style={d.active === false ? { opacity: 0.6 } : undefined}>
              <TouchableOpacity activeOpacity={0.7} onPress={() => open(d)}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>
                  👷 {d.full_name}
                  <Text style={{ color: colors.muted, fontWeight: '600', fontSize: 12 }}>{'  · '}{AVAIL[d.availability] ?? d.availability}</Text>
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                  {[d.phone, d.license_number ? `Lic. ${d.license_number}` : null, d.license_class].filter(Boolean).join(' · ') || 'Sin datos'}
                </Text>
                {licVencida ? (
                  <Text style={{ color: colors.danger, fontSize: 12, marginTop: 2, fontWeight: '700' }}>⚠️ Licencia vencida ({d.license_expires_at})</Text>
                ) : d.license_expires_at ? (
                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>Licencia vence: {d.license_expires_at}</Text>
                ) : null}
              </TouchableOpacity>
            </Card>
          );
        })
      )}

      <RecordForm
        visible={formOpen}
        title={editing ? 'Editar chofer' : 'Nuevo chofer'}
        table="haul_drivers"
        fields={FIELDS}
        record={editing}
        allowDelete
        onClose={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); refetch(); }}
      />
    </Screen>
  );
}
