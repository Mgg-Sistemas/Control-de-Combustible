// GEODESTA · Fase 4 — inspecciones de terreno georreferenciadas. Formulario con GPS,
// fotos, checklist configurable, hallazgos, estado (pendiente/observado/aprobado) y
// firma; historial y mapa. Ligado al levantamiento (proyecto) y su obra/edificio.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Image, ScrollView, Linking, Platform } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading, Badge } from '../components/ui';
import { GeodestaMap, GeoMapPoint } from '../components/GeodestaMap';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { useToast } from '../components/ToastProvider';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { spacing, radius } from '../theme';
import { levelMeets } from '../lib/permissions';
import { captureHighAccuracy } from '../lib/geodesta';
import { captureAndUploadPhoto } from '../lib/photo';
import { pdfDocument, exportPdf } from '../lib/pdf';

type CheckItem = { item: string; estado: 'bien' | 'observado' | 'na' };
type Insp = {
  id: string; project_id: string | null; referencia: string | null; lat: number | null; lon: number | null;
  status: 'pendiente' | 'observado' | 'aprobado'; checklist: CheckItem[] | null; findings: string | null;
  photos: string[] | null; signature_url: string | null; signed_by: string | null; created_at: string;
};

const STATUS: { v: Insp['status']; label: string; tone: 'muted' | 'warning' | 'success' }[] = [
  { v: 'pendiente', label: 'Pendiente', tone: 'muted' },
  { v: 'observado', label: 'Observado', tone: 'warning' },
  { v: 'aprobado', label: 'Aprobado', tone: 'success' },
];
const statusColor = (s: string) => s === 'aprobado' ? '#16A34A' : s === 'observado' ? '#D97706' : '#6B7280';

export default function GeodestaInspections({ route }: any) {
  const projectId: string = route?.params?.projectId;
  const projectName: string = route?.params?.projectName || 'Levantamiento';
  const referencia: string | null = route?.params?.referencia ?? null;
  const { colors } = useTheme();
  const toast = useToast();
  const { moduleLevel, session } = useAuth();
  const lvl = moduleLevel('geodesta');
  const canWrite = levelMeets(lvl, 'escritura');
  const canDelete = levelMeets(lvl, 'full');

  const [rows, setRows] = useState<Insp[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'lista' | 'mapa'>('lista');
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);

  // Formulario.
  const [lat, setLat] = useState<number | null>(null);
  const [lon, setLon] = useState<number | null>(null);
  const [acc, setAcc] = useState<number | null>(null);
  const [status, setStatus] = useState<Insp['status']>('pendiente');
  const [checklist, setChecklist] = useState<CheckItem[]>([]);
  const [newItem, setNewItem] = useState('');
  const [findings, setFindings] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);

  const load = async () => {
    if (!projectId) { setLoading(false); return; }
    const { data } = await supabase.from('geodesta_inspections').select('*').eq('project_id', projectId).order('created_at', { ascending: false });
    setRows((data as Insp[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);
  useRealtimeRefresh(['geodesta_inspections'], () => load());

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  const resetForm = () => { setLat(null); setLon(null); setAcc(null); setStatus('pendiente'); setChecklist([]); setNewItem(''); setFindings(''); setPhotos([]); };

  const capturar = async () => {
    setBusy(true);
    const fix = await captureHighAccuracy();
    setBusy(false);
    if (!fix.ok || fix.lat == null) { toast.error(fix.error || 'No se pudo obtener el GPS.'); return; }
    setLat(fix.lat); setLon(fix.lng ?? null); setAcc(fix.accuracy ?? null);
    toast.success(`Ubicación capturada${fix.accuracy != null ? ` (±${fix.accuracy.toFixed(1)} m)` : ''}.`);
  };

  const addFoto = async () => {
    setBusy(true);
    const r = await captureAndUploadPhoto(projectId, 'geodesta-insp');
    setBusy(false);
    if (!r.ok || !r.url) { if (r.error) toast.error(r.error); return; }
    setPhotos((p) => [...p, r.url as string]);
  };

  const addItem = () => { const t = newItem.trim(); if (!t) return; setChecklist((c) => [...c, { item: t, estado: 'bien' }]); setNewItem(''); };
  const cycleItem = (i: number) => setChecklist((c) => c.map((it, idx) => idx === i ? { ...it, estado: it.estado === 'bien' ? 'observado' : it.estado === 'observado' ? 'na' : 'bien' } : it));
  const rmItem = (i: number) => setChecklist((c) => c.filter((_, idx) => idx !== i));

  const guardar = async () => {
    if (busy) return;
    setBusy(true);
    const { error } = await supabase.from('geodesta_inspections').insert({
      project_id: projectId, referencia, lat, lon, status,
      checklist: checklist.length ? checklist : null,
      findings: findings.trim() || null,
      photos: photos.length ? photos : null,
      signed_by: session?.user?.id ?? null,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Inspección guardada.');
    resetForm(); setShowForm(false); load();
  };

  const setEstado = async (r: Insp, s: Insp['status']) => {
    const { error } = await supabase.from('geodesta_inspections').update({ status: s }).eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    load();
  };
  const eliminar = async (r: Insp) => {
    const { error } = await supabase.from('geodesta_inspections').delete().eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Inspección eliminada.'); load();
  };

  const pdfActa = async (r: Insp) => {
    const chk = (r.checklist ?? []).map((c) => `<tr><td>${esc(c.item)}</td><td>${c.estado === 'bien' ? '🟢 Bien' : c.estado === 'observado' ? '🟠 Observado' : '⚪ N/A'}</td></tr>`).join('') || '<tr><td colspan="2">Sin checklist</td></tr>';
    const fotos = (r.photos ?? []).map((u) => `<img src="${u}" style="max-width:32%;margin:2px;border:1px solid #ccc"/>`).join('');
    const body = `
      <h2>Acta de inspección de terreno</h2>
      <table>
        <tr><td><b>Proyecto</b></td><td>${esc(projectName)}</td></tr>
        <tr><td><b>Obra / edificio</b></td><td>${esc(r.referencia || referencia || '—')}</td></tr>
        <tr><td><b>Fecha</b></td><td>${new Date(r.created_at).toLocaleString('es-VE')}</td></tr>
        <tr><td><b>Estado</b></td><td>${r.status.toUpperCase()}</td></tr>
        <tr><td><b>Ubicación</b></td><td>${r.lat != null ? `${r.lat.toFixed(6)}, ${r.lon?.toFixed(6)}` : '—'}</td></tr>
      </table>
      <h3>Checklist</h3><table><tr><th>Ítem</th><th>Estado</th></tr>${chk}</table>
      <h3>Hallazgos</h3><p>${esc(r.findings || '—')}</p>
      ${fotos ? `<h3>Fotografías</h3><div>${fotos}</div>` : ''}`;
    const html = pdfDocument({ title: 'Acta de inspección', subtitle: projectName, body });
    await exportPdf(html, `Acta inspeccion - ${projectName}`);
  };

  const mapPoints: GeoMapPoint[] = useMemo(() => rows.filter((r) => r.lat != null && r.lon != null).map((r) => ({
    id: r.id, lat: r.lat as number, lng: r.lon as number, code: r.status, layer: r.status, color: statusColor(r.status), isGcp: false,
  })), [rows]);

  return (
    <Screen>
      <SectionTitle>🧭 Inspecciones · {projectName}</SectionTitle>
      {referencia ? <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>🏗️ {referencia}</Text> : null}

      <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
        {(['lista', 'mapa'] as const).map((t) => (
          <TouchableOpacity key={t} onPress={() => setTab(t)} style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: tab === t ? colors.brand : colors.surface, borderWidth: 1, borderColor: tab === t ? colors.brand : colors.border }}>
            <Text style={{ color: tab === t ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 13 }}>{t === 'lista' ? '📋 Inspecciones' : '🗺️ Mapa'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'mapa' ? (
        <>
          <GeodestaMap points={mapPoints} height={420} />
          <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }}>
            {STATUS.map((s) => (
              <View key={s.v} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: statusColor(s.v) }} />
                <Text style={{ color: colors.muted, fontSize: 11 }}>{s.label}</Text>
              </View>
            ))}
          </View>
        </>
      ) : (
        <>
          {canWrite ? (
            <TouchableOpacity onPress={() => setShowForm((v) => !v)} style={{ backgroundColor: showForm ? colors.surfaceAlt : colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', marginBottom: spacing.sm, borderWidth: showForm ? 1 : 0, borderColor: colors.border }}>
              <Text style={{ color: showForm ? colors.text : colors.brandContrast, fontWeight: '800' }}>{showForm ? 'Cancelar' : '＋ Nueva inspección'}</Text>
            </TouchableOpacity>
          ) : null}

          {showForm && canWrite ? (
            <Card>
              <TouchableOpacity onPress={capturar} disabled={busy} style={{ backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>📍 {lat != null ? `Ubicación lista (${lat.toFixed(5)}, ${lon?.toFixed(5)})${acc != null ? ` ±${acc.toFixed(0)}m` : ''}` : 'Capturar ubicación GPS'}</Text>
              </TouchableOpacity>

              <Text style={lbl(colors)}>Estado</Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                {STATUS.map((s) => (
                  <TouchableOpacity key={s.v} onPress={() => setStatus(s.v)} style={{ flex: 1, paddingVertical: 8, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: status === s.v ? statusColor(s.v) : colors.border, backgroundColor: status === s.v ? statusColor(s.v) : colors.surface }}>
                    <Text style={{ color: status === s.v ? '#fff' : colors.text, fontWeight: '700', fontSize: 12 }}>{s.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={lbl(colors)}>Checklist (toca un ítem para cambiar su estado)</Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                <TextInput value={newItem} onChangeText={setNewItem} placeholder="Agregar ítem…" placeholderTextColor={colors.muted} style={{ ...input, flex: 1 }} onSubmitEditing={addItem} />
                <TouchableOpacity onPress={addItem} style={{ backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: spacing.md, justifyContent: 'center' }}><Text style={{ color: colors.brandContrast, fontWeight: '800' }}>＋</Text></TouchableOpacity>
              </View>
              {checklist.map((c, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 6 }}>
                  <TouchableOpacity onPress={() => cycleItem(i)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                    <Text style={{ fontSize: 15 }}>{c.estado === 'bien' ? '🟢' : c.estado === 'observado' ? '🟠' : '⚪'}</Text>
                    <Text style={{ color: colors.text, fontSize: 13 }}>{c.item}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => rmItem(i)}><Text style={{ color: colors.danger, fontSize: 13 }}>✕</Text></TouchableOpacity>
                </View>
              ))}

              <Text style={lbl(colors)}>Hallazgos</Text>
              <TextInput value={findings} onChangeText={setFindings} placeholder="Describe lo observado en terreno…" placeholderTextColor={colors.muted} style={{ ...input, minHeight: 54 }} multiline />

              <Text style={lbl(colors)}>Fotografías ({photos.length})</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {photos.map((u, i) => <Image key={i} source={{ uri: u }} style={{ width: 64, height: 64, borderRadius: radius.md }} />)}
                <TouchableOpacity onPress={addFoto} disabled={busy} style={{ width: 64, height: 64, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface }}>
                  <Text style={{ color: colors.primary, fontSize: 22 }}>＋</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity onPress={guardar} disabled={busy} style={{ marginTop: spacing.md, backgroundColor: colors.brand, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
                <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{busy ? 'Guardando…' : 'Guardar inspección'}</Text>
              </TouchableOpacity>
            </Card>
          ) : null}

          {loading && rows.length === 0 ? (
            <Loading />
          ) : rows.length === 0 ? (
            <EmptyState title="Sin inspecciones" subtitle={canWrite ? 'Crea la primera inspección de terreno.' : 'Aún no hay inspecciones.'} />
          ) : (
            rows.map((r) => (
              <Card key={r.id}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>{new Date(r.created_at).toLocaleString('es-VE')}</Text>
                    {r.lat != null ? <TouchableOpacity onPress={() => Linking.openURL(`https://www.google.com/maps?q=${r.lat},${r.lon}`)}><Text style={{ color: colors.primary, fontSize: 11 }}>📍 {r.lat.toFixed(6)}, {r.lon?.toFixed(6)}</Text></TouchableOpacity> : null}
                  </View>
                  <Badge tone={STATUS.find((s) => s.v === r.status)?.tone ?? 'muted'} label={r.status.toUpperCase()} />
                </View>
                {r.findings ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>{r.findings}</Text> : null}
                {r.checklist?.length ? <Text style={{ color: colors.muted, fontSize: 11, marginTop: 3 }}>✓ {r.checklist.length} ítem(s): {r.checklist.filter((c) => c.estado === 'observado').length} observados</Text> : null}
                {r.photos?.length ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
                    <View style={{ flexDirection: 'row', gap: 6 }}>{r.photos.map((u, i) => <Image key={i} source={{ uri: u }} style={{ width: 64, height: 64, borderRadius: radius.md }} />)}</View>
                  </ScrollView>
                ) : null}
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap', alignItems: 'center' }}>
                  {canWrite ? STATUS.filter((s) => s.v !== r.status).map((s) => (
                    <TouchableOpacity key={s.v} onPress={() => setEstado(r, s.v)} style={{ borderWidth: 1, borderColor: statusColor(s.v), borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                      <Text style={{ color: statusColor(s.v), fontWeight: '700', fontSize: 11 }}>→ {s.label}</Text>
                    </TouchableOpacity>
                  )) : null}
                  <TouchableOpacity onPress={() => pdfActa(r)}><Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>📄 Acta PDF</Text></TouchableOpacity>
                  {canDelete ? <TouchableOpacity onPress={() => eliminar(r)}><Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>🗑</Text></TouchableOpacity> : null}
                </View>
              </Card>
            ))
          )}
        </>
      )}
      <View style={{ height: spacing.lg }} />
    </Screen>
  );
}

const lbl = (colors: any) => ({ color: colors.muted, fontSize: 11, marginTop: 10, marginBottom: 3 } as const);
const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
