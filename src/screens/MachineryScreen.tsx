import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Alert, Image } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { RecordForm, Field } from '../components/RecordForm';
import { useTable } from '../hooks/useTable';
import { supabase } from '../lib/supabase';
import { captureLocation } from '../lib/location';
import { pickAndUploadPhoto, removePhoto } from '../lib/photo';
import { useConfirm } from '../components/ConfirmProvider';
import { elapsedSince } from '../lib/time';
import { formatUTM } from '../lib/utm';
import { Machinery } from '../types/database';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

const FIELDS: Field[] = [
  { key: 'code', label: 'Código / Nombre', type: 'text', required: true },
  { key: 'plate', label: 'Placa', type: 'text' },
  { key: 'serial', label: 'Serial', type: 'text' },
  { key: 'company_id', label: 'Empresa supervisora', type: 'lookup', table: 'companies', labelCol: 'name', createColumn: 'name', filter: { hidden: false, food_only: false } },
  { key: 'machinery_type', label: 'Tipo', type: 'text' },
  { key: 'expected_lph', label: 'Rendimiento (L/h)', type: 'number' },
];

export default function MachineryScreen({ navigation }: any) {
  const { colors } = useTheme();
  const confirm = useConfirm();
  const { data, loading, refetch } = useTable<Machinery>('machinery', { orderBy: 'code', ascending: true });
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(key);
    const res = await fn();
    setBusy(null);
    if (!res.ok && res.error) Alert.alert('Aviso', res.error);
    if (res.ok) refetch();
  };

  const locate = (m: Machinery) => run(m.id + '-loc', () => captureLocation(m.id));
  const photo = (m: Machinery) => run(m.id + '-photo', () => pickAndUploadPhoto(m.id));
  const delPhoto = async (m: Machinery) => {
    const ok = await confirm({ title: 'Quitar foto', message: `¿Quitar la foto de ${m.code}?`, confirmText: 'Quitar', cancelText: 'Cancelar', danger: true });
    if (ok) run(m.id + '-photo', () => removePhoto('machinery', m.id));
  };
  const toggleOp = (m: Machinery) =>
    run(m.id + '-op', async () => {
      const { error } = await supabase.from('machinery').update({ operational: !m.operational }).eq('id', m.id);
      return { ok: !error, error: error?.message };
    });

  const BigBtn = ({ label, onPress, color, disabled }: any) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={{
        flexGrow: 1,
        flexBasis: 100,
        minHeight: 44,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: color,
        opacity: disabled ? 0.6 : 1,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
      }}
    >
      <Text style={{ color: '#fff', fontWeight: '700', textAlign: 'center', fontSize: 13 }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Screen>
      <ConfigBanner />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>Maquinaria</SectionTitle>
        <TouchableOpacity
          style={{ backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill }}
          onPress={() => setFormOpen(true)}
        >
          <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>+ Nueva</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        onPress={() => navigation.navigate('Map')}
        style={{ backgroundColor: '#2563EB', borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}
      >
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>🗺️  Ver mapa de máquinas</Text>
      </TouchableOpacity>

      {loading ? (
        <Loading />
      ) : data.length === 0 ? (
        <EmptyState title="Sin maquinaria" subtitle="Agrega tus equipos con el botón + Nueva." />
      ) : (
        data.map((m) => (
          <Card key={m.id}>
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              {m.photo_url ? (
                <Image source={{ uri: m.photo_url }} style={{ width: 64, height: 64, borderRadius: radius.md }} />
              ) : (
                <View style={{ width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 28 }}>🚜</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontWeight: '700', color: colors.text, fontSize: 17 }}>{m.code}</Text>
                  <Text style={{ color: m.operational ? colors.success : colors.danger, fontWeight: '700', fontSize: 13 }}>
                    {m.operational ? '● Operativa' : '● No operativa'}
                  </Text>
                </View>
                {m.plate ? <Text style={{ color: colors.muted, fontSize: 12 }}>Placa: {m.plate}</Text> : null}
                {m.serial ? <Text style={{ color: colors.muted, fontSize: 12 }}>Serial: {m.serial}</Text> : null}
                {m.latitude != null ? (
                  <Text style={{ color: colors.muted, fontSize: 12 }}>📍 UTM {formatUTM(m.latitude, m.longitude)} · {elapsedSince(m.location_at)}</Text>
                ) : (
                  <Text style={{ color: colors.muted, fontSize: 12 }}>Sin ubicación</Text>
                )}
              </View>
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
              <BigBtn label={busy === m.id + '-loc' ? 'Ubicando…' : '📍 ACTUALIZAR UBICACIÓN'} onPress={() => locate(m)} color="#2563EB" disabled={busy === m.id + '-loc'} />
              <BigBtn label={busy === m.id + '-photo' ? 'Subiendo…' : '📷 Foto'} onPress={() => photo(m)} color={colors.primary} disabled={busy === m.id + '-photo'} />
              {m.photo_url ? (
                <BigBtn label="🗑️ Quitar foto" onPress={() => delPhoto(m)} color={colors.danger} disabled={busy === m.id + '-photo'} />
              ) : null}
              <BigBtn label={m.operational ? '⛔ Inactiva' : '✅ Operativa'} onPress={() => toggleOp(m)} color={m.operational ? colors.danger : colors.success} disabled={busy === m.id + '-op'} />
            </View>
          </Card>
        ))
      )}

      <RecordForm
        visible={formOpen}
        title="Nueva máquina"
        table="machinery"
        fields={FIELDS}
        onClose={() => setFormOpen(false)}
        onSaved={refetch}
      />
    </Screen>
  );
}
