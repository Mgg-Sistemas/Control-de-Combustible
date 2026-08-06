import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, ScrollView, Modal, Pressable } from 'react-native';
import { supabase, selectAllRows } from '../../lib/supabase';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { cmpText, norm } from '../../lib/text';
import { useAuth } from '../../context/AuthContext';
import { logAudit } from '../../lib/audit';
import { useRealtimeRefresh } from '../../hooks/useRealtime';
import { listInspectorAssignments, assignInspector } from '../../lib/machineInspectors';
import { useToast } from '../../components/ToastProvider';
import { generateInspectorReport } from '../../lib/inspectorReport';
import { generatePorAsignarReport } from '../../lib/porAsignarReport';
import { generateSummaryReport } from '../../lib/inspectorSummaryReport';
import { loadFuelByMachine, litersLabel, lphOf, FuelAgg } from '../../lib/fuelPerMachine';
import { DateField } from '../../components/DateField';

/**
 * RESUMEN DE INSPECCIONES (rediseño) — dashboard analítico, autocontenido.
 * - Switch ☀️ DÍA / 🌙 NOCHE.
 * - KPIs del DÍA elegido (sincronizan al tocar otro día): INICIADAS, PENDIENTES por
 *   iniciar, PARADAS/no trabajó y AVERIADAS.
 * - Gráfica de barras (horizontal): iniciadas por día (14 días); tocar una barra
 *   elige ese día.
 * - Gráfica de barras VERTICALES por inspector (del turno): tocar un inspector
 *   muestra sus mismos 4 datos + sus máquinas por categoría.
 * Lee machine_rounds + maintenance_requests + profiles + asignaciones; no toca la
 * lógica de SupervisionScreen. Se inserta arriba de esa vista.
 */

const CARACAS_TZ = 'America/Caracas';
function caracasToday(): string {
  const p: any = new Intl.DateTimeFormat('en-CA', { timeZone: CARACAS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((a: any, x: any) => { a[x.type] = x.value; return a; }, {});
  return `${p.year}-${p.month}-${p.day}`;
}
const shortDate = (iso: string) => { const [, m, d] = (iso || '').split('-'); return m && d ? `${d}/${m}` : iso; };
// Token de pdfBusy para el reporte "por asignar / por iniciar" (no choca con '' ni con un nombre de inspector).
const POR_ASIGNAR_KEY = '__por_asignar__';
// Token de pdfBusy para el reporte de eficiencia (todos los inspectores).
const EFICIENCIA_KEY = '__eficiencia__';
// Turno ACTUAL según la hora de Caracas: día 7am–7pm, resto noche. Sirve para abrir
// el dashboard en el turno correcto (antes abría siempre en DÍA).
function caracasNowShift(): 'day' | 'night' { let h = new Date().getUTCHours() - 4; if (h < 0) h += 24; return h >= 7 && h < 19 ? 'day' : 'night'; }
// Turno de una PARADA por la hora (Caracas) en que se marcó: día 7-19, resto noche.
const paradaShiftOf = (iso: string): 'day' | 'night' => { const d = new Date(iso); let h = d.getUTCHours() - 4; if (h < 0) h += 24; return h >= 7 && h < 19 ? 'day' : 'night'; };

type Round = {
  machinery_id: string; round_date: string; day_hours: number | null; night_hours: number | null;
  jornada_shift: string | null; jornada_start_at: string | null; recorded_by: string | null;
  horometro_inicial: number | null; horometro_final: number | null; machine?: { code?: string } | null;
};
type Maint = { machinery_id: string; material: string | null; created_at: string; machine?: { code?: string } | null };
type Assign = { machinery_id: string; inspector_name: string | null; shift: 'day' | 'night'; code: string };
// Ficha del catálogo (machinery) por máquina — para el detalle del modal.
type MachRow = {
  id: string; code: string | null; plate: string | null; serial: string | null; identifier: string | null;
  encargado: string | null; location: string | null; referencia: string | null; sector: string | null;
  zona: string | null; tipo: string | null; clasificacion: string | null; machinery_type: string | null;
  last_horometro: number | null; operational: boolean | null; active: boolean | null; company?: { name?: string } | null;
};
type MInfo = {
  id: string; code: string; plate: string | null; serial: string | null; identifier: string | null;
  company: string | null; encargado: string | null; location: string | null; referencia: string | null;
  sector: string | null; zona: string | null; tipo: string | null; clasificacion: string | null;
  machinery_type: string | null; lastHoro: number | null;
};
type Estado = 'iniciada' | 'pendiente' | 'parada' | 'averiada';

// ¿La ronda cuenta como jornada INICIADA? (arrancada o con horas). Igual que SupervisionScreen.
const roundStarted = (r: Round) => !!r.jornada_start_at || (Number(r.day_hours) || 0) > 0 || (Number(r.night_hours) || 0) > 0;
// Turno de la ronda (una ronda pertenece a UN turno). Igual que inspectorReport.
const roundShift = (r: Round): 'day' | 'night' =>
  r.jornada_shift === 'night' ? 'night'
    : r.jornada_shift === 'day' ? 'day'
    : ((Number(r.night_hours) || 0) > 0 && (Number(r.day_hours) || 0) === 0 ? 'night' : 'day');
const startedForShift = (r: Round, sh: 'day' | 'night') => roundStarted(r) && roundShift(r) === sh;

// Cuentas con permiso para el panel de "Activar/desactivar máquinas por supervisor"
// (herramienta delicada: cambia el estado operativo real de la máquina). Solo
// Angélica (C.I./usuario 27514385) y Anthony (usuario sistemas2), a pedido directo
// del cliente 04/08/2026 — nadie más debe ver ni usar esta sección.
const BULK_TOGGLE_USERNAMES = ['27514385', 'sistemas2'];
const BULK_TOGGLE_CEDULAS = ['27514385'];

export default function InspectionsSummary({ date, onDateChange }: { date?: string; onDateChange?: (d: string) => void } = {}) {
  const { colors } = useTheme();
  const { session } = useAuth();
  const toast = useToast();
  const [shift, setShift] = useState<'day' | 'night'>(caracasNowShift);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [maint, setMaint] = useState<Maint[]>([]);
  const [assignments, setAssignments] = useState<Assign[]>([]);
  const [machList, setMachList] = useState<MachRow[]>([]);       // ficha del catálogo por máquina
  const [fuelDay, setFuelDay] = useState<Record<string, FuelAgg>>({}); // litros surtidos por máquina en selDay
  const [loading, setLoading] = useState(true);
  // Inspectores REALES (para el desplegable de "Máquinas por asignar" del cajón
  // MAQUINAS FALTANTES) — mismos roles que puede elegir el CHECK MÁQUINA del teléfono.
  const [realInspectors, setRealInspectors] = useState<{ id: string; full_name: string }[]>([]);
  const [faltantesOpen, setFaltantesOpen] = useState(false);
  const [assignPickerFor, setAssignPickerFor] = useState<string | null>(null); // machinery_id con el desplegable abierto
  const [assignBusy, setAssignBusy] = useState<string | null>(null); // machinery_id en proceso de asignar
  // El día visible puede venir CONTROLADO por la pantalla padre (para compartir la
  // misma fecha con la lista de rondas de abajo); si no, se maneja internamente.
  const [internalDay, setInternalDay] = useState(caracasToday());
  const selDay = date ?? internalDay;
  const setSelDay = useCallback((d: string) => { if (onDateChange) onDateChange(d); else setInternalDay(d); }, [onDateChange]);
  // Navegar ±1 día (sin pasar de hoy). Al cambiar el día se limpia el inspector abierto.
  const shiftDay = (delta: number) => {
    const d = new Date(selDay + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    const iso = d.toISOString().slice(0, 10);
    const today = caracasToday();
    setSelDay(iso > today ? today : iso);
    setSelInsp(null);
  };
  const [inspQ, setInspQ] = useState('');
  const [selInsp, setSelInsp] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null); // '' = general, o el nombre del inspector

  // Genera el REPORTE OFICIAL de inspectores (PDF con firma) para el día + turno.
  // `inspector` opcional: solo ese inspector; si no, todos los del turno.
  const makeReport = async (inspector?: string) => {
    setPdfBusy(inspector ?? '');
    try {
      await generateInspectorReport({ date: selDay, shift, inspectors: inspector ? [inspector] : null });
    } finally {
      setPdfBusy(null);
    }
  };

  // REPORTE (PDF) de máquinas POR ASIGNAR / POR INICIAR del día + turno. Usa los
  // datos ya en memoria: las pendientes por iniciar (topIds.pend), su ficha
  // (machineInfo) y el inspector asignado (inspectorByMachine). Sin consultas nuevas.
  const makePorAsignarReport = async () => {
    setPdfBusy(POR_ASIGNAR_KEY);
    try {
      const machines = topIds.pend.map((id) => {
        const info = machineInfo.get(id) ?? null;
        const inspector = inspectorByMachine.get(id) ?? null;
        return {
          code: info?.code ?? codeById.get(id) ?? '—',
          plate: info?.plate ?? null,
          company: info?.company ?? null,
          inspector,
          sinInspector: sinInspectorReal(inspector),
        };
      });
      await generatePorAsignarReport({ date: selDay, shift, machines });
    } finally {
      setPdfBusy(null);
    }
  };

  // REPORTE (PDF) de eficiencia de TODOS los inspectores del día — cuántas de sus
  // máquinas asignadas chequearon (iniciada, parada o averiada) vs. cuáles dejaron
  // sin tocar. Mismo cálculo que `generateSummaryReport` (ver inspectorSummaryReport.ts).
  const makeEficienciaReport = async () => {
    setPdfBusy(EFICIENCIA_KEY);
    try {
      await generateSummaryReport({ date: selDay });
    } finally {
      setPdfBusy(null);
    }
  };

  // Últimos 14 días (antiguo → hoy).
  const days = useMemo(() => {
    const base = new Date(caracasToday() + 'T12:00:00Z');
    return Array.from({ length: 14 }, (_, i) => { const d = new Date(base); d.setUTCDate(d.getUTCDate() - (13 - i)); return d.toISOString().slice(0, 10); });
  }, []);
  const fromDate = days[0];

  const load = useCallback(async () => {
    // Cubre los 14 días de la gráfica y, si el día elegido es más antiguo, también ese
    // (para que los KPIs del día no queden en 0 al navegar a una fecha vieja).
    const minDate = selDay < fromDate ? selDay : fromDate;
    const [roundsRows, maintRes, asg, machRows] = await Promise.all([
      selectAllRows('machine_rounds', 'machinery_id, round_date, day_hours, night_hours, jornada_shift, jornada_start_at, recorded_by, horometro_inicial, horometro_final, machine:machinery_id(code)', (q) => q.gte('round_date', minDate)),
      supabase.from('maintenance_requests').select('machinery_id, material, created_at, machine:machinery_id(code)').eq('status', 'pendiente'),
      listInspectorAssignments(),
      // Ficha del catálogo (placa, serial, ubicación, empresa, encargado, horómetro…) por máquina.
      selectAllRows('machinery', 'id, code, plate, serial, identifier, encargado, location, referencia, sector, zona, tipo, clasificacion, machinery_type, last_horometro, operational, active, company:company_id(name)'),
    ]);
    setRounds((roundsRows ?? []) as any);
    setMaint((maintRes.data ?? []) as any);
    setAssignments(((asg?.rows ?? []) as any[]).map((a) => ({ machinery_id: a.machinery_id, inspector_name: a.inspector_name ?? '—', shift: a.shift, code: a.code ?? '—' })));
    setMachList((machRows ?? []) as any);
    // Litros surtidos por máquina en el día elegido (misma fuente que SupervisionScreen).
    loadFuelByMachine(selDay).then(setFuelDay).catch(() => setFuelDay({}));
    setLoading(false);
  }, [fromDate, selDay]);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(['machine_rounds', 'maintenance_requests', 'machine_inspectors'], load);

  // Lista de inspectores reales para el desplegable de asignación (una sola vez).
  useEffect(() => {
    supabase.from('profiles').select('id, full_name, role').in('role', ['supervisor', 'coordinador_patio']).order('full_name')
      .then(({ data }) => setRealInspectors(((data ?? []) as any[]).map((p) => ({ id: p.id, full_name: p.full_name || '—' }))))
      .then(undefined, () => {});
  }, []);

  // Asigna una máquina "por asignar" (MAQUINAS FALTANTES) a un inspector real, en el
  // turno elegido. Reemplaza la asignación automática (1 inspector por máquina+turno).
  const doAssign = async (machineryId: string, insp: { id: string; full_name: string }) => {
    setAssignBusy(machineryId);
    const res = await assignInspector(machineryId, insp.id, insp.full_name, shift);
    setAssignBusy(null);
    if (res.error) {
      toast.error(res.missing ? 'Falta activar la asignación: corre supabase/inspector_turno.sql en Supabase.' : res.error);
      return;
    }
    setAssignPickerFor(null);
    toast.success(`✅ ${codeById.get(machineryId) ?? 'Máquina'} asignada a ${insp.full_name}.`);
    logAudit('CHECK', 'machinery', machineryId, `${codeById.get(machineryId) ?? ''} · ${shiftLbl} → ${insp.full_name}`);
    load();
  };

  // ¿Esta cuenta puede ver el panel de activar/desactivar por supervisor? Se resuelve
  // aparte (no viene en useAuth) para no tocar el contexto global por una excepción
  // de 2 personas. Cierra por defecto (false) hasta confirmar.
  // Además de la whitelist fija del código, se consulta `feature_toggles`
  // (key='maquinas_bulk_toggle', ver supabase/feature_toggles.sql) para que el
  // panel se pueda apagar por completo o sumar usuarios extra desde Ajustes, sin
  // tocar código. Si la fila no existe todavía (SQL no corrido), se trata como
  // enabled=true para no romper el comportamiento actual.
  const [bulkAllowed, setBulkAllowed] = useState(false);
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) { setBulkAllowed(false); return; }
    let active = true;
    Promise.all([
      supabase.from('profiles').select('cedula, username').eq('id', uid).single(),
      supabase.from('feature_toggles').select('enabled, extra_user_ids').eq('key', 'maquinas_bulk_toggle').maybeSingle(),
    ]).then(([{ data }, { data: ft }]) => {
      if (!active) return;
      const un = String((data as any)?.username ?? '').trim().toLowerCase();
      const ci = String((data as any)?.cedula ?? '').trim();
      const whitelisted = BULK_TOGGLE_USERNAMES.includes(un) || BULK_TOGGLE_CEDULAS.includes(ci);
      const enabled = (ft as any)?.enabled !== false; // sin fila (ft=null) o enabled=true => encendido
      const extraIds: string[] = (ft as any)?.extra_user_ids ?? [];
      setBulkAllowed(enabled && (whitelisted || extraIds.includes(uid)));
    });
    return () => { active = false; };
  }, [session?.user?.id]);

  // Panel "Gestionar Iniciada/Pendiente por supervisor" (solo bulkAllowed). Cambia
  // el mismo estado que las tarjetas ✅ INICIADAS / ⏳ PENDIENTES de arriba (no el
  // catálogo "Operativa/Inactiva" de Equipos, que es otra cosa) — marca o quita el
  // arranque de la jornada del día elegido en `machine_rounds`.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSel, setBulkSel] = useState<Set<string>>(new Set()); // claves "machineryId::shift"
  const [bulkBusy, setBulkBusy] = useState(false);
  // Filtros PROPIOS del panel (no comparten el switch ☀️DÍA/🌙NOCHE de arriba, que
  // controla todo el dashboard): turno y estado. Así se puede revisar día y noche
  // sin perder de vista cuál es cuál — cada fila muestra su turno — y sin
  // arriesgarse a marcar por error una máquina del turno que no se está mirando.
  const [bulkShiftFilter, setBulkShiftFilter] = useState<'all' | 'day' | 'night'>('all');
  const [bulkStatusFilter, setBulkStatusFilter] = useState<'all' | 'started' | 'pending'>('all');
  // Excluir paradas/averiadas: sin esto, una máquina "parada" o "averiada" cuenta
  // como "Pendiente" (no está iniciada) y se mezcla con las que de verdad faltan
  // por asignar/iniciar. Pedido del cliente para poder filtrarlas aparte.
  const [bulkHideStopped, setBulkHideStopped] = useState(false);
  // Averiadas del día (no depende del turno — igual que `daySets`). Paradas SÍ
  // depende del turno de cada ítem, así se calcula por separado para día y noche.
  // SOLO cuenta como "avería" la reportada ESE día (igual que SupervisorScreen.tsx,
  // que solo marca el segmento 🔴 avería el mismo día en que se reportó); una
  // avería vieja sin resolver pasa a "parada" (arrastrada) — antes, sin este límite
  // inferior, una avería de hace semanas se quedaba marcada "averiada" para
  // siempre y nunca aparecía como "parada", desalineando este panel del que ve
  // el inspector en su teléfono.
  const bulkAverSet = useMemo(() => {
    const dayStartMs = new Date(selDay + 'T00:00:00-04:00').getTime();
    const dayEndMs = new Date(selDay + 'T23:59:59.999-04:00').getTime();
    const s = new Set<string>();
    maint.forEach((m) => {
      const t = new Date(m.created_at).getTime();
      if (m.material !== 'MÁQUINA PARADA' && t >= dayStartMs && t <= dayEndMs) s.add(m.machinery_id);
    });
    return s;
  }, [maint, selDay]);
  // Solo se puede gestionar el día de HOY (no días pasados): "Iniciar" fabricaría
  // una jornada retroactiva sin sentido, y "Pendiente" borraría horas de un corte
  // que ya podría estar cerrado/pagado.
  const bulkIsToday = selDay === caracasToday();
  // ¿Iniciada la máquina HOY, en ese turno puntual? Reusa la misma lógica que las
  // tarjetas de arriba (`startedForShift`), pero para AMBOS turnos a la vez (acá no
  // filtramos por el switch día/noche general).
  const startedTodayByShift = useMemo(() => {
    const day = new Set<string>(); const night = new Set<string>();
    rounds.forEach((r) => {
      if (r.round_date !== selDay) return;
      if (startedForShift(r, 'day')) day.add(r.machinery_id);
      if (startedForShift(r, 'night')) night.add(r.machinery_id);
    });
    // Jornada de NOCHE de AYER aún ABIERTA (cruza la medianoche) — mismo rescate
    // que en `daySets`, para que el panel no la muestre como "Pendiente" ni deje
    // marcarla como tal por error mientras sigue trabajando hasta las 7am.
    const y = new Date(selDay + 'T12:00:00-04:00'); y.setUTCDate(y.getUTCDate() - 1);
    const yesterdayIso = y.toISOString().slice(0, 10);
    rounds.forEach((r) => { if (r.round_date === yesterdayIso && r.jornada_shift === 'night' && r.jornada_start_at) night.add(r.machinery_id); });
    return { day, night };
  }, [rounds, selDay]);
  // TODAS las asignaciones (día + noche), agrupadas por inspector/supervisor, con
  // su turno y si esa máquina está iniciada HOY en ese turno puntual. Si aparece
  // asignada en ambos turnos, sale una fila en cada uno (cada una con su propia
  // casilla — no se mezclan al marcar).
  const bulkGroupsAll = useMemo(() => {
    const dayStartMs = new Date(selDay + 'T00:00:00-04:00').getTime();
    const dayEndMs = new Date(selDay + 'T23:59:59.999-04:00').getTime();
    // ¿Está PARADA esa máquina en ESE turno puntual? Misma lógica que `daySets`,
    // pero evaluada por turno propio de cada asignación (no el switch general).
    const isParada = (machineryId: string, sh: 'day' | 'night', started: boolean) => {
      if (bulkAverSet.has(machineryId)) return false; // avería tiene su propia categoría
      return maint.some((m) => {
        if (m.machinery_id !== machineryId || m.material !== 'MÁQUINA PARADA') return false;
        const t = new Date(m.created_at).getTime();
        if (t > dayEndMs) return false;
        const arrastrada = t < dayStartMs;
        return arrastrada ? !started : paradaShiftOf(m.created_at) === sh;
      });
    };
    const byName = new Map<string, { name: string; items: { id: string; key: string; code: string; started: boolean; shift: 'day' | 'night'; stopped: boolean }[] }>();
    assignments.forEach((a) => {
      const nm = a.inspector_name || '—';
      const e = byName.get(nm) ?? { name: nm, items: [] };
      const started = (a.shift === 'day' ? startedTodayByShift.day : startedTodayByShift.night).has(a.machinery_id);
      const stopped = !started && (bulkAverSet.has(a.machinery_id) || isParada(a.machinery_id, a.shift, started));
      e.items.push({ id: a.machinery_id, key: `${a.machinery_id}::${a.shift}`, code: a.code || '—', started, shift: a.shift, stopped });
      byName.set(nm, e);
    });
    return [...byName.values()]
      .map((g) => ({ ...g, items: g.items.sort((x, y) => cmpText(x.code, y.code) || x.shift.localeCompare(y.shift)) }))
      .sort((a, b) => cmpText(a.name, b.name));
  }, [assignments, startedTodayByShift, maint, bulkAverSet, selDay]);
  // Grupos ya filtrados por turno/estado/paradas-averiadas (lo que realmente se ve y se selecciona).
  const bulkGroups = useMemo(() => {
    return bulkGroupsAll
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (i) =>
            (bulkShiftFilter === 'all' || i.shift === bulkShiftFilter) &&
            (bulkStatusFilter === 'all' || (bulkStatusFilter === 'started' ? i.started : !i.started)) &&
            (!bulkHideStopped || !i.stopped)
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [bulkGroupsAll, bulkShiftFilter, bulkStatusFilter]);
  const bulkAllKeys = useMemo(() => bulkGroups.flatMap((g) => g.items.map((i) => i.key)), [bulkGroups]);
  const toggleBulkOne = (key: string) => setBulkSel((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleBulkGroup = (keys: string[]) => setBulkSel((prev) => {
    const allIn = keys.every((k) => prev.has(k));
    const n = new Set(prev);
    keys.forEach((k) => (allIn ? n.delete(k) : n.add(k)));
    return n;
  });
  const toggleBulkAll = () => setBulkSel((prev) => (bulkAllKeys.every((k) => prev.has(k)) ? new Set() : new Set(bulkAllKeys)));
  // Aplica el cambio de verdad sobre `machine_rounds` del día elegido (hoy) y
  // refresca. "Iniciar" arranca la jornada AHORA (igual que si un inspector real
  // tocara "Iniciar jornada", sin pedir horómetro por ser una herramienta de
  // corrección administrativa) — el cierre normal a las 7am/7pm la termina sola.
  // "Pendiente" borra las horas de ESE turno puntual y, si la jornada abierta
  // pertenece a ese mismo turno, también la cierra sin acreditar horas — sin tocar
  // el turno contrario si está en curso. Antes de borrar horas ya trabajadas, las
  // deja registradas en `machine_work_segments` (source='ajuste_manual', igual que
  // cualquier otro cierre) y en la bitácora de Auditoría — nada desaparece sin
  // dejar rastro de quién lo hizo y cuánto había.
  const applyBulk = async (action: 'start' | 'pending') => {
    if (bulkSel.size === 0 || bulkBusy || !bulkIsToday) return;
    setBulkBusy(true);
    try {
      const items = [...bulkSel].map((k) => { const [id, sh] = k.split('::'); return { id, shift: sh as 'day' | 'night' }; });
      const uid = session?.user?.id ?? null;
      const codeOf = (id: string) => assignments.find((a) => a.machinery_id === id)?.code || '—';
      // Si es de turno NOCHE y la jornada abierta en realidad vive en la fila de
      // AYER (cruzó la medianoche, ver `startedTodayByShift`), hay que operar sobre
      // ESA fila — si actuáramos siempre sobre "hoy" crearíamos una fila nueva
      // vacía y dejaríamos la jornada real de ayer abierta sin tocar.
      const yD = new Date(selDay + 'T12:00:00-04:00'); yD.setUTCDate(yD.getUTCDate() - 1);
      const yesterdayIso = yD.toISOString().slice(0, 10);
      const roundDateFor = (id: string, sh: 'day' | 'night') => {
        if (sh === 'night') {
          const yRow = rounds.find((r) => r.machinery_id === id && r.round_date === yesterdayIso && r.jornada_shift === 'night' && r.jornada_start_at);
          if (yRow) return yesterdayIso;
        }
        return selDay;
      };
      if (action === 'start') {
        const nowIso = new Date().toISOString();
        const rows = items.map((it) => ({ machinery_id: it.id, round_date: roundDateFor(it.id, it.shift), round_no: 1, jornada_start_at: nowIso, jornada_shift: it.shift, status: 'operativa' }));
        await supabase.from('machine_rounds').upsert(rows, { onConflict: 'machinery_id,round_date,round_no' });
        await Promise.all(items.map((it) =>
          logAudit('JORNADA_INICIO', 'machinery', it.id, `${codeOf(it.id)} · inicio manual (panel supervisor) · ${it.shift === 'day' ? 'día' : 'noche'}`)
        ));
      } else {
        for (const it of items) {
          const rd = roundDateFor(it.id, it.shift);
          const existing = rounds.find((r) => r.machinery_id === it.id && r.round_date === rd);
          const prevHours = Number((it.shift === 'day' ? existing?.day_hours : existing?.night_hours) ?? 0);
          const patch: Record<string, any> = it.shift === 'day' ? { day_hours: 0 } : { night_hours: 0 };
          if (existing?.jornada_start_at && roundShift(existing) === it.shift) patch.jornada_start_at = null;
          await supabase.from('machine_rounds').upsert(
            { machinery_id: it.id, round_date: rd, round_no: 1, ...patch },
            { onConflict: 'machinery_id,round_date,round_no' }
          );
          // Si ya tenía horas trabajadas, quedan a salvo en machine_work_segments
          // (no se pierden solo porque se pongan en 0 en machine_rounds).
          if (prevHours > 0) {
            const endedAt = new Date();
            const startedAt = new Date(endedAt.getTime() - prevHours * 3600_000);
            await supabase.from('machine_work_segments').insert({
              machinery_id: it.id, round_date: rd, shift: it.shift,
              started_at: startedAt.toISOString(), ended_at: endedAt.toISOString(), hours: prevHours,
              source: 'ajuste_manual', recorded_by: uid,
              notes: 'Marcado como Pendiente desde el panel de Inspecciones (admin) — horas previas conservadas aquí.',
            });
          }
          logAudit('JORNADA_FIN', 'machinery', it.id, `${codeOf(it.id)} · marcado Pendiente (panel supervisor) · ${it.shift === 'day' ? 'día' : 'noche'}${prevHours > 0 ? ` · ${prevHours.toFixed(2)}h conservadas` : ''}`);
        }
      }
      setBulkSel(new Set());
      await load();
    } finally {
      setBulkBusy(false);
    }
  };

  // Conjuntos de estado para el DÍA + TURNO elegidos.
  const daySets = useMemo(() => {
    // Iniciadas del día elegido, directo de las rondas (robusto aunque el día quede
    // fuera de la ventana de 14 días de la gráfica).
    const startedSet = new Set<string>();
    rounds.forEach((r) => { if (r.round_date === selDay && startedForShift(r, shift)) startedSet.add(r.machinery_id); });
    // Jornada de NOCHE de AYER aún ABIERTA (cruza la medianoche, termina a las 7am):
    // sin esto, al ver "hoy" recién pasada la medianoche esas máquinas parecían
    // "pendientes" aunque siguen trabajando hasta las 7am. Mismo criterio que
    // SupervisorScreen.tsx (rescata la noche de ayer aún abierta).
    if (shift === 'night') {
      const y = new Date(selDay + 'T12:00:00-04:00'); y.setUTCDate(y.getUTCDate() - 1);
      const yesterdayIso = y.toISOString().slice(0, 10);
      rounds.forEach((r) => { if (r.round_date === yesterdayIso && r.jornada_shift === 'night' && r.jornada_start_at) startedSet.add(r.machinery_id); });
    }
    const dayStartMs = new Date(selDay + 'T00:00:00-04:00').getTime();
    const dayEndMs = new Date(selDay + 'T23:59:59.999-04:00').getTime();
    // Una avería PENDIENTE (material real, sin resolver) mantiene la máquina AVERIADA
    // día tras día HASTA que se marque operativa — se arrastra, no baja a parada ni a
    // pendiente al día siguiente. Solo se aplica la cota SUPERIOR (`<= dayEndMs`) para
    // que al mirar un día pasado no se cuenten averías reportadas después. Mismo
    // criterio que `averiaPendienteIds` en SupervisorScreen.tsx (sin filtro de fecha).
    const averSet = new Set<string>();
    maint.forEach((m) => {
      if (m.material === 'MÁQUINA PARADA') return;
      const t = new Date(m.created_at).getTime();
      if (t > dayEndMs) return; // reportada DESPUÉS del día → no cuenta
      const arr = t < dayStartMs; // avería marcada ANTES del día = arrastrada
      // Arrastrada: solo si la máquina NO trabajó hoy (si arrancó jornada se reactivó →
      // no debe salir como averiada). Del día: siempre (gana sobre "trabajando").
      // Mismo criterio que segmentoDe en SupervisorScreen.tsx (teléfono).
      if (arr ? !startedSet.has(m.machinery_id) : true) averSet.add(m.machinery_id);
    });
    const paradaSet = new Set<string>();
    maint.forEach((m) => {
      if (m.material !== 'MÁQUINA PARADA') return;
      const t = new Date(m.created_at).getTime();
      if (t > dayEndMs || averSet.has(m.machinery_id)) return; // avería tiene su propia categoría
      const arr = t < dayStartMs; // marcada antes del día = arrastrada (aplica si no trabaja hoy)
      const applies = arr ? !startedSet.has(m.machinery_id) : paradaShiftOf(m.created_at) === shift;
      if (applies) paradaSet.add(m.machinery_id);
    });
    const assignedShift = new Set(assignments.filter((a) => a.shift === shift).map((a) => a.machinery_id));
    return { startedSet, paradaSet, averSet, assignedShift };
  }, [rounds, selDay, shift, maint, assignments]);

  // KPIs del día (totales).
  const top = useMemo(() => {
    const { startedSet, paradaSet, averSet, assignedShift } = daySets;
    let pend = 0; assignedShift.forEach((id) => { if (!startedSet.has(id) && !paradaSet.has(id) && !averSet.has(id)) pend++; });
    return { iniciadas: startedSet.size, pendientes: pend, paradas: paradaSet.size, averiadas: averSet.size };
  }, [daySets]);

  // Código de máquina por id (de asignaciones, rondas o mantenimiento).
  const codeById = useMemo(() => {
    const m = new Map<string, string>();
    assignments.forEach((a) => { if (a.code) m.set(a.machinery_id, a.code); });
    rounds.forEach((r) => { const c = (r.machine as any)?.code; if (c && !m.has(r.machinery_id)) m.set(r.machinery_id, c); });
    maint.forEach((x) => { const c = (x.machine as any)?.code; if (c && !m.has(x.machinery_id)) m.set(x.machinery_id, c); });
    return m;
  }, [assignments, rounds, maint]);

  // Máquinas inactivas o no-operativas (averiada de catálogo) — MISMO criterio que
  // `visibleParaInspector()` en SupervisorScreen.tsx (TAREA 4): el teléfono las
  // OCULTA de "Mis máquinas asignadas" salvo que tengan jornada iniciada HOY,
  // así el inspector no pierde tiempo con equipo que ya se sabe parado/retirado.
  // Sin este mismo filtro aquí, el desglose "POR INSPECTOR" cuenta máquinas que
  // el inspector nunca ve en su teléfono — inflando "averiadas" con tickets viejos
  // de equipo inactivo que no tiene nada que ver con la ronda de hoy.
  const machInactiveSet = useMemo(() => {
    const s = new Set<string>();
    machList.forEach((m) => { if (m.active === false || m.operational === false) s.add(m.id); });
    return s;
  }, [machList]);

  // Ficha COMPLETA por máquina (placa, serial, ubicación, empresa, encargado…).
  const machineInfo = useMemo(() => {
    const map = new Map<string, MInfo>();
    machList.forEach((m) => {
      map.set(m.id, {
        id: m.id,
        code: m.code ?? codeById.get(m.id) ?? '—',
        plate: m.plate ?? null,
        serial: m.serial ?? null,
        identifier: m.identifier ?? null,
        company: m.company?.name ?? null,
        encargado: m.encargado ?? null,
        location: m.location ?? null,
        referencia: m.referencia ?? null,
        sector: m.sector ?? null,
        zona: m.zona ?? null,
        tipo: m.tipo ?? null,
        clasificacion: m.clasificacion ?? null,
        machinery_type: m.machinery_type ?? null,
        lastHoro: m.last_horometro != null ? Number(m.last_horometro) : null,
      });
    });
    return map;
  }, [machList, codeById]);

  // Horas + horómetro del DÍA elegido por máquina (de las rondas de selDay).
  const roundDetail = useMemo(() => {
    const map = new Map<string, { dayH: number; nightH: number; horoIni: number | null; horoFin: number | null; shift: 'day' | 'night' }>();
    rounds.forEach((r) => {
      if (r.round_date !== selDay) return;
      const cur = map.get(r.machinery_id) ?? { dayH: 0, nightH: 0, horoIni: null, horoFin: null, shift: roundShift(r) };
      cur.dayH += Number(r.day_hours) || 0;
      cur.nightH += Number(r.night_hours) || 0;
      if (r.horometro_inicial != null) cur.horoIni = Number(r.horometro_inicial);
      if (r.horometro_final != null) cur.horoFin = Number(r.horometro_final);
      cur.shift = roundShift(r);
      map.set(r.machinery_id, cur);
    });
    return map;
  }, [rounds, selDay]);

  // Estado (iniciada/averiada/parada/pendiente) de una máquina en selDay+turno.
  // Misma prioridad que el teléfono (segmentoDe) y el desglose por inspector:
  // avería > parada > iniciada > pendiente (una máquina averiada/parada no cuenta
  // como iniciada aunque haya arrancado jornada).
  const estadoOf = useCallback((id: string): Estado => {
    const { startedSet, averSet, paradaSet } = daySets;
    return averSet.has(id) ? 'averiada' : paradaSet.has(id) ? 'parada' : startedSet.has(id) ? 'iniciada' : 'pendiente';
  }, [daySets]);

  // Inspector asignado a cada máquina en el turno elegido. El cajón "…FALTANTES"
  // significa SIN inspector real (máquina por asignar).
  const inspectorByMachine = useMemo(() => {
    const m = new Map<string, string>();
    assignments.filter((a) => a.shift === shift).forEach((a) => { if (a.inspector_name) m.set(a.machinery_id, a.inspector_name); });
    return m;
  }, [assignments, shift]);
  const sinInspectorReal = (name: string | null) => !name || /faltant/i.test(name);

  // IDs de máquina por estado (para la lista al tocar una KPI de arriba). Ordenados por código.
  const cmpId = useCallback((a: string, b: string) => cmpText(codeById.get(a) || '', codeById.get(b) || ''), [codeById]);
  const topIds = useMemo(() => {
    const { startedSet, paradaSet, averSet, assignedShift } = daySets;
    const pendIds: string[] = [];
    assignedShift.forEach((id) => { if (!startedSet.has(id) && !paradaSet.has(id) && !averSet.has(id)) pendIds.push(id); });
    const s = (ids: Iterable<string>) => [...ids].sort(cmpId);
    return { ini: s(startedSet), pend: s(pendIds), par: s(paradaSet), ave: s(averSet) };
  }, [daySets, cmpId]);

  // Modal de LISTA de máquinas de un estado (filtrable por TODAS sus características).
  const [listModal, setListModal] = useState<{ title: string; ids: string[] } | null>(null);
  const [listQ, setListQ] = useState('');
  const [listExpanded, setListExpanded] = useState<string | null>(null);
  const openList = (title: string, ids: string[]) => { setListQ(''); setListExpanded(null); setListModal({ title, ids }); };
  // Filas enriquecidas del modal (código + estado + ficha + horas/litros del día).
  const listRows = useMemo(() => {
    if (!listModal) return [];
    return listModal.ids.map((id) => {
      const info = machineInfo.get(id) ?? null;
      const rd = roundDetail.get(id) ?? null;
      const fuel = fuelDay[id] ?? null;
      const worked = rd ? rd.dayH + rd.nightH : 0;
      const inspector = inspectorByMachine.get(id) ?? null;
      return { id, code: info?.code ?? codeById.get(id) ?? '—', info, rd, fuel, worked, estado: estadoOf(id), inspector };
    });
  }, [listModal, machineInfo, roundDetail, fuelDay, codeById, estadoOf, inspectorByMachine]);
  const listShown = useMemo(() => {
    const nq = norm(listQ.trim());
    if (!nq) return listRows;
    return listRows.filter((r) => {
      const i = r.info;
      return [r.code, i?.plate, i?.serial, i?.identifier, i?.company, i?.encargado, i?.location, i?.referencia, i?.sector, i?.zona, i?.tipo, i?.clasificacion, i?.machinery_type, r.inspector]
        .some((v) => norm(v).includes(nq));
    });
  }, [listRows, listQ]);

  // Desglose por INSPECTOR (asignaciones del turno como columna vertebral).
  const perInspector = useMemo(() => {
    const { startedSet, paradaSet, averSet } = daySets;
    const byName = new Map<string, { name: string; ids: Set<string>; code: Map<string, string> }>();
    assignments.filter((a) => a.shift === shift).forEach((a) => {
      const nm = a.inspector_name || '—';
      const e = byName.get(nm) ?? { name: nm, ids: new Set<string>(), code: new Map<string, string>() };
      e.ids.add(a.machinery_id); e.code.set(a.machinery_id, a.code || '—');
      byName.set(nm, e);
    });
    return [...byName.values()].map((e) => {
      const ini: string[] = [], pend: string[] = [], par: string[] = [], ave: string[] = [];
      // MISMA prioridad que el teléfono (segmentoDe): avería > parada > iniciada >
      // pendiente. Una máquina averiada/parada NO se cuenta como iniciada aunque haya
      // arrancado jornada. La eficiencia no cambia (depende solo de `pend`).
      // Excluye máquinas inactivas/no-operativas SIN jornada de hoy (machInactiveSet),
      // igual que el teléfono — si no, no cuenta en el total ("N asignada(s)").
      const visibleIds = [...e.ids].filter((id) => !machInactiveSet.has(id) || startedSet.has(id));
      visibleIds.forEach((id) => {
        if (averSet.has(id)) ave.push(id);
        else if (paradaSet.has(id)) par.push(id);
        else if (startedSet.has(id)) ini.push(id);
        else pend.push(id);
      });
      // Ordena por CÓDIGO (los arreglos guardan IDs; el detalle se resuelve en el modal).
      const s = (a: string[]) => a.sort((x, y) => cmpText(e.code.get(x) || '', e.code.get(y) || ''));
      // El cajón MAQUINAS FALTANTES no es un inspector real: no le calculamos
      // eficiencia (no tiene sentido "premiar/penalizar" al usuario de sistema) — en
      // su lugar se ofrece un desplegable para asignar sus máquinas a alguien real.
      const isFaltantes = sinInspectorReal(e.name);
      // Eficiencia = % de asignadas que el inspector SÍ chequeó (iniciada, parada o
      // averiada) contra las que dejó completamente sin tocar (pendientes). Misma
      // fórmula que el PDF de generateSummaryReport (inspectorSummaryReport.ts).
      const eficiencia = isFaltantes || visibleIds.length === 0 ? null : Math.round(((visibleIds.length - pend.length) / visibleIds.length) * 100);
      return { name: e.name, ini: s(ini), pend: s(pend), par: s(par), ave: s(ave), total: visibleIds.length, eficiencia, isFaltantes };
    }).sort((a, b) => b.ini.length - a.ini.length || cmpText(a.name, b.name));
  }, [assignments, shift, daySets, machInactiveSet]);

  const inspShown = useMemo(() => {
    const nq = norm(inspQ.trim());
    return nq ? perInspector.filter((i) => norm(i.name).includes(nq)) : perInspector;
  }, [perInspector, inspQ]);
  const maxInsp = Math.max(1, ...inspShown.map((i) => i.ini.length));
  const sel = selInsp ? perInspector.find((i) => i.name === selInsp) ?? null : null;
  // Cajón MAQUINAS FALTANTES del turno: sus máquinas son, por definición, las que
  // no tienen inspector real — se ofrecen para asignar directo desde aquí.
  const faltantes = perInspector.find((i) => i.isFaltantes) ?? null;
  const faltantesIds = useMemo(() => {
    if (!faltantes) return [];
    return [...faltantes.ini, ...faltantes.pend, ...faltantes.par, ...faltantes.ave].sort(cmpId);
  }, [faltantes, cmpId]);

  const shiftIcon = shift === 'day' ? '☀️' : '🌙';
  const shiftLbl = shift === 'day' ? 'DÍA' : 'NOCHE';

  // Color de la eficiencia: verde 100%, ámbar 50-99%, rojo <50% (mismo criterio que el PDF).
  const efiColor = (e: number | null): string => (e === null ? colors.muted : e >= 100 ? colors.success : e >= 50 ? colors.warning : colors.danger);

  const KpiCard = ({ label, value, tone, onPress }: { label: string; value: number; tone: 'brand' | 'muted' | 'warn' | 'crit'; onPress?: () => void }) => {
    const map = {
      brand: { fg: colors.brandText, bg: colors.surface },
      muted: { fg: colors.muted, bg: colors.surfaceAlt },
      warn: { fg: colors.accentSoftText, bg: colors.accentSoftBg },
      crit: { fg: colors.dangerSoftText, bg: colors.dangerSoftBg },
    } as const;
    const t = map[tone];
    const Comp: any = onPress ? TouchableOpacity : View;
    return (
      <Comp onPress={onPress} activeOpacity={0.7} style={{ flex: 1, backgroundColor: t.bg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
        <Text style={{ color: t.fg, fontWeight: '900', fontSize: 24, fontVariant: ['tabular-nums'] as any }}>{value}</Text>
        <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700', textAlign: 'center', marginTop: 2 }} numberOfLines={2}>{label}{onPress ? ' ›' : ''}</Text>
      </Comp>
    );
  };
  // Etiqueta + color del estado para el pill del modal.
  const estadoMeta = (e: Estado): { label: string; fg: string; bg: string } => {
    switch (e) {
      case 'iniciada': return { label: '✅ Iniciada', fg: colors.brandText, bg: colors.surfaceAlt };
      case 'averiada': return { label: '🔴 Averiada', fg: colors.dangerSoftText, bg: colors.dangerSoftBg };
      case 'parada': return { label: '🟡 Parada', fg: colors.accentSoftText, bg: colors.accentSoftBg };
      default: return { label: '⏳ Pendiente', fg: colors.muted, bg: colors.surfaceAlt };
    }
  };
  // Fila etiqueta/valor del detalle expandido de una máquina.
  const detailRow = (label: string, value: React.ReactNode) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Text style={{ color: colors.muted, fontSize: 11.5, flexShrink: 0 }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700', flex: 1, textAlign: 'right', fontVariant: ['tabular-nums'] as any }}>{value}</Text>
    </View>
  );

  return (
    <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden', marginBottom: spacing.md }}>
      {/* Cabecera navy + switch de turno. */}
      <View style={{ backgroundColor: colors.brand, paddingHorizontal: spacing.md, paddingVertical: spacing.md }}>
        <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 16, letterSpacing: 0.4 }}>RESUMEN DE INSPECCIONES</Text>
        <View style={{ flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: radius.pill, padding: 3, marginTop: spacing.sm }}>
          {(['day', 'night'] as const).map((s) => {
            const on = shift === s;
            return (
              <TouchableOpacity key={s} onPress={() => { setShift(s); setSelInsp(null); }} style={{ flex: 1, paddingVertical: 8, borderRadius: radius.pill, alignItems: 'center', backgroundColor: on ? colors.brandContrast : 'transparent' }}>
                <Text style={{ color: on ? colors.brand : colors.brandContrast, fontWeight: '900', fontSize: 13 }}>{s === 'day' ? '☀️ DÍA' : '🌙 NOCHE'}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {loading ? (
        <View style={{ padding: spacing.xl, alignItems: 'center' }}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <View style={{ padding: spacing.md }}>
          {/* Navegador de FECHA (arriba, junto a las gráficas). Controla los KPIs, las
              barras y la lista de rondas de abajo (misma fecha en todo). */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md }}>
            <TouchableOpacity onPress={() => shiftDay(-1)} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.background }}>
              <Text style={{ color: colors.brandText, fontWeight: '800' }}>◀</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <DateField value={selDay} onChange={(d) => { setSelDay(d); setSelInsp(null); }} maxISO={caracasToday()} />
            </View>
            <TouchableOpacity onPress={() => shiftDay(1)} disabled={selDay >= caracasToday()} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.background, opacity: selDay >= caracasToday() ? 0.4 : 1 }}>
              <Text style={{ color: colors.brandText, fontWeight: '800' }}>▶</Text>
            </TouchableOpacity>
          </View>

          {/* KPIs del día elegido. */}
          <View style={{ flexDirection: 'row', gap: spacing.xs }}>
            <KpiCard label={`Iniciadas ${shiftIcon} (${shortDate(selDay)})`} value={top.iniciadas} tone="brand" onPress={() => openList(`✅ Iniciadas · ${shortDate(selDay)} ${shiftIcon}`, topIds.ini)} />
            <KpiCard label="Pendientes por iniciar" value={top.pendientes} tone="muted" onPress={() => openList(`⏳ Pendientes por iniciar · ${shortDate(selDay)} ${shiftIcon}`, topIds.pend)} />
            <KpiCard label="Paradas / no trabajó" value={top.paradas} tone="warn" onPress={() => openList(`🟡 Paradas / no trabajó · ${shortDate(selDay)} ${shiftIcon}`, topIds.par)} />
            <KpiCard label="Averiadas" value={top.averiadas} tone="crit" onPress={() => openList(`🔴 Averiadas · ${shortDate(selDay)} ${shiftIcon}`, topIds.ave)} />
          </View>

          {/* Barras de los TOTALES del día elegido (comparación visual por estado).
              Tocar una barra abre la lista de esas máquinas. */}
          <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 13, marginTop: spacing.md, marginBottom: spacing.sm, letterSpacing: 0.3 }}>
            📊 TOTALES DEL DÍA · {shortDate(selDay)} · {shiftIcon} {shiftLbl}
          </Text>
          <View style={{ gap: 8 }}>
            {[
              { label: '✅ Iniciadas', value: top.iniciadas, color: colors.tankFill, ids: topIds.ini, title: `✅ Iniciadas · ${shortDate(selDay)} ${shiftIcon}` },
              { label: '⏳ Pendientes por iniciar', value: top.pendientes, color: colors.muted, ids: topIds.pend, title: `⏳ Pendientes por iniciar · ${shortDate(selDay)} ${shiftIcon}` },
              { label: '🟡 Paradas / no trabajó', value: top.paradas, color: colors.accent, ids: topIds.par, title: `🟡 Paradas / no trabajó · ${shortDate(selDay)} ${shiftIcon}` },
              { label: '🔴 Averiadas', value: top.averiadas, color: colors.danger, ids: topIds.ave, title: `🔴 Averiadas · ${shortDate(selDay)} ${shiftIcon}` },
            ].map((r) => {
              const maxTotal = Math.max(1, top.iniciadas, top.pendientes, top.paradas, top.averiadas);
              return (
                <TouchableOpacity key={r.label} onPress={() => openList(r.title, r.ids)} activeOpacity={0.7}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12.5 }}>{r.label} ›</Text>
                    <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13, fontVariant: ['tabular-nums'] as any }}>{r.value}</Text>
                  </View>
                  <View style={{ height: 16, backgroundColor: colors.tankTrack, borderRadius: radius.pill, overflow: 'hidden' }}>
                    <View style={{ height: 16, width: `${Math.max(2, (r.value / maxTotal) * 100)}%`, backgroundColor: r.color, borderRadius: radius.pill }} />
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Reporte (PDF) de máquinas por asignar / por iniciar del día + turno. */}
          <TouchableOpacity onPress={makePorAsignarReport} disabled={pdfBusy !== null} activeOpacity={0.85} style={{ marginTop: spacing.md, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 11, alignItems: 'center', opacity: pdfBusy !== null ? 0.6 : 1 }}>
            <Text style={{ color: colors.accentContrast, fontWeight: '900', fontSize: 12.5 }}>{pdfBusy === POR_ASIGNAR_KEY ? 'Generando…' : '📄 Reporte de máquinas por asignar / por iniciar'}</Text>
          </TouchableOpacity>

          {/* Panel "Gestionar Iniciada/Pendiente por supervisor" — SOLO visible para las
              2 cuentas en BULK_TOGGLE_USERNAMES/CEDULAS (ver arriba) o quien se sume
              desde Ajustes. Marca o quita el arranque de jornada del día de HOY en
              `machine_rounds`, en bloque, agrupado por inspector. */}
          {bulkAllowed ? (
            <View style={{ marginTop: spacing.md }}>
              <TouchableOpacity onPress={() => setBulkOpen((o) => !o)} activeOpacity={0.85} style={{ backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: 11, alignItems: 'center' }}>
                <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 12.5 }}>🔧 Gestionar Iniciada / Pendiente por supervisor {bulkOpen ? '▲' : '▼'}</Text>
              </TouchableOpacity>
              {bulkOpen ? (
                <View style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
                  {!bulkIsToday ? (
                    <Text style={{ color: colors.dangerSoftText, fontSize: 12, marginBottom: spacing.sm }}>
                      Solo se puede gestionar el día de HOY ({shortDate(caracasToday())}) — volvé al día actual con ▶ arriba para usar este panel.
                    </Text>
                  ) : null}
                  {/* Filtro de TURNO — propio del panel, para no mezclar día y noche por
                      error al seleccionar/marcar en bloque. */}
                  <View style={{ flexDirection: 'row', gap: 6, marginBottom: spacing.xs }}>
                    {([['all', 'Todos'], ['day', '☀️ Día'], ['night', '🌙 Noche']] as const).map(([v, lbl]) => {
                      const on = bulkShiftFilter === v;
                      return (
                        <TouchableOpacity key={v} onPress={() => setBulkShiftFilter(v)} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : 'transparent' }}>
                          <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 11.5 }}>{lbl}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  {/* Filtro de ESTADO (iniciada / pendiente por iniciar). */}
                  <View style={{ flexDirection: 'row', gap: 6, marginBottom: spacing.sm }}>
                    {([['all', 'Todas'], ['started', '✅ Iniciadas'], ['pending', '⏳ Pendientes']] as const).map(([v, lbl]) => {
                      const on = bulkStatusFilter === v;
                      return (
                        <TouchableOpacity key={v} onPress={() => setBulkStatusFilter(v)} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : 'transparent' }}>
                          <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 11.5 }}>{lbl}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  {/* Excluir paradas/averiadas: sin esto cuentan como "Pendiente" y se
                      mezclan con las que de verdad faltan por iniciar. */}
                  <TouchableOpacity onPress={() => setBulkHideStopped((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm }}>
                    <View style={{ width: 18, height: 18, borderRadius: 4, borderWidth: 2, borderColor: bulkHideStopped ? colors.brand : colors.border, backgroundColor: bulkHideStopped ? colors.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                      {bulkHideStopped ? <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 11 }}>✓</Text> : null}
                    </View>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>🚫 Excluir paradas/averiadas de la lista</Text>
                  </TouchableOpacity>

                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
                    <TouchableOpacity onPress={toggleBulkAll} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={{ width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: bulkAllKeys.length > 0 && bulkAllKeys.every((k) => bulkSel.has(k)) ? colors.brand : colors.border, backgroundColor: bulkAllKeys.length > 0 && bulkAllKeys.every((k) => bulkSel.has(k)) ? colors.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                        {bulkAllKeys.length > 0 && bulkAllKeys.every((k) => bulkSel.has(k)) ? <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 12 }}>✓</Text> : null}
                      </View>
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Seleccionar todas las visibles ({bulkAllKeys.length})</Text>
                    </TouchableOpacity>
                    {bulkSel.size > 0 ? (
                      <TouchableOpacity onPress={() => setBulkSel(new Set())}>
                        <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 12 }}>✕ Quitar selección ({bulkSel.size})</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>

                  {bulkGroups.length === 0 ? (
                    <Text style={{ color: colors.muted, fontSize: 12.5, textAlign: 'center', paddingVertical: spacing.md }}>Sin máquinas para estos filtros.</Text>
                  ) : (
                    <ScrollView style={{ maxHeight: 360 }}>
                      {bulkGroups.map((g) => {
                        const keys = g.items.map((i) => i.key);
                        const allIn = keys.length > 0 && keys.every((k) => bulkSel.has(k));
                        return (
                          <View key={g.name} style={{ marginBottom: spacing.sm }}>
                            <TouchableOpacity onPress={() => toggleBulkGroup(keys)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 6 }}>
                              <View style={{ width: 16, height: 16, borderRadius: 4, borderWidth: 2, borderColor: allIn ? colors.brand : colors.border, backgroundColor: allIn ? colors.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                                {allIn ? <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 10 }}>✓</Text> : null}
                              </View>
                              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>👷 {g.name} ({g.items.length})</Text>
                            </TouchableOpacity>
                            {g.items.map((it) => {
                              const on = bulkSel.has(it.key);
                              return (
                                <TouchableOpacity key={it.key} onPress={() => toggleBulkOne(it.key)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingLeft: spacing.md }}>
                                  <View style={{ width: 18, height: 18, borderRadius: 4, borderWidth: 2, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                                    {on ? <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 11 }}>✓</Text> : null}
                                  </View>
                                  <Text style={{ fontSize: 12 }}>{it.shift === 'day' ? '☀️' : '🌙'}</Text>
                                  <Text style={{ color: colors.text, fontSize: 12.5, flex: 1 }}>{it.code}</Text>
                                  <Text style={{ color: it.started ? colors.brandText : it.stopped ? colors.dangerSoftText : colors.muted, fontWeight: '700', fontSize: 11 }}>{it.started ? '✅ Iniciada' : it.stopped ? '🚫 Parada/Averiada' : '⏳ Pendiente'}</Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        );
                      })}
                    </ScrollView>
                  )}

                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                    <TouchableOpacity onPress={() => applyBulk('start')} disabled={bulkSel.size === 0 || bulkBusy || !bulkIsToday} activeOpacity={0.85} style={{ flex: 1, backgroundColor: colors.success, borderRadius: radius.md, paddingVertical: 10, alignItems: 'center', opacity: bulkSel.size === 0 || bulkBusy || !bulkIsToday ? 0.5 : 1 }}>
                      <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12 }}>{bulkBusy ? 'Guardando…' : `🟢 Marcar Iniciada (${bulkSel.size})`}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => applyBulk('pending')} disabled={bulkSel.size === 0 || bulkBusy || !bulkIsToday} activeOpacity={0.85} style={{ flex: 1, backgroundColor: colors.danger, borderRadius: radius.md, paddingVertical: 10, alignItems: 'center', opacity: bulkSel.size === 0 || bulkBusy || !bulkIsToday ? 0.5 : 1 }}>
                      <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12 }}>{bulkBusy ? 'Guardando…' : `⏳ Marcar Pendiente (${bulkSel.size})`}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Barras VERTICALES por inspector (del turno). Tocar → detalle. */}
          <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 13, marginTop: spacing.md, marginBottom: spacing.xs, letterSpacing: 0.3, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
            👷 POR INSPECTOR · {shortDate(selDay)} · {shiftIcon} {shiftLbl}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, marginBottom: spacing.sm }}>
            <Text style={{ fontSize: 14 }}>🔎</Text>
            <TextInput value={inspQ} onChangeText={setInspQ} placeholder="Buscar inspector…" placeholderTextColor={colors.muted} style={{ flex: 1, color: colors.text, fontSize: 13, paddingVertical: 8 }} />
            {inspQ ? <TouchableOpacity onPress={() => setInspQ('')}><Text style={{ color: colors.muted, fontWeight: '800' }}>✕</Text></TouchableOpacity> : null}
          </View>

          {/* Reporte (PDF) de eficiencia de TODOS los inspectores del turno/día. */}
          <TouchableOpacity onPress={makeEficienciaReport} disabled={pdfBusy !== null} activeOpacity={0.85} style={{ marginBottom: spacing.sm, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 11, alignItems: 'center', opacity: pdfBusy !== null ? 0.6 : 1 }}>
            <Text style={{ color: colors.accentContrast, fontWeight: '900', fontSize: 12.5 }}>{pdfBusy === EFICIENCIA_KEY ? 'Generando…' : '📄 Reporte de eficiencia (todos los inspectores)'}</Text>
          </TouchableOpacity>

          {inspShown.length === 0 ? (
            <Text style={{ color: colors.muted, fontSize: 12.5, paddingVertical: spacing.md, textAlign: 'center' }}>Sin inspectores {shiftIcon} para el {shortDate(selDay)}.</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.xs, alignItems: 'flex-end' }}>
              {inspShown.map((ins) => {
                const on = ins.name === selInsp;
                const h = Math.max(6, (ins.ini.length / maxInsp) * 96);
                return (
                  <TouchableOpacity key={ins.name} onPress={() => setSelInsp(on ? null : ins.name)} activeOpacity={0.7} style={{ width: 58, alignItems: 'center' }}>
                    <Text style={{ color: on ? colors.brandText : colors.text, fontWeight: '900', fontSize: 12, marginBottom: 2, fontVariant: ['tabular-nums'] as any }}>{ins.ini.length}</Text>
                    <View style={{ height: 96, width: 26, backgroundColor: colors.tankTrack, borderRadius: 6, justifyContent: 'flex-end', overflow: 'hidden', borderWidth: on ? 2 : 0, borderColor: colors.accent }}>
                      <View style={{ height: h, width: '100%', backgroundColor: on ? colors.accent : colors.tankFill }} />
                    </View>
                    <Text style={{ color: efiColor(ins.eficiencia), fontWeight: '800', fontSize: 9.5, marginTop: 2 }}>{ins.eficiencia !== null ? `⚡${ins.eficiencia}%` : '—'}</Text>
                    <Text numberOfLines={2} style={{ color: on ? colors.brandText : colors.muted, fontSize: 9.5, fontWeight: on ? '800' : '600', textAlign: 'center', marginTop: 2, height: 24 }}>{ins.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {/* 🧩 Máquinas por asignar (cajón MAQUINAS FALTANTES): desplegable con la
              lista de sus máquinas y un selector de inspector real para asignarlas. */}
          {faltantes && faltantesIds.length > 0 ? (
            <View style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: colors.warning, borderRadius: radius.md, overflow: 'hidden' }}>
              <TouchableOpacity onPress={() => setFaltantesOpen((v) => !v)} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, backgroundColor: colors.warningSoftBg }}>
                <Text style={{ fontSize: 16 }}>🧩</Text>
                <Text style={{ flex: 1, color: colors.warningSoftText, fontWeight: '900', fontSize: 13 }}>Máquinas por asignar ({faltantesIds.length})</Text>
                <Text style={{ color: colors.warningSoftText, fontWeight: '900', fontSize: 16 }}>{faltantesOpen ? '▾' : '▸'}</Text>
              </TouchableOpacity>
              {faltantesOpen ? (
                <View style={{ padding: spacing.sm, gap: spacing.xs, backgroundColor: colors.background }}>
                  <Text style={{ color: colors.muted, fontSize: 11.5, marginBottom: 2 }}>
                    Sin inspector real — el sistema les acumula horas automáticamente. Elige a quién asignárselas.
                  </Text>
                  {faltantesIds.map((id) => {
                    const code = codeById.get(id) ?? '—';
                    const pickerOpen = assignPickerFor === id;
                    const busy = assignBusy === id;
                    return (
                      <View key={id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                          <Text style={{ flex: 1, color: colors.text, fontWeight: '700', fontSize: 13 }}>{code}</Text>
                          <TouchableOpacity
                            onPress={() => setAssignPickerFor(pickerOpen ? null : id)}
                            disabled={busy}
                            style={{ borderWidth: 1, borderColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4, opacity: busy ? 0.6 : 1 }}
                          >
                            <Text style={{ color: colors.accent, fontWeight: '800', fontSize: 11.5 }}>{busy ? 'Asignando…' : pickerOpen ? 'Cerrar ▴' : 'Asignar ▾'}</Text>
                          </TouchableOpacity>
                        </View>
                        {pickerOpen ? (
                          <View style={{ marginTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs, gap: 4 }}>
                            {realInspectors.length === 0 ? (
                              <Text style={{ color: colors.muted, fontSize: 12 }}>No hay inspectores registrados.</Text>
                            ) : (
                              realInspectors.map((insp) => (
                                <TouchableOpacity key={insp.id} onPress={() => doAssign(id, insp)} activeOpacity={0.6} style={{ paddingVertical: 6, paddingHorizontal: spacing.xs, borderRadius: radius.sm }}>
                                  <Text style={{ color: colors.text, fontSize: 12.5 }}>👮 {insp.full_name}</Text>
                                </TouchableOpacity>
                              ))
                            )}
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Detalle del inspector elegido: los MISMOS 4 datos, por inspector. */}
          {sel ? (
            <View style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.background }}>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 14, marginBottom: spacing.sm }}>👷 {sel.name} <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 12 }}>· {sel.total} asignada(s)</Text></Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <KpiCard label="Iniciadas" value={sel.ini.length} tone="brand" onPress={() => openList(`✅ Iniciadas · ${sel.name}`, sel.ini)} />
                <KpiCard label="Pendientes" value={sel.pend.length} tone="muted" onPress={() => openList(`⏳ Pendientes · ${sel.name}`, sel.pend)} />
                <KpiCard label="Paradas" value={sel.par.length} tone="warn" onPress={() => openList(`🟡 Paradas · ${sel.name}`, sel.par)} />
                <KpiCard label="Averiadas" value={sel.ave.length} tone="crit" onPress={() => openList(`🔴 Averiadas · ${sel.name}`, sel.ave)} />
                <KpiCard label="Eficiencia" value={sel.eficiencia ?? 0} tone={sel.eficiencia === 100 ? 'brand' : sel.eficiencia != null && sel.eficiencia >= 50 ? 'warn' : 'crit'} />
              </View>
              {/* Reporte OFICIAL con FIRMA de SOLO este inspector. */}
              <TouchableOpacity onPress={() => makeReport(sel.name)} disabled={pdfBusy !== null} activeOpacity={0.85} style={{ marginTop: spacing.sm, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 10, alignItems: 'center', opacity: pdfBusy !== null ? 0.6 : 1 }}>
                <Text style={{ color: colors.accentContrast, fontWeight: '900', fontSize: 12.5 }}>{pdfBusy === sel.name ? 'Generando…' : `📄 Reporte de ${sel.name} (con firma)`}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={{ color: colors.muted, fontSize: 11.5, textAlign: 'center', marginTop: spacing.xs }}>Toca la barra de un inspector para ver sus máquinas por estado.</Text>
          )}
        </View>
      )}

      {/* Lista filtrable de máquinas del estado que se tocó (KPI de arriba o de inspector). */}
      <Modal visible={listModal != null} transparent animationType="slide" onRequestClose={() => setListModal(null)}>
        <Pressable onPress={() => setListModal(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '82%', padding: spacing.lg }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.sm }}>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15, flex: 1 }} numberOfLines={2}>{listModal?.title} ({listModal?.ids.length ?? 0})</Text>
              <TouchableOpacity onPress={() => setListModal(null)} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>Cerrar ✕</Text>
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, marginBottom: spacing.sm }}>
              <Text style={{ fontSize: 14 }}>🔎</Text>
              <TextInput value={listQ} onChangeText={setListQ} placeholder="Filtrar: código, placa, serial, ubicación, empresa, encargado…" placeholderTextColor={colors.muted} style={{ flex: 1, color: colors.text, fontSize: 14, paddingVertical: 9 }} />
              {listQ ? <TouchableOpacity onPress={() => setListQ('')}><Text style={{ color: colors.muted, fontWeight: '800' }}>✕</Text></TouchableOpacity> : null}
            </View>
            <ScrollView style={{ maxHeight: 440 }} keyboardShouldPersistTaps="handled">
              {listShown.length === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center', paddingVertical: spacing.lg }}>Sin máquinas.</Text>
              ) : (
                listShown.map((r, i) => {
                  const em = estadoMeta(r.estado);
                  const info = r.info;
                  const open = listExpanded === r.id;
                  const lph = r.fuel ? lphOf(r.fuel.liters, r.worked) : null;
                  const litros = r.fuel && r.fuel.liters > 0 ? `${litersLabel(r.fuel.liters)} L` : '—';
                  const ubic = info?.referencia || info?.location || info?.sector || null;
                  const turnoLbl = r.rd ? (r.rd.shift === 'night' ? '🌙 Noche' : '☀️ Día') : '—';
                  const inspLbl = sinInspectorReal(r.inspector) ? '⚠️ Sin inspector (por asignar)' : `👮 ${r.inspector}`;
                  return (
                    <View key={`${r.id}-${i}`} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border, paddingVertical: 10 }}>
                      <TouchableOpacity onPress={() => setListExpanded(open ? null : r.id)} activeOpacity={0.6} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                        <Text style={{ color: colors.muted, fontSize: 12, width: 26, textAlign: 'right', fontVariant: ['tabular-nums'] as any }}>{i + 1}</Text>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' }}>
                            <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800' }}>{r.code}</Text>
                            <View style={{ backgroundColor: em.bg, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
                              <Text style={{ color: em.fg, fontSize: 10, fontWeight: '900' }}>{em.label}</Text>
                            </View>
                          </View>
                          <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 2 }} numberOfLines={open ? undefined : 1}>
                            {[info?.company, info?.plate ? `🚗 ${info.plate}` : null, info?.serial ? `#️⃣ ${info.serial}` : null, ubic ? `📍 ${ubic}` : null].filter(Boolean).join(' · ') || '—'}
                          </Text>
                          <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 1, fontVariant: ['tabular-nums'] as any }}>
                            ⛽ {litros}{lph != null ? ` · ${lph} L/h` : ''}  ·  🏁 {r.worked} h  ·  {turnoLbl}
                          </Text>
                          <Text style={{ color: sinInspectorReal(r.inspector) ? colors.warning : colors.muted, fontSize: 11.5, marginTop: 1, fontWeight: sinInspectorReal(r.inspector) ? '800' : '400' }} numberOfLines={1}>
                            {inspLbl}
                          </Text>
                        </View>
                        <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '800' }}>{open ? '▲' : '▼'}</Text>
                      </TouchableOpacity>

                      {open ? (
                        <View style={{ marginTop: spacing.sm, marginLeft: 26 + spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
                          {detailRow('Código', r.code)}
                          {detailRow('Estado', em.label)}
                          {detailRow('Inspector asignado', sinInspectorReal(r.inspector) ? '⚠️ Sin inspector (por asignar)' : r.inspector!)}
                          {detailRow('Empresa', info?.company || '—')}
                          {detailRow('Placa', info?.plate || '—')}
                          {detailRow('Serial', info?.serial || '—')}
                          {detailRow('Identificador', info?.identifier || '—')}
                          {detailRow('Ubicación / referencia', info?.referencia || '—')}
                          {detailRow('Zona', info?.location || '—')}
                          {detailRow('Sector', info?.sector || '—')}
                          {detailRow('A disposición de', info?.zona || '—')}
                          {detailRow('Encargado / operador', info?.encargado || '—')}
                          {detailRow('Modelo', info?.tipo || '—')}
                          {detailRow('Clasificación', info?.clasificacion || info?.machinery_type || '—')}
                          {detailRow('Turno', turnoLbl)}
                          {detailRow('Horas del día (día / noche)', r.rd ? `${r.rd.dayH} h / ${r.rd.nightH} h` : '—')}
                          {detailRow('Total de horas', `${r.worked} h`)}
                          {detailRow('Combustible del día', litros + (lph != null ? ` · ${lph} L/h` : ''))}
                          {detailRow('Horómetro del día', r.rd ? `${r.rd.horoIni ?? '—'} → ${r.rd.horoFin ?? '—'}` : '—')}
                          {detailRow('Último horómetro', info?.lastHoro != null ? String(info.lastHoro) : '—')}
                        </View>
                      ) : null}
                    </View>
                  );
                })
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
