// ACARREO · Ejecución del viaje: check-in de salida, incidencias en ruta y
// check-out de recepción (con checklist, fotos de evidencia y firma). Cada acción
// avanza la máquina de estados. Las fotos se suben al bucket con captureAndUploadPhoto.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Image, ScrollView, Platform } from 'react-native';
import { Card } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import { captureAndUploadPhoto } from '../../lib/photo';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { HaulOrder, HaulCheck, HaulPhoto, HaulIncident } from '../../types/database';

const INCIDENT_TYPES = [
  { label: 'Mecánica', value: 'mecanica' }, { label: 'Clima', value: 'clima' },
  { label: 'Permiso', value: 'permiso' }, { label: 'Alcabala', value: 'alcabala' }, { label: 'Otro', value: 'otro' },
];

export default function HaulExecutionPanel({
  order, onChanged, onError,
}: {
  order: HaulOrder;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const { colors } = useTheme();
  const [checks, setChecks] = useState<HaulCheck[]>([]);
  const [photos, setPhotos] = useState<HaulPhoto[]>([]);
  const [incidents, setIncidents] = useState<HaulIncident[]>([]);
  const [busy, setBusy] = useState(false);

  // Check-in / check-out (formulario)
  const [fuel, setFuel] = useState('');
  const [tiresOk, setTiresOk] = useState(true);
  const [strapsOk, setStrapsOk] = useState(true);
  const [checkNote, setCheckNote] = useState('');
  const [signedBy, setSignedBy] = useState('');
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  // Incidencia
  const [incType, setIncType] = useState('mecanica');
  const [incDesc, setIncDesc] = useState('');

  const load = async () => {
    const [c, p, i] = await Promise.all([
      supabase.from('haul_checks').select('*').eq('order_id', order.id).order('at', { ascending: true }),
      supabase.from('haul_photos').select('*').eq('order_id', order.id).order('at', { ascending: true }),
      supabase.from('haul_incidents').select('*').eq('order_id', order.id).order('at', { ascending: true }),
    ]);
    setChecks((c.data ?? []) as HaulCheck[]);
    setPhotos((p.data ?? []) as HaulPhoto[]);
    setIncidents((i.data ?? []) as HaulIncident[]);
  };
  useEffect(() => { load(); }, [order.id, order.status]);

  const uid = async () => (await supabase.auth.getUser()).data.user?.id ?? null;

  const addPhoto = async (tag: string) => {
    setBusy(true);
    const r = await captureAndUploadPhoto(order.id, `acarreo-${tag}`);
    if (!r.ok) { setBusy(false); if (r.error) onError(r.error); return; }
    const { error } = await supabase.from('haul_photos').insert({ order_id: order.id, tag, url: r.url, by: await uid() });
    setBusy(false);
    if (error) { onError(error.message); return; }
    load();
  };

  const addSignature = async () => {
    setBusy(true);
    const r = await captureAndUploadPhoto(order.id, 'acarreo-firma');
    setBusy(false);
    if (!r.ok) { if (r.error) onError(r.error); return; }
    setSignatureUrl(r.url ?? null);
  };

  const saveCheck = async (kind: 'salida' | 'recepcion', nextStatus: string) => {
    if (kind === 'recepcion' && !signedBy.trim()) { onError('Indica quién recibe (firma).'); return; }
    setBusy(true);
    const by = await uid();
    const payload: any = {
      order_id: order.id, kind, fuel_level: fuel.trim() || null,
      tires_ok: tiresOk, straps_ok: strapsOk,
      checklist: checkNote.trim() ? { nota: checkNote.trim() } : null, by,
    };
    if (kind === 'recepcion') { payload.signed_by_name = signedBy.trim(); payload.signature_url = signatureUrl; }
    const { error: ce } = await supabase.from('haul_checks').insert(payload);
    if (ce) { setBusy(false); onError(ce.message); return; }
    const patch: any = { status: nextStatus };
    if (nextStatus === 'en_transito') patch.departed_at = new Date().toISOString();
    if (nextStatus === 'completado') patch.arrived_at = new Date().toISOString();
    const { error: oe } = await supabase.from('haul_orders').update(patch).eq('id', order.id);
    setBusy(false);
    if (oe) { onError(oe.message); return; }
    setFuel(''); setCheckNote(''); setSignedBy(''); setSignatureUrl(null);
    onChanged();
  };

  const addIncident = async () => {
    if (!incDesc.trim()) { onError('Describe la incidencia.'); return; }
    setBusy(true);
    const { error } = await supabase.from('haul_incidents').insert({ order_id: order.id, type: incType, description: incDesc.trim(), by: await uid() });
    setBusy(false);
    if (error) { onError(error.message); return; }
    setIncDesc('');
    load();
  };

  const advance = async (to: string, extra?: any) => {
    setBusy(true);
    const { error } = await supabase.from('haul_orders').update({ status: to, ...extra }).eq('id', order.id);
    setBusy(false);
    if (error) { onError(error.message); return; }
    onChanged();
  };

  const photoRow = (tags: string[], label: string) => {
    const ps = photos.filter((p) => tags.includes(p.tag ?? ''));
    return (
      <View style={{ marginTop: spacing.xs }}>
        {ps.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
            {ps.map((p) => <Image key={p.id} source={{ uri: p.url }} style={{ width: 72, height: 72, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt }} />)}
          </ScrollView>
        ) : <Text style={{ color: colors.muted, fontSize: 11 }}>Sin fotos.</Text>}
      </View>
    );
  };

  const chk = (label: string, on: boolean, set: (v: boolean) => void) => (
    <TouchableOpacity onPress={() => set(!on)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 4 }}>
      <Text style={{ fontSize: 18 }}>{on ? '☑️' : '⬜'}</Text>
      <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13 }}>{label}</Text>
    </TouchableOpacity>
  );

  const btn = (label: string, onPress: () => void, bg = colors.primary) => (
    <TouchableOpacity onPress={onPress} disabled={busy} style={{ backgroundColor: bg, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
      <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 14 }}>{busy ? '…' : label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={{ gap: spacing.sm }}>
      {/* CHECK-IN DE SALIDA (en_carga) */}
      {order.status === 'en_carga' ? (
        <Card style={{ borderColor: '#D97706', borderWidth: 1 }}>
          <Text style={{ color: colors.text, fontWeight: '800', marginBottom: 4 }}>📦 Check-in de salida</Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>Nivel de combustible</Text>
          <TextInput value={fuel} onChangeText={setFuel} placeholder="Ej. 3/4, lleno…" placeholderTextColor={colors.muted}
            style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: 4 }} />
          {chk('Cauchos en buen estado', tiresOk, setTiresOk)}
          {chk('Cadenas / fajas de amarre OK', strapsOk, setStrapsOk)}
          <TextInput value={checkNote} onChangeText={setCheckNote} placeholder="Observaciones del checklist…" placeholderTextColor={colors.muted} multiline
            style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginTop: 4, minHeight: 46 }} />
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
            {btn('📷 Foto "antes"', () => addPhoto('antes'), colors.surfaceAlt)}
            {btn('📷 Foto amarre', () => addPhoto('amarre'), colors.surfaceAlt)}
          </View>
          {photoRow(['antes', 'amarre'], 'evidencia')}
          <View style={{ marginTop: spacing.sm }}>{btn('✅ Guardar check-in · marcar EN TRÁNSITO', () => saveCheck('salida', 'en_transito'))}</View>
        </Card>
      ) : null}

      {/* EN TRÁNSITO: incidencias + avance */}
      {order.status === 'en_transito' ? (
        <Card style={{ borderColor: '#2563EB', borderWidth: 1 }}>
          <Text style={{ color: colors.text, fontWeight: '800', marginBottom: 4 }}>🚚 En tránsito · incidencias</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {INCIDENT_TYPES.map((t) => (
              <TouchableOpacity key={t.value} onPress={() => setIncType(t.value)}
                style={{ paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: incType === t.value ? colors.primary : colors.border, backgroundColor: incType === t.value ? colors.primary : colors.surface }}>
                <Text style={{ color: incType === t.value ? colors.primaryContrast : colors.text, fontSize: 12, fontWeight: '600' }}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput value={incDesc} onChangeText={setIncDesc} placeholder="Describe la incidencia…" placeholderTextColor={colors.muted}
            style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginVertical: spacing.xs }} />
          {btn('+ Registrar incidencia', addIncident, colors.surfaceAlt)}
          <View style={{ marginTop: spacing.sm }}>{btn('📥 Llegó · marcar EN DESCARGA', () => advance('en_descarga'))}</View>
        </Card>
      ) : null}

      {/* CHECK-OUT DE RECEPCIÓN (en_descarga) */}
      {order.status === 'en_descarga' ? (
        <Card style={{ borderColor: '#7C3AED', borderWidth: 1 }}>
          <Text style={{ color: colors.text, fontWeight: '800', marginBottom: 4 }}>📥 Check-out de recepción</Text>
          <TextInput value={checkNote} onChangeText={setCheckNote} placeholder="Estado de la maquinaria a la llegada…" placeholderTextColor={colors.muted} multiline
            style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, minHeight: 46 }} />
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
            {btn('📷 Foto "después"', () => addPhoto('despues'), colors.surfaceAlt)}
          </View>
          {photoRow(['despues'], 'evidencia')}
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Recibe (firma) *</Text>
          <TextInput value={signedBy} onChangeText={setSignedBy} placeholder="Nombre de quien recibe" placeholderTextColor={colors.muted}
            style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs }}>
            {btn(signatureUrl ? '✓ Firma cargada' : '✍️ Firma / recepción', addSignature, colors.surfaceAlt)}
            {signatureUrl ? <Image source={{ uri: signatureUrl }} style={{ width: 56, height: 40, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt }} /> : null}
          </View>
          <View style={{ marginTop: spacing.sm }}>{btn('✅ Confirmar recepción · COMPLETAR', () => saveCheck('recepcion', 'completado'), colors.success)}</View>
        </Card>
      ) : null}

      {/* Historial de checks / fotos / incidencias (siempre visible) */}
      {(checks.length > 0 || incidents.length > 0) ? (
        <Card>
          {checks.length ? (
            <>
              <Text style={{ color: colors.text, fontWeight: '800', marginBottom: 2 }}>✅ Inspecciones</Text>
              {checks.map((c) => (
                <Text key={c.id} style={{ color: colors.text, fontSize: 12.5, marginTop: 2 }}>
                  {c.kind === 'salida' ? '📦 Salida' : '📥 Recepción'}
                  <Text style={{ color: colors.muted }}>  · {new Date(c.at).toLocaleString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    {c.fuel_level ? ` · ⛽ ${c.fuel_level}` : ''}{c.signed_by_name ? ` · firma: ${c.signed_by_name}` : ''}</Text>
                </Text>
              ))}
            </>
          ) : null}
          {incidents.length ? (
            <>
              <Text style={{ color: colors.text, fontWeight: '800', marginTop: spacing.sm, marginBottom: 2 }}>⚠️ Incidencias</Text>
              {incidents.map((i) => (
                <Text key={i.id} style={{ color: colors.text, fontSize: 12.5, marginTop: 2 }}>
                  <Text style={{ fontWeight: '700' }}>{i.type}</Text><Text style={{ color: colors.muted }}> · {i.description}</Text>
                </Text>
              ))}
            </>
          ) : null}
        </Card>
      ) : null}
    </View>
  );
}
