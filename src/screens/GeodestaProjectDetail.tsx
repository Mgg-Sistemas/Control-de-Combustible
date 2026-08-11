// GEODESTA · Fase 1 — detalle de un levantamiento: captura/gestión de PUNTOS.
// Captura por GPS (con control de tolerancia), entrada manual (N/E/Z o lat/lon),
// importación/exportación CSV, lista con capa/GCP/exclusión de outliers, y mapa.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading, Badge } from '../components/ui';
import { GeodestaMap, GeoMapPoint } from '../components/GeodestaMap';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { useToast } from '../components/ToastProvider';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { spacing, radius } from '../theme';
import { norm, cmpText } from '../lib/text';
import { levelMeets } from '../lib/permissions';
import { GeodestaProject, GeodestaPoint } from '../types/database';
import { captureHighAccuracy, neFromLatLng, parsePointsCsv, pointsToCsv, layerColor } from '../lib/geodesta';
import { contours, XYZ } from '../lib/tin';

type Tab = 'lista' | 'mapa' | 'superficie';
type Surface = { id: string; name: string; kind: string; interval_m: number | null; data: any; created_at: string };

export default function GeodestaProjectDetail({ route, navigation }: any) {
  const projectId: string = route?.params?.projectId;
  const { colors } = useTheme();
  const toast = useToast();
  const { moduleLevel } = useAuth();
  const lvl = moduleLevel('geodesta');
  const canWrite = levelMeets(lvl, 'escritura');
  const canDelete = levelMeets(lvl, 'full');

  const [project, setProject] = useState<GeodestaProject | null>(null);
  const [points, setPoints] = useState<GeodestaPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    if (!projectId) { setLoading(false); return; }
    const { data } = await supabase.from('geodesta_points').select('*').eq('project_id', projectId).order('created_at', { ascending: true });
    setPoints((data as GeodestaPoint[]) ?? []);
    setLoading(false);
  };
  const refetch = load;
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);
  useRealtimeRefresh(['geodesta_points'], () => load());

  const [tab, setTab] = useState<Tab>('lista');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [capMsg, setCapMsg] = useState<string | null>(null);

  // Formulario de punto (manual/GPS comparten campos).
  const [code, setCode] = useState('');
  const [norte, setNorte] = useState('');
  const [este, setEste] = useState('');
  const [cota, setCota] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [layer, setLayer] = useState('');
  const [desc, setDesc] = useState('');
  const [isGcp, setIsGcp] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const importRef = useRef<any>(null);

  // Fase 2 — superficie / curvas de nivel.
  const [interval, setIntervalM] = useState('1');
  const [overlay, setOverlay] = useState<any>(null);        // GeoJSON de curvas en el mapa
  const [surfInfo, setSurfInfo] = useState<string | null>(null);
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [activeSurf, setActiveSurf] = useState<string | null>(null);

  const loadSurfaces = async () => {
    if (!projectId) return;
    const { data } = await supabase.from('geodesta_surfaces').select('*').eq('project_id', projectId).order('created_at', { ascending: false });
    setSurfaces((data as Surface[]) ?? []);
  };
  useEffect(() => { loadSurfaces(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);
  useRealtimeRefresh(['geodesta_surfaces'], () => loadSurfaces());

  // Puntos válidos con N/E/Z para el MDT.
  const xyz = (): XYZ[] => points.filter((p) => !p.excluded && p.norte_m != null && p.este_m != null && p.cota_z != null)
    .map((p) => ({ x: p.este_m as number, y: p.norte_m as number, z: p.cota_z as number }));

  useEffect(() => {
    if (!projectId) return;
    supabase.from('geodesta_projects').select('*').eq('id', projectId).single().then(({ data }) => setProject(data as GeodestaProject));
  }, [projectId]);

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  // Orden de capas para asignar color estable.
  const layerOrder = useMemo(() => {
    const s: string[] = [];
    points.forEach((p) => { const k = (p.layer || '—').trim() || '—'; if (!s.includes(k)) s.push(k); });
    return s;
  }, [points]);

  const nextCode = useMemo(() => {
    const nums = points.map((p) => Number(String(p.code || '').replace(/\D/g, ''))).filter((n) => Number.isFinite(n) && n > 0);
    return String((nums.length ? Math.max(...nums) : 0) + 1);
  }, [points]);

  const filtered = useMemo(() => {
    const nq = norm(q.trim());
    const list = !nq ? points : points.filter((p) => [p.code, p.layer, p.description].filter(Boolean).some((v) => norm(v as string).includes(nq)));
    return list;
  }, [points, q]);

  const mapPoints: GeoMapPoint[] = useMemo(() => points.filter((p) => p.lat != null && p.lon != null).map((p) => ({
    id: p.id, lat: p.lat as number, lng: p.lon as number, code: p.code, z: p.cota_z, layer: p.layer,
    color: layerColor(p.layer, layerOrder), isGcp: p.is_gcp, excluded: p.excluded,
  })), [points, layerOrder]);

  const resetForm = () => { setCode(''); setNorte(''); setEste(''); setCota(''); setLat(''); setLon(''); setLayer(''); setDesc(''); setIsGcp(false); setCapMsg(null); };

  const capturarGps = async () => {
    if (!project) return;
    setBusy(true); setCapMsg('📡 Obteniendo posición GPS…');
    const fix = await captureHighAccuracy();
    setBusy(false);
    if (!fix.ok || fix.lat == null || fix.lng == null) { setCapMsg(null); toast.error(fix.error || 'No se pudo obtener el GPS.'); return; }
    const acc = fix.accuracy ?? 999;
    if (acc > Number(project.gps_tolerance_m || 5)) {
      setCapMsg(`⚠️ Precisión ${acc.toFixed(1)} m > tolerancia ${project.gps_tolerance_m} m. Toma rechazada; acércate a cielo abierto e intenta de nuevo.`);
      return;
    }
    const ne = neFromLatLng(fix.lat, fix.lng);
    setLat(String(fix.lat.toFixed(7))); setLon(String(fix.lng.toFixed(7)));
    setNorte(String(ne.norte.toFixed(3))); setEste(String(ne.este.toFixed(3)));
    if (!code) setCode(nextCode);
    setCapMsg(`✅ Capturado · precisión ${acc.toFixed(1)} m (tol. ${project.gps_tolerance_m} m). Revisa y guarda.`);
  };

  const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : null; };

  const guardar = async () => {
    if (!project || busy) return;
    const nrt = num(norte), est = num(este);
    const la = num(lat), lo = num(lon);
    if (nrt == null && la == null) { toast.error('Ingresa al menos N/E o lat/lon.'); return; }
    setBusy(true);
    // Si vino por N/E manual sin lat/lon, dejamos lat/lon nulos (el mapa usa lat/lon).
    const { error } = await supabase.from('geodesta_points').insert({
      project_id: project.id, code: code.trim() || nextCode,
      norte_m: nrt, este_m: est, cota_z: num(cota),
      lat: la, lon: lo,
      source: la != null && lat ? 'gps' : 'manual',
      layer: layer.trim() || null, description: desc.trim() || null, is_gcp: isGcp,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Punto guardado.');
    resetForm(); refetch();
  };

  const toggle = async (p: GeodestaPoint, field: 'is_gcp' | 'excluded') => {
    if (!canWrite) return;
    const { error } = await supabase.from('geodesta_points').update({ [field]: !p[field] }).eq('id', p.id);
    if (error) { toast.error(error.message); return; }
    refetch();
  };

  const eliminar = async (p: GeodestaPoint) => {
    const { error } = await supabase.from('geodesta_points').delete().eq('id', p.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Punto eliminado.'); refetch();
  };

  // ── Importar CSV (solo web: input file) ──────────────────────────────────
  const onImportFile = async (e: any) => {
    const file = e?.target?.files?.[0];
    if (!file || !project) return;
    const text = await file.text();
    const parsed = parsePointsCsv(text);
    if (!parsed.length) { toast.error('No se detectaron puntos en el archivo.'); return; }
    setBusy(true);
    const rows = parsed.map((p, i) => ({
      project_id: project.id,
      code: p.code || String(i + 1),
      norte_m: p.norte_m ?? null, este_m: p.este_m ?? null, cota_z: p.cota_z ?? null,
      lat: p.lat ?? null, lon: p.lon ?? null,
      source: 'import', layer: p.layer || null, description: p.description || null,
    }));
    const { error } = await supabase.from('geodesta_points').insert(rows);
    setBusy(false);
    if (e?.target) e.target.value = '';
    if (error) { toast.error(error.message); return; }
    toast.success(`${rows.length} punto(s) importado(s).`);
    refetch();
  };

  const exportCsv = () => {
    const csv = pointsToCsv(points.map((p) => ({ code: p.code, norte_m: p.norte_m, este_m: p.este_m, cota_z: p.cota_z, layer: p.layer, description: p.description, lat: p.lat, lon: p.lon })));
    if (Platform.OS === 'web') {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `puntos-${(project?.name || 'levantamiento').replace(/\s+/g, '_')}.csv`;
      a.click(); URL.revokeObjectURL(url);
    } else {
      toast.info('La exportación CSV está disponible en la versión web.');
    }
  };

  // ── Fase 2: curvas de nivel ──────────────────────────────────────────────
  const intervalNum = () => { const n = Number(String(interval).replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : 1; };

  const generar = () => {
    const pts = xyz();
    if (pts.length < 3) { toast.error('Se necesitan al menos 3 puntos con cota (Z).'); return; }
    const iv = intervalNum();
    const res = contours(pts, iv, 19, true);
    if (!res.levels) { setOverlay(null); setSurfInfo('No se generaron curvas (revisa las cotas y el intervalo).'); return; }
    setOverlay(res.geojson);
    setActiveSurf(null);
    setSurfInfo(`✅ ${res.levels} curva(s) cada ${iv} m · cotas ${res.zmin.toFixed(2)}–${res.zmax.toFixed(2)} m (${pts.length} pts). Vista previa; guárdala como versión.`);
    setTab('superficie');
  };

  const guardarVersion = async () => {
    if (!project || busy) return;
    const pts = xyz();
    if (pts.length < 3) { toast.error('Se necesitan al menos 3 puntos con cota (Z).'); return; }
    const iv = intervalNum();
    let zmin = Infinity, zmax = -Infinity;
    pts.forEach((p) => { if (p.z < zmin) zmin = p.z; if (p.z > zmax) zmax = p.z; });
    setBusy(true);
    const name = `Superficie ${new Date().toLocaleDateString('es-VE')} · cada ${iv} m`;
    const { error } = await supabase.from('geodesta_surfaces').insert({
      project_id: project.id, name, kind: 'natural', interval_m: iv,
      data: { interval: iv, zmin, zmax, n: pts.length, points: pts },
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Versión de superficie guardada.');
    loadSurfaces();
  };

  const verVersion = (s: Surface) => {
    const pts: XYZ[] = s.data?.points ?? [];
    const iv = s.interval_m || s.data?.interval || 1;
    if (pts.length < 3) { toast.error('Esta versión no tiene puntos suficientes.'); return; }
    const res = contours(pts, iv, 19, true);
    setOverlay(res.geojson);
    setActiveSurf(s.id);
    setSurfInfo(`👁️ ${s.name} · ${res.levels} curva(s)`);
    setTab('superficie');
  };

  const borrarVersion = async (s: Surface) => {
    const { error } = await supabase.from('geodesta_surfaces').delete().eq('id', s.id);
    if (error) { toast.error(error.message); return; }
    if (activeSurf === s.id) { setActiveSurf(null); setOverlay(null); }
    toast.success('Versión eliminada.'); loadSurfaces();
  };

  const validos = points.filter((p) => !p.excluded);
  const conZ = validos.filter((p) => p.cota_z != null);
  const gcps = points.filter((p) => p.is_gcp).length;

  return (
    <Screen>
      <SectionTitle>{project ? `📐 ${project.name}` : 'Levantamiento'}</SectionTitle>
      {project ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.sm }}>
          {project.referencia ? <Chip colors={colors}>🏗️ {project.referencia}</Chip> : null}
          <Chip colors={colors}>📍 {project.coord_system} · EPSG:{project.srid}</Chip>
          <Chip colors={colors}>🎯 Tol. {project.gps_tolerance_m} m</Chip>
          <Chip colors={colors}>🔢 {points.length} pts · {gcps} GCP</Chip>
        </View>
      ) : null}

      {/* Pestañas Lista / Mapa / Superficie */}
      <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
        {(['lista', 'mapa', 'superficie'] as Tab[]).map((t) => (
          <TouchableOpacity key={t} onPress={() => setTab(t)} style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: tab === t ? colors.brand : colors.surface, borderWidth: 1, borderColor: tab === t ? colors.brand : colors.border }}>
            <Text style={{ color: tab === t ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 12.5 }}>{t === 'lista' ? '📋 Puntos' : t === 'mapa' ? '🗺️ Mapa' : '⛰️ Superficie'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'superficie' ? (
        <>
          <Card>
            <Text style={{ color: colors.text, fontWeight: '800', marginBottom: 4 }}>⛰️ Curvas de nivel (MDT/TIN)</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>Genera el modelo del terreno a partir de los puntos con cota (Z) y sus curvas de nivel al intervalo elegido.</Text>
            <Text style={lbl(colors)}>Intervalo entre curvas (m)</Text>
            <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
              {['0.5', '1', '2', '5'].map((v) => (
                <TouchableOpacity key={v} onPress={() => setIntervalM(v)} style={{ paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: interval === v ? colors.brand : colors.border, backgroundColor: interval === v ? colors.brand : colors.surface }}>
                  <Text style={{ color: interval === v ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{v} m</Text>
                </TouchableOpacity>
              ))}
              <TextInput value={interval} onChangeText={setIntervalM} keyboardType="decimal-pad" style={{ ...input, width: 80 }} />
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
              <TouchableOpacity onPress={generar} style={{ flex: 1, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 13 }}>⛰️ Generar curvas</Text>
              </TouchableOpacity>
              {canWrite ? (
                <TouchableOpacity onPress={guardarVersion} disabled={busy} style={{ flex: 1, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
                  <Text style={{ color: colors.brand, fontWeight: '800', fontSize: 13 }}>💾 Guardar versión</Text>
                </TouchableOpacity>
              ) : null}
              {overlay ? (
                <TouchableOpacity onPress={() => { setOverlay(null); setActiveSurf(null); setSurfInfo(null); }} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, alignItems: 'center' }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Limpiar</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {surfInfo ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>{surfInfo}</Text> : null}
          </Card>
          <View style={{ height: spacing.sm }} />
          <GeodestaMap points={mapPoints} overlay={overlay} height={400} />
          {surfaces.length ? (
            <>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.md, marginBottom: 4 }}>Versiones guardadas ({surfaces.length})</Text>
              {surfaces.map((s) => (
                <Card key={s.id}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{activeSurf === s.id ? '👁️ ' : ''}{s.name}</Text>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>{s.data?.n ?? '—'} pts · cotas {s.data?.zmin?.toFixed?.(2) ?? '—'}–{s.data?.zmax?.toFixed?.(2) ?? '—'} m</Text>
                    </View>
                    <TouchableOpacity onPress={() => verVersion(s)} style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 5 }}>
                      <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>Ver</Text>
                    </TouchableOpacity>
                    {canDelete ? (
                      <TouchableOpacity onPress={() => borrarVersion(s)} style={{ paddingHorizontal: spacing.xs, paddingVertical: 5 }}>
                        <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>🗑</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </Card>
              ))}
            </>
          ) : null}
          <View style={{ height: spacing.lg }} />
        </>
      ) : tab === 'mapa' ? (
        <>
          <GeodestaMap points={mapPoints} overlay={overlay} height={420} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: spacing.sm }}>
            {layerOrder.map((l) => (
              <View key={l} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: layerColor(l, layerOrder) }} />
                <Text style={{ color: colors.muted, fontSize: 11 }}>{l}</Text>
              </View>
            ))}
          </View>
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>◆ = punto de control (GCP) · los puntos excluidos se ven translúcidos.</Text>
        </>
      ) : (
        <>
          {canWrite ? (
            <>
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
                <TouchableOpacity onPress={() => { setShowForm((v) => !v); if (!showForm && !code) setCode(nextCode); }} style={{ flex: 1, backgroundColor: showForm ? colors.surfaceAlt : colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', borderWidth: showForm ? 1 : 0, borderColor: colors.border }}>
                  <Text style={{ color: showForm ? colors.text : colors.brandContrast, fontWeight: '800', fontSize: 13 }}>{showForm ? 'Cerrar' : '＋ Punto'}</Text>
                </TouchableOpacity>
                {Platform.OS === 'web' ? (
                  <TouchableOpacity onPress={() => importRef.current?.click?.()} style={{ flex: 1, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                    <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 13 }}>⬆️ Importar CSV</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity onPress={exportCsv} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>⬇️ Exportar</Text>
                </TouchableOpacity>
              </View>
              {Platform.OS === 'web' ? React.createElement('input' as any, { ref: importRef, type: 'file', accept: '.csv,.txt', style: { display: 'none' }, onChange: onImportFile }) : null}
            </>
          ) : null}

          {showForm && canWrite ? (
            <Card>
              <TouchableOpacity onPress={capturarGps} disabled={busy} style={{ backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>{busy ? '📡 Capturando…' : '📡 Capturar por GPS'}</Text>
              </TouchableOpacity>
              {capMsg ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>{capMsg}</Text> : null}
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
                <View style={{ flex: 1 }}><Text style={lbl(colors)}>Punto (código)</Text><TextInput value={code} onChangeText={setCode} placeholder={nextCode} placeholderTextColor={colors.muted} style={input} /></View>
                <View style={{ flex: 1 }}><Text style={lbl(colors)}>Capa / código</Text><TextInput value={layer} onChangeText={setLayer} placeholder="terreno, borde, poste…" placeholderTextColor={colors.muted} style={input} /></View>
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
                <View style={{ flex: 1 }}><Text style={lbl(colors)}>Norte (N)</Text><TextInput value={norte} onChangeText={setNorte} keyboardType="numbers-and-punctuation" placeholder="m" placeholderTextColor={colors.muted} style={input} /></View>
                <View style={{ flex: 1 }}><Text style={lbl(colors)}>Este (E)</Text><TextInput value={este} onChangeText={setEste} keyboardType="numbers-and-punctuation" placeholder="m" placeholderTextColor={colors.muted} style={input} /></View>
                <View style={{ flex: 1 }}><Text style={lbl(colors)}>Cota (Z)</Text><TextInput value={cota} onChangeText={setCota} keyboardType="numbers-and-punctuation" placeholder="m" placeholderTextColor={colors.muted} style={input} /></View>
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
                <View style={{ flex: 1 }}><Text style={lbl(colors)}>Latitud</Text><TextInput value={lat} onChangeText={setLat} keyboardType="numbers-and-punctuation" placeholder="opcional" placeholderTextColor={colors.muted} style={input} /></View>
                <View style={{ flex: 1 }}><Text style={lbl(colors)}>Longitud</Text><TextInput value={lon} onChangeText={setLon} keyboardType="numbers-and-punctuation" placeholder="opcional" placeholderTextColor={colors.muted} style={input} /></View>
              </View>
              <Text style={lbl(colors)}>Descripción</Text>
              <TextInput value={desc} onChangeText={setDesc} placeholder="Nota del punto…" placeholderTextColor={colors.muted} style={input} />
              <TouchableOpacity onPress={() => setIsGcp((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.sm }}>
                <Text style={{ fontSize: 16 }}>{isGcp ? '☑' : '☐'}</Text>
                <Text style={{ color: colors.text, fontSize: 13 }}>Es punto de control / base (GCP) con cota conocida</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={guardar} disabled={busy} style={{ marginTop: spacing.sm, backgroundColor: colors.brand, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
                <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{busy ? 'Guardando…' : 'Guardar punto'}</Text>
              </TouchableOpacity>
            </Card>
          ) : null}

          <TextInput value={q} onChangeText={setQ} placeholder="🔎 Buscar punto (código, capa, nota)…" placeholderTextColor={colors.muted} style={{ ...input, marginBottom: spacing.sm }} />

          {loading && points.length === 0 ? (
            <Loading />
          ) : filtered.length === 0 ? (
            <EmptyState title="Sin puntos" subtitle={q ? 'Prueba con otra búsqueda.' : canWrite ? 'Captura por GPS, ingresa manual o importa un CSV.' : 'Aún no hay puntos en este levantamiento.'} />
          ) : (
            <>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>{filtered.length} de {points.length} punto(s) · {validos.length} válidos · {conZ.length} con cota</Text>
              {filtered.map((p) => (
                <Card key={p.id}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                    <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: layerColor(p.layer, layerOrder), opacity: p.excluded ? 0.4 : 1 }} />
                    <Text style={{ color: colors.text, fontWeight: '800', flex: 1 }}>{p.is_gcp ? '◆ ' : ''}{p.code || 'punto'}{p.excluded ? ' (excluido)' : ''}</Text>
                    {p.layer ? <Badge tone="muted" label={p.layer} /> : null}
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 3 }}>
                    N {fmt(p.norte_m)} · E {fmt(p.este_m)} · Z {fmt(p.cota_z)} m{p.precision_m != null ? ` · ±${p.precision_m} m` : ''}
                  </Text>
                  {p.description ? <Text style={{ color: colors.muted, fontSize: 12 }}>{p.description}</Text> : null}
                  {canWrite ? (
                    <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs, flexWrap: 'wrap' }}>
                      <TouchableOpacity onPress={() => toggle(p, 'is_gcp')}><Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>{p.is_gcp ? '◆ Quitar GCP' : '◇ Marcar GCP'}</Text></TouchableOpacity>
                      <TouchableOpacity onPress={() => toggle(p, 'excluded')}><Text style={{ color: colors.warning, fontWeight: '700', fontSize: 12 }}>{p.excluded ? '↩︎ Incluir' : '⊘ Excluir'}</Text></TouchableOpacity>
                      {canDelete ? <TouchableOpacity onPress={() => eliminar(p)}><Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>🗑 Eliminar</Text></TouchableOpacity> : null}
                    </View>
                  ) : null}
                </Card>
              ))}
            </>
          )}
        </>
      )}
      <View style={{ height: spacing.lg }} />
    </Screen>
  );
}

const fmt = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('es-VE', { maximumFractionDigits: 3 }));
const lbl = (colors: any) => ({ color: colors.muted, fontSize: 11, marginTop: 6, marginBottom: 3 } as const);

function Chip({ children, colors }: { children: React.ReactNode; colors: any }) {
  return (
    <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 }}>
      <Text style={{ color: colors.text, fontSize: 11, fontWeight: '600' }}>{children}</Text>
    </View>
  );
}
