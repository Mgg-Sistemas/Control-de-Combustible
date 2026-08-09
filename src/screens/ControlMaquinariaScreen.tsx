import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Switch } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { supabase, selectAllRows } from '../lib/supabase';
import { nextRtInstanceId } from '../hooks/useRealtime';
import { exportPdf, pdfDocument, dateRangeLabel } from '../lib/pdf';
import { elapsedSince } from '../lib/time';
import { norm, onlyDecimal, onlyDigits, cmpText } from '../lib/text';
import { useConfirm } from '../components/ConfirmProvider';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import { Machinery, MachineRound, MachineDayOperator, ControlClosure, ClosureMachine, MachineGuard, MachineWorkSegment } from '../types/database';
import { DateField } from '../components/DateField';
import { GuardButton } from '../components/GuardButton';
import { fetchActiveGuards } from '../lib/guards';
import { latestInspectorByMachine, InspectorInfo } from '../lib/supervisorVisits';
import { listInspectorAssignments, inspectorSiempreActivo } from '../lib/machineInspectors';
import { loadFuelByMachine, lphOf, litersLabel, FuelAgg } from '../lib/fuelPerMachine';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { caracasParts } from '../lib/jornada';

export const ROUND_TIMES = ['07:00', '11:00', '15:00', '19:00'];
export const ROUND_LABELS = ['1ª RONDA', '2ª RONDA', '3ª RONDA', '4ª RONDA'];
/** Horas de un turno completo. Medio turno = 6 h. */
export const SHIFT_HOURS = 12;
export const HALF_SHIFT = 6;
/** Opciones por turno (día/noche): sin turno, medio (6h) o completo (12h). */
export const SHIFT_OPTS: { label: string; hours: number }[] = [
  { label: '—', hours: 0 },
  { label: 'Medio · 6h', hours: 6 },
  { label: 'Completo · 12h', hours: 12 },
];
/**
 * Fecha de corte del período a facturar. El resumen de horas/pagos solo cuenta
 * jornadas HASTA esta fecha (igual que el reporte de Maquinaria) para que todos
 * los reportes cuadren con el Excel. Hay rondas posteriores (06–08/07) que no
 * pertenecen a este período y no deben sumarse.
 */
export const PERIODO_CORTE = '2026-07-05';
/** Inicio de la semana base del período a facturar (26/06 → 05/07). */
export const PERIODO_INICIO = '2026-06-26';
/** Suma (o resta) días a una fecha ISO "AAAA-MM-DD" sin depender de la zona horaria. */
export function addDaysISO(iso: string, delta: number): string {
  const [y, mo, d] = (iso || '').split('-').map((n) => parseInt(n, 10));
  if (!y || !mo || !d) return iso;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  const mm = `${dt.getUTCMonth() + 1}`.padStart(2, '0');
  const dd = `${dt.getUTCDate()}`.padStart(2, '0');
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}
/**
 * HORAS REALES REDONDEADAS HACIA ARRIBA (pedido cliente 08/08/2026): cada jornada
 * (día o noche) usa sus horas REALES (las que registró Inspecciones, o las que cargó
 * un analista/admin manualmente) redondeadas al entero siguiente — ya NO se fuerza al
 * turno más cercano (6h/12h). Ej.: 7.6 h → 8 h · 9.2 h → 10 h · 6 h → 6 h (ya entero).
 * Usada en Control, Pagos e Informe (todos llaman esta función) para que el monto
 * refleje lo realmente trabajado, no un bloque fijo.
 */
export const turnoH = (h: number): number => {
  const v = Number(h) || 0;
  if (v <= 0) return 0;
  return Math.ceil(v);
};
/** Horas trabajadas del día = (turno día + turno noche, redondeados) − parada + extras (mín. 0 antes de extras). */
export const workedFromShifts = (dayH: number, nightH: number, stopped: number, overtime: number) =>
  Math.max(0, turnoH(dayH) + turnoH(nightH) - (Number(stopped) || 0)) + Math.max(0, Number(overtime) || 0);
/** Fracción de jornada según las horas (proporcional): 12 h = 1, 6 h = 0.5, 10 h = 0.833… (horas ÷ 12). */
export const shiftPayUnits = (h: number): number => (Number(h) || 0) / 12;
/** Jornadas del día = (turno día + turno noche, redondeados) ÷ 12. Monto = precio por jornada × jornadas. */
export const payUnitsFromShifts = (dayH: number, nightH: number): number =>
  (turnoH(dayH) + turnoH(nightH)) / 12;
/** Precio por HORA trabajada = precio de la jornada de 12 h ÷ 12. */
export const pricePerHour = (jornadaPrice: number): number => (Number(jornadaPrice) || 0) / 12;
/**
 * Jornadas PAGABLES del día según horas TRABAJADAS (descuenta paradas, suma extras) ÷ 12.
 * Monto = precio por jornada × jornadas pagables = horas trabajadas × precio por hora.
 */
export const payUnitsWorked = (dayH: number, nightH: number, stopped: number, overtime: number): number =>
  workedFromShifts(dayH, nightH, stopped, overtime) / 12;
/** Texto del turno según las horas de turno totales (día + noche). Con horas reales
 *  (ya no solo 6/12/18/24) casi siempre cae en el fallback "N h" — se deja el texto
 *  fijo para los bloques exactos clásicos (medio/completo turno) por costumbre. */
export function shiftLabel(totalShiftHours: number): string {
  const h = Number(totalShiftHours) || 0;
  if (h <= 0) return 'Sin turno';
  if (h === 6) return 'Medio turno';
  if (h === 12) return 'Turno completo';
  if (h === 18) return 'Turno y medio';
  if (h === 24) return 'Dos turnos';
  return `${h} h`;
}
/** Compat: horas trabajadas asumiendo turno completo (para datos viejos sin turnos). */
export const workedHours = (hoursStopped: number) => Math.max(0, SHIFT_HOURS - (hoursStopped || 0));

/** Campo de fecha con calendario: en web usa <input type="date">; en nativo, texto. */
function todayISO(): string {
  // Fecha de HOY según la hora de Caracas (no la zona horaria del dispositivo).
  return caracasParts(new Date()).iso;
}
/** Fecha + hora (Caracas) legible, p. ej. "08/07/2026 07:35". */
function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-VE', {
      timeZone: 'America/Caracas',
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
function shiftDay(iso: string, delta: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
/** Lunes de la semana de la fecha dada (ISO). */
function weekStartISO(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  const dow = (d.getDay() + 6) % 7; // Lunes = 0
  return shiftDay(iso, -dow);
}
const DOW_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
/** Etiqueta corta de un día ISO: "Lun 30/06". */
function dayLabel(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  const dow = (d.getDay() + 6) % 7;
  return `${DOW_LABELS[dow]} ${`${d.getDate()}`.padStart(2, '0')}/${`${d.getMonth() + 1}`.padStart(2, '0')}`;
}
/** Fecha ISO "AAAA-MM-DD" → "DD/MM/AAAA" (para los PDF). */
function fmtDMY(iso: string): string {
  const [y, m, d] = (iso || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : (iso || '');
}

export default function ControlMaquinariaScreen({ navigation, route }: any) {
  const rtId = useRef(0);
  if (!rtId.current) rtId.current = nextRtInstanceId();
  const { colors } = useTheme();
  const confirm = useConfirm();
  const toast = useToast();
  const { session, role } = useAuth();
  // Regla del cliente (07-ago-2026): la ANALISTA SOLO puede CARGAR horas a máquinas que
  // NO tienen horas ese día; NO puede borrar/reducir ni agregar más a las que ya tienen.
  // Tampoco puede tocar el PRECIO de la jornada.
  const esAnalista = role === 'analista';
  const puedeEditarPrecio = !esAnalista;
  // Bloqueo POR CAMPO: la analista no puede modificar/borrar un campo que ya tiene valor.
  const bloqueadoAnalista = (valorActual: number) => esAnalista && Number(valorActual) > 0;
  // Bloqueo POR MÁQUINA+DÍA: si la máquina YA tiene horas de trabajo (día o noche), la
  // analista no puede tocar nada de esa máquina ese día (ni agregar el otro turno, ni
  // parada/extra, ni borrar). Solo un administrador puede corregir.
  const analistaMaqConHoras = (ex?: { day_hours?: any; night_hours?: any } | null) =>
    esAnalista && ((Number(ex?.day_hours ?? 0) > 0) || (Number(ex?.night_hours ?? 0) > 0));
  const [date, setDate] = useState(todayISO());
  const [machines, setMachines] = useState<Machinery[]>([]);
  const [guards, setGuards] = useState<Record<string, MachineGuard>>({}); // guardia/militar actual por máquina
  const [inspectors, setInspectors] = useState<Record<string, InspectorInfo>>({}); // inspector del último check-in por máquina
  const [averiadas, setAveriadas] = useState<Set<string>>(new Set()); // máquinas con avería pendiente → "MÁQUINA PARADA"
  const [companies, setCompanies] = useState<Record<string, string>>({}); // id → nombre
  const [rounds, setRounds] = useState<Record<string, MachineRound>>({}); // key: machineId|fecha
  const [fuelWeek, setFuelWeek] = useState<Record<string, FuelAgg>>({}); // litros surtidos por máquina en el rango visible
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  // Al llegar desde el Dashboard con ?q (serial/código), filtra a ESA máquina.
  useEffect(() => {
    const term = route?.params?.q;
    if (!term) return;
    setQuery(String(term));
    navigation?.setParams?.({ q: undefined });
  }, [route?.params?.q]);
  const [hoursInput, setHoursInput] = useState<Record<string, string>>({}); // parada en edición (máquina|fecha)
  const [overtimeInput, setOvertimeInput] = useState<Record<string, string>>({}); // extras en edición (máquina|fecha)
  const [companyFilter, setCompanyFilter] = useState<string>('__all__'); // '__all__' | '__none__' | company id
  // Filtro por ENCARGADO (multi-selección tipo check, buscable). Vacío = todos.
  const [encargadoSel, setEncargadoSel] = useState<Set<string>>(new Set());
  const [encargadoOpen, setEncargadoOpen] = useState(false);
  const [encargadoQuery, setEncargadoQuery] = useState('');
  const SIN_ENCARGADO = '(sin encargado)';
  // Clave CANÓNICA para unificar el mismo encargado escrito distinto (mayúsculas,
  // acentos, ñ, espacios internos/dobles): "ALBERTO" / "Alberto" / "CARLOS  NUÑES"
  // caen en la misma clave. Vacío → sentinela (sin encargado).
  const encKey = (raw: any) => {
    const t = String(raw ?? '').trim();
    if (!t) return SIN_ENCARGADO;
    return norm(t).replace(/\s+/g, ' ').trim();
  };
  const toggleEncargado = (key: string) => setEncargadoSel((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  // ¿La máquina pasa el filtro de encargado? (vacío = todos). Se usa en la lista y en los PDF.
  const inEncargado = (m: Machinery) => encargadoSel.size === 0 || encargadoSel.has(encKey(m.encargado));
  const [companyPickerOpen, setCompanyPickerOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({}); // empresa → desplegada
  const [cardOpen, setCardOpen] = useState<Record<string, boolean>>({}); // máquina → tarjeta desplegada
  const [summaryOpen, setSummaryOpen] = useState(false); // panel de chips del reporte resumen
  const [sumFrom, setSumFrom] = useState(PERIODO_INICIO); // rango editable del reporte resumen
  const [sumTo, setSumTo] = useState(PERIODO_CORTE);
  const [priceFor, setPriceFor] = useState<Machinery | null>(null); // máquina cuyo precio/hora se edita
  const [priceInput, setPriceInput] = useState('');
  const [priceFrom, setPriceFrom] = useState(''); // rango de fechas al que aplica el precio
  const [priceTo, setPriceTo] = useState('');
  const [priceBlindar, setPriceBlindar] = useState(true); // blindar: clavar el precio a ese rango
  const [savingPrice, setSavingPrice] = useState(false);
  const [esperaOpen, setEsperaOpen] = useState(false); // sección "En espera" (por recibir) desplegada
  const [busyRecibir, setBusyRecibir] = useState<string | null>(null); // id de la máquina que se está recibiendo
  const [recibirDate, setRecibirDate] = useState<Record<string, string>>({}); // fecha de entrada elegida por máquina al recibir

  // ── Fletes / viajes por equipo (registrados aquí, CON FECHA). Se cargan los del bloque visible.
  const [fletesByMachine, setFletesByMachine] = useState<Record<string, any[]>>({}); // machineId → fletes del bloque
  const [fletesGeneral, setFletesGeneral] = useState<Record<string, any[]>>({}); // companyId → fletes generales del bloque
  const [fleteFor, setFleteFor] = useState<Machinery | null>(null); // máquina cuyo flete se registra
  const [fleteGeneralCo, setFleteGeneralCo] = useState<{ id: string; name: string } | null>(null); // flete general de una empresa
  const [fleteDate, setFleteDate] = useState(todayISO());
  const [fleteViajes, setFleteViajes] = useState('');
  const [fletePrecio, setFletePrecio] = useState('');
  const [fleteBusy, setFleteBusy] = useState(false);
  const [fleteDelConfirm, setFleteDelConfirm] = useState<string | null>(null); // id del flete pendiente de confirmar borrado

  // Marcar equipo AVERIADO desde el control: empresa → máquina (serial/placa) → motivo.
  // Deja la máquina No operativa y abre una traza de reparación para Mantenimiento.
  const [averiaOpen, setAveriaOpen] = useState(false);
  const [averiaCompany, setAveriaCompany] = useState<string | null>(null); // company_id | '__none__' | null
  const [averiaCompanyOpen, setAveriaCompanyOpen] = useState(false);
  const [averiaMachine, setAveriaMachine] = useState<Machinery | null>(null);
  const [averiaMachineOpen, setAveriaMachineOpen] = useState(false);
  const [averiaMachQ, setAveriaMachQ] = useState('');
  const [averiaNota, setAveriaNota] = useState('');
  const [averiaBusy, setAveriaBusy] = useState(false);

  // Operador por turno: máquina + fecha + turno (día/noche) que se está editando.
  const [opFor, setOpFor] = useState<{ m: Machinery; d: string; which: 'day' | 'night' } | null>(null);
  const [opFirst, setOpFirst] = useState('');
  const [opLast, setOpLast] = useState('');
  const [opCedula, setOpCedula] = useState('');
  // Al escribir la C.I del operador, se busca en NÓMINA y se autocompleta nombre/apellido.
  const [opLookup, setOpLookup] = useState<'idle' | 'searching' | 'found' | 'none'>('idle');
  useEffect(() => {
    if (!opFor) { setOpLookup('idle'); return; }
    const ci = opCedula.trim();
    if (ci.length < 6) { setOpLookup('idle'); return; }
    let cancel = false;
    setOpLookup('searching');
    const t = setTimeout(async () => {
      const { data } = await supabase.from('employees').select('first_name, last_name').eq('cedula', ci).limit(1);
      if (cancel) return;
      const emp = data && (data[0] as any);
      if (emp) { setOpFirst((emp.first_name || '').trim()); setOpLast((emp.last_name || '').trim()); setOpLookup('found'); }
      else setOpLookup('none');
    }, 400);
    return () => { cancel = true; clearTimeout(t); };
  }, [opCedula, opFor]);

  // Visor de tramos (solo lectura): muestra el detalle auditable de machine_work_segments
  // para la máquina + día elegidos, en paralelo a day_hours/night_hours (que no se tocan).
  const [segmentsFor, setSegmentsFor] = useState<{ m: Machinery; d: string } | null>(null);
  const [segmentsList, setSegmentsList] = useState<MachineWorkSegment[]>([]);
  const [segmentsLoading, setSegmentsLoading] = useState(false);
  const openSegments = async (m: Machinery, dISO: string) => {
    setSegmentsFor({ m, d: dISO });
    setSegmentsList([]);
    setSegmentsLoading(true);
    try {
      const { data } = await supabase
        .from('machine_work_segments')
        .select('*')
        .eq('machinery_id', m.id)
        .eq('round_date', dISO)
        .order('started_at');
      setSegmentsList((data as MachineWorkSegment[]) ?? []);
    } catch {
      setSegmentsList([]);
    } finally {
      setSegmentsLoading(false);
    }
  };
  const SEGMENT_SOURCE_LABEL: Record<MachineWorkSegment['source'], string> = {
    manual_finish: '🏁 Cierre manual',
    parada_averia: '🔧 Parada por avería',
    parada_no_trabajo: '📍 Parada / no trabajó',
    auto_close: '🤖 Cierre automático',
    ajuste_manual: '✏️ Ajuste manual',
    auto_full_shift: '🤖 Jornada automática (sin inspector asignado)',
  };

  // Bloque de días: arranca el lunes de la fecha elegida y muestra `dayCount` días
  // (por defecto 7, pero se pueden añadir 8, 10, … los que se necesiten).
  const [dayCount, setDayCount] = useState(7);
  const weekStart = weekStartISO(date);
  // RENDIMIENTO: weekDays es una derivación pura de (weekStart, dayCount). Memoizarlo evita
  // recrear el arreglo en cada render y, sobre todo, le da una referencia ESTABLE para que
  // los useMemo que dependen de él (workedByMachine) no se recalculen sin necesidad.
  const weekDays = useMemo(() => Array.from({ length: dayCount }, (_, i) => shiftDay(weekStart, i)), [weekStart, dayCount]);
  const weekEnd = weekDays[weekDays.length - 1];

  // Cierre de control + histórico
  const [closing, setClosing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [histOpen, setHistOpen] = useState(false);
  const [closures, setClosures] = useState<ControlClosure[]>([]);
  const [closureSel, setClosureSel] = useState<ControlClosure | null>(null);
  const [closureSearch, setClosureSearch] = useState(''); // buscador dentro del cierre
  const [closureCompany, setClosureCompany] = useState<string | null>(null); // filtra el cierre a una empresa
  const [closureExpanded, setClosureExpanded] = useState<Record<string, boolean>>({}); // código → detalle abierto

  const rkey = (mId: string, d: string) => `${mId}|${d}`;

  // Anti "cache vieja": guarda las rondas editadas HACE POCO (rkey → vence en). Un refetch
  // silencioso (realtime/foco) puede leer datos que aún no reflejan tu cambio; durante esta
  // ventana NO se pisa la edición local, así al quitar/poner horas no se revierte sola.
  const recentEdits = useRef<Map<string, number>>(new Map());
  const EDIT_GUARD_MS = 5000;
  const markEdited = (key: string) => recentEdits.current.set(key, Date.now() + EDIT_GUARD_MS);

  // Refresca el guardia/militar actual de una sola máquina tras asignar/cambiar.
  const refreshGuard = useCallback(async (machineId: string) => {
    const map = await fetchActiveGuards([machineId]);
    setGuards((p) => {
      const next = { ...p };
      if (map[machineId]) next[machineId] = map[machineId];
      else delete next[machineId];
      return next;
    });
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const ws = weekStartISO(date);
    const days = Array.from({ length: dayCount }, (_, i) => shiftDay(ws, i));
    try {
      // machine_rounds SE PAGINA: una semana ocupada puede pasar de 1000 rondas
      // (PostgREST corta ahí). Sin paginar, faltaban máquinas/horas en pantalla.
      const [{ data: m }, r, { data: c }, { data: fl }] = await Promise.all([
        supabase.from('machinery').select('*').order('code', { ascending: true }),
        selectAllRows('machine_rounds', '*', (q) => q.in('round_date', days)),
        supabase.from('companies').select('id, name'),
        supabase.from('fletes').select('*').in('flete_date', days),
      ]);
      // Fletes del bloque visible: los de máquina van en su tarjeta; los GENERALES (sin
      // máquina) se agrupan por empresa para mostrarlos en la cabecera de la empresa.
      const fmap: Record<string, any[]> = {};
      const fgen: Record<string, any[]> = {};
      (fl ?? []).forEach((row: any) => {
        if (row.machinery_id) (fmap[row.machinery_id] ??= []).push(row);
        else if (row.company_id) (fgen[row.company_id] ??= []).push(row);
      });
      setFletesByMachine(fmap);
      setFletesGeneral(fgen);
      setMachines((m ?? []) as Machinery[]);
      // Combustible surtido por máquina en el rango visible (para mostrar ⛽ L y L/h).
      loadFuelByMachine(days[0], days[days.length - 1]).then(setFuelWeek).catch(() => {});
      // Guardia/militar actual de cada máquina (para mostrarlo en cada ronda).
      fetchActiveGuards((m ?? []).map((x: any) => x.id)).then(setGuards).catch(() => {});
      // Inspector "asignado" = quien hizo el último check-in en cada máquina.
      latestInspectorByMachine().then(setInspectors).catch(() => {});
      // Averías PENDIENTES → en la tarjeta sale "🔴 MÁQUINA PARADA".
      // REGLA "SIEMPRE ACTIVO" (SOS LA GUAIRA): sus máquinas nunca salen averiadas — se
      // excluyen del set aunque tengan tickets pendientes (se ignora su mantenimiento).
      // REGLA "REACTIVACIÓN" (igual que Catálogo/Inspecciones): si la máquina ya inició una
      // jornada DESPUÉS de que se marcó la avería/parada, ya volvió a trabajar — el ticket
      // pendiente en la BD queda "vencido" hasta que alguien lo resuelva a mano, pero acá
      // debe dejar de contar como parada (si no, Control la muestra parada indefinidamente
      // aunque Catálogo/Inspecciones ya la vean operativa).
      (async () => {
        try {
          const today = todayISO();
          const yesterday = caracasParts(new Date(Date.now() - 86400000)).iso;
          const [{ data }, { rows }, { data: todayRounds }, { data: nightRounds }] = await Promise.all([
            supabase.from('maintenance_requests').select('machinery_id, created_at').eq('status', 'pendiente'),
            listInspectorAssignments(),
            supabase.from('machine_rounds').select('machinery_id, jornada_start_at').eq('round_date', today).not('jornada_start_at', 'is', null),
            supabase.from('machine_rounds').select('machinery_id, jornada_start_at').eq('round_date', yesterday).eq('jornada_shift', 'night').not('jornada_start_at', 'is', null),
          ]);
          const sos = new Set(rows.filter((a) => inspectorSiempreActivo(a.inspector_name)).map((a) => a.machinery_id));
          const openStartByMachine: Record<string, number> = {};
          [...(todayRounds ?? []), ...(nightRounds ?? [])].forEach((row: any) => {
            if (!row.jornada_start_at) return;
            const t = new Date(row.jornada_start_at).getTime();
            const prev = openStartByMachine[row.machinery_id];
            openStartByMachine[row.machinery_id] = prev == null ? t : Math.max(prev, t);
          });
          const next = new Set<string>();
          ((data ?? []) as any[]).forEach((r) => {
            const id = r.machinery_id as string;
            if (sos.has(id)) return;
            const openStart = openStartByMachine[id];
            const createdMs = r.created_at ? new Date(r.created_at).getTime() : 0;
            if (openStart != null && openStart >= createdMs) return; // reactivada: jornada abierta después de la marca
            next.add(id);
          });
          setAveriadas(next);
        } catch {}
      })();
      const cmap: Record<string, string> = {};
      (c ?? []).forEach((row: any) => (cmap[row.id] = row.name));
      setCompanies(cmap);
      // El control muestra TODO (abierto y cerrado) al navegar por semanas. Lo cerrado
      // queda archivado en el histórico PERO también se ve aquí y se puede seguir
      // editando (p. ej. agregar días que faltaron). Cada ronda conserva su marca
      // `closed` y su precio congelado (`frozen_price`) al editarse.
      const fetched: Record<string, MachineRound> = {};
      (r ?? []).forEach((row: any) => {
        const k = rkey(row.machinery_id, row.round_date);
        const cur = fetched[k] as any;
        // El control edita SIEMPRE el registro base round_no=1; si por datos viejos hubiera
        // varias filas para la misma máquina/fecha, se PRIORIZA round_no=1 (o el menor) para
        // que "mostrar" y "editar" sean la MISMA fila (si no, parecía que "no tomaba" el cambio).
        if (!cur || Number(row.round_no ?? 1) < Number(cur.round_no ?? 1)) fetched[k] = row;
      });
      setRounds((prev) => {
        // Conserva las ediciones locales muy recientes (aún dentro de su ventana): si el
        // refetch trae datos viejos que no reflejan tu cambio, NO los pisamos.
        const now = Date.now();
        recentEdits.current.forEach((exp, k) => {
          if (exp > now) { if (prev[k]) fetched[k] = prev[k]; }
          else recentEdits.current.delete(k);
        });
        return fetched;
      });
      if (!silent) { setHoursInput({}); setOvertimeInput({}); }
    } catch (e: any) {
      if (!silent) toast.error('No se pudo cargar el control. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setLoading(false); // pase lo que pase, se quita el spinner (nunca se queda colgado)
    }
  }, [date, dayCount]);

  useEffect(() => {
    load();
    // Sincronización multiusuario: refresca (silencioso) al cambiar turnos/máquinas.
    let timer: any;
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // No refresques mientras haya ediciones locales recientes: se pospone hasta que
        // la ventana expire, así un refetch nunca pisa lo que acabas de cambiar.
        const now = Date.now();
        let editing = false;
        recentEdits.current.forEach((exp) => { if (exp > now) editing = true; });
        if (editing) { bump(); return; }
        load(true);
      }, 300);
    };
    const ch = supabase.channel(`rt-control-maquinaria-${rtId.current}`);
    ['machine_rounds', 'machinery', 'machine_guards', 'fletes', 'maintenance_requests'].forEach((t) =>
      ch.on('postgres_changes' as any, { event: '*', schema: 'public', table: t }, bump)
    );
    // Resync al (re)conectar el canal (señal intermitente): recupera cambios perdidos.
    let joined = false;
    ch.subscribe((status: string) => { if (status === 'SUBSCRIBED') { if (joined) bump(); joined = true; } });
    return () => { clearTimeout(timer); supabase.removeChannel(ch); };
  }, [load]);

  // Recarga al VOLVER a esta pantalla (p. ej. tras agregar/editar un equipo en Equipos).
  // Así el equipo nuevo aparece aunque el realtime de la BD no esté activo para machinery.
  useFocusEffect(useCallback(() => { load(true); }, [load]));

  // Guarda/actualiza el registro base (round_no=1) de una máquina en un día concreto,
  // conservando lo demás. Todo el control es por (máquina, fecha).
  const upsertRound = async (m: Machinery, dISO: string, patch: Record<string, any>) => {
    const key = rkey(m.id, dISO);
    markEdited(key); // protege la edición mientras se escribe (evita que un refetch la pise)
    const ex = rounds[key];
    const payload: any = {
      machinery_id: m.id,
      round_date: dISO,
      round_no: 1,
      day_hours: Number(ex?.day_hours ?? 0),
      night_hours: Number(ex?.night_hours ?? 0),
      hours_stopped: Number(ex?.hours_stopped ?? 0),
      overtime_hours: Number(ex?.overtime_hours ?? 0),
      day_operator: ex?.day_operator ?? null,
      day_operator_ci: ex?.day_operator_ci ?? null,
      night_operator: ex?.night_operator ?? null,
      night_operator_ci: ex?.night_operator_ci ?? null,
      ...patch,
    };
    payload.status = Number(payload.day_hours) + Number(payload.night_hours) > 0 ? 'operativa' : 'parada';
    const { data, error } = await supabase
      .from('machine_rounds')
      .upsert(payload, { onConflict: 'machinery_id,round_date,round_no' })
      .select()
      .single();
    // OJO: Alert.alert NO se muestra en web; usamos el banner (setNotice) para que un
    // error de guardado SÍ se vea (si no, parecería que "no toma" las horas sin avisar).
    if (error) { recentEdits.current.delete(key); setNotice(`❌ No se pudo guardar: ${error.message}`); return; }
    markEdited(key); // refresca la ventana tras confirmar el guardado
    setRounds((p) => ({ ...p, [key]: data as MachineRound }));
    // Si la ronda editada YA estaba cerrada, sincroniza el histórico en el acto
    // (para que el reporte cerrado refleje el cambio sin tener que reabrir el cierre).
    if ((data as any)?.closed) syncClosedRound(m, dISO, data as MachineRound);
  };

  // Sincroniza la copia congelada del cierre (control_closures.detail.machines) cuando
  // se modifica una jornada YA CERRADA desde el control. Actualiza la fila existente,
  // agrega la que faltaba (día que se sumó después) o la quita si se dejó en 0.
  const syncClosedRound = async (m: Machinery, dISO: string, row: MachineRound) => {
    if (!row?.closed) return;
    const dayH = Number(row.day_hours) || 0;
    const nightH = Number(row.night_hours) || 0;
    const stopped = Number(row.hours_stopped) || 0;
    const ot = Number(row.overtime_hours) || 0;
    const worked = workedFromShifts(dayH, nightH, stopped, ot);
    const hasHours = dayH + nightH > 0 || stopped > 0 || ot > 0;
    try {
      // Cierres cuyo rango [dateFrom..dateTo] cubre esta fecha (closure_date = dateTo).
      const { data: cls } = await supabase
        .from('control_closures')
        .select('*')
        .gte('closure_date', dISO)
        .order('closure_date', { ascending: true });
      const candidates = (cls ?? []).filter((c: any) => {
        const from = c.detail?.dateFrom ?? c.closure_date;
        const to = c.detail?.dateTo ?? c.closure_date;
        return from <= dISO && dISO <= to;
      });
      if (candidates.length === 0) return;
      // Prioriza el cierre que ya tiene ESTA máquina; si no, el primero que cubra la fecha.
      const target =
        candidates.find((c: any) => (c.detail?.machines ?? []).some((x: any) => x.machineId === m.id)) ?? candidates[0];
      const machines = [...(((target.detail?.machines ?? []) as ClosureMachine[]))];
      const idx = machines.findIndex(
        (x) => x.date === dISO && (x.machineId ? x.machineId === m.id : !!m.serial && x.serial === m.serial)
      );
      // Precio congelado VÁLIDO (>0): el de la ronda; si no, el de otra fila de la misma
      // máquina en el cierre; si no, el precio actual de la máquina. Un 0 no vale.
      const priceFrozen =
        row.frozen_price != null && Number(row.frozen_price) > 0
          ? Number(row.frozen_price)
          : machines.find((x) => x.machineId === m.id && x.price != null && Number(x.price) > 0)?.price ??
            (m.price_per_hour != null ? Number(m.price_per_hour) : 0);
      const entry: ClosureMachine = {
        code: m.code ?? '—',
        machineId: m.id,
        serial: m.serial ?? m.plate ?? null,
        company: m.company_id ? (companies[m.company_id] ?? 'Sin empresa') : 'Sin empresa',
        operator: [row.day_operator, row.night_operator].filter(Boolean).join(' / '),
        cedula: '',
        date: dISO,
        dayOperator: row.day_operator ?? '',
        dayCedula: row.day_operator_ci ?? '',
        nightOperator: row.night_operator ?? '',
        nightCedula: row.night_operator_ci ?? '',
        dayHours: dayH,
        nightHours: nightH,
        hoursStopped: stopped,
        overtime: ot,
        worked,
        price: Number(priceFrozen) || 0,
      };
      if (idx >= 0) {
        if (hasHours) machines[idx] = entry;
        else machines.splice(idx, 1); // se quitó toda la jornada → sale del cierre
      } else if (hasHours) {
        machines.push(entry);
      } else {
        return; // nada que sincronizar
      }
      machines.sort((a, b) =>
        a.date === b.date ? cmpText(a.code, b.code) : String(a.date).localeCompare(String(b.date))
      );
      const uniqueMachines = new Set(machines.map((s) => s.machineId || s.serial || s.code)).size;
      await supabase
        .from('control_closures')
        .update({ detail: { ...(target.detail ?? {}), machines, totalMachines: uniqueMachines } })
        .eq('id', target.id);
      // Si esa ronda no tenía precio congelado válido (null o 0), congélalo ahora.
      if ((row.frozen_price == null || Number(row.frozen_price) <= 0) && hasHours && entry.price) {
        await supabase.from('machine_rounds').update({ frozen_price: entry.price }).eq('machinery_id', m.id).eq('round_date', dISO);
      }
    } catch {
      // No romper la edición si falla la sincronización del histórico.
    }
  };

  // Fija el turno de DÍA o NOCHE (0 / 6 / 12 h) de una máquina en un día.
  const setShift = async (m: Machinery, dISO: string, which: 'day' | 'night', hoursVal: number) => {
    const ik = `${m.id}|${dISO}`;
    const ex = rounds[rkey(m.id, dISO)];
    // Analista: SOLO puede cargar horas a máquinas SIN horas ese día. Si la máquina ya
    // tiene día u noche, no puede agregar el otro turno, ni modificar, ni borrar.
    const curTurno = which === 'day' ? Number(ex?.day_hours ?? 0) : Number(ex?.night_hours ?? 0);
    if (analistaMaqConHoras(ex)) { toast.error('Esta máquina ya tiene horas ese día. Como analista solo puedes cargar horas a máquinas SIN horas; para modificar o borrar, pide a un administrador.'); return; }
    const hadOp = which === 'day' ? ex?.day_operator : ex?.night_operator;
    // Arrastra lo que el usuario haya escrito en parada/extra pero aún no guardó
    // (si tocó el turno sin salir del campo), para no perder esas horas.
    const patch: Record<string, any> = which === 'day' ? { day_hours: hoursVal } : { night_hours: hoursVal };
    if (hoursInput[ik] !== undefined) patch.hours_stopped = Math.max(0, Number(hoursInput[ik].replace(',', '.')) || 0);
    if (overtimeInput[ik] !== undefined) patch.overtime_hours = Math.max(0, Number(overtimeInput[ik].replace(',', '.')) || 0);
    await upsertRound(m, dISO, patch);
    // Log auditable EN PARALELO (no bloqueante): deja trazabilidad del ajuste manual
    // sin alterar en nada el guardado de day_hours/night_hours de arriba.
    if (hoursVal !== curTurno) {
      const delta = Math.round((hoursVal - curTurno) * 100) / 100;
      supabase.from('machine_work_segments').insert({
        machinery_id: m.id, round_date: dISO, shift: which,
        started_at: new Date().toISOString(), ended_at: new Date().toISOString(), hours: delta,
        source: 'ajuste_manual', recorded_by: session?.user?.id ?? null,
        notes: `Ajuste manual: ${curTurno}h → ${hoursVal}h`,
      }).then(() => {}, () => {});
    }
    // Al asignar un turno y si aún no hay operador de esa jornada, pedir sus datos.
    if (hoursVal > 0 && !hadOp) openOperator(m, dISO, which);
  };

  const setHours = async (m: Machinery, dISO: string, val: string) => {
    const ex = rounds[rkey(m.id, dISO)];
    if (analistaMaqConHoras(ex) || bloqueadoAnalista(Number(ex?.hours_stopped ?? 0))) { toast.error('Como analista no puedes modificar/borrar horas ya cargadas (parada). Pide a un administrador.'); setHoursInput((p) => { const n = { ...p }; delete n[`${m.id}|${dISO}`]; return n; }); return; }
    await upsertRound(m, dISO, { hours_stopped: Math.max(0, Number(val.replace(',', '.')) || 0) });
  };
  const setOvertime = async (m: Machinery, dISO: string, val: string) => {
    const ex = rounds[rkey(m.id, dISO)];
    if (analistaMaqConHoras(ex) || bloqueadoAnalista(Number(ex?.overtime_hours ?? 0))) { toast.error('Como analista no puedes modificar/borrar horas ya cargadas (extra). Pide a un administrador.'); setOvertimeInput((p) => { const n = { ...p }; delete n[`${m.id}|${dISO}`]; return n; }); return; }
    await upsertRound(m, dISO, { overtime_hours: Math.max(0, Number(val.replace(',', '.')) || 0) });
  };

  // ── Operador por turno (cada jornada puede tener uno distinto) ────────────────
  const openOperator = (m: Machinery, dISO: string, which: 'day' | 'night') => {
    const ex = rounds[rkey(m.id, dISO)];
    const name = (which === 'day' ? ex?.day_operator : ex?.night_operator) ?? '';
    const ci = (which === 'day' ? ex?.day_operator_ci : ex?.night_operator_ci) ?? '';
    const parts = name.trim().split(' ');
    setOpFor({ m, d: dISO, which });
    setOpFirst(parts[0] ?? '');
    setOpLast(parts.slice(1).join(' '));
    setOpCedula(ci);
  };

  const saveOperator = async () => {
    if (!opFor) return;
    const full = `${opFirst.trim()} ${opLast.trim()}`.trim().toUpperCase();
    const patch =
      opFor.which === 'day'
        ? { day_operator: full || null, day_operator_ci: opCedula.trim() || null }
        : { night_operator: full || null, night_operator_ci: opCedula.trim() || null };
    await upsertRound(opFor.m, opFor.d, patch);
    setOpFor(null);
  };

  // ── Cerrar control → archiva TODO lo pendiente (todas las fechas) en el histórico.
  //    El cierre abarca desde el primer turno (día o noche) registrado hasta el último día.
  const cerrarControl = async () => {
    setClosing(true);
    // Trae todos los turnos sin cerrar (de cualquier fecha) con sus operadores por turno.
    // PAGINADO: con >1000 turnos abiertos, una consulta simple cortaba en 1000 y el
    // cierre guardaba el histórico INCOMPLETO (y luego marcaba TODO como cerrado).
    const openRounds = await selectAllRows(
      'machine_rounds',
      'round_date, day_hours, night_hours, hours_stopped, overtime_hours, frozen_price, day_operator, day_operator_ci, night_operator, night_operator_ci, machinery:machinery_id(id, code, serial, plate, price_per_hour, company:company_id(name))',
      (q) => q.eq('closed', false)
    );
    const rows = (openRounds ?? []).filter(
      (r: any) => (Number(r.day_hours) || 0) + (Number(r.night_hours) || 0) > 0 || (Number(r.hours_stopped) || 0) > 0 || (Number(r.overtime_hours) || 0) > 0
    );
    if (rows.length === 0) {
      setClosing(false);
      setNotice('No hay turnos registrados (día o noche) para cerrar.');
      return;
    }
    const dates = rows.map((r: any) => r.round_date).sort();
    const from = dates[0];
    const to = dates[dates.length - 1];
    const snapshot: ClosureMachine[] = rows
      .sort((a: any, b: any) => (a.round_date === b.round_date ? cmpText(a.machinery?.code, b.machinery?.code) : a.round_date.localeCompare(b.round_date)))
      .map((r: any) => {
        const dayH = Number(r.day_hours) || 0;
        const nightH = Number(r.night_hours) || 0;
        const stopped = Number(r.hours_stopped) || 0;
        const ot = Number(r.overtime_hours) || 0;
        return {
          code: r.machinery?.code ?? '—',
          machineId: r.machinery?.id ?? null,
          serial: r.machinery?.serial ?? r.machinery?.plate ?? null,
          company: r.machinery?.company?.name ?? 'Sin empresa',
          operator: [r.day_operator, r.night_operator].filter(Boolean).join(' / '),
          cedula: '',
          date: r.round_date,
          dayOperator: r.day_operator ?? '',
          dayCedula: r.day_operator_ci ?? '',
          nightOperator: r.night_operator ?? '',
          nightCedula: r.night_operator_ci ?? '',
          dayHours: dayH,
          nightHours: nightH,
          hoursStopped: stopped,
          overtime: ot,
          worked: workedFromShifts(dayH, nightH, stopped, ot),
          // Precio CONGELADO al momento del cierre: usa el precio por RANGO ya fijado
          // en la jornada (frozen_price) si existe; si no, el precio actual de la máquina.
          // Una vez cerrada, aunque cambie el precio de la máquina, el monto no se mueve.
          price: (r.frozen_price != null && Number(r.frozen_price) > 0) ? Number(r.frozen_price) : (Number(r.machinery?.price_per_hour) || 0),
        } as ClosureMachine;
      });
    const uniqueMachines = new Set(snapshot.map((s) => s.machineId || s.serial || s.code)).size;
    const rangeTxt = from === to ? `del ${from}` : `del ${from} al ${to}`;
    setClosing(false);
    const ok = await confirm({
      title: 'Cerrar control',
      message: `¿Cerrar el control ${rangeTxt}? Se guardará en el histórico con ${uniqueMachines} máquina(s) en ${snapshot.length} registro(s) y sus operadores.`,
      confirmText: 'Cerrar y guardar',
      cancelText: 'Cancelar',
    });
    if (!ok) return;
    setClosing(true);
    const { error } = await supabase.from('control_closures').insert({
      closure_date: to,
      closed_by: session?.user?.id ?? null,
      detail: { machines: snapshot, totalMachines: uniqueMachines, dateFrom: from, dateTo: to },
    });
    if (error) {
      setClosing(false);
      return toast.error(error.message);
    }
    // Marca TODO lo pendiente como cerrado: sale del control activo pero queda en la BD.
    await supabase.from('machine_rounds').update({ closed: true }).eq('closed', false);
    // Congela el precio de cada ronda recién cerrada (dentro del rango del cierre), para
    // que los reportes usen ESE precio aunque después cambie el de la máquina. IMPORTANTE:
    // solo rellena las rondas que AÚN no tienen precio congelado (null o 0). Si ya fijaste
    // un precio por rango de fechas para ese corte, se respeta y NO se pisa.
    const priceByMachine = new Map<string, number>();
    snapshot.forEach((s) => { if (s.machineId) priceByMachine.set(s.machineId, Number(s.price) || 0); });
    // OPTIMIZACIÓN: antes se hacía 1 consulta POR máquina EN SECUENCIA → con muchas
    // máquinas el "Cerrar control" tardaba mucho. Ahora se AGRUPA por precio (las
    // máquinas con el mismo precio se congelan en una sola consulta con .in(...)) y
    // todas las consultas corren EN PARALELO. Los ids se trocean para no pasar del
    // límite de longitud de URL. Mismo resultado, mucho más rápido.
    const idsByPrice = new Map<number, string[]>();
    for (const [mid, price] of priceByMachine) {
      if (!(price > 0)) continue;
      const arr = idsByPrice.get(price) ?? [];
      arr.push(mid);
      idsByPrice.set(price, arr);
    }
    const chunk = (arr: string[], n: number) => { const o: string[][] = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
    const freezeJobs: PromiseLike<any>[] = [];
    for (const [price, ids] of idsByPrice) {
      for (const part of chunk(ids, 100)) {
        freezeJobs.push(
          supabase.from('machine_rounds').update({ frozen_price: price })
            .in('machinery_id', part).gte('round_date', from).lte('round_date', to)
            .or('frozen_price.is.null,frozen_price.eq.0')
        );
      }
    }
    await Promise.all(freezeJobs);
    setClosing(false);
    setNotice(`✅ Control ${rangeTxt} cerrado y guardado en el histórico. El control activo quedó limpio.`);
    load(true);
  };

  const openHistorico = async () => {
    setHistOpen(true);
    const { data } = await supabase.from('control_closures').select('*').order('closure_date', { ascending: false }).limit(200);
    setClosures((data ?? []) as ControlClosure[]);
  };

  // ── Reabrir un cierre: devuelve sus rondas al control activo (editables) y quita
  //    el cierre del histórico. Al terminar de corregir, se vuelve a cerrar (y se
  //    congela el precio de nuevo). Es lo más seguro: reusa toda la lógica existente.
  const [reabriendo, setReabriendo] = useState<string | null>(null);
  // Confirmación EN LÍNEA (no un Modal anidado): en web un Modal sobre el modal de
  // cierre queda tapado, por eso la confirmación se muestra dentro del mismo modal.
  const [confirmReabrir, setConfirmReabrir] = useState(false);
  // Al abrir/cerrar un cierre, arranca sin la confirmación desplegada.
  useEffect(() => { setConfirmReabrir(false); }, [closureSel]);
  const reabrirCierre = async (c: ControlClosure) => {
    const from = c.detail?.dateFrom ?? c.closure_date;
    const to = c.detail?.dateTo ?? c.closure_date;
    const rangeTxt = from === to ? `del ${fmtDMY(from)}` : `del ${fmtDMY(from)} al ${fmtDMY(to)}`;
    setConfirmReabrir(false);
    setReabriendo(c.id);
    // Pares exactos (máquina, fecha) del snapshot → solo reabrimos esas rondas cerradas.
    const byDate = new Map<string, Set<string>>();
    (c.detail?.machines ?? []).forEach((m) => {
      if (m.machineId && m.date) {
        if (!byDate.has(m.date)) byDate.set(m.date, new Set());
        byDate.get(m.date)!.add(m.machineId);
      }
    });
    try {
      // OPTIMIZACIÓN: antes se hacía 1 consulta POR FECHA en SECUENCIA → reabrir un
      // rango de varios días tardaba mucho. Ahora todas las consultas (por fecha,
      // troceadas por ids) corren EN PARALELO. closed=false + limpia el precio
      // congelado (se vuelve a congelar al re-cerrar).
      const chunk = (arr: string[], n: number) => { const o: string[][] = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
      const jobs: PromiseLike<any>[] = [];
      for (const [d, ids] of byDate) {
        for (const part of chunk(Array.from(ids), 100)) {
          jobs.push(
            supabase.from('machine_rounds')
              .update({ closed: false, frozen_price: null })
              .eq('round_date', d).in('machinery_id', part).eq('closed', true)
              .then(({ error }: any) => { if (error) throw error; })
          );
        }
      }
      await Promise.all(jobs);
      const { error: delErr } = await supabase.from('control_closures').delete().eq('id', c.id);
      if (delErr) throw delErr;
    } catch (e: any) {
      setReabriendo(null);
      return toast.error(e?.message ?? 'No se pudo reabrir el cierre.');
    }
    setReabriendo(null);
    setClosureSel(null);
    setClosures((prev) => prev.filter((x) => x.id !== c.id));
    setHistOpen(false);
    // Ampliar el bloque para que se vea todo el rango reabierto (arranca el lunes del inicio).
    let span = 0;
    for (let d = weekStartISO(from); d <= to && span < 62; d = addDaysISO(d, 1)) span++;
    setDate(from);
    setDayCount(Math.min(62, Math.max(7, span)));
    setNotice(`♻️ Cierre ${rangeTxt} reabierto. Los registros volvieron al control activo (semana del ${fmtDMY(from)}). Edítalos y vuelve a cerrar.`);
    load(true);
  };

  const shiftCell = (h?: number) => (h ? `${h} h` : '—');
  const opCell = (name?: string, ci?: string) => (name ? `${name}${ci ? `<br/><span style="color:#888">C.I ${ci}</span>` : ''}` : '—');
  const downloadClosurePdf = async (c: ControlClosure) => {
    // Si el cierre se abrió desde una empresa, el PDF sale solo con sus máquinas.
    const machs = (c.detail?.machines ?? []).filter((m) => !closureCompany || (m.company || 'Sin empresa') === closureCompany);
    const range = c.detail?.dateFrom && c.detail?.dateTo && c.detail.dateFrom !== c.detail.dateTo
      ? `del ${fmtDMY(c.detail.dateFrom)} al ${fmtDMY(c.detail.dateTo)}`
      : `del ${fmtDMY(c.detail?.dateFrom ?? c.closure_date)}`;
    // Precio POR JORNADA (12 h) de cada máquina. Monto = precio × unidades (12h=1, 6h=0.5).
    const priceBySerial = new Map(machines.filter((mm) => mm.serial).map((mm) => [mm.serial as string, Number(mm.price_per_hour) || 0]));
    const priceByCode = new Map(machines.map((mm) => [mm.code, Number(mm.price_per_hour) || 0]));
    // Si el cierre ya trae el precio CONGELADO, se usa ese (semana cerrada = inmutable);
    // si es un cierre viejo sin precio, se calcula con el precio actual de la máquina.
    const priceOf = (m: ClosureMachine) => (m.price != null && Number(m.price) > 0 ? Number(m.price) : ((m.serial ? priceBySerial.get(m.serial) : undefined) ?? priceByCode.get(m.code) ?? 0));
    const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const rows = machs
      .map((m) => {
        const price = priceOf(m);
        const amount = (Number(m.worked) || 0) / 12 * price;
        return (
          `<tr><td>${m.date ?? '—'}</td><td>${m.code}${m.serial ? `<br/><span style="color:#888">${m.serial}</span>` : ''}</td><td>${m.company || '—'}</td>` +
          `<td style="text-align:center">${shiftCell(m.dayHours)}</td><td>${opCell(m.dayOperator, m.dayCedula)}</td>` +
          `<td style="text-align:center">${shiftCell(m.nightHours)}</td><td>${opCell(m.nightOperator, m.nightCedula)}</td>` +
          `<td style="text-align:center">${m.hoursStopped ? m.hoursStopped.toLocaleString() : '—'}</td><td style="text-align:center">${m.overtime ? m.overtime.toLocaleString() : '—'}</td><td style="text-align:center;font-weight:700">${m.worked} h</td>` +
          `<td style="text-align:right;font-weight:700">${price ? usd(amount) : '—'}</td></tr>`
        );
      })
      .join('');
    // Totales del cierre.
    const tot = machs.reduce(
      (a, m) => {
        const price = priceOf(m);
        return {
          day: a.day + (Number(m.dayHours) || 0),
          night: a.night + (Number(m.nightHours) || 0),
          stopped: a.stopped + (Number(m.hoursStopped) || 0),
          extra: a.extra + (Number(m.overtime) || 0),
          worked: a.worked + (Number(m.worked) || 0),
          amount: a.amount + (Number(m.worked) || 0) / 12 * price,
        };
      },
      { day: 0, night: 0, stopped: 0, extra: 0, worked: 0, amount: 0 }
    );
    // Totales por EMPRESA (día, noche, total horas, trabajadas y monto).
    const byCompany = new Map<string, { day: number; night: number; worked: number; amount: number; machs: Set<string> }>();
    for (const m of machs) {
      const key = m.company || 'Sin empresa';
      const price = priceOf(m);
      const g = byCompany.get(key) ?? { day: 0, night: 0, worked: 0, amount: 0, machs: new Set<string>() };
      g.day += Number(m.dayHours) || 0;
      g.night += Number(m.nightHours) || 0;
      g.worked += Number(m.worked) || 0;
      g.amount += (Number(m.worked) || 0) / 12 * price;
      g.machs.add(m.machineId || m.serial || m.code);
      byCompany.set(key, g);
    }
    const companyRows = [...byCompany.entries()]
      .sort((a, b) => cmpText(a[0], b[0]))
      .map(([name, g]) =>
        `<tr><td style="font-weight:700">${name}</td>` +
        `<td style="text-align:center">${g.machs.size}</td>` +
        `<td style="text-align:center">${g.day} h</td>` +
        `<td style="text-align:center">${g.night} h</td>` +
        `<td style="text-align:center;font-weight:700">${g.worked} h</td>` +
        `<td style="text-align:right;font-weight:700">${usd(g.amount)}</td></tr>`
      )
      .join('');
    const byCompanyHtml = `
      <h2 style="margin-top:18px;font-size:14px;color:#1E3A5F">Totales por empresa</h2>
      <table class="empresas"><thead><tr><th>Empresa</th><th>Máquinas</th><th>☀️ Total día</th><th>🌙 Total noche</th><th>Total horas</th><th>Monto ($)</th></tr></thead>
      <tbody>${companyRows}</tbody></table>`;
    const foot = `<tfoot><tr>
      <td colspan="3" style="text-align:right;font-weight:800">TOTALES</td>
      <td style="text-align:center;font-weight:800">${tot.day} h</td><td></td>
      <td style="text-align:center;font-weight:800">${tot.night} h</td><td></td>
      <td style="text-align:center;font-weight:800">${tot.stopped} h</td>
      <td style="text-align:center;font-weight:800">${tot.extra} h</td>
      <td style="text-align:center;font-weight:800">${tot.worked} h</td>
      <td style="text-align:right;font-weight:800">${usd(tot.amount)}</td></tr></tfoot>`;
    const html = pdfDocument({
      title: 'Control de maquinaria',
      subtitle: `Cierre ${range}${closureCompany ? ` · ${closureCompany}` : ''} · ${new Set(machs.map((x) => x.machineId || x.serial || x.code)).size} máquina(s) · ${machs.length} registro(s)`,
      extraCss: `
        table{width:100%;border-collapse:collapse;margin-top:14px;font-size:10px}
        th,td{border:1px solid #ccc;padding:4px 6px;text-align:left}
        th{background:#1E3A5F;color:#fff}
        tfoot td{background:#EEF2F7}
        .note{color:#666;font-size:11px;margin-top:8px}
        .totals{display:flex;gap:12px;margin-top:14px}
        .totals .c{flex:1;border:1px solid #E5E7EB;border-radius:8px;padding:10px 12px;background:#FBFBFB}
        .totals .c.pay{background:#1E3A5F;border-color:#1E3A5F}
        .totals .c.pay .k,.totals .c.pay .v{color:#fff}
        .totals .k{color:#6B7280;font-size:11px;text-transform:uppercase;letter-spacing:.4px}
        .totals .v{font-weight:800;font-size:20px;color:#1E3A5F;margin-top:2px}
        table.empresas{width:100%;border-collapse:collapse;margin-top:6px;font-size:11px}
        table.empresas th,table.empresas td{border:1px solid #ccc;padding:5px 8px;text-align:left}
        table.empresas th{background:#1E3A5F;color:#fff}`,
      body: `
      <table><thead><tr><th>Fecha</th><th>Máquina</th><th>Empresa</th>
        <th>☀️ Día</th><th>Operador día</th><th>🌙 Noche</th><th>Operador noche</th>
        <th>H. PARADA</th><th>H. EXTRA</th><th>H. TRAB.</th><th>Monto ($)</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="11" style="text-align:center">Sin datos</td></tr>'}</tbody>${foot}</table>
      <div class="totals">
        <div class="c"><div class="k">Total de horas trabajadas</div><div class="v">${tot.worked} h</div></div>
        <div class="c"><div class="k">☀️ Total horas de día</div><div class="v">${tot.day} h</div></div>
        <div class="c"><div class="k">🌙 Total horas de noche</div><div class="v">${tot.night} h</div></div>
        <div class="c pay"><div class="k">💵 Total a pagar</div><div class="v">${usd(tot.amount)}</div></div>
      </div>
      ${byCompanyHtml}
      <p class="note">Trabajadas = (turno día + turno noche) − parada + extras · Monto = horas trabajadas × precio por hora (precio por jornada ÷ 12). Las horas paradas se descuentan del pago.</p>`,
    });
    const rngCie = dateRangeLabel(c.detail?.dateFrom ?? c.closure_date, c.detail?.dateTo ?? c.closure_date);
    await exportPdf(html, closureCompany ? `Cierre ${closureCompany} ${rngCie}` : `Cierre de control ${rngCie}`);
  };

  // Reporte RESUMEN de la semana actual: total de horas por empresa, por máquina (sin detalle) y total en $.
  // scope: '__all__' (general) o un company_id.
  const openSummary = async (scope: string, fromArg: string = sumFrom, toArg: string = sumTo) => {
    const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    // Resumen por RANGO de fecha (editable): incluye todas las empresas con
    // actividad en el rango, sumando también las jornadas ya cerradas.
    // Paginado: con >1000 rondas una consulta simple se truncaba (faltaban empresas/horas).
    const allRounds = await selectAllRows('machine_rounds', 'machinery_id, round_date, day_hours, night_hours, hours_stopped, overtime_hours, frozen_price', (q) => q.gte('round_date', fromArg).lte('round_date', toArg));
    // Una fila por (máquina, fecha) para no duplicar si hubiera varias rondas el mismo día.
    const byMD = new Map<string, any>();
    (allRounds ?? []).forEach((b: any) => {
      byMD.set(`${b.machinery_id}|${b.round_date}`, b);
    });
    // Precio actual de cada máquina (para las rondas NO cerradas).
    const priceOfMachine = new Map(machines.map((m) => [m.id, m.price_per_hour != null ? Number(m.price_per_hour) : 0]));
    const effectivePrice = (machineryId: string, ownFrozen: any) => {
      if (ownFrozen != null && Number(ownFrozen) > 0) return Number(ownFrozen);
      return priceOfMachine.get(machineryId) ?? 0;
    };
    const workedByMachine = new Map<string, number>();
    // Monto por máquina usando el precio EFECTIVO de cada ronda: congelado (frozen_price)
    // del rango si existe; si no, el precio ACTUAL de la máquina (sin arrastre).
    const amountByMachine = new Map<string, number>();
    byMD.forEach((b) => {
      const w = workedFromShifts(Number(b.day_hours ?? 0), Number(b.night_hours ?? 0), Number(b.hours_stopped ?? 0), Number(b.overtime_hours ?? 0));
      if (w > 0) {
        workedByMachine.set(b.machinery_id, (workedByMachine.get(b.machinery_id) ?? 0) + w);
        const p = effectivePrice(b.machinery_id, b.frozen_price);
        amountByMachine.set(b.machinery_id, (amountByMachine.get(b.machinery_id) ?? 0) + (w / 12) * p);
      }
    });
    const inScope = machines.filter((m) => (scope === '__all__' ? true : scope === '__none__' ? !m.company_id : m.company_id === scope) && inEncargado(m));
    // Agrupa por empresa → máquinas con sus totales (horas y $), sin detalle diario.
    type Row = { name: string; serial: string | null; worked: number; amount: number };
    type Viaje = { code: string; viajes: number; precio: number };
    const groups = new Map<string, { company: string; rows: Row[]; worked: number; amount: number; viajes: Viaje[]; viajesUSD: number }>();
    const getGroup = (cname: string) => {
      const g = groups.get(cname) ?? { company: cname, rows: [], worked: 0, amount: 0, viajes: [], viajesUSD: 0 };
      groups.set(cname, g);
      return g;
    };
    for (const m of inScope) {
      const worked = workedByMachine.get(m.id) ?? 0;
      if (worked <= 0) continue; // solo máquinas con actividad registrada
      const amount = amountByMachine.get(m.id) ?? 0; // suma por ronda con precio efectivo (congelado o actual)
      const cname = m.company_id ? companies[m.company_id] ?? 'Empresa' : 'Sin empresa';
      const g = getGroup(cname);
      g.rows.push({ name: m.code, serial: m.serial ?? null, worked, amount });
      g.worked += worked; g.amount += amount;
    }
    // Fletes/viajes CON FECHA dentro del rango del reporte: se suman al TOTAL POR PAGAR
    // de su empresa (solo aparecen en la semana en que ocurrieron).
    // Al filtrar por encargado, los fletes (que son por EMPRESA, no por encargado) se omiten
    // para no inflar el total con viajes de máquinas fuera del filtro.
    const fletes = encargadoSel.size > 0 ? [] : await selectAllRows('fletes', 'company_id, code, viajes, precio, company:company_id(name)', (qb) => qb.gte('flete_date', fromArg).lte('flete_date', toArg));
    (fletes ?? []).forEach((f: any) => {
      if (scope === '__none__') return;
      if (scope !== '__all__' && f.company_id !== scope) return;
      const v = Number(f.viajes) || 0;
      const precio = Number(f.precio) || 0;
      if (v <= 0 || precio <= 0) return;
      const cname = f.company?.name ?? 'Empresa';
      const g = getGroup(cname);
      g.viajes.push({ code: f.code || '—', viajes: v, precio });
      g.viajesUSD += v * precio;
    });
    const companyList = [...groups.values()].sort((a, b) => cmpText(a.company, b.company));
    // Alfabético por nombre de máquina (antes iba por horas trabajadas).
    companyList.forEach((g) => g.rows.sort((a, b) => cmpText(a.name, b.name)));
    const grandH = companyList.reduce((s, g) => s + g.worked, 0);
    const grandUSD = companyList.reduce((s, g) => s + g.amount, 0);
    const grandViajes = companyList.reduce((s, g) => s + g.viajesUSD, 0);

    // Bloque de VIAJES/FLETES por empresa: agrupa por precio unitario y suma al total.
    const renderViajes = (g: { company: string; amount: number; viajes: Viaje[]; viajesUSD: number }): string => {
      if (!g.viajes.length) return '';
      const byPrice = new Map<number, Viaje[]>();
      g.viajes.forEach((v) => { const a = byPrice.get(v.precio) ?? []; a.push(v); byPrice.set(v.precio, a); });
      const groupRows = [...byPrice.entries()].sort((a, b) => a[0] - b[0]).map(([precio, items]) => {
        const totV = items.reduce((s, v) => s + v.viajes, 0);
        const kinds = new Map<string, number>();
        items.forEach((v) => { const k = (v.code.split(/\s+/)[0] || v.code).toUpperCase(); kinds.set(k, (kinds.get(k) ?? 0) + v.viajes); });
        const detalle = [...kinds.entries()].map(([k, n]) => `${n} ${k}`).join(' · ');
        return `<tr><td style="padding:4px 8px;border:1px solid #ccc">TOTAL POR <b>${totV}</b> VIAJE${totV === 1 ? '' : 'S'}: ${detalle} <span style="color:#666">(${usd(precio)} c/u)</span></td><td style="text-align:right;font-weight:700;padding:4px 8px;border:1px solid #ccc">${usd(totV * precio)}</td></tr>`;
      }).join('');
      return `<table class="sum" style="margin-top:-2px">
        <tbody>${groupRows}
        <tr><td style="text-align:right;font-weight:800;background:#1E3A5F;color:#fff;border:1px solid #1E3A5F">TOTAL POR PAGAR ${g.company}</td>
          <td style="text-align:right;font-weight:800;background:#1E3A5F;color:#fff;border:1px solid #1E3A5F">${usd(g.amount + g.viajesUSD)}</td></tr>
        </tbody></table>`;
    };

    const sections = companyList
      .map((g) => {
        const rows = g.rows
          .map((r) =>
            `<tr><td>${r.name}${r.serial ? `<br/><span style="color:#888;font-size:9px">${r.serial}</span>` : ''}</td>` +
            `<td style="text-align:center;font-weight:700">${r.worked} h</td>` +
            `<td style="text-align:right;font-weight:700">${r.amount ? usd(r.amount) : '—'}</td></tr>`
          )
          .join('');
        return `
        <h3 class="emp">🏢 ${g.company} — ${g.rows.length} máquina(s) · ${g.worked} h · ${usd(g.amount)}${g.viajesUSD ? ` + ${usd(g.viajesUSD)} viajes` : ''}</h3>
        <table class="sum"><thead><tr><th>Máquina</th><th>Total horas</th><th>Total $</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td style="text-align:right;font-weight:800">TOTAL ${g.company} (jornadas)</td>
          <td style="text-align:center;font-weight:800">${g.worked} h</td>
          <td style="text-align:right;font-weight:800">${usd(g.amount)}</td></tr></tfoot></table>
        ${renderViajes(g)}`;
      })
      .join('');

    const scopeLabel = scope === '__all__' ? 'General — todas las empresas' : scope === '__none__' ? 'Sin empresa' : companies[scope] ?? 'Empresa';
    const rangeLabel = `${fmtDMY(fromArg)} → ${fmtDMY(toArg)}`;
    const html = pdfDocument({
      title: 'Resumen de maquinaria',
      subtitle: `${scopeLabel} · del ${rangeLabel}`,
      extraCss: `
        h3.emp{font-size:13px;font-weight:800;color:#1E3A5F;margin:16px 0 4px}
        table.sum{width:100%;border-collapse:collapse;font-size:11px}
        table.sum th,table.sum td{border:1px solid #ccc;padding:5px 8px;text-align:left}
        table.sum th{background:#1E3A5F;color:#fff}
        table.sum tfoot td{background:#EEF2F7}
        .grand{margin-top:16px;padding:10px 14px;background:#1E3A5F;color:#fff;font-weight:800;font-size:14px;border-radius:6px;text-align:right}`,
      body: `
        ${sections || '<p style="text-align:center;color:#888">Sin máquinas con actividad en la semana.</p>'}
        <div class="grand">Total general: ${grandH} h · jornadas ${usd(grandUSD)}${grandViajes ? ` + viajes ${usd(grandViajes)} = ${usd(grandUSD + grandViajes)}` : ''}</div>
        <p style="color:#666;font-size:11px;margin-top:8px">Horas = (turno día + turno noche) − parada + extras · Total $ = precio por jornada de 12 h × jornadas trabajadas · los viajes/fletes se suman aparte al TOTAL POR PAGAR.</p>`,
    });
    // Nombre del archivo: "Reporte EMPRESA del DD al DD" (con el rango del reporte).
    const rng = dateRangeLabel(fromArg, toArg);
    const sumFile = scope !== '__all__' && scope !== '__none__' ? `Reporte ${companies[scope] ?? 'Empresa'} ${rng}` : `Resumen de maquinaria ${rng}`;
    await exportPdf(html, sumFile);
  };

  // Reporte tipo CALENDARIO: días como columnas, empresas como filas. Cada celda = nº de
  // equipos de esa empresa que trabajaron ese día. Última columna = total de equipos de la
  // empresa que trabajaron en el rango. scope: '__all__' | '__none__' | company_id.
  const openCalendar = async (scope: string, fromArg: string = sumFrom, toArg: string = sumTo) => {
    // Lista de días del rango (tope de seguridad: 62 columnas).
    const days: string[] = [];
    for (let d = fromArg; d <= toArg && days.length < 62; d = addDaysISO(d, 1)) days.push(d);
    // Rondas del rango (paginado por si hay >1000).
    const allRounds = await selectAllRows('machine_rounds', 'machinery_id, round_date, day_hours, night_hours, hours_stopped, overtime_hours', (qb) => qb.gte('round_date', fromArg).lte('round_date', toArg));
    // Una fila por (máquina, fecha) para no duplicar; solo cuenta si trabajó ese día.
    const byMD = new Map<string, any>();
    (allRounds ?? []).forEach((b: any) => byMD.set(`${b.machinery_id}|${b.round_date}`, b));
    // Empresa de cada máquina (respetando el alcance elegido).
    const inScope = (m: Machinery) => (scope === '__all__' ? true : scope === '__none__' ? !m.company_id : m.company_id === scope) && inEncargado(m);
    const companyOf = new Map<string, string>();
    machines.forEach((m) => { if (inScope(m)) companyOf.set(m.id, m.company_id ? companies[m.company_id] ?? 'Empresa' : 'Sin empresa'); });
    // company → day → set de máquinas que trabajaron; company → set total de máquinas.
    const grid = new Map<string, Map<string, Set<string>>>();
    const totalByCompany = new Map<string, Set<string>>();
    const totalByDay = new Map<string, Set<string>>();
    byMD.forEach((b) => {
      const worked = workedFromShifts(Number(b.day_hours ?? 0), Number(b.night_hours ?? 0), Number(b.hours_stopped ?? 0), Number(b.overtime_hours ?? 0));
      if (worked <= 0) return;
      const cname = companyOf.get(b.machinery_id);
      if (!cname) return; // máquina fuera del alcance
      const day = b.round_date;
      if (!grid.has(cname)) grid.set(cname, new Map());
      const dm = grid.get(cname)!;
      if (!dm.has(day)) dm.set(day, new Set());
      dm.get(day)!.add(b.machinery_id);
      if (!totalByCompany.has(cname)) totalByCompany.set(cname, new Set());
      totalByCompany.get(cname)!.add(b.machinery_id);
      if (!totalByDay.has(day)) totalByDay.set(day, new Set());
      totalByDay.get(day)!.add(b.machinery_id);
    });
    const companyList = [...grid.keys()].sort((a, b) => (a === 'Sin empresa' ? 1 : b === 'Sin empresa' ? -1 : cmpText(a, b)));
    const dayTh = days.map((d) => `<th>${dayLabel(d).replace(' ', '<br/>')}</th>`).join('');
    const rowsHtml = companyList
      .map((cname) => {
        const dm = grid.get(cname)!;
        const cells = days
          .map((d) => {
            const n = dm.get(d)?.size ?? 0;
            return `<td style="text-align:center${n ? ';font-weight:700;background:#EAF2FB' : ';color:#bbb'}">${n || '·'}</td>`;
          })
          .join('');
        return `<tr><td style="font-weight:700">🏢 ${cname}</td>${cells}<td style="text-align:center;font-weight:800;background:#1E3A5F;color:#fff">${totalByCompany.get(cname)!.size}</td></tr>`;
      })
      .join('');
    const footCells = days.map((d) => `<td style="text-align:center;font-weight:800">${totalByDay.get(d)?.size ?? 0}</td>`).join('');
    const grandTotal = new Set<string>();
    totalByCompany.forEach((set) => set.forEach((id) => grandTotal.add(id)));
    const scopeLabel = scope === '__all__' ? 'Todas las empresas' : scope === '__none__' ? 'Sin empresa' : companies[scope] ?? 'Empresa';
    const html = pdfDocument({
      title: 'Calendario de trabajo por empresa',
      subtitle: `${scopeLabel} · del ${fmtDMY(fromArg)} al ${fmtDMY(toArg)} · ${days.length} día(s)`,
      extraCss: `
        @page{size:landscape;margin:2cm}
        table{width:100%;border-collapse:collapse;margin-top:12px;font-size:11px}
        th,td{border:1px solid #ccc;padding:5px 6px}
        th{background:#1E3A5F;color:#fff;text-align:center;font-size:10px}
        tfoot td{background:#EEF2F7}
        .note{color:#666;font-size:11px;margin-top:10px}
        .legend{margin-top:6px;color:#444;font-size:11px}`,
      body: `
      <table>
        <thead><tr><th style="text-align:left">Empresa</th>${dayTh}<th>Total<br/>equipos</th></tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="${days.length + 2}" style="text-align:center">Sin equipos con trabajo en el rango.</td></tr>`}</tbody>
        <tfoot><tr><td style="text-align:right;font-weight:800">Equipos por día →</td>${footCells}<td style="text-align:center;font-weight:800;background:#1E3A5F;color:#fff">${grandTotal.size}</td></tr></tfoot>
      </table>
      <p class="legend">Cada celda = nº de equipos de la empresa que trabajaron ese día. La última columna es el total de equipos distintos que trabajaron en el rango.</p>
      <p class="note">Un equipo "trabajó" un día si tuvo horas de turno (día o noche) registradas. Rango: ${fmtDMY(fromArg)} → ${fmtDMY(toArg)}.</p>`,
    });
    const rngCal = dateRangeLabel(fromArg, toArg);
    const calFile = scope !== '__all__' && scope !== '__none__' ? `Calendario ${companies[scope] ?? 'Empresa'} ${rngCal}` : `Calendario de empresas ${rngCal}`;
    await exportPdf(html, calFile);
  };

  const setMoveDate = async (m: Machinery, field: 'entry_date' | 'exit_date', value: string | null) => {
    const { error } = await supabase.from('machinery').update({ [field]: value }).eq('id', m.id);
    if (error) return toast.error(error.message);
    setMachines((prev) => prev.map((x) => (x.id === m.id ? ({ ...x, [field]: value } as Machinery) : x)));
  };

  // Marca/limpia la ENTRADA o SALIDA guardando el MOMENTO exacto (fecha + hora).
  // Desde la entrada se cuenta que la máquina empieza a trabajar.
  const setMove = async (m: Machinery, kind: 'entry' | 'exit', on: boolean) => {
    const patch = on
      ? { [`${kind}_date`]: date, [`${kind}_at`]: new Date().toISOString() }
      : { [`${kind}_date`]: null, [`${kind}_at`]: null };
    const { error } = await supabase.from('machinery').update(patch).eq('id', m.id);
    if (error) return toast.error(error.message);
    setMachines((prev) => prev.map((x) => (x.id === m.id ? ({ ...x, ...patch } as Machinery) : x)));
  };

  // ── "En espera" (por recibir) ─────────────────────────────────────────────
  // Una máquina "en espera" está No operativa: no aparece en el control activo.
  // "Recibir" la pone operativa y guarda la fecha de entrada (hoy) para el control.
  const recibir = async (m: Machinery) => {
    // Cada máquina puede ingresar en una fecha distinta (la elige en su tarjeta; por defecto hoy).
    const d = recibirDate[m.id] || todayISO();
    setBusyRecibir(m.id);
    // Recibir = sale de "en espera", queda Operativa y se guarda la fecha de entrada al control.
    const patch = { en_espera: false, operational: true, entry_date: d, entry_at: new Date(`${d}T12:00:00`).toISOString() };
    const { error } = await supabase.from('machinery').update(patch).eq('id', m.id);
    setBusyRecibir(null);
    if (error) return toast.error(error.message);
    setMachines((prev) => prev.map((x) => (x.id === m.id ? ({ ...x, ...patch } as Machinery) : x)));
    setNotice(`✅ ${m.code} recibida · entrada ${d}. Ya está en el control.`);
  };

  // Manda una máquina a "En espera por recepción". Sale del control activo (no toca No operativa).
  const ponerEnEspera = async (m: Machinery) => {
    const { error } = await supabase.from('machinery').update({ en_espera: true }).eq('id', m.id);
    if (error) return toast.error(error.message);
    setMachines((prev) => prev.map((x) => (x.id === m.id ? ({ ...x, en_espera: true } as Machinery) : x)));
    setNotice(`🕓 ${m.code} puesta en espera (por recepción).`);
  };

  // ── Flete / viaje: registrar cuántos viajes hizo el equipo y a qué precio, con su fecha.
  //    El monto (viajes × precio) se suma al TOTAL POR PAGAR de la empresa en la semana de esa fecha.
  const openFlete = (m: Machinery) => {
    setFleteDelConfirm(null);
    setFleteGeneralCo(null);
    setFleteFor(m);
    setFleteDate(weekEnd); // por defecto el último día del bloque en pantalla
    setFleteViajes('');
    setFletePrecio('');
  };

  // Flete GENERAL de una empresa (sin máquina): mismo modal, se guarda con machinery_id nulo.
  const openFleteGeneral = (companyId: string, companyName: string) => {
    setFleteDelConfirm(null);
    setFleteFor(null);
    setFleteGeneralCo({ id: companyId, name: companyName });
    setFleteDate(weekEnd);
    setFleteViajes('');
    setFletePrecio('');
  };

  const saveFlete = async () => {
    if (!fleteFor && !fleteGeneralCo) return;
    const viajes = Math.max(0, Math.round(Number(fleteViajes.replace(',', '.')) || 0));
    const precio = Math.max(0, Number(fletePrecio.replace(',', '.')) || 0);
    if (viajes <= 0 || precio <= 0) { toast.error('Indica el nº de viajes y el precio por viaje.'); return; }
    // General → company_id de la empresa; por equipo → company_id de la máquina.
    const companyId = fleteGeneralCo ? fleteGeneralCo.id : fleteFor?.company_id ?? null;
    if (!companyId) { toast.error('La máquina no tiene empresa asignada; asígnale una en Equipos para poder registrar su flete.'); return; }
    setFleteBusy(true);
    const payload = {
      company_id: companyId,
      machinery_id: fleteGeneralCo ? null : fleteFor!.id,
      code: fleteGeneralCo ? 'General' : fleteFor!.code,
      flete_date: fleteDate, viajes, precio,
    };
    const { data, error } = await supabase.from('fletes').insert(payload).select().single();
    setFleteBusy(false);
    if (error) return toast.error(error.message);
    // Solo se agrega a la lista visible si la fecha cae dentro del bloque.
    if (weekDays.includes(fleteDate)) {
      if (fleteGeneralCo) setFletesGeneral((p) => ({ ...p, [companyId]: [...(p[companyId] ?? []), data] }));
      else setFletesByMachine((p) => ({ ...p, [fleteFor!.id]: [...(p[fleteFor!.id] ?? []), data] }));
    }
    setFleteViajes(''); setFletePrecio('');
    const donde = fleteGeneralCo ? `${fleteGeneralCo.name} (general)` : fleteFor!.code;
    setNotice(`✅ Flete registrado en ${donde}: ${viajes} viaje(s) × $${precio.toLocaleString()} = $${(viajes * precio).toLocaleString()} · ${fmtDMY(fleteDate)}`);
  };

  // Borra el flete SIN el diálogo global (que queda tapado bajo el modal de fletes).
  // La confirmación se hace en línea dentro del modal (dos toques).
  const deleteFlete = async (f: any) => {
    setFleteDelConfirm(null);
    const { error } = await supabase.from('fletes').delete().eq('id', f.id);
    if (error) return toast.error(error.message);
    if (f.machinery_id) setFletesByMachine((p) => ({ ...p, [f.machinery_id]: (p[f.machinery_id] ?? []).filter((x) => x.id !== f.id) }));
    else if (f.company_id) setFletesGeneral((p) => ({ ...p, [f.company_id]: (p[f.company_id] ?? []).filter((x) => x.id !== f.id) }));
  };

  // ── Marcar equipo AVERIADO (desde el control) ───────────────────────────────
  // Abre el flujo empresa → máquina → motivo. Al confirmar deja la máquina No
  // operativa y crea la traza de reparación (correctivo) que Mantenimiento gestiona.
  const openAveria = () => {
    setAveriaCompany(companyFilter !== '__all__' ? companyFilter : null);
    setAveriaCompanyOpen(companyFilter === '__all__');
    setAveriaMachine(null); setAveriaMachineOpen(false); setAveriaMachQ(''); setAveriaNota('');
    setAveriaOpen(true);
  };
  const closeAveria = () => {
    setAveriaOpen(false); setAveriaCompany(null); setAveriaCompanyOpen(false);
    setAveriaMachine(null); setAveriaMachineOpen(false); setAveriaMachQ(''); setAveriaNota('');
  };
  const marcarAveriada = async () => {
    if (!averiaMachine) return;
    setAveriaBusy(true);
    const m = averiaMachine;
    const nota = averiaNota.trim() || null;
    // 1) Estado del sistema: No operativa (averiada). Esto es lo esencial.
    const { error: eOp } = await supabase.from('machinery').update({ operational: false }).eq('id', m.id);
    if (eOp) { setAveriaBusy(false); setNotice(`❌ No se pudo marcar averiada: ${eOp.message}`); return; }
    // 2) Traza de reparación para que Mantenimiento la gestione (retorno operativo).
    const { error: eRep } = await supabase.from('machinery_repairs').insert({
      machinery_id: m.id, tipo: 'correctivo', out_at: todayISO(),
      estimated_note: nota, status: 'en_reparacion', created_by: session?.user?.id ?? null,
    });
    setAveriaBusy(false);
    setMachines((prev) => prev.map((x) => (x.id === m.id ? ({ ...x, operational: false } as Machinery) : x)));
    closeAveria();
    setNotice(
      `⚠️ ${m.code} quedó marcada como AVERIADA (No operativa).` +
      (eRep ? ' No se pudo registrar la traza de reparación, pero el equipo ya salió del control.' : ' Gestiona su reparación en Mantenimiento de Maquinaria.')
    );
  };

  const openPrice = (m: Machinery) => {
    if (!puedeEditarPrecio) { setNotice('🔒 Tu rol (analista) no puede modificar precios. Solo puedes INGRESAR horas nuevas (no modificar las ya cargadas).'); return; }
    setPriceFor(m);
    setPriceInput(m.price_per_hour != null ? String(m.price_per_hour) : '');
    setPriceBlindar(true); // por defecto BLINDA el precio a esas fechas
    // Por defecto aplica al RANGO COMPLETO del reporte (sumFrom→sumTo). Es el período que
    // se está cuajando (p. ej. 26→05, que abarca más de una semana): así el precio cubre
    // TODAS las jornadas del período y no queda una mezcla de precios por días sin estampar.
    setPriceFrom(sumFrom);
    setPriceTo(sumTo);
  };

  // Guarda el precio ATÁNDOLO al rango de fechas elegido: congela ese precio en cada
  // jornada del rango (frozen_price) para que el reporte de ESE corte use ese número y
  // NO se vea afectado si luego cambias el precio para otro rango. Además guarda el
  // precio en la máquina como valor por defecto para fechas aún sin precio fijado.
  const savePrice = async (m: Machinery, value: string) => {
    if (!puedeEditarPrecio) { setNotice('🔒 Tu rol (analista) no puede modificar precios.'); setPriceFor(null); return; }
    const n = Number(value.replace(',', '.'));
    const val = value.trim() === '' ? null : isFinite(n) && n >= 0 ? n : null;
    const from = priceFrom, to = priceTo;
    if (!from || !to || from > to) { toast.error('Elige un rango válido (desde ≤ hasta) al que aplicar el precio.'); return; }
    setSavingPrice(true);
    try {
      // 1) Precio por defecto de la máquina (para fechas futuras/sin precio fijado).
      const { error: e1 } = await supabase.from('machinery').update({ price_per_hour: val }).eq('id', m.id);
      if (e1) throw e1;
      // 2) BLINDAR: si el switch está activo, CLAVA ese precio SOLO en las jornadas del
      //    rango elegido (frozen_price). Queda fijo para esas fechas: si el precio sube en
      //    otra semana, esta NO cambia; si lo modificas, solo afecta esta semana. Un precio
      //    nulo/0 "descongela" el rango (vuelve al precio por defecto de la máquina).
      if (priceBlindar) {
        const { error: e2 } = await supabase.from('machine_rounds')
          .update({ frozen_price: val && val > 0 ? val : null })
          .eq('machinery_id', m.id).gte('round_date', from).lte('round_date', to);
        if (e2) throw e2;
      }
      setMachines((prev) => prev.map((x) => (x.id === m.id ? ({ ...x, price_per_hour: val } as Machinery) : x)));
      setPriceFor(null);
      setNotice(priceBlindar
        ? `🔒 Precio ${val != null ? `$${val.toLocaleString()}` : '(sin precio)'} BLINDADO en ${m.code} del ${from} al ${to}. Queda fijo para esas fechas y no afecta otros cortes.`
        : `✅ Precio ${val != null ? `$${val.toLocaleString()}` : '(sin precio)'} de ${m.code} actualizado (sin blindar: aplica a fechas sin precio fijo).`);
      load(true);
    } catch (err: any) {
      toast.error(err?.message ?? 'No se pudo guardar el precio.');
    } finally {
      setSavingPrice(false);
    }
  };

  const q = norm(query.trim());
  const matchCompany = (m: Machinery) =>
    companyFilter === '__all__' ? true : companyFilter === '__none__' ? !m.company_id : m.company_id === companyFilter;
  const matchText = (m: Machinery) =>
    !q ||
    norm(m.code).includes(q) ||
    norm(m.serial).includes(q) ||
    norm(m.plate).includes(q) ||
    norm(m.identifier).includes(q) ||
    norm(m.tipo).includes(q) ||
    (m.company_id ? norm(companies[m.company_id]).includes(q) : false);
  // El control SOLO muestra equipos ACTIVOS: si una máquina se desactiva (active=false)
  // desaparece del control; al reactivarla, vuelve a aparecer automáticamente.
  // "Activa" para el control semanal: OPERATIVA (operational). Una máquina marcada
  // INACTIVA (No operativa) no aparece en la semana; sus horas ya trabajadas quedan
  // guardadas (no se borran) y siguen en los reportes/cierre (que leen machine_rounds
  // directo, sin filtrar por estado). Al volverla Operativa reaparece.
  // NOTA: la bandera legada `active` ya no se usa para maquinaria (no hay botón que la
  // apague; el estado se maneja con Operativa/Inactiva y En espera). No se filtra por
  // ella para que Control y Equipos muestren siempre lo mismo.
  const esActiva = (m: Machinery) => m.operational !== false;
  // Máquinas que YA trabajaron en el corte visible (tienen horas esta semana). Si una
  // máquina se marca Inactiva pero ya trabajó en esta semana, NO debe desaparecer del
  // control ni del reporte de ese corte (sus horas y su pago siguen contando). Como
  // `rounds` solo trae los días visibles, esto solo la mantiene en la semana donde tiene
  // horas; en semanas posteriores (sin horas) ya no aparece.
  // RENDIMIENTO: solo depende de `rounds`; antes se reconstruía el Set en cada render/tecla.
  const conHorasEstaSemana = useMemo(() => {
    const s = new Set<string>();
    Object.values(rounds).forEach((b: any) => {
      const h = Number(b.day_hours ?? 0) + Number(b.night_hours ?? 0) + Number(b.overtime_hours ?? 0) + Number(b.hours_stopped ?? 0);
      if (h > 0) s.add(b.machinery_id);
    });
    return s;
  }, [rounds]);
  // RENDIMIENTO: horas trabajadas del BLOQUE por máquina, precomputadas en UN solo pase por
  // `rounds`. Antes cada tarjeta hacía `weekDays.reduce(...)` y además el total por empresa
  // repetía el mismo reduce → O(máquinas×días) por render. Ahora la tarjeta y el total leen
  // este Map en O(1). Se cuentan solo las rondas cuyo día está en el bloque visible (mismo
  // criterio que sumar rounds[rkey(m.id, d)] sobre weekDays).
  const workedByMachine = useMemo(() => {
    const daySet = new Set(weekDays);
    const map = new Map<string, number>();
    Object.values(rounds).forEach((b: any) => {
      if (!daySet.has(b.round_date)) return;
      const w = workedFromShifts(Number(b.day_hours ?? 0), Number(b.night_hours ?? 0), Number(b.hours_stopped ?? 0), Number(b.overtime_hours ?? 0));
      map.set(b.machinery_id, (map.get(b.machinery_id) ?? 0) + w);
    });
    return map;
  }, [rounds, weekDays]);
  const enControl = (m: Machinery) => esActiva(m) || conHorasEstaSemana.has(m.id);
  // Al BUSCAR se ignora el filtro de empresa: así encuentras un equipo por código/serial/
  // placa aunque esté en otra empresa (p. ej. uno recién agregado). Sin búsqueda, aplica
  // el filtro de empresa normal.
  const matchCompanyOrSearch = (m: Machinery) => (q ? true : matchCompany(m));
  // Filtro por encargado (multi-check; vacío = todos). Se ignora al BUSCAR (como empresa).
  const matchEncargado = (m: Machinery) => q ? true : inEncargado(m);
  // El control activo NO muestra las máquinas en espera por recepción: esas van a su sección.
  // RENDIMIENTO: lista base filtrada; antes se recalculaba en cada render/tecla. Deps = todo
  // lo que leen los predicados: machines (código/estado/empresa/encargado), el Set de horas,
  // el texto de búsqueda `q`, el filtro de empresa, la selección de encargados y `companies`.
  const shown = useMemo(
    () => machines.filter((m) => enControl(m) && !m.en_espera && matchCompanyOrSearch(m) && matchEncargado(m) && matchText(m)),
    [machines, conHorasEstaSemana, q, companyFilter, encargadoSel, companies],
  );
  // Máquinas EN ESPERA por recepción (por recibir), agrupadas por empresa.
  const enEspera = machines.filter((m) => esActiva(m) && m.en_espera && matchCompanyOrSearch(m) && matchText(m));
  const enEsperaByCompany = (() => {
    const map = new Map<string, { key: string; name: string; items: Machinery[] }>();
    enEspera.forEach((it) => {
      const k = it.company_id ?? '__none__';
      const name = it.company_id ? companies[it.company_id] || 'Empresa' : 'Sin empresa';
      const g = map.get(k) ?? { key: k, name, items: [] };
      g.items.push(it);
      map.set(k, g);
    });
    const list = Array.from(map.values()).sort((a, b) => a.name === 'Sin empresa' ? 1 : b.name === 'Sin empresa' ? -1 : cmpText(a.name, b.name));
    list.forEach((g) => g.items.sort((a, b) => cmpText(a.code, b.code)));
    return list;
  })();

  // Opciones de empresa (con conteo) para el filtro desplegable. Cuenta las máquinas
  // que están en el control esta semana: operativas + inactivas que ya trabajaron.
  // RENDIMIENTO: base del control (operativas + inactivas con horas), memoizada.
  const activasControl = useMemo(() => machines.filter((m) => enControl(m) && !m.en_espera), [machines, conHorasEstaSemana]);
  // RENDIMIENTO: antes, por CADA empresa se hacía un `.filter` sobre todas las máquinas
  // (O(empresas×máquinas)). Ahora se cuenta en UN solo pase agrupando por company_id.
  const companyOptions = useMemo(() => {
    const counts = new Map<string, number>();
    let sinEmpresa = 0;
    activasControl.forEach((m) => {
      if (m.company_id) counts.set(m.company_id, (counts.get(m.company_id) ?? 0) + 1);
      else sinEmpresa += 1;
    });
    return [
      { label: 'Todas las empresas', value: '__all__', count: activasControl.length },
      ...Object.entries(companies)
        .map(([id, name]) => ({ label: name, value: id, count: counts.get(id) ?? 0 }))
        .filter((o) => o.count > 0)
        .sort((a, b) => cmpText(a.label, b.label)),
      { label: 'Sin empresa', value: '__none__', count: sinEmpresa },
    ];
  }, [activasControl, companies]);
  const companyFilterLabel = companyOptions.find((o) => o.value === companyFilter)?.label ?? 'Todas las empresas';
  // Opciones de ENCARGADO (distintos, con conteo) — sobre las máquinas del control que
  // pasan el filtro de empresa. Buscable y multi-check.
  const encargadoOptions = useMemo(() => {
    const base = activasControl.filter((m) => matchCompany(m));
    // Agrupa por clave canónica (unifica variantes). Por clave: conteo total + qué
    // etiqueta cruda se usó y cuántas veces, para mostrar la variante MÁS común.
    const grp = new Map<string, { count: number; labels: Map<string, number> }>();
    base.forEach((m) => {
      const k = encKey(m.encargado);
      const label = k === SIN_ENCARGADO ? SIN_ENCARGADO : String(m.encargado ?? '').trim().replace(/\s+/g, ' ');
      const e = grp.get(k) ?? { count: 0, labels: new Map<string, number>() };
      e.count += 1;
      e.labels.set(label, (e.labels.get(label) || 0) + 1);
      grp.set(k, e);
    });
    return Array.from(grp.entries())
      .map(([key, e]) => {
        // Display = variante más frecuente; empate → orden natural (cmpText).
        const name = Array.from(e.labels.entries()).sort((a, b) => b[1] - a[1] || cmpText(a[0], b[0]))[0][0];
        return { key, name, count: e.count };
      })
      .sort((a, b) => a.key === SIN_ENCARGADO ? 1 : b.key === SIN_ENCARGADO ? -1 : cmpText(a.name, b.name));
  // RENDIMIENTO: solo cambia con la base del control o el filtro de empresa (matchCompany).
  }, [activasControl, companyFilter]);
  const encargadoShown = encargadoOptions.filter((o) => !encargadoQuery.trim() || norm(o.name).includes(norm(encargadoQuery.trim())));
  // Empresa seleccionada para sincronizar el reporte (null = todas).
  const reportCompanyName =
    companyFilter === '__all__' ? null : companyFilter === '__none__' ? 'Sin empresa' : companies[companyFilter] ?? null;

  // Agrupa las máquinas mostradas por empresa (acordeón, como en el catálogo).
  const machinesByCompany = useMemo(() => {
    const map = new Map<string, { key: string; name: string; items: Machinery[] }>();
    shown.forEach((it) => {
      const k = it.company_id ?? '__none__';
      const name = it.company_id ? companies[it.company_id] || 'Empresa' : 'Sin empresa';
      const g = map.get(k) ?? { key: k, name, items: [] };
      g.items.push(it);
      map.set(k, g);
    });
    const list = Array.from(map.values()).sort((a, b) => a.name === 'Sin empresa' ? 1 : b.name === 'Sin empresa' ? -1 : cmpText(a.name, b.name));
    list.forEach((g) => g.items.sort((a, b) => cmpText(a.code, b.code)));
    return list;
  // RENDIMIENTO: solo depende de las máquinas mostradas y del nombre de empresa.
  }, [shown, companies]);

  // ── Datos para "Marcar equipo averiado" ─────────────────────────────────────
  // Empresas con al menos una máquina operativa (candidatas a tener un equipo averiado).
  // RENDIMIENTO: antes, por CADA empresa un `.filter` sobre todas las máquinas
  // (O(empresas×máquinas)). Ahora se cuentan las operativas en UN solo pase por company_id.
  const averiaCompanyOptions = useMemo(() => {
    const counts = new Map<string, number>();
    let sinEmpresa = 0;
    machines.forEach((m) => {
      if (m.operational === false) return;
      if (m.company_id) counts.set(m.company_id, (counts.get(m.company_id) ?? 0) + 1);
      else sinEmpresa += 1;
    });
    const opts = Object.entries(companies)
      .map(([id, name]) => ({ value: id, name, count: counts.get(id) ?? 0 }))
      .filter((o) => o.count > 0)
      .sort((a, b) => cmpText(a.name, b.name));
    if (sinEmpresa > 0) opts.push({ value: '__none__', name: 'Sin empresa', count: sinEmpresa });
    return opts;
  }, [machines, companies]);
  const averiaCompanyLabel = averiaCompany
    ? (averiaCompany === '__none__' ? 'Sin empresa' : companies[averiaCompany] ?? 'Empresa')
    : null;
  // Máquinas operativas de la empresa elegida (candidatas a marcar averiadas), con búsqueda.
  const averiaMachineList = (() => {
    if (!averiaCompany) return [] as Machinery[];
    const q = norm(averiaMachQ.trim());
    return machines
      .filter((m) => (averiaCompany === '__none__' ? !m.company_id : m.company_id === averiaCompany) && m.operational !== false)
      .filter((m) => !q || norm(m.code).includes(q) || norm(m.serial).includes(q) || norm(m.plate).includes(q) || norm(m.tipo).includes(q))
      .sort((a, b) => cmpText(a.code, b.code));
  })();

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Control de maquinaria</SectionTitle>

      {notice ? (
        <TouchableOpacity onPress={() => setNotice(null)}>
          <View style={{ backgroundColor: colors.surfaceAlt, borderLeftWidth: 4, borderLeftColor: colors.brand, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm }}>
            <Text style={{ color: colors.text, fontSize: 13 }}>{notice}</Text>
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>Toca para cerrar</Text>
          </View>
        </TouchableOpacity>
      ) : null}

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
        <TouchableOpacity
          onPress={cerrarControl}
          disabled={closing}
          style={{ flex: 2, paddingVertical: spacing.md, backgroundColor: colors.danger, borderRadius: radius.md, alignItems: 'center' }}
        >
          <Text style={{ color: '#fff', fontWeight: '800' }}>{closing ? 'Cerrando…' : '🔒 Cerrar control'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={openHistorico}
          style={{ flex: 1, paddingVertical: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border }}
        >
          <Text style={{ color: colors.text, fontWeight: '700' }}>🗂️ Histórico</Text>
        </TouchableOpacity>
      </View>

      {/* Marcar un equipo AVERIADO: empresa → máquina (serial/placa) → queda No operativa. */}
      <TouchableOpacity
        onPress={openAveria}
        style={{ paddingVertical: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.warning, marginBottom: spacing.sm }}
      >
        <Text style={{ color: colors.warning, fontWeight: '800' }}>⚠️ Marcar equipo averiado</Text>
      </TouchableOpacity>

      <Card>
        <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 2 }}>Semana del control · elige cualquier día en el calendario</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <TouchableOpacity
            onPress={() => setDate(shiftDay(weekStart, -7))}
            style={{ paddingVertical: spacing.sm, paddingHorizontal: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}
          >
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>◀</Text>
          </TouchableOpacity>
          <View style={{ flex: 1, minWidth: 0 }}>
            <DateField value={date} onChange={(v) => v && setDate(v)} />
          </View>
          <TouchableOpacity
            onPress={() => setDate(shiftDay(weekStart, 7))}
            style={{ paddingVertical: spacing.sm, paddingHorizontal: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}
          >
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>▶</Text>
          </TouchableOpacity>
        </View>
        <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 14, marginTop: spacing.xs }}>
          🗓️ {dayLabel(weekStart)} → {dayLabel(weekEnd)} · {dayCount} día(s)
        </Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, alignItems: 'center' }}>
          <TouchableOpacity
            onPress={() => setDate(todayISO())}
            style={{ flex: 1, paddingVertical: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border }}
          >
            <Text style={{ color: colors.text, fontWeight: '700' }}>📅 Esta semana</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setSummaryOpen((v) => !v)}
            style={{ flex: 1, paddingVertical: spacing.sm, backgroundColor: colors.brand, borderRadius: radius.md, alignItems: 'center' }}
          >
            <Text style={{ color: colors.brandContrast, fontWeight: '700' }}>📊 Ver reporte {summaryOpen ? '▴' : '▾'}</Text>
          </TouchableOpacity>
        </View>

        {/* Reporte resumen: chips (General + por empresa) → abren la previa del PDF (horas y $, sin detalle). */}
        {summaryOpen ? (
          <View style={{ marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
              Resumen por rango de fecha: total de horas por empresa y por máquina (sin detalle) + total en $. Toca un chip para ver la previa del PDF.
            </Text>
            {/* Rango editable del reporte (por defecto la semana base 26/06 → 05/07). */}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Desde</Text>
                <DateField value={sumFrom} onChange={setSumFrom} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Hasta</Text>
                <DateField value={sumTo} onChange={setSumTo} />
              </View>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
              {[
                { label: 'Semana base', fn: () => { setSumFrom(PERIODO_INICIO); setSumTo(PERIODO_CORTE); } },
                { label: '− 1 día', fn: () => setSumTo((t) => addDaysISO(t, -1)) },
                { label: '+ 1 día', fn: () => setSumTo((t) => addDaysISO(t, 1)) },
                { label: '+ 1 semana', fn: () => setSumTo((t) => addDaysISO(t, 7)) },
              ].map((b) => (
                <TouchableOpacity key={b.label} onPress={b.fn} style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}>
                  <Text style={{ color: colors.text, fontSize: 12 }}>{b.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {([{ label: '📊 General', value: '__all__' }, ...companyOptions
                .filter((o) => o.value !== '__all__' && o.count > 0)
                .map((o) => ({ label: `🏢 ${o.label}`, value: o.value }))]).map((chip) => (
                <TouchableOpacity
                  key={chip.value}
                  onPress={() => openSummary(chip.value)}
                  activeOpacity={0.7}
                  style={{ paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.brand, backgroundColor: chip.value === '__all__' ? colors.brand : colors.surfaceAlt }}
                >
                  <Text style={{ color: chip.value === '__all__' ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{chip.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Reporte tipo CALENDARIO: empresas que trabajaron y nº de equipos por día. */}
            <TouchableOpacity
              onPress={() => openCalendar(companyFilter, sumFrom, sumTo)}
              activeOpacity={0.8}
              style={{ marginTop: spacing.sm, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.brand }}
            >
              <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 14 }}>🗓️ Calendario de empresas (equipos por día)</Text>
              <Text style={{ color: colors.brandContrast, opacity: 0.8, fontSize: 11, marginTop: 2 }}>Días en columnas · empresas en filas · total de equipos</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {/* Días del bloque: por defecto 7, pero se pueden añadir (8, 10, …). */}
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, alignItems: 'center' }}>
          <Text style={{ color: colors.muted, fontSize: 12, flex: 1 }}>Días en el bloque: {dayCount}</Text>
          <TouchableOpacity
            onPress={() => setDayCount((n) => Math.max(1, n - 1))}
            style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}
          >
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>−</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setDayCount((n) => Math.min(31, n + 1))}
            style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.md, backgroundColor: colors.brand, borderRadius: radius.md }}
          >
            <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 16 }}>+ día</Text>
          </TouchableOpacity>
        </View>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>
          Cada máquina muestra el bloque completo. Por día marca turno de día y de noche (Medio 6h / Completo 12h); cada jornada puede tener su operador.
        </Text>
      </Card>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="🔎 Buscar por nombre, serial o empresa…"
        placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: spacing.sm }}
      />

      {/* Filtro por empresa (desplegable). Al elegir una, el reporte se sincroniza con ella. */}
      <View style={{ marginBottom: spacing.sm }}>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Empresa (se trabaja y se reporta sobre estas máquinas)</Text>
        <TouchableOpacity
          onPress={() => setCompanyPickerOpen(true)}
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}
        >
          <Text style={{ color: colors.text, fontWeight: '700' }}>🏢 {companyFilterLabel}</Text>
          <Text style={{ color: colors.muted, fontSize: 16 }}>▾</Text>
        </TouchableOpacity>
      </View>

      {/* Filtro por ENCARGADO: lista desplegable buscable con check (multi-selección). */}
      <View style={{ marginBottom: spacing.sm }}>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Encargado</Text>
        <TouchableOpacity
          onPress={() => setEncargadoOpen((v) => !v)}
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: encargadoOpen ? colors.brand : colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}
        >
          <Text style={{ color: encargadoSel.size > 0 ? colors.text : colors.muted, fontWeight: '700' }} numberOfLines={1}>
            👤 {encargadoSel.size === 0 ? 'Todos los encargados' : `${encargadoSel.size} seleccionado(s)`}
          </Text>
          <Text style={{ color: colors.brandText, fontSize: 16 }}>{encargadoOpen ? '▴' : '▾'}</Text>
        </TouchableOpacity>
        {encargadoOpen ? (
          <View style={{ borderWidth: 1, borderColor: colors.brand, borderTopWidth: 0, borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md, padding: spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, marginBottom: spacing.xs }}>
              <Text style={{ fontSize: 13 }}>🔎</Text>
              <TextInput value={encargadoQuery} onChangeText={setEncargadoQuery} placeholder="Buscar encargado…" placeholderTextColor={colors.muted} style={{ flex: 1, color: colors.text, paddingVertical: spacing.xs, paddingHorizontal: spacing.xs }} />
            </View>
            <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {encargadoShown.map((o) => {
                const on = encargadoSel.has(o.key);
                return (
                  <TouchableOpacity key={o.key} onPress={() => toggleEncargado(o.key)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 9, paddingHorizontal: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: on ? colors.brand + '12' : 'transparent' }}>
                    <Text style={{ fontSize: 16 }}>{on ? '☑️' : '⬜'}</Text>
                    <Text style={{ color: colors.text, fontWeight: on ? '800' : '600', fontSize: 13, flex: 1 }} numberOfLines={1}>{o.name}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{o.count}</Text>
                  </TouchableOpacity>
                );
              })}
              {encargadoShown.length === 0 ? <Text style={{ color: colors.muted, fontSize: 12, padding: spacing.sm }}>Sin resultados.</Text> : null}
            </ScrollView>
            {encargadoSel.size > 0 ? (
              <TouchableOpacity onPress={() => setEncargadoSel(new Set())} style={{ marginTop: spacing.xs, alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 6, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 12 }}>Limpiar selección</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>

      {/* ── Sección EN ESPERA (por recibir): máquinas No operativas, agrupadas por empresa.
             "Recibir" las pone operativas y guarda la fecha de entrada (hoy) para el control. */}
      {enEspera.length > 0 ? (
        <View style={{ marginBottom: spacing.sm }}>
          <TouchableOpacity
            onPress={() => setEsperaOpen((v) => !v)}
            activeOpacity={0.7}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.warning, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 }}>
              <Text style={{ color: colors.warning, fontSize: 16 }}>{(esperaOpen || !!q) ? '▾' : '▸'}</Text>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>🕓 En espera (por recibir)</Text>
            </View>
            <View style={{ backgroundColor: colors.warning, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>{enEspera.length}</Text>
            </View>
          </TouchableOpacity>
          {(esperaOpen || !!q) ? (
            <View style={{ marginTop: spacing.sm }}>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
                Máquinas en espera por recepción. Al recibir una, pasa a Operativa, se guarda su fecha de entrada y entra al control.
              </Text>
              {enEsperaByCompany.map((g) => (
                <View key={g.key} style={{ marginBottom: spacing.sm }}>
                  <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 14, marginBottom: spacing.xs }}>
                    🏢 {g.name} <Text style={{ color: colors.muted, fontWeight: '600', fontSize: 12 }}>· {g.items.length}</Text>
                  </Text>
                  {g.items.map((m) => (
                    <Card key={m.id}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15 }}>{m.code}</Text>
                          {m.identifier || m.plate || m.serial ? (
                            <Text style={{ color: colors.muted, fontSize: 12 }}>
                              🔖 {[m.identifier ? `ID ${m.identifier}` : '', m.plate ? `Placa ${m.plate}` : '', m.serial ? `Serial ${m.serial}` : ''].filter(Boolean).join(' · ')}
                            </Text>
                          ) : null}
                          {m.encargado ? <Text style={{ color: colors.muted, fontSize: 12 }}>👤 {m.encargado}</Text> : null}
                          <Text style={{ color: colors.warning, fontSize: 12, fontWeight: '700', marginTop: 2 }}>🕓 En espera por recepción{m.operational === false ? ' · No operativa' : ''}</Text>
                        </View>
                      </View>
                      {/* Fecha de entrada de ESTA máquina (cada una puede ingresar en fecha distinta). */}
                      <View style={{ marginTop: spacing.sm }}>
                        <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>📅 Fecha de entrada al control</Text>
                        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                          <View style={{ flex: 1 }}>
                            <DateField value={recibirDate[m.id] || todayISO()} onChange={(v) => v && setRecibirDate((p) => ({ ...p, [m.id]: v }))} />
                          </View>
                          <TouchableOpacity
                            onPress={() => recibir(m)}
                            disabled={busyRecibir === m.id}
                            style={{ paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.success, opacity: busyRecibir === m.id ? 0.6 : 1 }}
                          >
                            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>{busyRecibir === m.id ? 'Recibiendo…' : '📥 Recibir'}</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </Card>
                  ))}
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {loading && machines.length === 0 ? (
        <Loading />
      ) : companyFilter === '__all__' && !q ? (
        // Catálogo oculto hasta elegir una empresa en el filtro (o buscar). Evita el listón
        // enorme de todas las empresas: primero eliges la empresa y ahí ves sus equipos.
        <EmptyState title="Elige una empresa" subtitle="Toca el filtro 🏢 y selecciona una empresa para ver sus equipos (o busca por código/serial)." />
      ) : shown.length === 0 ? (
        <EmptyState title={query || companyFilter !== '__all__' ? 'Sin resultados' : 'Sin maquinaria'} subtitle={query || companyFilter !== '__all__' ? 'Prueba con otra búsqueda o empresa.' : 'Agrega máquinas en Equipos.'} />
      ) : (
        machinesByCompany.map((g) => {
          // Colapsadas por defecto; se abren al buscar o al filtrar una empresa.
          const open = expanded[g.key] ?? (!!q || companyFilter !== '__all__');
          return (
            <View key={g.key} style={{ marginBottom: spacing.xs }}>
              <TouchableOpacity
                onPress={() => setExpanded((p) => ({ ...p, [g.key]: !open }))}
                activeOpacity={0.7}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: open ? colors.brand : colors.surfaceAlt, borderWidth: 1, borderColor: open ? colors.brand : colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, marginBottom: spacing.sm }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 }}>
                  <Text style={{ color: open ? colors.brandContrast : colors.muted, fontSize: 16 }}>{open ? '▾' : '▸'}</Text>
                  <Text style={{ color: open ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>🏢 {g.name}</Text>
                </View>
                <View style={{ backgroundColor: open ? colors.brandContrast : colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
                  <Text style={{ color: open ? colors.brand : colors.brandContrast, fontWeight: '800', fontSize: 13 }}>{g.items.length}</Text>
                </View>
              </TouchableOpacity>
              {/* Flete GENERAL de la empresa (sin máquina). Se suma al TOTAL POR PAGAR igual. */}
              {open && g.key !== '__none__' ? (() => {
                const gen = fletesGeneral[g.key] ?? [];
                const genUSD = gen.reduce((s, f) => s + (Number(f.viajes) || 0) * (Number(f.precio) || 0), 0);
                return (
                  <TouchableOpacity onPress={() => openFleteGeneral(g.key, g.name)} style={{ marginBottom: spacing.sm, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.brand, backgroundColor: colors.surfaceAlt }}>
                    <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 13 }}>🚚 Flete general de {g.name}{gen.length ? ` · ${gen.length} en el bloque = $${genUSD.toLocaleString()}` : ''}</Text>
                  </TouchableOpacity>
                );
              })() : null}
              {/* Total de la EMPRESA en el rango de fechas seleccionado: horas + $ (suma de sus máquinas). */}
              {open ? (() => {
                const compTot = g.items.reduce((acc, m) => {
                  // RENDIMIENTO: horas del bloque desde el Map precomputado (antes: reduce por día).
                  const h = workedByMachine.get(m.id) ?? 0;
                  const price = m.price_per_hour != null ? Number(m.price_per_hour) : 0;
                  acc.hours += h;
                  acc.amount += price > 0 ? (h / 12) * price : 0;
                  return acc;
                }, { hours: 0, amount: 0 });
                return (
                  <View style={{ marginBottom: spacing.sm, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.brand }}>
                    <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>📊 Total del rango (empresa)</Text>
                    <Text style={{ color: colors.brandText, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] as any }}>
                      {Math.round(compTot.hours)} h · ${compTot.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </Text>
                  </View>
                );
              })() : null}
              {open ? g.items.map((m) => {
          // RENDIMIENTO: horas del bloque desde el Map precomputado (antes: reduce por día en cada tarjeta).
          const weekWorked = workedByMachine.get(m.id) ?? 0;
          const isOpen = cardOpen[m.id] ?? false;
          const machFletes = fletesByMachine[m.id] ?? [];
          const fletesUSD = machFletes.reduce((s, f) => s + (Number(f.viajes) || 0) * (Number(f.precio) || 0), 0);
          // Total $ de la máquina en el rango de fechas seleccionado (jornadas × precio/12).
          const wPrice = m.price_per_hour != null ? Number(m.price_per_hour) : null;
          const weekAmount = wPrice != null ? (weekWorked / 12) * wPrice : null;
          const usdMach = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
          return (
            <Card key={m.id}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
                <TouchableOpacity activeOpacity={puedeEditarPrecio ? 0.6 : 1} onPress={() => openPrice(m)} style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', color: colors.text, fontSize: 16 }}>
                    {m.code}{puedeEditarPrecio ? <Text style={{ color: colors.brandText, fontSize: 13 }}> ✎</Text> : null}
                  </Text>
                  {averiadas.has(m.id) ? (
                    <Text style={{ color: colors.danger, fontSize: 12.5, fontWeight: '900', marginTop: 2 }}>
                      🔴 MÁQUINA PARADA (avería)
                    </Text>
                  ) : null}
                  {m.operational === false ? (
                    <Text style={{ color: colors.warning, fontSize: 12, fontWeight: '700', marginTop: 2 }}>
                      ⛔ Inactiva · se mantiene en este corte por sus horas trabajadas
                    </Text>
                  ) : null}
                  <Text style={{ color: m.company_id ? colors.brandText : colors.muted, fontSize: 13, fontWeight: '600' }}>
                    🏢 {m.company_id ? (companies[m.company_id] ?? 'Empresa') : 'Sin empresa'}
                  </Text>
                  {m.plate || m.serial ? (
                    <Text style={{ color: colors.muted, fontSize: 12 }}>
                      🔖 {m.plate ? `Placa: ${m.plate}` : ''}{m.plate && m.serial ? ' · ' : ''}{m.serial ? `Serial: ${m.serial}` : ''}
                    </Text>
                  ) : null}
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    💵 {m.price_per_hour != null ? `$${Number(m.price_per_hour).toLocaleString()} / jornada · $${pricePerHour(Number(m.price_per_hour)).toLocaleString(undefined, { maximumFractionDigits: 2 })}/h${puedeEditarPrecio ? ' · toca para editar' : ''}` : (puedeEditarPrecio ? 'Sin precio · toca el nombre para fijarlo' : 'Sin precio')}
                  </Text>
                  {inspectors[m.id] ? <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>🪖 Inspector: {inspectors[m.id].name}</Text> : null}
                  {fuelWeek[m.id]?.liters ? (
                    <Text style={{ color: colors.warning, fontSize: 12, fontWeight: '700' }}>
                      ⛽ {litersLabel(fuelWeek[m.id].liters)} L{weekWorked > 0 ? ` · ${lphOf(fuelWeek[m.id].liters, weekWorked)} L/h` : ''} <Text style={{ color: colors.muted, fontWeight: '400' }}>(período)</Text>
                    </Text>
                  ) : null}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setCardOpen((p) => ({ ...p, [m.id]: !isOpen }))}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={{ width: 34, height: 34, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ color: colors.muted, fontSize: 16, fontWeight: '800' }}>{isOpen ? '▾' : '▸'}</Text>
                </TouchableOpacity>
              </View>

              {/* Resumen compacto cuando la tarjeta está colapsada. */}
              {!isOpen ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xs }}>
                  <Text style={{ color: m.entry_at && !m.exit_at ? colors.success : colors.muted, fontSize: 12, fontWeight: '700' }}>
                    {m.entry_at && !m.exit_at ? '▶ En obra' : '⏹ Sin entrada activa'}
                  </Text>
                  <Text style={{ color: weekWorked > 0 ? colors.success : colors.muted, fontWeight: '800', fontSize: 14 }}>
                    {Math.round(weekWorked)} h{weekAmount != null ? ` · ${usdMach(weekAmount)}` : ''}
                  </Text>
                </View>
              ) : null}

              {/* La entrada se MANTIENE hasta la salida, aunque cambie la semana o se cierre. */}
              {isOpen ? (<>
              {m.entry_at && !m.exit_at ? (
                <View style={{ backgroundColor: colors.surfaceAlt, borderLeftWidth: 3, borderLeftColor: colors.success, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4, marginTop: spacing.xs }}>
                  <Text style={{ color: colors.success, fontSize: 12, fontWeight: '700' }}>
                    ▶ En obra desde {fmtDateTime(m.entry_at)} · Trabajando {elapsedSince(m.entry_at)}
                  </Text>
                </View>
              ) : null}

              {/* Entrada / Salida (momento exacto, nivel máquina). */}
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                {(['entry', 'exit'] as const).map((kind) => {
                  const label = kind === 'entry' ? '📥 ENTRADA' : '📤 SALIDA';
                  const dateField = kind === 'entry' ? 'entry_date' : 'exit_date';
                  const atVal = (kind === 'entry' ? m.entry_at : m.exit_at) as string | null;
                  const val = (m as any)[dateField] as string | null;
                  const active = !!val;
                  return (
                    <View key={kind} style={{ flex: 1 }}>
                      <TouchableOpacity
                        onPress={() => setMove(m, kind, !active)}
                        style={{ paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: active ? colors.brand : colors.border, backgroundColor: active ? colors.brand : colors.surfaceAlt, alignItems: 'center' }}
                      >
                        <Text style={{ color: active ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 13 }}>
                          {active ? '✓ ' : ''}{label}
                        </Text>
                      </TouchableOpacity>
                      {active ? (
                        <View style={{ marginTop: 4, gap: 4 }}>
                          <Text style={{ color: kind === 'entry' ? colors.success : colors.text, fontSize: 11, fontWeight: '700' }}>🕒 {fmtDateTime(atVal)}</Text>
                          <DateField value={val ?? ''} onChange={(v) => setMoveDate(m, dateField, v || null)} />
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>

              {/* Guardia / militar encargado de esta máquina (historial acumulable). */}
              <GuardButton machine={{ id: m.id, code: m.code }} current={guards[m.id] ?? null} onChanged={() => refreshGuard(m.id)} userId={session?.user?.id} />

              {/* Flete / viaje del equipo: confirma cuántos viajes hizo y a qué precio (con fecha). */}
              <TouchableOpacity
                onPress={() => openFlete(m)}
                style={{ marginTop: spacing.sm, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.brand, backgroundColor: colors.surfaceAlt }}
              >
                <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 13 }}>
                  ➕ Flete / viaje{machFletes.length ? ` · ${machFletes.length} en el bloque = $${fletesUSD.toLocaleString()}` : ''}
                </Text>
              </TouchableOpacity>

              {/* Total de la máquina en el rango de fechas seleccionado: horas + $. */}
              <View style={{ marginTop: spacing.sm, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700' }}>📊 Total del rango</Text>
                <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>
                  {Math.round(weekWorked)} h{weekAmount != null ? ` · ${usdMach(weekAmount)}` : ' · sin precio'}
                </Text>
              </View>

              {/* Manda la máquina a "En espera por recepción": sale del control activo. */}
              <TouchableOpacity
                onPress={() => ponerEnEspera(m)}
                style={{ marginTop: spacing.sm, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.surfaceAlt }}
              >
                <Text style={{ color: colors.warning, fontWeight: '700', fontSize: 13 }}>🕓 Poner en espera (por recepción)</Text>
              </TouchableOpacity>

              {/* Bloque de la semana: un sub-bloque por cada día. */}
              <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
                {weekDays.map((dISO) => {
                  const b = rounds[rkey(m.id, dISO)];
                  const dayH = Number(b?.day_hours ?? 0);
                  const nightH = Number(b?.night_hours ?? 0);
                  const stopped = Number(b?.hours_stopped ?? 0);
                  const ot = Number(b?.overtime_hours ?? 0);
                  const worked = workedFromShifts(dayH, nightH, stopped, ot);
                  const ik = `${m.id}|${dISO}`;
                  return (
                    <View key={dISO} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>{dayLabel(dISO)}</Text>
                          {b?.closed ? (
                            <Text style={{ color: colors.warning, fontSize: 10, fontWeight: '800' }}>🔒 cerrado</Text>
                          ) : null}
                          <TouchableOpacity
                            onPress={() => openSegments(m, dISO)}
                            style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}
                          >
                            <Text style={{ color: colors.brandText, fontSize: 10, fontWeight: '700' }}>🕒 Ver tramos</Text>
                          </TouchableOpacity>
                        </View>
                        <Text style={{ color: worked > 0 ? colors.success : colors.muted, fontWeight: '800', fontSize: 13, fontVariant: ['tabular-nums'] as any }}>{Math.ceil(worked)} h · {shiftLabel(turnoH(dayH) + turnoH(nightH))}</Text>
                      </View>
                      {(['day', 'night'] as const).map((which) => {
                        const cur = which === 'day' ? dayH : nightH;
                        const lockTurno = analistaMaqConHoras(b); // analista: máquina con horas → bloqueada (no agregar/modificar/borrar)
                        const opName = which === 'day' ? b?.day_operator : b?.night_operator;
                        const opCi = which === 'day' ? b?.day_operator_ci : b?.night_operator_ci;
                        return (
                          <View key={which} style={{ marginBottom: 4 }}>
                            <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }}>
                              <Text style={{ width: 20, fontSize: 14, textAlign: 'center' }}>{which === 'day' ? '☀️' : '🌙'}</Text>
                              {SHIFT_OPTS.map((opt) => {
                                // Resalta el botón solo si las horas YA son exactamente 0/6/12 (redondeadas hacia
                                // arriba). Con horas reales (ej. 7.6→8) ningún botón queda activo a propósito —
                                // esos botones son un atajo manual, no fuerzan el valor real ya cargado.
                                const active = turnoH(cur) === opt.hours;
                                const activeBg = opt.hours === 0 ? colors.danger : colors.success;
                                return (
                                  <TouchableOpacity
                                    key={opt.hours}
                                    onPress={() => setShift(m, dISO, which, opt.hours)}
                                    disabled={lockTurno && !active}
                                    style={{ flex: 1, minHeight: 36, borderRadius: radius.sm, borderWidth: 1, borderColor: active ? activeBg : colors.border, backgroundColor: active ? activeBg : colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', opacity: lockTurno && !active ? 0.4 : 1 }}
                                  >
                                    <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '700', fontSize: 11, textAlign: 'center' }}>{opt.label}</Text>
                                  </TouchableOpacity>
                                );
                              })}
                              {lockTurno ? <Text style={{ fontSize: 11 }}>🔒</Text> : null}
                            </View>
                            {cur > 0 ? (
                              <TouchableOpacity onPress={() => openOperator(m, dISO, which)} style={{ marginTop: 2, marginLeft: 24 }}>
                                <Text style={{ fontSize: 11, color: opName ? colors.text : colors.warning }}>
                                  👷 {opName ? `${opName}${opCi ? ` · C.I ${opCi}` : ''}` : 'Sin operador · toca'} <Text style={{ color: colors.brandText }}>✎</Text>
                                </Text>
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        );
                      })}
                      <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center', marginTop: 2 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 }}>
                          <Text style={{ color: colors.muted, fontSize: 11 }}>⏸ parada {(analistaMaqConHoras(b) || bloqueadoAnalista(stopped)) ? '🔒' : ''}</Text>
                          <TextInput
                            value={hoursInput[ik] !== undefined ? hoursInput[ik] : stopped ? String(stopped) : ''}
                            editable={!(analistaMaqConHoras(b) || bloqueadoAnalista(stopped))}
                            onChangeText={(t) => setHoursInput((p) => ({ ...p, [ik]: onlyDecimal(t) }))}
                            onBlur={() => hoursInput[ik] !== undefined && setHours(m, dISO, hoursInput[ik])}
                            onSubmitEditing={() => hoursInput[ik] !== undefined && setHours(m, dISO, hoursInput[ik])}
                            keyboardType="numeric" inputMode="decimal" placeholder="0" placeholderTextColor={colors.muted}
                            style={{ flex: 1, minWidth: 0, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: 6, color: colors.text, textAlign: 'right', fontSize: 12, opacity: (analistaMaqConHoras(b) || bloqueadoAnalista(stopped)) ? 0.5 : 1 }}
                          />
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 }}>
                          <Text style={{ color: colors.muted, fontSize: 11 }}>➕ extra {(analistaMaqConHoras(b) || bloqueadoAnalista(ot)) ? '🔒' : ''}</Text>
                          <TextInput
                            value={overtimeInput[ik] !== undefined ? overtimeInput[ik] : ot ? String(ot) : ''}
                            editable={!(analistaMaqConHoras(b) || bloqueadoAnalista(ot))}
                            onChangeText={(t) => setOvertimeInput((p) => ({ ...p, [ik]: onlyDecimal(t) }))}
                            onBlur={() => overtimeInput[ik] !== undefined && setOvertime(m, dISO, overtimeInput[ik])}
                            onSubmitEditing={() => overtimeInput[ik] !== undefined && setOvertime(m, dISO, overtimeInput[ik])}
                            keyboardType="numeric" inputMode="decimal" placeholder="0" placeholderTextColor={colors.muted}
                            style={{ flex: 1, minWidth: 0, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.infoSoftBorder, borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: 6, color: colors.text, textAlign: 'right', fontSize: 12, opacity: (analistaMaqConHoras(b) || bloqueadoAnalista(ot)) ? 0.5 : 1 }}
                          />
                        </View>
                      </View>
                      {/* Horómetro de la jornada (registrado por el operador al iniciar/finalizar). */}
                      {b?.horometro_inicial != null || b?.horometro_final != null ? (
                        <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
                          🕒 Horómetro: {b?.horometro_inicial ?? '—'} → {b?.horometro_final ?? '—'}
                          {b?.horometro_inicial != null && b?.horometro_final != null ? ` = ${Math.round((Number(b.horometro_final) - Number(b.horometro_inicial)) * 100) / 100} h` : ''}
                        </Text>
                      ) : null}
                    </View>
                  );
                })}
              </View>

              <View style={{ marginTop: spacing.sm, paddingTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Total del bloque ({dayCount} día(s))</Text>
                <Text style={{ color: weekWorked > 0 ? colors.success : colors.muted, fontWeight: '800', fontSize: 16, fontVariant: ['tabular-nums'] as any }}>{Math.round(weekWorked)} h</Text>
              </View>
              </>) : null}
            </Card>
          );
              }) : null}
            </View>
          );
        })
      )}

      {/* Lista desplegable de empresas para filtrar */}
      <Modal visible={companyPickerOpen} transparent animationType="fade" onRequestClose={() => setCompanyPickerOpen(false)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setCompanyPickerOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, maxHeight: '75%', overflow: 'hidden' }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16, padding: spacing.md }}>Filtrar por empresa</Text>
            <ScrollView>
              {companyOptions.map((o) => {
                const active = companyFilter === o.value;
                return (
                  <TouchableOpacity
                    key={o.value}
                    onPress={() => { setCompanyFilter(o.value); setCompanyPickerOpen(false); }}
                    style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: active ? colors.surfaceAlt : 'transparent', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}
                  >
                    <Text style={{ color: active ? colors.brandText : colors.text, fontWeight: active ? '800' : '500', flex: 1 }}>{o.label}</Text>
                    <View style={{ backgroundColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, minWidth: 26, alignItems: 'center' }}>
                      <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>{o.count}</Text>
                    </View>
                    {active ? <Text style={{ color: colors.brandText, fontWeight: '800' }}>✓</Text> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Modal: MARCAR EQUIPO AVERIADO (empresa → máquina → motivo) */}
      <Modal visible={averiaOpen} transparent animationType="fade" onRequestClose={closeAveria}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, maxHeight: '88%' }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17, marginBottom: 2 }}>⚠️ Marcar equipo averiado</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>Elige la empresa y el equipo. Quedará como No operativa y saldrá del control.</Text>
            <ScrollView>
              {/* 1) Empresa */}
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>1️⃣ Empresa</Text>
              <TouchableOpacity
                onPress={() => setAveriaCompanyOpen((v) => !v)}
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}
              >
                <Text style={{ color: averiaCompanyLabel ? colors.text : colors.muted, fontWeight: '700' }}>🏢 {averiaCompanyLabel ?? 'Elige una empresa…'}</Text>
                <Text style={{ color: colors.muted, fontSize: 16 }}>{averiaCompanyOpen ? '▴' : '▾'}</Text>
              </TouchableOpacity>
              {averiaCompanyOpen ? (
                <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, marginTop: spacing.xs, maxHeight: 200, overflow: 'hidden' }}>
                  <ScrollView>
                    {averiaCompanyOptions.length === 0 ? (
                      <Text style={{ color: colors.muted, fontSize: 13, padding: spacing.md }}>No hay equipos operativos.</Text>
                    ) : averiaCompanyOptions.map((o) => {
                      const active = averiaCompany === o.value;
                      return (
                        <TouchableOpacity
                          key={o.value}
                          onPress={() => { setAveriaCompany(o.value); setAveriaCompanyOpen(false); setAveriaMachine(null); setAveriaMachQ(''); setAveriaMachineOpen(true); }}
                          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: active ? colors.surfaceAlt : 'transparent', borderTopWidth: 1, borderTopColor: colors.border }}
                        >
                          <Text style={{ color: active ? colors.brandText : colors.text, fontWeight: active ? '800' : '500', flex: 1 }}>{o.name}</Text>
                          <View style={{ backgroundColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, minWidth: 26, alignItems: 'center' }}>
                            <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>{o.count}</Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : null}

              {/* 2) Máquina (con serial / placa) */}
              {averiaCompany ? (
                <View style={{ marginTop: spacing.md }}>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>2️⃣ Equipo (nombre · serial / placa)</Text>
                  <TouchableOpacity
                    onPress={() => setAveriaMachineOpen((v) => !v)}
                    style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}
                  >
                    <Text style={{ color: averiaMachine ? colors.text : colors.muted, fontWeight: '700', flex: 1 }} numberOfLines={1}>
                      🚜 {averiaMachine ? averiaMachine.code : 'Elige el equipo…'}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 16 }}>{averiaMachineOpen ? '▴' : '▾'}</Text>
                  </TouchableOpacity>
                  {averiaMachineOpen ? (
                    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, marginTop: spacing.xs, overflow: 'hidden' }}>
                      <TextInput
                        value={averiaMachQ}
                        onChangeText={setAveriaMachQ}
                        placeholder="🔎 Buscar por nombre, serial o placa…"
                        placeholderTextColor={colors.muted}
                        style={{ backgroundColor: colors.surface, padding: spacing.sm, color: colors.text, borderBottomWidth: 1, borderBottomColor: colors.border }}
                      />
                      <ScrollView style={{ maxHeight: 220 }}>
                        {averiaMachineList.length === 0 ? (
                          <Text style={{ color: colors.muted, fontSize: 13, padding: spacing.md }}>Sin equipos operativos en esta empresa.</Text>
                        ) : averiaMachineList.map((m) => {
                          const active = averiaMachine?.id === m.id;
                          const ident = [m.serial, m.plate].filter(Boolean).join(' · ');
                          return (
                            <TouchableOpacity
                              key={m.id}
                              onPress={() => { setAveriaMachine(m); setAveriaMachineOpen(false); }}
                              style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: active ? colors.surfaceAlt : 'transparent', borderTopWidth: 1, borderTopColor: colors.border }}
                            >
                              <Text style={{ color: active ? colors.brandText : colors.text, fontWeight: active ? '800' : '600' }}>{m.code}{active ? '  ✓' : ''}</Text>
                              <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>
                                {ident ? `🔖 ${ident}` : 'Sin serial / placa'}{m.tipo ? `  ·  ${m.tipo}` : ''}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* Resumen del equipo elegido + motivo */}
              {averiaMachine ? (
                <View style={{ marginTop: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderLeftWidth: 3, borderLeftColor: colors.warning, padding: spacing.md }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{averiaMachine.code}</Text>
                  {[averiaMachine.serial, averiaMachine.plate].filter(Boolean).length ? (
                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>🔖 {[averiaMachine.serial, averiaMachine.plate].filter(Boolean).join(' · ')}</Text>
                  ) : null}
                  <Text style={{ color: colors.muted, fontSize: 12 }}>🏢 {averiaCompanyLabel}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Motivo de la avería (opcional)</Text>
                  <TextInput
                    value={averiaNota}
                    onChangeText={setAveriaNota}
                    placeholder="Ej. falla hidráulica, no arranca…"
                    placeholderTextColor={colors.muted}
                    multiline
                    style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, minHeight: 54 }}
                  />
                  <Text style={{ color: colors.warning, fontSize: 11, marginTop: spacing.sm }}>⚠️ Al confirmar, el equipo queda No operativa, sale del control y pasa a “En reparación” en Mantenimiento.</Text>
                </View>
              ) : null}

              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                <TouchableOpacity onPress={closeAveria} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={marcarAveriada}
                  disabled={!averiaMachine || averiaBusy}
                  style={{ flex: 2, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.warning, opacity: (!averiaMachine || averiaBusy) ? 0.5 : 1 }}
                >
                  <Text style={{ color: '#fff', fontWeight: '800' }}>{averiaBusy ? 'Guardando…' : '⚠️ Marcar averiado'}</Text>
                </TouchableOpacity>
              </View>
              <View style={{ height: spacing.md }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Modal: registrar FLETE / VIAJE (por equipo o GENERAL de la empresa) */}
      <Modal visible={!!fleteFor || !!fleteGeneralCo} transparent animationType="fade" onRequestClose={() => { setFleteFor(null); setFleteGeneralCo(null); }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, maxHeight: '88%' }}>
            {(fleteFor || fleteGeneralCo) ? (() => {
              const isGen = !!fleteGeneralCo;
              const coId = isGen ? fleteGeneralCo!.id : fleteFor!.company_id;
              const coName = isGen ? fleteGeneralCo!.name : (fleteFor!.company_id ? (companies[fleteFor!.company_id] ?? 'Empresa') : 'Sin empresa');
              const viajes = Math.max(0, Math.round(Number(fleteViajes.replace(',', '.')) || 0));
              const precio = Math.max(0, Number(fletePrecio.replace(',', '.')) || 0);
              const total = viajes * precio;
              const list = ((isGen ? (coId ? fletesGeneral[coId] : []) : fletesByMachine[fleteFor!.id]) ?? []).slice().sort((a, b) => String(a.flete_date).localeCompare(String(b.flete_date)));
              const listUSD = list.reduce((s, f) => s + (Number(f.viajes) || 0) * (Number(f.precio) || 0), 0);
              return (
                <ScrollView>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17, marginBottom: 2 }}>{isGen ? `🚚 Flete general · ${coName}` : `➕ Flete / viaje · ${fleteFor!.code}`}</Text>
                  <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.md }}>
                    🏢 {coName}{isGen ? ' · flete general (no asignado a una máquina)' : ''} · el monto se suma al TOTAL POR PAGAR de la empresa en la semana de la fecha del flete.
                  </Text>

                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>📅 Fecha del flete</Text>
                  <DateField value={fleteDate} onChange={(v) => v && setFleteDate(v)} />

                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>Nº de viajes</Text>
                      <TextInput
                        value={fleteViajes}
                        onChangeText={(t) => setFleteViajes(onlyDigits(t))}
                        keyboardType="numeric" inputMode="numeric" placeholder="0" placeholderTextColor={colors.muted}
                        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.text, fontSize: 16, marginTop: 4 }}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>Precio por viaje ($)</Text>
                      <TextInput
                        value={fletePrecio}
                        onChangeText={(t) => setFletePrecio(onlyDecimal(t))}
                        keyboardType="numeric" inputMode="decimal" placeholder="0.00" placeholderTextColor={colors.muted}
                        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.text, fontSize: 16, marginTop: 4 }}
                      />
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
                    <Text style={{ color: colors.text, fontWeight: '800' }}>Total del flete</Text>
                    <Text style={{ color: colors.success, fontWeight: '800', fontSize: 18 }}>${total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>
                  </View>

                  <TouchableOpacity
                    onPress={saveFlete}
                    disabled={fleteBusy}
                    style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.brand, opacity: fleteBusy ? 0.6 : 1 }}
                  >
                    <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{fleteBusy ? 'Guardando…' : '💾 Registrar flete'}</Text>
                  </TouchableOpacity>

                  {/* Fletes ya registrados de este equipo dentro del bloque visible. */}
                  {list.length > 0 ? (
                    <View style={{ marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, marginBottom: spacing.xs }}>
                        Fletes del bloque ({list.length}) · ${listUSD.toLocaleString()}
                      </Text>
                      {list.map((f) => (
                        <View key={f.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{fmtDMY(f.flete_date)} · {f.viajes} viaje(s) × ${Number(f.precio).toLocaleString()}</Text>
                            <Text style={{ color: colors.success, fontSize: 12, fontWeight: '700' }}>= ${(Number(f.viajes) * Number(f.precio)).toLocaleString()}</Text>
                          </View>
                          {fleteDelConfirm === f.id ? (
                            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                              <TouchableOpacity onPress={() => deleteFlete(f)} style={{ paddingVertical: 4, paddingHorizontal: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.danger }}>
                                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>Sí, eliminar</Text>
                              </TouchableOpacity>
                              <TouchableOpacity onPress={() => setFleteDelConfirm(null)} style={{ paddingVertical: 4, paddingHorizontal: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }}>
                                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>No</Text>
                              </TouchableOpacity>
                            </View>
                          ) : (
                            <TouchableOpacity onPress={() => setFleteDelConfirm(f.id)} style={{ paddingVertical: 4, paddingHorizontal: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.danger }}>
                              <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>🗑 Eliminar</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      ))}
                    </View>
                  ) : null}

                  <TouchableOpacity style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => { setFleteFor(null); setFleteGeneralCo(null); setFleteDelConfirm(null); }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>Listo</Text>
                  </TouchableOpacity>
                </ScrollView>
              );
            })() : null}
          </View>
        </View>
      </Modal>

      {/* Modal: precio por hora trabajada → total */}
      <Modal visible={!!priceFor} transparent animationType="fade" onRequestClose={() => setPriceFor(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border }}>
            {priceFor ? (() => {
              const workedH = weekDays.reduce((s, d) => {
                const b = rounds[rkey(priceFor.id, d)];
                return s + workedFromShifts(Number(b?.day_hours ?? 0), Number(b?.night_hours ?? 0), Number(b?.hours_stopped ?? 0), Number(b?.overtime_hours ?? 0));
              }, 0);
              const stoppedH = weekDays.reduce((s, d) => {
                const b = rounds[rkey(priceFor.id, d)];
                return s + (Number(b?.hours_stopped ?? 0) || 0);
              }, 0);
              const units = workedH / 12;
              const price = Number(priceInput.replace(',', '.')) || 0;
              const perHour = pricePerHour(price);
              const total = perHour * workedH;
              return (
                <>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17, marginBottom: 2 }}>{priceFor.code}</Text>
                  <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.md }}>
                    El precio se aplica al RANGO de fechas que elijas. No afecta otros cortes.
                  </Text>

                  <Text style={{ color: colors.muted, fontSize: 12 }}>Precio por jornada de 12 h ($)</Text>
                  <TextInput
                    value={priceInput}
                    onChangeText={(t) => setPriceInput(onlyDecimal(t))}
                    keyboardType="numeric"
                    inputMode="decimal"
                    placeholder="0.00"
                    placeholderTextColor={colors.muted}
                    autoFocus
                    style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.text, fontSize: 16, marginTop: 4 }}
                  />

                  {/* Rango de fechas al que aplica el precio (por defecto, el rango del reporte). */}
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.md }}>📅 Aplicar este precio del … al … (cubre TODO el período)</Text>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 4 }}>
                    <View style={{ flex: 1 }}><DateField value={priceFrom} onChange={(v) => v && setPriceFrom(v)} /></View>
                    <View style={{ flex: 1 }}><DateField value={priceTo} onChange={(v) => v && setPriceTo(v)} /></View>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs }}>
                    <TouchableOpacity onPress={() => { setPriceFrom(sumFrom); setPriceTo(sumTo); }} style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
                      <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>📊 Rango del reporte ({dayLabel(sumFrom)}→{dayLabel(sumTo)})</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => { setPriceFrom(weekStart); setPriceTo(weekEnd); }} style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
                      <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>Corte visible ({dayLabel(weekStart)}→{dayLabel(weekEnd)})</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Switch: BLINDAR el precio a esas fechas (queda clavado). */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md, backgroundColor: priceBlindar ? colors.surfaceAlt : colors.surface, borderWidth: 1, borderColor: priceBlindar ? colors.brand : colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md }}>
                    <View style={{ flex: 1, paddingRight: spacing.sm }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>🔒 Blindar precio a estas fechas</Text>
                      <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
                        {priceBlindar
                          ? 'Queda FIJO para esas fechas: si sube en otra semana, esta no cambia; si lo modificas, solo afecta esta semana.'
                          : 'Sin blindar: solo cambia el precio por defecto de la máquina (fechas sin precio fijo).'}
                      </Text>
                    </View>
                    <Switch value={priceBlindar} onValueChange={setPriceBlindar} />
                  </View>

                  {/* Precio por hora: automático = jornada ÷ 12 */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md }}>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>⏱️ Precio por hora (auto = ÷ 12)</Text>
                    <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 15 }}>${perHour.toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>
                  </View>

                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md }}>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>Horas trabajadas del bloque</Text>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>{Math.round(workedH)} h</Text>
                  </View>
                  {stoppedH > 0 ? (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
                      <Text style={{ color: colors.warning, fontSize: 13 }}>⏸ Horas paradas (descontadas)</Text>
                      <Text style={{ color: colors.warning, fontWeight: '700' }}>−{Math.round(stoppedH)} h</Text>
                    </View>
                  ) : null}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>Jornadas equivalentes (÷ 12)</Text>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>{Number(units.toFixed(2))}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
                    <Text style={{ color: colors.text, fontWeight: '800' }}>Total del bloque</Text>
                    <Text style={{ color: colors.success, fontWeight: '800', fontSize: 18 }}>${total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>
                    Se paga por HORA trabajada (precio jornada ÷ 12). Las horas paradas se descuentan; las extras se suman. Ej.: jornada $750 → $62,50/h; 10 h trabajadas = $625.
                  </Text>

                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                    <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setPriceFor(null)}>
                      <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity disabled={savingPrice} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.brand, opacity: savingPrice ? 0.6 : 1 }} onPress={() => savePrice(priceFor, priceInput)}>
                      <Text style={{ color: colors.brandContrast, fontWeight: '700' }}>{savingPrice ? 'Guardando…' : 'Guardar precio del rango'}</Text>
                    </TouchableOpacity>
                  </View>
                </>
              );
            })() : null}
          </View>
        </View>
      </Modal>

      {/* Modal: datos del operador (nombre, apellido, cédula) */}
      <Modal visible={!!opFor} transparent animationType="fade" onRequestClose={() => setOpFor(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }}>
              Operador · {opFor?.which === 'day' ? '☀️ Turno de día' : '🌙 Turno de noche'}
            </Text>
            {opFor ? <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.md }}>{opFor.m.code} · {dayLabel(opFor.d)}</Text> : null}

            <Text style={{ color: colors.muted, fontSize: 12 }}>Cédula (se busca en nómina)</Text>
            <TextInput value={opCedula} onChangeText={(t) => setOpCedula(onlyDigits(t))} placeholder="C.I del operador" placeholderTextColor={colors.muted} keyboardType="numeric" inputMode="numeric"
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.text, marginTop: 4 }} />
            {opLookup === 'searching' ? (
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>Buscando en nómina…</Text>
            ) : opLookup === 'found' ? (
              <Text style={{ color: colors.success, fontSize: 12, marginTop: 4, fontWeight: '700' }}>✓ {`${opFirst} ${opLast}`.trim()} · encontrado en nómina</Text>
            ) : opLookup === 'none' ? (
              <Text style={{ color: colors.warning, fontSize: 12, marginTop: 4 }}>No está en nómina. Escribe el nombre y apellido a mano.</Text>
            ) : null}
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Nombre</Text>
            <TextInput value={opFirst} onChangeText={setOpFirst} placeholder="Nombre" placeholderTextColor={colors.muted} autoCapitalize="words"
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.text, marginTop: 4, marginBottom: spacing.sm }} />
            <Text style={{ color: colors.muted, fontSize: 12 }}>Apellido</Text>
            <TextInput value={opLast} onChangeText={setOpLast} placeholder="Apellido" placeholderTextColor={colors.muted} autoCapitalize="words"
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.text, marginTop: 4, marginBottom: spacing.sm }} />

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
              <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setOpFor(null)}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.brand }} onPress={saveOperator}>
                <Text style={{ color: colors.brandContrast, fontWeight: '700' }}>Guardar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Histórico de cierres */}
      <Modal visible={histOpen} animationType="slide" onRequestClose={() => setHistOpen(false)}>
        <Screen>
          <TouchableOpacity onPress={() => setHistOpen(false)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm }}>
            <Text style={{ color: colors.brandText, fontSize: 20, fontWeight: '800' }}>←</Text>
            <Text style={{ color: colors.brandText, fontWeight: '700' }}>Volver</Text>
          </TouchableOpacity>
          <SectionTitle>Histórico de controles</SectionTitle>
          {closures.length === 0 ? (
            <EmptyState title="Sin cierres" subtitle="Cierra un control del día y aparecerá aquí para reportarlo." />
          ) : (
            (() => {
              // Agrupar el histórico POR EMPRESA (un cierre con varias empresas sale en cada una).
              const groups = new Map<string, { company: string; items: { c: ControlClosure; machines: number }[] }>();
              closures.forEach((c) => {
                const machs = c.detail?.machines ?? [];
                const perComp = new Map<string, Set<string>>();
                machs.forEach((mm) => {
                  const comp = mm.company || 'Sin empresa';
                  const key = (mm.machineId || mm.serial || mm.code) as string;
                  if (!perComp.has(comp)) perComp.set(comp, new Set());
                  perComp.get(comp)!.add(key);
                });
                if (perComp.size === 0) perComp.set('Sin empresa', new Set());
                perComp.forEach((set, comp) => {
                  if (!groups.has(comp)) groups.set(comp, { company: comp, items: [] });
                  groups.get(comp)!.items.push({ c, machines: set.size });
                });
              });
              const list = Array.from(groups.values()).sort((a, b) =>
                a.company === 'Sin empresa' ? 1 : b.company === 'Sin empresa' ? -1 : cmpText(a.company, b.company)
              );
              return list.map((g) => (
                <View key={g.company} style={{ marginBottom: spacing.sm }}>
                  <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 15, marginBottom: spacing.xs }}>
                    🏢 {g.company} <Text style={{ color: colors.muted, fontWeight: '600', fontSize: 12 }}>· {g.items.length} cierre(s)</Text>
                  </Text>
                  {g.items.map(({ c, machines }) => {
                    const rng = c.detail?.dateFrom && c.detail?.dateTo && c.detail.dateFrom !== c.detail.dateTo
                      ? `${c.detail.dateFrom} → ${c.detail.dateTo}`
                      : c.detail?.dateFrom ?? c.closure_date;
                    return (
                      <TouchableOpacity key={g.company + c.id} activeOpacity={0.7} onPress={() => { setClosureSearch(''); setClosureExpanded({}); setClosureCompany(g.company); setClosureSel(c); }}>
                        <Card>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text style={{ color: colors.text, fontWeight: '700' }}>📅 {rng}</Text>
                            <Text style={{ color: colors.brandText, fontWeight: '800' }}>{machines} máq.</Text>
                          </View>
                          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>Toca para ver e imprimir el reporte</Text>
                        </Card>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ));
            })()
          )}
          <TouchableOpacity style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.brand }} onPress={() => setHistOpen(false)}>
            <Text style={{ color: colors.brandContrast, fontWeight: '700' }}>Cerrar</Text>
          </TouchableOpacity>
        </Screen>
      </Modal>

      {/* Vista previa de un cierre + PDF */}
      <Modal visible={!!closureSel} animationType="slide" onRequestClose={() => setClosureSel(null)}>
        <Screen>
          {closureSel ? (
            <>
              <TouchableOpacity onPress={() => setClosureSel(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm }}>
                <Text style={{ color: colors.brandText, fontSize: 20, fontWeight: '800' }}>←</Text>
                <Text style={{ color: colors.brandText, fontWeight: '700' }}>Volver</Text>
              </TouchableOpacity>
              <SectionTitle>
                Control {closureSel.detail?.dateFrom && closureSel.detail?.dateTo && closureSel.detail.dateFrom !== closureSel.detail.dateTo
                  ? `del ${closureSel.detail.dateFrom} al ${closureSel.detail.dateTo}`
                  : `del ${closureSel.detail?.dateFrom ?? closureSel.closure_date}`}
              </SectionTitle>
              {closureCompany ? (
                <Text style={{ color: colors.brandText, fontSize: 13, fontWeight: '800', marginBottom: 2 }}>🏢 {closureCompany}</Text>
              ) : null}
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
                {(() => { const mm = (closureSel.detail?.machines ?? []).filter((x) => !closureCompany || (x.company || 'Sin empresa') === closureCompany); return `${new Set(mm.map((x) => x.machineId || x.serial || x.code)).size} máquina(s) · ${mm.length} registro(s)`; })()}
              </Text>
              {confirmReabrir ? (
                <View style={{ marginBottom: spacing.xs, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.warningSoftBorder, backgroundColor: colors.warningSoftBg }}>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700', textAlign: 'center', marginBottom: spacing.sm }}>
                    ¿Reabrir este cierre? Sus registros vuelven al control activo para editarlos y el cierre sale del histórico.
                  </Text>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <TouchableOpacity
                      style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}
                      onPress={() => setConfirmReabrir(false)}
                    >
                      <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      disabled={reabriendo === closureSel.id}
                      style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.warning, opacity: reabriendo === closureSel.id ? 0.6 : 1 }}
                      onPress={() => reabrirCierre(closureSel)}
                    >
                      <Text style={{ color: '#fff', fontWeight: '800' }}>{reabriendo === closureSel.id ? 'Reabriendo…' : 'Sí, reabrir'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <>
                  <TouchableOpacity
                    disabled={reabriendo === closureSel.id}
                    style={{ marginBottom: spacing.xs, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.warningSoftBorder, backgroundColor: colors.warningSoftBg, opacity: reabriendo === closureSel.id ? 0.6 : 1 }}
                    onPress={() => setConfirmReabrir(true)}
                  >
                    <Text style={{ color: colors.warningSoftText, fontWeight: '800' }}>{reabriendo === closureSel.id ? 'Reabriendo…' : '♻️ Reabrir cierre (editar en control)'}</Text>
                  </TouchableOpacity>
                  <Text style={{ color: colors.muted, fontSize: 11, textAlign: 'center', marginBottom: spacing.sm }}>
                    Reabrir devuelve estos registros al control activo para editarlos. Al terminar, vuelve a cerrar el control.
                  </Text>
                </>
              )}
              <TextInput
                value={closureSearch}
                onChangeText={setClosureSearch}
                placeholder="🔎 Buscar máquina o empresa..."
                placeholderTextColor={colors.muted}
                style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, backgroundColor: colors.surfaceAlt, marginBottom: spacing.sm }}
              />
              {(() => {
                const usdFmt = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                // Precio por SERIAL (único) y por código (respaldo para datos viejos).
                const priceBySerial = new Map(machines.filter((mm) => mm.serial).map((mm) => [mm.serial as string, Number(mm.price_per_hour) || 0]));
                const priceByCode = new Map(machines.map((mm) => [mm.code, Number(mm.price_per_hour) || 0]));
                // Agrupar los registros del cierre POR MÁQUINA ÚNICA (serial/id, no el nombre que puede repetirse).
                const map = new Map<string, { key: string; code: string; serial: string | null; company: string; days: ClosureMachine[] }>();
                (closureSel.detail?.machines ?? [])
                  .filter((m) => !closureCompany || (m.company || 'Sin empresa') === closureCompany)
                  .forEach((m) => {
                  const key = (m.machineId || m.serial || m.code) as string;
                  const g = map.get(key) ?? { key, code: m.code, serial: m.serial ?? null, company: m.company || '', days: [] };
                  if (!g.company && m.company) g.company = m.company;
                  if (!g.serial && m.serial) g.serial = m.serial;
                  g.days.push(m);
                  map.set(key, g);
                });
                const q = norm(closureSearch.trim());
                let groups = Array.from(map.values());
                if (q) groups = groups.filter((g) => norm(g.code).includes(q) || norm(g.serial).includes(q) || norm(g.company).includes(q));
                groups.sort((a, b) => cmpText(a.code, b.code));
                if (groups.length === 0)
                  return <EmptyState title="Sin resultados" subtitle="Ninguna máquina coincide con la búsqueda." />;
                const StatBox = ({ k, v, accent }: { k: string; v: string; accent?: boolean }) => (
                  <View style={{ flex: 1, borderWidth: 1, borderColor: accent ? colors.brand : colors.border, backgroundColor: accent ? colors.brand : colors.surfaceAlt, borderRadius: radius.md, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm }}>
                    <Text style={{ color: accent ? colors.brandContrast : colors.muted, fontSize: 10 }}>{k}</Text>
                    <Text style={{ color: accent ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 15, fontVariant: ['tabular-nums'] as any }}>{v}</Text>
                  </View>
                );
                return groups.map((g) => {
                  const t = g.days.reduce(
                    (a, m) => ({
                      day: a.day + (Number(m.dayHours) || 0),
                      night: a.night + (Number(m.nightHours) || 0),
                      stopped: a.stopped + (Number(m.hoursStopped) || 0),
                      extra: a.extra + (Number(m.overtime) || 0),
                      worked: a.worked + (Number(m.worked) || 0),
                    }),
                    { day: 0, night: 0, stopped: 0, extra: 0, worked: 0 }
                  );
                  // Precio congelado VÁLIDO del cierre (>0); si no lo trae (o es 0), el actual de la máquina.
                  const frozen = g.days.find((d) => d.price != null && Number(d.price) > 0)?.price;
                  const price = frozen != null ? Number(frozen) : ((g.serial ? priceBySerial.get(g.serial) : undefined) ?? priceByCode.get(g.code) ?? 0);
                  const amount = (t.worked / 12) * price;
                  const open = !!closureExpanded[g.key];
                  return (
                    <Card key={g.key}>
                      <TouchableOpacity activeOpacity={0.7} onPress={() => setClosureExpanded((p) => ({ ...p, [g.key]: !p[g.key] }))}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>{g.code}{g.serial ? <Text style={{ color: colors.muted, fontWeight: '600', fontSize: 12 }}>  ·  {g.serial}</Text> : null}</Text>
                          <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>{open ? '▲ ocultar' : '▼ ver detalle'}</Text>
                        </View>
                        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>🏢 {g.company || 'Sin empresa'} · {g.days.length} día(s)</Text>
                        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                          <StatBox k="Total horas" v={`${t.worked} h`} />
                          <StatBox k="☀️ Día" v={`${t.day} h`} />
                          <StatBox k="🌙 Noche" v={`${t.night} h`} />
                          <StatBox k="💵 Monto" v={price ? usdFmt(amount) : '—'} accent />
                        </View>
                      </TouchableOpacity>
                      {open && (
                        <View style={{ marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: spacing.sm }}>
                          {g.days.map((m, i) => (
                            <View key={i} style={{ gap: 2 }}>
                              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>{m.date ?? ''}</Text>
                              <Text style={{ color: colors.text, fontSize: 12 }}>
                                ☀️ Día {m.dayHours ? `${m.dayHours}h` : '—'} · 👷 {m.dayOperator || 'sin operador'}{m.dayCedula ? ` (C.I ${m.dayCedula})` : ''}
                              </Text>
                              <Text style={{ color: colors.text, fontSize: 12 }}>
                                🌙 Noche {m.nightHours ? `${m.nightHours}h` : '—'} · 👷 {m.nightOperator || 'sin operador'}{m.nightCedula ? ` (C.I ${m.nightCedula})` : ''}
                              </Text>
                              <Text style={{ color: colors.muted, fontSize: 11 }}>
                                {shiftLabel((m.dayHours || 0) + (m.nightHours || 0))} · Parada {m.hoursStopped} h{m.overtime ? ` · Extras ${m.overtime} h` : ''} · Trabajadas {m.worked} h
                              </Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </Card>
                  );
                });
              })()}
              <TouchableOpacity style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.brand }} onPress={() => downloadClosurePdf(closureSel)}>
                <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>⬇️ Descargar PDF</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setClosureSel(null)}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Volver</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </Screen>
      </Modal>

      {/* Visor de tramos (solo lectura): detalle auditable de machine_work_segments
          para la máquina + día elegidos. No permite editar ni borrar nada — los
          ajustes se siguen haciendo desde los campos de arriba. */}
      <Modal visible={!!segmentsFor} transparent animationType="fade" onRequestClose={() => setSegmentsFor(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, maxHeight: '80%' }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16, marginBottom: 2 }}>
              🕒 Tramos del día{segmentsFor ? ` · ${segmentsFor.m.code}` : ''}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
              {segmentsFor ? dayLabel(segmentsFor.d) : ''}
            </Text>
            {segmentsLoading ? (
              <Loading />
            ) : segmentsList.length === 0 ? (
              <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center', paddingVertical: spacing.lg }}>
                Sin tramos registrados para este día — el total mostrado arriba es el valor guardado directamente.
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 360 }}>
                {segmentsList.map((s) => {
                  const isAjuste = s.started_at === s.ended_at;
                  const start = new Date(s.started_at);
                  const end = new Date(s.ended_at);
                  const fmtHM = (d: Date) => d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
                  const hoursTxt = `${s.hours > 0 ? '+' : ''}${s.hours} h`;
                  return (
                    <View key={s.id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: spacing.sm, gap: 2 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>
                          {isAjuste ? 'Ajuste' : `${fmtHM(start)} → ${fmtHM(end)}`}
                        </Text>
                        <Text style={{ color: s.hours < 0 ? colors.danger : colors.success, fontWeight: '800', fontSize: 13 }}>{hoursTxt}</Text>
                      </View>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>{SEGMENT_SOURCE_LABEL[s.source] ?? s.source} · {s.shift === 'day' ? '☀️ Día' : '🌙 Noche'}</Text>
                      {s.notes ? <Text style={{ color: colors.muted, fontSize: 11 }}>{s.notes}</Text> : null}
                    </View>
                  );
                })}
              </ScrollView>
            )}
            <TouchableOpacity
              style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}
              onPress={() => setSegmentsFor(null)}
            >
              <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
