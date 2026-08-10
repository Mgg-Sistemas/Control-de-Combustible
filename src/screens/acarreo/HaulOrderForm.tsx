// ACARREO · Crear / editar una orden de acarreo, con validación en vivo
// (peso, vencimientos, solapamiento). Los errores son bloqueo SUAVE: el admin
// puede forzar el guardado.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { Screen, Card, SectionTitle } from '../../components/ui';
import { DateField } from '../../components/DateField';
import { Dropdown, FieldLabel, SectionLabel, Opt } from './AcarreoUI';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { norm, cmpText, onlyDecimal } from '../../lib/text';
import { allWarnings } from '../../lib/haulValidations';
import {
  HaulOrder, HaulClient, HaulLocation, HaulTruck, HaulTrailer, HaulDriver, HaulDocument, HaulTariff, Machinery,
} from '../../types/database';

export type HaulRefs = {
  clients: HaulClient[]; locations: HaulLocation[]; trucks: HaulTruck[];
  trailers: HaulTrailer[]; drivers: HaulDriver[]; machinery: Machinery[];
  docs: HaulDocument[]; orders: HaulOrder[]; tariffs: HaulTariff[];
};

export default function HaulOrderForm({
  order, refs, todayISO, onClose, onSaved, onError,
}: {
  order: HaulOrder | null;
  refs: HaulRefs;
  todayISO: string;
  onClose: () => void;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const { colors } = useTheme();
  const { role } = useAuth();
  const isAdmin = role === 'admin';

  const [clientFrom, setClientFrom] = useState(order?.client_from_id ?? '');
  const [clientTo, setClientTo] = useState(order?.client_to_id ?? '');
  const [origin, setOrigin] = useState(order?.origin_location_id ?? '');
  const [dest, setDest] = useState(order?.dest_location_id ?? '');
  const [depart, setDepart] = useState((order?.requested_departure_at ?? '').slice(0, 10));
  const [arrive, setArrive] = useState((order?.required_arrival_at ?? '').slice(0, 10));
  const [truckId, setTruckId] = useState(order?.truck_id ?? '');
  const [trailerId, setTrailerId] = useState(order?.trailer_id ?? '');
  const [driverId, setDriverId] = useState(order?.driver_id ?? '');
  const [km, setKm] = useState(order?.route_km_est != null ? String(order.route_km_est) : '');
  const [tolls, setTolls] = useState(order?.tolls_est != null ? String(order.tolls_est) : '');
  const [perDiem, setPerDiem] = useState(order?.per_diem_advanced != null ? String(order.per_diem_advanced) : '');
  const [notes, setNotes] = useState(order?.notes ?? '');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [machSearch, setMachSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [forced, setForced] = useState(false);

  // Al editar, traer los equipos ya asignados a la orden.
  useEffect(() => {
    if (!order) return;
    (async () => {
      const { data } = await supabase.from('haul_order_items').select('machinery_id').eq('order_id', order.id);
      setSel(new Set((data ?? []).map((r: any) => r.machinery_id)));
    })();
  }, [order]);

  const clientOpts: Opt[] = useMemo(() => refs.clients.map((c) => ({ value: c.id, label: `${c.kind === 'externo' ? '🏢' : '🏠'} ${c.name}` })).sort((a, b) => cmpText(a.label, b.label)), [refs.clients]);
  const locOpts: Opt[] = useMemo(() => refs.locations.map((l) => ({ value: l.id, label: l.name })).sort((a, b) => cmpText(a.label, b.label)), [refs.locations]);
  const truckOpts: Opt[] = useMemo(() => refs.trucks.filter((t) => t.status !== 'inactivo').map((t) => ({ value: t.id, label: `🚛 ${t.plate}${t.max_tow_ton != null ? ` · ${t.max_tow_ton} t` : ''}` })).sort((a, b) => cmpText(a.label, b.label)), [refs.trucks]);
  const trailerOpts: Opt[] = useMemo(() => refs.trailers.filter((t) => t.status !== 'inactivo').map((t) => ({ value: t.id, label: `🛻 ${t.plate}${t.max_load_ton != null ? ` · ${t.max_load_ton} t` : ''}` })).sort((a, b) => cmpText(a.label, b.label)), [refs.trailers]);
  const driverOpts: Opt[] = useMemo(() => refs.drivers.filter((d) => d.active !== false).map((d) => ({ value: d.id, label: `👷 ${d.full_name}` })).sort((a, b) => cmpText(a.label, b.label)), [refs.drivers]);

  const machList = useMemo(() => {
    const nq = norm(machSearch.trim());
    const activas = refs.machinery.filter((m) => m.active !== false);
    const list = nq ? activas.filter((m) => norm([m.code, m.serial, m.plate, m.tipo].filter(Boolean).join(' ')).includes(nq)) : activas;
    return [...list].sort((a, b) => cmpText(a.code, b.code));
  }, [refs.machinery, machSearch]);

  const selMachines = useMemo(() => refs.machinery.filter((m) => sel.has(m.id)), [refs.machinery, sel]);
  const totalTon = selMachines.reduce((s, m) => s + (Number(m.weight_ton) || 0), 0);

  const truck = refs.trucks.find((t) => t.id === truckId) ?? null;
  const trailer = refs.trailers.find((t) => t.id === trailerId) ?? null;
  const driver = refs.drivers.find((d) => d.id === driverId) ?? null;

  const warnings = useMemo(() => allWarnings({
    todayISO, machines: selMachines, truck, trailer, driver, docs: refs.docs,
    current: { id: order?.id, driver_id: driverId, truck_id: truckId, trailer_id: trailerId, requested_departure_at: depart || null, required_arrival_at: arrive || null },
    others: refs.orders,
  }), [todayISO, selMachines, truck, trailer, driver, refs.docs, refs.orders, order, driverId, truckId, trailerId, depart, arrive]);

  const hasError = warnings.some((w) => w.level === 'error');

  const toggle = (id: string) => setSel((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const save = async () => {
    if (!origin || !dest) { onError('Elige origen y destino.'); return; }
    if (sel.size === 0) { onError('Selecciona al menos un equipo a trasladar.'); return; }
    if (hasError && !forced) { onError('Hay alertas que impiden guardar. Un administrador puede forzar.'); return; }
    setSaving(true);
    const payload: any = {
      client_from_id: clientFrom || null, client_to_id: clientTo || null,
      origin_location_id: origin, dest_location_id: dest,
      requested_departure_at: depart || null, required_arrival_at: arrive || null,
      truck_id: truckId || null, trailer_id: trailerId || null, driver_id: driverId || null,
      route_km_est: km ? Number(km) : null, tolls_est: tolls ? Number(tolls) : null,
      per_diem_advanced: perDiem ? Number(perDiem) : null, notes: notes.trim() || null,
    };
    let orderId = order?.id;
    if (order) {
      const { error } = await supabase.from('haul_orders').update(payload).eq('id', order.id);
      if (error) { setSaving(false); onError(error.message); return; }
    } else {
      const { data: u } = await supabase.auth.getUser();
      payload.created_by = u.user?.id ?? null;
      const { data, error } = await supabase.from('haul_orders').insert(payload).select('id').single();
      if (error || !data) { setSaving(false); onError(error?.message ?? 'No se pudo crear.'); return; }
      orderId = (data as any).id;
    }
    // Reemplazar los equipos de la orden (borrar + insertar con el peso congelado).
    await supabase.from('haul_order_items').delete().eq('order_id', orderId);
    const items = selMachines.map((m) => ({ order_id: orderId, machinery_id: m.id, weight_ton_snap: m.weight_ton ?? null }));
    if (items.length) {
      const { error } = await supabase.from('haul_order_items').insert(items);
      if (error) { setSaving(false); onError(error.message); return; }
    }
    setSaving(false);
    onSaved();
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <SectionTitle>{order ? `Editar ${order.folio}` : 'Nueva orden de acarreo'}</SectionTitle>
        <TouchableOpacity onPress={onClose}><Text style={{ color: colors.primary, fontWeight: '700' }}>Cerrar</Text></TouchableOpacity>
      </View>

      <SectionLabel>Ruta</SectionLabel>
      <FieldLabel>Cliente emisor</FieldLabel>
      <Dropdown value={clientFrom} options={clientOpts} onChange={setClientFrom} placeholder="Cliente / proyecto emisor" />
      <FieldLabel>Cliente receptor</FieldLabel>
      <Dropdown value={clientTo} options={clientOpts} onChange={setClientTo} placeholder="Cliente / proyecto receptor" />
      <FieldLabel>Origen *</FieldLabel>
      <Dropdown value={origin} options={locOpts} onChange={setOrigin} placeholder="Ubicación de origen" clearable={false} />
      <FieldLabel>Destino *</FieldLabel>
      <Dropdown value={dest} options={locOpts} onChange={setDest} placeholder="Ubicación de destino" clearable={false} />
      <FieldLabel>Salida requerida</FieldLabel>
      <DateField value={depart} onChange={setDepart} />
      <FieldLabel>Llegada requerida</FieldLabel>
      <DateField value={arrive} onChange={setArrive} />

      <SectionLabel>Unidad y chofer</SectionLabel>
      <FieldLabel>Chuto</FieldLabel>
      <Dropdown value={truckId} options={truckOpts} onChange={setTruckId} placeholder="Camión de arrastre" />
      <FieldLabel>Remolque (batea / lowboy)</FieldLabel>
      <Dropdown value={trailerId} options={trailerOpts} onChange={setTrailerId} placeholder="Remolque" />
      <FieldLabel>Chofer</FieldLabel>
      <Dropdown value={driverId} options={driverOpts} onChange={setDriverId} placeholder="Chofer" />

      <SectionLabel>Equipos a trasladar *</SectionLabel>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{sel.size} seleccionado(s)</Text>
        <Text style={{ color: trailer?.max_load_ton != null && totalTon > Number(trailer.max_load_ton) ? colors.danger : colors.text, fontWeight: '800', fontSize: 13 }}>
          ⚖️ {totalTon.toFixed(1)} t{trailer?.max_load_ton != null ? ` / ${trailer.max_load_ton} t` : ''}
        </Text>
      </View>
      <TextInput value={machSearch} onChangeText={setMachSearch} placeholder="🔎 Buscar máquina…" placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: spacing.xs }} />
      <View style={{ maxHeight: 220, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}>
        <ScrollView nestedScrollEnabled>
          {machList.slice(0, 80).map((m) => {
            const on = sel.has(m.id);
            return (
              <TouchableOpacity key={m.id} onPress={() => toggle(m.id)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: on ? colors.primary : 'transparent' }}>
                <Text style={{ fontSize: 16 }}>{on ? '☑️' : '⬜'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{m.code}</Text>
                  <Text style={{ color: on ? colors.primaryContrast : colors.muted, fontSize: 11 }}>
                    {[m.serial, m.tipo, m.weight_ton != null ? `${m.weight_ton} t` : 'sin peso'].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <SectionLabel>Ruta y viáticos (opcional)</SectionLabel>
      <FieldLabel>Distancia estimada (km)</FieldLabel>
      <TextInput value={km} onChangeText={(t) => setKm(onlyDecimal(t))} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
      <FieldLabel>Peajes estimados</FieldLabel>
      <TextInput value={tolls} onChangeText={(t) => setTolls(onlyDecimal(t))} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
      <FieldLabel>Viáticos otorgados</FieldLabel>
      <TextInput value={perDiem} onChangeText={(t) => setPerDiem(onlyDecimal(t))} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
      <FieldLabel>Notas</FieldLabel>
      <TextInput value={notes} onChangeText={setNotes} placeholder="Observaciones…" placeholderTextColor={colors.muted} multiline
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, minHeight: 60 }} />

      {warnings.length ? (
        <Card style={{ marginTop: spacing.md, borderColor: hasError ? colors.danger : '#D97706', borderWidth: 1 }}>
          <Text style={{ color: colors.text, fontWeight: '800', marginBottom: 4 }}>⚠️ Validaciones</Text>
          {warnings.map((w, i) => (
            <Text key={i} style={{ color: w.level === 'error' ? colors.danger : '#B45309', fontSize: 12.5, marginTop: 2 }}>
              {w.level === 'error' ? '⛔' : '•'} {w.text}
            </Text>
          ))}
          {hasError && isAdmin ? (
            <TouchableOpacity onPress={() => setForced((f) => !f)} style={{ marginTop: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Text style={{ fontSize: 18 }}>{forced ? '☑️' : '⬜'}</Text>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Forzar guardado (administrador)</Text>
            </TouchableOpacity>
          ) : null}
        </Card>
      ) : null}

      <TouchableOpacity onPress={save} disabled={saving}
        style={{ backgroundColor: hasError && !forced ? colors.muted : colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.xl }}>
        <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 15 }}>{saving ? 'Guardando…' : order ? 'Guardar cambios' : 'Crear orden'}</Text>
      </TouchableOpacity>
    </Screen>
  );
}
