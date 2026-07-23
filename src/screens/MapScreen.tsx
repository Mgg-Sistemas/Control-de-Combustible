import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, Dimensions, TextInput, Alert } from 'react-native';
import { Screen, Card, SectionTitle, Loading, EmptyState } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { VenezuelaMap, MapPin, companyLegend, MAP_ZONES } from '../components/VenezuelaMap';
import { supabase } from '../lib/supabase';
import { elapsedSince } from '../lib/time';
import { formatUTM } from '../lib/utm';
import { equipCategory } from '../lib/equipos';
import { cmpText } from '../lib/text';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { useConfirm } from '../components/ConfirmProvider';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

// Capas del mapa: una por TIPO ESPECÍFICO de equipo (JUMBO, PAYLOADER, TRACTORES…),
// EXACTAMENTE igual que el "Conteo de equipos" (usa la misma clasificación).
const CAT_OTHER_KEY = '—';
// Las CAMIONETAS PICK-UP no llevan pin fijo: están en constante movimiento (todas las
// zonas) y se ubican por su ENCARGADO. No cuentan como "faltan por ubicar".
const CAMIONETA_CAT = 'CAMIONETA PICK-UP';
/** Tipo (categoría fina) de una máquina, igual que en el conteo. */
function catOf(p: MapPin): string {
  return equipCategory(p.name) || CAT_OTHER_KEY;
}
/** Ícono por tipo (aproximado por palabras clave; si no calza → 🔧). */
function iconFor(cat: string): string {
  const c = cat.toLowerCase();
  if (c.includes('grúa') || c.includes('grua')) return '🏗️';
  if (c.includes('retro') || c.includes('excavad') || c.includes('jumbo') || c.includes('martillo')) return '⛏️';
  if (c.includes('payloader') || c.includes('cargador') || c.includes('tractor') || c.includes('bulldozer') || c.includes('nivelad')) return '🚜';
  if (c.includes('camión') || c.includes('camion') || c.includes('chuto') || c.includes('cisterna') || c.includes('tanque') || c.includes('camioneta') || c.includes('autobus')) return '🚛';
  return '🔧';
}

type TraceRow = { id: string; machinery_id: string; code: string; company: string; plate: string | null; serial: string | null; note: string | null; latitude: number | null; longitude: number | null; recorded_at: string; recorded_by: string | null };
type RoutePoint = { id: string; latitude: number | null; longitude: number | null; note: string | null; recorded_at: string };

function fmt(ts: string): string {
  try {
    return new Date(ts).toLocaleString('es-VE', { timeZone: 'America/Caracas' });
  } catch {
    return ts;
  }
}

/** Texto "Placa: X · Serial: Y" (omite el que falte). */
function placaSerial(plate?: string | null, serial?: string | null): string {
  const parts: string[] = [];
  if (plate) parts.push(`Placa: ${plate}`);
  if (serial) parts.push(`Serial: ${serial}`);
  return parts.join(' · ');
}

export default function MapScreen({ navigation, route }: any) {
  const { colors } = useTheme();
  const confirm = useConfirm();
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const [pins, setPins] = useState<MapPin[] | null>(null);
  const [refBusy, setRefBusy] = useState(false); // generando el PDF de "Referencias"
  const [trace, setTrace] = useState<TraceRow[]>([]);
  const [recorderNames, setRecorderNames] = useState<Record<string, string>>({}); // uid → nombre (monitoreo)
  const [monitorOpen, setMonitorOpen] = useState(false);
  // Enfoque: ver SOLO una máquina en el mapa (o todas si es null).
  const [focus, setFocus] = useState<{ id: string; code: string } | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  // Ruta de una máquina (al tocar un registro): puntos por fecha y hora.
  const [routeFor, setRouteFor] = useState<{ code: string; company: string; plate: string | null; serial: string | null } | null>(null);
  const [routePoints, setRoutePoints] = useState<RoutePoint[] | null>(null);
  // Capas: categorías y máquinas apagadas (ocultas del mapa).
  const [hiddenCats, setHiddenCats] = useState<Set<string>>(new Set());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [layersOpen, setLayersOpen] = useState(false);
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  // Leyenda de empresa y zonas: ahora viven FUERA del mapa (controlan el mapa por postMessage).
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [zonesOn, setZonesOn] = useState<Set<number>>(new Set());
  const [legendOpen, setLegendOpen] = useState(false);
  const [zonesOpen, setZonesOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false); // mapa en pantalla completa
  // Reubicación de SECTORES (solo admin): desfase guardado por sector + modo arrastrar.
  const [zoneOffsets, setZoneOffsets] = useState<Record<string, { d_lat: number; d_lng: number }>>({});
  const [zoneEdit, setZoneEdit] = useState(false);
  const toggleZone = (i: number) => setZonesOn((prev) => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });
  // TODAS las máquinas (incluidas las SIN ubicar): para el conteo "ubicadas/total"
  // de las capas y para el selector de la ubicación manual (solo admin).
  const [allMachines, setAllMachines] = useState<{ id: string; code: string; located: boolean; plate: string | null; serial: string | null; company: string; encargado: string | null; referencia: string | null }[]>([]);
  // Ubicación manual (solo admin): máquina elegida + modo "tocar el mapa".
  const [locateFor, setLocateFor] = useState<{ id: string; code: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const load = React.useCallback(async () => {
    const { data: machines } = await supabase
      .from('machinery')
      .select('id, code, tipo, clasificacion, plate, serial, latitude, longitude, location_at, operational, company:company_id(name)')
      .not('latitude', 'is', null);
    const { data: history } = await supabase
      .from('machinery_locations')
      .select('machinery_id, latitude, longitude, recorded_at')
      .order('recorded_at', { ascending: true });

    const routes = new Map<string, [number, number][]>();
    (history ?? []).forEach((h: any) => {
      if (h.latitude == null || h.longitude == null) return; // ignora eventos sin coordenadas
      const arr = routes.get(h.machinery_id) ?? [];
      arr.push([Number(h.latitude), Number(h.longitude)]);
      routes.set(h.machinery_id, arr);
    });

    const built: MapPin[] = (machines ?? []).map((m: any) => ({
      id: m.id,
      name: m.code,
      lat: Number(m.latitude),
      lng: Number(m.longitude),
      active: elapsedSince(m.location_at),
      operational: m.operational,
      company: m.company?.name ?? 'Sin empresa',
      tipo: m.tipo ?? null,
      clasificacion: m.clasificacion ?? null,
      plate: m.plate ?? null,
      serial: m.serial ?? null,
      utm: formatUTM(Number(m.latitude), Number(m.longitude)),
      route: routes.get(m.id) ?? [],
    }));
    setPins(built);

    // TODAS las máquinas (con y sin ubicación): para el conteo "ubicadas/total" y para
    // LISTAR las que faltan por ubicar con su placa/serial y empresa.
    const { data: every } = await supabase.from('machinery').select('id, code, plate, serial, latitude, encargado, referencia, company:company_id(name)');
    setAllMachines((every ?? []).map((m: any) => ({
      id: m.id, code: m.code ?? '', located: m.latitude != null,
      plate: m.plate ?? null, serial: m.serial ?? null, company: m.company?.name ?? 'Sin empresa',
      encargado: m.encargado ?? null, referencia: m.referencia ?? null,
    })));

    // Trazabilidad reciente (incluye los eventos con nota, p. ej. eliminaciones manuales).
    const { data: tr } = await supabase
      .from('machinery_locations')
      .select('id, machinery_id, note, latitude, longitude, recorded_at, recorded_by, machinery:machinery_id(code, plate, serial, company:company_id(name))')
      .order('recorded_at', { ascending: false })
      .limit(80);
    setTrace(
      (tr ?? []).map((r: any) => ({
        id: r.id,
        machinery_id: r.machinery_id,
        code: r.machinery?.code ?? '—',
        company: r.machinery?.company?.name ?? 'Sin empresa',
        plate: r.machinery?.plate ?? null,
        serial: r.machinery?.serial ?? null,
        note: r.note,
        latitude: r.latitude,
        longitude: r.longitude,
        recorded_at: r.recorded_at,
        recorded_by: r.recorded_by ?? null,
      }))
    );
  }, []);

  // Reporte "Referencias": las máquinas a las que un inspector le puso una referencia
  // de ubicación (edificio, parque, plaza, calle…) al marcar su ubicación. Sale el
  // nombre de la máquina, su placa/serial, la referencia y la empresa.
  const referenciasPdf = async () => {
    const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rows = allMachines
      .filter((m) => (m.referencia ?? '').trim())
      .sort((a, b) => cmpText(a.code, b.code));
    if (rows.length === 0) {
      Alert.alert('Referencias', 'Todavía no hay máquinas con referencia. Los inspectores la colocan al marcar la ubicación de la máquina.');
      return;
    }
    setRefBusy(true);
    try {
      const body = rows.map((m) =>
        `<tr><td>${esc(m.code)}</td><td>${esc(placaSerial(m.plate, m.serial) || '—')}</td><td>${esc(m.referencia)}</td><td>${esc(m.company)}</td></tr>`
      ).join('');
      const html = pdfDocument({
        title: 'Referencias de ubicación',
        subtitle: `${rows.length} máquina(s) con referencia`,
        extraCss: `table{width:100%;border-collapse:collapse;font-size:11px}
          th,td{border:1px solid #ccc;padding:5px 8px;text-align:left;vertical-align:top} th{background:#1E3A5F;color:#fff}
          tr:nth-child(even) td{background:#F3F4F6}`,
        body: `<table><thead><tr><th>Máquina</th><th>Placa / Serial</th><th>Referencia</th><th>Empresa</th></tr></thead><tbody>${body}</tbody></table>`,
      });
      await exportPdf(html, 'Referencias de ubicacion');
    } finally {
      setRefBusy(false);
    }
  };

  // Nombres de quienes colocan ubicaciones (para el monitoreo del admin).
  useEffect(() => {
    supabase.from('profiles').select('id, full_name').then(({ data }) => {
      const m: Record<string, string> = {}; (data ?? []).forEach((p: any) => { if (p.full_name) m[p.id] = p.full_name; }); setRecorderNames(m);
    });
  }, []);
  const recorderName = React.useCallback((uid: string | null) => (uid ? (recorderNames[uid] ?? 'Operador (QR)') : '—'), [recorderNames]);

  useEffect(() => {
    load();
    // Sincronización multiusuario: refresca los pines al cambiar ubicaciones/máquinas.
    let timer: any;
    const bump = () => { clearTimeout(timer); timer = setTimeout(load, 300); };
    const ch = supabase.channel('rt-map');
    ['machinery', 'machinery_locations'].forEach((t) =>
      ch.on('postgres_changes' as any, { event: '*', schema: 'public', table: t }, bump)
    );
    ch.subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(ch); };
  }, [load]);

  // Elimina la ubicación de una máquina: la limpia (se sincroniza a todos) y deja
  // constancia en la trazabilidad con la nota "Ubicación eliminada manualmente".
  const deleteLocation = React.useCallback(
    async (id: string, name?: string) => {
      const ok = await confirm({
        title: 'Eliminar ubicación',
        message: `¿Eliminar la ubicación${name ? ` de ${name}` : ''} del mapa? Se registrará en la trazabilidad como "Ubicación eliminada manualmente".`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        danger: true,
      });
      if (!ok) return;
      await supabase.from('machinery').update({ latitude: null, longitude: null, location_at: null }).eq('id', id);
      await supabase.from('machinery_locations').insert({ machinery_id: id, note: 'Ubicación eliminada manualmente' });
      load();
    },
    [confirm, load]
  );

  // Enfoca UNA máquina en el mapa (ver solo esa) y sube hasta el mapa.
  const focusMachine = React.useCallback((t: TraceRow) => {
    setFocus({ id: t.machinery_id, code: t.code });
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, []);

  // Abre la RUTA de una máquina (todos sus registros de ubicación, por fecha/hora).
  const openRoute = React.useCallback(async (t: TraceRow) => {
    setRouteFor({ code: t.code, company: t.company, plate: t.plate, serial: t.serial });
    setRoutePoints(null);
    // Ubicamos la máquina por su registro (para traer TODO su historial).
    const { data: base } = await supabase
      .from('machinery_locations')
      .select('machinery_id')
      .eq('id', t.id)
      .maybeSingle();
    const machId = (base as any)?.machinery_id;
    if (!machId) { setRoutePoints([]); return; }
    const { data } = await supabase
      .from('machinery_locations')
      .select('id, latitude, longitude, note, recorded_at')
      .eq('machinery_id', machId)
      .order('recorded_at', { ascending: false })
      .limit(500);
    setRoutePoints((data ?? []) as RoutePoint[]);
  }, []);

  // Ubicación MANUAL (solo admin): coloca la máquina elegida en el punto tocado.
  const placeManual = React.useCallback(async (lat: number, lng: number) => {
    if (!locateFor || !isFinite(lat) || !isFinite(lng)) return;
    const ok = await confirm({
      title: 'Ubicar máquina',
      message: `¿Colocar ${locateFor.code} en este punto del mapa?\n${lat.toFixed(6)}, ${lng.toFixed(6)}`,
      confirmText: 'Ubicar aquí',
      cancelText: 'Cancelar',
    });
    if (!ok) return;
    const { error } = await supabase.rpc('update_machine_location', { p_id: locateFor.id, p_lat: Number(lat.toFixed(6)), p_lng: Number(lng.toFixed(6)) });
    if (error) { setNotice(`⚠️ No se pudo ubicar: ${error.message}`); return; }
    setNotice(`✅ ${locateFor.code} ubicada en el mapa.`);
    setLocateFor(null);
    load();
  }, [locateFor, confirm, load]);

  // Carga los desfases guardados de los sectores (para dibujarlos donde el admin los dejó).
  const loadZoneOffsets = React.useCallback(async () => {
    const { data } = await supabase.from('map_zone_offsets').select('zone_name, d_lat, d_lng');
    const m: Record<string, { d_lat: number; d_lng: number }> = {};
    (data ?? []).forEach((r: any) => { m[r.zone_name] = { d_lat: Number(r.d_lat) || 0, d_lng: Number(r.d_lng) || 0 }; });
    setZoneOffsets(m);
  }, []);
  useEffect(() => { loadZoneOffsets(); }, [loadZoneOffsets]);

  // Guarda (solo admin) el desfase de un sector cuando el admin lo arrastra.
  const saveZoneOffset = React.useCallback(async (name: string, dLat: number, dLng: number) => {
    if (!name || !isFinite(dLat) || !isFinite(dLng)) return;
    setZoneOffsets((prev) => ({ ...prev, [name]: { d_lat: dLat, d_lng: dLng } }));
    const { error } = await supabase.from('map_zone_offsets').upsert(
      { zone_name: name, d_lat: dLat, d_lng: dLng, updated_at: new Date().toISOString() },
      { onConflict: 'zone_name' }
    );
    if (error) setNotice(`⚠️ No se pudo guardar la posición del sector: ${error.message}`);
    else setNotice(`✅ Sector "${name}" reubicado.`);
  }, []);

  // Web: el popup del mapa (iframe) avisa por postMessage al pulsar "Eliminar ubicación",
  // o el punto tocado en el mapa cuando el admin está en modo "ubicar manualmente".
  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const h = (e: any) => {
      if (e?.data?.type === 'map-delete-pin' && e.data.id) deleteLocation(e.data.id, e.data.name);
      else if (e?.data?.type === 'map-fullscreen') setFullscreen(true);
      else if (e?.data?.type === 'map-picked' && isAdmin) placeManual(Number(e.data.lat), Number(e.data.lng));
      else if (e?.data?.type === 'map-zone-moved' && isAdmin) saveZoneOffset(e.data.name, Number(e.data.d_lat), Number(e.data.d_lng));
    };
    window.addEventListener('message', h);
    return () => window.removeEventListener('message', h);
  }, [deleteLocation, placeManual, saveZoneOffset, isAdmin]);

  // Al entrar desde el catálogo ("Ver en mapa"), enfocar SOLO esa máquina.
  // Se consume el parámetro para poder volver a enfocar la misma más tarde.
  useEffect(() => {
    const f = route?.params?.focus;
    if (f?.id) {
      setFocus({ id: f.id, code: f.code ?? '' });
      navigation?.setParams?.({ focus: undefined });
    }
  }, [route?.params?.focus]);

  // Categoría de cada máquina y agrupación (para las capas).
  const pinCat = useMemo(() => {
    const m = new Map<string, string>();
    (pins ?? []).forEach((p) => m.set(p.id, catOf(p)));
    return m;
  }, [pins]);
  const groups = useMemo(() => {
    const g = new Map<string, MapPin[]>();
    (pins ?? []).forEach((p) => {
      const k = pinCat.get(p.id) ?? CAT_OTHER_KEY;
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(p);
    });
    g.forEach((arr) => arr.sort((a, b) => (a.name || '').localeCompare(b.name || '')));
    return g;
  }, [pins, pinCat]);
  // Tipos presentes (UNIÓN de los ubicados y de TODOS los del catálogo), en orden
  // ALFABÉTICO. Así aparecen también los tipos con máquinas SIN ubicar (p. ej. las
  // camionetas pick-up, que no llevan pin) para poder verlas y saber cuáles faltan.
  const presentCats = useMemo(() => {
    const s = new Set<string>(groups.keys());
    allMachines.forEach((a) => s.add(equipCategory(a.code) || CAT_OTHER_KEY));
    return [...s].sort((a, b) => a.localeCompare(b, 'es'));
  }, [groups, allMachines]);
  // Camionetas pick-up del catálogo (con su encargado), para listarlas como "asignadas".
  const camionetas = useMemo(
    () => allMachines.filter((a) => (equipCategory(a.code) || CAT_OTHER_KEY) === CAMIONETA_CAT).sort((a, b) => a.code.localeCompare(b.code, 'es')),
    [allMachines]
  );

  // Total de máquinas por categoría (incluye las SIN ubicar) → para "ubicadas/total".
  const catTotal = useMemo(() => {
    const m = new Map<string, number>();
    allMachines.forEach((a) => { const k = equipCategory(a.code) || CAT_OTHER_KEY; m.set(k, (m.get(k) ?? 0) + 1); });
    return m;
  }, [allMachines]);
  // El resumen "ubicadas/faltan" es SOLO de las que sí llevan pin (excluye camionetas,
  // que van por encargado y no se "ubican").
  const locatable = useMemo(() => allMachines.filter((a) => (equipCategory(a.code) || CAT_OTHER_KEY) !== CAMIONETA_CAT), [allMachines]);
  const totalMachines = locatable.length;
  const totalLocated = locatable.filter((a) => a.located).length;
  const totalPending = Math.max(0, totalMachines - totalLocated);
  // Máquinas SIN ubicar, agrupadas por categoría (para listarlas en rojo por tipo).
  // Excluye camionetas (no aplican a "faltan por ubicar").
  const missingByCat = useMemo(() => {
    const m = new Map<string, typeof allMachines>();
    allMachines.filter((a) => !a.located && (equipCategory(a.code) || CAT_OTHER_KEY) !== CAMIONETA_CAT).forEach((a) => {
      const k = equipCategory(a.code) || CAT_OTHER_KEY;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(a);
    });
    m.forEach((arr) => arr.sort((a, b) => a.code.localeCompare(b.code, 'es')));
    return m;
  }, [allMachines]);
  // Máquinas para el selector de ubicación manual: primero las SIN ubicar.
  const pickerList = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return allMachines
      .filter((a) => !q || a.code.toLowerCase().includes(q))
      .sort((a, b) => (a.located === b.located ? a.code.localeCompare(b.code, 'es') : a.located ? 1 : -1));
  }, [allMachines, pickerQuery]);

  const isMachineShown = (p: MapPin) => !hiddenCats.has(pinCat.get(p.id) ?? CAT_OTHER_KEY) && !hiddenIds.has(p.id);
  // El mapa muestra: la enfocada (si hay), o las que pasan el filtro de capas.
  const shownPins = pins === null ? null : (focus ? pins.filter((p) => p.id === focus.id) : (pins ?? []).filter(isMachineShown));

  const toggleCat = (k: string) => setHiddenCats((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleId = (id: string) => setHiddenIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const showAll = () => { setHiddenCats(new Set()); setHiddenIds(new Set()); };
  const hideAll = () => { setHiddenCats(new Set(presentCats)); };

  return (
    <Screen scrollRef={scrollRef}>
      <ConfigBanner />
      <SectionTitle>Mapa de máquinas</SectionTitle>

      {/* Banner de enfoque: viendo solo una máquina · volver a todas. */}
      {focus ? (
        <TouchableOpacity onPress={() => setFocus(null)} activeOpacity={0.8}>
          <Card style={{ borderColor: colors.primary, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: colors.text, fontWeight: '700', flex: 1 }}>🔎 Viendo solo: {focus.code}</Text>
            <Text style={{ color: colors.primary, fontWeight: '800' }}>← Ver todas las ubicaciones</Text>
          </Card>
        </TouchableOpacity>
      ) : null}

      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
          <Text style={{ color: colors.success, fontSize: 12 }}>● Operativa</Text>
          <Text style={{ color: colors.danger, fontSize: 12 }}>● No operativa</Text>
          <Text style={{ color: '#2563EB', fontSize: 12 }}>— Ruta</Text>
        </View>
        <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
          Toca un punto y usa “🗑️ Eliminar ubicación” para quitarlo del mapa. Se sincroniza con todos.
        </Text>
      </Card>

      {/* Reporte de REFERENCIAS: el punto de referencia (edificio, parque, plaza,
          calle) que el inspector le pone a cada máquina al marcar su ubicación. */}
      <TouchableOpacity onPress={referenciasPdf} disabled={refBusy} activeOpacity={0.85}>
        <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, paddingRight: spacing.sm }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>📄 Referencias</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>Máquina, placa/serial y la referencia que puso el inspector (edificio, parque, plaza, calle)</Text>
          </View>
          <Text style={{ color: colors.primary, fontWeight: '800' }}>{refBusy ? '…' : 'PDF ›'}</Text>
        </Card>
      </TouchableOpacity>

      {/* Capas: prender/apagar puntos por categoría (camiones, grúas…) o por máquina. */}
      {!focus && pins && pins.length > 0 ? (
        <Card>
          <TouchableOpacity onPress={() => setLayersOpen((v) => !v)} activeOpacity={0.8} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: colors.text, fontWeight: '800' }}>🗂️ Capas · mostrar / ocultar</Text>
            <Text style={{ color: colors.primary, fontWeight: '800' }}>{layersOpen ? '▲' : `▼  (${shownPins?.length ?? 0}/${pins.length})`}</Text>
          </TouchableOpacity>

          {layersOpen ? (
            <View style={{ marginTop: spacing.sm }}>
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
                <TouchableOpacity onPress={showAll} style={{ flex: 1, paddingVertical: 8, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>✅ Mostrar todas</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={hideAll} style={{ flex: 1, paddingVertical: 8, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>🚫 Ocultar todas</Text>
                </TouchableOpacity>
              </View>

              {/* Resumen: cuántas máquinas están ubicadas del total (pendientes por ubicar). */}
              {totalMachines > 0 ? (
                <Text style={{ color: colors.text, fontSize: 12, fontWeight: '800', marginBottom: spacing.sm }}>
                  📍 Ubicadas: {totalLocated}/{totalMachines}
                  {totalPending ? <Text style={{ color: colors.danger }}>  ·  faltan {totalPending} por ubicar</Text> : null}
                </Text>
              ) : null}

              {presentCats.map((k) => {
                const list = groups.get(k) ?? [];
                const catHidden = hiddenCats.has(k);
                const shownInCat = catHidden ? 0 : list.filter((p) => !hiddenIds.has(p.id)).length;
                const meta = { icon: iconFor(k), label: k };
                const expanded = expandedCat === k;
                const isCam = k === CAMIONETA_CAT;
                return (
                  <View key={k} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                      {/* Interruptor de la categoría */}
                      <TouchableOpacity onPress={() => toggleCat(k)} style={{ width: 34, height: 22, borderRadius: 11, backgroundColor: catHidden ? colors.border : colors.success, justifyContent: 'center', paddingHorizontal: 2 }}>
                        <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', alignSelf: catHidden ? 'flex-start' : 'flex-end' }} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setExpandedCat(expanded ? null : k)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{isCam ? '🚙' : meta.icon} {meta.label}</Text>
                        {(() => {
                          const total = catTotal.get(k) ?? list.length; // total de esa categoría (con y sin ubicar)
                          // Camionetas: no se "ubican" (van por encargado, todas las zonas).
                          if (isCam) {
                            return <Text style={{ color: colors.muted, fontSize: 12 }}>🚙 {total} asignada{total === 1 ? '' : 's'}  {expanded ? '▲' : '▼'}</Text>;
                          }
                          const pend = Math.max(0, total - list.length); // list = ubicadas de la categoría
                          return (
                            <Text style={{ color: colors.muted, fontSize: 12 }}>
                              📍 {list.length}/{total}{pend ? <Text style={{ color: colors.danger }}> · faltan {pend}</Text> : null}  {expanded ? '▲' : '▼'}
                            </Text>
                          );
                        })()}
                      </TouchableOpacity>
                    </View>

                    {/* CAMIONETAS PICK-UP: no llevan pin. Se listan como ASIGNADAS a su
                        encargado y en constante movimiento (abarcan todas las zonas). */}
                    {expanded && isCam ? (
                      <View style={{ marginTop: 6, paddingLeft: 42 }}>
                        <Text style={{ color: '#2563EB', fontSize: 11, fontWeight: '800', marginBottom: 3 }}>🚙 En constante movimiento · abarcan TODAS las zonas · se ubican por su encargado</Text>
                        {camionetas.map((a) => {
                          const ps = placaSerial(a.plate, a.serial);
                          return (
                            <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 5 }}>
                              <Text style={{ fontSize: 15 }}>🚙</Text>
                              <View style={{ flex: 1 }}>
                                <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{a.code}</Text>
                                <Text style={{ color: '#2563EB', fontSize: 11, fontWeight: '700' }}>👤 Encargado: {a.encargado || 'Sin asignar'}</Text>
                                {ps ? <Text style={{ color: colors.muted, fontSize: 11 }}>🔖 {ps}</Text> : null}
                              </View>
                              <Text style={{ color: colors.muted, fontSize: 11, maxWidth: 120 }} numberOfLines={2}>{a.company}</Text>
                            </View>
                          );
                        })}
                        {camionetas.length === 0 ? <Text style={{ color: colors.muted, fontSize: 12 }}>Sin camionetas en el catálogo.</Text> : null}
                      </View>
                    ) : expanded ? (
                      <View style={{ marginTop: 6, paddingLeft: 42 }}>
                        {list.map((p) => {
                          const off = catHidden || hiddenIds.has(p.id);
                          const ps = placaSerial(p.plate, p.serial);
                          return (
                            <TouchableOpacity key={p.id} onPress={() => toggleId(p.id)} disabled={catHidden} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 5, opacity: catHidden ? 0.4 : 1 }}>
                              <Text style={{ fontSize: 15 }}>{off ? '⬜' : '✅'}</Text>
                              <View style={{ flex: 1 }}>
                                <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{p.name}</Text>
                                {ps ? <Text style={{ color: colors.muted, fontSize: 11 }}>🔖 {ps}</Text> : null}
                              </View>
                              <Text style={{ color: colors.muted, fontSize: 11, maxWidth: 120 }} numberOfLines={2}>{p.company}</Text>
                            </TouchableOpacity>
                          );
                        })}

                        {(() => {
                          const miss = missingByCat.get(k) ?? [];
                          if (miss.length === 0) return null;
                          return (
                            <View style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 6 }}>
                              <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '800', marginBottom: 3 }}>⛔ Faltan por ubicar ({miss.length})</Text>
                              {miss.map((a) => {
                                const ps = placaSerial(a.plate, a.serial);
                                return (
                                  <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 5 }}>
                                    <Text style={{ fontSize: 15 }}>📍</Text>
                                    <View style={{ flex: 1 }}>
                                      <Text style={{ color: colors.danger, fontSize: 13, fontWeight: '800' }}>{a.code}</Text>
                                      {ps ? <Text style={{ color: colors.danger, fontSize: 11 }}>🔖 {ps}</Text> : null}
                                    </View>
                                    <Text style={{ color: colors.danger, fontSize: 11, maxWidth: 120 }} numberOfLines={2}>{a.company}</Text>
                                  </View>
                                );
                              })}
                            </View>
                          );
                        })()}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : null}
        </Card>
      ) : null}

      {shownPins === null ? <Loading /> : shownPins.length === 0 ? (
        <Card><Text style={{ color: colors.muted }}>{focus ? 'Esta máquina no tiene una ubicación actual en el mapa.' : 'No hay puntos visibles. Revisa las 🗂️ Capas (quizás están todas ocultas).'}</Text></Card>
      ) : (
        <>
          <TouchableOpacity
            onPress={() => setFullscreen(true)}
            activeOpacity={0.85}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, marginBottom: spacing.sm }}
          >
            <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>⛶ Ver el mapa en pantalla completa</Text>
          </TouchableOpacity>

          {/* Ubicación MANUAL — solo administradores pueden reubicar máquinas. */}
          {isAdmin && !focus ? (
            <Card style={locateFor ? { borderColor: '#D97706', borderWidth: 1 } : undefined}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>📍 Ubicar manualmente (admin)</Text>
                {locateFor ? (
                  <TouchableOpacity onPress={() => { setLocateFor(null); setNotice(null); }}>
                    <Text style={{ color: colors.danger, fontWeight: '800' }}>✕ Cancelar</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>Elige una máquina y toca el mapa donde está. Solo administradores pueden reubicar.</Text>
              <TouchableOpacity onPress={() => setPickerOpen(true)} style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surfaceAlt }}>
                <Text style={{ color: locateFor ? colors.text : colors.muted, fontWeight: '700' }}>{locateFor ? `🎯 ${locateFor.code}` : 'Elegir máquina…'}</Text>
              </TouchableOpacity>
              {locateFor ? (
                <Text style={{ color: '#D97706', fontSize: 13, fontWeight: '800', marginTop: 8 }}>👉 Toca el mapa en el punto donde está {locateFor.code}.</Text>
              ) : null}
              {notice ? <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700', marginTop: 6 }}>{notice}</Text> : null}
            </Card>
          ) : null}

          {/* Mover SECTORES — solo administradores pueden reubicar las zonas del mapa. */}
          {isAdmin && !focus ? (
            <Card style={zoneEdit ? { borderColor: '#2563EB', borderWidth: 1 } : undefined}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>🗺️ Mover sectores (admin)</Text>
                <TouchableOpacity onPress={() => setZoneEdit((v) => !v)} style={{ backgroundColor: zoneEdit ? '#2563EB' : colors.surfaceAlt, borderWidth: 1, borderColor: zoneEdit ? '#2563EB' : colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                  <Text style={{ color: zoneEdit ? '#fff' : colors.text, fontWeight: '800', fontSize: 13 }}>{zoneEdit ? '✓ Activado' : 'Activar'}</Text>
                </TouchableOpacity>
              </View>
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
                {zoneEdit
                  ? 'Prende los sectores en “🗺️ Sectores (zonas)” y arrastra el marcador ✋ de cada uno hasta su lugar. Se guarda solo.'
                  : 'Actívalo para arrastrar los sectores a su posición correcta. Los cambios quedan guardados para todos.'}
              </Text>
            </Card>
          ) : null}

          <VenezuelaMap pins={shownPins} onDelete={deleteLocation} selectedCompany={selectedCompany} zones={zonesOn} height={340} canEdit={isAdmin} locateMode={isAdmin && !!locateFor} zoneOffsets={zoneOffsets} zoneEdit={isAdmin && zoneEdit} />

          {/* Leyenda por empresa — FUERA del mapa (filtra el mapa al tocar). */}
          {!focus ? (
            <Card>
              <TouchableOpacity onPress={() => setLegendOpen((v) => !v)} activeOpacity={0.8} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>🎨 Máquinas por empresa</Text>
                <Text style={{ color: colors.primary, fontWeight: '800' }}>{selectedCompany ? selectedCompany : 'Todas'}  {legendOpen ? '▲' : '▼'}</Text>
              </TouchableOpacity>
              {legendOpen ? (
                <View style={{ marginTop: spacing.sm }}>
                  {(() => {
                    const leg = companyLegend(shownPins ?? []);
                    const rowStyle = (active: boolean) => ({ flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm, paddingVertical: 6, paddingHorizontal: 8, borderRadius: radius.sm, backgroundColor: active ? colors.surfaceAlt : 'transparent' });
                    return (
                      <>
                        <TouchableOpacity onPress={() => setSelectedCompany(null)} style={rowStyle(selectedCompany === null)}>
                          <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: colors.primary }} />
                          <Text style={{ color: colors.text, fontWeight: '700', flex: 1 }}>🌐 General (todas)</Text>
                          <Text style={{ color: colors.muted, fontWeight: '800' }}>{leg.total}</Text>
                        </TouchableOpacity>
                        {leg.rows.map((r) => (
                          <TouchableOpacity key={r.company} onPress={() => setSelectedCompany(r.company)} style={rowStyle(selectedCompany === r.company)}>
                            <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: r.color }} />
                            <Text style={{ color: colors.text, flex: 1 }} numberOfLines={1}>{r.company}</Text>
                            <Text style={{ color: colors.muted, fontWeight: '800' }}>{r.count}</Text>
                          </TouchableOpacity>
                        ))}
                      </>
                    );
                  })()}
                </View>
              ) : null}
            </Card>
          ) : null}

          {/* Sectores (zonas) — FUERA del mapa (prende/apaga polígonos en el mapa). */}
          {!focus ? (
            <Card>
              <TouchableOpacity onPress={() => setZonesOpen((v) => !v)} activeOpacity={0.8} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>🗺️ Sectores (zonas)</Text>
                <Text style={{ color: colors.primary, fontWeight: '800' }}>{zonesOn.size}/{MAP_ZONES.length}  {zonesOpen ? '▲' : '▼'}</Text>
              </TouchableOpacity>
              {zonesOpen ? (
                <View style={{ marginTop: spacing.sm }}>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
                    <TouchableOpacity onPress={() => setZonesOn(new Set(MAP_ZONES.map((_, i) => i)))} style={{ flex: 1, paddingVertical: 8, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}>
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>👁️ Ver todas</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setZonesOn(new Set())} style={{ flex: 1, paddingVertical: 8, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}>
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>🚫 Ocultar todas</Text>
                    </TouchableOpacity>
                  </View>
                  {MAP_ZONES.map((z, i) => {
                    const on = zonesOn.has(i);
                    return (
                      <TouchableOpacity key={i} onPress={() => toggleZone(i)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 }}>
                        <View style={{ width: 15, height: 15, borderRadius: 4, borderWidth: 2, borderColor: z.color, backgroundColor: on ? z.color : 'transparent' }} />
                        <Text style={{ color: colors.text, fontSize: 13, flex: 1 }}>{z.n}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : null}
            </Card>
          ) : null}
        </>
      )}

      {/* MONITOREO (solo admin): quién colocó cada ubicación, con fecha y hora.
          Colapsable como el panel de Sectores. */}
      {isAdmin ? (
        <Card>
          <TouchableOpacity onPress={() => setMonitorOpen((v) => !v)} activeOpacity={0.8} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: colors.text, fontWeight: '800' }}>🕵️ Monitoreo · quién ubica</Text>
            <Text style={{ color: colors.primary, fontWeight: '800' }}>{monitorOpen ? 'Ocultar ▲' : `Ver ▼  (${trace.length})`}</Text>
          </TouchableOpacity>
          {monitorOpen ? (
            <View style={{ marginTop: spacing.sm }}>
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.xs }}>
                Registro de quién colocó (o eliminó) cada ubicación, con su fecha y hora. Toca una fila para verla en el mapa.
              </Text>
              {trace.length === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 12 }}>Aún no hay ubicaciones registradas.</Text>
              ) : trace.map((t) => (
                <TouchableOpacity key={t.id} onPress={() => focusMachine(t)} activeOpacity={0.7} style={{ paddingVertical: 7, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }} numberOfLines={1}>📍 {t.code}</Text>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>{fmt(t.recorded_at)}</Text>
                  </View>
                  <Text style={{ color: t.note ? colors.danger : colors.primary, fontSize: 12, fontWeight: '700' }}>
                    {t.note ? `🗑️ ${recorderName(t.recorded_by)} · ${t.note}` : `👤 ${recorderName(t.recorded_by)}`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </Card>
      ) : null}

      <SectionTitle>Trazabilidad de ubicaciones</SectionTitle>
      {trace.length === 0 ? (
        <EmptyState title="Sin trazabilidad" subtitle="Aquí verás los registros de ubicación y las eliminaciones manuales." />
      ) : (
        trace.map((t) => {
          const deleted = !!t.note;
          const focused = focus?.id === t.machinery_id;
          return (
            <TouchableOpacity key={t.id} activeOpacity={0.7} onPress={() => focusMachine(t)}>
              <Card style={focused ? { borderColor: colors.primary, borderWidth: 1 } : undefined}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>📍 {t.code}</Text>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>{fmt(t.recorded_at)}</Text>
                </View>
                <Text style={{ color: colors.primary, fontSize: 12, marginTop: 2 }}>🏢 {t.company}</Text>
                {t.plate || t.serial ? (
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    🔖 {t.plate ? `Placa: ${t.plate}` : ''}{t.plate && t.serial ? ' · ' : ''}{t.serial ? `Serial: ${t.serial}` : ''}
                  </Text>
                ) : null}
                {deleted ? (
                  <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700', marginTop: 2 }}>🗑️ {t.note}</Text>
                ) : (
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                    {t.latitude}, {t.longitude}
                  </Text>
                )}
                {isAdmin ? <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700', marginTop: 2 }}>👤 {recorderName(t.recorded_by)}</Text> : null}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                  <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '800' }}>{focused ? '✓ Viendo solo esta en el mapa' : 'Toca: ver solo esta en el mapa'}</Text>
                  <TouchableOpacity onPress={() => openRoute(t)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>🧭 Ruta por fecha/hora</Text>
                  </TouchableOpacity>
                </View>
              </Card>
            </TouchableOpacity>
          );
        })
      )}

      {/* Mapa en PANTALLA COMPLETA (con ubicación del usuario). */}
      <Modal visible={fullscreen} animationType="slide" onRequestClose={() => setFullscreen(false)}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.primary }}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 16 }}>🗺️ Mapa {focus ? `· ${focus.code}` : ''}</Text>
            <TouchableOpacity onPress={() => setFullscreen(false)} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.25)' }}>
              <Text style={{ color: '#fff', fontWeight: '800' }}>✕ Cerrar</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flex: 1 }}>
            <VenezuelaMap
              pins={shownPins ?? []}
              onDelete={deleteLocation}
              selectedCompany={selectedCompany}
              zones={zonesOn}
              height={Math.max(320, Dimensions.get('window').height - 56)}
              canEdit={isAdmin}
              zoneOffsets={zoneOffsets}
              zoneEdit={isAdmin && zoneEdit}
            />
          </View>
        </View>
      </Modal>

      {/* Selector de máquina para la ubicación manual (solo admin). */}
      <Modal visible={pickerOpen} animationType="slide" transparent onRequestClose={() => setPickerOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '85%' }}>
            <View style={{ padding: spacing.lg }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18 }}>Elegir máquina para ubicar</Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>Las que faltan por ubicar aparecen primero.</Text>
              <TextInput
                value={pickerQuery}
                onChangeText={setPickerQuery}
                placeholder="Buscar por código…"
                placeholderTextColor={colors.muted}
                style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }}
              />
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}>
              {pickerList.length === 0 ? (
                <Text style={{ color: colors.muted }}>Sin resultados.</Text>
              ) : pickerList.map((a) => (
                <TouchableOpacity
                  key={a.id}
                  onPress={() => { setLocateFor({ id: a.id, code: a.code }); setPickerOpen(false); setPickerQuery(''); setNotice(null); }}
                  style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}
                >
                  <Text style={{ color: colors.text, fontWeight: '700', flex: 1 }} numberOfLines={1}>{a.code || '—'}</Text>
                  <Text style={{ color: a.located ? colors.success : colors.danger, fontSize: 12, fontWeight: '700' }}>{a.located ? '📍 Ubicada' : '⬜ Sin ubicar'}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity onPress={() => setPickerOpen(false)} style={{ margin: spacing.lg, marginTop: 0, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Ruta de la máquina: historial de ubicaciones por fecha y hora. */}
      <Modal visible={!!routeFor} animationType="slide" transparent onRequestClose={() => setRouteFor(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '85%' }}>
            <View style={{ padding: spacing.lg }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18 }}>🧭 Ruta · {routeFor?.code}</Text>
              <Text style={{ color: colors.primary, fontSize: 13 }}>🏢 {routeFor?.company}</Text>
              {routeFor?.plate || routeFor?.serial ? (
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  🔖 {routeFor?.plate ? `Placa: ${routeFor.plate}` : ''}{routeFor?.plate && routeFor?.serial ? ' · ' : ''}{routeFor?.serial ? `Serial: ${routeFor.serial}` : ''}
                </Text>
              ) : null}
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}>
              {routePoints === null ? (
                <Loading />
              ) : routePoints.length === 0 ? (
                <Text style={{ color: colors.muted }}>Sin registros de ubicación.</Text>
              ) : (
                routePoints.map((p, i) => (
                  <View key={p.id} style={{ flexDirection: 'row', gap: spacing.sm, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                    <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 12, width: 30 }}>{routePoints.length - i}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{fmt(p.recorded_at)}</Text>
                      {p.note ? (
                        <Text style={{ color: colors.danger, fontSize: 12 }}>🗑️ {p.note}</Text>
                      ) : (
                        <Text style={{ color: colors.muted, fontSize: 12 }}>{p.latitude}, {p.longitude}</Text>
                      )}
                    </View>
                    {p.latitude != null && p.longitude != null ? (
                      <Text
                        onPress={() => { const w: any = globalThis; try { w.open?.(`https://www.google.com/maps?q=${p.latitude},${p.longitude}`, '_blank'); } catch {} }}
                        style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}
                      >
                        Mapa ↗
                      </Text>
                    ) : null}
                  </View>
                ))
              )}
            </ScrollView>
            <TouchableOpacity onPress={() => setRouteFor(null)} style={{ margin: spacing.lg, marginTop: 0, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
