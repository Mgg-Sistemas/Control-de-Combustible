import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { Screen, Card, SectionTitle, Loading, EmptyState } from '../components/ui';
import { BiometricToggle } from '../components/BiometricToggle';
import { ConfigBanner } from '../components/ConfigBanner';
import { useAuth } from '../context/AuthContext';
import { supabase, selectAllRows } from '../lib/supabase';
import { norm } from '../lib/text';
import { EDIFICIOS } from '../lib/edificios';
import { Machinery, SupervisorVisit, VisitStatus } from '../types/database';
import { getCurrentCoords, warmLocation } from '../lib/location';
import { captureAndUploadPhoto } from '../lib/photo';
import { saveVisit, myVisitsToday, haversineM, VISIT_NEAR_M } from '../lib/supervisorVisits';
import QrScanner from '../components/QrScanner';
import { SurtidoGasoilModal } from '../components/SurtidoGasoil';
import { parseMachineId, parseEmployeeId } from './ScanQrScreen';
import { startJornada, isOperatorCargo, shiftOf, shiftFromKey, caracasParts } from '../lib/jornada';
import { getMachineRound, upsertMachineRound, lastHorometroFinal } from '../lib/machineRounds';
import { listInspectorAssignments, assignInspector, unassignInspector, Shift, shiftIcon, shiftLabel } from '../lib/machineInspectors';
import { logAudit } from '../lib/audit';
import { notifyAdmins } from '../lib/notify';
import { logTruckYardIfTruck } from '../lib/truckYard';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { ChangePasswordButton } from '../components/ChangePasswordButton';

const CARACAS_TZ = 'America/Caracas';
/** Día ISO (AAAA-MM-DD) de hoy en horario de Caracas. */
function caracasToday(): string {
  const p: any = new Intl.DateTimeFormat('en-CA', { timeZone: CARACAS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((a: any, x) => { a[x.type] = x.value; return a; }, {});
  return `${p.year}-${p.month}-${p.day}`;
}
function caracasClock(iso: string): string {
  return new Intl.DateTimeFormat('es-VE', { timeZone: CARACAS_TZ, hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso));
}
/** Retraso legible a partir de minutos: "45 min", "1 h", "1 h 30 min". */
function retrasoLabel(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60), r = m % 60;
  if (h <= 0) return `${r} min`;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}
/** Tiempo transcurrido "Xh YYm" entre el inicio (ISO) y ahora (ms). */
function elapsedLabel(startISO: string, nowMs: number): string {
  const ms = Math.max(0, nowMs - new Date(startISO).getTime());
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

type Mach = Machinery & { companyName?: string; latitude?: number | null; longitude?: number | null };

const STATUS_OPTS: { key: VisitStatus; label: string; icon: string; color: string }[] = [
  { key: 'trabajando', label: 'Trabajando', icon: '🟢', color: '#1E9E4A' },
  { key: 'parada', label: 'Parada', icon: '🟡', color: '#D9A200' },
  { key: 'no_esta', label: 'No está', icon: '🔴', color: '#D22B2B' },
];
const statusLabel = (s: VisitStatus) => STATUS_OPTS.find((o) => o.key === s)?.label ?? s;

// Materiales de la avería de maquinaria (igual que la vista del operador). Cae en
// el módulo de Mantenimiento de Maquinaria (tabla maintenance_requests).
const AV_MATERIALS: { key: string; label: string; icon: string }[] = [
  { key: 'caucho', label: 'Caucho', icon: '🛞' },
  { key: 'aceite', label: 'Aceite', icon: '🛢️' },
  { key: 'filtro', label: 'Filtro', icon: '🧴' },
  { key: 'repuesto', label: 'Repuesto', icon: '🔩' },
];
const avNumOrNull = (s: string) => { const n = Number((s || '').replace(',', '.')); return isFinite(n) && s.trim() !== '' ? n : null; };

/**
 * Vista del SUPERVISOR: sale a revisar máquinas. Por cada una hace un check-in
 * ("Revisé la máquina") con hora + GPS + estado (trabajando/parada/no está).
 * Ese check-in VALIDA la jornada: sin visita, la máquina-día queda sin validar
 * (el operador no cobra). Ve sus máquinas asignadas (🪖) y puede escanear el QR.
 */
export default function SupervisorScreen({ initialMachineId, onConsumed, onSistema }: { initialMachineId?: string; onConsumed?: () => void; onSistema?: () => void } = {}) {
  const { colors } = useTheme();
  const { session, signOut } = useAuth();
  const uid = session?.user?.id ?? '';
  const today = caracasToday();
  const consumedRef = useRef(false);

  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(true);
  const [machines, setMachines] = useState<Mach[]>([]);
  const [mineIds, setMineIds] = useState<Set<string>>(new Set());
  const [visits, setVisits] = useState<Record<string, SupervisorVisit>>({});
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  // ── CHECK MÁQUINA: asignar/desasignar máquinas al inspector logueado. Cada
  //    inspector solo ve las que tiene asignadas (se casa persona ↔ máquina).
  const [checkOpen, setCheckOpen] = useState(false);
  const [checkQuery, setCheckQuery] = useState('');
  const [assignBusy, setAssignBusy] = useState<string | null>(null); // clave máquina+turno que se está asignando
  // Asignaciones por máquina: quién es el inspector de DÍA y de NOCHE.
  type SlotInfo = { id: string | null; name: string };
  const [assignMap, setAssignMap] = useState<Record<string, { day?: SlotInfo; night?: SlotInfo }>>({});
  const isAdmin = !!onSistema; // el admin recibe onSistema; puede ver todas las máquinas
  // SOLO ADMIN: asigna máquinas a un INSPECTOR (no a sí mismo). Lista de inspectores
  // y el inspector elegido en el modal del CHECK.
  const [inspectors, setInspectors] = useState<{ id: string; name: string; role: string | null }[]>([]);
  const [checkInspector, setCheckInspector] = useState<{ id: string; name: string } | null>(null);
  const [inspQuery, setInspQuery] = useState('');
  // Estado de la jornada por máquina (para el círculo 🟢/🟡/🔴):
  //   round del día (jornada abierta / horas) + máquinas con avería PARADA pendiente.
  const [roundsById, setRoundsById] = useState<Record<string, { open: boolean; worked: number }>>({});
  const [paradaIds, setParadaIds] = useState<Set<string>>(new Set());
  const [gasoilId, setGasoilId] = useState<string | null>(null); // surtir gasoil a la máquina del check-in
  const [notice, setNotice] = useState<string | null>(null);

  // ── Check-in ──────────────────────────────────────────────────────────────
  const [ci, setCi] = useState<Mach | null>(null);
  const [ciStatus, setCiStatus] = useState<VisitStatus>('trabajando');
  const [ciNote, setCiNote] = useState('');
  const [ciMotivo, setCiMotivo] = useState(''); // motivo de la avería cuando la máquina está PARADA
  const [ciSaving, setCiSaving] = useState(false);
  // ── Jornada por TIEMPO (INICIAR → FINALIZAR). El inicio se guarda en la BD
  //    (machine_rounds.jornada_start_at) para que sobreviva aunque se cierre la
  //    pantalla. Al finalizar, las horas = (fin − inicio) van a Control (día/noche).
  const [jornadaStart, setJornadaStart] = useState<string | null>(null);
  const [jornadaShift, setJornadaShift] = useState<'day' | 'night'>('day');
  const [jornadaBusy, setJornadaBusy] = useState(false);
  const [finConfirm, setFinConfirm] = useState(false); // aviso de confirmación antes de finalizar
  // Horómetro: al iniciar se pide el INICIAL (precargado con el último final de la
  // máquina); al finalizar se pide el FINAL (que será el inicial de la próxima jornada).
  const [horoIni, setHoroIni] = useState('');
  const [horoFin, setHoroFin] = useState('');
  // Al iniciar jornada: turno declarado y HORA de inicio (por defecto 7:00am día /
  // 7:00pm noche). Se acota contra la hora del sistema (alerta si se declara tarde).
  const [iniShift, setIniShift] = useState<'day' | 'night'>('day');
  const [iniTime, setIniTime] = useState('07:00');
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [paradaOpen, setParadaOpen] = useState(false); // desplegable del motivo de la avería (PARADA)
  const [savingMachLoc, setSavingMachLoc] = useState(false); // guardar la ubicación de la MÁQUINA desde el check-in
  const [ciRef, setCiRef] = useState(''); // referencia (edificio) de la ubicación — del catálogo
  const [refOpen, setRefOpen] = useState(false);  // desplegable de edificios abierto
  const [refOtro, setRefOtro] = useState(false);  // "Otro…" → escribir a mano
  // Avería de maquinaria (igual que el operador) → maintenance_requests.
  const [avOpen, setAvOpen] = useState(false);
  const [avMaterial, setAvMaterial] = useState<string | null>(null);
  const [avQty, setAvQty] = useState('');
  const [avNote, setAvNote] = useState('');
  const [avSaving, setAvSaving] = useState(false);
  const [avPhoto, setAvPhoto] = useState<string | null>(null);
  const [avPhotoUp, setAvPhotoUp] = useState(false);

  const subirFotoAveria = async () => {
    if (!ci) return;
    setAvPhotoUp(true);
    const r = await captureAndUploadPhoto(ci.id, 'averias');
    setAvPhotoUp(false);
    if (r.ok && r.url) setAvPhoto(r.url);
    else if (r.error) setNotice('❌ ' + r.error);
  };
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsErr, setGpsErr] = useState<string | null>(null);

  // ── Registrar operador SIN teléfono: el supervisor escanea el carnet del
  //    operador y coteja su cédula; si coincide, inicia la jornada del operador
  //    en esta máquina (mismo flujo que si el operador escaneara con su teléfono).
  const [opScanOpen, setOpScanOpen] = useState(false);
  const [opEmp, setOpEmp] = useState<{ id: string; first: string; last: string; name: string; cargo: string | null; cedula: string } | null>(null);
  const [opConfirmCedula, setOpConfirmCedula] = useState('');
  const [opHoro, setOpHoro] = useState('');
  const [opHoroPhoto, setOpHoroPhoto] = useState<string | null>(null);
  const [opHoroUploading, setOpHoroUploading] = useState(false);
  // Turno elegido a mano (sol/luna). Arranca en el turno según la hora actual.
  const [opShift, setOpShift] = useState<'day' | 'night'>(shiftOf(caracasParts(new Date()).hour).key);
  const [opBusy, setOpBusy] = useState(false);

  useEffect(() => { warmLocation(); }, []);
  // Al abrir el check-in de una máquina, precarga su referencia actual (si tiene).
  useEffect(() => {
    const r = (ci as any)?.referencia ?? '';
    setCiRef(r);
    setRefOtro(!!r && !EDIFICIOS.includes(r)); // valor viejo fuera del catálogo → editable a mano
    setRefOpen(false);
  }, [ci?.id]);
  // Al abrir el modal, averigua si esta máquina ya tiene una jornada por tiempo ABIERTA hoy.
  useEffect(() => {
    if (!ci) { setJornadaStart(null); setParadaOpen(false); setFinConfirm(false); return; }
    setParadaOpen(false); setFinConfirm(false); setHoroFin('');
    // Turno/hora de inicio por defecto según el momento: día → 07:00, noche → 19:00.
    const defShift = shiftOf(caracasParts(new Date()).hour).key;
    setIniShift(defShift);
    setIniTime(defShift === 'night' ? '19:00' : '07:00');
    (async () => {
      const r = await getMachineRound(ci.id, today);
      const open = (r as any)?.jornada_start_at ?? null;
      setJornadaStart(open);
      setJornadaShift((((r as any)?.jornada_shift as any) ?? shiftOf(caracasParts(new Date()).hour).key));
      if (open) {
        // Jornada abierta: muestra su horómetro inicial ya guardado.
        setHoroIni((r as any)?.horometro_inicial != null ? String((r as any).horometro_inicial) : '');
      } else {
        // Cerrada: precarga el inicial con el último horómetro final de la máquina.
        const last = await lastHorometroFinal(ci.id);
        setHoroIni(last != null ? String(last) : '');
      }
    })();
  }, [ci?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Reloj que corre solo mientras hay una jornada abierta (para el tiempo transcurrido).
  useEffect(() => {
    if (!jornadaStart) return;
    setNowTick(Date.now());
    const id = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(id);
  }, [jornadaStart]);

  const load = async () => {
    if (!uid) { setLoading(false); return; }
    const [{ data: prof }, mach] = await Promise.all([
      supabase.from('profiles').select('full_name').eq('id', uid).maybeSingle(),
      selectAllRows('machinery', 'id, code, tipo, serial, plate, referencia, latitude, longitude, operational, company:company_id(name)'),
    ]);
    const name = (prof as any)?.full_name ?? '';
    setFullName(name);
    const list = ((mach ?? []) as any[]).map((m) => ({ ...m, companyName: m.company?.name ?? 'Sin empresa' })) as Mach[];
    list.sort((a, b) => (a.code || '').localeCompare(b.code || ''));
    setMachines(list);
    await reloadAssigns();
    setVisits(await myVisitsToday(uid, today));
    await reloadEstados();
    // Solo el ADMIN necesita la lista de inspectores para asignarles máquinas.
    // Solo se ofrecen usuarios con rol INSPECTOR (interno 'supervisor') o
    // COORDINADOR DE PATIO ('coordinador_patio'); nadie más se puede asignar.
    if (isAdmin) {
      const { data: insp } = await supabase.from('profiles').select('id, full_name, role').in('role', ['supervisor', 'coordinador_patio']).order('full_name');
      setInspectors(((insp ?? []) as any[]).filter((p) => (p.full_name || '').trim()).map((p) => ({ id: p.id as string, name: p.full_name as string, role: (p.role ?? null) as string | null })));
    }
    setLoading(false);
  };

  // Estado de la jornada por máquina para el círculo de color: rondas del día
  // (jornada abierta / horas trabajadas) + máquinas con avería PARADA pendiente.
  const reloadEstados = async () => {
    const [{ data: rs }, { data: par }] = await Promise.all([
      supabase.from('machine_rounds').select('machinery_id, jornada_start_at, day_hours, night_hours').eq('round_date', today),
      supabase.from('maintenance_requests').select('machinery_id').eq('material', 'MÁQUINA PARADA').eq('status', 'pendiente'),
    ]);
    const rmap: Record<string, { open: boolean; worked: number }> = {};
    ((rs ?? []) as any[]).forEach((r) => {
      rmap[r.machinery_id] = { open: !!r.jornada_start_at, worked: (Number(r.day_hours) || 0) + (Number(r.night_hours) || 0) };
    });
    setRoundsById(rmap);
    setParadaIds(new Set(((par ?? []) as any[]).map((p) => p.machinery_id as string)));
  };
  // Estado (círculo) de una máquina: 🟢 trabajando (jornada abierta) · 🟡 parada
  // (avería pendiente) · 🔴 jornada finalizada (tuvo horas y ya cerró). Si nada, null.
  const estadoDe = (id: string): { color: string; icon: string; label: string } | null => {
    const r = roundsById[id];
    if (r?.open) return { color: '#1E9E4A', icon: '🟢', label: 'Trabajando' };
    if (paradaIds.has(id)) return { color: '#D9A200', icon: '🟡', label: 'Parada' };
    if (r && r.worked > 0) return { color: '#D22B2B', icon: '🔴', label: 'Jornada finalizada' };
    return null;
  };

  // Arma el mapa de asignaciones (quién es DÍA y NOCHE por máquina) y "mis
  // máquinas" = donde soy inspector de día o de noche. Si falta el SQL, avisa.
  const reloadAssigns = async () => {
    const { rows, missing } = await listInspectorAssignments();
    const map: Record<string, { day?: SlotInfo; night?: SlotInfo }> = {};
    rows.forEach((a) => { (map[a.machinery_id] ||= {})[a.shift] = { id: a.inspector_id, name: a.inspector_name }; });
    setAssignMap(map);
    setMineIds(new Set(Object.entries(map).filter(([, s]) => s.day?.id === uid || s.night?.id === uid).map(([mid]) => mid)));
    if (missing) setNotice('⚠️ Para asignar máquinas (CHECK) falta correr supabase/inspector_asignacion.sql en Supabase.');
  };
  useEffect(() => { load(); }, [uid]);
  // Sincroniza en vivo: si se asignan/quitan máquinas (aquí o en otro dispositivo),
  // refresca "Mis máquinas" y el mapa de turnos al instante.
  useRealtimeRefresh(['machine_inspectors'], () => { reloadAssigns(); });
  // Círculos de estado en vivo: jornada (machine_rounds), avería/parada
  // (maintenance_requests) y visitas.
  useRealtimeRefresh(['machine_rounds', 'maintenance_requests', 'supervisor_visits'], () => { reloadEstados(); });

  const mine = useMemo(() => machines.filter((m) => mineIds.has(m.id)), [machines, mineIds]);
  const matchQuery = (m: Mach, q: string) => !q
    || norm(m.code).includes(q)
    || norm(m.companyName || '').includes(q)
    || norm((m as any).serial || '').includes(q)
    || norm((m as any).plate || '').includes(q);
  const searchList = useMemo(() => {
    const q = norm(query.trim());
    return machines.filter((m) => matchQuery(m, q));
  }, [machines, query]);
  // Listado del CHECK: todas las máquinas (buscable) para asignármelas/quitármelas.
  const checkList = useMemo(() => {
    const q = norm(checkQuery.trim());
    return machines.filter((m) => matchQuery(m, q));
  }, [machines, checkQuery]);

  // ✅ CHECK MÁQUINA por TURNO (SOLO ADMIN): asigna (o quita) al INSPECTOR ELEGIDO
  // como inspector de DÍA o de NOCHE de la máquina. Cada máquina → 2 inspectores.
  const assignShift = async (m: Mach, shift: Shift) => {
    const target = checkInspector;
    if (!target || assignBusy) return;
    const slot = assignMap[m.id]?.[shift];
    const same = slot?.id === target.id; // ese inspector ya tiene este turno → quitar
    setAssignBusy(m.id + shift); setNotice(null);
    const res = same ? await unassignInspector(m.id, target.id, shift) : await assignInspector(m.id, target.id, target.name, shift);
    setAssignBusy(null);
    if (res.error) {
      setNotice(res.missing
        ? '❌ Falta activar la asignación: corre supabase/inspector_turno.sql en Supabase.'
        : '❌ ' + res.error);
      return;
    }
    await reloadAssigns();
    if (!same) logAudit('CHECK', 'machinery', m.id, `${m.code} · ${shiftLabel(shift)} → ${target.name}`); // bitácora
    setNotice(same
      ? `➖ ${m.code} · ${shiftIcon(shift)} ${shiftLabel(shift)} quitado a ${target.name}.`
      : `✅ ${m.code} · ${shiftIcon(shift)} ${shiftLabel(shift)} asignada a ${target.name}.`);
  };

  const openCheckin = (m: Mach) => {
    setCi(m);
    setCiStatus('trabajando');
    setCiNote('');
    setCiMotivo('');
    setAvOpen(false); setAvMaterial(null); setAvQty(''); setAvNote('');
    setGps(null);
    setGpsErr(null);
    setScanOpen(false);
    // Limpia el registro de operador para esta máquina.
    setOpScanOpen(false);
    setOpEmp(null);
    setOpConfirmCedula('');
    setOpHoro('');
    setOpHoroPhoto(null);
    // Captura el GPS del supervisor al abrir (para medir la distancia a la máquina).
    setGpsBusy(true);
    getCurrentCoords().then((r) => {
      setGpsBusy(false);
      if (r.ok && r.lat != null && r.lng != null) setGps({ lat: r.lat, lng: r.lng });
      else setGpsErr(r.error ?? 'Sin ubicación.');
    });
  };

  // Si llegó por el QR físico (?maquina=) tras iniciar sesión: abre directo el
  // check-in de esa máquina (una sola vez) y limpia el parámetro de la URL.
  useEffect(() => {
    if (consumedRef.current || !initialMachineId || machines.length === 0) return;
    consumedRef.current = true;
    const found = machines.find((m) => m.id === initialMachineId);
    if (found) {
      openCheckin(found);
      logAudit('SCAN', 'machinery', found.id, found.code); // bitácora: escaneó el QR de esta máquina
    }
    onConsumed?.();
  }, [initialMachineId, machines]); // eslint-disable-line react-hooks/exhaustive-deps

  const recapture = () => {
    setGpsBusy(true); setGpsErr(null);
    getCurrentCoords().then((r) => {
      setGpsBusy(false);
      if (r.ok && r.lat != null && r.lng != null) setGps({ lat: r.lat, lng: r.lng });
      else setGpsErr(r.error ?? 'Sin ubicación.');
    });
  };

  // Guarda TU posición actual como la UBICACIÓN de la máquina (queda en el mapa y
  // en el monitoreo con tu nombre). Estás en la máquina, así que sirve para ubicarla.
  const guardarUbicacionMaquina = async () => {
    if (!ci) return;
    setSavingMachLoc(true);
    let lat = gps?.lat ?? null, lng = gps?.lng ?? null;
    if (lat == null || lng == null) {
      const r = await getCurrentCoords();
      if (!r.ok || r.lat == null || r.lng == null) { setSavingMachLoc(false); setNotice('❌ ' + (r.error ?? 'No se pudo obtener tu ubicación.')); return; }
      lat = r.lat; lng = r.lng; setGps({ lat, lng });
    }
    const { error } = await supabase.rpc('update_machine_location', { p_id: ci.id, p_lat: lat, p_lng: lng });
    if (error) { setSavingMachLoc(false); setNotice('❌ ' + error.message); return; }
    // Guarda la REFERENCIA (edificio/parque/plaza/calle) junto con la ubicación.
    // El inspector tiene permiso de escritura sobre machinery (is_staff).
    const nuevaRef = ciRef.trim() || null;
    const { error: refErr } = await supabase.from('machinery').update({ referencia: nuevaRef }).eq('id', ci.id);
    setSavingMachLoc(false);
    if (refErr) { setNotice('❌ ' + refErr.message); return; }
    setCi((c) => (c ? { ...c, latitude: lat as number, longitude: lng as number, referencia: nuevaRef } as Mach : c));
    setNotice(nuevaRef ? '✅ Ubicación y referencia guardadas.' : '✅ Ubicación de la máquina guardada.');
    load();
  };

  // Reporta una AVERÍA de la máquina (misma función que el operador): cae en el
  // módulo de Mantenimiento de Maquinaria como solicitud pendiente.
  const registrarAveria = async () => {
    if (!ci || !avMaterial) return;
    setAvSaving(true);
    const { error } = await supabase.from('maintenance_requests').insert({
      machinery_id: ci.id,
      material: avMaterial,
      quantity: avNumOrNull(avQty),
      notes: avNote.trim() || null,
      status: 'pendiente',
      requested_by: uid || null,
      photo_url: avPhoto,
    });
    setAvSaving(false);
    if (error) { setNotice('❌ ' + error.message); return; }
    setAvMaterial(null); setAvQty(''); setAvNote(''); setAvPhoto(null); setAvOpen(false);
    setNotice('✅ Avería registrada. Va al módulo de Mantenimiento de Maquinaria.');
  };

  // Distancia del supervisor a la máquina (si ambos tienen coordenadas).
  const dist = useMemo(() => {
    if (!ci || !gps || ci.latitude == null || ci.longitude == null) return null;
    return haversineM(gps.lat, gps.lng, Number(ci.latitude), Number(ci.longitude));
  }, [ci, gps]);
  const near = dist == null ? null : dist <= VISIT_NEAR_M;

  // Guarda la visita (check-in) con un estado dado → aparece en el módulo de
  // INSPECCIONES y valida la jornada del día. Devuelve la fila o null.
  const registrarVisita = async (status: VisitStatus) => {
    if (!ci) return null;
    const { data, error } = await saveVisit({
      machineryId: ci.id,
      supervisorId: uid || null,
      supervisorName: fullName || 'Inspector',
      visitDate: today,
      status,
      lat: gps?.lat ?? null,
      lng: gps?.lng ?? null,
      note: ciNote,
      machineLat: ci.latitude ?? null,
      machineLng: ci.longitude ?? null,
    });
    if (error || !data) { setNotice('❌ ' + (error ?? 'No se pudo guardar la visita.')); return null; }
    setVisits((prev) => ({ ...prev, [ci.id]: data }));
    return data;
  };

  // ▶️ INICIAR JORNADA: guarda la hora de inicio (en la BD) y marca la máquina
  // como "trabajando" en Inspecciones. El botón pasa a "Finalizar jornada".
  const iniciarJornada = async () => {
    if (!ci || jornadaBusy) return;
    const hi = Number((horoIni || '').replace(',', '.'));
    if (!isFinite(hi) || hi < 0) { setNotice('❌ Ingresa el horómetro inicial.'); return; }
    // Hora de inicio DECLARADA (HH:MM). Caracas es UTC-4 fijo (sin horario de verano).
    const m = /^(\d{1,2}):(\d{2})$/.exec((iniTime || '').trim());
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) { setNotice('❌ Hora de inicio inválida (usa HH:MM, ej. 07:00).'); return; }
    const hh = m[1].padStart(2, '0'), mm = m[2];
    const sh = iniShift;
    const now = new Date();
    const nowParts = caracasParts(now);
    // Instante declarado del inicio (hoy, a la hora escrita).
    const declaredIso = `${today}T${hh}:${mm}:00-04:00`;
    // Límite para declarar SIN alerta: 9:30am (día) / 9:30pm (noche). Si el turno de
    // noche ya pasó la medianoche (hora < 6), el límite fue el día anterior.
    let limitDay = today;
    if (sh === 'night' && nowParts.hour < 6) {
      const d = new Date(`${today}T12:00:00-04:00`); d.setUTCDate(d.getUTCDate() - 1);
      limitDay = caracasParts(d).iso;
    }
    const limitIso = sh === 'night' ? `${limitDay}T21:30:00-04:00` : `${limitDay}T09:30:00-04:00`;
    const retrasoMin = Math.round((now.getTime() - new Date(limitIso).getTime()) / 60000);

    setJornadaBusy(true); setNotice(null);
    const vis = await registrarVisita('trabajando');
    if (!vis) { setJornadaBusy(false); return; }
    const res = await upsertMachineRound(ci.id, today, { jornada_start_at: declaredIso, jornada_shift: sh, horometro_inicial: hi }, uid || null);
    setJornadaBusy(false);
    if (res.error) { setNotice('❌ ' + res.error); return; }
    setJornadaShift(sh);
    setJornadaStart(declaredIso);
    logAudit('JORNADA_INICIO', 'machinery', ci.id, `${ci.code} · inicio ${hh}:${mm} ${sh === 'night' ? '🌙' : '☀️'}${retrasoMin > 0 ? ` · declarada ${retrasoLabel(retrasoMin)} tarde` : ''}`); // bitácora
    // Camión: al INICIAR la jornada, se registra su SALIDA del patio.
    logTruckYardIfTruck(ci.id, ci.code, 'salida', uid || null, fullName || null);

    // ⏰ Alerta a los ADMIN si la jornada se declaró TARDE (después del límite).
    if (retrasoMin > 0) {
      const turnoTxt = sh === 'night' ? 'noche (límite 9:30pm)' : 'día (límite 9:30am)';
      notifyAdmins(
        'jornada_tarde',
        `Jornada declarada ${retrasoLabel(retrasoMin)} tarde`,
        `🚜 ${ci.code}${ci.companyName ? ` · ${ci.companyName}` : ''} · inicio declarado ${hh}:${mm} (${turnoTxt}) · registrada por ${fullName || 'inspector'} a las ${caracasClock(now.toISOString())}.`,
        { machinery_id: ci.id, code: ci.code, retraso_min: retrasoMin, shift: sh, declared_at: declaredIso }
      );
    }
    reloadEstados();
    setNotice(`🟢 Jornada iniciada en ${ci.code} · ${shiftFromKey(sh).label} · inicio ${hh}:${mm}.${retrasoMin > 0 ? ` ⏰ Se avisó a admin: declarada ${retrasoLabel(retrasoMin)} tarde.` : ''} Aparece en Inspecciones.`);
  };

  // 🏁 FINALIZAR JORNADA: horas = (fin − inicio); se SUMAN al turno (día/noche)
  // en Control de maquinaria. Cierra la jornada (borra la hora de inicio).
  const finalizarJornada = async () => {
    if (!ci || !jornadaStart || jornadaBusy) return;
    const hf = Number((horoFin || '').replace(',', '.'));
    if (!isFinite(hf) || hf < 0) { setNotice('❌ Ingresa el horómetro final.'); return; }
    const hi = Number((horoIni || '').replace(',', '.'));
    if (isFinite(hi) && hf < hi) { setNotice('❌ El horómetro final no puede ser menor que el inicial.'); return; }
    setJornadaBusy(true); setNotice(null);
    const ms = Date.now() - new Date(jornadaStart).getTime();
    const horas = Math.max(0, Math.round((ms / 3600000) * 100) / 100);
    const prev = await getMachineRound(ci.id, today);
    const key = jornadaShift === 'night' ? 'night_hours' : 'day_hours';
    const base = Number((prev as any)?.[key] ?? 0);
    const res = await upsertMachineRound(ci.id, today, { [key]: Math.round((base + horas) * 100) / 100, horometro_final: hf, jornada_start_at: null }, uid || null);
    setJornadaBusy(false);
    if (res.error) { setNotice('❌ ' + res.error); return; }
    setJornadaStart(null);
    setFinConfirm(false);
    logAudit('JORNADA_FIN', 'machinery', ci.id, `${ci.code} · ${horas.toFixed(2)} h`); // bitácora
    // Camión: al FINALIZAR la jornada, se registra su ENTRADA al patio.
    logTruckYardIfTruck(ci.id, ci.code, 'entrada', uid || null, fullName || null);
    reloadEstados();
    setNotice(`🏁 Jornada finalizada · ${horas.toFixed(2)} h → Control de maquinaria (turno ${jornadaShift === 'night' ? 'noche' : 'día'}).`);
  };

  // 🟡 PARADA: marca la máquina parada en INSPECCIONES y crea la AVERÍA en el
  // módulo de Mantenimiento (con el motivo obligatorio). Control mostrará "MÁQUINA PARADA".
  const marcarParada = async () => {
    if (!ci || ciSaving) return;
    if (!ciMotivo.trim()) { setNotice('⚠️ Escribe el motivo de la avería (la máquina está parada).'); return; }
    setCiSaving(true); setNotice(null);
    const vis = await registrarVisita('parada');
    if (!vis) { setCiSaving(false); return; }
    const { error: avErr } = await supabase.from('maintenance_requests').insert({
      machinery_id: ci.id, material: 'MÁQUINA PARADA', notes: ciMotivo.trim(), status: 'pendiente', requested_by: uid || null,
    });
    setCiSaving(false);
    logAudit('PARADA', 'machinery', ci.id, `${ci.code} · ${ciMotivo.trim()}`); // bitácora
    reloadEstados();
    setNotice(`🟡 ${ci.code} marcada PARADA${avErr ? ' · ⚠️ no se pudo crear la avería' : ' · 🔧 avería registrada (Mantenimiento)'}. Aparece en Inspecciones.`);
    setCiMotivo(''); setParadaOpen(false);
    setCi(null);
  };

  // 🟢 VOLVER A OPERATIVA: revierte una máquina PARADA. Registra una visita
  // "trabajando" (Inspecciones) y RESUELVE la avería "MÁQUINA PARADA" pendiente
  // (Mantenimiento), con lo que Control deja de mostrar "MÁQUINA PARADA".
  const volverOperativa = async () => {
    if (!ci || ciSaving) return;
    setCiSaving(true); setNotice(null);
    const vis = await registrarVisita('trabajando');
    const { error: upErr } = await supabase
      .from('maintenance_requests')
      .update({ status: 'realizado', resolved_by: uid || null, resolved_at: new Date().toISOString() })
      .eq('machinery_id', ci.id).eq('material', 'MÁQUINA PARADA').eq('status', 'pendiente');
    setCiSaving(false);
    if (!vis && upErr) { setNotice('❌ No se pudo poner operativa.'); return; }
    logAudit('JORNADA_INICIO', 'machinery', ci.id, `${ci.code} · vuelve a OPERATIVA`);
    await reloadEstados();
    setNotice(`🟢 ${ci.code} de nuevo OPERATIVA${upErr ? ' · ⚠️ la avería no se pudo cerrar' : ' · avería cerrada en Mantenimiento'}.`);
  };

  // Escanea el carnet del operador (QR ?empleado=<id>): valida que exista, que su
  // cargo pueda operar y que tenga cédula en nómina. Luego se coteja la cédula.
  const onOperatorCarnet = async (text: string) => {
    setOpScanOpen(false);
    const id = parseEmployeeId(text);
    if (!id) { setNotice('❌ Ese QR no es un carnet de empleado.'); return; }
    const { data } = await supabase.from('employees').select('id, first_name, last_name, cargo, cedula').eq('id', id).maybeSingle();
    const emp = data as any;
    if (!emp) { setOpEmp(null); setNotice('❌ Ese carnet no corresponde a un empleado registrado.'); return; }
    const nombre = `${emp.first_name || ''} ${emp.last_name || ''}`.trim();
    if (!isOperatorCargo(emp.cargo)) { setOpEmp(null); setNotice(`❌ ${nombre}${emp.cargo ? ` (${emp.cargo})` : ''} no es OPERADOR, CHOFER, SERVICIOS GENERALES ni OBRERO. No puede iniciar jornada.`); return; }
    if (!(emp.cedula || '').trim()) { setOpEmp(null); setNotice(`❌ ${nombre} no tiene CÉDULA en nómina. Pídele al administrador que la agregue.`); return; }
    setOpEmp({ id: emp.id, first: (emp.first_name || '').trim(), last: (emp.last_name || '').trim(), name: nombre, cargo: emp.cargo ?? null, cedula: String(emp.cedula).trim() });
    setOpConfirmCedula('');
    setOpShift(shiftOf(caracasParts(new Date()).hour).key); // sugiere el turno según la hora; el inspector puede cambiarlo
    setOpHoro(''); setOpHoroPhoto(null);
    setNotice(`📇 Carnet de ${nombre} leído. Coteja su cédula e ingresa el horómetro para iniciar la jornada.`);
  };

  // Coteja la cédula (debe coincidir con el carnet) e inicia la jornada del operador
  // en la máquina del check-in, con la ubicación del supervisor como punto de inicio.
  const confirmOperatorJornada = async () => {
    if (!ci || !opEmp || opBusy) return;
    const digits = (s: string) => (s || '').replace(/\D/g, '');
    if (digits(opConfirmCedula).length < 6) { setNotice('❌ Escribe la cédula del operador para cotejar.'); return; }
    if (digits(opConfirmCedula) !== digits(opEmp.cedula)) { setNotice('❌ La cédula no coincide con el carnet escaneado.'); return; }
    const hi = Number((opHoro || '').replace(',', '.'));
    if (!isFinite(hi) || hi < 0) { setNotice('❌ Ingresa el horómetro inicial de la máquina.'); return; }
    setOpBusy(true); setNotice(null);
    const res = await startJornada({
      machineId: ci.id, companyName: ci.companyName ?? null,
      first: opEmp.first, last: opEmp.last, cedula: opEmp.cedula, horometroInicial: hi,
      horometroPhoto: opHoroPhoto, shift: opShift,
      createdBy: uid || null, recordedBy: uid || null, startCoords: gps,
    });
    setOpBusy(false);
    if (!res.ok) { setNotice('❌ ' + res.error); return; }
    setNotice(`✅ Jornada iniciada para ${opEmp.name} en ${ci.code} · ${res.shift.label} · Horómetro ${hi}. (Registrada por el supervisor.)`);
    setOpEmp(null); setOpConfirmCedula(''); setOpHoro(''); setOpHoroPhoto(null);
  };

  // Foto del horómetro (cámara → sube y guarda la URL) para el inicio de jornada.
  const tomarFotoHoroSup = async () => {
    if (!ci) return;
    setOpHoroUploading(true);
    const r = await captureAndUploadPhoto(ci.id, 'horometro');
    setOpHoroUploading(false);
    if (!r.ok) { if (r.error) setNotice('⚠️ ' + r.error); return; }
    setOpHoroPhoto(r.url ?? null);
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  if (loading) return <Screen><ConfigBanner /><Loading /></Screen>;

  // ¿La referencia es un edificio legible? (descarta coordenadas / solo números).
  const edificioDe = (m: Mach): string | null => {
    const t = ((m as any).referencia ?? '').trim();
    return t && !/^[\d.,\s-]+$/.test(t) ? t : null;
  };
  const renderMachine = (m: Mach) => {
    const v = visits[m.id];
    const est = estadoDe(m.id); // 🟢 trabajando / 🟡 parada / 🔴 finalizada
    const edif = edificioDe(m);
    return (
      <TouchableOpacity
        key={m.id}
        onPress={() => openCheckin(m)}
        style={{ padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: est ? est.color : (v ? colors.success : colors.border), backgroundColor: colors.surface, marginBottom: spacing.xs }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            {/* Círculo de estado de la jornada */}
            <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: est ? est.color : colors.border }} />
            <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '800', flex: 1 }}>{m.code}</Text>
          </View>
          {v ? (
            <Text style={{ color: colors.success, fontSize: 12, fontWeight: '800' }}>✓ {caracasClock(v.visited_at)}</Text>
          ) : (
            <Text style={{ color: colors.warning, fontSize: 12, fontWeight: '800' }}>⏳ Pendiente</Text>
          )}
        </View>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{(m.tipo || 'Sin tipo')} · {m.companyName}</Text>
        {/* Referencia / edificio de la máquina */}
        <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>📍 {edif || 'Sin edificio/referencia'}{((m as any).plate || (m as any).serial) ? ` · 🔖 ${(m as any).plate || (m as any).serial}` : ''}</Text>
        {/* Estado de la jornada (con su color) */}
        {est ? <Text style={{ color: est.color, fontSize: 12, fontWeight: '800', marginTop: 2 }}>{est.icon} {est.label}</Text> : null}
        {/* Inspectores asignados (día / noche) */}
        {(() => {
          const s = assignMap[m.id] || {};
          const parts = [s.day ? `☀️ ${s.day.name}` : null, s.night ? `🌙 ${s.night.name}` : null].filter(Boolean).join('  ·  ');
          return parts ? <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '700', marginTop: 2 }}>{parts}</Text> : null;
        })()}
      </TouchableOpacity>
    );
  };

  const revisadas = Object.keys(visits).length;

  return (
    <Screen>
      <ConfigBanner />
      <View>
        {/* Fila 1: nombre del inspector + Salir (el nombre se recorta, no se apila). */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: colors.muted, fontSize: 12 }}>Inspector</Text>
            <Text numberOfLines={1} style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>{fullName || 'Mi ronda'}</Text>
          </View>
          <TouchableOpacity onPress={signOut} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Salir</Text>
          </TouchableOpacity>
        </View>
        {/* Fila 2: acciones (se acomodan en varias líneas si no caben). */}
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
          {/* Solo ADMIN (en teléfono): ir a la app completa (SISTEMA). */}
          {onSistema ? (
            <TouchableOpacity onPress={onSistema} style={{ backgroundColor: '#0F172A', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>🗂️ SISTEMA</Text>
            </TouchableOpacity>
          ) : null}
          <ChangePasswordButton />
        </View>
      </View>

      <Card>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>🪖 Mi ronda de hoy</Text>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
          Revisadas hoy: <Text style={{ color: colors.success, fontWeight: '800' }}>{revisadas}</Text>
          {mine.length > 0 ? <> · Mis máquinas: <Text style={{ color: colors.text, fontWeight: '800' }}>{mine.length}</Text></> : null}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
          Toca una máquina o escanea su QR para marcarla. Si no la marcas, esa jornada queda sin validar.
        </Text>
        {/* Botón GRANDE y cuadrado para escanear (pensado para el teléfono). */}
        <TouchableOpacity
          onPress={() => setScanOpen(true)}
          activeOpacity={0.85}
          style={{ marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.lg, aspectRatio: 1.35, maxHeight: 220, width: '100%', alignSelf: 'center', alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ fontSize: 64 }}>📷</Text>
          <Text style={{ color: colors.primaryContrast, fontWeight: '900', fontSize: 20, marginTop: spacing.sm, letterSpacing: 0.5 }}>ESCANEAR QR</Text>
          <Text style={{ color: colors.primaryContrast, fontSize: 12, opacity: 0.9, marginTop: 2 }}>Apunta al código de la máquina</Text>
        </TouchableOpacity>
        {/* CHECK MÁQUINA (SOLO ADMIN): asignar máquinas a los inspectores. */}
        {isAdmin ? (
          <>
            <TouchableOpacity
              onPress={() => { setCheckQuery(''); setInspQuery(''); setCheckInspector(null); setCheckOpen(true); }}
              activeOpacity={0.85}
              style={{ marginTop: spacing.sm, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.xs, borderWidth: 2, borderColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md }}
            >
              <Text style={{ fontSize: 20 }}>✅</Text>
              <Text style={{ color: colors.primary, fontWeight: '900', fontSize: 16, letterSpacing: 0.5 }}>CHECK MÁQUINA</Text>
            </TouchableOpacity>
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4, textAlign: 'center' }}>
              Asigna las máquinas a cada inspector (día / noche). Solo el administrador puede asignar.
            </Text>
          </>
        ) : (
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm, textAlign: 'center' }}>
            Aquí ves las máquinas que el administrador te asignó. Tócalas para hacer el check-in.
          </Text>
        )}
      </Card>

      {notice ? (
        <Card><Text style={{ color: notice.startsWith('❌') ? colors.danger : colors.success, fontWeight: '700' }}>{notice}</Text></Card>
      ) : null}

      {isAdmin && showAll ? (
        // ADMIN: ver TODAS las máquinas (para pruebas). El inspector normal no ve esto.
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <SectionTitle>Todas las máquinas</SectionTitle>
            <TouchableOpacity onPress={() => setShowAll(false)}><Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>Solo las mías</Text></TouchableOpacity>
          </View>
          <TextInput value={query} onChangeText={setQuery} placeholder="🔎 Buscar por nombre, serial/placa o empresa…" placeholderTextColor={colors.muted} style={input} />
          <View style={{ marginTop: spacing.xs }}>
            {searchList.slice(0, 100).map(renderMachine)}
            {searchList.length === 0 ? <EmptyState title="Sin resultados" subtitle="Prueba con otro nombre o empresa." /> : null}
          </View>
        </>
      ) : (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <SectionTitle>Mis máquinas asignadas</SectionTitle>
            {isAdmin ? <TouchableOpacity onPress={() => setShowAll(true)}><Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>Ver todas</Text></TouchableOpacity> : null}
          </View>
          {mine.length > 0 ? mine.map(renderMachine) : (
            <EmptyState title="Aún no tienes máquinas asignadas" subtitle="Toca ✅ CHECK MÁQUINA para asignarte las que inspeccionas." />
          )}
        </>
      )}

      {/* Seguridad: iniciar sesión con huella (disponible para todos los usuarios). */}
      <SectionTitle>Seguridad</SectionTitle>
      <BiometricToggle />

      {/* Escáner de QR → abre el check-in de esa máquina. */}
      <Modal visible={scanOpen} animationType="slide" onRequestClose={() => setScanOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <QrScanner
            onClose={() => setScanOpen(false)}
            onDetected={(text) => {
              const id = parseMachineId(text);
              const found = id ? machines.find((m) => m.id === id) : null;
              if (found) openCheckin(found);
              else { setScanOpen(false); setNotice('❌ El QR no corresponde a una máquina registrada.'); }
            }}
          />
        </View>
      </Modal>

      {/* ✅ CHECK MÁQUINA (SOLO ADMIN): 1) elegir inspector · 2) asignarle máquinas por turno. */}
      <Modal visible={checkOpen} animationType="slide" onRequestClose={() => setCheckOpen(false)}>
        <Screen>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18 }}>✅ CHECK máquina</Text>
              <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>
                {checkInspector ? <>Inspector: <Text style={{ color: colors.primary, fontWeight: '800' }}>{checkInspector.name}</Text></> : 'Elige el inspector'}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setCheckOpen(false)} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Listo</Text>
            </TouchableOpacity>
          </View>

          {!checkInspector ? (
            // ── PASO 1: elegir a qué inspector se le asignarán máquinas ──────────
            <>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Selecciona el inspector al que le vas a asignar máquinas.</Text>
              <TextInput value={inspQuery} onChangeText={setInspQuery} placeholder="🔎 Buscar inspector por nombre…" placeholderTextColor={colors.muted} style={input} />
              <ScrollView style={{ marginTop: spacing.xs }} keyboardShouldPersistTaps="handled">
                {inspectors.filter((p) => !inspQuery.trim() || norm(p.name).includes(norm(inspQuery.trim()))).map((p) => {
                  const count = Object.values(assignMap).filter((s) => s.day?.id === p.id || s.night?.id === p.id).length;
                  return (
                    <TouchableOpacity key={p.id} onPress={() => { setCheckInspector({ id: p.id, name: p.name }); setCheckQuery(''); }} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: spacing.xs }}>
                      <Text style={{ fontSize: 20 }}>👮</Text>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '800' }}>{p.name}</Text>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>{p.role || 'inspector'}{count > 0 ? ` · ${count} máquina(s)` : ''}</Text>
                      </View>
                      <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 18 }}>›</Text>
                    </TouchableOpacity>
                  );
                })}
                {inspectors.length === 0 ? <EmptyState title="Sin inspectores" subtitle="No hay usuarios (no-admin) para asignar." /> : null}
                <View style={{ height: spacing.xl }} />
              </ScrollView>
            </>
          ) : (
            // ── PASO 2: asignar máquinas (día/noche) al inspector elegido ────────
            <>
              <TouchableOpacity onPress={() => { setCheckInspector(null); setInspQuery(''); }} style={{ alignSelf: 'flex-start', marginBottom: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>‹ Cambiar inspector</Text>
              </TouchableOpacity>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
                Toca ☀️ Día o 🌙 Noche para asignarle la máquina a <Text style={{ fontWeight: '800', color: colors.text }}>{checkInspector.name}</Text> (o de nuevo para quitársela).
              </Text>
              <TextInput value={checkQuery} onChangeText={setCheckQuery} placeholder="🔎 Buscar máquina por nombre, serial/placa o empresa…" placeholderTextColor={colors.muted} style={input} />
              <ScrollView style={{ marginTop: spacing.xs }} keyboardShouldPersistTaps="handled">
                {checkList.slice(0, 200).map((m) => {
                  const slots = assignMap[m.id] || {};
                  const on = slots.day?.id === checkInspector.id || slots.night?.id === checkInspector.id;
                  const edif = edificioDe(m);
                  const shiftBtn = (shift: Shift) => {
                    const slot = slots[shift];
                    const mineHere = slot?.id === checkInspector.id;
                    const taken = !!slot && !mineHere;
                    const busy = assignBusy === m.id + shift;
                    return (
                      <TouchableOpacity
                        key={shift}
                        onPress={() => assignShift(m, shift)}
                        disabled={busy}
                        style={{ flex: 1, borderRadius: radius.md, borderWidth: 1.5, borderStyle: slot ? 'solid' : 'dashed', borderColor: mineHere ? colors.success : taken ? colors.warning : colors.border, backgroundColor: mineHere ? '#E8F5EC' : colors.surface, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, alignItems: 'center', opacity: busy ? 0.6 : 1 }}
                      >
                        <Text style={{ fontSize: 13, fontWeight: '800', color: mineHere ? '#0F5C2E' : colors.text }}>
                          {busy ? '⏳ ' : ''}{shiftIcon(shift)} {shiftLabel(shift)}
                        </Text>
                        <Text numberOfLines={1} style={{ fontSize: 11, color: mineHere ? colors.success : taken ? colors.warning : colors.muted, fontWeight: '700' }}>
                          {mineHere ? '✓ Asignada (quitar)' : slot ? slot.name : 'Asignar'}
                        </Text>
                      </TouchableOpacity>
                    );
                  };
                  return (
                    <View key={m.id} style={{ padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: on ? colors.success : colors.border, backgroundColor: on ? '#F1FAF4' : colors.surface, marginBottom: spacing.xs }}>
                      <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '800' }}>{on ? '✅ ' : ''}{m.code}</Text>
                      <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>{(m.tipo || 'Sin tipo')} · {m.companyName} · {((m as any).plate || (m as any).serial || '—')}</Text>
                      <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.xs }}>📍 {edif || 'Sin edificio/referencia'}</Text>
                      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                        {shiftBtn('day')}
                        {shiftBtn('night')}
                      </View>
                    </View>
                  );
                })}
                {checkList.length === 0 ? <EmptyState title="Sin resultados" subtitle="Prueba con otro nombre o empresa." /> : null}
                <View style={{ height: spacing.xl }} />
              </ScrollView>
            </>
          )}
        </Screen>
      </Modal>

      {/* Surtir gasoil a la máquina del check-in */}
      <SurtidoGasoilModal machineId={gasoilId} onClose={() => setGasoilId(null)} authorName={fullName} authorId={uid || null} />

      {/* Modal de check-in: GPS + estado + nota. */}
      <Modal visible={!!ci} transparent animationType="fade" onRequestClose={() => setCi(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, maxHeight: '85%' }}>
            <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18 }}>✅ Revisé la máquina</Text>
              {ci ? (
                <View style={{ marginBottom: spacing.sm }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{ci.code}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>🏢 {ci.companyName}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>🔖 Serial/Placa: {((ci as any).plate || (ci as any).serial || '—')}</Text>
                </View>
              ) : null}

              {/* GPS / cercanía */}
              <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm, borderLeftWidth: 3, borderLeftColor: gpsBusy ? colors.border : near === true ? colors.success : near === false ? colors.warning : colors.border }}>
                {gpsBusy ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <ActivityIndicator color={colors.primary} /><Text style={{ color: colors.muted, fontSize: 12 }}>Obteniendo tu ubicación…</Text>
                  </View>
                ) : gps ? (
                  ci && ci.latitude != null && ci.longitude != null ? (
                    <Text style={{ color: near ? colors.success : colors.warning, fontWeight: '800', fontSize: 13 }}>
                      {near ? `📍 En sitio ✓ · a ~${dist} m de la máquina` : `📍 Estás a ~${dist} m (lejos ⚠️)`}
                    </Text>
                  ) : (
                    <Text style={{ color: colors.muted, fontSize: 12 }}>📍 Ubicación tomada. La máquina aún no tiene ubicación guardada para comparar.</Text>
                  )
                ) : (
                  <Text style={{ color: colors.danger, fontSize: 12 }}>⚠️ {gpsErr ?? 'Sin ubicación.'}</Text>
                )}
                <TouchableOpacity onPress={recapture} disabled={gpsBusy} style={{ marginTop: 6 }}>
                  <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>↻ Volver a tomar ubicación</Text>
                </TouchableOpacity>
                {/* Edificio del catálogo: DESPLEGABLE. Se guarda con la ubicación y sale
                    en el reporte "Máquinas por sector" del Mapa. "Otro…" permite escribir. */}
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Edificio</Text>
                <TouchableOpacity
                  onPress={() => setRefOpen((v) => !v)}
                  activeOpacity={0.8}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md }}
                >
                  <Text style={{ color: ciRef ? colors.text : colors.muted, fontSize: 14, flex: 1 }} numberOfLines={1}>
                    {ciRef || 'Selecciona el edificio…'}
                  </Text>
                  <Text style={{ color: colors.primary, fontWeight: '800' }}>{refOpen ? '▲' : '▼'}</Text>
                </TouchableOpacity>
                {refOpen ? (
                  <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, marginTop: 4, maxHeight: 240, overflow: 'hidden' }}>
                    <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                      {EDIFICIOS.map((e) => (
                        <TouchableOpacity key={e} onPress={() => { setCiRef(e); setRefOtro(false); setRefOpen(false); }} style={{ paddingVertical: 10, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: ciRef === e ? colors.surfaceAlt : colors.surface }}>
                          <Text style={{ color: colors.text, fontSize: 14 }}>{ciRef === e ? '✓ ' : ''}{e}</Text>
                        </TouchableOpacity>
                      ))}
                      <TouchableOpacity onPress={() => { setRefOtro(true); setCiRef(''); setRefOpen(false); }} style={{ paddingVertical: 10, paddingHorizontal: spacing.md, backgroundColor: colors.surface }}>
                        <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '700' }}>✏️ Otro (escribir a mano)…</Text>
                      </TouchableOpacity>
                    </ScrollView>
                  </View>
                ) : null}
                {refOtro ? (
                  <TextInput value={ciRef} onChangeText={setCiRef} placeholder="Escribe el edificio / referencia" placeholderTextColor={colors.muted} style={[input, { marginTop: 6 }]} />
                ) : null}
                {/* Guardar TU posición como la ubicación de la máquina (queda en el mapa) + la referencia. */}
                <TouchableOpacity onPress={guardarUbicacionMaquina} disabled={savingMachLoc || gpsBusy} style={{ marginTop: spacing.sm, backgroundColor: '#2563EB', borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: (savingMachLoc || gpsBusy) ? 0.6 : 1 }}>
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>
                    {savingMachLoc ? 'Guardando…' : (ci && ci.latitude != null ? '📍 Actualizar ubicación + referencia' : '📍 Guardar ubicación + referencia')}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* ── Jornada de la máquina: INICIAR → FINALIZAR (cuenta las horas) ── */}
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Jornada de la máquina</Text>
              {jornadaStart ? (
                <View style={{ marginBottom: spacing.sm }}>
                  <View style={{ backgroundColor: '#E8F5EC', borderWidth: 1, borderColor: '#1E9E4A', borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.xs }}>
                    <Text style={{ color: '#0F5C2E', fontWeight: '800', fontSize: 12 }}>
                      🟢 Jornada en curso ({jornadaShift === 'night' ? '🌙 noche' : '☀️ día'}) · desde {caracasClock(jornadaStart)}
                    </Text>
                    <Text style={{ color: '#0F5C2E', fontSize: 12, marginTop: 2 }}>⏱️ Tiempo trabajado: {elapsedLabel(jornadaStart, nowTick)}</Text>
                  </View>
                  {finConfirm ? (
                    <View style={{ backgroundColor: '#EAF1FB', borderWidth: 1, borderColor: '#2563EB', borderRadius: radius.md, padding: spacing.sm }}>
                      <Text style={{ color: '#12356B', fontWeight: '800', fontSize: 13, textAlign: 'center' }}>¿Finalizar la jornada?</Text>
                      <Text style={{ color: '#12356B', fontSize: 13, marginTop: 4, textAlign: 'center' }}>
                        Total trabajado: <Text style={{ fontWeight: '900' }}>{elapsedLabel(jornadaStart, nowTick)}</Text>
                        {'  '}({((Math.max(0, nowTick - new Date(jornadaStart).getTime())) / 3600000).toFixed(2)} h)
                      </Text>
                      <Text style={{ color: '#12356B', fontSize: 11, marginTop: 2, marginBottom: spacing.sm, textAlign: 'center' }}>
                        Se sumarán al turno de {jornadaShift === 'night' ? 'noche 🌙' : 'día ☀️'} en Control de maquinaria.
                      </Text>
                      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Horómetro final{horoIni ? ` (inicial: ${horoIni})` : ''}</Text>
                      <TextInput value={horoFin} onChangeText={(t) => setHoroFin(t.replace(/[^0-9.,]/g, ''))} keyboardType="numeric" inputMode="decimal" placeholder="0" placeholderTextColor={colors.muted} style={[input, { marginBottom: spacing.sm }]} />
                      <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Este horómetro final será el inicial de la próxima jornada.</Text>
                      {(() => {
                        const hf = Number((horoFin || '').replace(',', '.'));
                        const hi = Number((horoIni || '').replace(',', '.'));
                        if (isFinite(hf) && isFinite(hi) && hf >= hi && horoFin) {
                          return <Text style={{ color: '#12356B', fontSize: 12, marginBottom: spacing.sm, textAlign: 'center' }}>⚙️ Por horómetro: <Text style={{ fontWeight: '900' }}>{Math.round((hf - hi) * 100) / 100} h</Text> (final − inicial)</Text>;
                        }
                        return <View style={{ marginBottom: spacing.sm }} />;
                      })()}
                      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                        <TouchableOpacity onPress={() => setFinConfirm(false)} disabled={jornadaBusy} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', backgroundColor: colors.surface }}>
                          <Text style={{ color: colors.text, fontWeight: '800' }}>Cancelar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={finalizarJornada} disabled={jornadaBusy} style={{ flex: 1, backgroundColor: '#2563EB', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: jornadaBusy ? 0.6 : 1 }}>
                          <Text style={{ color: '#fff', fontWeight: '800' }}>{jornadaBusy ? 'Guardando…' : 'Sí, finalizar'}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <TouchableOpacity onPress={() => setFinConfirm(true)} disabled={jornadaBusy} style={{ backgroundColor: '#2563EB', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: jornadaBusy ? 0.6 : 1 }}>
                      <Text style={{ color: '#fff', fontWeight: '800' }}>🏁 FINALIZAR JORNADA</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                <View style={{ marginBottom: spacing.sm }}>
                  {/* Turno + HORA de inicio declarada (por defecto 7:00am día / 7:00pm noche). */}
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Turno de la jornada</Text>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
                    {(['day', 'night'] as const).map((s) => {
                      const on = iniShift === s;
                      return (
                        <TouchableOpacity key={s} onPress={() => { setIniShift(s); setIniTime(s === 'night' ? '19:00' : '07:00'); }} style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 2, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface }}>
                          <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 13 }}>{s === 'day' ? '☀️ Día' : '🌙 Noche'}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Hora de inicio (HH:MM) · se acota contra la hora del sistema</Text>
                  <TextInput value={iniTime} onChangeText={(t) => setIniTime(t.replace(/[^0-9:]/g, '').slice(0, 5))} placeholder={iniShift === 'night' ? '19:00' : '07:00'} placeholderTextColor={colors.muted} keyboardType="numbers-and-punctuation" style={[input, { marginBottom: 4 }]} />
                  <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.sm }}>Máximo para declarar sin alerta: {iniShift === 'night' ? '9:30pm' : '9:30am'}. Si se declara tarde se avisa a los administradores.</Text>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Horómetro inicial (= final de la jornada anterior)</Text>
                  <TextInput value={horoIni} onChangeText={(t) => setHoroIni(t.replace(/[^0-9.,]/g, ''))} keyboardType="numeric" inputMode="decimal" placeholder="0" placeholderTextColor={colors.muted} style={[input, { marginBottom: spacing.sm }]} />
                  <TouchableOpacity onPress={iniciarJornada} disabled={jornadaBusy} style={{ backgroundColor: '#1E9E4A', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: jornadaBusy ? 0.6 : 1 }}>
                    <Text style={{ color: '#fff', fontWeight: '800' }}>{jornadaBusy ? 'Guardando…' : '🟢 INICIAR JORNADA'}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Si la máquina está PARADA, permite volver a ponerla OPERATIVA. */}
              {ci && paradaIds.has(ci.id) ? (
                <View style={{ backgroundColor: '#FFF7E6', borderWidth: 1, borderColor: '#F0C36D', borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
                  <Text style={{ color: '#7A4A0B', fontWeight: '800', fontSize: 12 }}>🟡 Esta máquina está marcada PARADA.</Text>
                  <TouchableOpacity onPress={volverOperativa} disabled={ciSaving} style={{ marginTop: spacing.xs, backgroundColor: '#1E9E4A', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: ciSaving ? 0.6 : 1 }}>
                    <Text style={{ color: '#fff', fontWeight: '800' }}>{ciSaving ? 'Guardando…' : '🟢 Volver a OPERATIVA'}</Text>
                  </TouchableOpacity>
                  <Text style={{ color: '#7A4A0B', fontSize: 11, marginTop: 4 }}>Cierra la avería en Mantenimiento y la máquina deja de aparecer como parada en Control.</Text>
                </View>
              ) : null}

              {/* PARADA → avería (Mantenimiento) + inspección (Inspecciones). Pide el motivo. */}
              <TouchableOpacity onPress={() => setParadaOpen((v) => !v)} disabled={ciSaving} style={{ backgroundColor: paradaOpen ? '#D9A200' : colors.surface, borderWidth: 2, borderColor: '#D9A200', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginBottom: spacing.sm }}>
                <Text style={{ color: paradaOpen ? '#fff' : '#8A6A00', fontWeight: '800' }}>🟡 PARADA (marcar avería)</Text>
              </TouchableOpacity>
              {paradaOpen ? (
                <View style={{ backgroundColor: '#FFF7E6', borderWidth: 1, borderColor: '#F0C36D', borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
                  <Text style={{ color: '#7A4A0B', fontWeight: '800', fontSize: 12, marginBottom: 4 }}>Motivo de la avería (obligatorio)</Text>
                  <TextInput value={ciMotivo} onChangeText={setCiMotivo} placeholder="Ej: falla hidráulica, sin arranque, cauchos…" placeholderTextColor={colors.muted} style={input} />
                  <Text style={{ color: '#7A4A0B', fontSize: 11, marginTop: 4 }}>Crea una avería en Mantenimiento y aparece en Inspecciones. En Control saldrá “MÁQUINA PARADA”.</Text>
                  <TouchableOpacity onPress={marcarParada} disabled={ciSaving} style={{ marginTop: spacing.sm, backgroundColor: '#D9A200', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: ciSaving ? 0.6 : 1 }}>
                    <Text style={{ color: '#fff', fontWeight: '800' }}>{ciSaving ? 'Guardando…' : '🟡 Confirmar PARADA + avería'}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Nota (opcional)</Text>
              <TextInput value={ciNote} onChangeText={setCiNote} placeholder="Observación…" placeholderTextColor={colors.muted} style={input} />

              {/* ── Registrar operador SIN teléfono: escanear su carnet + cotejar cédula
                     → inicia su jornada en esta máquina. Es opcional (independiente
                     de marcar la máquina como revisada). ───────────────────────── */}
              <View style={{ marginTop: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>👷 Iniciar jornada del operador</Text>
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
                  Si el operador no tiene teléfono: escanea su carnet y coteja su cédula para arrancar su jornada en esta máquina.
                </Text>
                <TouchableOpacity onPress={() => { setNotice(null); setOpScanOpen(true); }} style={{ marginTop: spacing.sm, backgroundColor: '#0EA5E9', borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontWeight: '800' }}>📷 {opEmp ? 'Volver a escanear carnet' : 'Escanear carnet del operador'}</Text>
                </TouchableOpacity>

                {opEmp ? (
                  <View style={{ marginTop: spacing.sm }}>
                    <View style={{ backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm, borderLeftWidth: 3, borderLeftColor: colors.success }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>📇 {opEmp.name}</Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>{opEmp.cargo || 'Sin cargo'}</Text>
                    </View>

                    {/* Turno de la jornada: sol (día) / luna (noche) */}
                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Turno de la jornada</Text>
                    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                      {([['day', '☀️', 'Día', '#EA6A1F'], ['night', '🌙', 'Noche', '#3B5BA5']] as const).map(([key, icon, label, tint]) => {
                        const on = opShift === key;
                        return (
                          <TouchableOpacity
                            key={key}
                            onPress={() => setOpShift(key)}
                            style={{ flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 2, borderColor: on ? tint : colors.border, backgroundColor: on ? tint + '22' : colors.surface, alignItems: 'center' }}
                          >
                            <Text style={{ fontSize: 26 }}>{icon}</Text>
                            <Text style={{ color: on ? tint : colors.text, fontWeight: '800', fontSize: 13, marginTop: 2 }}>{label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Coteja la cédula del operador</Text>
                    <TextInput value={opConfirmCedula} onChangeText={(t) => setOpConfirmCedula(t.replace(/\D/g, ''))} keyboardType="number-pad" inputMode="numeric" placeholder="Cédula del operador" placeholderTextColor={colors.muted} style={input} />
                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Horómetro inicial</Text>
                    <TextInput value={opHoro} onChangeText={(t) => setOpHoro(t.replace(/[^0-9.,]/g, ''))} keyboardType="numeric" inputMode="decimal" placeholder="0" placeholderTextColor={colors.muted} style={input} />
                    <TouchableOpacity onPress={tomarFotoHoroSup} disabled={opHoroUploading} style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: opHoroPhoto ? colors.success : colors.border, backgroundColor: colors.surface }}>
                      <Text style={{ color: opHoroPhoto ? colors.success : colors.text, fontWeight: '700' }}>{opHoroUploading ? 'Subiendo…' : opHoroPhoto ? '✓ Foto del horómetro adjunta' : '📷 Foto del horómetro'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={confirmOperatorJornada} disabled={opBusy} style={{ marginTop: spacing.md, backgroundColor: '#1E9E4A', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: opBusy ? 0.6 : 1 }}>
                      <Text style={{ color: '#fff', fontWeight: '800' }}>{opBusy ? 'Guardando…' : '🟢 Iniciar jornada del operador'}</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>

              {/* ── Avería de maquinaria (misma función que el operador) → Mantenimiento ── */}
              <View style={{ marginTop: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm, borderWidth: 1, borderColor: colors.border }}>
                <TouchableOpacity onPress={() => setAvOpen((v) => !v)} activeOpacity={0.8} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>🛠️ Avería de maquinaria</Text>
                  <Text style={{ color: colors.primary, fontWeight: '800' }}>{avOpen ? '▲' : '▼'}</Text>
                </TouchableOpacity>
                {avOpen ? (
                  <View style={{ marginTop: spacing.sm }}>
                    <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.xs }}>Toca el material que se necesita cambiar. Va al módulo de Mantenimiento de Maquinaria.</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                      {AV_MATERIALS.map((mt) => {
                        const on = avMaterial === mt.key;
                        return (
                          <TouchableOpacity key={mt.key} onPress={() => setAvMaterial(mt.key)} style={{ width: '47%', alignItems: 'center', paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 2, borderColor: on ? '#2563EB' : colors.border, backgroundColor: on ? '#2563EB' : colors.surface }}>
                            <Text style={{ fontSize: 28 }}>{mt.icon}</Text>
                            <Text style={{ color: on ? '#fff' : colors.text, fontWeight: '800', marginTop: 2, fontSize: 13 }}>{mt.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    {avMaterial ? (
                      <View style={{ marginTop: spacing.sm }}>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>Cantidad a cambiar</Text>
                        <TextInput value={avQty} onChangeText={(t) => setAvQty(t.replace(/[^0-9.,]/g, ''))} keyboardType="numeric" inputMode="decimal" placeholder="0" placeholderTextColor={colors.muted} style={input} />
                        <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>Nota (opcional)</Text>
                        <TextInput value={avNote} onChangeText={setAvNote} placeholder="Detalle…" placeholderTextColor={colors.muted} style={input} />
                        <TouchableOpacity onPress={subirFotoAveria} disabled={avPhotoUp} style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: avPhoto ? colors.success : colors.border, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
                          <Text style={{ color: avPhoto ? colors.success : colors.text, fontWeight: '700', fontSize: 13 }}>{avPhotoUp ? 'Subiendo…' : avPhoto ? '✓ Foto de referencia adjunta' : '📷 Foto de referencia (opcional)'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={registrarAveria} disabled={avSaving} style={{ marginTop: spacing.sm, backgroundColor: '#2563EB', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: avSaving ? 0.6 : 1 }}>
                          <Text style={{ color: '#fff', fontWeight: '800' }}>{avSaving ? 'Guardando…' : '🛠️ Registrar avería'}</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>

              {/* ── Surtir gasoil (horómetro + litros, surtido vs consumido) ── */}
              {ci ? (
                <TouchableOpacity onPress={() => setGasoilId(ci.id)} style={{ marginTop: spacing.md, backgroundColor: '#15803D', borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontWeight: '800' }}>⛽ Surtir gasoil</Text>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity onPress={() => setCi(null)} style={{ marginTop: spacing.md, padding: spacing.sm, alignItems: 'center' }}>
                <Text style={{ color: colors.muted, fontWeight: '700' }}>Cerrar</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Escáner del carnet del operador (QR ?empleado=<id>) → coteja e inicia jornada. */}
      <Modal visible={opScanOpen} animationType="slide" onRequestClose={() => setOpScanOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <QrScanner onClose={() => setOpScanOpen(false)} onDetected={onOperatorCarnet} />
        </View>
      </Modal>
    </Screen>
  );
}
