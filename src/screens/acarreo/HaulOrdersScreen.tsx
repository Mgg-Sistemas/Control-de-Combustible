// ACARREO · Órdenes de acarreo: lista con filtros por estado + búsqueda, y
// alterna entre lista / formulario / detalle. Carga una sola vez los datos de
// referencia (clientes, ubicaciones, flota, choferes, máquinas, documentos) y
// los comparte con el formulario (validación en vivo) y el detalle.
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../../components/ui';
import { useToast } from '../../components/ToastProvider';
import { useTable } from '../../hooks/useTable';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { norm, cmpText } from '../../lib/text';
import { caracasParts } from '../../lib/jornada';
import { StatusBadge, statusMeta } from './AcarreoUI';
import HaulOrderForm, { HaulRefs } from './HaulOrderForm';
import HaulOrderDetail from './HaulOrderDetail';
import {
  HaulOrder, HaulClient, HaulLocation, HaulTruck, HaulTrailer, HaulDriver, HaulDocument, HaulTariff, Machinery,
} from '../../types/database';

const FILTERS: { key: string; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'programado', label: 'Programado' },
  { key: 'en_carga', label: 'En carga' },
  { key: 'en_transito', label: 'En tránsito' },
  { key: 'en_descarga', label: 'En descarga' },
  { key: 'completado', label: 'Completado' },
  { key: 'cancelado', label: 'Cancelado' },
];

export default function HaulOrdersScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const { data: orders, loading, refetch } = useTable<HaulOrder>('haul_orders', { orderBy: 'created_at', ascending: false, realtimeFrom: ['haul_orders', 'haul_order_items', 'haul_status_events'] });
  const { data: clients } = useTable<HaulClient>('haul_clients', { orderBy: 'name' });
  const { data: locations } = useTable<HaulLocation>('haul_locations', { orderBy: 'name' });
  const { data: trucks } = useTable<HaulTruck>('haul_trucks', { orderBy: 'plate' });
  const { data: trailers } = useTable<HaulTrailer>('haul_trailers', { orderBy: 'plate' });
  const { data: drivers } = useTable<HaulDriver>('haul_drivers', { orderBy: 'full_name' });
  const { data: machinery } = useTable<Machinery>('machinery', { orderBy: 'code' });
  const { data: docs } = useTable<HaulDocument>('haul_documents', { orderBy: 'expires_at' });
  const { data: tariffs } = useTable<HaulTariff>('haul_tariffs', { orderBy: 'created_at', ascending: false });

  const refs: HaulRefs = { clients, locations, trucks, trailers, drivers, machinery, docs, orders, tariffs };

  const [filter, setFilter] = useState('todos');
  const [q, setQ] = useState('');
  const [view, setView] = useState<{ mode: 'list' } | { mode: 'form'; order: HaulOrder | null } | { mode: 'detail'; order: HaulOrder }>({ mode: 'list' });

  const nameOf = useMemo(() => {
    const locs = new Map(locations.map((l) => [l.id, l.name]));
    const drv = new Map(drivers.map((d) => [d.id, d.full_name]));
    return { locs, drv };
  }, [locations, drivers]);

  const shown = useMemo(() => {
    const nq = norm(q.trim());
    let list = filter === 'todos' ? orders : orders.filter((o) => o.status === filter);
    if (nq) list = list.filter((o) => norm([o.folio, nameOf.locs.get(o.origin_location_id ?? ''), nameOf.locs.get(o.dest_location_id ?? ''), nameOf.drv.get(o.driver_id ?? '')].filter(Boolean).join(' ')).includes(nq));
    return list;
  }, [orders, filter, q, nameOf]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    orders.forEach((o) => { c[o.status] = (c[o.status] ?? 0) + 1; });
    return c;
  }, [orders]);

  const hoy = caracasParts(new Date()).iso;

  if (view.mode === 'form') {
    return (
      <HaulOrderForm
        order={view.order}
        refs={refs}
        todayISO={hoy}
        onClose={() => setView({ mode: 'list' })}
        onSaved={() => { setView({ mode: 'list' }); refetch(); toast.success('Orden guardada.'); }}
        onError={(m) => toast.error(m)}
      />
    );
  }
  if (view.mode === 'detail') {
    // Reflejar la versión más reciente de la orden (por si cambió su estado).
    const fresh = orders.find((o) => o.id === view.order.id) ?? view.order;
    return (
      <HaulOrderDetail
        order={fresh}
        refs={refs}
        onEdit={() => setView({ mode: 'form', order: fresh })}
        onClose={() => setView({ mode: 'list' })}
        onChanged={() => { refetch(); }}
        onError={(m) => toast.error(m)}
      />
    );
  }

  return (
    <Screen>
      <SectionTitle>Órdenes de acarreo</SectionTitle>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: spacing.sm }} contentContainerStyle={{ gap: spacing.xs }}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const n = f.key === 'todos' ? orders.length : (counts[f.key] ?? 0);
          return (
            <TouchableOpacity key={f.key} onPress={() => setFilter(f.key)}
              style={{ paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary : colors.surface }}>
              <Text style={{ color: active ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12.5 }}>{f.label} ({n})</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <TextInput value={q} onChangeText={setQ} placeholder="🔎 Buscar por folio, ruta, chofer…" placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: spacing.sm }} />

      <TouchableOpacity onPress={() => setView({ mode: 'form', order: null })}
        style={{ backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginBottom: spacing.md }}>
        <Text style={{ color: colors.primaryContrast, fontWeight: '700', fontSize: 15 }}>+ Nueva orden de acarreo</Text>
      </TouchableOpacity>

      {loading ? (
        <Loading />
      ) : shown.length === 0 ? (
        <EmptyState title="Sin órdenes" subtitle="Crea la primera orden de acarreo." />
      ) : (
        shown.map((o) => (
          <Card key={o.id}>
            <TouchableOpacity activeOpacity={0.7} onPress={() => setView({ mode: 'detail', order: o })}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{o.folio}</Text>
                <StatusBadge status={o.status} />
              </View>
              <Text style={{ color: colors.text, fontSize: 13, marginTop: 4 }}>
                {nameOf.locs.get(o.origin_location_id ?? '') ?? '—'} → {nameOf.locs.get(o.dest_location_id ?? '') ?? '—'}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                {[nameOf.drv.get(o.driver_id ?? ''), o.requested_departure_at ? `Salida ${o.requested_departure_at.slice(0, 10)}` : null].filter(Boolean).join(' · ') || 'Sin chofer/fecha'}
              </Text>
            </TouchableOpacity>
          </Card>
        ))
      )}
    </Screen>
  );
}
