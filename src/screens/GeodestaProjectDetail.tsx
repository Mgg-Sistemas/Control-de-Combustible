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
import { contours, slopeHeatmap, XYZ } from '../lib/tin';
import { volumeBetween, volumeToLevel, VolumeResult, fmtM3 } from '../lib/volumes';
import { buildGrid, profile, crossSections } from '../lib/tin';
import { ProfileChart, ProfilePt } from '../components/ProfileChart';
import { buildDxf, buildKml, buildGeoJson, buildLandXml, downloadText, ExpPoint } from '../lib/geoexport';
import { isOnline, enqueue, pendingCount, flush, onReconnect, insertChunked } from '../lib/geodestaQueue';
import { pdfDocument, exportPdf } from '../lib/pdf';

type Tab = 'lista' | 'mapa' | 'superficie' | 'volumen' | 'salidas';
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

  // Fase 6 — sincronización offline.
  const [pending, setPending] = useState(0);
  const refreshPending = async () => setPending(await pendingCount());
  const sincronizar = async () => {
    const r = await flush();
    await refreshPending();
    if (r.error && r.left) { toast.error(`Faltan ${r.left} por sincronizar (sin señal).`); return; }
    if (r.done) { toast.success(`${r.done} captura(s) sincronizada(s).`); load(); }
  };
  useEffect(() => {
    refreshPending();
    // Intenta vaciar la cola al entrar y cuando vuelve la conexión.
    (async () => { if (isOnline() && (await pendingCount()) > 0) sincronizar(); })();
    const off = onReconnect(() => sincronizar());
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Fase 3 — volúmenes.
  const [volMode, setVolMode] = useState<'versiones' | 'nivel'>('versiones');
  const [baseSurf, setBaseSurf] = useState<string | null>(null);   // id de superficie, o 'actual'
  const [newSurf, setNewSurf] = useState<string | null>(null);
  const [designLevel, setDesignLevel] = useState('');
  const [vol, setVol] = useState<VolumeResult | null>(null);
  const [volTitle, setVolTitle] = useState('');

  const surfPoints = (id: string | null): XYZ[] => id === 'actual' ? xyz() : (surfaces.find((s) => s.id === id)?.data?.points ?? []);

  // Fase 5 — perfil + exportaciones.
  const [profStart, setProfStart] = useState<string | null>(null);
  const [profEnd, setProfEnd] = useState<string | null>(null);
  const [profSamples, setProfSamples] = useState<ProfilePt[] | null>(null);
  const [secSpacing, setSecSpacing] = useState('10');
  const [secWidth, setSecWidth] = useState('15');
  const [sections, setSections] = useState<{ station: number; samples: ProfilePt[] }[] | null>(null);
  const withNE = () => points.filter((p) => p.norte_m != null && p.este_m != null);

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
    const row = {
      project_id: project.id, code: code.trim() || nextCode,
      norte_m: nrt, este_m: est, cota_z: num(cota),
      lat: la, lon: lo,
      source: la != null && lat ? 'gps' : 'manual',
      layer: layer.trim() || null, description: desc.trim() || null, is_gcp: isGcp,
    };
    // Sin conexión: guarda en la cola local y sincroniza al reconectar.
    if (!isOnline()) {
      await enqueue('geodesta_points', row);
      await refreshPending();
      setBusy(false);
      toast.success('Punto guardado sin conexión; se sincronizará al volver la señal.');
      resetForm();
      return;
    }
    const { error } = await supabase.from('geodesta_points').insert(row);
    setBusy(false);
    if (error) {
      // Falla de red pese a estar "online": lo encolamos para no perder la captura.
      await enqueue('geodesta_points', row); await refreshPending();
      toast.info('Sin red: el punto quedó en cola para sincronizar.');
      resetForm();
      return;
    }
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
    const res = await insertChunked('geodesta_points', rows);
    setBusy(false);
    if (e?.target) e.target.value = '';
    if (!res.ok) { toast.error(`${res.error} (importados ${res.inserted} antes del error)`); refetch(); return; }
    toast.success(`${res.inserted} punto(s) importado(s).`);
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
    setActiveSurf(null); setSlopeOn(false);
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

  const [slopeOn, setSlopeOn] = useState(false);
  const verPendientes = () => {
    const pts = xyz();
    if (pts.length < 3) { toast.error('Se necesitan al menos 3 puntos con cota (Z).'); return; }
    const r = slopeHeatmap(pts, 19, true);
    if (!r.cells) { toast.error('No se pudo calcular la pendiente.'); return; }
    setOverlay(r.geojson); setSlopeOn(true); setActiveSurf(null);
    setSurfInfo(`🌡️ Mapa de pendientes · ${r.cells} celdas.`);
    setTab('superficie');
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

  // ── Fase 3: volúmenes ────────────────────────────────────────────────────
  const calcularVolumen = () => {
    if (volMode === 'versiones') {
      const b = surfPoints(baseSurf), n = surfPoints(newSurf);
      if (!b.length || !n.length) { toast.error('Elige la superficie base y la nueva.'); return; }
      const r = volumeBetween(b, n, undefined, 19, true);
      if (!r.ok) { toast.error(r.error || 'No se pudo comparar.'); return; }
      setVol(r); setOverlay(r.geojson);
      setVolTitle(`${labelSurf(baseSurf)} → ${labelSurf(newSurf)}`);
    } else {
      const b = surfPoints(baseSurf || 'actual');
      const lv = Number(String(designLevel).replace(',', '.'));
      if (!b.length) { toast.error('Elige la superficie base.'); return; }
      if (!Number.isFinite(lv)) { toast.error('Escribe la cota de diseño (nivel).'); return; }
      const r = volumeToLevel(b, lv, undefined, 19, true);
      if (!r.ok) { toast.error(r.error || 'No se pudo calcular.'); return; }
      setVol(r); setOverlay(r.geojson);
      setVolTitle(`${labelSurf(baseSurf || 'actual')} vs nivel ${lv} m`);
    }
  };

  const labelSurf = (id: string | null) => id === 'actual' ? 'Puntos actuales' : (surfaces.find((s) => s.id === id)?.name ?? '—');

  const pdfVolumen = async () => {
    if (!vol || !project) return;
    const body = `
      <h2>Cubicación de movimiento de tierra</h2>
      <table>
        <tr><td><b>Proyecto</b></td><td>${esc(project.name)}</td></tr>
        <tr><td><b>Obra / edificio</b></td><td>${esc(project.referencia || '—')}</td></tr>
        <tr><td><b>Comparación</b></td><td>${esc(volTitle)}</td></tr>
        <tr><td><b>Sistema</b></td><td>${project.coord_system} · EPSG:${project.srid}</td></tr>
        <tr><td><b>Tamaño de celda</b></td><td>${vol.cell.toFixed(2)} m</td></tr>
        <tr><td><b>Área comparada</b></td><td>${vol.area.toLocaleString('es-VE', { maximumFractionDigits: 1 })} m² (${vol.cellsCompared} celdas)</td></tr>
      </table>
      <h3>Resultados</h3>
      <table>
        <tr><td><b>Corte (excavación)</b></td><td>${fmtM3(vol.cut)}</td></tr>
        <tr><td><b>Relleno</b></td><td>${fmtM3(vol.fill)}</td></tr>
        <tr><td><b>Neto (relleno − corte)</b></td><td>${fmtM3(vol.net)} ${vol.net >= 0 ? '(falta traer material)' : '(sobra material)'}</td></tr>
      </table>
      <p style="color:#555;font-size:11px">Método de rejilla (Σ Δz · área) sobre el TIN de ambas superficies. Corte = terreno que baja; relleno = terreno que sube.</p>`;
    const html = pdfDocument({ title: 'Cubicación', subtitle: project.name, body });
    await exportPdf(html, `Cubicacion - ${project.name}`);
  };

  // ── Fase 5: perfil longitudinal ──────────────────────────────────────────
  const generarPerfil = () => {
    const A = points.find((p) => p.id === profStart), B = points.find((p) => p.id === profEnd);
    if (!A || !B || A.este_m == null || B.este_m == null) { toast.error('Elige punto inicial y final (con coordenadas).'); return; }
    const g = buildGrid(xyz());
    if (!g) { toast.error('Se necesitan al menos 3 puntos con cota.'); return; }
    setProfSamples(profile(g, A.este_m, A.norte_m as number, B.este_m, B.norte_m as number, 100));
  };

  const generarSecciones = () => {
    const A = points.find((p) => p.id === profStart), B = points.find((p) => p.id === profEnd);
    if (!A || !B || A.este_m == null || B.este_m == null) { toast.error('Elige inicio y fin (arriba, en el perfil).'); return; }
    const g = buildGrid(xyz());
    if (!g) { toast.error('Se necesitan al menos 3 puntos con cota.'); return; }
    const sp = Math.max(1, Number(String(secSpacing).replace(',', '.')) || 10);
    const hw = Math.max(1, Number(String(secWidth).replace(',', '.')) || 15);
    const secs = crossSections(g, A.este_m, A.norte_m as number, B.este_m, B.norte_m as number, sp, hw, Math.max(0.5, hw / 20));
    // Desplaza el offset a 0..ancho para el gráfico (que usa distancia≥0).
    setSections(secs.map((s) => ({ station: s.station, samples: s.samples.map((p) => ({ dist: p.offset + hw, z: p.z })) })));
  };

  // ── Fase 5: exportaciones ────────────────────────────────────────────────
  const expPoints = (): ExpPoint[] => points.filter((p) => !p.excluded).map((p) => ({ code: p.code, norte_m: p.norte_m, este_m: p.este_m, cota_z: p.cota_z, lat: p.lat, lon: p.lon, layer: p.layer, is_gcp: p.is_gcp }));
  const baseName = () => (project?.name || 'levantamiento').replace(/\s+/g, '_');
  const notWeb = () => { if (Platform.OS !== 'web') { toast.info('La exportación de archivos está disponible en la versión web.'); return true; } return false; };

  const expDxf = () => { if (notWeb()) return; downloadText(`${baseName()}.dxf`, buildDxf(expPoints(), xyz(), intervalNum()), 'application/dxf'); };
  const expKml = () => { if (notWeb()) return; const c = contours(xyz(), intervalNum(), 19, true).geojson; downloadText(`${baseName()}.kml`, buildKml(project?.name || 'Levantamiento', expPoints(), c), 'application/vnd.google-earth.kml+xml'); };
  const expGeoJson = () => { if (notWeb()) return; const c = contours(xyz(), intervalNum(), 19, true).geojson; downloadText(`${baseName()}.geojson`, buildGeoJson(expPoints(), c), 'application/geo+json'); };
  const expLandXml = () => { if (notWeb()) return; const s = xyz(); if (s.length < 3) { toast.error('Se necesitan al menos 3 puntos con cota.'); return; } downloadText(`${baseName()}.xml`, buildLandXml(project?.name || 'MDT', s), 'application/xml'); };

  const pdfTecnico = async () => {
    if (!project) return;
    const s = xyz();
    let zmin = Infinity, zmax = -Infinity; s.forEach((p) => { if (p.z < zmin) zmin = p.z; if (p.z > zmax) zmax = p.z; });
    const body = `
      <h2>Reporte técnico del levantamiento</h2>
      <table>
        <tr><td><b>Proyecto</b></td><td>${esc(project.name)}</td></tr>
        <tr><td><b>Obra / edificio</b></td><td>${esc(project.referencia || '—')}</td></tr>
        <tr><td><b>Sistema de coordenadas</b></td><td>${project.coord_system} · EPSG:${project.srid}</td></tr>
        <tr><td><b>Tolerancia GPS</b></td><td>${project.gps_tolerance_m} m</td></tr>
        <tr><td><b>Puntos totales</b></td><td>${points.length} (${points.filter((p) => p.is_gcp).length} de control · ${points.filter((p) => p.excluded).length} excluidos)</td></tr>
        <tr><td><b>Puntos con cota</b></td><td>${s.length}${s.length ? ` · cotas ${zmin.toFixed(2)}–${zmax.toFixed(2)} m` : ''}</td></tr>
        <tr><td><b>Versiones de superficie</b></td><td>${surfaces.length}</td></tr>
      </table>
      <p style="color:#555;font-size:11px">Generado por el módulo Geodesta · SOS La Guaira. Coordenadas de trabajo UTM SIRGAS-REGVEN 19N.</p>`;
    const html = pdfDocument({ title: 'Reporte técnico', subtitle: project.name, body });
    await exportPdf(html, `Reporte tecnico - ${project.name}`);
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

      <TouchableOpacity onPress={() => navigation?.navigate?.('GeodestaInspecciones', { projectId, projectName: project?.name, referencia: project?.referencia })} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, marginBottom: spacing.sm }}>
        <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 13 }}>🧭 Inspecciones de terreno de este levantamiento ›</Text>
      </TouchableOpacity>

      {pending > 0 ? (
        <TouchableOpacity onPress={sincronizar} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(217,119,6,0.12)', borderWidth: 1, borderColor: colors.warning, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
          <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 13 }}>📵 {pending} captura(s) sin sincronizar</Text>
          <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 12 }}>🔄 Sincronizar</Text>
        </TouchableOpacity>
      ) : null}

      {/* Pestañas */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
        {(['lista', 'mapa', 'superficie', 'volumen', 'salidas'] as Tab[]).map((t) => (
          <TouchableOpacity key={t} onPress={() => setTab(t)} style={{ flexGrow: 1, minWidth: '18%', paddingVertical: spacing.sm, paddingHorizontal: 4, borderRadius: radius.md, alignItems: 'center', backgroundColor: tab === t ? colors.brand : colors.surface, borderWidth: 1, borderColor: tab === t ? colors.brand : colors.border }}>
            <Text style={{ color: tab === t ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 11 }}>{t === 'lista' ? '📋 Puntos' : t === 'mapa' ? '🗺️ Mapa' : t === 'superficie' ? '⛰️ Superficie' : t === 'volumen' ? '📦 Volumen' : '📤 Salidas'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'salidas' ? (
        <>
          <Card>
            <Text style={{ color: colors.text, fontWeight: '800', marginBottom: 4 }}>📈 Perfil longitudinal</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>Elige el punto inicial y el final; se muestrea la superficie a lo largo de esa línea.</Text>
            <Text style={lbl(colors)}>Inicio</Text>
            <PointPicker points={withNE()} value={profStart} onChange={setProfStart} colors={colors} />
            <Text style={lbl(colors)}>Fin</Text>
            <PointPicker points={withNE()} value={profEnd} onChange={setProfEnd} colors={colors} />
            <TouchableOpacity onPress={generarPerfil} style={{ marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
              <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 13 }}>📈 Generar perfil</Text>
            </TouchableOpacity>
          </Card>
          {profSamples ? <><View style={{ height: spacing.sm }} /><ProfileChart samples={profSamples} height={260} /></> : null}

          <View style={{ height: spacing.md }} />
          <Card>
            <Text style={{ color: colors.text, fontWeight: '800', marginBottom: 4 }}>✂️ Secciones transversales</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>A lo largo del mismo eje (inicio→fin de arriba), cada cierto espaciamiento se corta una sección perpendicular.</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}><Text style={lbl(colors)}>Espaciamiento (m)</Text><TextInput value={secSpacing} onChangeText={setSecSpacing} keyboardType="decimal-pad" style={input} /></View>
              <View style={{ flex: 1 }}><Text style={lbl(colors)}>Semiancho (± m)</Text><TextInput value={secWidth} onChangeText={setSecWidth} keyboardType="decimal-pad" style={input} /></View>
            </View>
            <TouchableOpacity onPress={generarSecciones} style={{ marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
              <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 13 }}>✂️ Generar secciones</Text>
            </TouchableOpacity>
          </Card>
          {sections?.length ? (
            <>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>{sections.length} sección(es) · eje (offset 0 = borde izquierdo, centro = eje)</Text>
              {sections.map((s, i) => (
                <View key={i} style={{ marginBottom: spacing.sm }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12, marginBottom: 2 }}>Estación {s.station.toFixed(1)} m</Text>
                  <ProfileChart samples={s.samples} height={160} />
                </View>
              ))}
            </>
          ) : null}

          <View style={{ height: spacing.md }} />
          <Card>
            <Text style={{ color: colors.text, fontWeight: '800', marginBottom: 4 }}>📤 Exportar</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>Puntos en UTM (E,N,Z) para CAD y las curvas al intervalo de la pestaña ⛰️ Superficie ({interval} m).</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {[['📐 DXF (AutoCAD)', expDxf], ['🌍 KML (Google Earth)', expKml], ['🗺️ GeoJSON (GIS/SHP)', expGeoJson], ['🏗️ LandXML (proyecto/máquina)', expLandXml]].map(([label, fn]) => (
                <TouchableOpacity key={label as string} onPress={fn as any} style={{ flexGrow: 1, minWidth: '46%', borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                  <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 12 }}>{label as string}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 6 }}>GeoJSON se importa en QGIS/ArcGIS y se guarda como Shapefile o GeoPackage. LandXML lleva la superficie TIN al proyectista y al guiado de maquinaria (Trimble/Topcon/Leica).</Text>
          </Card>

          <View style={{ height: spacing.md }} />
          <TouchableOpacity onPress={pdfTecnico} style={{ backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
            <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>📄 Reporte técnico PDF</Text>
          </TouchableOpacity>
          <View style={{ height: spacing.lg }} />
        </>
      ) : tab === 'volumen' ? (
        <>
          <Card>
            <Text style={{ color: colors.text, fontWeight: '800', marginBottom: 4 }}>📦 Cubicación (corte / relleno)</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>Compara dos superficies (avance entre fechas) o una superficie contra una cota de diseño. El resultado sale en m³ y como mapa de diferencias.</Text>
            <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
              {(['versiones', 'nivel'] as const).map((m) => (
                <TouchableOpacity key={m} onPress={() => { setVolMode(m); setVol(null); }} style={{ flex: 1, paddingVertical: 8, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: volMode === m ? colors.brand : colors.border, backgroundColor: volMode === m ? colors.brand : colors.surface }}>
                  <Text style={{ color: volMode === m ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{m === 'versiones' ? 'Entre versiones' : 'Contra nivel'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={lbl(colors)}>Superficie base {volMode === 'versiones' ? '(terreno natural / fecha 1)' : ''}</Text>
            <SurfPicker surfaces={surfaces} value={baseSurf} onChange={setBaseSurf} includeActual colors={colors} />
            {volMode === 'versiones' ? (
              <>
                <Text style={lbl(colors)}>Superficie nueva (proyecto / fecha 2)</Text>
                <SurfPicker surfaces={surfaces} value={newSurf} onChange={setNewSurf} includeActual colors={colors} />
              </>
            ) : (
              <>
                <Text style={lbl(colors)}>Cota de diseño / nivel (m)</Text>
                <TextInput value={designLevel} onChangeText={setDesignLevel} keyboardType="numbers-and-punctuation" placeholder="Ej. 12.5" placeholderTextColor={colors.muted} style={input} />
              </>
            )}
            <TouchableOpacity onPress={calcularVolumen} style={{ marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
              <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 13 }}>📐 Calcular volumen</Text>
            </TouchableOpacity>
          </Card>
          {vol && vol.ok ? (
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{volTitle}</Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
                <View style={{ flex: 1, backgroundColor: 'rgba(220,38,38,0.10)', borderRadius: radius.md, padding: spacing.sm }}>
                  <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '800' }}>CORTE</Text>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{fmtM3(vol.cut)}</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: 'rgba(37,99,235,0.10)', borderRadius: radius.md, padding: spacing.sm }}>
                  <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '800' }}>RELLENO</Text>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{fmtM3(vol.fill)}</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm }}>
                  <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>NETO</Text>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{fmtM3(vol.net)}</Text>
                </View>
              </View>
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 6 }}>Área {vol.area.toLocaleString('es-VE', { maximumFractionDigits: 0 })} m² · celda {vol.cell.toFixed(2)} m · neto {vol.net >= 0 ? 'falta traer' : 'sobra'} material.</Text>
              <TouchableOpacity onPress={pdfVolumen} style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                <Text style={{ color: colors.brand, fontWeight: '800', fontSize: 13 }}>📄 Reporte PDF de cubicación</Text>
              </TouchableOpacity>
            </Card>
          ) : null}
          <View style={{ height: spacing.sm }} />
          <GeodestaMap points={mapPoints} overlay={vol?.geojson ?? overlay} height={380} />
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>🟥 corte · 🟦 relleno · intensidad = magnitud del movimiento.</Text>
          <View style={{ height: spacing.lg }} />
        </>
      ) : tab === 'superficie' ? (
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
                <TouchableOpacity onPress={() => { setOverlay(null); setActiveSurf(null); setSurfInfo(null); setSlopeOn(false); }} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, alignItems: 'center' }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Limpiar</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <TouchableOpacity onPress={verPendientes} style={{ marginTop: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>🌡️ Mapa de calor de pendientes</Text>
            </TouchableOpacity>
            {surfInfo ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>{surfInfo}</Text> : null}
            {slopeOn ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                {[['0–5%', 'rgba(22,163,74,0.9)'], ['5–15%', 'rgba(132,204,22,0.9)'], ['15–30%', 'rgba(217,119,6,0.95)'], ['30–50%', 'rgba(234,88,12,0.95)'], ['>50%', 'rgba(220,38,38,1)']].map(([l, c]) => (
                  <View key={l} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: c }} />
                    <Text style={{ color: colors.muted, fontSize: 11 }}>{l}</Text>
                  </View>
                ))}
              </View>
            ) : null}
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
const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const lbl = (colors: any) => ({ color: colors.muted, fontSize: 11, marginTop: 6, marginBottom: 3 } as const);

function PointPicker({ points, value, onChange, colors }: { points: GeodestaPoint[]; value: string | null; onChange: (id: string) => void; colors: any }) {
  if (!points.length) return <Text style={{ color: colors.muted, fontSize: 12 }}>No hay puntos con coordenadas.</Text>;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 2 }}>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {points.map((p) => (
          <TouchableOpacity key={p.id} onPress={() => onChange(p.id)} style={{ paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: value === p.id ? colors.brand : colors.border, backgroundColor: value === p.id ? colors.brand : colors.surface }}>
            <Text style={{ color: value === p.id ? colors.brandContrast : colors.text, fontSize: 12, fontWeight: '700' }}>{p.code || 'pt'}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

function SurfPicker({ surfaces, value, onChange, includeActual, colors }: { surfaces: Surface[]; value: string | null; onChange: (id: string) => void; includeActual?: boolean; colors: any }) {
  const opts: { id: string; label: string }[] = [];
  if (includeActual) opts.push({ id: 'actual', label: '📍 Puntos actuales' });
  surfaces.forEach((s) => opts.push({ id: s.id, label: s.name }));
  if (!opts.length) return <Text style={{ color: colors.muted, fontSize: 12 }}>Guarda al menos una versión de superficie en la pestaña ⛰️ Superficie.</Text>;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 2 }}>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {opts.map((o) => (
          <TouchableOpacity key={o.id} onPress={() => onChange(o.id)} style={{ paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: value === o.id ? colors.brand : colors.border, backgroundColor: value === o.id ? colors.brand : colors.surface }}>
            <Text style={{ color: value === o.id ? colors.brandContrast : colors.text, fontSize: 12, fontWeight: '700' }}>{o.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

function Chip({ children, colors }: { children: React.ReactNode; colors: any }) {
  return (
    <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 }}>
      <Text style={{ color: colors.text, fontSize: 11, fontWeight: '600' }}>{children}</Text>
    </View>
  );
}
