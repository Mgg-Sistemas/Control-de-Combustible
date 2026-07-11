import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { Screen, Card, Loading } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { Machinery, MaintenanceMaterial, OperatorAssignment } from '../types/database';
import { insertMachineDispatch } from '../lib/dispatches';
import { upsertMachineRound } from '../lib/machineRounds';
import { captureAndUploadPhoto } from '../lib/photo';
import { captureLocation, warmLocation } from '../lib/location';
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
  const [view, setView] = useState<'home' | 'fuel' | 'maint' | 'jini' | 'jfin'>('home');

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
  const [asg, setAsg] = useState<OperatorAssignment | null>(null); // asignación (operador) activa
  const [nowTick, setNowTick] = useState<Date>(new Date());
  // Formulario de jornada: operador + horómetro.
  const [opFirst, setOpFirst] = useState('');
  const [opLast, setOpLast] = useState('');
  const [opCedula, setOpCedula] = useState('');
  // Vínculo con RRHH: al escribir la cédula, se busca en Empleados y se autocompleta.
  const [empMatch, setEmpMatch] = useState<{ name: string; cargo: string | null } | null>(null);
  const [empSearching, setEmpSearching] = useState(false);
  const [hIni, setHIni] = useState('');
  const [hFin, setHFin] = useState('');
  const [horPhoto, setHorPhoto] = useState<string | null>(null);
  const [horUploading, setHorUploading] = useState(false);
  // Reloj en vivo (refresca cada 20 s) para mostrar la hora de Caracas y la jornada.
  useEffect(() => {
    const t = setInterval(() => setNowTick(new Date()), 20000);
    return () => clearInterval(t);
  }, []);
  // Pre-calienta el GPS para que "MAPA" marque la ubicación al instante.
  useEffect(() => { warmLocation(); }, []);

  // Vínculo con RRHH: al escribir la cédula (solo dígitos), buscar en Empleados y
  // autocompletar nombre/apellido. La lectura de employees es pública (sirve por QR).
  useEffect(() => {
    const ci = opCedula.trim();
    if (ci.length < 6) { setEmpMatch(null); setEmpSearching(false); return; }
    let cancel = false;
    setEmpSearching(true);
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('employees')
        .select('first_name, last_name, cargo, cedula')
        .eq('cedula', ci)
        .limit(1);
      if (cancel) return;
      const emp = (data && data[0]) as any;
      if (emp) {
        setOpFirst((emp.first_name || '').trim());
        setOpLast((emp.last_name || '').trim());
        setEmpMatch({ name: `${emp.first_name || ''} ${emp.last_name || ''}`.trim(), cargo: emp.cargo ?? null });
      } else {
        setEmpMatch(null);
      }
      setEmpSearching(false);
    }, 450);
    return () => { cancel = true; clearTimeout(t); };
  }, [opCedula]);

  useEffect(() => {
    (async () => {
      // Sin login: si no hay sesión (se abrió por QR), iniciar una ANÓNIMA para
      // poder leer la máquina y registrar la jornada.
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) { try { await supabase.auth.signInAnonymously(); } catch {} }
      const [{ data: m }, { data: prof }, { data: tk }] = await Promise.all([
        supabase.from('machinery').select('id, code, tipo, referencia, daily_consumption_l, entry_at, exit_at, entry_date, last_horometro, company:company_id(name)').eq('id', machineId).maybeSingle(),
        uid ? supabase.from('profiles').select('full_name').eq('id', uid).maybeSingle() : Promise.resolve({ data: null } as any),
        supabase.from('tanks').select('id, name, fuel').eq('active', true).order('name'),
      ]);
      setMachine(m ? ({ ...(m as any), companyName: (m as any).company?.name ?? 'Sin empresa' }) : null);
      // Al escanear SIEMPRE se muestra "INICIO DE JORNADA": cada operador empieza
      // su propia jornada (no se hereda el estado de la máquina ni de otro operador).
      setJornadaActive(false);
      setJornadaStartAt(null);
      setJornadaStartDate(null);
      setAsg(null);
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

  // Abre el formulario de INICIO (operador + horómetro) precargando el horómetro
  // con la última lectura de la máquina (se arrastra del cierre anterior).
  const abrirInicio = () => {
    setNotice(null);
    setOpFirst(''); setOpLast(''); setOpCedula(''); setEmpMatch(null);
    setHIni(machine?.last_horometro != null ? String(machine.last_horometro) : '');
    setHorPhoto(null);
    setView('jini');
  };
  const abrirFin = () => {
    setNotice(null);
    setHFin('');
    setView('jfin');
  };

  // Foto del horómetro (cámara → sube y guarda la URL).
  const tomarFotoHorometro = async () => {
    if (!machine) return;
    setHorUploading(true);
    const r = await captureAndUploadPhoto(machine.id, 'horometro');
    setHorUploading(false);
    if (!r.ok) { if (r.error) setNotice('⚠️ ' + r.error); return; }
    setHorPhoto(r.url ?? null);
  };

  // ── INICIO DE JORNADA: registra operador (nombre/apellido/cédula) + horómetro
  //    inicial y foto. Regla: 1 máquina por operador por día. Marca "En obra".
  const confirmarInicio = async () => {
    if (!machine) return;
    const first = opFirst.trim(), last = opLast.trim(), ci = opCedula.trim();
    if (!first || !last || !ci) { setNotice('❌ Completa nombre, apellido y cédula.'); return; }
    const hi = Number((hIni || '').replace(',', '.'));
    if (!isFinite(hi) || hi < 0) { setNotice('❌ Ingresa el horómetro inicial.'); return; }
    setJornadaBusy(true); setNotice(null);
    const now = new Date();
    const { iso, hour } = caracasParts(now);
    const sh = shiftOf(hour);

    // Regla: un operador (cédula) no puede tener OTRA máquina el mismo día.
    const { data: dup } = await supabase
      .from('operator_assignments')
      .select('id, machinery_id')
      .eq('cedula', ci)
      .eq('work_date', iso)
      .maybeSingle();
    if (dup && (dup as any).machinery_id !== machine.id) {
      setJornadaBusy(false);
      setNotice('❌ Esa cédula ya tiene otra máquina asignada hoy. Un operador solo puede tener 1 máquina por día.');
      return;
    }

    const full = `${first} ${last}`;
    // 1) Asignación del operador (upsert por cédula+día → si reabre la misma máquina, actualiza).
    const asgPayload: any = {
      first_name: first, last_name: last, cedula: ci, machinery_id: machine.id,
      company_name: machine.companyName ?? null, work_date: iso, shift: sh.key,
      started_at: now.toISOString(), ended_at: null, worked_hours: null,
      horometro_inicial: hi, horometro_final: null, horometro_photo: horPhoto, created_by: uid || null,
    };
    const { data: asgRow, error: eAsg } = await supabase
      .from('operator_assignments')
      .upsert(asgPayload, { onConflict: 'cedula,work_date' })
      .select()
      .single();
    // 2) Máquina "En obra" + 3) ronda con operador + horómetro inicial.
    const roundPatch: any = sh.key === 'day'
      ? { day_operator: full, day_operator_ci: ci, horometro_inicial: hi, horometro_photo: horPhoto }
      : { night_operator: full, night_operator_ci: ci, horometro_inicial: hi, horometro_photo: horPhoto };
    const [{ error: e2 }, r3] = await Promise.all([
      supabase.from('machinery').update({ entry_at: now.toISOString(), entry_date: iso, exit_at: null, exit_date: null }).eq('id', machine.id),
      upsertMachineRound(machine.id, iso, roundPatch, uid),
    ]);
    // Los operadores NO tienen usuario: solo quedan registrados en el módulo
    // OPERADORES (tabla operator_assignments), no en la lista de Usuarios.
    setJornadaBusy(false);
    if (eAsg || e2 || r3.error) { setNotice('❌ ' + (eAsg?.message || e2?.message || r3.error)); return; }
    setJornadaActive(true);
    setJornadaStartAt(now.toISOString());
    setJornadaStartDate(iso);
    setAsg((asgRow as OperatorAssignment) ?? null);
    setView('home');
    setNotice(`✅ Jornada iniciada · ${full} · ${caracasClock(now)} (Caracas) · ${sh.label} · Horómetro inicial ${hi}.`);
  };

  // ── FIN DE JORNADA: horómetro final → horas = HF − HI, se registra en la ronda
  //    (turno según el inicio), se arrastra HF como próximo inicial y se marca salida.
  const confirmarFin = async () => {
    if (!machine) return;
    const start = jornadaStartAt ? new Date(jornadaStartAt) : new Date();
    const roundDate = jornadaStartDate || asg?.work_date || caracasParts(start).iso;
    const hi = asg?.horometro_inicial != null ? Number(asg.horometro_inicial) : (machine.last_horometro != null ? Number(machine.last_horometro) : 0);
    const hf = Number((hFin || '').replace(',', '.'));
    if (!isFinite(hf)) { setNotice('❌ Ingresa el horómetro final.'); return; }
    if (hf < hi) { setNotice(`❌ El horómetro final (${hf}) no puede ser menor al inicial (${hi}).`); return; }
    setJornadaBusy(true); setNotice(null);
    const now = new Date();
    const hours = Math.round((hf - hi) * 100) / 100; // total de horas = HF − HI
    const sh = shiftOf(caracasParts(start).hour);
    const full = asg ? `${asg.first_name} ${asg.last_name}` : (fullName || null);
    const ci = asg?.cedula ?? null;
    const roundPatch: any = sh.key === 'day'
      ? { day_hours: hours, day_operator: full, day_operator_ci: ci, horometro_final: hf }
      : { night_hours: hours, night_operator: full, night_operator_ci: ci, horometro_final: hf };
    const ops: PromiseLike<any>[] = [
      supabase.from('machinery').update({ exit_at: now.toISOString(), exit_date: roundDate, last_horometro: hf }).eq('id', machine.id),
      upsertMachineRound(machine.id, roundDate, roundPatch, uid),
    ];
    if (asg) ops.push(supabase.from('operator_assignments').update({ ended_at: now.toISOString(), worked_hours: hours, horometro_final: hf }).eq('id', asg.id));
    const results = await Promise.all(ops);
    setJornadaBusy(false);
    const err = results.find((r: any) => r?.error)?.error;
    if (err) { setNotice('❌ ' + (err.message || err)); return; }
    setJornadaActive(false);
    setJornadaStartAt(null);
    setAsg(null);
    setMachine((p) => (p ? { ...p, last_horometro: hf } : p));
    setView('home');
    setNotice(`✅ Jornada finalizada · ${sh.label} · Horómetro ${hi} → ${hf} = ${hours} h registradas en Control de maquinaria.`);
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
            onPress={jornadaActive ? abrirFin : abrirInicio}
            disabled={jornadaBusy}
            activeOpacity={0.85}
            style={{ backgroundColor: jornadaActive ? '#1E9E4A' : '#6B7280', borderRadius: radius.lg, paddingVertical: spacing.xl, alignItems: 'center', marginBottom: spacing.md, opacity: jornadaBusy ? 0.7 : 1 }}
          >
            <Text style={{ fontSize: 40 }}>{jornadaActive ? '🟢' : '⏱️'}</Text>
            <Text style={{ color: '#fff', fontWeight: '900', fontSize: 18, marginTop: spacing.xs, letterSpacing: 0.5 }}>
              {jornadaBusy ? 'GUARDANDO…' : jornadaActive ? 'FIN DE JORNADA' : 'INICIO DE JORNADA'}
            </Text>
            <Text style={{ color: '#fff', opacity: 0.95, fontSize: 12, marginTop: 6, textAlign: 'center' }}>
              {jornadaActive && asg
                ? `${asg.first_name} ${asg.last_name} · desde ${caracasClock(new Date(asg.started_at))} · Horómetro inicial ${asg.horometro_inicial ?? '—'}`
                : jornadaActive && jornadaStartAt
                ? `En obra desde ${caracasClock(new Date(jornadaStartAt))} · ${shiftOf(caracasParts(new Date(jornadaStartAt)).hour).label}`
                : `Caracas: ${caracasClock(nowTick)} · ${shiftOf(caracasParts(nowTick).hour).label}`}
            </Text>
          </TouchableOpacity>

          {big('#D22B2B', '⛽', 'COMBUSTIBLE', () => { setNotice(null); setView('fuel'); })}
          {big('#EA7317', '🗺️', 'MAPA', () => { setNotice(null); marcarUbicacion(); })}
          {big('#2563EB', '🛠️', 'AVERÍA DE MAQUINARIA', () => { setNotice(null); setView('maint'); })}
          {locating ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, justifyContent: 'center' }}>
              <ActivityIndicator color={colors.primary} /><Text style={{ color: colors.muted }}>Obteniendo ubicación…</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {view === 'jini' ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '900', fontSize: 16, marginBottom: spacing.xs, letterSpacing: 0.5 }}>⏱️ INICIO DE JORNADA</Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>Ingresa tu cédula (no necesita iniciar sesión).</Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>Cédula</Text>
          <TextInput
            value={opCedula}
            onChangeText={(t) => setOpCedula(t.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            inputMode="numeric"
            placeholder="Solo números"
            placeholderTextColor={colors.muted}
            style={input}
          />
          {/* Resultado del cruce con Empleados (RRHH). */}
          {opCedula.trim().length >= 6 ? (
            empSearching ? (
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>Buscando en empleados…</Text>
            ) : empMatch ? (
              <View style={{ marginTop: 6, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.success }}>
                <Text style={{ color: colors.success, fontWeight: '800', fontSize: 13 }}>✓ {empMatch.name}</Text>
                {empMatch.cargo ? <Text style={{ color: colors.muted, fontSize: 12 }}>{empMatch.cargo} · registrado en RRHH</Text> : <Text style={{ color: colors.muted, fontSize: 12 }}>Registrado en RRHH</Text>}
              </View>
            ) : (
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>No estás en la lista de empleados. Escribe tu nombre y apellido abajo.</Text>
            )
          ) : null}
          {/* Nombre/apellido: SOLO si se escribió una cédula que no está en RRHH (respaldo). */}
          {opCedula.trim().length >= 6 && !empSearching && !empMatch ? (
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Nombre</Text>
                <TextInput value={opFirst} onChangeText={setOpFirst} placeholder="Nombre" placeholderTextColor={colors.muted} style={input} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Apellido</Text>
                <TextInput value={opLast} onChangeText={setOpLast} placeholder="Apellido" placeholderTextColor={colors.muted} style={input} />
              </View>
            </View>
          ) : null}
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Horómetro inicial</Text>
          <TextInput value={hIni} onChangeText={setHIni} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.muted} style={input} />
          {machine.last_horometro != null ? (
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>Última lectura registrada: {machine.last_horometro}. (Se arrastra del cierre anterior.)</Text>
          ) : null}
          <TouchableOpacity onPress={tomarFotoHorometro} disabled={horUploading} style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: horPhoto ? colors.success : colors.border, backgroundColor: colors.surfaceAlt }}>
            <Text style={{ color: horPhoto ? colors.success : colors.text, fontWeight: '700' }}>{horUploading ? 'Subiendo…' : horPhoto ? '✓ Foto del horómetro adjunta' : '📷 Foto del horómetro'}</Text>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <TouchableOpacity onPress={() => setView('home')} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Volver</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={confirmarInicio} disabled={jornadaBusy} style={{ flex: 2, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: '#1E9E4A', opacity: jornadaBusy ? 0.7 : 1 }}>
              <Text style={{ color: '#fff', fontWeight: '800' }}>{jornadaBusy ? 'Guardando…' : '🟢 Iniciar jornada'}</Text>
            </TouchableOpacity>
          </View>
        </Card>
      ) : null}

      {view === 'jfin' ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '900', fontSize: 16, marginBottom: spacing.xs, letterSpacing: 0.5 }}>🔚 FIN DE JORNADA</Text>
          {asg ? (
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
              {asg.first_name} {asg.last_name} · C.I {asg.cedula} · Horómetro inicial {asg.horometro_inicial ?? '—'}
            </Text>
          ) : null}
          <Text style={{ color: colors.muted, fontSize: 12 }}>Horómetro final</Text>
          <TextInput value={hFin} onChangeText={setHFin} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.muted} style={input} />
          {(() => {
            const hiRef = asg?.horometro_inicial != null ? Number(asg.horometro_inicial) : (machine.last_horometro != null ? Number(machine.last_horometro) : 0);
            const hfN = Number((hFin || '').replace(',', '.'));
            const ok = isFinite(hfN) && hfN >= hiRef;
            return (
              <Text style={{ color: ok ? colors.success : colors.muted, fontSize: 12, marginTop: 4, fontWeight: '700' }}>
                {ok ? `Total de horas = ${Math.round((hfN - hiRef) * 100) / 100} h (HF − HI)` : `HF − HI (HI = ${hiRef})`}
              </Text>
            );
          })()}
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <TouchableOpacity onPress={() => setView('home')} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Volver</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={confirmarFin} disabled={jornadaBusy} style={{ flex: 2, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: '#6B7280', opacity: jornadaBusy ? 0.7 : 1 }}>
              <Text style={{ color: '#fff', fontWeight: '800' }}>{jornadaBusy ? 'Guardando…' : '⏹ Finalizar jornada'}</Text>
            </TouchableOpacity>
          </View>
        </Card>
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
