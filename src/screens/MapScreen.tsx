import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { Screen, Card, SectionTitle, Loading, EmptyState } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { VenezuelaMap, MapPin } from '../components/VenezuelaMap';
import { supabase } from '../lib/supabase';
import { elapsedSince } from '../lib/time';
import { useConfirm } from '../components/ConfirmProvider';
import { useTheme } from '../theme/ThemeContext';
import { spacing } from '../theme';

type TraceRow = { id: string; code: string; note: string | null; latitude: number | null; longitude: number | null; recorded_at: string };

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
      .select('id, note, latitude, longitude, recorded_at, machinery:machinery_id(code)')
      .order('recorded_at', { ascending: false })
      .limit(40);
    setTrace(
      (tr ?? []).map((r: any) => ({
        id: r.id,
        code: r.machinery?.code ?? '—',
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
            <Card key={t.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>📍 {t.code}</Text>
                <Text style={{ color: colors.muted, fontSize: 11 }}>{fmt(t.recorded_at)}</Text>
              </View>
              {deleted ? (
                <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700', marginTop: 2 }}>🗑️ {t.note}</Text>
              ) : (
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                  {t.latitude}, {t.longitude}
                </Text>
              )}
            </Card>
          );
        })
      )}
    </Screen>
  );
}
