// ACARREO · Documentos con vencimiento (camión / remolque / chofer):
// permisos de carga pesada, pólizas, revisión técnica, licencias.
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ScrollView, Platform } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../../components/ui';
import { DateField } from '../../components/DateField';
import { useToast } from '../../components/ToastProvider';
import { useTable } from '../../hooks/useTable';
import { supabase } from '../../lib/supabase';
import { HaulDocument, HaulTruck, HaulTrailer, HaulDriver } from '../../types/database';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { norm, cmpText } from '../../lib/text';
import { caracasParts } from '../../lib/jornada';

type OwnerType = 'truck' | 'trailer' | 'driver';
const OWNER_LABEL: Record<OwnerType, string> = { truck: 'Camión', trailer: 'Remolque', driver: 'Chofer' };
const DOC_TYPES: { label: string; value: string }[] = [
  { label: 'Permiso carga pesada', value: 'permiso_carga_pesada' },
  { label: 'Póliza de seguro', value: 'poliza' },
  { label: 'Revisión técnica', value: 'revision_tecnica' },
  { label: 'Licencia', value: 'licencia' },
  { label: 'Otro', value: 'otro' },
];
const DOC_LABEL = (v: string) => DOC_TYPES.find((d) => d.value === v)?.label ?? v;

export default function HaulDocumentsScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const { data: docs, loading, refetch } = useTable<HaulDocument>('haul_documents', { orderBy: 'expires_at', ascending: true });
  const { data: trucks } = useTable<HaulTruck>('haul_trucks', { orderBy: 'plate', ascending: true });
  const { data: trailers } = useTable<HaulTrailer>('haul_trailers', { orderBy: 'plate', ascending: true });
  const { data: drivers } = useTable<HaulDriver>('haul_drivers', { orderBy: 'full_name', ascending: true });
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<HaulDocument | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const hoy = caracasParts(new Date()).iso;

  const ownerName = useMemo(() => {
    const m = new Map<string, string>();
    trucks.forEach((t) => m.set(t.id, `🚛 ${t.plate}`));
    trailers.forEach((t) => m.set(t.id, `🛻 ${t.plate}`));
    drivers.forEach((d) => m.set(d.id, `👷 ${d.full_name}`));
    return m;
  }, [trucks, trailers, drivers]);

  const shown = useMemo(() => {
    const nq = norm(q.trim());
    const list = docs.map((d) => ({ ...d, _owner: ownerName.get(d.owner_id) ?? OWNER_LABEL[d.owner_type as OwnerType] }));
    const filtered = nq ? list.filter((d) => norm([d._owner, DOC_LABEL(d.doc_type), d.number].filter(Boolean).join(' ')).includes(nq)) : list;
    return filtered.sort((a, b) => cmpText(a.expires_at ?? '9999', b.expires_at ?? '9999') || cmpText(a._owner, b._owner));
  }, [docs, ownerName, q]);

  return (
    <Screen>
      <SectionTitle>Documentos y vencimientos</SectionTitle>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
        Permisos, pólizas, revisiones y licencias. Los vencidos o por vencer disparan alertas.
      </Text>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="🔎 Buscar por unidad, chofer, tipo…"
        placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: spacing.sm }}
      />
      <TouchableOpacity
        onPress={() => { setEditing(null); setFormOpen(true); }}
        style={{ backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginBottom: spacing.md }}
      >
        <Text style={{ color: colors.primaryContrast, fontWeight: '700', fontSize: 15 }}>+ Nuevo documento</Text>
      </TouchableOpacity>

      {loading ? (
        <Loading />
      ) : shown.length === 0 ? (
        <EmptyState title="Sin documentos" subtitle="Agrega el primer permiso, póliza o licencia." />
      ) : (
        shown.map((d) => {
          const vencido = d.expires_at && d.expires_at < hoy;
          return (
            <Card key={d.id}>
              <TouchableOpacity activeOpacity={0.7} onPress={() => { setEditing(d); setFormOpen(true); }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14.5 }}>
                  {DOC_LABEL(d.doc_type)} <Text style={{ color: colors.muted, fontWeight: '600', fontSize: 12 }}>· {d._owner}</Text>
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{d.number ? `N° ${d.number}` : 'Sin número'}</Text>
                {d.expires_at ? (
                  <Text style={{ color: vencido ? colors.danger : colors.muted, fontSize: 12, marginTop: 2, fontWeight: vencido ? '700' : '400' }}>
                    {vencido ? '⚠️ Vencido' : 'Vence'}: {d.expires_at}
                  </Text>
                ) : null}
              </TouchableOpacity>
            </Card>
          );
        })
      )}

      {formOpen ? (
        <DocumentForm
          doc={editing}
          trucks={trucks}
          trailers={trailers}
          drivers={drivers}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); refetch(); }}
          onError={(m) => toast.error(m)}
        />
      ) : null}
    </Screen>
  );
}

function DocumentForm({
  doc, trucks, trailers, drivers, onClose, onSaved, onError,
}: {
  doc: HaulDocument | null;
  trucks: HaulTruck[]; trailers: HaulTrailer[]; drivers: HaulDriver[];
  onClose: () => void; onSaved: () => void; onError: (m: string) => void;
}) {
  const { colors, typography } = useTheme();
  const [ownerType, setOwnerType] = useState<OwnerType>((doc?.owner_type as OwnerType) ?? 'truck');
  const [ownerId, setOwnerId] = useState<string>(doc?.owner_id ?? '');
  const [docType, setDocType] = useState<string>(doc?.doc_type ?? 'permiso_carga_pesada');
  const [number, setNumber] = useState<string>(doc?.number ?? '');
  const [issued, setIssued] = useState<string>(doc?.issued_at ?? '');
  const [expires, setExpires] = useState<string>(doc?.expires_at ?? '');
  const [ownerSearch, setOwnerSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [askDelete, setAskDelete] = useState(false);

  const owners = useMemo(() => {
    const src = ownerType === 'truck' ? trucks.map((t) => ({ id: t.id, label: `🚛 ${t.plate}` }))
      : ownerType === 'trailer' ? trailers.map((t) => ({ id: t.id, label: `🛻 ${t.plate}` }))
      : drivers.map((d) => ({ id: d.id, label: `👷 ${d.full_name}` }));
    const nq = norm(ownerSearch.trim());
    return (nq ? src.filter((o) => norm(o.label).includes(nq)) : src).sort((a, b) => cmpText(a.label, b.label));
  }, [ownerType, trucks, trailers, drivers, ownerSearch]);

  const save = async () => {
    if (!ownerId) { onError('Elige a quién pertenece el documento.'); return; }
    setSaving(true);
    const payload = {
      owner_type: ownerType, owner_id: ownerId, doc_type: docType,
      number: number.trim() || null, issued_at: issued || null, expires_at: expires || null,
    };
    const { error } = doc
      ? await supabase.from('haul_documents').update(payload).eq('id', doc.id)
      : await supabase.from('haul_documents').insert(payload);
    setSaving(false);
    if (error) { onError(error.message); return; }
    onSaved();
  };

  const remove = async () => {
    if (!doc) return;
    setSaving(true);
    const { error } = await supabase.from('haul_documents').delete().eq('id', doc.id);
    setSaving(false);
    if (error) { onError(error.message); return; }
    onSaved();
  };

  const seg = (t: OwnerType) => (
    <TouchableOpacity
      key={t}
      onPress={() => { setOwnerType(t); setOwnerId(''); }}
      style={{ flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radius.md, backgroundColor: ownerType === t ? colors.primary : colors.surfaceAlt, borderWidth: 1, borderColor: ownerType === t ? colors.primary : colors.border }}
    >
      <Text style={{ color: ownerType === t ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{OWNER_LABEL[t]}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, paddingBottom: Platform.OS === 'ios' ? spacing.xl : spacing.lg }}>
          <Text style={[typography.title, { marginBottom: spacing.md }]}>{doc ? 'Editar documento' : 'Nuevo documento'}</Text>
          <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: spacing.sm }}>
            <Text style={typography.muted}>Pertenece a</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>{(['truck', 'trailer', 'driver'] as OwnerType[]).map(seg)}</View>

            <Text style={typography.muted}>{OWNER_LABEL[ownerType]}  *</Text>
            {owners.length > 6 ? (
              <TextInput value={ownerSearch} onChangeText={setOwnerSearch} placeholder="🔎 Buscar…" placeholderTextColor={colors.muted}
                style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {owners.map((o) => (
                <TouchableOpacity key={o.id} onPress={() => setOwnerId(o.id)}
                  style={{ paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: ownerId === o.id ? colors.primary : colors.border, backgroundColor: ownerId === o.id ? colors.primary : colors.surface }}>
                  <Text style={{ color: ownerId === o.id ? colors.primaryContrast : colors.text, fontWeight: '600', fontSize: 13 }}>{o.label}</Text>
                </TouchableOpacity>
              ))}
              {owners.length === 0 ? <Text style={typography.muted}>Sin {OWNER_LABEL[ownerType].toLowerCase()}s registrados.</Text> : null}
            </View>

            <Text style={typography.muted}>Tipo de documento</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {DOC_TYPES.map((d) => (
                <TouchableOpacity key={d.value} onPress={() => setDocType(d.value)}
                  style={{ paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: docType === d.value ? colors.primary : colors.border, backgroundColor: docType === d.value ? colors.primary : colors.surface }}>
                  <Text style={{ color: docType === d.value ? colors.primaryContrast : colors.text, fontWeight: '600', fontSize: 13 }}>{d.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={typography.muted}>N° / referencia</Text>
            <TextInput value={number} onChangeText={setNumber} placeholder="N° de póliza / permiso…" placeholderTextColor={colors.muted}
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />

            <Text style={typography.muted}>Emitido</Text>
            <DateField value={issued} onChange={setIssued} />
            <Text style={typography.muted}>Vence</Text>
            <DateField value={expires} onChange={setExpires} />
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={onClose}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary }} onPress={save} disabled={saving}>
              <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>{saving ? 'Guardando…' : 'Guardar'}</Text>
            </TouchableOpacity>
          </View>

          {doc && !askDelete ? (
            <TouchableOpacity style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.danger }} onPress={() => setAskDelete(true)} disabled={saving}>
              <Text style={{ color: colors.danger, fontWeight: '700' }}>🗑️ Eliminar</Text>
            </TouchableOpacity>
          ) : null}
          {askDelete ? (
            <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
              <Text style={{ color: colors.text, textAlign: 'center' }}>¿Eliminar este documento?</Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setAskDelete(false)}>
                  <Text style={{ color: colors.text, fontWeight: '600' }}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.danger }} onPress={remove} disabled={saving}>
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Eliminar</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
