import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { Screen, Card, SectionTitle, Loading, EmptyState } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { VenezuelaMap, MapPin, companyLegend, MAP_ZONES } from '../components/VenezuelaMap';
import { supabase } from '../lib/supabase';
import { elapsedSince } from '../lib/time';
import { formatUTM } from '../lib/utm';
import { norm } from '../lib/text';
import { useConfirm } from '../components/ConfirmProvider';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

// Categorías del mapa: agrupan las máquinas por lo que son (para prender/apagar
// capas). Se prueba con el código + tipo + clasificación (sin acentos, minúscula).
const CATS: { key: string; label: string; icon: string; re: RegExp }[] = [
  { key: 'transporte', label: 'Camiones y transporte', icon: '🚛', re: /camion|chuto|volteo|volquet|toronto|pipa|cisterna|batea|gandola|plataforma|lowboy|remolque/ },
  { key: 'grua', label: 'Grúas', icon: '🏗️', re: /grua/ },
  { key: 'excavacion', label: 'Excavadoras / Retro', icon: '⛏️', re: /excavad|retro|pala|martillo|oruga/ },
  { key: 'carga', label: 'Cargadores / Tractores', icon: '🚜', re: /cargador|payloader|bulldozer|tractor|motonivel|nivelad|bobcat|minicarg/ },
  { key: 'compactacion', label: 'Compactadores / Rodillos', icon: '🧱', re: /compact|rodillo|vibro|apisonad/ },
];
const CAT_OTHER = { key: 'otros', label: 'Otras máquinas', icon: '🔧' };
const CAT_META: Record<string, { label: string; icon: string }> = {
  ...Object.fromEntries(CATS.map((c) => [c.key, { label: c.label, icon: c.icon }])),
  [CAT_OTHER.key]: { label: CAT_OTHER.label, icon: CAT_OTHER.icon },
};
const CAT_ORDER = [...CATS.map((c) => c.key), CAT_OTHER.key];
/** Categoría de una máquina según su código/tipo/clasificación. */
function catOf(p: MapPin): string {
  const s = norm(`${p.name || ''} ${p.tipo || ''} ${p.clasificacion || ''}`);
  for (const c of CATS) if (c.re.test(s)) return c.key;
  return CAT_OTHER.key;
}

type TraceRow = { id: string; machinery_id: string; code: string; company: string; plate: string | null; serial: string | null; note: string | null; latitude: number | null; longitude: number | null; recorded_at: string };
type RoutePoint = { id: string; latitude: number | null; longitude: number | null; note: string | null; recorded_at: string };

function fmt(ts: string): string {
  try {
    return new Date(ts).toLocaleString('es-VE', { timeZone: 'America/Caracas' });
  } catch {
    return ts;
  }
}

export default function MapScreen({ navigation, route }: any) {
  const { colors } = useTheme();
  const confirm = useConfirm();
  const [pins, setPins] = useState<MapPin[] | null>(null);
  const [trace, setTrace] = useState<TraceRow[]>([]);
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
  const toggleZone = (i: number) => setZonesOn((prev) => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });

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

    // Trazabilidad reciente (incluye los eventos con nota, p. ej. eliminaciones manuales).
    const { data: tr } = await supabase
      .from('machinery_locations')
      .select('id, machinery_id, note, latitude, longitude, recorded_at, machinery:machinery_id(code, plate, serial, company:company_id(name))')
      .order('recorded_at', { ascending: false })
      .limit(40);
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
      }))
    );
  }, []);

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

  // Web: el popup del mapa (iframe) avisa por postMessage al pulsar "Eliminar ubicación".
  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const h = (e: any) => {
      if (e?.data?.type === 'map-delete-pin' && e.data.id) deleteLocation(e.data.id, e.data.name);
    };
    window.addEventListener('message', h);
    return () => window.removeEventListener('message', h);
  }, [deleteLocation]);

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
      const k = pinCat.get(p.id) ?? CAT_OTHER.key;
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(p);
    });
    g.forEach((arr) => arr.sort((a, b) => (a.name || '').localeCompare(b.name || '')));
    return g;
  }, [pins, pinCat]);
  const presentCats = CAT_ORDER.filter((k) => groups.has(k));

  const isMachineShown = (p: MapPin) => !hiddenCats.has(pinCat.get(p.id) ?? CAT_OTHER.key) && !hiddenIds.has(p.id);
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

              {presentCats.map((k) => {
                const list = groups.get(k) ?? [];
                const catHidden = hiddenCats.has(k);
                const shownInCat = catHidden ? 0 : list.filter((p) => !hiddenIds.has(p.id)).length;
                const meta = CAT_META[k];
                const expanded = expandedCat === k;
                return (
                  <View key={k} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                      {/* Interruptor de la categoría */}
                      <TouchableOpacity onPress={() => toggleCat(k)} style={{ width: 34, height: 22, borderRadius: 11, backgroundColor: catHidden ? colors.border : colors.success, justifyContent: 'center', paddingHorizontal: 2 }}>
                        <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', alignSelf: catHidden ? 'flex-start' : 'flex-end' }} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setExpandedCat(expanded ? null : k)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{meta.icon} {meta.label}</Text>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>{shownInCat}/{list.length}  {expanded ? '▲' : '▼'}</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Máquinas de la categoría (prender/apagar individual) */}
                    {expanded ? (
                      <View style={{ marginTop: 6, paddingLeft: 42 }}>
                        {list.map((p) => {
                          const off = catHidden || hiddenIds.has(p.id);
                          return (
                            <TouchableOpacity key={p.id} onPress={() => toggleId(p.id)} disabled={catHidden} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 5, opacity: catHidden ? 0.4 : 1 }}>
                              <Text style={{ fontSize: 15 }}>{off ? '⬜' : '✅'}</Text>
                              <Text style={{ color: colors.text, fontSize: 13, flex: 1 }}>{p.name}</Text>
                              <Text style={{ color: colors.muted, fontSize: 11 }}>{p.company}</Text>
                            </TouchableOpacity>
                          );
                        })}
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
          <VenezuelaMap pins={shownPins} onDelete={deleteLocation} selectedCompany={selectedCompany} zones={zonesOn} height={340} />

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
