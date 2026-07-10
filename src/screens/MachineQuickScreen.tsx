import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { Screen, Card, Loading } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { Machinery, MaintenanceMaterial } from '../types/database';
import { insertMachineDispatch } from '../lib/dispatches';
import { upsertMachineRound } from '../lib/machineRounds';
import { captureLocation } from '../lib/location';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

function todayISO(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// ── Hora real de Caracas (America/Caracas, UTC−4, sin horario de verano) ──────
const CARACAS_TZ = 'America/Caracas';
/** Fecha ISO y hora (0–23) del momento `d` en Caracas. */
function caracasParts(d: Date): { iso: string; hour: number; minute: number } {
  const p: any = new Intl.DateTimeFormat('en-US', {
    timeZone: CARACAS_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d).reduce((a: any, x) => { a[x.type] = x.value; return a; }, {});
  return { iso: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute) };
}
/** Reloj de Caracas en formato 12 h con a. m./p. m. (ej. "06:45 p. m."). */
function caracasClock(d: Date): string {
  return new Intl.DateTimeFormat('es-VE', { timeZone: CARACAS_TZ, hour: '2-digit', minute: '2-digit', hour12: true }).format(d);
}
/** Jornada según la hora de inicio: día 6:00–17:59, noche el resto. */
function shiftOf(hour: number): { key: 'day' | 'night'; label: string } {
  return hour >= 6 && hour < 18
    ? { key: 'day', label: '☀️ Jornada de día' }
    : { key: 'night', label: '🌙 Jornada de noche' };
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

  // Jornada (INICIO / FIN) sincronizada con Control de maquinaria.
  const [jornadaActive, setJornadaActive] = useState(false);
  const [jornadaStartAt, setJornadaStartAt] = useState<string | null>(null);   // entry_at (ISO UTC)
  const [jornadaStartDate, setJornadaStartDate] = useState<string | null>(null); // día (ISO Caracas) de la ronda
  const [jornadaBusy, setJornadaBusy] = useState(false);
  const [nowTick, setNowTick] = useState<Date>(new Date());
  // Reloj en vivo (refresca cada 20 s) para mostrar la hora de Caracas y la jornada.
  useEffect(() => {
    const t = setInterval(() => setNowTick(new Date()), 20000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    (async () => {
      const [{ data: m }, { data: prof }, { data: tk }] = await Promise.all([
        supabase.from('machinery').select('id, code, tipo, referencia, daily_consumption_l, entry_at, exit_at, entry_date, company:company_id(name)').eq('id', machineId).maybeSingle(),
        uid ? supabase.from('profiles').select('full_name').eq('id', uid).maybeSingle() : Promise.resolve({ data: null } as any),
        supabase.from('tanks').select('id, name, fuel').eq('active', true).order('name'),
      ]);
      setMachine(m ? ({ ...(m as any), companyName: (m as any).company?.name ?? 'Sin empresa' }) : null);
      // Jornada activa = tiene entrada y aún no ha marcado salida (o la salida es previa a la entrada).
      const eAt = (m as any)?.entry_at as string | null;
      const xAt = (m as any)?.exit_at as string | null;
      const active = !!eAt && (!xAt || new Date(xAt) < new Date(eAt));
      setJornadaActive(active);
      setJornadaStartAt(active ? eAt : null);
      setJornadaStartDate(active ? ((m as any)?.entry_date ?? caracasParts(new Date(eAt as string)).iso) : null);
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

  // ── INICIO DE JORNADA: marca la entrada (hora real) y la sincroniza con
  //    Control de maquinaria (queda "En obra"). La jornada (día/noche) se define
  //    por la hora de Caracas de inicio.
  const iniciarJornada = async () => {
    if (!machine) return;
    setJornadaBusy(true); setNotice(null);
    const now = new Date();
    const { iso, hour } = caracasParts(now);
    const patch = { entry_at: now.toISOString(), entry_date: iso, exit_at: null, exit_date: null };
    const { error } = await supabase.from('machinery').update(patch).eq('id', machine.id);
    setJornadaBusy(false);
    if (error) { setNotice('❌ ' + error.message); return; }
    setJornadaActive(true);
    setJornadaStartAt(now.toISOString());
    setJornadaStartDate(iso);
    setNotice(`✅ Jornada iniciada a las ${caracasClock(now)} (Caracas) · ${shiftOf(hour).label}.`);
  };

  // ── FIN DE JORNADA: marca la salida y registra las horas trabajadas en la
  //    ronda del día (turno día o noche según la hora de inicio) + operador.
  const finalizarJornada = async () => {
    if (!machine || !jornadaStartAt) return;
    setJornadaBusy(true); setNotice(null);
    const now = new Date();
    const start = new Date(jornadaStartAt);
    let hours = (now.getTime() - start.getTime()) / 3600000;
    if (!isFinite(hours) || hours < 0) hours = 0;
    const sh = shiftOf(caracasParts(start).hour);
    const roundDate = jornadaStartDate || caracasParts(start).iso;
    const shiftHours = Math.round(Math.min(12, hours) * 100) / 100; // una jornada no excede 12 h por turno
    const patch = sh.key === 'day'
      ? { day_hours: shiftHours, day_operator: fullName || null }
      : { night_hours: shiftHours, night_operator: fullName || null };
    const [{ error: e1 }, r2] = await Promise.all([
      supabase.from('machinery').update({ exit_at: now.toISOString(), exit_date: roundDate }).eq('id', machine.id),
      upsertMachineRound(machine.id, roundDate, patch, uid),
    ]);
    setJornadaBusy(false);
    if (e1 || r2.error) { setNotice('❌ ' + (e1?.message || r2.error)); return; }
    setJornadaActive(false);
    setJornadaStartAt(null);
    setNotice(`✅ Jornada finalizada a las ${caracasClock(now)} (Caracas) · ${sh.label} · ${shiftHours} h registradas en Control de maquinaria.`);
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
          {/* INICIO / FIN DE JORNADA — verde cuando está en obra, gris cuando no. */}
          <TouchableOpacity
            onPress={jornadaActive ? finalizarJornada : iniciarJornada}
            disabled={jornadaBusy}
            activeOpacity={0.85}
            style={{ backgroundColor: jornadaActive ? '#1E9E4A' : '#6B7280', borderRadius: radius.lg, paddingVertical: spacing.xl, alignItems: 'center', marginBottom: spacing.md, opacity: jornadaBusy ? 0.7 : 1 }}
          >
            <Text style={{ fontSize: 40 }}>{jornadaActive ? '🟢' : '⏱️'}</Text>
            <Text style={{ color: '#fff', fontWeight: '900', fontSize: 18, marginTop: spacing.xs, letterSpacing: 0.5 }}>
              {jornadaBusy ? 'GUARDANDO…' : jornadaActive ? 'FIN DE JORNADA' : 'INICIO DE JORNADA'}
            </Text>
            <Text style={{ color: '#fff', opacity: 0.95, fontSize: 12, marginTop: 6, textAlign: 'center' }}>
              {jornadaActive && jornadaStartAt
                ? `En obra desde ${caracasClock(new Date(jornadaStartAt))} · ${shiftOf(caracasParts(new Date(jornadaStartAt)).hour).label}`
                : `Caracas: ${caracasClock(nowTick)} · ${shiftOf(caracasParts(nowTick).hour).label}`}
            </Text>
          </TouchableOpacity>

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
