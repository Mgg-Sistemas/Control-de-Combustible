import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, Pressable, ScrollView, Linking } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { Screen, Card, SectionTitle, EmptyState, SkeletonList } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import QrScanner from '../components/QrScanner';
import InspectorHeroCard from '../components/redesign/InspectorHeroCard';
import EdificioPicker from '../components/EdificioPicker';
import { captureLocation } from '../lib/location';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { machineLabel as etiquetaMaquina } from '../lib/machineLabel';
import { spacing, radius } from '../theme';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { caracasBusinessToday, caracasNowShift } from '../lib/caracasDay';
import { buildDaySets, computeMachineVisibilitySets, DaySetRound, DaySetMaint, DaySetAssign } from '../lib/inspectorDaySets';
import { listInspectorAssignments } from '../lib/machineInspectors';
import { listOperatorAssignments, assignOperator, unassignOperator, Shift, shiftIcon, shiftLabel, OperatorAssignmentRow } from '../lib/machineOperators';
import { isOperatorCargo } from '../lib/jornada';
import { markAttendance, pairMarks } from '../lib/attendance';
import { norm, cmpText } from '../lib/text';
import { pdfDocument, exportPdf } from '../lib/pdf';
import { logAudit } from '../lib/audit';
import { parseMachineId, parseEmployeeId } from './ScanQrScreen';
import { resolveScopedMachineIds } from '../lib/coordinatorScope';

type MachRow = {
  id: string; code: string; plate: string | null; serial: string | null; tipo: string | null;
  companyName: string; sector: string | null; encargado: string | null;
  active: boolean | null; operational: boolean | null; en_espera: boolean | null;
  referencia: string | null; latitude: number | null; longitude: number | null;
};
type Operator = { id: string; name: string; cedula: string | null; cargo: string | null };

type MachineState = 'averia' | 'parada' | 'activa' | 'cerrada' | 'pendiente';
const STATE_META: Record<MachineState, { label: string; bg: string; text: (c: any) => string }> = {
  averia: { label: 'Avería', bg: 'dangerSoftBg', text: (c) => c.dangerSoftText },
  parada: { label: 'Parada', bg: 'warningSoftBg', text: (c) => c.warningSoftText },
  activa: { label: 'Activa', bg: 'successSoftBg', text: (c) => c.successSoftText },
  cerrada: { label: 'Cerrada', bg: 'infoSoftBg', text: (c) => c.infoSoftText },
  pendiente: { label: 'Pendiente', bg: 'infoSoftBg', text: (c) => c.infoSoftText },
};

type Row = {
  id: string; code: string; plate: string | null; serial: string | null; tipo: string | null;
  companyName: string; sector: string | null; encargado: string | null;
  referencia: string | null; latitude: number | null; longitude: number | null;
  inspectorName: string | null;
  state: MachineState;
  planned: OperatorAssignmentRow | null;
  liveName: string | null;
  liveOpen: boolean;
  mismatch: boolean;
  attendance: 'ok' | 'no' | 'out' | null;
  attendanceTs: string | null;
};

const CARACAS_TZ = 'America/Caracas';
function fmtHora(ts: string): string {
  return new Intl.DateTimeFormat('es-VE', { timeZone: CARACAS_TZ, hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(ts));
}

/**
 * Vista de máquinas para el COORDINADOR DE OPERADORES: mismo motor de estado
 * (`buildDaySets`) que "Inspecciones" pero organizado por máquina en vez de
 * por persona. Por cada máquina: estado en vivo, operador PLANEADO (nuevo,
 * `machine_operators`) vs. el que de verdad está en sitio (`machine_rounds`),
 * y su asistencia del día — para asignar/reasignar, detectar máquinas sin
 * cubrir y avisar novedades hacia arriba (Coordinador de Operaciones/Jefe).
 */
export default function CoordinadorOperadoresScreen({ navigation }: any = {}) {
  const { colors } = useTheme();
  const { session, canSee } = useAuth();
  const uid = session?.user?.id ?? '';
  const today = caracasBusinessToday();
  // La hoja de asignar es un <Modal> nativo: si no se oculta al salir a otra pantalla
  // (p. ej. "Ver ficha"), queda flotando ENCIMA de esa pantalla porque los Modal no
  // forman parte del stack de navegación. `isFocused` la oculta al salir y la vuelve a
  // mostrar sola al volver — sin perder qué máquina/turno se estaba asignando.
  const isFocused = useIsFocused();

  const [shift, setShift] = useState<Shift>(caracasNowShift);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'maquinas' | 'sinasignar' | 'novedades' | 'operadores'>('maquinas');
  const [opTabQuery, setOpTabQuery] = useState('');

  const [machList, setMachList] = useState<MachRow[]>([]);
  // `DaySetRound` + operador día/noche: `buildDaySets` solo necesita los campos de
  // `DaySetRound`, pero `liveByMachine` (abajo) necesita también day_operator/
  // night_operator para saber quién está EN SITIO ahora mismo.
  const [rounds, setRounds] = useState<(DaySetRound & { day_operator: string | null; night_operator: string | null })[]>([]);
  const [maint, setMaint] = useState<DaySetMaint[]>([]);
  const [inspectorAssigns, setInspectorAssigns] = useState<DaySetAssign[]>([]);
  const [planned, setPlanned] = useState<OperatorAssignmentRow[]>([]);
  const [plannedMissing, setPlannedMissing] = useState(false);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [attendanceByEmp, setAttendanceByEmp] = useState<Record<string, { kind: 'entrada' | 'salida'; ts: string }[]>>({});

  const load = useCallback(async () => {
    const [{ data: machs }, { data: rs }, { data: mr }, insp, { rows: op, missing }, { data: emps }, { data: att }, scopedIds] = await Promise.all([
      supabase.from('machinery').select('id, code, plate, serial, tipo, sector, active, operational, en_espera, encargado, referencia, latitude, longitude, company:company_id(name)').eq('active', true),
      supabase.from('machine_rounds').select('machinery_id, round_date, day_hours, night_hours, day_operator, night_operator, jornada_shift, jornada_start_at, declared_day, declared_night').eq('round_date', today),
      supabase.from('maintenance_requests').select('machinery_id, material, notes, created_at').eq('status', 'pendiente'),
      listInspectorAssignments(),
      listOperatorAssignments(),
      supabase.from('employees').select('id, first_name, last_name, cedula, cargo').eq('status', 'activo'),
      supabase.from('attendance').select('employee_id, kind, ts').eq('work_date', today),
      resolveScopedMachineIds(uid),
    ]);
    setMachList(((machs ?? []) as any[]).filter((m) => !scopedIds || scopedIds.has(m.id)).map((m) => ({
      id: m.id, code: m.code ?? '—', plate: m.plate ?? null, serial: m.serial ?? null, tipo: m.tipo ?? null,
      companyName: m.company?.name ?? 'Sin empresa', sector: m.sector ?? null, encargado: m.encargado ?? null,
      active: m.active, operational: m.operational, en_espera: m.en_espera,
      referencia: m.referencia ?? null, latitude: m.latitude ?? null, longitude: m.longitude ?? null,
    })));
    setRounds(((rs ?? []) as any[]).map((r) => ({
      machinery_id: r.machinery_id, round_date: r.round_date, day_hours: r.day_hours, night_hours: r.night_hours,
      jornada_shift: r.jornada_shift, jornada_start_at: r.jornada_start_at,
      declared_day: r.declared_day, declared_night: r.declared_night,
      day_operator: r.day_operator ?? null, night_operator: r.night_operator ?? null,
    })));
    setMaint(((mr ?? []) as any[]).map((m) => ({ machinery_id: m.machinery_id, material: m.material, created_at: m.created_at })));
    setInspectorAssigns((insp.rows ?? []).map((a) => ({ machinery_id: a.machinery_id, inspector_name: a.inspector_name, shift: a.shift })));
    setPlanned(op);
    setPlannedMissing(missing);
    setOperators(((emps ?? []) as any[])
      .filter((e) => isOperatorCargo(e.cargo))
      .map((e) => ({ id: e.id, name: `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || 'Sin nombre', cedula: e.cedula ?? null, cargo: e.cargo ?? null })));
    const byEmp: Record<string, { kind: 'entrada' | 'salida'; ts: string }[]> = {};
    ((att ?? []) as any[]).forEach((r) => { const k = r.employee_id as string; (byEmp[k] ??= []).push({ kind: r.kind, ts: r.ts }); });
    setAttendanceByEmp(byEmp);
    setLoading(false);
  }, [today, uid]);
  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(['machine_operators', 'machine_rounds', 'attendance', 'operator_assignments', 'maintenance_requests', 'machine_inspectors', 'machinery', 'coordinator_company_scope', 'coordinator_machine_scope'], () => load(), { debounceMs: 1000, maxWaitMs: 3000 });

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const { machInactiveSet, machHardInactiveSet } = useMemo(() => computeMachineVisibilitySets(machList), [machList]);
  const daySets = useMemo(
    () => buildDaySets({ rounds, maint, assignments: inspectorAssigns, selDay: today, shiftArg: shift, machInactiveSet, machHardInactiveSet }),
    [rounds, maint, inspectorAssigns, today, shift, machInactiveSet, machHardInactiveSet],
  );

  // Operador PLANEADO por máquina, para el turno elegido (y también el otro turno, para el modal).
  const plannedByMachine = useMemo(() => {
    const map = new Map<string, { day?: OperatorAssignmentRow; night?: OperatorAssignmentRow }>();
    planned.forEach((p) => { const cur = map.get(p.machinery_id) ?? {}; cur[p.shift] = p; map.set(p.machinery_id, cur); });
    return map;
  }, [planned]);

  // Operador REAL (en sitio) por máquina, del round de hoy, para el turno elegido.
  const liveByMachine = useMemo(() => {
    const map = new Map<string, { name: string | null; open: boolean }>();
    rounds.forEach((r: any) => {
      const name = (shift === 'day' ? r.day_operator : r.night_operator) as string | null;
      const open = !!r.jornada_start_at && (r.jornada_shift === shift || (!r.jornada_shift));
      if (name || open) map.set(r.machinery_id, { name: name || null, open });
    });
    return map;
  }, [rounds, shift]);

  // Inspector asignado a cada máquina en el turno elegido (solo para mostrarlo — el
  // coordinador de operadores no lo asigna, eso es de Coordinador de Inspectores).
  const inspectorByMachine = useMemo(() => {
    const map = new Map<string, string>();
    inspectorAssigns.forEach((a) => { if (a.shift === shift && a.inspector_name) map.set(a.machinery_id, a.inspector_name); });
    return map;
  }, [inspectorAssigns, shift]);

  const attendanceOf = (employeeId: string | null): { status: 'ok' | 'no' | 'out' | null; ts: string | null } => {
    if (!employeeId) return { status: null, ts: null };
    const marks = attendanceByEmp[employeeId];
    if (!marks || marks.length === 0) return { status: 'no', ts: null };
    const { pairs, open } = pairMarks(marks);
    if (pairs.length === 0) return { status: 'no', ts: null };
    const last = pairs[pairs.length - 1];
    return open ? { status: 'ok', ts: last.in } : { status: 'out', ts: last.out };
  };

  // Universo de máquinas relevantes de ESTE turno: asignadas (inspector), en curso,
  // paradas o averiadas — mismo criterio de visibilidad que Inspecciones/Catálogo.
  const universeRows: Row[] = useMemo(() => {
    const ids = new Set<string>([...daySets.assignedShift, ...daySets.startedSet, ...daySets.averSet, ...daySets.paradaSet]);
    // Suma también las que ya tienen operador PLANEADO en este turno, aunque
    // todavía no haya actividad registrada (el coordinador planea antes de que
    // el operador escanee el QR).
    planned.forEach((p) => { if (p.shift === shift) ids.add(p.machinery_id); });
    const rows: Row[] = [];
    ids.forEach((id) => {
      if (machHardInactiveSet.has(id) || (machInactiveSet.has(id) && !daySets.anyOpenSet.has(id))) return;
      const m = machList.find((x) => x.id === id);
      if (!m) return;
      const state: MachineState = daySets.averSet.has(id) ? 'averia'
        : daySets.paradaSet.has(id) ? 'parada'
        : daySets.activeNowSet.has(id) ? 'activa'
        : daySets.closedSet.has(id) ? 'cerrada'
        : 'pendiente';
      const plan = plannedByMachine.get(id)?.[shift] ?? null;
      const live = liveByMachine.get(id) ?? null;
      const mismatch = !!(plan && live?.name && norm(plan.operator_name) !== norm(live.name));
      const att = attendanceOf(plan?.employee_id ?? null);
      rows.push({
        id, code: m.code, plate: m.plate, serial: m.serial, tipo: m.tipo, companyName: m.companyName, sector: m.sector,
        encargado: m.encargado, referencia: m.referencia, latitude: m.latitude, longitude: m.longitude,
        inspectorName: inspectorByMachine.get(id) ?? null,
        state, planned: plan, liveName: live?.name ?? null, liveOpen: !!live?.open, mismatch,
        attendance: att.status, attendanceTs: att.ts,
      });
    });
    rows.sort((a, b) => {
      const aUnassigned = !a.planned, bUnassigned = !b.planned;
      if (aUnassigned !== bUnassigned) return aUnassigned ? -1 : 1;
      if (a.mismatch !== b.mismatch) return a.mismatch ? -1 : 1;
      return cmpText(a.code, b.code);
    });
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daySets, planned, plannedByMachine, liveByMachine, machList, machInactiveSet, machHardInactiveSet, shift, attendanceByEmp, inspectorByMachine]);

  const sinAsignarRows = useMemo(() => universeRows.filter((r) => !r.planned), [universeRows]);
  const mismatchRows = useMemo(() => universeRows.filter((r) => r.mismatch), [universeRows]);
  const ausenciaRows = useMemo(() => universeRows.filter((r) => r.planned && r.attendance === 'no'), [universeRows]);

  // Buscador de las pestañas "Máquinas"/"Sin asignar": por nombre/placa/serial de
  // la máquina o por el nombre del operador (planeado o el que está en sitio).
  const [machQuery, setMachQuery] = useState('');
  const matchesMachQuery = useCallback((r: Row) => {
    const q = norm(machQuery.trim());
    if (!q) return true;
    return norm(r.code).includes(q) || norm(r.plate || '').includes(q) || norm(r.serial || '').includes(q)
      || norm(r.companyName).includes(q) || norm(r.planned?.operator_name || '').includes(q) || norm(r.liveName || '').includes(q);
  }, [machQuery]);
  const universeRowsShown = useMemo(() => universeRows.filter(matchesMachQuery), [universeRows, matchesMachQuery]);
  const sinAsignarRowsShown = useMemo(() => sinAsignarRows.filter(matchesMachQuery), [sinAsignarRows, matchesMachQuery]);

  // ── Vista por PERSONA (pestaña "Operadores"): el resto de la pantalla está
  // organizada por máquina; esta es la única que arranca del roster de
  // `employees` (TODOS los operadores activos, tengan o no máquina hoy) y
  // cruza para cada uno su máquina PLANEADA de este turno, quién está de
  // verdad en sitio y su asistencia — reusa exactamente los datos que ya
  // carga esta pantalla (`operators`, `planned`, `liveByMachine`,
  // `attendanceOf`), sin pedir nada nuevo al servidor.
  type OperatorRow = {
    operator: Operator; machineCode: string | null; companyName: string | null;
    liveName: string | null; mismatch: boolean;
    attendance: 'ok' | 'no' | 'out' | null; attendanceTs: string | null;
  };
  const plannedByEmp = useMemo(() => {
    const map = new Map<string, OperatorAssignmentRow>();
    planned.forEach((p) => { if (p.shift === shift && p.employee_id) map.set(p.employee_id, p); });
    return map;
  }, [planned, shift]);
  const operatorRows: OperatorRow[] = useMemo(() => {
    const rows = operators.map((o) => {
      const plan = plannedByEmp.get(o.id) ?? null;
      const mach = plan ? machList.find((m) => m.id === plan.machinery_id) : null;
      const live = plan ? liveByMachine.get(plan.machinery_id) ?? null : null;
      const mismatch = !!(plan && live?.name && norm(plan.operator_name) !== norm(live.name));
      const att = attendanceOf(o.id);
      return {
        operator: o, machineCode: mach?.code ?? null, companyName: mach?.companyName ?? null,
        liveName: live?.name ?? null, mismatch, attendance: att.status, attendanceTs: att.ts,
      };
    });
    rows.sort((a, b) => {
      const aSin = !a.machineCode, bSin = !b.machineCode;
      if (aSin !== bSin) return aSin ? 1 : -1; // los que SÍ tienen máquina primero
      return cmpText(a.operator.name, b.operator.name);
    });
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operators, plannedByEmp, machList, liveByMachine, attendanceByEmp]);
  const operatorRowsShown = useMemo(() => {
    const q = norm(opTabQuery.trim());
    if (!q) return operatorRows;
    return operatorRows.filter((r) =>
      norm(r.operator.name).includes(q) || norm(r.operator.cedula || '').includes(q) || norm(r.machineCode || '').includes(q) || norm(r.companyName || '').includes(q)
    );
  }, [operatorRows, opTabQuery]);

  // ── Asignar / reasignar operador ──────────────────────────────────────────
  const [assignFor, setAssignFor] = useState<{ id: string; code: string; companyName: string } | null>(null);
  const [assignShift, setAssignShift] = useState<Shift>('day');
  const [opQuery, setOpQuery] = useState('');
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignNotice, setAssignNotice] = useState<string | null>(null);
  const openAssign = (r: { id: string; code: string; companyName: string }) => {
    // Reinicia TODO el estado del modal, incluyendo los "busy" — si se cerró
    // mientras una acción seguía en curso para OTRA máquina, no debe arrastrarse
    // un botón bloqueado en "Guardando…" para la máquina que se abre ahora.
    setAssignFor(r); setAssignShift(shift); setOpQuery(''); setAssignNotice(null); setAssignBusy(false);
    setLocRef(machList.find((m) => m.id === r.id)?.referencia ?? ''); setLocNotice(null); setLocOpen(false); setLocBusy(false);
  };
  const opsShown = useMemo(() => {
    const q = norm(opQuery.trim());
    return [...operators].sort((a, b) => cmpText(a.name, b.name)).filter((o) => !q || norm(o.name).includes(q) || norm(o.cedula || '').includes(q));
  }, [operators, opQuery]);
  // "Según disponibilidad": si el operador ya está planeado en OTRA máquina en
  // este mismo turno, avisa antes de duplicarlo — antes no había ninguna señal
  // y el coordinador podía asignar a la misma persona dos veces sin darse cuenta.
  const otroPlaneadoDe = useMemo(() => {
    const map = new Map<string, string>(); // employee_id -> code de la OTRA máquina
    planned.forEach((p) => {
      if (p.shift !== assignShift || !p.employee_id || !assignFor || p.machinery_id === assignFor.id) return;
      const code = machList.find((m) => m.id === p.machinery_id)?.code;
      if (code) map.set(p.employee_id, code);
    });
    return map;
  }, [planned, assignShift, assignFor, machList]);
  const applyAssign = async (s: Shift, op: Operator | null) => {
    if (!assignFor || assignBusy) return;
    setAssignBusy(true); setAssignNotice(null);
    // Operador ANTES del cambio (para dejar "de X a Y" en la auditoría, no solo el
    // resultado final — así se sabe qué pasó cuando se reasigna una máquina averiada).
    const before = plannedByMachine.get(assignFor.id)?.[s] ?? null;
    const res = op
      ? await assignOperator(assignFor.id, op.id, op.name, op.cedula, s, uid || null)
      : await unassignOperator(assignFor.id, s);
    setAssignBusy(false);
    if (res.error) {
      setAssignNotice(res.missing ? '❌ Falta activar la tabla machine_operators en Supabase.' : '❌ ' + res.error);
      return;
    }
    const beforeTxt = before ? before.operator_name : 'sin operador';
    const afterTxt = op ? op.name : 'sin operador';
    logAudit('CHECK', 'machinery', assignFor.id, `Operador ${assignFor.code} · ${shiftIcon(s)} ${shiftLabel(s)}: ${beforeTxt} → ${afterTxt}`);
    await load();
    setAssignNotice(op ? `✅ ${shiftIcon(s)} ${shiftLabel(s)} → ${op.name}` : `➖ ${shiftIcon(s)} ${shiftLabel(s)} quitado`);
  };

  // ── Actualizar la UBICACIÓN de la máquina (GPS + edificio) desde el mismo modal ──
  // Misma función que usa el inspector (`captureLocation`, RPC SECURITY DEFINER):
  // funciona sin importar el rol base del usuario, porque el coordinador puede
  // tener profiles.role='conductor' (sin permiso de escritura directa en machinery).
  const [locOpen, setLocOpen] = useState(false);
  const [locRef, setLocRef] = useState('');
  const [locBusy, setLocBusy] = useState(false);
  const [locNotice, setLocNotice] = useState<string | null>(null);
  const guardarUbicacion = async () => {
    if (!assignFor || locBusy) return;
    setLocBusy(true); setLocNotice(null);
    const r = await captureLocation(assignFor.id, locRef);
    setLocBusy(false);
    if (!r.ok) { setLocNotice('❌ ' + (r.error ?? 'No se pudo guardar la ubicación.')); return; }
    setLocNotice('✅ Ubicación guardada.');
    await load();
  };

  // ── Asignar escaneando el CARNET del operador (en vez de buscar en la lista) ──
  // Mismo criterio de validación que `onOperatorCarnet` de SupervisorScreen
  // (cargo debe poder operar), pero acá es más simple: solo PLANEA quién debería
  // estar (no inicia jornada), así que no hace falta cotejar cédula/horómetro.
  const [opScanOpen, setOpScanOpen] = useState(false);
  const onOperatorScanDetected = async (text: string) => {
    setOpScanOpen(false);
    if (!assignFor) return;
    const id = parseEmployeeId(text);
    if (!id) { setAssignNotice('❌ Ese QR no es un carnet de empleado.'); return; }
    const { data } = await supabase.from('employees').select('id, first_name, last_name, cargo, cedula').eq('id', id).maybeSingle();
    const emp = data as any;
    if (!emp) { setAssignNotice('❌ Ese carnet no corresponde a un empleado registrado.'); return; }
    const nombre = `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim() || 'Sin nombre';
    if (!isOperatorCargo(emp.cargo)) { setAssignNotice(`❌ ${nombre}${emp.cargo ? ` (${emp.cargo})` : ''} no es operador, chofer, obrero ni servicios generales.`); return; }
    await applyAssign(assignShift, { id: emp.id, name: nombre, cedula: emp.cedula ?? null, cargo: emp.cargo ?? null });
  };

  // ── Marcar asistencia escaneando el CARNET del operador (entrada/salida) ──
  // Botón propio, independiente de cualquier máquina: el coordinador escanea a
  // cada operador según va llegando y `markAttendance` decide sola si es
  // ENTRADA o SALIDA (misma función que usa "Control de Asistencia").
  const [attScanOpen, setAttScanOpen] = useState(false);
  const [attNotice, setAttNotice] = useState<string | null>(null);
  const [attBusy, setAttBusy] = useState(false);
  const onAttendanceScanDetected = async (text: string) => {
    setAttScanOpen(false);
    const id = parseEmployeeId(text);
    if (!id) { setAttNotice('❌ Ese QR no es un carnet de empleado.'); return; }
    setAttBusy(true);
    const { data } = await supabase.from('employees').select('id, first_name, last_name, cargo, status').eq('id', id).maybeSingle();
    const emp = data as any;
    if (!emp) { setAttBusy(false); setAttNotice('❌ Ese carnet no corresponde a un empleado registrado.'); return; }
    const nombre = `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim() || 'Sin nombre';
    if (!isOperatorCargo(emp.cargo)) { setAttBusy(false); setAttNotice(`❌ ${nombre}${emp.cargo ? ` (${emp.cargo})` : ''} no es operador, chofer, obrero ni servicios generales.`); return; }
    // El roster de la pestaña "Operadores" solo trae empleados status='activo' (misma
    // consulta que load()) — si se dejara marcar asistencia a alguien inactivo, quedaría
    // registrada pero invisible ahí para siempre. Se bloquea acá para que sea consistente.
    if (emp.status && emp.status !== 'activo') { setAttBusy(false); setAttNotice(`❌ ${nombre} figura como "${emp.status}", no activo — no se le puede marcar asistencia.`); return; }
    const r = await markAttendance(emp.id, uid || null);
    setAttBusy(false);
    if (!r.ok) { setAttNotice('❌ ' + r.error); return; }
    setAttNotice(`✅ ${r.kind === 'entrada' ? 'Entrada' : 'Salida'} registrada · ${nombre} · ${fmtHora(r.ts)}`);
    await load();
  };

  // ── Escanear QR de la máquina (como el inspector) — abre SIEMPRE la hoja de
  // asignar/reasignar (antes saltaba directo a la ficha del operador planeado,
  // sin forma de corregirlo ni ver quién lo asignó — justo lo que el coordinador
  // necesita cuando hay cambio de turno o el operador mostrado no es el que él
  // asignó). Desde la hoja se puede ver "Planeado ahora · por quién" y también
  // abrir la ficha completa con el botón 👁️ si hace falta.
  const [scanOpen, setScanOpen] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const onScanDetected = (text: string) => {
    setScanOpen(false);
    const id = parseMachineId(text);
    // `machList` solo trae máquinas ACTIVAS: si el id es válido pero no aparece
    // acá, puede ser un QR de una máquina dada de baja (no necesariamente inválido).
    const m = id ? machList.find((x) => x.id === id) : null;
    if (!m) { setScanNotice(id ? '❌ Esta máquina no está disponible (no existe o está dada de baja).' : '❌ El QR escaneado no es de una máquina.'); return; }
    // "Esperando instrucciones" = congelada (pedido del cliente 11-ago-2026): no se le
    // planea/asigna operador hasta que se decida Operativa o Parada.
    if (m.en_espera) { setScanNotice(`⏳ ${m.code} está EN ESPERA DE INSTRUCCIONES. No se le puede asignar operador todavía.`); return; }
    setScanNotice(null);
    openAssign({ id: m.id, code: m.code, companyName: m.companyName });
  };

  // ── Compartir novedades (PDF) ─────────────────────────────────────────────
  const [shareBusy, setShareBusy] = useState(false);
  const compartirNovedades = async () => {
    setShareBusy(true);
    try {
      const esc = (t: any) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const sec = (title: string, rows: Row[], detail: (r: Row) => string) => rows.length === 0 ? '' : `
        <h3>${esc(title)} · ${rows.length}</h3>
        <table><thead><tr><th>Máquina</th><th>Empresa</th><th>Detalle</th></tr></thead><tbody>
          ${rows.map((r) => `<tr><td>${esc(r.code)}</td><td>${esc(r.companyName)}</td><td>${esc(detail(r))}</td></tr>`).join('')}
        </tbody></table>`;
      const body = [
        sec('🧩 Máquinas sin operador asignado', sinAsignarRows, () => 'Sin operador planeado para este turno.'),
        sec('⚠️ No coincide', mismatchRows, (r) => `Planeado ${r.planned?.operator_name} · en sitio ${r.liveName}`),
        sec('🔴 Sin marcar entrada', ausenciaRows, (r) => `Operador planeado: ${r.planned?.operator_name}, sin asistencia registrada hoy.`),
      ].join('');
      if (!body) { setShareBusy(false); return; }
      const html = pdfDocument({
        title: 'Novedades del Coordinador de Operadores',
        subtitle: `${shiftIcon(shift)} ${shiftLabel(shift)} · ${today}`,
        extraCss: `table{width:100%;border-collapse:collapse;margin:6px 0 14px;font-size:11px}
          th,td{border:1px solid #c9d2dc;padding:5px 7px;text-align:left} th{background:#16324F;color:#fff}
          tr:nth-child(even) td{background:#f4f7fb} h3{margin:14px 0 2px;font-size:14px;color:#16324F}`,
        body,
      });
      await exportPdf(html, `Novedades operadores ${today}`);
    } finally {
      setShareBusy(false);
    }
  };

  // ── Informe completo de operadores (PDF) ──────────────────────────────────
  // A diferencia de "Novedades" (solo excepciones), este lista TODAS las
  // máquinas del universo del turno con su operador planeado, el que está en
  // sitio de verdad y su asistencia — para un documento formal que se pueda
  // compartir con el Coordinador de Operaciones o Recursos Humanos.
  const [reportBusy, setReportBusy] = useState(false);
  const exportarInformeCompleto = async () => {
    if (universeRows.length === 0) return;
    setReportBusy(true);
    try {
      const esc = (t: any) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const asistenciaTxt = (r: Row): string => {
        if (!r.planned) return '—';
        if (!r.planned.employee_id) return 'sin ficha';
        if (r.attendance === 'ok') return `🟢 ${r.attendanceTs ? fmtHora(r.attendanceTs) : ''}`;
        if (r.attendance === 'out') return `🟡 salió ${r.attendanceTs ? fmtHora(r.attendanceTs) : ''}`;
        return '🔴 sin marcar';
      };
      const body = `
        <table><thead><tr><th>Máquina</th><th>Empresa</th><th>Estado</th><th>Planeado</th><th>En sitio</th><th>Asistencia</th></tr></thead><tbody>
          ${universeRows.map((r) => `<tr><td>${esc(r.code)}</td><td>${esc(r.companyName)}</td><td>${esc(STATE_META[r.state].label)}</td><td>${esc(r.planned ? r.planned.operator_name : '—')}</td><td>${esc(r.liveName ?? '—')}</td><td>${esc(asistenciaTxt(r))}</td></tr>`).join('')}
        </tbody></table>`;
      const html = pdfDocument({
        title: 'Informe de Operadores',
        subtitle: `${shiftIcon(shift)} ${shiftLabel(shift)} · ${today}`,
        extraCss: `table{width:100%;border-collapse:collapse;margin:6px 0 14px;font-size:11px}
          th,td{border:1px solid #c9d2dc;padding:5px 7px;text-align:left} th{background:#16324F;color:#fff}
          tr:nth-child(even) td{background:#f4f7fb} h3{margin:14px 0 2px;font-size:14px;color:#16324F}`,
        body,
      });
      await exportPdf(html, `Informe operadores ${today}`);
    } finally {
      setReportBusy(false);
    }
  };

  const badge = (state: MachineState) => {
    const meta = STATE_META[state];
    return (
      <View style={{ backgroundColor: (colors as any)[meta.bg], borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 }}>
        <Text style={{ color: meta.text(colors), fontWeight: '800', fontSize: 10.5 }}>{meta.label}</Text>
      </View>
    );
  };

  const attendanceChip = (r: Row) => {
    if (!r.planned) return null;
    if (!r.planned.employee_id) return <Text style={{ color: colors.muted, fontSize: 10.5 }}>· sin ficha vinculada</Text>;
    if (r.attendance === 'ok') return <Text style={{ color: colors.success, fontSize: 10.5 }}>🟢 Marcó entrada {r.attendanceTs ? fmtHora(r.attendanceTs) : ''}</Text>;
    if (r.attendance === 'out') return <Text style={{ color: colors.warning, fontSize: 10.5 }}>🟡 Marcó salida {r.attendanceTs ? fmtHora(r.attendanceTs) : ''}</Text>;
    return <Text style={{ color: colors.danger, fontSize: 10.5 }}>🔴 Sin marcar entrada hoy</Text>;
  };

  const machineCard = (r: Row) => (
    <TouchableOpacity key={r.id} onPress={() => openAssign(r)} activeOpacity={0.8}>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>{etiquetaMaquina(r) || r.code}</Text>
            <Text style={{ color: colors.muted, fontSize: 11 }}>{r.companyName}{r.tipo ? ` · ${r.tipo}` : ''}</Text>
            {(r.plate || r.serial) ? (
              <Text style={{ color: colors.muted, fontSize: 10.5 }}>
                {r.plate ? `🪪 ${r.plate}` : ''}{r.plate && r.serial ? '  ·  ' : ''}{r.serial ? `🔩 Serial ${r.serial}` : ''}
              </Text>
            ) : null}
          </View>
          {badge(r.state)}
        </View>
        <View style={{ marginTop: spacing.xs, gap: 2 }}>
          <Text style={{ color: colors.muted, fontSize: 11.5 }}>Planeado <Text style={{ color: colors.text, fontWeight: '700' }}>{r.planned ? `👷 ${r.planned.operator_name}` : '— sin asignar'}</Text></Text>
          {r.planned?.assignedByName ? <Text style={{ color: colors.muted, fontSize: 10.5 }}>👤 Asignado por {r.planned.assignedByName}</Text> : null}
          {r.liveName ? (
            <Text style={{ color: colors.muted, fontSize: 11.5 }}>En sitio <Text style={{ color: r.mismatch ? colors.danger : colors.text, fontWeight: '700' }}>👷 {r.liveName}</Text></Text>
          ) : null}
          {r.mismatch ? (
            <View style={{ backgroundColor: colors.dangerSoftBg, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4, marginTop: 3 }}>
              <Text style={{ color: colors.dangerSoftText, fontWeight: '700', fontSize: 10.5 }}>⚠️ El operador en sitio no es el planeado</Text>
            </View>
          ) : null}
          {attendanceChip(r)}
          {r.inspectorName ? <Text style={{ color: colors.muted, fontSize: 10.5 }}>🕵️ Inspector: {r.inspectorName}</Text> : null}
          {(r.sector || r.encargado) ? (
            <Text style={{ color: colors.muted, fontSize: 10.5 }} numberOfLines={1}>
              {r.sector ? `🏭 ${r.sector}` : ''}{r.sector && r.encargado ? '  ·  ' : ''}{r.encargado ? `👤 Encargado: ${r.encargado}` : ''}
            </Text>
          ) : null}
          {(r.referencia || r.latitude != null) ? (
            <TouchableOpacity
              disabled={r.latitude == null}
              onPress={() => { if (r.latitude != null && r.longitude != null) Linking.openURL(`https://www.google.com/maps?q=${r.latitude},${r.longitude}`); }}
            >
              <Text style={{ color: r.latitude != null ? colors.primary : colors.muted, fontSize: 10.5 }} numberOfLines={1}>
                📍 {r.referencia || 'Ubicación guardada'}{r.latitude != null ? ' · ver en mapa' : ''}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </Card>
    </TouchableOpacity>
  );

  if (loading) return <Screen><ConfigBanner /><SkeletonList /></Screen>;

  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      <ConfigBanner />
      <SectionTitle>👷‍♂️ Coordinador de Operadores</SectionTitle>

      {canSee('reportes') && navigation?.navigate ? (
        <TouchableOpacity
          onPress={() => navigation.navigate('Reports')}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, marginBottom: spacing.sm }}
        >
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>📊 Reportes (combustible, horas, flota…)</Text>
        </TouchableOpacity>
      ) : null}

      {plannedMissing ? (
        <Card><Text style={{ color: colors.danger, fontWeight: '700' }}>❌ Falta activar la tabla machine_operators en Supabase.</Text></Card>
      ) : null}

      <View style={{ marginBottom: spacing.sm }}>
        <InspectorHeroCard
          onScanPress={() => { setScanNotice(null); setScanOpen(true); }}
          secondaryActions={[
            { key: 'asistencia', label: 'Marcar asistencia (escanear operador)', icon: '🪪', color: '#0F766E', onPress: () => { setAttNotice(null); setAttScanOpen(true); } },
          ]}
        />
        <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs, textAlign: 'center' }}>
          Escanea el QR de la máquina para ver la ficha del operador asignado (o asignar uno si no tiene).
        </Text>
        {scanNotice ? <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700', marginTop: spacing.xs, textAlign: 'center' }}>{scanNotice}</Text> : null}
        {attBusy ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs, textAlign: 'center' }}>Registrando…</Text> : null}
        {attNotice ? <Text style={{ color: attNotice.startsWith('✅') ? colors.success : colors.danger, fontSize: 12, fontWeight: '700', marginTop: spacing.xs, textAlign: 'center' }}>{attNotice}</Text> : null}
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
        {(['day', 'night'] as Shift[]).map((s) => {
          const on = shift === s;
          return (
            <TouchableOpacity key={s} onPress={() => setShift(s)} style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}>
              <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 13 }}>{shiftIcon(s)} {shiftLabel(s)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
        <View style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
          <Text style={{ color: colors.success, fontSize: 18, fontWeight: '900' }}>{daySets.activeNowSet.size}</Text>
          <Text style={{ color: colors.muted, fontSize: 10, textAlign: 'center' }}>Activas</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
          <Text style={{ color: colors.warning, fontSize: 18, fontWeight: '900' }}>{sinAsignarRows.length}</Text>
          <Text style={{ color: colors.muted, fontSize: 10, textAlign: 'center' }}>Sin asignar</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
          <Text style={{ color: colors.danger, fontSize: 18, fontWeight: '900' }}>{mismatchRows.length}</Text>
          <Text style={{ color: colors.muted, fontSize: 10, textAlign: 'center' }}>No coincide</Text>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }} contentContainerStyle={{ gap: spacing.xs }}>
        {([
          { key: 'maquinas', label: `🚜 Máquinas (${universeRows.length})` },
          { key: 'operadores', label: `👷 Operadores (${operators.length})` },
          { key: 'sinasignar', label: `🧩 Sin asignar (${sinAsignarRows.length})` },
          { key: 'novedades', label: `📋 Novedades (${sinAsignarRows.length + mismatchRows.length + ausenciaRows.length})` },
        ] as { key: typeof tab; label: string }[]).map((t) => {
          const on = tab === t.key;
          return (
            <TouchableOpacity key={t.key} onPress={() => setTab(t.key)} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.md, alignItems: 'center', backgroundColor: on ? colors.primary : colors.surface, borderWidth: 1, borderColor: on ? colors.primary : colors.border }}>
              <Text numberOfLines={1} style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 11 }}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {(tab === 'maquinas' || tab === 'sinasignar') ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, marginBottom: spacing.sm }}>
          <Text style={{ fontSize: 14 }}>🔎</Text>
          <TextInput
            value={machQuery}
            onChangeText={setMachQuery}
            placeholder="Buscar máquina: nombre, placa, serial… u operador"
            placeholderTextColor={colors.muted}
            style={{ flex: 1, color: colors.text, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, fontSize: 12.5 }}
          />
          {machQuery ? <TouchableOpacity onPress={() => setMachQuery('')}><Text style={{ color: colors.primary, fontWeight: '800', paddingHorizontal: spacing.xs }}>✕</Text></TouchableOpacity> : null}
        </View>
      ) : null}

      {tab === 'maquinas' ? (
        universeRowsShown.length === 0
          ? <EmptyState
              title={machQuery ? 'Sin resultados' : 'Sin máquinas en este turno'}
              subtitle={machQuery ? 'No hay máquinas ni operadores que coincidan con la búsqueda.' : 'No hay máquinas asignadas, trabajando ni con novedades para el turno elegido.'}
            />
          : universeRowsShown.map(machineCard)
      ) : null}

      {tab === 'operadores' ? (
        <>
          <TextInput
            value={opTabQuery}
            onChangeText={setOpTabQuery}
            placeholder="🔎 Buscar operador: nombre, cédula, máquina, empresa…"
            placeholderTextColor={colors.muted}
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 8, color: colors.text, fontSize: 12.5, marginBottom: spacing.sm }}
          />
          {operatorRowsShown.length === 0 ? (
            <EmptyState title="Sin resultados" subtitle="No hay operadores que coincidan con la búsqueda." />
          ) : (
            operatorRowsShown.map((r) => (
              <Card key={r.operator.id}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>👷 {r.operator.name}</Text>
                    {r.operator.cedula ? <Text style={{ color: colors.muted, fontSize: 11 }}>CI {r.operator.cedula}</Text> : null}
                  </View>
                </View>
                <View style={{ marginTop: spacing.xs, gap: 2 }}>
                  {r.machineCode ? (
                    <Text style={{ color: colors.muted, fontSize: 11.5 }}>Máquina <Text style={{ color: colors.text, fontWeight: '700' }}>🚜 {r.machineCode}</Text>{r.companyName ? ` · ${r.companyName}` : ''}</Text>
                  ) : (
                    <Text style={{ color: colors.warning, fontSize: 11.5, fontWeight: '700' }}>— Sin máquina asignada este turno</Text>
                  )}
                  {r.liveName ? (
                    <Text style={{ color: colors.muted, fontSize: 11.5 }}>En sitio <Text style={{ color: r.mismatch ? colors.danger : colors.text, fontWeight: '700' }}>👷 {r.liveName}</Text></Text>
                  ) : null}
                  {r.mismatch ? (
                    <View style={{ backgroundColor: colors.dangerSoftBg, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4, marginTop: 3 }}>
                      <Text style={{ color: colors.dangerSoftText, fontWeight: '700', fontSize: 10.5 }}>⚠️ El operador en sitio no es el planeado</Text>
                    </View>
                  ) : null}
                  {r.attendance === 'ok' ? <Text style={{ color: colors.success, fontSize: 10.5 }}>🟢 Marcó entrada {r.attendanceTs ? fmtHora(r.attendanceTs) : ''}</Text> : null}
                  {r.attendance === 'out' ? <Text style={{ color: colors.warning, fontSize: 10.5 }}>🟡 Marcó salida {r.attendanceTs ? fmtHora(r.attendanceTs) : ''}</Text> : null}
                  {r.attendance === 'no' && r.machineCode ? <Text style={{ color: colors.danger, fontSize: 10.5 }}>🔴 Sin marcar entrada hoy</Text> : null}
                </View>
              </Card>
            ))
          )}
        </>
      ) : null}

      {tab === 'sinasignar' ? (
        sinAsignarRowsShown.length === 0
          ? <EmptyState
              title={machQuery ? 'Sin resultados' : 'Todo asignado'}
              subtitle={machQuery ? 'No hay máquinas que coincidan con la búsqueda.' : 'Ninguna máquina relevante de este turno está sin operador planeado.'}
            />
          : sinAsignarRowsShown.map(machineCard)
      ) : null}

      {tab === 'novedades' ? (
        <>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
            <TouchableOpacity onPress={compartirNovedades} disabled={shareBusy} style={{ flex: 1, backgroundColor: colors.brand, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: shareBusy ? 0.6 : 1 }}>
              <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{shareBusy ? 'Generando…' : '📤 Compartir novedades'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={exportarInformeCompleto} disabled={reportBusy} style={{ flex: 1, backgroundColor: colors.brand, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: reportBusy ? 0.6 : 1 }}>
              <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{reportBusy ? 'Generando…' : '📊 Informe completo'}</Text>
            </TouchableOpacity>
          </View>
          {sinAsignarRows.length === 0 && mismatchRows.length === 0 && ausenciaRows.length === 0 ? (
            <EmptyState title="Sin novedades" subtitle="No hay máquinas sin asignar, mismatches ni ausencias en este turno." />
          ) : (
            <>
              {sinAsignarRows.length > 0 ? (<><SectionTitle>🧩 Máquinas sin operador ({sinAsignarRows.length})</SectionTitle>{sinAsignarRows.map(machineCard)}</>) : null}
              {mismatchRows.length > 0 ? (<><SectionTitle>⚠️ No coincide ({mismatchRows.length})</SectionTitle>{mismatchRows.map(machineCard)}</>) : null}
              {ausenciaRows.length > 0 ? (<><SectionTitle>🔴 Sin marcar entrada ({ausenciaRows.length})</SectionTitle>{ausenciaRows.map(machineCard)}</>) : null}
            </>
          )}
        </>
      ) : null}

      {/* ── Asignar / reasignar operador ── */}
      <Modal visible={assignFor !== null && isFocused} transparent animationType="fade" onRequestClose={() => setAssignFor(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }} onPress={() => setAssignFor(null)}>
          <Pressable onPress={(e) => e.stopPropagation?.()} style={{ backgroundColor: colors.background, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '85%', paddingTop: spacing.md }}>
            {assignFor ? (() => {
              const current = plannedByMachine.get(assignFor.id)?.[assignShift] ?? null;
              return (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, marginBottom: spacing.sm }}>
                    <Text style={{ color: colors.text, fontWeight: '900', fontSize: 16, flex: 1 }} numberOfLines={1}>👷 Asignar operador · 🚜 {assignFor.code}</Text>
                    <TouchableOpacity onPress={() => setAssignFor(null)} style={{ paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                      <Text style={{ color: colors.primary, fontWeight: '900', fontSize: 18 }}>✕</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={{ flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, marginBottom: spacing.sm }}>
                    {(['day', 'night'] as Shift[]).map((s) => {
                      const on = assignShift === s;
                      return (
                        <TouchableOpacity key={s} onPress={() => setAssignShift(s)} style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 2, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface }}>
                          <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 13 }}>{shiftIcon(s)} {shiftLabel(s)}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <View style={{ paddingHorizontal: spacing.md, marginBottom: spacing.sm }}>
                    {current ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm }}>
                        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700', flex: 1 }} numberOfLines={1}>Planeado ahora: 👷 {current.operator_name}{current.assignedByName ? ` · por ${current.assignedByName}` : ''}</Text>
                        {current.employee_id && navigation?.navigate ? (
                          // OJO: no cerrar el modal (setAssignFor(null)) acá — se
                          // oculta solo por `isFocused` y vuelve a aparecer con todo
                          // igual (misma máquina/turno) al volver de la ficha.
                          <TouchableOpacity onPress={() => navigation.navigate('EmployeeCard', { employeeId: current.employee_id })} style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 5 }}>
                            <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 12 }}>👁️ Ficha</Text>
                          </TouchableOpacity>
                        ) : null}
                        <TouchableOpacity disabled={assignBusy} onPress={() => applyAssign(assignShift, null)} style={{ borderWidth: 1, borderColor: colors.warning, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 5, opacity: assignBusy ? 0.5 : 1 }}>
                          <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 12 }}>➖ Quitar</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <Text style={{ color: colors.muted, fontSize: 12, fontStyle: 'italic' }}>Sin operador planeado en {shiftLabel(assignShift)}. Elige uno de la lista.</Text>
                    )}
                    {assignNotice ? <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700', marginTop: spacing.xs }}>{assignNotice}</Text> : null}
                  </View>

                  <View style={{ paddingHorizontal: spacing.md, marginBottom: spacing.sm }}>
                    <TouchableOpacity onPress={() => setLocOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm }}>
                      <Text style={{ color: colors.text, fontSize: 12.5, fontWeight: '700', flex: 1 }} numberOfLines={1}>📍 Ubicación{(() => { const m = machList.find((x) => x.id === assignFor!.id); return m?.referencia ? `: ${m.referencia}` : m?.latitude != null ? ': guardada' : ': sin guardar'; })()}</Text>
                      <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 12 }}>{locOpen ? 'Ocultar ▲' : 'Actualizar ▾'}</Text>
                    </TouchableOpacity>
                    {locOpen ? (
                      <View style={{ marginTop: spacing.sm }}>
                        <EdificioPicker value={locRef} onChange={setLocRef} />
                        <TouchableOpacity disabled={locBusy} onPress={guardarUbicacion} style={{ marginTop: spacing.sm, backgroundColor: '#2563EB', borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: locBusy ? 0.6 : 1 }}>
                          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>{locBusy ? 'Guardando…' : '📍 Guardar mi ubicación actual + edificio'}</Text>
                        </TouchableOpacity>
                        {locNotice ? <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700', marginTop: spacing.xs }}>{locNotice}</Text> : null}
                      </View>
                    ) : null}
                  </View>

                  <TouchableOpacity
                    disabled={assignBusy}
                    onPress={() => setOpScanOpen(true)}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, marginHorizontal: spacing.md, marginBottom: spacing.sm, opacity: assignBusy ? 0.5 : 1 }}
                  >
                    <Text style={{ fontSize: 16 }}>📷</Text>
                    <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 13 }}>Escanear carnet del operador</Text>
                  </TouchableOpacity>

                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, marginHorizontal: spacing.md, marginBottom: spacing.sm }}>
                    <Text style={{ fontSize: 14 }}>🔎</Text>
                    <TextInput value={opQuery} onChangeText={setOpQuery} placeholder="…o busca por nombre/cédula" placeholderTextColor={colors.muted} style={{ flex: 1, color: colors.text, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs }} />
                    {opQuery ? <TouchableOpacity onPress={() => setOpQuery('')}><Text style={{ color: colors.primary, fontWeight: '800', paddingHorizontal: spacing.xs }}>✕</Text></TouchableOpacity> : null}
                  </View>

                  <ScrollView style={{ paddingHorizontal: spacing.md }} contentContainerStyle={{ paddingBottom: spacing.xl }} keyboardShouldPersistTaps="handled">
                    {opsShown.length === 0 ? (
                      <Text style={{ color: colors.muted, textAlign: 'center', paddingVertical: spacing.lg }}>Sin operadores (cargo operador/chofer/obrero/servicios generales).</Text>
                    ) : opsShown.map((o) => {
                      const sel = current?.employee_id === o.id;
                      const otro = otroPlaneadoDe.get(o.id);
                      return (
                        <TouchableOpacity key={o.id} disabled={assignBusy} onPress={() => applyAssign(assignShift, o)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border, opacity: assignBusy ? 0.5 : 1, backgroundColor: sel ? colors.primary + '12' : 'transparent' }}>
                          <Text style={{ fontSize: 16 }}>{sel ? '✅' : otro ? '⚠️' : '👷'}</Text>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: colors.text, fontWeight: sel ? '800' : '600', fontSize: 14 }}>{o.name}</Text>
                            <Text style={{ color: colors.muted, fontSize: 10.5, textTransform: 'capitalize' }}>{o.cargo || '—'}</Text>
                            {otro ? <Text style={{ color: colors.warning, fontSize: 10.5, fontWeight: '700' }}>⚠️ Ya planeado en 🚜 {otro} este turno</Text> : null}
                          </View>
                          {sel ? <Text style={{ color: colors.success, fontWeight: '800', fontSize: 12 }}>asignado</Text> : null}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </>
              );
            })() : null}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Escanear QR de la máquina → ficha del operador asignado ── */}
      <Modal visible={scanOpen} animationType="slide" onRequestClose={() => setScanOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <QrScanner onClose={() => setScanOpen(false)} onDetected={onScanDetected} />
        </View>
      </Modal>

      {/* ── Escanear el CARNET del operador → lo asigna a la máquina/turno del modal ── */}
      <Modal visible={opScanOpen} animationType="slide" onRequestClose={() => setOpScanOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <QrScanner onClose={() => setOpScanOpen(false)} onDetected={onOperatorScanDetected} />
        </View>
      </Modal>

      {/* ── Escanear el CARNET del operador → marca su asistencia (entrada/salida) ── */}
      <Modal visible={attScanOpen} animationType="slide" onRequestClose={() => setAttScanOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <QrScanner onClose={() => setAttScanOpen(false)} onDetected={onAttendanceScanDetected} />
        </View>
      </Modal>
    </Screen>
  );
}
