import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading, Badge } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { RecordForm, Field } from '../components/RecordForm';
import { useAuth } from '../context/AuthContext';
import { useTable } from '../hooks/useTable';
import { supabase } from '../lib/supabase';
import { Authorization, Profile, Tank } from '../types/database';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

const ASSET_OPTIONS = [
  { label: 'Vehículo', value: 'vehiculo' },
  { label: 'Maquinaria', value: 'maquinaria' },
];

const FIELDS: Field[] = [
  { key: 'asset_kind', label: 'Tipo de activo', type: 'select', options: ASSET_OPTIONS, required: true },
  { key: 'vehicle_id', label: 'Vehículo (placa)', type: 'lookup', table: 'vehicles', labelCol: 'plate', createColumn: 'plate', required: true, showIf: (v) => v.asset_kind === 'vehiculo' },
  { key: 'machinery_id', label: 'Maquinaria (código)', type: 'lookup', table: 'machinery', labelCol: 'code', createColumn: 'code', required: true, showIf: (v) => v.asset_kind === 'maquinaria' },
  { key: 'tank_id', label: 'Tanque de origen', type: 'lookup', table: 'tanks', labelCol: 'name', required: true },
  { key: 'liters', label: 'Litros solicitados', type: 'number', required: true },
  { key: 'reason', label: 'Motivo', type: 'text' },
];

const tone = (s: Authorization['status']) =>
  s === 'aprobado' ? 'success' : s === 'rechazado' ? 'danger' : 'warning';

export default function AuthorizationsScreen() {
  const { role, session } = useAuth();
  const { colors } = useTheme();
  const { data, loading, refetch } = useTable<Authorization>('authorizations', { orderBy: 'created_at' });
  const { data: profiles } = useTable<Profile>('profiles');
  const { data: tanks } = useTable<Tank>('tanks');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Authorization | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (a: Authorization) => {
    setEditing(a);
    setFormOpen(true);
  };

  const canResolve = role === 'admin' || role === 'supervisor';
  const nameOf = useMemo(() => {
    const m = new Map(profiles.map((p) => [p.id, p.full_name ?? '—']));
    return (id: string | null) => (id ? m.get(id) ?? '—' : '—');
  }, [profiles]);
  const tankOf = useMemo(() => {
    const m = new Map(tanks.map((t) => [t.id, t.name]));
    return (id: string | null) => (id ? m.get(id) ?? '—' : '—');
  }, [tanks]);

  const resolve = async (id: string, approve: boolean) => {
    setBusy(id);
    const fn = approve ? 'approve_authorization' : 'reject_authorization';
    const { error } = await supabase.rpc(fn, { p_auth_id: id });
    setBusy(null);
    if (error) {
      Alert.alert('No se pudo procesar', error.message);
      return;
    }
    refetch();
  };

  return (
    <Screen>
      <ConfigBanner />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>Autorizaciones</SectionTitle>
        <TouchableOpacity
          style={{ backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}
          onPress={openNew}
        >
          <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>+ Solicitar</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <Loading />
      ) : data.length === 0 ? (
        <EmptyState title="Sin solicitudes" subtitle="Crea una solicitud de consumo para que el administrador la autorice." />
      ) : (
        data.map((a) => (
          <Card key={a.id}>
            <TouchableOpacity activeOpacity={0.7} onPress={() => openEdit(a)}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontWeight: '700', color: colors.text, fontSize: 16 }}>
                  {Number(a.liters).toLocaleString()} L
                </Text>
                <Badge label={a.status} tone={tone(a.status)} />
              </View>
              <Text style={{ color: colors.muted, fontSize: 13 }}>
                {a.asset_kind} · Tanque: {tankOf(a.tank_id)}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 13 }}>Solicita: {nameOf(a.requested_by)}</Text>
              {a.reason ? <Text style={{ color: colors.muted, fontSize: 13 }}>Motivo: {a.reason}</Text> : null}
              {a.status !== 'pendiente' ? (
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {a.status === 'aprobado' ? 'Autorizado' : 'Rechazado'} por {nameOf(a.approved_by)}
                </Text>
              ) : null}
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>Toca para editar o borrar</Text>
            </TouchableOpacity>

            {canResolve && a.status === 'pendiente' ? (
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                <TouchableOpacity
                  style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.success }}
                  disabled={busy === a.id}
                  onPress={() => resolve(a.id, true)}
                >
                  <Text style={{ color: '#fff', fontWeight: '700' }}>{busy === a.id ? '…' : 'Aprobar'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.danger }}
                  disabled={busy === a.id}
                  onPress={() => resolve(a.id, false)}
                >
                  <Text style={{ color: colors.danger, fontWeight: '700' }}>Rechazar</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </Card>
        ))
      )}

      <RecordForm
        visible={formOpen}
        title={editing ? 'Editar solicitud' : 'Nueva solicitud'}
        table="authorizations"
        fields={FIELDS}
        autoUserField="requested_by"
        record={editing}
        allowDelete
        onClose={() => setFormOpen(false)}
        onSaved={refetch}
      />
    </Screen>
  );
}
