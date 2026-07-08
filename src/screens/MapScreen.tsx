import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { Screen, Card, SectionTitle, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { VenezuelaMap, MapPin } from '../components/VenezuelaMap';
import { supabase } from '../lib/supabase';
import { elapsedSince } from '../lib/time';
import { Machinery, MachineryLocation } from '../types/database';
import { useTheme } from '../theme/ThemeContext';
import { spacing } from '../theme';

export default function MapScreen() {
  const { colors } = useTheme();
  const [pins, setPins] = useState<MapPin[] | null>(null);

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

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Mapa de máquinas</SectionTitle>
      <Card>
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <Text style={{ color: colors.success, fontSize: 12 }}>● Operativa</Text>
          <Text style={{ color: colors.danger, fontSize: 12 }}>● No operativa</Text>
          <Text style={{ color: '#2563EB', fontSize: 12 }}>— Ruta</Text>
        </View>
      </Card>
      {pins === null ? <Loading /> : <VenezuelaMap pins={pins} />}
    </Screen>
  );
}
