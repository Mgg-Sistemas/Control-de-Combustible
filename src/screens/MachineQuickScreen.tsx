import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { Screen, Card, Loading } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { Machinery, MaintenanceMaterial } from '../types/database';
import { insertMachineDispatch } from '../lib/dispatches';
import { captureLocation } from '../lib/location';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

function todayISO(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
const numOrNull = (s: string) => { const n = Number((s || '').replace(',', '.')); return isFinite(n) && s.trim() !== '' ? n : null; };

const MATERIALS: { key: MaintenanceMaterial; label: string; icon: string }[] = [
  { key: 'caucho', label: 'Caucho', icon: '🛞' },
  { key: 'aceite', label: 'Aceite', icon: '🛢️' },
  { key: 'filtro', label: 'Filtro', icon: '🧴' },
  { key: 'repuesto', label: 'Repuesto', icon: '🔩' },
];

/**
 * Vista RÁPIDA de una máquina (se abre al escanear su QR). Muestra 3 acciones:
 *  🔴 Combustible (ingreso de litros)  🟢 Mapa (marca coordenadas)  🔵 Avería
 *  (mantenimiento: caucho/aceite/filtro/repuesto con la cantidad a cambiar).
 */
export default function MachineQuickScreen(props: { machineId?: string; onExit?: () => void; route?: any; navigation?: any }) {
  const { colors } = useTheme();
  const { session } = useAuth();
  const uid = session?.user?.id ?? '';
  // Acepta la máquina por prop (deep-link) o por parámetro de navegación (escáner).
  const machineId: string = props.machineId ?? props.route?.params?.machineId ?? '';
  const onExit = props.onExit ?? (() => props.navigation?.goBack?.());

  const [loading, setLoading] = useState(true);
  const [machine, setMachine] = useState<(Machinery & { companyName?: string }) | null>(null);
  const [fullName, setFullName] = useState('');
  const [tanks, setTanks] = useState<{ id: string; name: string; fuel: string }[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<'home' | 'fuel' | 'maint'>('home');

  // Combustible
  const [fLiters, setFLiters] = useState('');
  const [fTank, setFTank] = useState('');
  const [fDate, setFDate] = useState(todayISO());
  const [savingFuel, setSavingFuel] = useState(false);

  // Mapa
  const [locating, setLocating] = useState(false);

  // Mantenimiento
  const [material, setMaterial] = useState<MaintenanceMaterial | null>(null);
  const [qty, setQty] = useState('');
  const [maintNote, setMaintNote] = useState('');
  const [savingMaint, setSavingMaint] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: m }, { data: prof }, { data: tk }] = await Promise.all([
        supabase.from('machinery').select('id, code, tipo, referencia, daily_consumption_l, company:company_id(name)').eq('id', machineId).maybeSingle(),
        uid ? supabase.from('profiles').select('full_name').eq('id', uid).maybeSingle() : Promise.resolve({ data: null } as any),
        supabase.from('tanks').select('id, name, fuel').eq('active', true).order('name'),
      ]);
      setMachine(m ? ({ ...(m as any), companyName: (m as any).company?.name ?? 'Sin empresa' }) : null);
      setFullName((prof as any)?.full_name ?? '');
      const tks = (tk ?? []) as { id: string; name: string; fuel: string }[];
      setTanks(tks);
      setFTank(tks[0]?.id ?? '');
      setLoading(false);
    })();
  }, [machineId, uid]);

  const registrarCombustible = async () => {
    if (!machine) return;
    setSavingFuel(true);
    setNotice(null);
    const { error } = await insertMachineDispatch({
      machineryId: machine.id,
      dispatchDate: fDate,
      liters: Number((fLiters || '').replace(',', '.')),
      tankId: fTank,
      operator: fullName,
      dailyConsumptionL: machine.daily_consumption_l,
      createdBy: uid,
    });
    setSavingFuel(false);
    if (error) { setNotice('❌ ' + error); return; }
    setFLiters('');
    setNotice('✅ Combustible ingresado a ' + machine.code + '.');
    setView('home');
  };

  const marcarUbicacion = async () => {
    if (!machine) return;
    setLocating(true);
    setNotice(null);
    const r = await captureLocation(machine.id);
    setLocating(false);
    if (!r.ok) { setNotice('❌ ' + (r.error ?? 'No se pudo obtener la ubicación.')); return; }
    setNotice(`✅ Ubicación marcada en el mapa (${r.lat}, ${r.lng}).`);
  };

  const registrarMantenimiento = async () => {
    if (!machine || !material) return;
    setSavingMaint(true);
    setNotice(null);
    const { error } = await supabase.from('maintenance_requests').insert({
      machinery_id: machine.id,
      material,
      quantity: numOrNull(qty),
      notes: maintNote.trim() || null,
      status: 'pendiente',
      requested_by: uid || null,
    });
    setSavingMaint(false);
    if (error) { setNotice('❌ ' + error.message); return; }
    setMaterial(null); setQty(''); setMaintNote('');
    setNotice('✅ Solicitud de mantenimiento registrada.');
    setView('home');
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  if (loading) return <Screen><Loading /></Screen>;
  if (!machine) {
    return (
      <Screen>
        <Card><Text style={{ color: colors.danger, fontWeight: '700' }}>No se encontró la máquina de este código QR.</Text></Card>
        <TouchableOpacity onPress={onExit} style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>← Ir al sistema</Text>
        </TouchableOpacity>
      </Screen>
    );
  }

  const big = (bg: string, icon: string, label: string, onPress: () => void) => (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={{ backgroundColor: bg, borderRadius: radius.lg, paddingVertical: spacing.xl, alignItems: 'center', marginBottom: spacing.md }}>
      <Text style={{ fontSize: 40 }}>{icon}</Text>
      <Text style={{ color: '#fff', fontWeight: '900', fontSize: 18, marginTop: spacing.xs, letterSpacing: 0.5 }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.muted, fontSize: 12 }}>Máquina</Text>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: '900' }}>{machine.code}</Text>
          <Text style={{ color: colors.muted, fontSize: 13 }}>{(machine.tipo || 'Sin tipo')}{machine.referencia ? ` · ${machine.referencia}` : ''} · {machine.companyName}</Text>
        </View>
        <TouchableOpacity onPress={onExit} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Sistema</Text>
        </TouchableOpacity>
      </View>

      {notice ? (
        <Card><Text style={{ color: notice.startsWith('❌') ? colors.danger : colors.success, fontWeight: '700' }}>{notice}</Text></Card>
      ) : null}

      {view === 'home' ? (
        <View style={{ marginTop: spacing.md }}>
          {big('#D22B2B', '⛽', 'COMBUSTIBLE', () => { setNotice(null); setView('fuel'); })}
          {big('#1E9E4A', '🗺️', 'MAPA', () => { setNotice(null); marcarUbicacion(); })}
          {big('#2563EB', '🛠️', 'AVERÍA DE MAQUINARIA', () => { setNotice(null); setView('maint'); })}
          {locating ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, justifyContent: 'center' }}>
              <ActivityIndicator color={colors.primary} /><Text style={{ color: colors.muted }}>Obteniendo ubicación…</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {view === 'fuel' ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16, marginBottom: spacing.xs }}>⛽ Ingreso de combustible</Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>Litros</Text>
          <TextInput value={fLiters} onChangeText={setFLiters} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.muted} style={input} />
          {machine.daily_consumption_l != null && Number(machine.daily_consumption_l) > 0 ? (
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>Tope: {(Number(machine.daily_consumption_l) * 2).toLocaleString()} L (2× consumo diario).</Text>
          ) : null}
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Tanque de origen</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4 }}>
            {tanks.map((t) => {
              const on = fTank === t.id;
              return (
                <TouchableOpacity key={t.id} onPress={() => setFTank(t.id)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                  <Text style={{ color: on ? colors.primaryContrast : colors.text, fontSize: 13, fontWeight: on ? '700' : '400' }}>{t.name}</Text>
                </TouchableOpacity>
              );
            })}
            {tanks.length === 0 ? <Text style={{ color: colors.muted, fontSize: 12 }}>No hay tanques activos.</Text> : null}
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <TouchableOpacity onPress={() => setView('home')} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Volver</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={registrarCombustible} disabled={savingFuel} style={{ flex: 2, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: '#D22B2B' }}>
              <Text style={{ color: '#fff', fontWeight: '800' }}>{savingFuel ? 'Guardando…' : '＋ Ingreso'}</Text>
            </TouchableOpacity>
          </View>
        </Card>
      ) : null}

      {view === 'maint' ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '900', fontSize: 16, marginBottom: spacing.sm, letterSpacing: 0.5 }}>MANTENIMIENTO MAQUINARIA</Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Toca el material que se necesita cambiar:</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {MATERIALS.map((mt) => {
              const on = material === mt.key;
              return (
                <TouchableOpacity key={mt.key} onPress={() => setMaterial(mt.key)} style={{ width: '47%', alignItems: 'center', paddingVertical: spacing.lg, borderRadius: radius.lg, borderWidth: 2, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface }}>
                  <Text style={{ fontSize: 34 }}>{mt.icon}</Text>
                  <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '800', marginTop: 4 }}>{mt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {material ? (
            <View style={{ marginTop: spacing.md }}>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Cantidad de {MATERIALS.find((x) => x.key === material)?.label.toLowerCase()} a cambiar</Text>
              <TextInput value={qty} onChangeText={setQty} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.muted} style={input} />
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Nota (opcional)</Text>
              <TextInput value={maintNote} onChangeText={setMaintNote} placeholder="Detalle…" placeholderTextColor={colors.muted} style={input} />
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <TouchableOpacity onPress={() => { setMaterial(null); setView('home'); }} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Volver</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={registrarMantenimiento} disabled={!material || savingMaint} style={{ flex: 2, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: material ? '#2563EB' : colors.border }}>
              <Text style={{ color: '#fff', fontWeight: '800' }}>{savingMaint ? 'Guardando…' : 'Registrar solicitud'}</Text>
            </TouchableOpacity>
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}
