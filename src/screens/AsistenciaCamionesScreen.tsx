import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, Modal, ActivityIndicator } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading, SkeletonList } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import { SurtidoGasoilModal } from '../components/SurtidoGasoil';
import QrScanner from '../components/QrScanner';
import { parseMachineId } from './ScanQrScreen';
import { captureAndUploadPhoto } from '../lib/photo';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { spacing, radius } from '../theme';
import { isVolteoVolqueta } from '../lib/equipos';
import { cmpText, norm } from '../lib/text';
import { getMachineRound, upsertMachineRound, lastHorometroFinal } from '../lib/machineRounds';
import { saveVisit } from '../lib/supervisorVisits';
import { shiftOf, caracasParts } from '../lib/jornada';
import { logAudit } from '../lib/audit';
import { logTruckYard } from '../lib/truckYard';

const CARACAS_TZ = 'America/Caracas';
function caracasToday(): string {
  const p: any = new Intl.DateTimeFormat('en-CA', { timeZone: CARACAS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((a: any, x: any) => { a[x.type] = x.value; return a; }, {});
  return `${p.year}-${p.month}-${p.day}`;
}
function caracasClock(iso: string): string {
  return new Intl.DateTimeFormat('es-VE', { timeZone: CARACAS_TZ, hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso));
}

const AV_MATERIALS: { key: string; label: string; icon: string }[] = [
  { key: 'caucho', label: 'Caucho', icon: '🛞' },
  { key: 'aceite', label: 'Aceite', icon: '🛢️' },
  { key: 'filtro', label: 'Filtro', icon: '🧴' },
  { key: 'repuesto', label: 'Repuesto', icon: '🔩' },
  { key: 'MÁQUINA PARADA', label: 'Máquina parada', icon: '🟡' },
];
const numOrNull = (s: string) => { const n = Number((s || '').replace(',', '.')); return isFinite(n) && s.trim() !== '' ? n : null; };

type Truck = { id: string; code: string; plate: string | null; serial: string | null; companyName: string; latitude: number | null; longitude: number | null };
type Round = { id: string; startAt: string | null; shift: 'day' | 'night' | null; worked: number; iniHoro: number | null };
type Override = { status: 'presente' | 'ausente' };
type Estado = { present: boolean; auto: boolean; hora: string | null; shift: 'day' | 'night' | null };

// Para qué se está eligiendo/escaneando un camión.
type PickFor = 'jornada' | 'averia' | 'gasoil';

/**
 * ASISTENCIA DE CAMIONES (volteos/volquetas). Lista diaria: cada camión sale
 * ✅ PRESENTE automáticamente al iniciar su jornada (con la hora), o el usuario
 * lo marca a mano (Presente/Ausente). Además permite —manual o por escáner—
 * iniciar/finalizar jornada, marcar avería y surtir combustible.
 */
export default function AsistenciaCamionesScreen() {
  const { colors } = useTheme();
  const { session } = useAuth();
  const uid = session?.user?.id ?? '';

  const [fullName, setFullName] = useState('');
  const [date, setDate] = useState(caracasToday());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [rounds, setRounds] = useState<Record<string, Round>>({});
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [q, setQ] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Selector/escáner de camión para una acción (jornada/avería/gasoil).
  const [pickFor, setPickFor] = useState<PickFor | null>(null); // modal "elegir camión"
  const [scanFor, setScanFor] = useState<PickFor | null>(null); // escáner abierto
  const [pickQuery, setPickQuery] = useState('');

  // Jornada (iniciar/finalizar).
  const [jorTruck, setJorTruck] = useState<Truck | null>(null);
  const [jorRound, setJorRound] = useState<Round | null>(null); // si tiene jornada abierta
  const [horoIni, setHoroIni] = useState('');
  const [horoFin, setHoroFin] = useState('');
  const [jorBusy, setJorBusy] = useState(false);

  // Avería.
  const [avTruck, setAvTruck] = useState<Truck | null>(null);
  const [avMaterial, setAvMaterial] = useState<string | null>(null);
  const [avQty, setAvQty] = useState('');
  const [avNote, setAvNote] = useState('');
  const [avPhoto, setAvPhoto] = useState<string | null>(null);
  const [avPhotoUp, setAvPhotoUp] = useState(false);

  // Gasoil.
  const [gasoilId, setGasoilId] = useState<string | null>(null);

  const isToday = date === caracasToday();

  useEffect(() => {
    if (!uid) return;
    supabase.from('profiles').select('full_name').eq('id', uid).maybeSingle()
      .then(({ data }) => setFullName((data as any)?.full_name ?? ''));
  }, [uid]);

  const load = useCallback(async () => {
    setLoading(true);
    // 1) Todos los camiones (volteos/volquetas): se filtran por código en el cliente.
    const { data: machs } = await supabase
      .from('machinery')
      .select('id, code, plate, serial, latitude, longitude, company:company_id(name)')
      .order('code');
    const list = ((machs ?? []) as any[])
      .filter((m) => isVolteoVolqueta(m.code || ''))
      .map((m) => ({
        id: m.id as string, code: m.code ?? '—', plate: m.plate ?? null, serial: m.serial ?? null,
        companyName: m.company?.name ?? 'Sin empresa', latitude: m.latitude ?? null, longitude: m.longitude ?? null,
      })) as Truck[];
    list.sort((a, b) => cmpText(a.code, b.code));
    setTrucks(list);
    // 2) Rondas del día (para saber jornada iniciada = presente automático).
    const { data: rs } = await supabase
      .from('machine_rounds')
      .select('machinery_id, jornada_start_at, jornada_shift, day_hours, night_hours, horometro_inicial')
      .eq('round_date', date);
    const rmap: Record<string, Round> = {};
    ((rs ?? []) as any[]).forEach((r) => {
      rmap[r.machinery_id] = {
        id: r.machinery_id,
        startAt: r.jornada_start_at ?? null,
        shift: (r.jornada_shift ?? null) as any,
        worked: (Number(r.day_hours) || 0) + (Number(r.night_hours) || 0),
        iniHoro: r.horometro_inicial != null ? Number(r.horometro_inicial) : null,
      };
    });
    setRounds(rmap);
    // 3) Ajustes manuales del día.
    const { data: ov } = await supabase
      .from('truck_attendance')
      .select('machinery_id, status')
      .eq('work_date', date);
    const omap: Record<string, Override> = {};
    ((ov ?? []) as any[]).forEach((o) => { omap[o.machinery_id] = { status: o.status }; });
    setOverrides(omap);
    setLoading(false);
  }, [date]);
  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(['machine_rounds', 'truck_attendance'], load);

  // Pull-to-refresh: recarga la lista de camiones/rondas del día.
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  // Estado final de un camión: el ajuste MANUAL manda; si no, PRESENTE cuando
  // inició/tuvo jornada (con la hora), ausente si no hay nada.
  const estadoDe = useCallback((t: Truck): Estado => {
    const r = rounds[t.id];
    const autoPresent = !!(r && (r.startAt || r.worked > 0));
    const ov = overrides[t.id];
    if (ov) return { present: ov.status === 'presente', auto: false, hora: r?.startAt ? caracasClock(r.startAt) : null, shift: r?.shift ?? null };
    return { present: autoPresent, auto: true, hora: r?.startAt ? caracasClock(r.startAt) : null, shift: r?.shift ?? null };
  }, [rounds, overrides]);

  const shown = useMemo(() => {
    const nq = norm(q.trim());
    return trucks.filter((t) => !nq || norm(`${t.code} ${t.plate ?? ''} ${t.serial ?? ''} ${t.companyName}`).includes(nq));
  }, [trucks, q]);

  const presentes = useMemo(() => trucks.filter((t) => estadoDe(t).present).length, [trucks, estadoDe]);

  // Marca manual Presente/Ausente (upsert en truck_attendance).
  const marcar = async (t: Truck, status: 'presente' | 'ausente') => {
    setOverrides((prev) => ({ ...prev, [t.id]: { status } })); // optimista
    const { error } = await supabase.from('truck_attendance').upsert({
      machinery_id: t.id, work_date: date, status, marked_by: uid || null, marked_by_name: fullName || null, marked_at: new Date().toISOString(),
    }, { onConflict: 'machinery_id,work_date' });
    if (error) { setNotice('❌ ' + error.message); load(); return; }
    logAudit('CHECK', 'machinery', t.id, `Asistencia camión · ${t.code} · ${status}`);
  };
  // Quita el ajuste manual → vuelve al automático (según jornada).
  const limpiarMarca = async (t: Truck) => {
    setOverrides((prev) => { const n = { ...prev }; delete n[t.id]; return n; });
    await supabase.from('truck_attendance').delete().eq('machinery_id', t.id).eq('work_date', date);
  };

  // ── Elegir/escanear camión para una acción ────────────────────────────────
  const abrirAccion = (fr: PickFor, t: Truck) => {
    setPickFor(null); setPickQuery('');
    if (fr === 'gasoil') { setGasoilId(t.id); return; }
    if (fr === 'averia') { setAvTruck(t); setAvMaterial(null); setAvQty(''); setAvNote(''); setAvPhoto(null); return; }
    if (fr === 'jornada') { abrirJornada(t); return; }
  };
  const onScan = async (text: string) => {
    const fr = scanFor; setScanFor(null);
    const id = parseMachineId(text);
    if (!id) { setNotice('❌ QR no reconocido.'); return; }
    const t = trucks.find((x) => x.id === id);
    if (!t) { setNotice('❌ Ese QR no es de un volteo/volqueta registrado.'); return; }
    if (fr) abrirAccion(fr, t);
  };

  // ── Jornada del camión ────────────────────────────────────────────────────
  const abrirJornada = async (t: Truck) => {
    setJorBusy(true);
    const r = await getMachineRound(t.id, date);
    const open = (r as any)?.jornada_start_at ?? null;
    if (open) {
      setJorRound({ id: t.id, startAt: open, shift: ((r as any).jornada_shift ?? 'day'), worked: 0, iniHoro: (r as any).horometro_inicial != null ? Number((r as any).horometro_inicial) : null });
      setHoroFin('');
    } else {
      setJorRound(null);
      const last = await lastHorometroFinal(t.id);
      setHoroIni(last != null ? String(last) : '');
    }
    setJorBusy(false);
    setJorTruck(t);
  };
  const iniciarJornada = async () => {
    if (!jorTruck || jorBusy) return;
    const hi = Number((horoIni || '').replace(',', '.'));
    if (!isFinite(hi) || hi < 0) { setNotice('❌ Ingresa el horómetro inicial.'); return; }
    setJorBusy(true);
    const now = new Date();
    const sh = shiftOf(caracasParts(now).hour).key;
    await saveVisit({
      machineryId: jorTruck.id, supervisorId: uid || null, supervisorName: fullName || 'Asistencia',
      visitDate: date, status: 'trabajando', lat: null, lng: null, note: 'Asistencia de camión',
      machineLat: jorTruck.latitude, machineLng: jorTruck.longitude,
    });
    const res = await upsertMachineRound(jorTruck.id, date, { jornada_start_at: now.toISOString(), jornada_shift: sh, horometro_inicial: hi }, uid || null);
    setJorBusy(false);
    if (res.error) { setNotice('❌ ' + res.error); return; }
    logAudit('JORNADA_INICIO', 'machinery', jorTruck.id, `${jorTruck.code} · asistencia`);
    logTruckYard(jorTruck.id, jorTruck.code, 'salida', uid || null, fullName || null); // camión: SALIDA al iniciar
    setNotice(`🟢 Jornada iniciada · ${jorTruck.code} · ${caracasClock(now.toISOString())}. Marcado PRESENTE · SALIDA registrada.`);
    setJorTruck(null); setJorRound(null); load();
  };
  const finalizarJornada = async () => {
    if (!jorTruck || !jorRound?.startAt || jorBusy) return;
    const hf = Number((horoFin || '').replace(',', '.'));
    if (!isFinite(hf) || hf < 0) { setNotice('❌ Ingresa el horómetro final.'); return; }
    setJorBusy(true);
    const horas = Math.max(0, Math.round((Date.now() - new Date(jorRound.startAt).getTime()) / 3600000 * 100) / 100);
    const prev = await getMachineRound(jorTruck.id, date);
    const key = jorRound.shift === 'night' ? 'night_hours' : 'day_hours';
    const base = Number((prev as any)?.[key] ?? 0);
    const res = await upsertMachineRound(jorTruck.id, date, { [key]: Math.round((base + horas) * 100) / 100, horometro_final: hf, jornada_start_at: null }, uid || null);
    setJorBusy(false);
    if (res.error) { setNotice('❌ ' + res.error); return; }
    logAudit('JORNADA_FIN', 'machinery', jorTruck.id, `${jorTruck.code} · ${horas.toFixed(2)} h`);
    logTruckYard(jorTruck.id, jorTruck.code, 'entrada', uid || null, fullName || null); // camión: ENTRADA al finalizar
    setNotice(`🏁 Jornada finalizada · ${jorTruck.code} · ${horas.toFixed(2)} h → Control · ENTRADA registrada.`);
    setJorTruck(null); setJorRound(null); load();
  };

  // ── Avería ────────────────────────────────────────────────────────────────
  const subirFotoAveria = async () => {
    if (!avTruck) return;
    setAvPhotoUp(true);
    const r = await captureAndUploadPhoto(avTruck.id, 'averias');
    setAvPhotoUp(false);
    if (r.ok && r.url) setAvPhoto(r.url);
    else if (r.error) setNotice('❌ ' + r.error);
  };
  const registrarAveria = async () => {
    if (!avTruck || !avMaterial) return;
    setBusy(true);
    const { error } = await supabase.from('maintenance_requests').insert({
      machinery_id: avTruck.id, material: avMaterial, quantity: numOrNull(avQty),
      notes: avNote.trim() || null, status: 'pendiente', requested_by: uid || null, photo_url: avPhoto,
    });
    setBusy(false);
    if (error) { setNotice('❌ ' + error.message); return; }
    const code = avTruck.code;
    setAvTruck(null); setAvMaterial(null); setAvQty(''); setAvNote(''); setAvPhoto(null);
    setNotice(`✅ Avería registrada · ${code}. Va a Mantenimiento.`);
  };

  if (loading) return <Screen><ConfigBanner /><SkeletonList /></Screen>;

  const input = { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;
  const actionBtn = (label: string, color: string, fr: PickFor) => (
    <View style={{ flex: 1 }}>
      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12, textAlign: 'center', marginBottom: 4 }}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <TouchableOpacity onPress={() => { setPickFor(fr); setPickQuery(''); }} style={{ flex: 1, backgroundColor: color, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>📋 Manual</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setScanFor(fr)} style={{ flex: 1, backgroundColor: color, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: 0.85 }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>📷 Escáner</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      <ConfigBanner />
      <SectionTitle>🚚 Asistencia de camiones</SectionTitle>

      {/* Fecha */}
      <Card>
        <DateField value={date} onChange={setDate} maxISO={caracasToday()} />
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          <View style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
            <Text style={{ color: colors.success, fontSize: 22, fontWeight: '900' }}>{presentes}</Text>
            <Text style={{ color: colors.muted, fontSize: 11 }}>Presentes</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
            <Text style={{ color: colors.danger, fontSize: 22, fontWeight: '900' }}>{trucks.length - presentes}</Text>
            <Text style={{ color: colors.muted, fontSize: 11 }}>Ausentes</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
            <Text style={{ color: colors.text, fontSize: 22, fontWeight: '900' }}>{trucks.length}</Text>
            <Text style={{ color: colors.muted, fontSize: 11 }}>Camiones</Text>
          </View>
        </View>
      </Card>

      {notice ? (
        <Card><Text style={{ color: notice.startsWith('✅') || notice.startsWith('🟢') || notice.startsWith('🏁') ? colors.success : colors.danger, fontWeight: '700', fontSize: 12 }}>{notice}</Text></Card>
      ) : null}

      {/* Acciones: manual o por escáner (solo para el día de hoy). */}
      {isToday ? (
        <Card>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {actionBtn('🕒 Jornada', '#0F766E', 'jornada')}
            {actionBtn('🛠️ Avería', '#B45309', 'averia')}
            {actionBtn('⛽ Gasoil', '#15803D', 'gasoil')}
          </View>
        </Card>
      ) : null}

      {/* Buscar camión */}
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, marginBottom: spacing.sm }}>
        <Text style={{ fontSize: 14 }}>🔎</Text>
        <TextInput value={q} onChangeText={setQ} placeholder="Buscar camión: código, placa, serial, empresa…" placeholderTextColor={colors.muted} style={{ flex: 1, color: colors.text, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs }} />
        {q ? <TouchableOpacity onPress={() => setQ('')}><Text style={{ color: colors.primary, fontWeight: '800', paddingHorizontal: spacing.xs }}>✕</Text></TouchableOpacity> : null}
      </View>

      {/* Lista de camiones */}
      {shown.length === 0 ? (
        <EmptyState title="Sin camiones" subtitle="No hay volteos/volquetas que coincidan (se detectan por su código)." />
      ) : shown.map((t) => {
        const e = estadoDe(t);
        return (
          <Card key={t.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: e.present ? colors.success : colors.danger }} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }} numberOfLines={1}>🚚 {t.code} <Text style={{ color: colors.muted, fontWeight: '400', fontSize: 12 }}>· {t.companyName}</Text></Text>
                <Text style={{ color: colors.muted, fontSize: 11 }} numberOfLines={1}>
                  {e.present ? '✅ Presente' : '❌ Ausente'}
                  {e.present && e.hora ? ` · ${e.shift === 'night' ? '🌙' : '☀️'} desde ${e.hora}` : ''}
                  {e.auto ? ' · auto (jornada)' : ' · manual'}
                  {(t.plate || t.serial) ? ` · 🔖 ${t.serial || t.plate}` : ''}
                </Text>
              </View>
            </View>
            {isToday ? (
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
                <TouchableOpacity onPress={() => marcar(t, 'presente')} style={{ flex: 1, borderWidth: 1.5, borderColor: e.present ? colors.success : colors.border, backgroundColor: e.present ? colors.success + '18' : colors.surface, borderRadius: radius.md, paddingVertical: 7, alignItems: 'center' }}>
                  <Text style={{ color: e.present ? colors.success : colors.text, fontWeight: '800', fontSize: 12 }}>✅ Presente</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => marcar(t, 'ausente')} style={{ flex: 1, borderWidth: 1.5, borderColor: !e.present ? colors.danger : colors.border, backgroundColor: !e.present ? colors.danger + '18' : colors.surface, borderRadius: radius.md, paddingVertical: 7, alignItems: 'center' }}>
                  <Text style={{ color: !e.present ? colors.danger : colors.text, fontWeight: '800', fontSize: 12 }}>❌ Ausente</Text>
                </TouchableOpacity>
                {!e.auto ? (
                  <TouchableOpacity onPress={() => limpiarMarca(t)} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 7, paddingHorizontal: spacing.sm, alignItems: 'center' }}>
                    <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>↺ Auto</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
          </Card>
        );
      })}

      {busy ? <View style={{ paddingVertical: spacing.md, alignItems: 'center' }}><ActivityIndicator color={colors.primary} /></View> : null}
      <View style={{ height: spacing.xl }} />

      {/* Escáner */}
      <Modal visible={scanFor !== null} animationType="slide" onRequestClose={() => setScanFor(null)}>
        <QrScanner onClose={() => setScanFor(null)} onDetected={onScan} />
      </Modal>

      {/* Elegir camión (manual) */}
      <Modal visible={pickFor !== null} transparent animationType="fade" onRequestClose={() => setPickFor(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
          <Card>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 16, textAlign: 'center', marginBottom: spacing.sm }}>
              {pickFor === 'jornada' ? '🕒 Jornada' : pickFor === 'averia' ? '🛠️ Avería' : '⛽ Gasoil'} · elegir camión
            </Text>
            <TextInput value={pickQuery} onChangeText={setPickQuery} placeholder="Buscar camión…" placeholderTextColor={colors.muted} style={[input, { marginBottom: spacing.sm }]} />
            <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
              {trucks.filter((t) => { const nq = norm(pickQuery.trim()); return !nq || norm(`${t.code} ${t.plate ?? ''} ${t.serial ?? ''} ${t.companyName}`).includes(nq); }).map((t) => (
                <TouchableOpacity key={t.id} onPress={() => pickFor && abrirAccion(pickFor, t)} style={{ paddingVertical: 10, paddingHorizontal: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>🚚 {t.code}</Text>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>{t.companyName}{t.plate ? ` · ${t.plate}` : ''}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity onPress={() => setPickFor(null)} style={{ padding: spacing.sm, alignItems: 'center', marginTop: spacing.xs }}>
              <Text style={{ color: colors.muted, fontWeight: '700' }}>Cancelar</Text>
            </TouchableOpacity>
          </Card>
        </View>
      </Modal>

      {/* Jornada: iniciar o finalizar */}
      <Modal visible={!!jorTruck} transparent animationType="fade" onRequestClose={() => { setJorTruck(null); setJorRound(null); }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
          <Card>
            {jorTruck ? (
              <>
                <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18, textAlign: 'center' }}>{jorRound ? '🏁 Finalizar jornada' : '🟢 Iniciar jornada'}</Text>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16, textAlign: 'center', marginTop: 4, marginBottom: spacing.md }}>{jorTruck.code}</Text>
                {jorRound ? (
                  <>
                    <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center', marginBottom: spacing.sm }}>Inició {caracasClock(jorRound.startAt!)} ({jorRound.shift === 'night' ? '🌙 noche' : '☀️ día'})</Text>
                    <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Horómetro final</Text>
                    <TextInput value={horoFin} onChangeText={(t) => setHoroFin(t.replace(/[^0-9.,]/g, ''))} keyboardType="numeric" inputMode="decimal" placeholder="0" placeholderTextColor={colors.muted} style={[input, { marginBottom: spacing.md }]} />
                    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                      <TouchableOpacity onPress={() => { setJorTruck(null); setJorRound(null); }} disabled={jorBusy} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}>
                        <Text style={{ color: colors.text, fontWeight: '800' }}>Cancelar</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={finalizarJornada} disabled={jorBusy} style={{ flex: 1, backgroundColor: '#2563EB', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: jorBusy ? 0.6 : 1 }}>
                        <Text style={{ color: '#fff', fontWeight: '800' }}>{jorBusy ? 'Guardando…' : 'Sí, finalizar'}</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Horómetro inicial (= final de la jornada anterior)</Text>
                    <TextInput value={horoIni} onChangeText={(t) => setHoroIni(t.replace(/[^0-9.,]/g, ''))} keyboardType="numeric" inputMode="decimal" placeholder="0" placeholderTextColor={colors.muted} style={[input, { marginBottom: spacing.md }]} />
                    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                      <TouchableOpacity onPress={() => setJorTruck(null)} disabled={jorBusy} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}>
                        <Text style={{ color: colors.text, fontWeight: '800' }}>Cancelar</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={iniciarJornada} disabled={jorBusy} style={{ flex: 1, backgroundColor: '#0F766E', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: jorBusy ? 0.6 : 1 }}>
                        <Text style={{ color: '#fff', fontWeight: '800' }}>{jorBusy ? 'Guardando…' : '🟢 Iniciar'}</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </>
            ) : null}
          </Card>
        </View>
      </Modal>

      {/* Avería */}
      <Modal visible={!!avTruck} transparent animationType="fade" onRequestClose={() => setAvTruck(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
          <Card>
            <ScrollView>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18, textAlign: 'center' }}>🛠️ Avería · {avTruck?.code}</Text>
              <Text style={{ color: colors.muted, fontSize: 13, marginTop: spacing.sm, marginBottom: 4 }}>¿Qué necesita?</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {AV_MATERIALS.map((mt) => {
                  const on = avMaterial === mt.key;
                  return (
                    <TouchableOpacity key={mt.key} onPress={() => setAvMaterial(mt.key)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: on ? colors.primary : colors.surfaceAlt, borderWidth: 1, borderColor: on ? colors.primary : colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text>{mt.icon}</Text>
                      <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{mt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={{ color: colors.muted, fontSize: 13, marginTop: spacing.md, marginBottom: 4 }}>Cantidad (opcional)</Text>
              <TextInput value={avQty} onChangeText={setAvQty} keyboardType="numeric" placeholder="Ej: 2" placeholderTextColor={colors.muted} style={input} />
              <Text style={{ color: colors.muted, fontSize: 13, marginTop: spacing.md, marginBottom: 4 }}>Nota (opcional)</Text>
              <TextInput value={avNote} onChangeText={setAvNote} placeholder="Detalle de la falla" placeholderTextColor={colors.muted} multiline style={[input, { minHeight: 60 }]} />
              <TouchableOpacity onPress={subirFotoAveria} disabled={avPhotoUp} style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: avPhoto ? colors.success : colors.border, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
                <Text style={{ color: avPhoto ? colors.success : colors.text, fontWeight: '700' }}>{avPhotoUp ? 'Subiendo…' : avPhoto ? '✓ Foto adjunta' : '📷 Foto de referencia (opcional)'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={registrarAveria} disabled={busy || !avMaterial} style={{ marginTop: spacing.md, backgroundColor: '#B45309', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: busy || !avMaterial ? 0.6 : 1 }}>
                <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>Registrar avería</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setAvTruck(null)} style={{ padding: spacing.sm, alignItems: 'center' }}>
                <Text style={{ color: colors.muted, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
            </ScrollView>
          </Card>
        </View>
      </Modal>

      {/* Surtir gasoil */}
      <SurtidoGasoilModal machineId={gasoilId} onClose={() => setGasoilId(null)} authorName={fullName} authorId={uid || null} />
    </Screen>
  );
}
