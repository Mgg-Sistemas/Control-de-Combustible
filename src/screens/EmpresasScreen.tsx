import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { RecordForm, Field } from '../components/RecordForm';
import { useTable } from '../hooks/useTable';
import { supabase } from '../lib/supabase';
import { Company } from '../types/database';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

// Empresas contratistas: editar nombre y RIF (se imprimen en los reportes) y
// ocultar/mostrar la empresa en selectores y reportes.
const FIELDS: Field[] = [
  { key: 'name', label: 'Nombre de la empresa', type: 'text', required: true },
  { key: 'rif', label: 'RIF (ej. J-40503641-9)', type: 'text' },
];

export default function EmpresasScreen() {
  const { colors } = useTheme();
  const { data, loading, refetch } = useTable<Company>('companies', { orderBy: 'name', ascending: true });
  const [editing, setEditing] = useState<Company | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const open = (c: Company | null) => { setEditing(c); setFormOpen(true); };

  const toggleHidden = async (c: Company) => {
    setBusy(c.id);
    const { error } = await supabase.from('companies').update({ hidden: !c.hidden }).eq('id', c.id);
    setBusy(null);
    if (error) Alert.alert('Aviso', error.message);
    else refetch();
  };

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Empresas contratistas</SectionTitle>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
        Toca una empresa para editar su nombre y RIF (se imprimen en los reportes). Las ocultas no aparecen en selectores ni reportes.
      </Text>

      <TouchableOpacity
        onPress={() => open(null)}
        style={{ backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginBottom: spacing.md }}
      >
        <Text style={{ color: colors.primaryContrast, fontWeight: '700', fontSize: 15 }}>+ Nueva empresa</Text>
      </TouchableOpacity>

      {loading ? (
        <Loading />
      ) : data.length === 0 ? (
        <EmptyState title="Sin empresas" subtitle="Agrega la primera empresa contratista." />
      ) : (
        data.map((c) => (
          <Card key={c.id} style={c.hidden ? { opacity: 0.6 } : undefined}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <TouchableOpacity style={{ flex: 1 }} activeOpacity={0.7} onPress={() => open(c)}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>
                  🏢 {c.name}{c.hidden ? '  · (oculta)' : ''}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{c.rif ? `RIF ${c.rif}` : 'Sin RIF'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => toggleHidden(c)}
                disabled={busy === c.id}
                style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 }}
              >
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>{c.hidden ? '👁️ Mostrar' : '🚫 Ocultar'}</Text>
              </TouchableOpacity>
            </View>
          </Card>
        ))
      )}

      <RecordForm
        visible={formOpen}
        title={editing ? 'Editar empresa' : 'Nueva empresa'}
        table="companies"
        fields={FIELDS}
        record={editing}
        allowDelete={false}
        onClose={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); refetch(); }}
      />
    </Screen>
  );
}
