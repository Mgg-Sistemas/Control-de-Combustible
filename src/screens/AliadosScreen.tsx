import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Image, Alert } from 'react-native';
import { Screen, SectionTitle, EmptyState, Loading, ExpandableCard } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { RecordForm, Field } from '../components/RecordForm';
import { useTable } from '../hooks/useTable';
import { supabase } from '../lib/supabase';
import { norm } from '../lib/text';
import { captureAndUploadEmployeePhoto, removePhoto } from '../lib/photo';
import { useConfirm } from '../components/ConfirmProvider';
import { Aliado } from '../types/database';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

const BLOOD = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'].map((v) => ({ label: v, value: v }));
const STATUS_OPTS = [{ label: 'Activo', value: 'activo' }, { label: 'Inactivo', value: 'inactivo' }, { label: 'Suspendido', value: 'suspendido' }];
const STATUS_COLOR: Record<string, string> = { activo: '#16A34A', inactivo: '#DC2626', suspendido: '#F59E0B' };

const fullName = (a: Pick<Aliado, 'first_name' | 'last_name'>) => `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim();

// El N° de ficha es AUTOMÁTICO (4 dígitos aleatorio único que asigna la BD al crear).
const FIELDS: Field[] = [
  { key: 'first_name', label: 'Nombre', type: 'text', required: true },
  { key: 'last_name', label: 'Apellido', type: 'text', required: true },
  { key: 'cedula', label: 'Cédula', type: 'text' },
  { key: 'organizacion', label: 'Organización / Empresa', type: 'suggest', table: 'aliados', column: 'organizacion' },
  { key: 'rol', label: 'Rol', type: 'suggest', table: 'aliados', column: 'rol' },
  { key: 'blood_type', label: 'Grupo sanguíneo', type: 'select', options: BLOOD },
  { key: 'phone', label: 'Teléfono', type: 'text' },
  { key: 'email', label: 'Correo', type: 'text' },
  { key: 'address', label: 'Dirección', type: 'text' },
  { key: 'city', label: 'Ciudad', type: 'text' },
  { key: 'state', label: 'Estado', type: 'text' },
  { key: 'status', label: 'Estado', type: 'select', options: STATUS_OPTS },
  { key: 'notes', label: 'Notas', type: 'text' },
];

export default function AliadosScreen({ navigation }: any) {
  const { colors } = useTheme();
  const confirm = useConfirm();
  const { data: aliados, loading, refetch } = useTable<Aliado>('aliados', { orderBy: 'first_name' });
  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Aliado | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const q = norm(query.trim());
  const shown = useMemo(
    () => aliados.filter((a) =>
      !q ||
      norm(fullName(a)).includes(q) ||
      norm(a.cedula).includes(q) ||
      norm(a.ficha_number).includes(q) ||
      norm(a.rol).includes(q) ||
      norm(a.organizacion).includes(q)
    ),
    [aliados, q]
  );

  const openNew = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (a: Aliado) => { setEditing(a); setFormOpen(true); };

  const subirFoto = async (a: Aliado) => {
    setBusy(a.id + '-photo');
    const r = await captureAndUploadEmployeePhoto(a.id, 'aliados');
    if (r.ok && r.url) {
      const { error } = await supabase.from('aliados').update({ photo_url: r.url }).eq('id', a.id);
      if (error) Alert.alert('Aviso', error.message); else refetch();
    } else if (r.error) {
      Alert.alert('Aviso', r.error);
    }
    setBusy(null);
  };

  const borrarFoto = async (a: Aliado) => {
    const ok = await confirm({ title: 'Quitar foto', message: `¿Quitar la foto de ${fullName(a)}?`, confirmText: 'Quitar', cancelText: 'Cancelar', danger: true });
    if (!ok) return;
    setBusy(a.id + '-photo');
    const r = await removePhoto('aliados', a.id);
    if (!r.ok && r.error) Alert.alert('Aviso', r.error); else refetch();
    setBusy(null);
  };

  const Btn = ({ label, onPress, color, disabled }: { label: string; onPress: () => void; color: string; disabled?: boolean }) => (
    <TouchableOpacity onPress={onPress} disabled={disabled} style={{ flexGrow: 1, flexBasis: 90, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: color, opacity: disabled ? 0.6 : 1 }}>
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Screen>
      <ConfigBanner />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>Aliados</SectionTitle>
        <TouchableOpacity onPress={openNew} style={{ backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
          <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>+ Nuevo</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="🔎 Buscar por nombre, cédula, ficha, rol u organización…"
        placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: spacing.sm }}
      />

      {loading && aliados.length === 0 ? (
        <Loading />
      ) : shown.length === 0 ? (
        <EmptyState title={q ? 'Sin resultados' : 'Sin aliados'} subtitle={q ? 'Prueba con otra búsqueda.' : 'Toca "+ Nuevo" para registrar el primero.'} />
      ) : (
        shown.map((a) => (
          <ExpandableCard
            key={a.id}
            summary={
              <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                {a.photo_url ? (
                  <Image source={{ uri: a.photo_url }} style={{ width: 44, height: 52, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt }} resizeMode="cover" />
                ) : (
                  <View style={{ width: 44, height: 52, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 24 }}>🤝</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.xs }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }} numberOfLines={1}>{fullName(a)}</Text>
                    <Text style={{ color: STATUS_COLOR[a.status] ?? colors.muted, fontWeight: '700', fontSize: 11 }}>● {a.status}</Text>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>{[a.rol, a.organizacion, a.ficha_number ? `Ficha ${a.ficha_number}` : ''].filter(Boolean).join(' · ')}</Text>
                </View>
              </View>
            }
            detail={
              <>
                <Text style={{ color: colors.muted, fontSize: 13 }}>
                  {[a.cedula ? `C.I ${a.cedula}` : '', a.blood_type ? `🩸 ${a.blood_type}` : '', a.phone || ''].filter(Boolean).join(' · ') || 'Sin datos adicionales'}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
                  <Btn label="✎ Editar" color="#475569" onPress={() => openEdit(a)} />
                  <Btn label="🪪 Carnet" color="#2563EB" onPress={() => navigation.navigate('AliadoCard', { aliadoId: a.id })} />
                  <Btn label={busy === a.id + '-photo' ? 'Subiendo…' : '📷 Foto'} color="#059669" disabled={busy === a.id + '-photo'} onPress={() => subirFoto(a)} />
                  {a.photo_url ? (
                    <Btn label="🗑️ Quitar foto" color="#B91C1C" disabled={busy === a.id + '-photo'} onPress={() => borrarFoto(a)} />
                  ) : null}
                </View>
              </>
            }
          />
        ))
      )}

      <RecordForm
        visible={formOpen}
        title={editing ? `Editar: ${fullName(editing)}` : 'Nuevo aliado'}
        table="aliados"
        fields={FIELDS}
        record={editing as any}
        autoUserField="created_by"
        uniqueField={{ key: 'cedula', labelCol: 'cedula', labelName: 'cédula' }}
        allowDelete
        onClose={() => setFormOpen(false)}
        onSaved={refetch}
      />
    </Screen>
  );
}
