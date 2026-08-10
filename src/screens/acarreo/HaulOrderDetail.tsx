// ACARREO · Detalle de una orden: datos, equipos, bitácora de estado y avance
// de la máquina de estados. (El check-in/out con fotos y firma llega en la Fase 4.)
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { Screen, Card, SectionTitle } from '../../components/ui';
import { StatusBadge, statusMeta } from './AcarreoUI';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { HaulOrder, HaulStatusEvent } from '../../types/database';
import type { HaulRefs } from './HaulOrderForm';

// Transición hacia adelante de la máquina de estados.
const NEXT: Record<string, { to: string; label: string } | null> = {
  programado: { to: 'en_carga', label: '📦 Marcar EN CARGA' },
  en_carga: { to: 'en_transito', label: '🚚 Marcar EN TRÁNSITO' },
  en_transito: { to: 'en_descarga', label: '📥 Marcar EN DESCARGA' },
  en_descarga: { to: 'completado', label: '✅ Marcar COMPLETADO' },
  completado: null,
  cancelado: null,
};

export default function HaulOrderDetail({
  order, refs, onEdit, onClose, onChanged, onError,
}: {
  order: HaulOrder;
  refs: HaulRefs;
  onEdit: () => void;
  onClose: () => void;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const { colors } = useTheme();
  const [items, setItems] = useState<{ code: string; extra: string }[]>([]);
  const [events, setEvents] = useState<HaulStatusEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [askCancel, setAskCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const name = useMemo(() => {
    const clients = new Map(refs.clients.map((c) => [c.id, c.name]));
    const locs = new Map(refs.locations.map((l) => [l.id, l.name]));
    const trucks = new Map(refs.trucks.map((t) => [t.id, t.plate]));
    const trailers = new Map(refs.trailers.map((t) => [t.id, t.plate]));
    const drivers = new Map(refs.drivers.map((d) => [d.id, d.full_name]));
    return { clients, locs, trucks, trailers, drivers };
  }, [refs]);

  const load = async () => {
    const { data: it } = await supabase
      .from('haul_order_items')
      .select('weight_ton_snap, machinery:machinery_id(code, serial, tipo)')
      .eq('order_id', order.id);
    setItems((it ?? []).map((r: any) => ({
      code: r.machinery?.code ?? '—',
      extra: [r.machinery?.serial, r.machinery?.tipo, r.weight_ton_snap != null ? `${r.weight_ton_snap} t` : null].filter(Boolean).join(' · '),
    })));
    const { data: ev } = await supabase.from('haul_status_events').select('*').eq('order_id', order.id).order('at', { ascending: true });
    setEvents((ev ?? []) as HaulStatusEvent[]);
  };
  useEffect(() => { load(); }, [order.id]);

  const advance = async () => {
    const nx = NEXT[order.status];
    if (!nx) return;
    setBusy(true);
    const patch: any = { status: nx.to };
    if (nx.to === 'en_transito') patch.departed_at = new Date().toISOString();
    if (nx.to === 'completado') patch.arrived_at = new Date().toISOString();
    const { error } = await supabase.from('haul_orders').update(patch).eq('id', order.id);
    setBusy(false);
    if (error) { onError(error.message); return; }
    onChanged();
  };

  const cancel = async () => {
    setBusy(true);
    const { error } = await supabase.from('haul_orders').update({ status: 'cancelado', cancel_reason: cancelReason.trim() || null }).eq('id', order.id);
    setBusy(false);
    if (error) { onError(error.message); return; }
    onChanged();
  };

  const totalTon = items.reduce((s, it) => {
    const m = it.extra.match(/([\d.]+) t/);
    return s + (m ? Number(m[1]) : 0);
  }, 0);
  const nx = NEXT[order.status];
  const terminal = order.status === 'completado' || order.status === 'cancelado';

  const Row = ({ label, value }: { label: string; value?: string | null }) => value ? (
    <Text style={{ color: colors.text, fontSize: 13, marginTop: 2 }}>
      <Text style={{ color: colors.muted }}>{label}: </Text>{value}
    </Text>
  ) : null;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <SectionTitle>{order.folio}</SectionTitle>
        <TouchableOpacity onPress={onClose}><Text style={{ color: colors.primary, fontWeight: '700' }}>Cerrar</Text></TouchableOpacity>
      </View>

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <StatusBadge status={order.status} />
          {!terminal ? (
            <TouchableOpacity onPress={onEdit}><Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>✏️ Editar</Text></TouchableOpacity>
          ) : null}
        </View>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, marginTop: spacing.sm }}>
          {name.locs.get(order.origin_location_id ?? '') ?? '—'} → {name.locs.get(order.dest_location_id ?? '') ?? '—'}
        </Text>
        <Row label="Emisor" value={name.clients.get(order.client_from_id ?? '')} />
        <Row label="Receptor" value={name.clients.get(order.client_to_id ?? '')} />
        <Row label="Chuto" value={name.trucks.get(order.truck_id ?? '')} />
        <Row label="Remolque" value={name.trailers.get(order.trailer_id ?? '')} />
        <Row label="Chofer" value={name.drivers.get(order.driver_id ?? '')} />
        <Row label="Salida req." value={order.requested_departure_at?.slice(0, 10)} />
        <Row label="Llegada req." value={order.required_arrival_at?.slice(0, 10)} />
        <Row label="Km / peajes" value={[order.route_km_est != null ? `${order.route_km_est} km` : null, order.tolls_est != null ? `peajes ${order.tolls_est}` : null].filter(Boolean).join(' · ') || null} />
        {order.cancel_reason ? <Row label="Motivo cancelación" value={order.cancel_reason} /> : null}
        {order.notes ? <Row label="Notas" value={order.notes} /> : null}
      </Card>

      <Card>
        <Text style={{ color: colors.text, fontWeight: '800', marginBottom: 4 }}>🚜 Equipos ({items.length}) · ⚖️ {totalTon.toFixed(1)} t</Text>
        {items.length === 0 ? <Text style={{ color: colors.muted, fontSize: 12 }}>Sin equipos.</Text> :
          items.map((it, i) => (
            <Text key={i} style={{ color: colors.text, fontSize: 13, marginTop: 2 }}>• {it.code} <Text style={{ color: colors.muted, fontSize: 11 }}>{it.extra}</Text></Text>
          ))}
      </Card>

      {!terminal ? (
        <View style={{ gap: spacing.sm }}>
          {nx ? (
            <TouchableOpacity onPress={advance} disabled={busy} style={{ backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}>
              <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 15 }}>{busy ? '…' : nx.label}</Text>
            </TouchableOpacity>
          ) : null}
          {!askCancel ? (
            <TouchableOpacity onPress={() => setAskCancel(true)} style={{ borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}>
              <Text style={{ color: colors.danger, fontWeight: '700' }}>🚫 Cancelar orden</Text>
            </TouchableOpacity>
          ) : (
            <Card style={{ borderColor: colors.danger, borderWidth: 1 }}>
              <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>Motivo de la cancelación</Text>
              <TextInput value={cancelReason} onChangeText={setCancelReason} placeholder="Ej. falla del chuto, reprogramado…" placeholderTextColor={colors.muted}
                style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                <TouchableOpacity onPress={() => setAskCancel(false)} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                  <Text style={{ color: colors.text, fontWeight: '600' }}>Volver</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={cancel} disabled={busy} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.danger }}>
                  <Text style={{ color: '#fff', fontWeight: '700' }}>{busy ? '…' : 'Cancelar orden'}</Text>
                </TouchableOpacity>
              </View>
            </Card>
          )}
        </View>
      ) : null}

      <Card>
        <Text style={{ color: colors.text, fontWeight: '800', marginBottom: 4 }}>🕒 Bitácora</Text>
        {events.length === 0 ? <Text style={{ color: colors.muted, fontSize: 12 }}>Sin movimientos.</Text> :
          events.map((e) => (
            <Text key={e.id} style={{ color: colors.text, fontSize: 12.5, marginTop: 2 }}>
              <Text style={{ color: statusMeta(e.to_status).color, fontWeight: '800' }}>{statusMeta(e.to_status).label}</Text>
              <Text style={{ color: colors.muted }}>  ·  {new Date(e.at).toLocaleString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</Text>
            </Text>
          ))}
      </Card>
    </Screen>
  );
}
