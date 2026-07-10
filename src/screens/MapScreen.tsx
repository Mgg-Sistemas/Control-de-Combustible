import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { Screen, Card, SectionTitle, Loading, EmptyState } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { VenezuelaMap, MapPin } from '../components/VenezuelaMap';
import { supabase } from '../lib/supabase';
import { elapsedSince } from '../lib/time';
import { useConfirm } from '../components/ConfirmProvider';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

type TraceRow = { id: string; code: string; company: string; plate: string | null; serial: string | null; note: string | null; latitude: number | null; longitude: number | null; recorded_at: string };
type RoutePoint = { id: string; latitude: number | null; longitude: number | null; note: string | null; recorded_at: string };

function fmt(ts: string): string {
  try {
    return new Date(ts).toLocaleString('es-VE', { timeZone: 'America/Caracas' });
  } catch {
    return ts;
  }
}

export default function MapScreen() {
  const { colors } = useTheme();
  const confirm = useConfirm();
  const [pins, setPins] = useState<MapPin[] | null>(null);
  const [trace, setTrace] = useState<TraceRow[]>([]);
  // Ruta de una máquina (al tocar un registro): puntos por fecha y hora.
  const [routeFor, setRouteFor] = useState<{ code: string; company: string; plate: string | null; serial: string | null } | null>(null);
  const [routePoints, setRoutePoints] = useState<RoutePoint[] | null>(null);

  const load = React.useCallback(async () => {
    const { data: machines } = await supabase
      .from('machinery')
      .select('id, code, latitude, longitude, location_at, operational')
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
      route: routes.get(m.id) ?? [],
    }));
    setPins(built);

    // Trazabilidad reciente (incluye los eventos con nota, p. ej. eliminaciones manuales).
    const { data: tr } = await supabase
      .from('machinery_locations')
      .select('id, note, latitude, longitude, recorded_at, machinery:machinery_id(code, plate, serial, company:company_id(name))')
      .order('recorded_at', { ascending: false })
      .limit(40);
    setTrace(
      (tr ?? []).map((r: any) => ({
        id: r.id,
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

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Mapa de máquinas</SectionTitle>
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
      {pins === null ? <Loading /> : <VenezuelaMap pins={pins} onDelete={deleteLocation} />}

      <SectionTitle>Trazabilidad de ubicaciones</SectionTitle>
      {trace.length === 0 ? (
        <EmptyState title="Sin trazabilidad" subtitle="Aquí verás los registros de ubicación y las eliminaciones manuales." />
      ) : (
        trace.map((t) => {
          const deleted = !!t.note;
          return (
            <TouchableOpacity key={t.id} activeOpacity={0.7} onPress={() => openRoute(t)}>
              <Card>
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
                <Text style={{ color: colors.primary, fontSize: 11, marginTop: 4, fontWeight: '700' }}>Toca para ver la ruta por fecha y hora →</Text>
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
