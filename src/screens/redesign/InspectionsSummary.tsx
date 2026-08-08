import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, ScrollView, Modal, Pressable, Alert } from 'react-native';
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
import { generateEmpresaDiaReport } from '../../lib/porEmpresaReport';
import { generateMachineHoursReport } from '../../lib/machineHoursReport';
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
// Hora (Caracas) "HH:MM am/pm" de un instante (ms epoch), o '—'.
const horaCaracas = (ms: number): string => {
  if (!ms || isNaN(ms)) return '—';
  try { return new Intl.DateTimeFormat('es-VE', { timeZone: CARACAS_TZ, hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(ms)); } catch { return '—'; }
};
// Token de pdfBusy para el reporte "por asignar / por iniciar" (no choca con '' ni con un nombre de inspector).
const POR_ASIGNAR_KEY = '__por_asignar__';
// Token de pdfBusy para el reporte de eficiencia (todos los inspectores).
const EFICIENCIA_KEY = '__eficiencia__';
// Token de pdfBusy para el reporte del día POR EMPRESA.
const EMPRESA_KEY = '__empresa_dia__';
const HORAS_KEY = '__horas_mant__';
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
type Maint = { machinery_id: string; material: string | null; notes: string | null; created_at: string; machine?: { code?: string } | null };
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
type Estado = 'iniciada' | 'cerrada' | 'pendiente' | 'parada' | 'averiada';

// Turno de la ronda (una ronda pertenece a UN turno). Igual que inspectorReport.
const roundShift = (r: Round): 'day' | 'night' =>
  r.jornada_shift === 'night' ? 'night'
    : r.jornada_shift === 'day' ? 'day'
    : ((Number(r.night_hours) || 0) > 0 && (Number(r.day_hours) || 0) === 0 ? 'night' : 'day');
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
  // Horas TOTALES (histórico completo, sin el límite de 14 días de `rounds`) por
  // máquina — suma de day_hours+night_hours de TODAS sus rondas alguna vez
  // registradas. Consulta aparte y liviana (2 columnas, sin joins) para no inflar
  // el fetch principal. Se usa en "Horas reales totales" (perInspector).
  const [allHoursByMachine, setAllHoursByMachine] = useState<Record<string, number>>({});
  const [maint, setMaint] = useState<Maint[]>([]);
  const [assignments, setAssignments] = useState<Assign[]>([]);
  const [machList, setMachList] = useState<MachRow[]>([]);       // ficha del catálogo por máquina
  const [fuelDay, setFuelDay] = useState<Record<string, FuelAgg>>({}); // litros surtidos por máquina en selDay
  // Tramos trabajados del día (machine_work_segments) por máquina: hora de inicio
  // (min started_at), hora final (max ended_at) y horas trabajadas (suma) — para
  // mostrarlas en el detalle de cada máquina, igual que el reporte por empresa.
  const [segDay, setSegDay] = useState<Record<string, { minStart: number; maxEnd: number; sum: number }>>({});
  const [loading, setLoading] = useState(true);
  // Inspectores REALES (para el desplegable de "Máquinas por asignar" del cajón
  // MAQUINAS FALTANTES) — mismos roles que puede elegir el CHECK MÁQUINA del teléfono.
  const [realInspectors, setRealInspectors] = useState<{ id: string; full_name: string }[]>([]);
  const [faltantesOpen, setFaltantesOpen] = useState(false);
  const [faltantesQ, setFaltantesQ] = useState(''); // buscador de "máquinas por asignar"
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

  // REPORTE DEL DÍA POR EMPRESA: se eligen empresas (tipo check) y genera un PDF con
  // Máquina, Serial/Placa, Inspector asignado, Horas trabajadas, Horas paradas/avería
  // y la avería/motivo. El reporte hace sus propias consultas (ver porEmpresaReport).
  const [empresaPickerOpen, setEmpresaPickerOpen] = useState(false);
  const [empresaSel, setEmpresaSel] = useState<Set<string>>(new Set());
  // El mismo selector de empresas sirve para dos reportes: 'dia' (del día por
  // empresa) y 'mant' (horas trabajadas totales · próximas a mantenimiento).
  const [reportMode, setReportMode] = useState<'dia' | 'mant'>('dia');
  const makeEmpresaReport = async () => {
    if (empresaSel.size === 0) return;
    setEmpresaPickerOpen(false);
    setPdfBusy(EMPRESA_KEY);
    try {
      await generateEmpresaDiaReport({ date: selDay, companyIds: [...empresaSel] });
    } finally {
      setPdfBusy(null);
    }
  };
  // Reporte de HORAS TRABAJADAS TOTALES + próximas a mantenimiento (regla 200/220/250
  // sobre horómetro − base). No es por día: suma todo el histórico. Sin empresas
  // seleccionadas = TODAS.
  const makeHorasMantReport = async () => {
    setEmpresaPickerOpen(false);
    setPdfBusy(HORAS_KEY);
    try {
      await generateMachineHoursReport({ companyIds: [...empresaSel] });
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
      // Antes no se pasaba el turno: el reporte mezclaba DÍA y NOCHE aunque el
      // switch ☀️/🌙 de arriba estuviera en uno solo — ahora respeta el turno
      // elegido, igual que el resto del panel.
      await generateSummaryReport({ date: selDay, shift });
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
    // Red de respaldo del cierre automático de jornadas: el disparador de
    // Supabase (pg_cron, cada 10 min) puede quedar sin correr en silencio por
    // un rato (pasó el 06/08/2026 — el cron estaba bien configurado pero su
    // historial de ejecuciones reales quedó vacío toda la tarde/noche, sin
    // ningún error visible). En vez de depender 100% de esa infraestructura
    // externa, cada vez que se abre este panel se llama TAMBIÉN a la misma
    // función de cierre (`auto_close_jornadas`, ya con todos sus candados:
    // solo cierra a las 7am/7pm exactas, nunca jornadas de +2 días) — así el
    // sistema se autocorrige solo con el uso normal, sin depender de que el
    // cron dispare a tiempo. Best-effort: si falla (función no existe, sin
    // permiso), no debe romper la carga del panel.
    supabase.rpc('auto_close_jornadas').then(() => {}, () => {});
    // Cubre los 14 días de la gráfica y, si el día elegido es más antiguo, también ese
    // (para que los KPIs del día no queden en 0 al navegar a una fecha vieja).
    const minDate = selDay < fromDate ? selDay : fromDate;
    const [roundsRows, maintRes, asg, machRows, allHoursRows] = await Promise.all([
      selectAllRows('machine_rounds', 'machinery_id, round_date, day_hours, night_hours, jornada_shift, jornada_start_at, recorded_by, horometro_inicial, horometro_final, machine:machinery_id(code)', (q) => q.gte('round_date', minDate)),
      supabase.from('maintenance_requests').select('machinery_id, material, notes, created_at, machine:machinery_id(code)').eq('status', 'pendiente'),
      listInspectorAssignments(),
      // Ficha del catálogo (placa, serial, ubicación, empresa, encargado, horómetro…) por máquina.
      selectAllRows('machinery', 'id, code, plate, serial, identifier, encargado, location, referencia, sector, zona, tipo, clasificacion, machinery_type, last_horometro, operational, active, company_id, company:company_id(name)'),
      // Histórico COMPLETO (todas las fechas) solo de horas, para "Horas reales totales".
      selectAllRows('machine_rounds', 'machinery_id, day_hours, night_hours'),
    ]);
    setRounds((roundsRows ?? []) as any);
    setMaint((maintRes.data ?? []) as any);
    setAssignments(((asg?.rows ?? []) as any[]).map((a) => ({ machinery_id: a.machinery_id, inspector_name: a.inspector_name ?? '—', shift: a.shift, code: a.code ?? '—' })));
    setMachList((machRows ?? []) as any);
    const allHoursMap: Record<string, number> = {};
    (allHoursRows ?? []).forEach((r: any) => {
      allHoursMap[r.machinery_id] = (allHoursMap[r.machinery_id] ?? 0) + (Number(r.day_hours) || 0) + (Number(r.night_hours) || 0);
    });
    setAllHoursByMachine(allHoursMap);
    // Litros surtidos por máquina en el día elegido (misma fuente que SupervisionScreen).
    loadFuelByMachine(selDay).then(setFuelDay).catch(() => setFuelDay({}));
    // Tramos trabajados del día (hora inicio/fin y horas por máquina).
    selectAllRows('machine_work_segments', 'machinery_id, started_at, ended_at, hours', (q) => q.eq('round_date', selDay))
      .then((rows) => {
        const map: Record<string, { minStart: number; maxEnd: number; sum: number }> = {};
        ((rows ?? []) as any[]).forEach((s) => {
          const st = s.started_at ? new Date(s.started_at).getTime() : NaN;
          const en = s.ended_at ? new Date(s.ended_at).getTime() : NaN;
          const cur = map[s.machinery_id] ?? { minStart: Infinity, maxEnd: -Infinity, sum: 0 };
          cur.sum += Number(s.hours) || 0;
          if (!isNaN(st)) cur.minStart = Math.min(cur.minStart, st);
          if (!isNaN(en)) cur.maxEnd = Math.max(cur.maxEnd, en);
          map[s.machinery_id] = cur;
        });
        setSegDay(map);
      })
      .catch(() => setSegDay({}));
    setLoading(false);
  }, [fromDate, selDay]);

  useEffect(() => { load(); }, [load]);
  // Incluye 'machinery': al inactivar/activar una máquina (operational/active) o cambiar
  // su ficha, el panel se refresca en vivo y la máquina inactiva sale (o entra) de los
  // conteos por inspector sin recargar a mano.
  useRealtimeRefresh(['machine_rounds', 'maintenance_requests', 'machine_inspectors', 'machinery'], load);

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
  const [bulkStatusFilter, setBulkStatusFilter] = useState<'all' | 'activa' | 'cerrada' | 'pendiente' | 'parada' | 'averia'>('all');
  // Excluir paradas/averiadas: sin esto, una máquina "parada" o "averiada" cuenta
  // como "Pendiente" (no está iniciada) y se mezcla con las que de verdad faltan
  // por asignar/iniciar. Pedido del cliente para poder filtrarlas aparte.
  const [bulkHideStopped, setBulkHideStopped] = useState(false);
  // Búsqueda propia del panel — por nombre de MÁQUINA (código) o de INSPECTOR
  // (grupo). Sin esto, con muchos inspectores/máquinas hay que scrollear todo
  // el panel para encontrar una fila puntual.
  const [bulkQuery, setBulkQuery] = useState('');
  // Motivo compartido para las acciones "Marcar Parada"/"Marcar Avería" en bloque
  // (se aplica igual a TODAS las máquinas seleccionadas en esa pasada).
  const [bulkMotivo, setBulkMotivo] = useState('');
  // Solo se puede gestionar el día de HOY (no días pasados): "Iniciar" fabricaría
  // una jornada retroactiva sin sentido, y "Pendiente" borraría horas de un corte
  // que ya podría estar cerrado/pagado.
  const bulkIsToday = selDay === caracasToday();
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
  const applyBulk = async (action: 'start' | 'pending' | 'close' | 'parada' | 'averia') => {
    if (bulkSel.size === 0 || bulkBusy || !bulkIsToday) return;
    if (action === 'averia' && !bulkMotivo.trim()) {
      Alert.alert('Falta el motivo', 'Escribe el motivo de la avería antes de marcarla (queda como registro en Mantenimiento).');
      return;
    }
    setBulkBusy(true);
    try {
      const items = [...bulkSel].map((k) => { const [id, sh] = k.split('::'); return { id, shift: sh as 'day' | 'night' }; });
      const uid = session?.user?.id ?? null;
      const codeOf = (id: string) => assignments.find((a) => a.machinery_id === id)?.code || '—';
      // Si es de turno NOCHE y la jornada abierta en realidad vive en la fila de
      // AYER (cruzó la medianoche), hay que operar sobre
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
      // ANTES: esta función hacía un `await` de red POR CADA máquina, uno detrás
      // de otro (secuencial) — con una selección grande (100+ máquinas, el caso
      // real de "marcar todas pendiente") eso son cientos de viajes de red uno
      // tras otro, podía tardar más de un minuto y CUALQUIER error a mitad de
      // camino cortaba el resto sin avisar nada claro. Ahora se arma UN solo
      // `upsert` con todas las filas de golpe (igual que ya hacía "Iniciar") —
      // mucho más rápido y con un solo punto de éxito/error para toda la tanda.
      const nowIso = new Date().toISOString();
      if (action === 'start') {
        const rows = items.map((it) => ({ machinery_id: it.id, round_date: roundDateFor(it.id, it.shift), round_no: 1, jornada_start_at: nowIso, jornada_shift: it.shift, status: 'operativa' }));
        const { error } = await supabase.from('machine_rounds').upsert(rows, { onConflict: 'machinery_id,round_date,round_no' });
        if (error) {
          Alert.alert('No se pudo iniciar', error.message);
          return;
        }
        // "🟢 Activar ahora" también debe SACAR a la máquina de Parada/Avería —
        // si no, queda con jornada iniciada pero sigue saliendo 🔴/🟡 en toda la
        // app (avería/parada pendiente le gana a "iniciada", ver `estadoDe` en
        // SupervisorScreen.tsx) y el botón parece no hacer nada. Mismo patrón
        // que `volverOperativa()` del teléfono: resuelve TODAS las solicitudes
        // pendientes de Mantenimiento de esas máquinas (parada + avería real).
        const ids = items.map((it) => it.id);
        const { error: mrErr } = await supabase
          .from('maintenance_requests')
          .update({ status: 'realizado', resolved_by: uid, resolved_at: nowIso })
          .in('machinery_id', ids)
          .eq('status', 'pendiente');
        await Promise.all(items.map((it) =>
          logAudit('JORNADA_INICIO', 'machinery', it.id, `${codeOf(it.id)} · inicio manual (panel supervisor) · ${it.shift === 'day' ? 'día' : 'noche'}`)
        ));
        Alert.alert('Listo', `${items.length} máquina(s) marcadas como iniciadas.${mrErr ? ' ⚠️ No se pudieron cerrar todas las averías/paradas pendientes.' : ''}`);
      } else if (action === 'pending') {
        // Corrección del cliente: esto NO es "Parada" (eso es exclusivo de
        // avería/algo físico que le pasa a la máquina, con su propio botón y
        // flujo). Esto es volver la máquina a "⏳ Pendiente por iniciar" — como
        // si nunca hubiera arrancado hoy — para ese turno puntual: borra sus
        // horas de ESE turno y, si la jornada abierta era de ese mismo turno,
        // la cierra sin acreditar horas (sin tocar el turno contrario si está
        // en curso). Las horas que ya tenía quedan a salvo en
        // machine_work_segments antes de ponerlas en 0 — nada desaparece sin
        // dejar rastro de quién lo hizo y cuánto había.
        const plan = items.map((it) => {
          const rd = roundDateFor(it.id, it.shift);
          const existing = rounds.find((r) => r.machinery_id === it.id && r.round_date === rd);
          const prevHours = Number((it.shift === 'day' ? existing?.day_hours : existing?.night_hours) ?? 0);
          const soltarInicio = !!(existing?.jornada_start_at && roundShift(existing) === it.shift);
          return { ...it, rd, prevHours, soltarInicio };
        });
        const rows = plan.map((p) => ({
          machinery_id: p.id,
          round_date: p.rd,
          round_no: 1,
          ...(p.shift === 'day' ? { day_hours: 0 } : { night_hours: 0 }),
          ...(p.soltarInicio ? { jornada_start_at: null } : {}),
        }));
        const { error: upErr } = await supabase.from('machine_rounds').upsert(rows, { onConflict: 'machinery_id,round_date,round_no' });
        if (upErr) {
          Alert.alert('No se pudo marcar Pendiente', upErr.message);
          return;
        }
        // Respaldo de horas previas (no se pierden solo por ponerlas en 0), en
        // un solo insert múltiple en vez de uno por máquina.
        const segRows = plan
          .filter((p) => p.prevHours > 0)
          .map((p) => {
            const endedAt = new Date();
            const startedAt = new Date(endedAt.getTime() - p.prevHours * 3600_000);
            return {
              machinery_id: p.id, round_date: p.rd, shift: p.shift,
              started_at: startedAt.toISOString(), ended_at: endedAt.toISOString(), hours: p.prevHours,
              source: 'ajuste_manual', recorded_by: uid,
              notes: 'Marcado como Pendiente desde el panel de Inspecciones (admin) — horas previas conservadas aquí.',
            };
          });
        if (segRows.length > 0) {
          const { error: segErr } = await supabase.from('machine_work_segments').insert(segRows);
          if (segErr) Alert.alert('Aviso', `Se marcaron Pendiente, pero no se pudo respaldar el historial de horas de todas: ${segErr.message}`);
        }
        await Promise.all(plan.map((p) =>
          logAudit('JORNADA_FIN', 'machinery', p.id, `${codeOf(p.id)} · marcado Pendiente (panel supervisor) · ${p.shift === 'day' ? 'día' : 'noche'}${p.prevHours > 0 ? ` · ${p.prevHours.toFixed(2)}h conservadas` : ''}`)
        ));
        Alert.alert('Listo', `${items.length} máquina(s) marcadas como pendientes.`);
      } else if (action === 'close') {
        // ✅ CERRAR AHORA: solo tiene efecto sobre las seleccionadas que SÍ tienen
        // la jornada de ESE turno abierta ahora mismo — mismo cálculo que el botón
        // "🏁 FINALIZAR JORNADA" del inspector (horas REALES inicio→ahora, no las
        // 12h fijas del auto-cierre de las 7pm). Las que no estén abiertas se
        // ignoran (no hay nada que cerrar) y se avisa cuántas se saltaron.
        const plan = items.map((it) => {
          const rd = roundDateFor(it.id, it.shift);
          const existing = rounds.find((r) => r.machinery_id === it.id && r.round_date === rd);
          const isOpenHere = !!(existing?.jornada_start_at && roundShift(existing) === it.shift);
          const horas = isOpenHere ? Math.max(0, Math.round(((Date.now() - new Date(existing!.jornada_start_at as string).getTime()) / 3600000) * 100) / 100) : 0;
          const prevHours = Number((it.shift === 'day' ? existing?.day_hours : existing?.night_hours) ?? 0);
          return { ...it, rd, existing, isOpenHere, horas, prevHours };
        });
        const toClose = plan.filter((p) => p.isOpenHere);
        if (toClose.length === 0) {
          Alert.alert('Nada que cerrar', 'Ninguna de las máquinas seleccionadas tiene una jornada abierta en ese turno ahora mismo.');
          return;
        }
        const rows = toClose.map((p) => ({
          machinery_id: p.id, round_date: p.rd, round_no: 1,
          [p.shift === 'day' ? 'day_hours' : 'night_hours']: Math.round((p.prevHours + p.horas) * 100) / 100,
          jornada_start_at: null, status: 'operativa',
        }));
        const { error: clErr } = await supabase.from('machine_rounds').upsert(rows, { onConflict: 'machinery_id,round_date,round_no' });
        if (clErr) { Alert.alert('No se pudo cerrar', clErr.message); return; }
        await supabase.from('machine_work_segments').insert(toClose.map((p) => ({
          machinery_id: p.id, round_date: p.rd, shift: p.shift,
          started_at: p.existing!.jornada_start_at, ended_at: nowIso, hours: p.horas,
          source: 'ajuste_manual', recorded_by: uid,
          notes: 'Cerrada desde el panel de Inspecciones (admin) — horas reales (inicio → ahora).',
        })));
        await Promise.all(toClose.map((p) =>
          logAudit('JORNADA_FIN', 'machinery', p.id, `${codeOf(p.id)} · cerrada manualmente (panel supervisor) · ${p.shift === 'day' ? 'día' : 'noche'} · ${p.horas.toFixed(2)}h`)
        ));
        const skipped = items.length - toClose.length;
        Alert.alert('Listo', `${toClose.length} máquina(s) cerradas.${skipped ? ` (${skipped} no tenían jornada abierta y se ignoraron.)` : ''}`);
      } else {
        // 🟡 PARADA / 🔴 AVERÍA en bloque: mismo patrón que el teléfono del
        // inspector (registrarParadaBase + marcarParadaAveria/marcarParadaNoTrabajo)
        // pero para varias máquinas de una vez. Primero BANCA las horas de la
        // jornada de ESE turno si estaba abierta (no se pierden), luego deja la
        // solicitud en Mantenimiento de Maquinaria con el motivo compartido.
        const plan = items.map((it) => {
          const rd = roundDateFor(it.id, it.shift);
          const existing = rounds.find((r) => r.machinery_id === it.id && r.round_date === rd);
          const isOpenHere = !!(existing?.jornada_start_at && roundShift(existing) === it.shift);
          const horas = isOpenHere ? Math.max(0, Math.round(((Date.now() - new Date(existing!.jornada_start_at as string).getTime()) / 3600000) * 100) / 100) : 0;
          const prevHours = Number((it.shift === 'day' ? existing?.day_hours : existing?.night_hours) ?? 0);
          return { ...it, rd, existing, isOpenHere, horas, prevHours };
        });
        const toBank = plan.filter((p) => p.isOpenHere);
        if (toBank.length > 0) {
          const rows = toBank.map((p) => ({
            machinery_id: p.id, round_date: p.rd, round_no: 1,
            [p.shift === 'day' ? 'day_hours' : 'night_hours']: Math.round((p.prevHours + p.horas) * 100) / 100,
            jornada_start_at: null, status: 'operativa',
          }));
          const { error: bankErr } = await supabase.from('machine_rounds').upsert(rows, { onConflict: 'machinery_id,round_date,round_no' });
          if (bankErr) { Alert.alert('No se pudo registrar', bankErr.message); return; }
          await supabase.from('machine_work_segments').insert(toBank.map((p) => ({
            machinery_id: p.id, round_date: p.rd, shift: p.shift,
            started_at: p.existing!.jornada_start_at, ended_at: nowIso, hours: p.horas,
            source: action === 'averia' ? 'parada_averia' : 'parada_no_trabajo', recorded_by: uid,
            notes: `Horas conservadas antes de marcar ${action === 'averia' ? 'avería' : 'parada'} desde el panel de Inspecciones (admin).`,
          })));
        }
        const motivo = bulkMotivo.trim() || (action === 'averia' ? 'Avería marcada desde el panel de Inspecciones (admin).' : 'NO TRABAJÓ LA MÁQUINA (marcado desde el panel de Inspecciones, admin).');
        const maintRows = plan.flatMap((p) => action === 'averia'
          ? [
              { machinery_id: p.id, material: 'otro', notes: motivo, status: 'pendiente', requested_by: uid },
              { machinery_id: p.id, material: 'MÁQUINA PARADA', notes: motivo, status: 'pendiente', requested_by: uid },
            ]
          : [{ machinery_id: p.id, material: 'MÁQUINA PARADA', notes: motivo, status: 'pendiente', requested_by: uid }]);
        const { error: mErr } = await supabase.from('maintenance_requests').insert(maintRows);
        if (mErr) { Alert.alert('Aviso', `Se conservaron las horas, pero no se pudo dejar la solicitud en Mantenimiento: ${mErr.message}`); return; }
        await Promise.all(plan.map((p) =>
          logAudit('PARADA', 'machinery', p.id, `${codeOf(p.id)} · ${action === 'averia' ? 'avería' : 'parada'} marcada (panel supervisor) · ${p.shift === 'day' ? 'día' : 'noche'} · ${motivo}`)
        ));
        Alert.alert('Listo', `${items.length} máquina(s) marcadas como ${action === 'averia' ? '🔴 averiadas' : '🟡 paradas'}.`);
      }
      setBulkSel(new Set());
      setBulkMotivo('');
      await load();
    } finally {
      setBulkBusy(false);
    }
  };

  // Máquinas inactivas/averiadas de CATÁLOGO (active=false u operational=false) — el
  // teléfono (visibleParaInspector) las OCULTA. Se excluyen de los conteos para que el
  // panel cuadre con lo que ve el inspector.
  const machInactiveSet = useMemo(() => {
    const s = new Set<string>();
    machList.forEach((m) => { if (m.active === false || m.operational === false) s.add(m.id); });
    return s;
  }, [machList]);

  // Conjuntos de estado para el DÍA + TURNO elegidos. TODO va SEPARADO por turno:
  //  - Iniciada/cerrada = trabajó/abrió jornada EN ESE turno (por horas del turno u
  //    hora de la jornada abierta). Una jornada CORRIDA cuenta en día Y noche (no se
  //    esconde nada), pero DÍA y NOCHE ya no dan lo mismo.
  //  - El universo son las máquinas ASIGNADAS a ese turno (activas) + las que
  //    trabajaron ese turno. Las inactivas/averiadas de catálogo que no trabajaron NO
  //    cuentan (igual que el teléfono) — salvo las averiadas, que van a su categoría.
  // Clasificación completa (avería/parada/activa-ahora/cerrada/pendiente) para UN
  // turno dado — extraída a función para poder calcularla para DÍA y NOCHE a la vez
  // (`daySetsByShift`, abajo) sin duplicar la lógica: el panel "Gestionar" necesita
  // clasificar filas de AMBOS turnos al mismo tiempo, y debe dar EXACTAMENTE el
  // mismo resultado que estas tarjetas de arriba — antes tenía su propio cálculo
  // paralelo (bulkAverSet/isParada/startedTodayByShift) que se desincronizaba del
  // real (ej.: no veía averías arrastradas de días anteriores, o nunca detectaba
  // "cerrada" porque su propio `started` ya contaba las cerradas-con-horas).
  const buildDaySets = useCallback((shiftArg: 'day' | 'night') => {
    const isToday = selDay === caracasToday();
    // Turno REAL de la ronda. Para una jornada ABIERTA con jornada_shift nulo, se
    // infiere por la HORA DE INICIO (Caracas: 7am–7pm día, resto noche) — así una
    // jornada de noche recién abierta no cae por defecto en "día" (bug: "aparece una
    // de día") ni se cuenta como "cerrada". Cerrada: por las horas registradas.
    // Turno de una jornada ABIERTA (jornada_shift nulo → se infiere por la hora inicio).
    const openShiftOf = (r: Round): 'day' | 'night' =>
      r.jornada_shift === 'night' ? 'night'
        : r.jornada_shift === 'day' ? 'day'
        : paradaShiftOf(r.jornada_start_at as string);
    // ¿La ronda tuvo actividad en ESTE turno? Una máquina "corrido" (12h día + N noche)
    // cuenta en AMBOS turnos: en DÍA por sus day_hours, en NOCHE por sus night_hours.
    // Por eso NO se clasifica la ronda en un único turno (bug: al ponerle 12h de día a
    // las corrido, desaparecían de NOCHE).
    const workedInShift = (r: Round, sh: 'day' | 'night'): boolean => {
      if (sh === 'day' && (Number(r.day_hours) || 0) > 0) return true;
      if (sh === 'night' && (Number(r.night_hours) || 0) > 0) return true;
      return !!r.jornada_start_at && openShiftOf(r) === sh; // jornada abierta de ese turno
    };
    const workedSet = new Set<string>();  // trabajó/abrió (jornada de ESTE turno)
    const openSet = new Set<string>();    // jornada de ESTE turno aún abierta
    const anyOpenSet = new Set<string>(); // CUALQUIER jornada abierta (sigue trabajando)
    rounds.forEach((r) => {
      if (r.round_date !== selDay) return;
      if (workedInShift(r, shiftArg)) workedSet.add(r.machinery_id);
      if (r.jornada_start_at) {
        anyOpenSet.add(r.machinery_id);
        if (openShiftOf(r) === shiftArg) openSet.add(r.machinery_id);
      }
    });
    // Rescate: jornada de NOCHE de AYER aún abierta (cruza medianoche) — solo turno NOCHE.
    if (isToday && shiftArg === 'night') {
      const y = new Date(selDay + 'T12:00:00-04:00'); y.setUTCDate(y.getUTCDate() - 1);
      const yesterdayIso = y.toISOString().slice(0, 10);
      rounds.forEach((r) => { if (r.round_date === yesterdayIso && r.jornada_shift === 'night' && r.jornada_start_at) { workedSet.add(r.machinery_id); openSet.add(r.machinery_id); anyOpenSet.add(r.machinery_id); } });
    }
    const dayStartMs = new Date(selDay + 'T00:00:00-04:00').getTime();
    // El turno NOCHE cruza la medianoche (19:00 → 07:00 del día siguiente): una
    // avería/parada marcada a las 2am, por ejemplo, tiene `created_at` del día
    // SIGUIENTE en el calendario pero por horario (paradaShiftOf) sigue siendo
    // del turno de noche de ESTE día. Antes el corte era siempre 23:59:59 de
    // `selDay`, así que esas marcas de madrugada quedaban FUERA — el turno
    // noche del panel/reporte no las mostraba aunque el PDF firmado (que ya
    // usa este mismo criterio, ver inspectorReport.ts nightEndBound) sí. Se
    // extiende el corte hasta las 7am del día siguiente SOLO para el turno noche.
    const nightNextDay = (() => { const d = new Date(selDay + 'T12:00:00-04:00'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
    const dayEndMs = shiftArg === 'night'
      ? new Date(`${nightNextDay}T07:00:00-04:00`).getTime()
      : new Date(selDay + 'T23:59:59.999-04:00').getTime();
    // Averías de ESTE turno. REGLA (confirmada 06-ago-2026): el estado avería/parada es
    // POR TURNO — pertenece al turno de la HORA en que se marcó (paradaShiftOf). Solo ese
    // turno la ve averiada; el OTRO turno ve la máquina como pendiente/iniciada. Arrastra
    // dentro de SU mismo turno hasta resolverla (si es de un día anterior, cuenta salvo
    // que la máquina haya trabajado ese turno).
    const averAll = new Set<string>();
    maint.forEach((m) => {
      if (m.material === 'MÁQUINA PARADA') return;
      const t = new Date(m.created_at).getTime();
      if (t > dayEndMs || paradaShiftOf(m.created_at) !== shiftArg) return;
      const arr = t < dayStartMs;
      if (arr ? !workedSet.has(m.machinery_id) : true) averAll.add(m.machinery_id);
    });
    // Paradas de ESTE turno (misma regla por-turno que las averías).
    const paradaAll = new Set<string>();
    maint.forEach((m) => {
      if (m.material !== 'MÁQUINA PARADA') return;
      const t = new Date(m.created_at).getTime();
      if (t > dayEndMs || averAll.has(m.machinery_id) || paradaShiftOf(m.created_at) !== shiftArg) return;
      const arr = t < dayStartMs;
      const applies = arr ? !workedSet.has(m.machinery_id) : true;
      if (applies) paradaAll.add(m.machinery_id);
    });
    const assignedShift = new Set(assignments.filter((a) => a.shift === shiftArg).map((a) => a.machinery_id));
    // MISMO criterio que el teléfono (visibleParaInspector): una máquina INACTIVA/averiada
    // solo cuenta si tiene una jornada ABIERTA ahora (anyOpenSet). Sin jornada abierta,
    // aunque tenga horas viejas, el teléfono la OCULTA → el admin no debe contarla (bug:
    // "los inspectores tienen menos máquinas, aquí salen de más").
    const visibleOk = (id: string) => !machInactiveSet.has(id) || anyOpenSet.has(id);
    // Universo del turno: asignadas al turno + las que trabajaron el turno, ambas filtradas
    // por el mismo criterio de visibilidad del teléfono.
    const universe = new Set<string>();
    assignedShift.forEach((id) => { if (visibleOk(id)) universe.add(id); });
    workedSet.forEach((id) => { if (visibleOk(id)) universe.add(id); });
    averAll.forEach((id) => { if ((assignedShift.has(id) || workedSet.has(id)) && visibleOk(id)) universe.add(id); });
    // Clasificación por prioridad (igual que el teléfono): avería > parada > iniciada > pendiente.
    const startedSet = new Set<string>();
    const paradaSet = new Set<string>();
    const averSet = new Set<string>();
    const closedSet = new Set<string>();
    const pendSet = new Set<string>();
    // activeNowSet: subconjunto de startedSet que SIGUE con la jornada abierta ahora
    // mismo (jornada_start_at no nulo) — a diferencia de startedSet (que también
    // incluye las ya cerradas con horas, usado por el desglose por inspector y la
    // eficiencia, donde SÍ debe seguir contando una máquina que ya terminó su
    // turno), esto es solo para la tarjeta "Activas ahora" de arriba, que debe caer
    // a 0 en cuanto el cierre automático de las 7am/7pm las cierra — así no se
    // queda pegada en el número del día entero y confunde con "hay que cerrarlas".
    //
    // IMPORTANTE: closedSet NO depende de `shiftEnded`. Antes (bug encontrado en
    // auditoría) una máquina que ya trabajó y cerró TEMPRANO (ej. de noche antes de
    // las 7am) no entraba ni en activeNowSet (no está abierta) ni en closedSet (el
    // turno seleccionado técnicamente no había terminado) — quedaba sin clasificar
    // en NINGUNA tarjeta de arriba, y `estadoOf` la mostraba "Pendiente" a pesar de
    // ya tener horas trabajadas. openSet ya tiene prioridad (si sigue abierta, entra
    // a activeNowSet primero), así que basta con "trabajó y no está abierta" para
    // contarla como cerrada — sin esperar a que termine el reloj del turno.
    const activeNowSet = new Set<string>();
    universe.forEach((id) => {
      if (averAll.has(id)) { averSet.add(id); return; }
      if (paradaAll.has(id)) { paradaSet.add(id); return; }
      if (workedSet.has(id)) {
        startedSet.add(id);
        if (openSet.has(id)) activeNowSet.add(id);
        else closedSet.add(id);
        return;
      }
      pendSet.add(id);
    });
    return { startedSet, paradaSet, averSet, assignedShift, closedSet, pendSet, anyOpenSet, activeNowSet };
  }, [rounds, selDay, maint, assignments, machInactiveSet]);
  // Ambos turnos calculados de una vez (misma fuente que `daySets`, sin drift) —
  // lo usa el panel "Gestionar" para clasificar filas de día Y de noche a la vez.
  const daySetsByShift = useMemo(
    () => ({ day: buildDaySets('day'), night: buildDaySets('night') }),
    [buildDaySets],
  );
  const daySets = useMemo(() => daySetsByShift[shift], [daySetsByShift, shift]);

  // TODAS las asignaciones (día + noche), agrupadas por inspector/supervisor, con
  // su turno y su ESTADO real. Si aparece asignada en ambos turnos, sale una fila
  // en cada uno (cada una con su propia casilla — no se mezclan al marcar).
  //
  // El estado de cada fila sale de `daySetsByShift[a.shift]` — LA MISMA fuente que
  // las tarjetas ✅ Activas ahora / 🏁 Cerradas / ⏳ Pendientes / 🟡 Paradas / 🔴
  // Averiadas de arriba y el desglose por inspector. Antes este panel tenía su
  // propio cálculo paralelo (bulkAverSet/isParada/startedTodayByShift) que se
  // desincronizaba del real: no veía averías arrastradas de días anteriores, y
  // nunca detectaba "cerrada" porque su propio "iniciada" ya contaba también las
  // cerradas-con-horas (roundStarted cuenta horas>0 como "iniciada"). Reusar
  // daySetsByShift elimina esa clase de bug de raíz — un solo cálculo, dos vistas.
  const bulkGroupsAll = useMemo(() => {
    type BulkEstado = 'activa' | 'cerrada' | 'pendiente' | 'parada' | 'averia';
    const byName = new Map<string, { name: string; items: { id: string; key: string; code: string; started: boolean; shift: 'day' | 'night'; stopped: boolean; estado: BulkEstado }[] }>();
    assignments.forEach((a) => {
      const ds = daySetsByShift[a.shift];
      // MISMO criterio de visibilidad que `buildDaySets` (visibleOk): una máquina
      // INACTIVA/averiada de catálogo solo entra si tiene una jornada abierta ahora
      // (anyOpenSet) — si no, el teléfono y el dashboard la ocultan, así que
      // Gestionar tampoco debe mostrarla como si estuviera "Pendiente" (estaría
      // mintiendo: puede seguir averiada/parada/cerrada, solo que oculta a propósito).
      if (machInactiveSet.has(a.machinery_id) && !ds.anyOpenSet.has(a.machinery_id)) return;
      const nm = a.inspector_name || '—';
      const e = byName.get(nm) ?? { name: nm, items: [] };
      const estado: BulkEstado =
        ds.averSet.has(a.machinery_id) ? 'averia'
        : ds.paradaSet.has(a.machinery_id) ? 'parada'
        : ds.activeNowSet.has(a.machinery_id) ? 'activa'
        : ds.closedSet.has(a.machinery_id) ? 'cerrada'
        : 'pendiente';
      const started = estado === 'activa';
      const stopped = estado === 'averia' || estado === 'parada';
      e.items.push({ id: a.machinery_id, key: `${a.machinery_id}::${a.shift}`, code: a.code || '—', started, shift: a.shift, stopped, estado });
      byName.set(nm, e);
    });
    return [...byName.values()]
      .map((g) => ({ ...g, items: g.items.sort((x, y) => cmpText(x.code, y.code) || x.shift.localeCompare(y.shift)) }))
      .sort((a, b) => cmpText(a.name, b.name));
  }, [assignments, daySetsByShift, machInactiveSet]);
  // Grupos ya filtrados por turno/estado/paradas-averiadas/búsqueda (lo que realmente se ve y se selecciona).
  const bulkGroups = useMemo(() => {
    const q = norm(bulkQuery.trim());
    return bulkGroupsAll
      .map((g) => {
        const nameMatches = !q || norm(g.name).includes(q);
        return {
          ...g,
          items: g.items.filter(
            (i) =>
              (bulkShiftFilter === 'all' || i.shift === bulkShiftFilter) &&
              (bulkStatusFilter === 'all' || i.estado === bulkStatusFilter) &&
              (!bulkHideStopped || !i.stopped) &&
              (nameMatches || norm(i.code).includes(q))
          ),
        };
      })
      .filter((g) => g.items.length > 0);
  }, [bulkGroupsAll, bulkShiftFilter, bulkStatusFilter, bulkHideStopped, bulkQuery]);
  const bulkAllKeys = useMemo(() => bulkGroups.flatMap((g) => g.items.map((i) => i.key)), [bulkGroups]);

  // KPIs del día (totales). "iniciadas" = ACTIVAS AHORA (jornada realmente abierta
  // en este momento), NO todas las que trabajaron hoy — eso ya lo cubre "cerradas".
  const top = useMemo(() => {
    const { activeNowSet, paradaSet, averSet, closedSet, pendSet } = daySets;
    return { iniciadas: activeNowSet.size, pendientes: pendSet.size, paradas: paradaSet.size, averiadas: averSet.size, cerradas: closedSet.size };
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
  // Empresas (id + nombre) que tienen máquinas — para el selector del "Reporte del
  // día por empresa" (tipo check). A→Z por nombre.
  const empresasList = useMemo(() => {
    const m = new Map<string, string>();
    machList.forEach((x: any) => { if (x.company_id) m.set(x.company_id, x.company?.name || 'Sin empresa'); });
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => cmpText(a.name, b.name));
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
    const map = new Map<string, { dayH: number; nightH: number; horoIni: number | null; horoFin: number | null; shift: 'day' | 'night'; openStartAt: string | null }>();
    rounds.forEach((r) => {
      if (r.round_date !== selDay) return;
      const cur = map.get(r.machinery_id) ?? { dayH: 0, nightH: 0, horoIni: null, horoFin: null, shift: roundShift(r), openStartAt: null };
      cur.dayH += Number(r.day_hours) || 0;
      cur.nightH += Number(r.night_hours) || 0;
      if (r.horometro_inicial != null) cur.horoIni = Number(r.horometro_inicial);
      if (r.horometro_final != null) cur.horoFin = Number(r.horometro_final);
      cur.shift = roundShift(r);
      // Jornada TODAVÍA abierta (sin finalizar): sus horas reales de HOY no están
      // bancadas aún en day_hours/night_hours — se suman aparte, en vivo, abajo.
      if ((r as any).jornada_start_at) cur.openStartAt = (r as any).jornada_start_at;
      map.set(r.machinery_id, cur);
    });
    return map;
  }, [rounds, selDay]);

  // Horas REALES trabajadas de una máquina en selDay: lo ya bancado (day_hours +
  // night_hours) MÁS, si su jornada sigue abierta y selDay es HOY, lo transcurrido
  // desde que arrancó (en vivo, hasta el momento de mirar el panel) — así una
  // jornada que sigue en curso no cuenta como "0 horas" hasta que la finalicen.
  const liveHorasOf = useCallback((id: string): number => {
    const rd = roundDetail.get(id);
    if (!rd) return 0;
    let total = rd.dayH + rd.nightH;
    if (selDay === caracasToday() && rd.openStartAt) {
      total += Math.max(0, (Date.now() - new Date(rd.openStartAt).getTime()) / 3600000);
    }
    return total;
  }, [roundDetail, selDay]);

  // Estado (iniciada/cerrada/averiada/parada/pendiente) de una máquina en selDay+turno.
  // Misma prioridad que el teléfono (segmentoDe) y el desglose por inspector:
  // avería > parada > iniciada/cerrada > pendiente (una máquina averiada/parada no
  // cuenta como iniciada aunque haya arrancado jornada). "Iniciada" = jornada
  // TODAVÍA abierta ahora mismo; "cerrada" = ya trabajó y finalizó — antes ambas
  // se mostraban como "Iniciada" en los detalles por máquina, lo que contradecía
  // la tarjeta "Activas ahora" de arriba (que sí distingue) apenas cerraban.
  const estadoOf = useCallback((id: string): Estado => {
    const { activeNowSet, closedSet, averSet, paradaSet } = daySets;
    return averSet.has(id) ? 'averiada' : paradaSet.has(id) ? 'parada' : activeNowSet.has(id) ? 'iniciada' : closedSet.has(id) ? 'cerrada' : 'pendiente';
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
    const { activeNowSet, paradaSet, averSet, closedSet, pendSet } = daySets;
    const s = (ids: Iterable<string>) => [...ids].sort(cmpId);
    return { ini: s(activeNowSet), pend: s(pendSet), par: s(paradaSet), ave: s(averSet), cer: s(closedSet) };
  }, [daySets, cmpId]);

  // Motivo (el "por qué") de la parada/avería por máquina, del más reciente PENDIENTE.
  // Parada → texto de las notas ('MÁQUINA PARADA'); avería → notas o, si no hay, el
  // material (aceite/repuesto/…). Se muestra en el detalle de la lista por estado.
  const motivoByMachine = useMemo(() => {
    const aver = new Map<string, { m: string; t: number }>();
    const par = new Map<string, { m: string; t: number }>();
    maint.forEach((x) => {
      const t = new Date(x.created_at).getTime();
      const notes = (x.notes && String(x.notes).trim()) || '';
      if (x.material === 'MÁQUINA PARADA') {
        const prev = par.get(x.machinery_id); if (!prev || t > prev.t) par.set(x.machinery_id, { m: notes, t });
      } else {
        const motivo = notes || (x.material ? String(x.material) : '');
        const prev = aver.get(x.machinery_id); if (!prev || t > prev.t) aver.set(x.machinery_id, { m: motivo, t });
      }
    });
    return { aver, par };
  }, [maint]);

  // Modal de horas por MÁQUINA (desglose individual) del inspector seleccionado —
  // se abre al tocar "Horas reales" o "Horas reales totales" (pedido del cliente:
  // poder ver equipo a equipo sus horas, con buscador y filtros). `sortBy` recuerda
  // cuál tarjeta se tocó, para ordenar por esa columna de horas por defecto.
  const [horasModal, setHorasModal] = useState<{ inspector: string; sortBy: 'dia' | 'total' } | null>(null);
  const [horasQ, setHorasQ] = useState('');
  const [horasEstadoFilter, setHorasEstadoFilter] = useState<'all' | Estado>('all');
  const openHorasModal = (insp: string, sortBy: 'dia' | 'total') => {
    setHorasQ(''); setHorasEstadoFilter('all');
    setHorasModal({ inspector: insp, sortBy });
  };

  // Modal de LISTA de máquinas de un estado (filtrable por TODAS sus características).
  const [listModal, setListModal] = useState<{ title: string; ids: string[] } | null>(null);
  const [listQ, setListQ] = useState('');
  const [listExpanded, setListExpanded] = useState<string | null>(null);
  const openList = (title: string, ids: string[]) => { setListQ(''); setListExpanded(null); setListModal({ title, ids }); };
  // Reloj que "tictaquea" cada 60s para que las horas EN VIVO (jornadas abiertas)
  // crezcan/actualicen solas en pantalla sin recargar (TOTAL y Transcurrido).
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNowTick(Date.now()), 60000); return () => clearInterval(t); }, []);
  // Filas enriquecidas del modal (código + estado + ficha + horas/litros del día).
  const listRows = useMemo(() => {
    if (!listModal) return [];
    return listModal.ids.map((id) => {
      const info = machineInfo.get(id) ?? null;
      const rd = roundDetail.get(id) ?? null;
      const fuel = fuelDay[id] ?? null;
      const inspector = inspectorByMachine.get(id) ?? null;
      // Hora de inicio / hora final del día (de los tramos trabajados). Si la jornada
      // sigue abierta (hoy), el inicio cae al arranque de la jornada y el fin queda
      // "En curso" (aún no cerró).
      const seg = segDay[id] ?? null;
      const openNow = selDay === caracasToday() && !!rd?.openStartAt;
      const horaIni = seg && seg.minStart !== Infinity ? horaCaracas(seg.minStart)
        : rd?.openStartAt ? horaCaracas(new Date(rd.openStartAt).getTime()) : '—';
      const horaFin = openNow ? 'En curso' : (seg && seg.maxEnd !== -Infinity ? horaCaracas(seg.maxEnd) : '—');
      // Transcurrido EN VIVO: mientras la jornada sigue ABIERTA, cuánto lleva corriendo
      // (ahora − inicio real). Tope 12h = duración del turno. Usa nowTick para tictaquear.
      const elapsedH = openNow && rd?.openStartAt ? Math.max(0, Math.min(12, (nowTick - new Date(rd.openStartAt).getTime()) / 3600000)) : null;
      // TOTAL solo del TURNO de la jornada (una máquina de NOCHE muestra sus horas de
      // noche, no las de día) + EN VIVO: si sigue abierta, suma lo transcurrido hasta ahora.
      const bankedShiftH = rd ? (rd.shift === 'night' ? rd.nightH : rd.shift === 'day' ? rd.dayH : rd.dayH + rd.nightH) : 0;
      const worked = Math.round((bankedShiftH + (elapsedH ?? 0)) * 100) / 100;
      return { id, code: info?.code ?? codeById.get(id) ?? '—', info, rd, fuel, worked, estado: estadoOf(id), inspector, horaIni, horaFin, elapsedH };
    });
  }, [listModal, machineInfo, roundDetail, fuelDay, segDay, selDay, codeById, estadoOf, inspectorByMachine, nowTick]);
  const listShown = useMemo(() => {
    const nq = norm(listQ.trim());
    if (!nq) return listRows;
    return listRows.filter((r) => {
      const i = r.info;
      return [r.code, i?.plate, i?.serial, i?.identifier, i?.company, i?.encargado, i?.location, i?.referencia, i?.sector, i?.zona, i?.tipo, i?.clasificacion, i?.machinery_type, r.inspector]
        .some((v) => norm(v).includes(nq));
    });
  }, [listRows, listQ]);

  // Inspector de DÍA y de NOCHE por máquina (de las asignaciones), para el buscador global.
  const inspByShift = useMemo(() => {
    const m = new Map<string, { day?: string; night?: string }>();
    assignments.forEach((a) => {
      const e = m.get(a.machinery_id) ?? {};
      if (a.shift === 'day') e.day = a.inspector_name || undefined;
      else if (a.shift === 'night') e.night = a.inspector_name || undefined;
      m.set(a.machinery_id, e);
    });
    return m;
  }, [assignments]);

  // BUSCADOR GLOBAL de máquinas: busca en TODAS las máquinas del catálogo por CUALQUIER
  // característica (código, placa, serial, identificador, empresa, encargado, ubicación,
  // edificio, sector, zona, tipo, clasificación) + el nombre del inspector (día/noche).
  // Devuelve la ficha con ESTADO, ambos INSPECTORES, HORAS y hora de inicio/fin.
  const machineSearchShown = useMemo(() => {
    const nq = norm(inspQ.trim());
    if (!nq) return [] as any[];
    const rows = Array.from(machineInfo.keys()).map((id) => {
      const info = machineInfo.get(id) ?? null;
      const rd = roundDetail.get(id) ?? null;
      const seg = segDay[id] ?? null;
      const openNow = selDay === caracasToday() && !!rd?.openStartAt;
      const horaIni = seg && seg.minStart !== Infinity ? horaCaracas(seg.minStart)
        : rd?.openStartAt ? horaCaracas(new Date(rd.openStartAt).getTime()) : '—';
      const horaFin = openNow ? 'En curso' : (seg && seg.maxEnd !== -Infinity ? horaCaracas(seg.maxEnd) : '—');
      const elapsedH = openNow && rd?.openStartAt ? Math.max(0, Math.min(12, (nowTick - new Date(rd.openStartAt).getTime()) / 3600000)) : null;
      // Horas del TURNO de la jornada (noche muestra noche) + EN VIVO si sigue abierta.
      const bankedShiftH = rd ? (rd.shift === 'night' ? rd.nightH : rd.shift === 'day' ? rd.dayH : rd.dayH + rd.nightH) : 0;
      const worked = Math.round((bankedShiftH + (elapsedH ?? 0)) * 100) / 100;
      const dn = inspByShift.get(id) ?? {};
      return { id, code: info?.code ?? codeById.get(id) ?? '—', info, worked, estado: estadoOf(id), dayInsp: dn.day ?? null, nightInsp: dn.night ?? null, horaIni, horaFin, openNow, elapsedH };
    });
    return rows.filter((r) => {
      const i = r.info;
      return [r.code, i?.plate, i?.serial, i?.identifier, i?.company, i?.encargado, i?.location, i?.referencia, i?.sector, i?.zona, i?.tipo, i?.clasificacion, i?.machinery_type, r.dayInsp, r.nightInsp]
        .some((v) => norm(v).includes(nq));
    }).sort((a, b) => cmpText(a.code, b.code)).slice(0, 50);
  }, [inspQ, machineInfo, roundDetail, segDay, selDay, codeById, estadoOf, inspByShift, nowTick]);

  // Desglose por INSPECTOR (asignaciones del turno como columna vertebral).
  const perInspector = useMemo(() => {
    const { startedSet, paradaSet, averSet, closedSet, anyOpenSet } = daySets;
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
      const visibleIds = [...e.ids].filter((id) => !machInactiveSet.has(id) || anyOpenSet.has(id));
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
      // Horas REALES del turno: suma de lo trabajado (bancado + en vivo si sigue
      // en curso) en TODAS sus máquinas visibles, no solo las "iniciadas" — una
      // parada a mitad de jornada también dejó horas bancadas antes de parar.
      const horas = Math.round(visibleIds.reduce((sum, id) => sum + liveHorasOf(id), 0) * 10) / 10;
      // Horas TOTALES (histórico completo, no solo selDay): suma de allHoursByMachine
      // en las mismas máquinas visibles — acumulado de todas las rondas alguna vez
      // registradas, no limitado a los 14 días de `rounds`.
      const horasTotales = Math.round(visibleIds.reduce((sum, id) => sum + (allHoursByMachine[id] ?? 0), 0) * 10) / 10;
      // CERRADAS del inspector: de sus iniciadas, las que ya finalizaron (en closedSet).
      const cer = ini.filter((id) => closedSet.has(id));
      return { name: e.name, ini: s(ini), pend: s(pend), par: s(par), ave: s(ave), cer: s(cer), total: visibleIds.length, eficiencia, isFaltantes, horas, horasTotales };
    }).sort((a, b) => b.ini.length - a.ini.length || cmpText(a.name, b.name));
  }, [assignments, shift, daySets, machInactiveSet, liveHorasOf, allHoursByMachine]);

  // Filas del modal de horas por máquina: TODAS las máquinas visibles del inspector
  // abierto (las mismas que suman "Horas reales"/"Horas reales totales"), con su
  // estado ya resuelto por el arreglo (ini/pend/par/ave) al que pertenecen —así no
  // se recalcula con estadoOf y queda garantizado que coincide 1:1 con esas tarjetas.
  const horasRows = useMemo(() => {
    if (!horasModal) return [];
    const s = perInspector.find((i) => i.name === horasModal.inspector);
    if (!s) return [];
    // s.ini trae TODAS las que trabajaron (abiertas + ya cerradas, ver perInspector);
    // s.cer es el subconjunto que ya cerró. Acá sí se separan para que el detalle por
    // máquina diga "Cerrada" y no "Iniciada" en cuanto termina — igual que la tarjeta
    // "Activas ahora" de arriba.
    const cerSet = new Set(s.cer);
    const withEstado: { id: string; estado: Estado }[] = [
      ...s.ave.map((id) => ({ id, estado: 'averiada' as Estado })),
      ...s.par.map((id) => ({ id, estado: 'parada' as Estado })),
      ...s.cer.map((id) => ({ id, estado: 'cerrada' as Estado })),
      ...s.ini.filter((id) => !cerSet.has(id)).map((id) => ({ id, estado: 'iniciada' as Estado })),
      ...s.pend.map((id) => ({ id, estado: 'pendiente' as Estado })),
    ];
    return withEstado.map(({ id, estado }) => {
      const info = machineInfo.get(id) ?? null;
      return {
        id, estado, info,
        code: info?.code ?? codeById.get(id) ?? '—',
        horasDia: Math.round(liveHorasOf(id) * 10) / 10,
        horasTotal: Math.round((allHoursByMachine[id] ?? 0) * 10) / 10,
      };
    });
  }, [horasModal, perInspector, machineInfo, codeById, liveHorasOf, allHoursByMachine]);
  // Filtrado (buscador + chip de estado) y orden por mayor cantidad de horas (día o
  // total, según la tarjeta que se tocó para abrir el modal).
  const horasShown = useMemo(() => {
    const nq = norm(horasQ.trim());
    let rows = horasRows.filter((r) => horasEstadoFilter === 'all' || r.estado === horasEstadoFilter);
    if (nq) rows = rows.filter((r) => [r.code, r.info?.plate, r.info?.serial, r.info?.identifier].some((v) => norm(v).includes(nq)));
    const byTotal = horasModal?.sortBy === 'total';
    return [...rows].sort((a, b) => (byTotal ? b.horasTotal - a.horasTotal : b.horasDia - a.horasDia) || cmpText(a.code, b.code));
  }, [horasRows, horasQ, horasEstadoFilter, horasModal]);

  const inspShown = useMemo(() => {
    const nq = norm(inspQ.trim());
    // El cajón MAQUINAS FALTANTES NO es un inspector real: no va como barra propia.
    // Sus máquinas se muestran como "MÁQUINAS POR ASIGNAR" (pendiente por asignar),
    // una sola fuente — así no aparece un pseudo-inspector con 100% que descuadra.
    const base = perInspector.filter((i) => !i.isFaltantes);
    return nq ? base.filter((i) => norm(i.name).includes(nq)) : base;
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
  // Buscador de "máquinas por asignar": filtra por TODAS las características posibles
  // (código, placa, serial, identificador, empresa, encargado, ubicación/referencia/
  // sector/zona, tipo y clasificación). Sin texto → todas.
  const faltantesShown = useMemo(() => {
    const nq = norm(faltantesQ.trim());
    if (!nq) return faltantesIds;
    return faltantesIds.filter((id) => {
      const i = machineInfo.get(id);
      return [codeById.get(id), i?.plate, i?.serial, i?.identifier, i?.company, i?.encargado, i?.location, i?.referencia, i?.sector, i?.zona, i?.tipo, i?.clasificacion, i?.machinery_type]
        .some((v) => norm(v).includes(nq));
    });
  }, [faltantesIds, faltantesQ, machineInfo, codeById]);

  const shiftIcon = shift === 'day' ? '☀️' : '🌙';
  const shiftLbl = shift === 'day' ? 'DÍA' : 'NOCHE';

  // Color de la eficiencia: verde 100%, ámbar 50-99%, rojo <50% (mismo criterio que el PDF).
  const efiColor = (e: number | null): string => (e === null ? colors.muted : e >= 100 ? colors.success : e >= 50 ? colors.warning : colors.danger);

  const KpiCard = ({ label, value, tone, onPress }: { label: string; value: number | string; tone: 'brand' | 'muted' | 'warn' | 'crit'; onPress?: () => void }) => {
    const map = {
      brand: { fg: colors.brandText, bg: colors.surface },
      muted: { fg: colors.muted, bg: colors.surfaceAlt },
      warn: { fg: colors.accentSoftText, bg: colors.accentSoftBg },
      crit: { fg: colors.dangerSoftText, bg: colors.dangerSoftBg },
    } as const;
    const t = map[tone];
    const Comp: any = onPress ? TouchableOpacity : View;
    return (
      <Comp onPress={onPress} activeOpacity={0.7} style={{ flexGrow: 1, flexBasis: 84, minWidth: 84, backgroundColor: t.bg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
        <Text style={{ color: t.fg, fontWeight: '900', fontSize: 20, fontVariant: ['tabular-nums'] as any }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{value}</Text>
        <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700', textAlign: 'center', marginTop: 2 }} numberOfLines={2}>{label}{onPress ? ' ›' : ''}</Text>
      </Comp>
    );
  };
  // Etiqueta + color del estado para el pill del modal.
  const estadoMeta = (e: Estado): { label: string; fg: string; bg: string } => {
    switch (e) {
      case 'iniciada': return { label: '✅ Iniciada', fg: colors.brandText, bg: colors.surfaceAlt };
      case 'cerrada': return { label: '🏁 Cerrada', fg: colors.text, bg: colors.surfaceAlt };
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
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            <KpiCard label={`Activas ahora ${shiftIcon} (${shortDate(selDay)})`} value={top.iniciadas} tone="brand" onPress={() => openList(`✅ Activas ahora (jornada abierta) · ${shortDate(selDay)} ${shiftIcon}`, topIds.ini)} />
            <KpiCard label="Cerradas (finalizadas)" value={top.cerradas} tone="brand" onPress={() => openList(`🏁 Cerradas / finalizadas · ${shortDate(selDay)} ${shiftIcon}`, topIds.cer)} />
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
              { label: '✅ Activas ahora', value: top.iniciadas, color: colors.tankFill, ids: topIds.ini, title: `✅ Activas ahora (jornada abierta) · ${shortDate(selDay)} ${shiftIcon}` },
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

          {/* Reportes principales, LADO A LADO (antes aquí estaban "Por asignar/iniciar"
              y "Gestionar", que se quitaron a pedido). */}
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            {/* Reporte del DÍA por EMPRESA: abre el selector de empresas (tipo check). */}
            <TouchableOpacity onPress={() => { setReportMode('dia'); setEmpresaPickerOpen(true); }} disabled={pdfBusy !== null} activeOpacity={0.85} style={{ flex: 1, backgroundColor: colors.brandText, borderRadius: radius.md, paddingVertical: 11, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center', opacity: pdfBusy !== null ? 0.6 : 1 }}>
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12, textAlign: 'center' }}>{pdfBusy === EMPRESA_KEY ? 'Generando…' : '📊 Reporte del día por empresa'}</Text>
            </TouchableOpacity>
            {/* Reporte HORAS TRABAJADAS (totales) · PRÓXIMAS A MANTENIMIENTO — mismo
                selector de empresas; sin selección = todas. Regla 200/220/250. */}
            <TouchableOpacity onPress={() => { setReportMode('mant'); setEmpresaPickerOpen(true); }} disabled={pdfBusy !== null} activeOpacity={0.85} style={{ flex: 1, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: 11, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center', opacity: pdfBusy !== null ? 0.6 : 1 }}>
              <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 12, textAlign: 'center' }}>{pdfBusy === HORAS_KEY ? 'Generando…' : '🛠️ Horas de horómetro · mantenimiento (250 h)'}</Text>
            </TouchableOpacity>
          </View>

          {/* Selector de EMPRESAS (tipo check) para el reporte del día. */}
          <Modal visible={empresaPickerOpen} transparent animationType="slide" onRequestClose={() => setEmpresaPickerOpen(false)}>
            <Pressable onPress={() => setEmpresaPickerOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
              <Pressable onPress={() => {}} style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '82%', padding: spacing.lg }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
                  <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15, flex: 1 }} numberOfLines={2}>{reportMode === 'mant' ? '🛠️ Horas de horómetro · próximas a mantenimiento' : `📊 Reporte del día por empresa · ${shortDate(selDay)}`}</Text>
                  <TouchableOpacity onPress={() => setEmpresaPickerOpen(false)} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}>
                    <Text style={{ color: colors.text, fontWeight: '800' }}>Cerrar ✕</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm }}>
                  <TouchableOpacity onPress={() => setEmpresaSel(new Set(empresasList.map((e) => e.id)))}><Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12.5 }}>✓ Todas ({empresasList.length})</Text></TouchableOpacity>
                  {empresaSel.size > 0 ? <TouchableOpacity onPress={() => setEmpresaSel(new Set())}><Text style={{ color: colors.muted, fontWeight: '800', fontSize: 12.5 }}>✕ Ninguna</Text></TouchableOpacity> : null}
                </View>
                <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
                  {empresasList.length === 0 ? (
                    <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center', paddingVertical: spacing.lg }}>Sin empresas.</Text>
                  ) : empresasList.map((e) => {
                    const on = empresaSel.has(e.id);
                    return (
                      <TouchableOpacity key={e.id} onPress={() => setEmpresaSel((p) => { const s = new Set(p); s.has(e.id) ? s.delete(e.id) : s.add(e.id); return s; })} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                        <View style={{ width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                          {on ? <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 13 }}>✓</Text> : null}
                        </View>
                        <Text style={{ color: colors.text, fontSize: 14, flex: 1 }} numberOfLines={1}>🏢 {e.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                {reportMode === 'mant' ? (
                  <>
                    <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: spacing.sm, textAlign: 'center' }}>Sin selección = todas las empresas. Regla: 🟡 200 h · 🟠 220 h · 🔴 250 h (límite).</Text>
                    <TouchableOpacity onPress={makeHorasMantReport} activeOpacity={0.85} style={{ marginTop: spacing.sm, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center' }}>
                      <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 13.5 }}>📄 Generar ({empresaSel.size === 0 ? 'todas' : empresaSel.size})</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <TouchableOpacity onPress={makeEmpresaReport} disabled={empresaSel.size === 0} activeOpacity={0.85} style={{ marginTop: spacing.md, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center', opacity: empresaSel.size === 0 ? 0.5 : 1 }}>
                    <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 13.5 }}>📄 Generar reporte ({empresaSel.size})</Text>
                  </TouchableOpacity>
                )}
              </Pressable>
            </Pressable>
          </Modal>

          {/* Panel "Gestionar Iniciada/Pendiente por supervisor" (expandible) — SOLO
              visible para las cuentas en BULK_TOGGLE o quien se sume desde Ajustes. */}
          {bulkAllowed && bulkOpen ? (
                <View style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
                  {!bulkIsToday ? (
                    <Text style={{ color: colors.dangerSoftText, fontSize: 12, marginBottom: spacing.sm }}>
                      Solo se puede gestionar el día de HOY ({shortDate(caracasToday())}) — volvé al día actual con ▶ arriba para usar este panel.
                    </Text>
                  ) : null}
                  {/* Búsqueda propia del panel: por nombre de MÁQUINA o de INSPECTOR. */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, marginBottom: spacing.sm }}>
                    <Text style={{ fontSize: 13 }}>🔎</Text>
                    <TextInput value={bulkQuery} onChangeText={setBulkQuery} placeholder="Buscar máquina o inspector…" placeholderTextColor={colors.muted} style={{ flex: 1, color: colors.text, fontSize: 12.5, paddingVertical: 7 }} />
                    {bulkQuery ? <TouchableOpacity onPress={() => setBulkQuery('')}><Text style={{ color: colors.muted, fontWeight: '800' }}>✕</Text></TouchableOpacity> : null}
                  </View>
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
                  {/* Filtro de ESTADO — los 5 estados reales de la máquina hoy en ese turno. */}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.sm }}>
                    {([['all', 'Todas'], ['activa', '✅ Activas'], ['cerrada', '🏁 Cerradas'], ['pendiente', '⏳ Pendientes'], ['parada', '🟡 Paradas'], ['averia', '🔴 Averiadas']] as const).map(([v, lbl]) => {
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
                                  <Text style={{ color: it.estado === 'activa' ? colors.success : it.estado === 'cerrada' ? colors.brandText : it.estado === 'averia' ? colors.danger : it.estado === 'parada' ? colors.warning : colors.muted, fontWeight: '700', fontSize: 11 }}>
                                    {it.estado === 'activa' ? '✅ Activa' : it.estado === 'cerrada' ? '🏁 Cerrada' : it.estado === 'averia' ? '🔴 Avería' : it.estado === 'parada' ? '🟡 Parada' : '⏳ Pendiente'}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        );
                      })}
                    </ScrollView>
                  )}

                  {/* Motivo compartido — solo hace falta para Parada/Avería (obligatorio en
                      Avería, opcional en Parada: sin texto usa "NO TRABAJÓ LA MÁQUINA"). */}
                  <TextInput
                    value={bulkMotivo}
                    onChangeText={setBulkMotivo}
                    placeholder="Motivo (para Parada / Avería en bloque)…"
                    placeholderTextColor={colors.muted}
                    style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 8, color: colors.text, fontSize: 12.5, marginTop: spacing.xs, marginBottom: spacing.sm }}
                  />
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
                    <TouchableOpacity onPress={() => applyBulk('start')} disabled={bulkSel.size === 0 || bulkBusy || !bulkIsToday} activeOpacity={0.85} style={{ flex: 1, backgroundColor: colors.success, borderRadius: radius.md, paddingVertical: 10, alignItems: 'center', opacity: bulkSel.size === 0 || bulkBusy || !bulkIsToday ? 0.5 : 1 }}>
                      <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12 }}>{bulkBusy ? 'Guardando…' : `🟢 Activar ahora (${bulkSel.size})`}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => applyBulk('close')} disabled={bulkSel.size === 0 || bulkBusy || !bulkIsToday} activeOpacity={0.85} style={{ flex: 1, backgroundColor: colors.brandText, borderRadius: radius.md, paddingVertical: 10, alignItems: 'center', opacity: bulkSel.size === 0 || bulkBusy || !bulkIsToday ? 0.5 : 1 }}>
                      <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12 }}>{bulkBusy ? 'Guardando…' : `🏁 Cerrar / Finalizar (${bulkSel.size})`}</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                    <TouchableOpacity onPress={() => applyBulk('pending')} disabled={bulkSel.size === 0 || bulkBusy || !bulkIsToday} activeOpacity={0.85} style={{ flex: 1, backgroundColor: colors.muted, borderRadius: radius.md, paddingVertical: 10, alignItems: 'center', opacity: bulkSel.size === 0 || bulkBusy || !bulkIsToday ? 0.5 : 1 }}>
                      <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12 }}>{bulkBusy ? 'Guardando…' : `⏳ Pendiente (${bulkSel.size})`}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => applyBulk('parada')} disabled={bulkSel.size === 0 || bulkBusy || !bulkIsToday} activeOpacity={0.85} style={{ flex: 1, backgroundColor: colors.warning, borderRadius: radius.md, paddingVertical: 10, alignItems: 'center', opacity: bulkSel.size === 0 || bulkBusy || !bulkIsToday ? 0.5 : 1 }}>
                      <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12 }}>{bulkBusy ? 'Guardando…' : `🟡 Parada (${bulkSel.size})`}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => applyBulk('averia')} disabled={bulkSel.size === 0 || bulkBusy || !bulkIsToday} activeOpacity={0.85} style={{ flex: 1, backgroundColor: colors.danger, borderRadius: radius.md, paddingVertical: 10, alignItems: 'center', opacity: bulkSel.size === 0 || bulkBusy || !bulkIsToday ? 0.5 : 1 }}>
                      <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12 }}>{bulkBusy ? 'Guardando…' : `🔴 Avería (${bulkSel.size})`}</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 10.5, marginTop: spacing.xs }}>
                    Activas ahora / Cerradas / Pendiente ya cubren esos 3 estados; Parada y Avería quedan también registradas en Mantenimiento de Maquinaria con el motivo de arriba.
                  </Text>
                </View>
              ) : null}

          {/* Barras VERTICALES por inspector (del turno). Tocar → detalle. */}
          <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 13, marginTop: spacing.md, marginBottom: spacing.xs, letterSpacing: 0.3, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
            👷 POR INSPECTOR · {shortDate(selDay)} · {shiftIcon} {shiftLbl}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, marginBottom: spacing.sm }}>
            <Text style={{ fontSize: 14 }}>🔎</Text>
            <TextInput value={inspQ} onChangeText={setInspQ} placeholder="Buscar: inspector, máquina, placa, serial, empresa, edificio…" placeholderTextColor={colors.muted} style={{ flex: 1, color: colors.text, fontSize: 13, paddingVertical: 8 }} />
            {inspQ ? <TouchableOpacity onPress={() => setInspQ('')}><Text style={{ color: colors.muted, fontWeight: '800' }}>✕</Text></TouchableOpacity> : null}
          </View>

          {/* BUSCADOR GLOBAL: al escribir, muestra las máquinas que coinciden (por CUALQUIER
              característica) con su ESTADO, ambos INSPECTORES (día/noche) y las HORAS. */}
          {inspQ.trim() ? (
            <View style={{ marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' }}>
              <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 11.5, padding: spacing.sm, backgroundColor: colors.background }}>
                🔎 {machineSearchShown.length} máquina(s) encontrada(s)
              </Text>
              {machineSearchShown.length === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 12.5, padding: spacing.sm, textAlign: 'center' }}>Sin coincidencias.</Text>
              ) : (
                <ScrollView style={{ maxHeight: 340 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  {machineSearchShown.map((r, i) => {
                    const em = estadoMeta(r.estado);
                    const motivo = r.estado === 'averiada' ? (motivoByMachine.aver.get(r.id)?.m || '') : r.estado === 'parada' ? (motivoByMachine.par.get(r.id)?.m || '') : '';
                    const info = r.info;
                    const ubic = info?.referencia || info?.location || info?.sector || null;
                    return (
                      <View key={r.id} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border, padding: spacing.sm, gap: 2 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' }}>
                          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13.5 }}>{r.code}</Text>
                          <View style={{ backgroundColor: em.bg, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
                            <Text style={{ color: em.fg, fontSize: 10, fontWeight: '900' }}>{em.label}</Text>
                          </View>
                        </View>
                        {motivo ? (
                          <Text style={{ color: r.estado === 'averiada' ? colors.dangerSoftText : colors.accentSoftText, fontSize: 11, fontWeight: '700' }} numberOfLines={2}>
                            {r.estado === 'averiada' ? '🔧 ' : '🟡 '}{motivo}
                          </Text>
                        ) : null}
                        <Text style={{ color: colors.muted, fontSize: 11 }} numberOfLines={1}>
                          {[info?.company, info?.plate ? `🚗 ${info.plate}` : null, info?.serial ? `#️⃣ ${info.serial}` : null, ubic ? `📍 ${ubic}` : null].filter(Boolean).join(' · ') || '—'}
                        </Text>
                        {info?.encargado ? (
                          <Text style={{ fontSize: 11 }} numberOfLines={1}>
                            <Text style={{ color: colors.muted }}>👤 Encargado </Text><Text style={{ color: colors.text, fontWeight: '700' }}>{info.encargado}</Text>
                          </Text>
                        ) : null}
                        <Text style={{ fontSize: 11 }} numberOfLines={1}>
                          <Text style={{ color: colors.muted }}>☀️ </Text><Text style={{ color: r.dayInsp ? colors.text : colors.muted, fontWeight: r.dayInsp ? '700' : '400' }}>{r.dayInsp || 'sin inspector'}</Text>
                          <Text style={{ color: colors.muted }}>    🌙 </Text><Text style={{ color: r.nightInsp ? colors.text : colors.muted, fontWeight: r.nightInsp ? '700' : '400' }}>{r.nightInsp || 'sin inspector'}</Text>
                        </Text>
                        <Text style={{ fontSize: 11, fontVariant: ['tabular-nums'] as any }}>
                          <Text style={{ color: colors.muted }}>🕐 Inicio </Text><Text style={{ color: colors.success, fontWeight: '800' }}>{r.horaIni}</Text>
                          <Text style={{ color: colors.muted }}>  →  Fin </Text><Text style={{ color: colors.success, fontWeight: '800' }}>{r.horaFin}</Text>
                          <Text style={{ color: colors.muted }}>  ·  ⏱️ Total </Text><Text style={{ color: colors.success, fontWeight: '800' }}>{Math.round(r.worked * 100) / 100} h</Text>
                          {r.elapsedH != null ? (<>
                            <Text style={{ color: colors.muted }}>  ·  ⏳ Transcurrido </Text><Text style={{ color: colors.warning, fontWeight: '800' }}>{Math.round(r.elapsedH * 100) / 100} h</Text>
                          </>) : null}
                        </Text>
                      </View>
                    );
                  })}
                </ScrollView>
              )}
            </View>
          ) : null}

          {/* Reporte (PDF) de eficiencia de TODOS los inspectores del turno/día. */}
          <TouchableOpacity onPress={makeEficienciaReport} disabled={pdfBusy !== null} activeOpacity={0.85} style={{ marginBottom: spacing.sm, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 11, alignItems: 'center', opacity: pdfBusy !== null ? 0.6 : 1 }}>
            <Text style={{ color: colors.accentContrast, fontWeight: '900', fontSize: 12.5 }}>{pdfBusy === EFICIENCIA_KEY ? 'Generando…' : '📄 Reporte de eficiencia (todos los inspectores)'}</Text>
          </TouchableOpacity>

          {inspShown.length === 0 ? (
            inspQ.trim() ? null : <Text style={{ color: colors.muted, fontSize: 12.5, paddingVertical: spacing.md, textAlign: 'center' }}>Sin inspectores {shiftIcon} para el {shortDate(selDay)}.</Text>
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
                  {/* Buscador: filtra por código, placa, serial, empresa, encargado, ubicación, tipo… */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, marginBottom: spacing.xs }}>
                    <Text style={{ fontSize: 14 }}>🔎</Text>
                    <TextInput
                      value={faltantesQ}
                      onChangeText={setFaltantesQ}
                      placeholder="Buscar por código, placa, serial, empresa, encargado, ubicación…"
                      placeholderTextColor={colors.muted}
                      style={{ flex: 1, color: colors.text, fontSize: 13, paddingVertical: 8 }}
                    />
                    {faltantesQ ? (
                      <TouchableOpacity onPress={() => setFaltantesQ('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={{ color: colors.muted, fontWeight: '800', fontSize: 15 }}>✕</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  {faltantesQ ? (
                    <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>{faltantesShown.length} de {faltantesIds.length}</Text>
                  ) : null}
                  {faltantesShown.length === 0 ? (
                    <Text style={{ color: colors.muted, fontSize: 12, paddingVertical: spacing.sm, textAlign: 'center' }}>Sin resultados para “{faltantesQ}”.</Text>
                  ) : null}
                  {faltantesShown.map((id) => {
                    const code = codeById.get(id) ?? '—';
                    const info = machineInfo.get(id);
                    const ps = info?.plate || info?.serial || null;   // placa o, en su defecto, serial
                    const emp = info?.company || null;
                    const pickerOpen = assignPickerFor === id;
                    const busy = assignBusy === id;
                    return (
                      <View key={id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>{code}</Text>
                            {(ps || emp) ? (
                              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 1 }} numberOfLines={1}>
                                {[ps ? `🔖 ${ps}` : null, emp ? `🏢 ${emp}` : null].filter(Boolean).join('  ·  ')}
                              </Text>
                            ) : null}
                          </View>
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
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <KpiCard label="Iniciadas" value={sel.ini.length} tone="brand" onPress={() => openList(`✅ Iniciadas · ${sel.name}`, sel.ini)} />
                <KpiCard label="Cerradas" value={sel.cer.length} tone="brand" onPress={() => openList(`🏁 Cerradas / finalizadas · ${sel.name}`, sel.cer)} />
                <KpiCard label="Pendientes" value={sel.pend.length} tone="muted" onPress={() => openList(`⏳ Pendientes · ${sel.name}`, sel.pend)} />
                <KpiCard label="Paradas" value={sel.par.length} tone="warn" onPress={() => openList(`🟡 Paradas · ${sel.name}`, sel.par)} />
                <KpiCard label="Averiadas" value={sel.ave.length} tone="crit" onPress={() => openList(`🔴 Averiadas · ${sel.name}`, sel.ave)} />
                <KpiCard label="Eficiencia" value={sel.eficiencia ?? 0} tone={sel.eficiencia === 100 ? 'brand' : sel.eficiencia != null && sel.eficiencia >= 50 ? 'warn' : 'crit'} />
                <KpiCard label="Horas reales" value={`${sel.horas.toFixed(1)}h`} tone="brand" onPress={() => openHorasModal(sel.name, 'dia')} />
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
                  const motivo = r.estado === 'averiada' ? (motivoByMachine.aver.get(r.id)?.m || '') : r.estado === 'parada' ? (motivoByMachine.par.get(r.id)?.m || '') : '';
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
                          {/* El PORQUÉ de la parada/avería (de maintenance_requests.notes / material). */}
                          {motivo ? (
                            <Text style={{ color: r.estado === 'averiada' ? colors.dangerSoftText : colors.accentSoftText, fontSize: 11.5, fontWeight: '700', marginTop: 2 }} numberOfLines={open ? undefined : 2}>
                              {r.estado === 'averiada' ? '🔧 Motivo avería: ' : '🟡 Motivo parada: '}{motivo}
                            </Text>
                          ) : null}
                          <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 2 }} numberOfLines={open ? undefined : 1}>
                            {[info?.company, info?.plate ? `🚗 ${info.plate}` : null, info?.serial ? `#️⃣ ${info.serial}` : null, ubic ? `📍 ${ubic}` : null].filter(Boolean).join(' · ') || '—'}
                          </Text>
                          <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 1, fontVariant: ['tabular-nums'] as any }}>
                            ⛽ {litros}{lph != null ? ` · ${lph} L/h` : ''}  ·  🏁 {r.worked} h  ·  {turnoLbl}
                          </Text>
                          {/* Hora de inicio → fin y TOTAL en VERDE (de los tramos trabajados).
                              Si estuvo PARADA (amarillo) o AVERIADA (rojo), se muestra debajo. */}
                          {(Number(r.worked) > 0 || r.horaIni !== '—') ? (
                            <Text style={{ fontSize: 11.5, marginTop: 1, fontVariant: ['tabular-nums'] as any }}>
                              <Text style={{ color: colors.muted }}>🕐 Inicio </Text>
                              <Text style={{ color: colors.success, fontWeight: '800' }}>{r.horaIni}</Text>
                              <Text style={{ color: colors.muted }}>  →  Fin </Text>
                              <Text style={{ color: colors.success, fontWeight: '800' }}>{r.horaFin}</Text>
                              <Text style={{ color: colors.muted }}>  ·  ⏱️ Total </Text>
                              <Text style={{ color: colors.success, fontWeight: '800' }}>{r.worked} h</Text>
                              {r.elapsedH != null ? (<>
                                <Text style={{ color: colors.muted }}>  ·  ⏳ Transcurrido </Text>
                                <Text style={{ color: colors.warning, fontWeight: '800' }}>{Math.round(r.elapsedH * 100) / 100} h</Text>
                              </>) : null}
                            </Text>
                          ) : null}
                          {r.estado === 'parada' ? (
                            <Text style={{ color: colors.warning, fontSize: 11.5, marginTop: 1, fontWeight: '800' }}>🟡 Estuvo parada / no trabajó</Text>
                          ) : null}
                          {r.estado === 'averiada' ? (
                            <Text style={{ color: colors.danger, fontSize: 11.5, marginTop: 1, fontWeight: '800' }}>🔴 Averiada</Text>
                          ) : null}
                          {/* Encargado de la máquina (del catálogo: machinery.encargado). */}
                          {info?.encargado ? (
                            <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 1 }} numberOfLines={1}>
                              👷 Encargado: {info.encargado}
                            </Text>
                          ) : null}
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
                          {motivo ? detailRow(r.estado === 'averiada' ? 'Motivo avería' : 'Motivo parada', motivo) : null}
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
                          {detailRow('Hora de inicio', r.horaIni)}
                          {detailRow('Hora final', r.horaFin)}
                          {detailRow('Horas del día (día / noche)', r.rd ? `${r.rd.dayH} h / ${r.rd.nightH} h` : '—')}
                          {detailRow('Horas totales trabajadas', `${r.worked} h`)}
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

      {/* Desglose de HORAS por máquina del inspector (equipo a equipo), con buscador
          y chips de estado — se abre al tocar "Horas reales" o "Horas reales
          totales" en el panel de detalle de arriba. Mismo lenguaje visual que el
          modal de listado de arriba (Modal + Pressable de fondo, hoja deslizante). */}
      <Modal visible={horasModal != null} transparent animationType="slide" onRequestClose={() => setHorasModal(null)}>
        <Pressable onPress={() => setHorasModal(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '82%', padding: spacing.lg }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs, gap: spacing.sm }}>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15, flex: 1 }} numberOfLines={2}>
                🏁 Horas por máquina · {horasModal?.inspector} ({horasShown.length})
              </Text>
              <TouchableOpacity onPress={() => setHorasModal(null)} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>Cerrar ✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.sm }}>
              Ordenado por {horasModal?.sortBy === 'total' ? 'horas totales (histórico)' : 'horas de hoy'}, de mayor a menor.
            </Text>
            {/* Buscador: filtra por código, placa, serial o identificador de la máquina. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, marginBottom: spacing.sm }}>
              <Text style={{ fontSize: 14 }}>🔎</Text>
              <TextInput value={horasQ} onChangeText={setHorasQ} placeholder="Buscar por código, placa, serial…" placeholderTextColor={colors.muted} style={{ flex: 1, color: colors.text, fontSize: 14, paddingVertical: 9 }} />
              {horasQ ? <TouchableOpacity onPress={() => setHorasQ('')}><Text style={{ color: colors.muted, fontWeight: '800' }}>✕</Text></TouchableOpacity> : null}
            </View>
            {/* Chips de estado — mismo patrón visual que los filtros de turno/estado del panel "Gestionar Iniciada/Pendiente". */}
            <View style={{ flexDirection: 'row', gap: 6, marginBottom: spacing.sm, flexWrap: 'wrap' }}>
              {([['all', 'Todas'], ['iniciada', '✅ Iniciadas'], ['cerrada', '🏁 Cerradas'], ['parada', '🟡 Paradas'], ['averiada', '🔴 Averiadas'], ['pendiente', '⏳ Pendientes']] as const).map(([v, lbl]) => {
                const on = horasEstadoFilter === v;
                return (
                  <TouchableOpacity key={v} onPress={() => setHorasEstadoFilter(v)} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : 'transparent' }}>
                    <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 11.5 }}>{lbl}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
              {horasShown.length === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center', paddingVertical: spacing.lg }}>Sin máquinas para estos filtros.</Text>
              ) : (
                horasShown.map((r, i) => {
                  const em = estadoMeta(r.estado);
                  return (
                    <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border, paddingVertical: 10 }}>
                      <Text style={{ color: colors.muted, fontSize: 12, width: 26, textAlign: 'right', fontVariant: ['tabular-nums'] as any }}>{i + 1}</Text>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' }}>
                          <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800' }}>{r.code}</Text>
                          <View style={{ backgroundColor: em.bg, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
                            <Text style={{ color: em.fg, fontSize: 10, fontWeight: '900' }}>{em.label}</Text>
                          </View>
                        </View>
                        <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 2 }} numberOfLines={1}>
                          {[r.info?.plate ? `🚗 ${r.info.plate}` : null, r.info?.serial ? `#️⃣ ${r.info.serial}` : null].filter(Boolean).join(' · ') || '—'}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 13, fontVariant: ['tabular-nums'] as any }}>{r.horasDia.toFixed(1)}h</Text>
                        <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700' }}>hoy</Text>
                        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12, marginTop: 3, fontVariant: ['tabular-nums'] as any }}>{r.horasTotal.toFixed(1)}h</Text>
                        <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700' }}>total</Text>
                      </View>
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
