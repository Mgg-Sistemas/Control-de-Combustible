import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, Modal, Pressable } from 'react-native';
import { Screen, Card, SectionTitle, Loading, EmptyState } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import { supabase } from '../lib/supabase';
import { listVisits, VisitRow } from '../lib/supervisorVisits';
import { listInspectorAssignments, assignInspector, unassignInspector, AssignmentRow, Shift, shiftIcon, shiftLabel } from '../lib/machineInspectors';
import { useAuth } from '../context/AuthContext';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { generateEstadoReport } from '../lib/inspectorEstadoReport';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { sectorOf, sectorLabel } from '../lib/mapZones';
import { isVolteoVolqueta } from '../lib/equipos';
import { loadFuelByMachine, lphOf, litersLabel, FuelAgg } from '../lib/fuelPerMachine';
import { cmpText, norm } from '../lib/text';
import { VisitStatus } from '../types/database';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

const CARACAS_TZ = 'America/Caracas';
function caracasToday(): string {
  const p: any = new Intl.DateTimeFormat('en-CA', { timeZone: CARACAS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((a: any, x: any) => { a[x.type] = x.value; return a; }, {});
  return `${p.year}-${p.month}-${p.day}`;
}
function caracasClock(iso: string): string {
  return new Intl.DateTimeFormat('es-VE', { timeZone: CARACAS_TZ, hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso));
}
/** Suma día+noche (0/6/12) del round como horas trabajadas. */
const workedOf = (r: any) => (Number(r.day_hours) || 0) + (Number(r.night_hours) || 0);
/** Retraso legible a partir de minutos: "45 min", "1 h", "1 h 30 min". */
function lateLabel(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60), r = m % 60;
  if (h <= 0) return `${r} min`;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}
const STATUS_META: Record<VisitStatus, { icon: string; label: string; color: string }> = {
  trabajando: { icon: '🟢', label: 'Trabajando', color: '#1E9E4A' },
  parada: { icon: '🟡', label: 'Parada', color: '#D9A200' },
  no_esta: { icon: '🔴', label: 'No está', color: '#D22B2B' },
};

type Round = { machinery_id: string; worked: number; code: string; companyName: string; operator: string | null };
type Jornada = {
  id: string; operator: string; cedula: string; code: string; companyName: string;
  started_at: string; ended_at: string | null; worked_hours: number | null;
  start_lat: number | null; start_lng: number | null; end_lat: number | null; end_lng: number | null;
};
const mapsUrl = (lat?: number | null, lng?: number | null) => `https://www.google.com/maps?q=${lat},${lng}`;
const openUrl = (url: string) => { try { (globalThis as any).open?.(url, '_blank'); } catch {} };

/** Cercanía de una visita: en sitio (near true), lejos (near false) o sin GPS (near null). */
type Proximity = 'sitio' | 'lejos' | 'nogps';
const proximityOf = (v: VisitRow): Proximity => (v.near === true ? 'sitio' : v.near === false ? 'lejos' : 'nogps');
/** Resume una lista de visitas: cuántas en sitio, lejos y sin GPS, y máquinas únicas. */
function summarize(list: VisitRow[]) {
  let sitio = 0, lejos = 0, nogps = 0;
  list.forEach((v) => { const p = proximityOf(v); if (p === 'sitio') sitio++; else if (p === 'lejos') lejos++; else nogps++; });
  return { sitio, lejos, nogps, total: list.length, maquinas: new Set(list.map((v) => v.machinery_id)).size };
}
/** ISO (YYYY-MM-DD) → DD/MM/YYYY. */
const dmy = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
/** Sector de la máquina de una visita (por su ubicación; si no, por su referencia). */
const sectorOfVisit = (v: VisitRow): string => {
  const s = sectorLabel(sectorOf(v.machineLat, v.machineLng));
  return s && s !== 'Sin zona' ? s : (v.machineRef || 'Sin zona');
};
/** Serial o placa de la máquina de una visita. */
const plateOfVisit = (v: VisitRow): string => v.machinePlate || v.machineSerial || '—';

/**
 * Módulo de SUPERVISIÓN (para el jefe): traza de las rondas de los supervisores
 * en un día. Muestra quién visitó qué máquina, a qué hora, con qué estado y qué
 * tan cerca estaba. Y lo clave: las JORNADAS SIN VALIDAR — máquinas que
 * trabajaron ese día pero que ningún supervisor marcó (regla: el operador no
 * cobra). Así el jefe evalúa la cobertura de cada supervisor.
 */
export default function SupervisionScreen({ navigation }: any) {
  const { colors, typography } = useTheme();
  // SOLO el admin puede asignar/reasignar el inspector de una máquina (día/noche).
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  // Secciones colapsables del módulo. Por defecto TODAS COLAPSADAS (arranca con
  // todas las claves cerradas). Guarda las CERRADAS.
  const ALL_SECS = ['asg', 'camiones', 'machjor', 'opjor', 'traza'];
  const [secClosed, setSecClosed] = useState<Set<string>>(() => new Set(ALL_SECS));
  const toggleSec = (k: string) => setSecClosed((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  // Abre la ficha de ESA máquina. Si fue reportada AVERIADA (parada), va al módulo
  // de Mantenimiento de Maquinaria; si no, al Catálogo (por serial único o código).
  const openMachine = (v: VisitRow) => {
    if (v.status === 'parada') { navigation?.navigate?.('MantenimientoMaquinaria', { q: String(v.machineSerial || v.machineCode || '') }); return; }
    const term = v.machineSerial || v.machineCode;
    if (term) navigation?.navigate?.('Equipos', { q: String(term) });
  };
  const [date, setDate] = useState(caracasToday());
  const [loading, setLoading] = useState(true);
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  type RawRound = { machinery_id: string; code: string; companyName: string; serial: string | null; plate: string | null; encargado: string | null; startAt: string | null; shift: 'day' | 'night' | null; worked: number; horoIni: number | null; horoFin: number | null; recordedBy: string | null; lat: number | null; lng: number | null; sector: string | null; referencia: string | null };
  const [rawRounds, setRawRounds] = useState<RawRound[]>([]);
  // Movimientos de patio de camiones del día (salida al iniciar jornada / entrada al finalizar).
  type YardLog = { machinery_id: string; code: string; companyName: string; direction: 'entrada' | 'salida'; at: string };
  const [yardLogs, setYardLogs] = useState<YardLog[]>([]);
  const [fuelDay, setFuelDay] = useState<Record<string, FuelAgg>>({}); // litros surtidos por máquina en el día
  // Retraso de declaración por máquina (minutos), leído de la columna opcional
  // machine_rounds.jornada_late_min (si no existe, queda vacío sin romper nada).
  const [lateMap, setLateMap] = useState<Record<string, number>>({});
  const [jornadas, setJornadas] = useState<Jornada[]>([]);
  // IDs de usuarios ADMIN: sus visitas (pruebas) NO cuentan como inspección.
  const [adminIds, setAdminIds] = useState<Set<string>>(new Set());
  const [nameById, setNameById] = useState<Record<string, string>>({});
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('profiles').select('id, full_name, role');
      const admins = new Set<string>(); const names: Record<string, string> = {};
      ((data ?? []) as any[]).forEach((p) => { if (p.role === 'admin') admins.add(p.id); if (p.full_name) names[p.id] = p.full_name; });
      setAdminIds(admins); setNameById(names);
    })();
  }, []);
  const noAdmin = (v: VisitRow) => !((v as any).supervisor_id && adminIds.has((v as any).supervisor_id));

  // ── Asignaciones del CHECK (machine_inspectors): qué máquina se asignó cada
  //    inspector desde el teléfono. Se sincroniza en vivo con el módulo.
  const [assigns, setAssigns] = useState<AssignmentRow[]>([]);
  const [assignsMissing, setAssignsMissing] = useState(false);
  const loadAssigns = useCallback(async () => {
    const { rows, missing } = await listInspectorAssignments();
    setAssignsMissing(missing);
    // El CHECK es una acción EXPLÍCITA del inspector: se muestran TODAS las
    // asignaciones (a diferencia de las visitas, no se filtran las de admin).
    setAssigns(rows);
  }, []);
  useEffect(() => { loadAssigns(); }, [loadAssigns]);
  // Agrupadas por inspector (A→Z), cada una con sus máquinas.
  const assignsByInspector = useMemo(() => {
    const map = new Map<string, AssignmentRow[]>();
    assigns.forEach((a) => { const k = a.inspector_name || '—'; if (!map.has(k)) map.set(k, []); map.get(k)!.push(a); });
    return Array.from(map.entries()).sort((a, b) => cmpText(a[0], b[0]));
  }, [assigns]);
  // Edificio/referencia legible de una asignación (para filtrar y mostrar).
  const edifKey = (a: AssignmentRow): string => { const t = (a.referencia ?? '').trim(); return t && !/^[\d.,\s-]+$/.test(t) ? t : 'Sin edificio'; };

  // ── ASIGNAR / REASIGNAR inspector (SOLO ADMIN) ────────────────────────────
  // Inspectores asignables: perfiles con rol INSPECTOR ('supervisor') o
  // COORDINADOR DE PATIO ('coordinador_patio'). Solo se cargan si soy admin.
  const [inspectors, setInspectors] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      const { data } = await supabase.from('profiles').select('id, full_name, role').in('role', ['supervisor', 'coordinador_patio']).order('full_name');
      setInspectors(((data ?? []) as any[])
        .filter((p) => (p.full_name || '').trim())
        .map((p) => ({ id: p.id as string, name: p.full_name as string })));
    })();
  }, [isAdmin]);
  // Inspector actual (día/noche) por máquina, a partir de las asignaciones cargadas.
  const assignByMachine = useMemo(() => {
    const map = new Map<string, { code: string; companyName: string; day?: { id: string | null; name: string }; night?: { id: string | null; name: string } }>();
    assigns.forEach((a) => {
      const cur = map.get(a.machinery_id) || { code: a.code, companyName: a.companyName };
      cur.code = a.code; cur.companyName = a.companyName;
      cur[a.shift] = { id: a.inspector_id, name: a.inspector_name };
      map.set(a.machinery_id, cur);
    });
    return map;
  }, [assigns]);
  // Estado del modal de asignación (máquina elegida, turno activo, búsqueda…).
  const [assignFor, setAssignFor] = useState<{ id: string; code: string; companyName: string } | null>(null);
  const [assignShift, setAssignShift] = useState<Shift>('day');
  const [inspQuery, setInspQuery] = useState('');
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignNotice, setAssignNotice] = useState<string | null>(null);
  const openAssign = (a: AssignmentRow) => {
    setAssignFor({ id: a.machinery_id, code: a.code, companyName: a.companyName });
    setAssignShift('day'); setInspQuery(''); setAssignNotice(null);
  };
  // Inspectores a mostrar en el modal (A→Z natural, filtrados por la búsqueda).
  const inspShown = useMemo(() => {
    const q = norm(inspQuery.trim());
    return [...inspectors].sort((a, b) => cmpText(a.name, b.name)).filter((i) => !q || norm(i.name).includes(q));
  }, [inspectors, inspQuery]);
  // Aplica la asignación (upsert directo por máquina+turno) o la quita (insp=null).
  // Reasignar es un toque; tras cambiar recarga las asignaciones para sincronizar.
  const applyAssign = async (shift: Shift, insp: { id: string; name: string } | null) => {
    if (!assignFor || assignBusy) return;
    setAssignBusy(true); setAssignNotice(null);
    const curId = assignByMachine.get(assignFor.id)?.[shift]?.id ?? '';
    const res = insp
      ? await assignInspector(assignFor.id, insp.id, insp.name, shift)
      : await unassignInspector(assignFor.id, curId, shift);
    setAssignBusy(false);
    if (res.error) {
      setAssignNotice(res.missing
        ? '❌ Falta activar la asignación: corre supabase/inspector_asignacion.sql en Supabase.'
        : '❌ ' + res.error);
      return;
    }
    await loadAssigns();
    setAssignNotice(insp
      ? `✅ ${shiftIcon(shift)} ${shiftLabel(shift)} → ${insp.name}`
      : `➖ ${shiftIcon(shift)} ${shiftLabel(shift)} quitado`);
  };
  // ── Filtros del reporte de asignaciones ──────────────────────────────────
  const [asgQuery, setAsgQuery] = useState('');                 // búsqueda libre
  const [asgSel, setAsgSel] = useState<Set<string>>(new Set()); // inspectores (check)
  const [edifSel, setEdifSel] = useState<Set<string>>(new Set()); // edificios (check)
  const [edifQuery, setEdifQuery] = useState('');               // buscar dentro de los edificios
  const [edifOpen, setEdifOpen] = useState(false);              // desplegable abierto/cerrado
  const [asgExpanded, setAsgExpanded] = useState<Set<string>>(new Set()); // inspectores expandidos (por defecto: colapsados)
  const toggleAsgCollapsed = (name: string) => setAsgExpanded((prev) => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  const toggleAsgInspector = (name: string) => setAsgSel((prev) => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  const toggleEdif = (e: string) => setEdifSel((prev) => { const n = new Set(prev); n.has(e) ? n.delete(e) : n.add(e); return n; });
  // Lista de inspectores y de edificios presentes (para los chips).
  const asgInspectors = useMemo(() => Array.from(new Set(assigns.map((a) => a.inspector_name || '—'))).sort(cmpText), [assigns]);
  const asgEdificios = useMemo(() => Array.from(new Set(assigns.map(edifKey))).sort((a, b) => (a === 'Sin edificio' ? 1 : b === 'Sin edificio' ? -1 : cmpText(a, b))), [assigns]);
  const edifShown = useMemo(() => { const q = norm(edifQuery.trim()); return asgEdificios.filter((e) => !q || norm(e).includes(q)); }, [asgEdificios, edifQuery]);
  // Aplica TODOS los filtros: búsqueda libre + inspector + edificio.
  const filteredAssigns = useMemo(() => {
    const q = norm(asgQuery.trim());
    return assigns.filter((a) => {
      if (asgSel.size > 0 && !asgSel.has(a.inspector_name || '—')) return false;
      if (edifSel.size > 0 && !edifSel.has(edifKey(a))) return false;
      if (!q) return true;
      const hay = [a.code, a.plate, a.serial, a.companyName, a.inspector_name, a.encargado, a.referencia, edifKey(a)]
        .map((x) => norm(String(x ?? ''))).join(' ');
      return hay.includes(q);
    });
  }, [assigns, asgQuery, asgSel, edifSel]);
  const asgByInspector = useMemo(() => {
    const map = new Map<string, AssignmentRow[]>();
    filteredAssigns.forEach((a) => { const k = a.inspector_name || '—'; if (!map.has(k)) map.set(k, []); map.get(k)!.push(a); });
    return Array.from(map.entries()).sort((a, b) => cmpText(a[0], b[0]));
  }, [filteredAssigns]);
  const asgCount = filteredAssigns.length;

  // ── Reporte por inspector (día o rango de fechas, con filtro multi-inspector) ──
  const [repOpen, setRepOpen] = useState(false);
  const [repMode, setRepMode] = useState<'dia' | 'rango'>('dia');
  const [repFrom, setRepFrom] = useState(caracasToday());
  const [repTo, setRepTo] = useState(caracasToday());
  const [repVisits, setRepVisits] = useState<VisitRow[]>([]);
  const [repLoaded, setRepLoaded] = useState(false);
  const [repLoading, setRepLoading] = useState(false);
  const [repSel, setRepSel] = useState<Set<string>>(new Set()); // inspectores marcados (vacío = todos)

  const generarReporte = async () => {
    setRepLoading(true);
    const to = repMode === 'rango' ? repTo : undefined;
    const vs = (await listVisits(repFrom, to)).filter(noAdmin);
    // Orden por inspector y luego por hora de inicio (ascendente).
    vs.sort((a, b) => cmpText(a.supervisor_name || '', b.supervisor_name || '') || String(a.visited_at).localeCompare(String(b.visited_at)));
    setRepVisits(vs);
    setRepLoaded(true);
    setRepLoading(false);
  };
  const repInspectors = useMemo(() => Array.from(new Set(repVisits.map((v) => v.supervisor_name || '—'))).sort(cmpText), [repVisits]);
  const repRows = useMemo(() => repVisits.filter((v) => repSel.size === 0 || repSel.has(v.supervisor_name || '—')), [repVisits, repSel]);
  const repByInspector = useMemo(() => {
    const map = new Map<string, VisitRow[]>();
    repRows.forEach((v) => { const k = v.supervisor_name || '—'; if (!map.has(k)) map.set(k, []); map.get(k)!.push(v); });
    return Array.from(map.entries()).sort((a, b) => cmpText(a[0], b[0]));
  }, [repRows]);
  const toggleRepInspector = (name: string) => setRepSel((prev) => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });

  // PDF del reporte por inspector (hora de inicio · máquina · serial/placa · sector · empresa).
  const reportePorInspector = async () => {
    if (repByInspector.length === 0) return;
    const esc = (t: any) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rango = repMode === 'rango' ? `${dmy(repFrom)} — ${dmy(repTo)}` : dmy(repFrom);
    const mostrarFecha = repMode === 'rango';
    const secciones = repByInspector.map(([name, list]) => {
      const filas = list.map((v) => `<tr>
        <td>${esc(mostrarFecha ? `${dmy(v.visit_date)} ` : '')}${esc(caracasClock(v.visited_at))}</td>
        <td>${esc(v.machineCode)}</td>
        <td>${esc(plateOfVisit(v))}</td>
        <td>${esc(sectorOfVisit(v))}</td>
        <td>${esc((v.machineEncargado || '').trim() || '—')}</td>
        <td>${esc(v.companyName)}</td>
        <td>${esc(STATUS_META[v.status].label)}</td>
      </tr>`).join('');
      return `<h3>👮 ${esc(name)} · ${list.length} registro(s)</h3>
        <table><thead><tr><th>Hora inicio</th><th>Máquina</th><th>Serial/Placa</th><th>Sector</th><th>Encargado</th><th>Empresa</th><th>Estado</th></tr></thead>
          <tbody>${filas}</tbody></table>`;
    }).join('');
    const html = pdfDocument({
      title: 'Inspecciones por inspector',
      subtitle: `${rango} · ${repRows.length} registro(s) · ${repByInspector.length} inspector(es)`,
      extraCss: `table{width:100%;border-collapse:collapse;margin:6px 0 14px;font-size:11px}
        th,td{border:1px solid #c9d2dc;padding:5px 7px;text-align:left} th{background:#16324F;color:#fff}
        tr:nth-child(even) td{background:#f4f7fb} h3{margin:14px 0 2px;font-size:14px;color:#16324F}`,
      body: secciones,
    });
    await exportPdf(html, `Inspecciones ${rango}`);
  };

  const load = useCallback(async () => {
    setLoading(true);
    const [vs, { data: rs }, { data: js }, { data: yl }] = await Promise.all([
      listVisits(date),
      supabase
        .from('machine_rounds')
        .select('machinery_id, day_hours, night_hours, day_operator, night_operator, jornada_start_at, jornada_shift, horometro_inicial, horometro_final, recorded_by, machine:machinery_id(code, serial, plate, encargado, latitude, longitude, sector, referencia, company:company_id(name))')
        .eq('round_date', date),
      supabase
        .from('operator_assignments')
        .select('id, first_name, last_name, cedula, company_name, started_at, ended_at, worked_hours, start_lat, start_lng, end_lat, end_lng, machine:machinery_id(code)')
        .eq('work_date', date)
        .order('started_at', { ascending: true }),
      supabase
        .from('truck_yard_logs')
        .select('machinery_id, machine_code, direction, created_at, machine:machinery_id(company:company_id(name))')
        .gte('created_at', `${date}T00:00:00-04:00`)
        .lte('created_at', `${date}T23:59:59.999-04:00`)
        .order('created_at', { ascending: true }),
    ]);
    setVisits(vs);
    setYardLogs(((yl ?? []) as any[]).map((r) => ({
      machinery_id: r.machinery_id as string,
      code: r.machine_code ?? '—',
      companyName: r.machine?.company?.name ?? 'Sin empresa',
      direction: (r.direction === 'entrada' ? 'entrada' : 'salida') as 'entrada' | 'salida',
      at: r.created_at as string,
    })));
    setJornadas(((js ?? []) as any[]).map((j) => ({
      id: j.id,
      operator: `${j.first_name ?? ''} ${j.last_name ?? ''}`.trim() || '—',
      cedula: j.cedula ?? '',
      code: j.machine?.code ?? '—',
      companyName: j.company_name ?? 'Sin empresa',
      started_at: j.started_at, ended_at: j.ended_at, worked_hours: j.worked_hours,
      start_lat: j.start_lat, start_lng: j.start_lng, end_lat: j.end_lat, end_lng: j.end_lng,
    })));
    const rounds = ((rs ?? []) as any[])
      .filter((r) => workedOf(r) > 0)
      .map((r) => ({
        machinery_id: r.machinery_id as string,
        worked: workedOf(r),
        code: r.machine?.code ?? '—',
        companyName: r.machine?.company?.name ?? 'Sin empresa',
        operator: (r.day_operator || r.night_operator || null) as string | null,
      }));
    rounds.sort((a, b) => a.companyName.localeCompare(b.companyName) || a.code.localeCompare(b.code));
    setRounds(rounds);
    // Jornadas de MÁQUINA del día (las que inicia el inspector con "INICIAR JORNADA"):
    // en curso (jornada_start_at) o finalizadas (con horas). Guarda crudo; se filtra
    // el admin y se resuelve el nombre del inspector en un useMemo (según recorded_by).
    setRawRounds(((rs ?? []) as any[])
      .filter((r) => r.jornada_start_at || workedOf(r) > 0)
      .map((r) => ({
        machinery_id: r.machinery_id as string,
        code: r.machine?.code ?? '—',
        companyName: r.machine?.company?.name ?? 'Sin empresa',
        serial: (r.machine?.serial ?? null) as string | null,
        plate: (r.machine?.plate ?? null) as string | null,
        encargado: (r.machine?.encargado ?? null) as string | null,
        startAt: (r.jornada_start_at ?? null) as string | null,
        shift: (r.jornada_shift ?? null) as 'day' | 'night' | null,
        worked: workedOf(r),
        horoIni: (r.horometro_inicial ?? null) as number | null,
        horoFin: (r.horometro_final ?? null) as number | null,
        recordedBy: (r.recorded_by ?? null) as string | null,
        lat: (r.machine?.latitude ?? null) as number | null,
        lng: (r.machine?.longitude ?? null) as number | null,
        sector: (r.machine?.sector ?? null) as string | null,
        referencia: (r.machine?.referencia ?? null) as string | null,
      })));
    // Combustible surtido por máquina en el día (para mostrar ⛽ L y L/h en la jornada).
    loadFuelByMachine(date).then(setFuelDay).catch(() => setFuelDay({}));
    // Retraso de declaración (columna opcional): consulta aislada para que si la
    // columna aún no existe (falta correr el SQL) NO rompa el resto del módulo.
    try {
      const { data: lateData } = await supabase.from('machine_rounds').select('machinery_id, jornada_late_min').eq('round_date', date);
      const lm: Record<string, number> = {};
      ((lateData ?? []) as any[]).forEach((r) => { const v = Number(r.jornada_late_min); if (isFinite(v) && v > 0) lm[r.machinery_id] = v; });
      setLateMap(lm);
    } catch { setLateMap({}); }
    setLoading(false);
  }, [date]);
  useEffect(() => { load(); }, [load]);

  // TIEMPO REAL: al marcar una máquina (supervisor) o registrar/finalizar una
  // jornada, la supervisión del día se actualiza sola.
  useRealtimeRefresh(['supervisor_visits', 'machine_rounds', 'operator_assignments', 'truck_yard_logs'], () => { load(); });
  // Al asignar/quitar una máquina con el CHECK (teléfono), refresca las asignaciones.
  useRealtimeRefresh(['machine_inspectors'], () => { loadAssigns(); });

  const shiftDay = (delta: number) => {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    setDate(d.toISOString().slice(0, 10));
  };

  // Jornadas de MÁQUINA del día (iniciadas por el inspector): oculta las de admin y
  // resuelve el nombre del inspector por recorded_by. En curso primero, luego finalizadas.
  const machJornadas = useMemo(() => rawRounds
    .filter((r) => !(r.recordedBy && adminIds.has(r.recordedBy)))
    .map((r) => ({ ...r, inspector: r.recordedBy ? (nameById[r.recordedBy] || '—') : '—', enCurso: !!r.startAt }))
    .sort((a, b) => (a.enCurso === b.enCurso ? cmpText(a.code, b.code) : a.enCurso ? -1 : 1)),
    [rawRounds, adminIds, nameById]);

  // ── Jornadas de máquina: búsqueda + agrupación por inspector + colapsable ──
  const [machJorQuery, setMachJorQuery] = useState('');                        // búsqueda libre
  const [machJorExpanded, setMachJorExpanded] = useState<Set<string>>(new Set()); // inspectores expandidos (por defecto: colapsados)
  const toggleMachJorCollapsed = (name: string) => setMachJorExpanded((prev) => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  const machJornadasByInspector = useMemo(() => {
    const q = machJorQuery.trim().toLowerCase();
    const filtered = q
      ? machJornadas.filter((j) => `${j.inspector} ${j.code} ${j.companyName} ${j.serial ?? ''} ${j.plate ?? ''} ${j.encargado ?? ''}`.toLowerCase().includes(q))
      : machJornadas;
    const map = new Map<string, typeof filtered>();
    filtered.forEach((j) => {
      const k = j.inspector || '—';
      if (!map.has(k)) map.set(k, [] as any);
      map.get(k)!.push(j);
    });
    return Array.from(map.entries()).sort((a, b) => cmpText(a[0], b[0]));
  }, [machJornadas, machJorQuery]);

  // 🚚 Asistencia de camiones del día: por camión, su SALIDA (al iniciar jornada) y
  // ENTRADA (al finalizar). Presente = tuvo salida. Ordenado A→Z por código.
  const camiones = useMemo(() => {
    type C = { code: string; companyName: string; salida: string | null; entrada: string | null; jornada: boolean };
    const map = new Map<string, C>();
    // Base: JORNADAS de camiones (volteo/toronto/volqueta). Así aparecen aunque su
    // salida/entrada no se haya registrado en el patio (jornadas iniciadas antes).
    rawRounds.filter((r) => isVolteoVolqueta(r.code)).forEach((r) => {
      const cur = map.get(r.machinery_id) || { code: r.code, companyName: r.companyName, salida: null, entrada: null, jornada: false };
      cur.jornada = true;
      if (r.startAt) { if (!cur.salida || r.startAt < cur.salida) cur.salida = r.startAt; } // jornada abierta → salió a esa hora
      cur.code = r.code; cur.companyName = r.companyName;
      map.set(r.machinery_id, cur);
    });
    // Superpone los movimientos reales de patio (hora exacta de salida/entrada).
    yardLogs.forEach((l) => {
      const cur = map.get(l.machinery_id) || { code: l.code, companyName: l.companyName, salida: null, entrada: null, jornada: false };
      if (l.direction === 'salida') { if (!cur.salida || l.at < cur.salida) cur.salida = l.at; }
      else { if (!cur.entrada || l.at > cur.entrada) cur.entrada = l.at; }
      cur.code = l.code; cur.companyName = l.companyName;
      map.set(l.machinery_id, cur);
    });
    return Array.from(map.values()).sort((a, b) => cmpText(a.code, b.code));
  }, [rawRounds, yardLogs]);
  const camPresentes = useMemo(() => camiones.filter((c) => c.salida || c.jornada).length, [camiones]);

  // 📄 Reporte PDF de asistencia de camiones (salida/entrada del día).
  const reporteCamiones = async () => {
    if (camiones.length === 0) return;
    const esc = (t: any) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const filas = camiones.map((c) => {
      const estado = c.salida && c.entrada ? '🟢 Regresó' : (c.salida || c.jornada) ? '🟠 En obra' : '— sin salida';
      return `<tr>
        <td>${esc(c.code)}</td>
        <td>${esc(c.companyName)}</td>
        <td>${esc(c.salida ? caracasClock(c.salida) : '—')}</td>
        <td>${esc(c.entrada ? caracasClock(c.entrada) : '—')}</td>
        <td>${esc(estado)}</td>
      </tr>`;
    }).join('');
    const html = pdfDocument({
      title: 'Asistencia de camiones',
      subtitle: `${dmy(date)} · ${camPresentes} con salida (asistencia) de ${camiones.length} con movimiento`,
      extraCss: `table{width:100%;border-collapse:collapse;margin:6px 0 14px;font-size:11px}
        th,td{border:1px solid #c9d2dc;padding:5px 7px;text-align:left} th{background:#16324F;color:#fff}
        tr:nth-child(even) td{background:#f4f7fb}`,
      body: `<table><thead><tr><th>Camión</th><th>Empresa</th><th>Salida</th><th>Entrada</th><th>Estado</th></tr></thead><tbody>${filas}</tbody></table>`,
    });
    await exportPdf(html, `Asistencia camiones ${dmy(date)}`);
  };

  // Visitas SIN las de admin (pruebas): así el admin no aparece como inspector.
  const cleanVisits = useMemo(() => visits.filter(noAdmin), [visits, adminIds]);
  const visitedIds = useMemo(() => new Set(cleanVisits.map((v) => v.machinery_id)), [cleanVisits]);
  const unvalidated = useMemo(() => rounds.filter((r) => !visitedIds.has(r.machinery_id)), [rounds, visitedIds]);
  const validated = rounds.length - unvalidated.length;

  // KPIs pedidos: jornadas iniciadas (total), máquinas averiadas y jornadas terminadas.
  const jornadasTerminadasList = useMemo(() => machJornadas.filter((j) => !j.enCurso), [machJornadas]);
  // Jornadas EN CURSO (no finalizadas): pendientes por finalizar (A→Z natural por código).
  const pendientesList = useMemo(() => machJornadas.filter((j) => j.enCurso).sort((a, b) => cmpText(a.code, b.code)), [machJornadas]);
  // Máquinas averiadas (parada): última visita 'parada' por máquina (para la lista).
  const averiadaList = useMemo(() => {
    const map = new Map<string, VisitRow>();
    cleanVisits.filter((v) => v.status === 'parada').forEach((v) => {
      const cur = map.get(v.machinery_id);
      if (!cur || String(v.visited_at) > String(cur.visited_at)) map.set(v.machinery_id, v);
    });
    return Array.from(map.values()).sort((a, b) => cmpText(a.machineCode || '', b.machineCode || ''));
  }, [cleanVisits]);
  const maquinasAveriadas = averiadaList.length;
  // Resumen por TURNO (día/noche): iniciadas, terminadas y pendientes por finalizar.
  const dayJorn = useMemo(() => machJornadas.filter((j) => j.shift === 'day'), [machJornadas]);
  const nightJorn = useMemo(() => machJornadas.filter((j) => j.shift === 'night'), [machJornadas]);
  const dayS = useMemo(() => ({ ini: dayJorn.length, fin: dayJorn.filter((j) => !j.enCurso).length, pend: dayJorn.filter((j) => j.enCurso).length }), [dayJorn]);
  const nightS = useMemo(() => ({ ini: nightJorn.length, fin: nightJorn.filter((j) => !j.enCurso).length, pend: nightJorn.filter((j) => j.enCurso).length }), [nightJorn]);

  // Tarjeta KPI tocada → abre la lista con detalle y buscador. `kpiShift` filtra por turno.
  const [kpiModal, setKpiModal] = useState<null | 'iniciadas' | 'averiadas' | 'terminadas' | 'pendientes'>(null);
  const [kpiShift, setKpiShift] = useState<null | 'day' | 'night'>(null);
  const [kpiQuery, setKpiQuery] = useState('');
  // Detalle de una jornada de máquina (al tocar la tarjeta): bottom-sheet con todo.
  const [detailJorn, setDetailJorn] = useState<any | null>(null);

  // Traza agrupada por supervisor.
  const bySupervisor = useMemo(() => {
    const map = new Map<string, VisitRow[]>();
    cleanVisits.forEach((v) => {
      const k = v.supervisor_name || '—';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(v);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [cleanVisits]);

  // ── Reporte PDF de la traza del día (resumen por supervisor + detalle) ──────
  const reporte = async () => {
    if (bySupervisor.length === 0) return;
    const esc = (t: any) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const proxTxt = (v: VisitRow) => {
      const p = proximityOf(v);
      if (p === 'sitio') return `en sitio ✓ (~${v.distance_m} m)`;
      if (p === 'lejos') return `lejos ⚠️ (~${v.distance_m} m)`;
      return 'sin GPS';
    };
    const proxColor = (v: VisitRow) => (proximityOf(v) === 'sitio' ? '#1E9E4A' : proximityOf(v) === 'lejos' ? '#D9A200' : '#6B7280');
    const secciones = bySupervisor.map(([name, list]) => {
      const s = summarize(list);
      const filas = list.map((v) => `<tr>
        <td>${esc(caracasClock(v.visited_at))}</td>
        <td>${esc(v.machineCode)}</td>
        <td>${esc(v.companyName)}</td>
        <td>${esc(STATUS_META[v.status].label)}</td>
        <td style="color:${proxColor(v)};font-weight:700">${esc(proxTxt(v))}</td>
      </tr>`).join('');
      return `<h3>👮 ${esc(name)}</h3>
        <p class="sum">${s.total} check-in(s) · ${s.maquinas} máquina(s) única(s) —
          <b style="color:#1E9E4A">${s.sitio} en sitio</b> ·
          <b style="color:#D9A200">${s.lejos} lejos</b> ·
          <b style="color:#6B7280">${s.nogps} sin GPS</b></p>
        <table><thead><tr><th>Hora</th><th>Máquina</th><th>Empresa</th><th>Estado</th><th>Ubicación</th></tr></thead>
          <tbody>${filas}</tbody></table>`;
    }).join('');
    const sinValidar = unvalidated.length === 0
      ? `<p class="ok">✓ Todas las jornadas del día están validadas.</p>`
      : `<table><thead><tr><th>Máquina</th><th>Empresa</th><th>Operador</th><th class="r">Horas</th></tr></thead><tbody>${
          unvalidated.map((r) => `<tr><td>${esc(r.code)}</td><td>${esc(r.companyName)}</td><td>${esc(r.operator ?? '—')}</td><td class="r">${r.worked} h</td></tr>`).join('')
        }</tbody></table>`;
    const html = pdfDocument({
      title: 'Reporte de inspecciones',
      subtitle: `Rondas del ${dmy(date)} · ${cleanVisits.length} visita(s) · ${validated} jornada(s) validada(s) · ${unvalidated.length} sin validar`,
      extraCss: `table{width:100%;border-collapse:collapse;margin:6px 0 14px;font-size:11px}
        th,td{border:1px solid #c9d2dc;padding:5px 7px;text-align:left} th{background:#16324F;color:#fff}
        td.r,th.r{text-align:right} tr:nth-child(even) td{background:#f4f7fb}
        h3{margin:14px 0 2px;font-size:14px;color:#16324F} .sum{margin:0 0 4px;font-size:11px;color:#333}
        .ok{color:#1E9E4A;font-weight:700} h2{font-size:15px;color:#16324F;margin-top:18px}`,
      body: `${secciones}<h2>⛔ Jornadas sin validar</h2>${sinValidar}`,
    });
    await exportPdf(html, `Supervision ${dmy(date)}`);
  };

  // Sector de la máquina de una asignación (por ubicación; si no, por referencia).
  const sectorOfAssign = (a: AssignmentRow): string => {
    const s = sectorLabel(sectorOf(a.latitude, a.longitude));
    return s && s !== 'Sin zona' ? s : (a.referencia || 'Sin zona');
  };
  // Referencia legible (edificio): descarta valores que sean solo números/coordenadas.
  const refOf = (a: AssignmentRow): string => {
    const t = (a.referencia ?? '').trim();
    return t && !/^[\d.,\s-]+$/.test(t) ? t : '—';
  };

  // 📄 REPORTE 2: máquinas asignadas por inspector, UBICADAS POR SECTOR, con
  // referencia + serial + placa + empresa. SIN el estado de la máquina.
  const reporteAsignacionesPorSector = async () => {
    if (asgByInspector.length === 0) return;
    const esc = (t: any) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const secciones = asgByInspector.map(([name, list]) => {
      // Agrupa las máquinas del inspector por sector (A→Z, "Sin zona" al final).
      const bySector = new Map<string, AssignmentRow[]>();
      list.forEach((a) => { const k = sectorOfAssign(a); if (!bySector.has(k)) bySector.set(k, []); bySector.get(k)!.push(a); });
      const sectores = Array.from(bySector.entries()).sort((x, y) =>
        (x[0] === 'Sin zona' ? 1 : y[0] === 'Sin zona' ? -1 : cmpText(x[0], y[0])));
      const bloques = sectores.map(([sector, ms]) => {
        const filas = ms.map((a) => `<tr>
          <td>${esc(a.shift === 'night' ? '🌙 Noche' : '☀️ Día')}</td>
          <td>${esc(a.code)}</td>
          <td>${esc(refOf(a))}</td>
          <td>${esc(a.serial || '—')}</td>
          <td>${esc(a.plate || '—')}</td>
          <td>${esc(a.companyName)}</td>
        </tr>`).join('');
        return `<h4>📍 ${esc(sector)} · ${ms.length}</h4>
          <table><thead><tr><th>Turno</th><th>Máquina</th><th>Referencia</th><th>Serial</th><th>Placa</th><th>Empresa</th></tr></thead>
            <tbody>${filas}</tbody></table>`;
      }).join('');
      return `<h3>👮 ${esc(name)} · ${list.length} máquina(s)</h3>${bloques}`;
    }).join('');
    const html = pdfDocument({
      title: 'Máquinas asignadas por inspector · por sector',
      subtitle: `${asgCount} asignación(es) · ${asgByInspector.length} inspector(es)`,
      extraCss: `table{width:100%;border-collapse:collapse;margin:4px 0 12px;font-size:11px}
        th,td{border:1px solid #c9d2dc;padding:5px 7px;text-align:left} th{background:#16324F;color:#fff}
        tr:nth-child(even) td{background:#f4f7fb} h3{margin:14px 0 4px;font-size:14px;color:#16324F}
        h4{margin:8px 0 2px;font-size:12px;color:#2A5C8A}`,
      body: secciones,
    });
    await exportPdf(html, 'Asignaciones por sector');
  };

  if (loading) return <Screen><ConfigBanner /><Loading /></Screen>;

  const kpi = (label: string, value: React.ReactNode, color: string, onPress?: () => void) => {
    const inner = (
      <>
        <Text style={{ color, fontSize: 22, fontWeight: '900' }}>{value}</Text>
        <Text style={{ color: colors.muted, fontSize: 11, textAlign: 'center' }}>{label}{onPress ? ' ›' : ''}</Text>
      </>
    );
    const style = { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: onPress ? colors.primary : colors.border, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' } as const;
    return onPress
      ? <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={style}>{inner}</TouchableOpacity>
      : <View style={style}>{inner}</View>;
  };

  // Mini-métrica dentro de una tarjeta de Resumen (tocable → abre el modal del turno).
  const miniStat = (label: string, value: React.ReactNode, color: string, onPress: () => void) => (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={{ flex: 1, alignItems: 'center', paddingVertical: 4 }}>
      <Text style={{ color, fontSize: 18, fontWeight: '900' }}>{value}</Text>
      <Text style={{ color: colors.muted, fontSize: 10, textAlign: 'center' }}>{label} ›</Text>
    </TouchableOpacity>
  );
  // Tarjeta de RESUMEN por turno (Día / Noche): iniciadas · terminadas · pendientes.
  const resumenCard = (title: string, s: { ini: number; fin: number; pend: number }, shift: 'day' | 'night') => (
    <View style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
      <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13, textAlign: 'center', marginBottom: 4 }}>{title}</Text>
      <View style={{ flexDirection: 'row' }}>
        {miniStat('Iniciadas', s.ini, colors.success, () => { setKpiQuery(''); setKpiShift(shift); setKpiModal('iniciadas'); })}
        {miniStat('Terminadas', s.fin, '#2563EB', () => { setKpiQuery(''); setKpiShift(shift); setKpiModal('terminadas'); })}
        {miniStat('Pendientes', s.pend, s.pend > 0 ? '#D9A200' : colors.success, () => { setKpiQuery(''); setKpiShift(shift); setKpiModal('pendientes'); })}
      </View>
    </View>
  );

  // Cabecera de sección colapsable: mismo look que SectionTitle + flecha ▾/▸.
  const secHead = (key: string, title: string) => {
    const closed = secClosed.has(key);
    return (
      <TouchableOpacity onPress={() => toggleSec(key)} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Text style={{ color: colors.primary, fontWeight: '900', fontSize: 16 }}>{closed ? '▸' : '▾'}</Text>
        <Text style={[typography.title, { marginBottom: spacing.xs, flex: 1 }]}>{title}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>🪖 Inspecciones — rondas del día</SectionTitle>

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <TouchableOpacity onPress={() => shiftDay(-1)} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}>
            <Text style={{ color: colors.primary, fontWeight: '800' }}>◀</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <DateField value={date} onChange={setDate} maxISO={caracasToday()} />
          </View>
          <TouchableOpacity onPress={() => shiftDay(1)} disabled={date >= caracasToday()} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, opacity: date >= caracasToday() ? 0.4 : 1 }}>
            <Text style={{ color: colors.primary, fontWeight: '800' }}>▶</Text>
          </TouchableOpacity>
        </View>
        {/* Máquinas averiadas (total del día). */}
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          {kpi('Máquinas averiadas', maquinasAveriadas, maquinasAveriadas > 0 ? colors.warning : colors.success, () => { setKpiQuery(''); setKpiShift(null); setKpiModal('averiadas'); })}
        </View>
        {/* Resumen por TURNO: ☀️ Día y 🌙 Noche (iniciadas · terminadas · pendientes por finalizar). */}
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          {resumenCard('☀️ Resumen DÍA', dayS, 'day')}
          {resumenCard('🌙 Resumen NOCHE', nightS, 'night')}
        </View>
        {/* 📄 Reporte de estado del día (4 secciones): iniciadas · pendientes · averiadas · finalizadas. */}
        <TouchableOpacity onPress={() => generateEstadoReport({ date })} style={{ marginTop: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
          <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 13, textAlign: 'center' }}>📄 Reporte de estado (iniciadas · pendientes · averiadas · finalizadas)</Text>
        </TouchableOpacity>
        {/* 📱 Vista de inspector (teléfono) en la PC — SOLO ADMIN. */}
        {isAdmin ? (
          <>
            <TouchableOpacity onPress={() => navigation?.navigate?.('InspectorTlf')} style={{ marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
              <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 13, textAlign: 'center' }}>📱 Ver vista de inspector (como en el teléfono)</Text>
            </TouchableOpacity>
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs, textAlign: 'center' }}>Abre la vista que usan los inspectores en el teléfono (escanear máquina, iniciar/finalizar jornada, avería)</Text>
          </>
        ) : null}
      </Card>

      {/* ── ✅ MÁQUINAS ASIGNADAS (CHECK del teléfono) — inspector ↔ máquina ── */}
      {secHead('asg', '✅ Máquinas asignadas por inspector (CHECK)')}
      {secClosed.has('asg') ? null : assignsMissing ? (
        <Card><Text style={{ color: colors.warning, fontWeight: '700', fontSize: 12 }}>
          ⚠️ Falta activar la asignación: corre <Text style={{ fontWeight: '900' }}>supabase/inspector_asignacion.sql</Text> en Supabase.
        </Text></Card>
      ) : assigns.length === 0 ? (
        <EmptyState title="Sin asignaciones" subtitle="Cuando un inspector se asigna una máquina con ✅ CHECK MÁQUINA (teléfono), aparece aquí." />
      ) : (
        <>
          {/* Búsqueda libre: máquina, placa, serial, empresa, inspector, encargado, edificio. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, marginBottom: spacing.sm }}>
            <Text style={{ fontSize: 14 }}>🔎</Text>
            <TextInput value={asgQuery} onChangeText={setAsgQuery} placeholder="Buscar: máquina, placa, serial, empresa, inspector, encargado, edificio…" placeholderTextColor={colors.muted} style={{ flex: 1, color: colors.text, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs }} />
            {asgQuery ? <TouchableOpacity onPress={() => setAsgQuery('')}><Text style={{ color: colors.primary, fontWeight: '800', paddingHorizontal: spacing.xs }}>✕</Text></TouchableOpacity> : null}
          </View>

          {/* Filtro por INSPECTOR (check; vacío = todos). */}
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, marginBottom: spacing.xs }}>👮 Inspectores (marca uno o varios · vacío = todos)</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
            {asgInspectors.map((name) => {
              const on = asgSel.has(name);
              return (
                <TouchableOpacity key={name} onPress={() => toggleAsgInspector(name)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary + '18' : colors.surface, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 6 }}>
                  <Text style={{ fontSize: 13 }}>{on ? '☑️' : '⬜'}</Text>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>{name}</Text>
                </TouchableOpacity>
              );
            })}
            {asgSel.size > 0 ? (
              <TouchableOpacity onPress={() => setAsgSel(new Set())} style={{ borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 6, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>Limpiar</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Filtro por EDIFICIO/REFERENCIA: LISTA DESPLEGABLE con check (buscable). */}
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, marginBottom: spacing.xs }}>🏢 Edificio / referencia</Text>
          <TouchableOpacity
            onPress={() => setEdifOpen((v) => !v)}
            activeOpacity={0.8}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderWidth: 1, borderColor: edifOpen ? colors.primary : colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, marginBottom: edifOpen ? 0 : spacing.sm }}
          >
            <Text style={{ color: edifSel.size > 0 ? colors.text : colors.muted, fontSize: 13, fontWeight: '700', flex: 1 }} numberOfLines={1}>
              {edifSel.size === 0 ? 'Todos los edificios' : `${edifSel.size} seleccionado(s)`}
            </Text>
            <Text style={{ color: colors.primary, fontWeight: '800' }}>{edifOpen ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          {edifOpen ? (
            <View style={{ borderWidth: 1, borderColor: colors.primary, borderTopWidth: 0, borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, marginBottom: spacing.xs }}>
                <Text style={{ fontSize: 13 }}>🔎</Text>
                <TextInput value={edifQuery} onChangeText={setEdifQuery} placeholder="Buscar edificio…" placeholderTextColor={colors.muted} style={{ flex: 1, color: colors.text, paddingVertical: spacing.xs, paddingHorizontal: spacing.xs }} />
              </View>
              <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                {edifShown.map((e) => {
                  const on = edifSel.has(e);
                  return (
                    <TouchableOpacity key={e} onPress={() => toggleEdif(e)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 9, paddingHorizontal: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: on ? colors.primary + '12' : 'transparent' }}>
                      <Text style={{ fontSize: 16 }}>{on ? '☑️' : '⬜'}</Text>
                      <Text style={{ color: colors.text, fontWeight: on ? '800' : '600', fontSize: 13, flex: 1 }}>{e}</Text>
                    </TouchableOpacity>
                  );
                })}
                {edifShown.length === 0 ? <Text style={{ color: colors.muted, fontSize: 12, padding: spacing.sm }}>Sin resultados.</Text> : null}
              </ScrollView>
              {edifSel.size > 0 ? (
                <TouchableOpacity onPress={() => setEdifSel(new Set())} style={{ marginTop: spacing.xs, alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 6, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>Limpiar selección</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          <TouchableOpacity onPress={reporteAsignacionesPorSector} style={{ marginBottom: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
            <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 13 }}>📄 PDF por sector · referencia/serial/placa/empresa ({asgCount})</Text>
          </TouchableOpacity>
          {asgByInspector.length === 0 ? (
            <EmptyState title="Sin resultados" subtitle="Ninguna asignación coincide con los filtros." />
          ) : (
            <>
              {/* Expandir / colapsar todos los inspectores de un toque. */}
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs }}>
                <TouchableOpacity onPress={() => setAsgExpanded(new Set(asgByInspector.map(([n]) => n)))} style={{ borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 5, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>▾ Expandir todo</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setAsgExpanded(new Set())} style={{ borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 5, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>▸ Colapsar todo</Text>
                </TouchableOpacity>
              </View>
              {asgByInspector.map(([name, list]) => {
                const collapsed = asgQuery.trim() ? false : !asgExpanded.has(name);
                return (
                  <Card key={name}>
                    <TouchableOpacity onPress={() => toggleAsgCollapsed(name)} activeOpacity={0.7} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: collapsed ? 0 : spacing.xs }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }} numberOfLines={1}>{collapsed ? '▸' : '▾'} 👮 {name}</Text>
                      <Text style={{ color: colors.success, fontSize: 12, fontWeight: '800' }}>{list.length} máq.</Text>
                    </TouchableOpacity>
                    {collapsed ? null : list.map((a) => (
                      <View key={a.id} style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{a.shift === 'night' ? '🌙' : '☀️'} {shiftLabel(a.shift)} · 🚜 {a.code} <Text style={{ color: colors.muted, fontWeight: '400' }}>· {a.companyName}</Text></Text>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>📍 {sectorOfAssign(a)}{refOf(a) !== '—' ? ` · ${refOf(a)}` : ''} · 🔖 {a.serial || '—'} / {a.plate || '—'}{a.encargado ? ` · 👤 ${a.encargado}` : ''}</Text>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>✅ asignada {dmy(a.assigned_at.slice(0, 10))} {caracasClock(a.assigned_at)}</Text>
                        {isAdmin ? (
                          <TouchableOpacity onPress={() => openAssign(a)} style={{ marginTop: 4, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 5 }}>
                            <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 12 }}>👮 Asignar / reasignar inspector</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    ))}
                  </Card>
                );
              })}
            </>
          )}
        </>
      )}

      {/* ── REPORTE por inspector: día o rango de fechas + filtro multi-inspector ── */}
      <TouchableOpacity onPress={() => setRepOpen((v) => !v)} activeOpacity={0.8}>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Text style={{ fontSize: 24 }}>📊</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '800', color: colors.text, fontSize: 15 }}>Reporte por inspector</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Por día o rango de fechas · hora de inicio, máquina, serial/placa, sector, empresa</Text>
            </View>
            <Text style={{ color: colors.primary, fontWeight: '800' }}>{repOpen ? '▲' : '▼'}</Text>
          </View>
        </Card>
      </TouchableOpacity>

      {repOpen ? (
        <Card>
          {/* Modo: un día o un rango */}
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
            {(['dia', 'rango'] as const).map((m) => {
              const on = repMode === m;
              return (
                <TouchableOpacity key={m} onPress={() => setRepMode(m)} style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 2, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface }}>
                  <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 13 }}>{m === 'dia' ? '📅 Un día' : '📆 Rango'}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>{repMode === 'dia' ? 'Día' : 'Desde'}</Text>
          <DateField value={repFrom} onChange={setRepFrom} maxISO={caracasToday()} />
          {repMode === 'rango' ? (
            <>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Hasta</Text>
              <DateField value={repTo} onChange={setRepTo} maxISO={caracasToday()} />
            </>
          ) : null}
          <TouchableOpacity onPress={generarReporte} disabled={repLoading} style={{ marginTop: spacing.md, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: repLoading ? 0.6 : 1 }}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>{repLoading ? 'Buscando…' : '🔎 Generar'}</Text>
          </TouchableOpacity>

          {repLoaded ? (
            repVisits.length === 0 ? (
              <View style={{ marginTop: spacing.md }}><EmptyState title="Sin inspecciones" subtitle="No hay registros para ese día o rango." /></View>
            ) : (
              <>
                {/* Filtro por inspector (check para seleccionar varios o uno; vacío = todos). */}
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, marginTop: spacing.md, marginBottom: spacing.xs }}>Inspectores (marca uno o varios · vacío = todos)</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
                  {repInspectors.map((name) => {
                    const on = repSel.has(name);
                    return (
                      <TouchableOpacity key={name} onPress={() => toggleRepInspector(name)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary + '18' : colors.surface, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 6 }}>
                        <Text style={{ fontSize: 13 }}>{on ? '☑️' : '⬜'}</Text>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>{name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                  {repSel.size > 0 ? (
                    <TouchableOpacity onPress={() => setRepSel(new Set())} style={{ borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 6, borderWidth: 1, borderColor: colors.border }}>
                      <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>Limpiar</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                <TouchableOpacity onPress={reportePorInspector} style={{ marginBottom: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                  <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 13 }}>📄 Descargar PDF ({repRows.length})</Text>
                </TouchableOpacity>

                {/* Resultado en pantalla, agrupado por inspector. */}
                {repByInspector.map(([name, list]) => (
                  <View key={name} style={{ marginTop: spacing.xs }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, marginBottom: 2 }}>👮 {name} · {list.length}</Text>
                    {list.map((v) => (
                      <View key={v.id} style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>
                          🕒 {repMode === 'rango' ? `${dmy(v.visit_date)} · ` : ''}{caracasClock(v.visited_at)} · {v.machineCode}
                        </Text>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>
                          🔖 {plateOfVisit(v)} · 📍 {sectorOfVisit(v)} · 🏢 {v.companyName}
                        </Text>
                        {(v.machineEncargado || '').trim() ? <Text style={{ color: colors.muted, fontSize: 12 }}>👤 {v.machineEncargado}</Text> : null}
                      </View>
                    ))}
                  </View>
                ))}
              </>
            )
          ) : null}
        </Card>
      ) : null}

      {/* Submódulo: entrada y salida de camiones (calendario del patio). */}
      <TouchableOpacity onPress={() => navigation?.navigate?.('Camiones')} activeOpacity={0.8}>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Text style={{ fontSize: 26 }}>🚚</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '800', color: colors.text, fontSize: 15 }}>Entrada y salida de camiones</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Calendario: cuántos camiones entraron y salieron cada día</Text>
            </View>
            <Text style={{ color: colors.primary, fontSize: 20, fontWeight: '800' }}>›</Text>
          </View>
        </Card>
      </TouchableOpacity>

      {/* ── 🚚 CAMIONES (ASISTENCIA): salida al iniciar jornada / entrada al finalizar ── */}
      {secHead('camiones', '🚚 Camiones (asistencia)')}
      {secClosed.has('camiones') ? null : camiones.length === 0 ? (
        <EmptyState title="Sin movimiento de camiones" subtitle="La asistencia se toma sola: al INICIAR la jornada de un camión se registra su SALIDA y al FINALIZAR su ENTRADA." />
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
            {kpi('Con salida', camPresentes, colors.success)}
            {kpi('Con movimiento', camiones.length, colors.text)}
          </View>
          <TouchableOpacity onPress={reporteCamiones} style={{ marginBottom: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
            <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 13 }}>📄 Reporte de asistencia de camiones (PDF)</Text>
          </TouchableOpacity>
          {camiones.map((c) => {
            const estado = c.salida && c.entrada ? { t: '🟢 Regresó', col: colors.success } : (c.salida || c.jornada) ? { t: '🟠 En obra', col: colors.warning } : { t: '— sin salida', col: colors.muted };
            return (
              <Card key={c.code}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }} numberOfLines={1}>🚚 {c.code} <Text style={{ color: colors.muted, fontWeight: '400', fontSize: 12 }}>· {c.companyName}</Text></Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>🟠 Salida: {c.salida ? caracasClock(c.salida) : '—'} · 🟢 Entrada: {c.entrada ? caracasClock(c.entrada) : '—'}</Text>
                  </View>
                  <Text style={{ color: estado.col, fontWeight: '800', fontSize: 12 }}>{estado.t}</Text>
                </View>
              </Card>
            );
          })}
        </>
      )}

      {/* ── JORNADAS DE MÁQUINA (iniciadas por el inspector con "INICIAR JORNADA") ── */}
      {secHead('machjor', '🟢 Jornadas de máquina (inspector)')}
      {secClosed.has('machjor') ? null : machJornadas.length === 0 ? (
        <EmptyState title="Sin jornadas de máquina este día" subtitle="Aquí aparecen las jornadas que el inspector inicia con 🟢 INICIAR JORNADA (en curso y finalizadas). Las de usuarios admin no se muestran." />
      ) : (
        <>
          {/* Búsqueda libre: inspector, máquina o empresa. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, marginBottom: spacing.sm }}>
            <Text style={{ fontSize: 14 }}>🔎</Text>
            <TextInput value={machJorQuery} onChangeText={setMachJorQuery} placeholder="Buscar: inspector, máquina o empresa…" placeholderTextColor={colors.muted} style={{ flex: 1, color: colors.text, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs }} />
            {machJorQuery ? <TouchableOpacity onPress={() => setMachJorQuery('')}><Text style={{ color: colors.primary, fontWeight: '800', paddingHorizontal: spacing.xs }}>✕</Text></TouchableOpacity> : null}
          </View>
          {/* Expandir / colapsar todos los inspectores. */}
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs }}>
            <TouchableOpacity onPress={() => setMachJorExpanded(new Set(machJornadasByInspector.map(([n]) => n)))} style={{ borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 5, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>▾ Expandir todo</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setMachJorExpanded(new Set())} style={{ borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 5, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>▸ Colapsar todo</Text>
            </TouchableOpacity>
          </View>
          {machJornadasByInspector.length === 0 ? (
            <EmptyState title="Sin resultados" subtitle="Ninguna jornada coincide con la búsqueda." />
          ) : machJornadasByInspector.map(([name, list]) => {
            const collapsed = machJorQuery.trim() ? false : !machJorExpanded.has(name);
            const enCursoN = list.filter((j) => j.enCurso).length;
            return (
              <Card key={name}>
                <TouchableOpacity onPress={() => toggleMachJorCollapsed(name)} activeOpacity={0.7} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: collapsed ? 0 : spacing.xs }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }} numberOfLines={1}>{collapsed ? '▸' : '▾'} 👮 {name}</Text>
                  <Text style={{ color: colors.success, fontSize: 12, fontWeight: '800' }}>{list.length} jorn.{enCursoN > 0 ? ` · ${enCursoN} en curso` : ''}</Text>
                </TouchableOpacity>
                {collapsed ? null : list.map((j) => {
                  const late = lateMap[j.machinery_id] || 0;               // minutos de desfase (si hubo)
                  const finalizada = !j.enCurso;                          // en curso o finalizada → tocar abre el DETALLE
                  return (
                  <TouchableOpacity
                    key={j.machinery_id}
                    activeOpacity={0.6}
                    onPress={() => setDetailJorn(j)}
                    style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }} numberOfLines={1}>🚜 {j.code} <Text style={{ color: colors.muted, fontWeight: '400', fontSize: 12 }}>· {j.companyName}</Text></Text>
                      <Text style={{ color: colors.muted, fontSize: 11 }} numberOfLines={1}>🔖 {j.serial || '—'} / {j.plate || '—'}{j.encargado ? ` · 👤 ${j.encargado}` : ''}</Text>
                      <Text style={{ color: colors.muted, fontSize: 11 }} numberOfLines={1}>⏲️ Horómetro: {j.horoIni ?? '—'} → {j.horoFin ?? '—'}</Text>
                      {j.shift ? <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '600' }}>{j.shift === 'night' ? '🌙 noche' : '☀️ día'}</Text> : null}
                      {fuelDay[j.machinery_id]?.liters ? <Text style={{ color: '#B45309', fontSize: 11, fontWeight: '700' }}>⛽ {litersLabel(fuelDay[j.machinery_id].liters)} L{j.worked > 0 ? ` · ${lphOf(fuelDay[j.machinery_id].liters, j.worked)} L/h` : ''}</Text> : null}
                      {late > 0 ? <Text style={{ color: colors.warning, fontSize: 11, fontWeight: '800' }}>⏰ Inició {lateLabel(late)} tarde (desfasado del horario)</Text> : null}
                      <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '700' }}>👁️ Ver detalle ›</Text>
                    </View>
                    {j.enCurso ? (
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 12 }}>● En curso</Text>
                        {j.startAt ? <Text style={{ color: colors.muted, fontSize: 11 }}>desde {caracasClock(j.startAt)}</Text> : null}
                      </View>
                    ) : (
                      <Text style={{ color: colors.success, fontWeight: '900', fontSize: 15 }}>{j.worked} h</Text>
                    )}
                  </TouchableOpacity>
                  );
                })}
              </Card>
            );
          })}
        </>
      )}

      {/* ── JORNADAS DEL DÍA (operadores) — traza de inicio/fin + ubicación ── */}
      {secHead('opjor', '🚜 Jornadas de operadores')}
      {secClosed.has('opjor') ? null : jornadas.length === 0 ? (
        <EmptyState title="Sin jornadas este día" subtitle="Aquí aparece cada jornada que los operadores inician y finalizan al escanear el QR de la máquina." />
      ) : (
        jornadas.map((j) => {
          const enCurso = !j.ended_at;
          return (
            <Card key={j.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>👷 {j.operator}{j.cedula ? <Text style={{ color: colors.muted, fontWeight: '400', fontSize: 12 }}>  · C.I {j.cedula}</Text> : null}</Text>
                  <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '600' }}>🚜 {j.code} · {j.companyName}</Text>
                </View>
                {enCurso ? (
                  <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 12 }}>● En curso</Text>
                ) : (
                  <Text style={{ color: colors.success, fontWeight: '900', fontSize: 15 }}>{j.worked_hours ?? 0} h</Text>
                )}
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>Inicio</Text>
                  <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>{caracasClock(j.started_at)}</Text>
                  {j.start_lat != null && j.start_lng != null ? (
                    <Text onPress={() => openUrl(mapsUrl(j.start_lat, j.start_lng))} style={{ color: colors.primary, fontSize: 11, fontWeight: '700' }}>📍 Ver ubicación ↗</Text>
                  ) : <Text style={{ color: colors.muted, fontSize: 11 }}>sin ubicación</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>Fin</Text>
                  <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>{j.ended_at ? caracasClock(j.ended_at) : '—'}</Text>
                  {j.end_lat != null && j.end_lng != null ? (
                    <Text onPress={() => openUrl(mapsUrl(j.end_lat, j.end_lng))} style={{ color: colors.primary, fontSize: 11, fontWeight: '700' }}>📍 Ver ubicación ↗</Text>
                  ) : <Text style={{ color: colors.muted, fontSize: 11 }}>{enCurso ? '—' : 'sin ubicación'}</Text>}
                </View>
              </View>
            </Card>
          );
        })
      )}

      {/* ── TRAZA POR INSPECTOR ── */}
      {secHead('traza', 'Traza por inspector')}
      {secClosed.has('traza') ? null : bySupervisor.length > 0 ? (
        <>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Toca una máquina para ver su ficha en el Catálogo.</Text>
          <TouchableOpacity onPress={reporte} style={{ marginBottom: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
            <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 13 }}>📄 Reporte de inspecciones (PDF)</Text>
          </TouchableOpacity>
        </>
      ) : null}
      {secClosed.has('traza') ? null : bySupervisor.length === 0 ? (
        <EmptyState title="Sin visitas este día" subtitle="Ningún inspector marcó máquinas en la fecha elegida." />
      ) : (
        bySupervisor.map(([name, list]) => {
          const s = summarize(list);
          return (
          <Card key={name}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>👮 {name}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{s.total} check-in(s) · {s.maquinas} máq.</Text>
            </View>
            {/* Resumen de cercanía: cuántas confiables (en sitio), de lejos y sin GPS. */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.xs }}>
              <View style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: '#1E9E4A', paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
                <Text style={{ color: '#1E9E4A', fontSize: 11, fontWeight: '800' }}>✓ {s.sitio} en sitio</Text>
              </View>
              <View style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: colors.warning, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
                <Text style={{ color: colors.warning, fontSize: 11, fontWeight: '800' }}>⚠️ {s.lejos} lejos</Text>
              </View>
              <View style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>• {s.nogps} sin GPS</Text>
              </View>
            </View>
            {list.map((v) => {
              const sm = STATUS_META[v.status];
              return (
                <TouchableOpacity key={v.id} onPress={() => openMachine(v)} activeOpacity={0.6} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{v.machineCode} <Text style={{ color: colors.muted, fontWeight: '400' }}>· {v.companyName}</Text></Text>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>
                      {caracasClock(v.visited_at)} · {sm.icon} {sm.label}
                      {v.distance_m != null ? ` · a ~${v.distance_m} m ${v.near ? '(en sitio ✓)' : '(lejos ⚠️)'}` : ' · sin GPS'}
                    </Text>
                    {v.note ? <Text style={{ color: colors.muted, fontSize: 11, fontStyle: 'italic' }}>“{v.note}”</Text> : null}
                  </View>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: v.near === false ? colors.warning : sm.color }} />
                  <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 16 }}>›</Text>
                </TouchableOpacity>
              );
            })}
          </Card>
          );
        })
      )}
      <View style={{ height: spacing.xl }} />

      {/* Detalle de una tarjeta KPI: lista buscable con todos los detalles. */}
      <Modal visible={kpiModal !== null} transparent animationType="fade" onRequestClose={() => setKpiModal(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }} onPress={() => setKpiModal(null)}>
          <Pressable onPress={(e) => e.stopPropagation?.()} style={{ backgroundColor: colors.background, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '85%', paddingTop: spacing.md }}>
            {(() => {
              const q = kpiQuery.trim().toLowerCase();
              const shiftTxt = kpiShift === 'day' ? ' ☀️ Día' : kpiShift === 'night' ? ' 🌙 Noche' : '';
              const title = (kpiModal === 'iniciadas' ? '🟢 Jornadas iniciadas' : kpiModal === 'averiadas' ? '🟡 Máquinas averiadas' : kpiModal === 'pendientes' ? '⏳ Pendientes por finalizar' : '🏁 Jornadas terminadas') + shiftTxt;
              const jSourceBase = kpiModal === 'terminadas' ? jornadasTerminadasList : kpiModal === 'pendientes' ? pendientesList : machJornadas;
              const jSource = kpiShift ? jSourceBase.filter((j) => j.shift === kpiShift) : jSourceBase;
              const jList = jSource.filter((j) =>
                !q || `${j.code} ${j.companyName} ${j.inspector} ${j.serial ?? ''} ${j.plate ?? ''} ${j.encargado ?? ''}`.toLowerCase().includes(q));
              const aList = averiadaList.filter((v) =>
                !q || `${v.machineCode ?? ''} ${v.companyName ?? ''} ${v.supervisor_name ?? ''} ${v.note ?? ''}`.toLowerCase().includes(q));
              const total = kpiModal === 'averiadas' ? aList.length : jList.length;
              return (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, marginBottom: spacing.sm }}>
                    <Text style={{ color: colors.text, fontWeight: '900', fontSize: 16, flex: 1 }}>{title} · {total}</Text>
                    <TouchableOpacity onPress={() => setKpiModal(null)} style={{ paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                      <Text style={{ color: colors.primary, fontWeight: '900', fontSize: 18 }}>✕</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, marginHorizontal: spacing.md, marginBottom: spacing.sm }}>
                    <Text style={{ fontSize: 14 }}>🔎</Text>
                    <TextInput value={kpiQuery} onChangeText={setKpiQuery} placeholder="Buscar…" placeholderTextColor={colors.muted} style={{ flex: 1, color: colors.text, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs }} />
                    {kpiQuery ? <TouchableOpacity onPress={() => setKpiQuery('')}><Text style={{ color: colors.primary, fontWeight: '800', paddingHorizontal: spacing.xs }}>✕</Text></TouchableOpacity> : null}
                  </View>
                  <ScrollView style={{ paddingHorizontal: spacing.md }} contentContainerStyle={{ paddingBottom: spacing.xl }}>
                    {total === 0 ? (
                      <Text style={{ color: colors.muted, textAlign: 'center', paddingVertical: spacing.lg }}>Sin resultados.</Text>
                    ) : kpiModal === 'averiadas' ? (
                      aList.map((v) => (
                        <TouchableOpacity key={v.id} onPress={() => { setKpiModal(null); openMachine(v); }} activeOpacity={0.6} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>🟡 {v.machineCode} <Text style={{ color: colors.muted, fontWeight: '400', fontSize: 12 }}>· {v.companyName}</Text></Text>
                          <Text style={{ color: colors.muted, fontSize: 12 }}>👮 {v.supervisor_name || '—'} · 🕒 {caracasClock(v.visited_at)}</Text>
                          {v.note ? <Text style={{ color: colors.muted, fontSize: 12, fontStyle: 'italic' }}>“{v.note}”</Text> : null}
                          <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '700' }}>🔧 Ver en Mantenimiento ›</Text>
                        </TouchableOpacity>
                      ))
                    ) : (
                      jList.map((j) => {
                        const late = lateMap[j.machinery_id] || 0;
                        return (
                          <TouchableOpacity key={j.machinery_id} activeOpacity={j.enCurso ? 1 : 0.6}
                            onPress={j.enCurso ? undefined : () => { setKpiModal(null); navigation?.navigate?.('Map', { focus: { id: j.machinery_id, code: j.code } }); }}
                            style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>🚜 {j.code} <Text style={{ color: colors.muted, fontWeight: '400', fontSize: 12 }}>· {j.companyName}</Text></Text>
                            <Text style={{ color: colors.muted, fontSize: 12 }}>👮 {j.inspector}{j.shift ? ` · ${j.shift === 'night' ? '🌙 noche' : '☀️ día'}` : ''}</Text>
                            <Text style={{ color: colors.muted, fontSize: 12 }}>🔖 {j.serial || '—'} / {j.plate || '—'}{j.encargado ? ` · 👤 ${j.encargado}` : ''}</Text>
                            <Text style={{ color: colors.muted, fontSize: 11 }}>⏲️ Horómetro: {j.horoIni ?? '—'} → {j.horoFin ?? '—'}</Text>
                            {late > 0 ? <Text style={{ color: colors.warning, fontSize: 11, fontWeight: '800' }}>⏰ Inició {lateLabel(late)} tarde (desfasado)</Text> : null}
                            {j.enCurso ? (
                              <Text style={{ color: colors.warning, fontSize: 12, fontWeight: '800' }}>● En curso{j.startAt ? ` desde ${caracasClock(j.startAt)}` : ''}</Text>
                            ) : (
                              <Text style={{ color: colors.success, fontSize: 12, fontWeight: '800' }}>🏁 {j.worked} h · 📍 Ver ubicación en el mapa ›</Text>
                            )}
                          </TouchableOpacity>
                        );
                      })
                    )}
                  </ScrollView>
                </>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── 👁️ DETALLE de una jornada de máquina (al tocar la tarjeta) ── */}
      <Modal visible={detailJorn !== null} transparent animationType="fade" onRequestClose={() => setDetailJorn(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }} onPress={() => setDetailJorn(null)}>
          <Pressable onPress={(e) => e.stopPropagation?.()} style={{ backgroundColor: colors.background, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '85%', paddingTop: spacing.md }}>
            {detailJorn ? (() => {
              const j = detailJorn;
              // Ubicación: zona por coordenadas; si no hay, sector/referencia guardados.
              const zona = sectorLabel(sectorOf(j.lat, j.lng));
              const sectorTxt = zona && zona !== 'Sin zona' ? zona : (j.sector || j.referencia || 'Sin zona');
              const tieneCoords = j.lat != null && j.lng != null;
              // Edificio: referencia legible (descarta valores solo numéricos/coordenadas).
              const refTxt = (j.referencia ?? '').trim();
              const edificio = refTxt && !/^[\d.,\s-]+$/.test(refTxt) ? refTxt : '';
              // Horas trabajadas y, si está en curso, el transcurrido desde el inicio.
              const elapsedH = j.enCurso && j.startAt
                ? Math.max(0, Math.round(((Date.now() - new Date(j.startAt).getTime()) / 3_600_000) * 10) / 10)
                : null;
              // Parada: si la máquina tiene una avería (parada) registrada hoy, muéstrala.
              const parada = averiadaList.find((v) => v.machinery_id === j.machinery_id) || null;
              const fuel = fuelDay[j.machinery_id];
              const row = (label: string, value: React.ReactNode) => (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Text style={{ color: colors.muted, fontSize: 12, flexShrink: 0 }}>{label}</Text>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700', flex: 1, textAlign: 'right' }}>{value}</Text>
                </View>
              );
              return (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, marginBottom: spacing.sm }}>
                    <Text style={{ color: colors.text, fontWeight: '900', fontSize: 16, flex: 1 }} numberOfLines={1}>🚜 {j.code}</Text>
                    <TouchableOpacity onPress={() => setDetailJorn(null)} style={{ paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                      <Text style={{ color: colors.primary, fontWeight: '900', fontSize: 18 }}>✕</Text>
                    </TouchableOpacity>
                  </View>
                  <ScrollView style={{ paddingHorizontal: spacing.md }} contentContainerStyle={{ paddingBottom: spacing.xl }}>
                    {row('Estado', j.enCurso ? '● En curso' : '🏁 Finalizada')}
                    {row('Empresa', j.companyName || '—')}
                    {row('Serial / Placa', `${j.serial || '—'} / ${j.plate || '—'}`)}
                    {row('Encargado', j.encargado || '—')}
                    {row('Inspector', j.inspector || '—')}
                    {row('Turno', j.shift ? (j.shift === 'night' ? '🌙 Noche' : '☀️ Día') : '—')}
                    {row('Hora iniciada', j.startAt ? caracasClock(j.startAt) : '—')}
                    {row('Horas trabajadas', j.enCurso
                      ? (elapsedH != null ? `${elapsedH} h (transcurridas)` : '—')
                      : `${j.worked} h`)}
                    {row('Horas paradas', parada
                      ? `Parada desde ${caracasClock(parada.visited_at)}${parada.note ? ` · “${parada.note}”` : ''}`
                      : '—')}
                    {row('Ubicación', `📍 ${sectorTxt}${edificio ? ` · 🏢 ${edificio}` : ''}`)}
                    {row('Coordenadas', tieneCoords ? `${j.lat}, ${j.lng}` : 'sin coordenadas')}
                    {row('Horómetro', `${j.horoIni ?? '—'} → ${j.horoFin ?? '—'}`)}
                    {row('Combustible del día', fuel?.liters
                      ? `⛽ ${litersLabel(fuel.liters)} L${j.worked > 0 ? ` · ${lphOf(fuel.liters, j.worked)} L/h` : ''}`
                      : '—')}
                    {tieneCoords ? (
                      <TouchableOpacity onPress={() => openUrl(mapsUrl(j.lat, j.lng))} style={{ marginTop: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                        <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 13 }}>🌐 Abrir en Google Maps ↗</Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity onPress={() => { setDetailJorn(null); navigation?.navigate?.('Map', { focus: { id: j.machinery_id, code: j.code } }); }} style={{ marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                      <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 13 }}>📍 Ver ubicación en el mapa</Text>
                    </TouchableOpacity>
                  </ScrollView>
                </>
              );
            })() : null}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── 👮 ASIGNAR / REASIGNAR inspector de una máquina (SOLO ADMIN) ── */}
      {isAdmin ? (
        <Modal visible={assignFor !== null} transparent animationType="fade" onRequestClose={() => setAssignFor(null)}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }} onPress={() => setAssignFor(null)}>
            <Pressable onPress={(e) => e.stopPropagation?.()} style={{ backgroundColor: colors.background, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '85%', paddingTop: spacing.md }}>
              {assignFor ? (() => {
                const current = assignByMachine.get(assignFor.id)?.[assignShift];
                return (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, marginBottom: spacing.sm }}>
                      <Text style={{ color: colors.text, fontWeight: '900', fontSize: 16, flex: 1 }} numberOfLines={1}>👮 Asignar inspector · 🚜 {assignFor.code}</Text>
                      <TouchableOpacity onPress={() => setAssignFor(null)} style={{ paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                        <Text style={{ color: colors.primary, fontWeight: '900', fontSize: 18 }}>✕</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Turno a asignar: Día ☀️ / Noche 🌙 */}
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

                    {/* Inspector actual del turno elegido (con opción de quitar). */}
                    <View style={{ paddingHorizontal: spacing.md, marginBottom: spacing.sm }}>
                      {current ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm }}>
                          <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700', flex: 1 }} numberOfLines={1}>Actual: 👮 {current.name}</Text>
                          <TouchableOpacity disabled={assignBusy} onPress={() => applyAssign(assignShift, null)} style={{ borderWidth: 1, borderColor: colors.warning, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 5, opacity: assignBusy ? 0.5 : 1 }}>
                            <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 12 }}>➖ Quitar</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <Text style={{ color: colors.muted, fontSize: 12, fontStyle: 'italic' }}>Sin inspector en {shiftLabel(assignShift)}. Elige uno de la lista.</Text>
                      )}
                      {assignNotice ? <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700', marginTop: spacing.xs }}>{assignNotice}</Text> : null}
                    </View>

                    {/* Buscador de inspectores. */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, marginHorizontal: spacing.md, marginBottom: spacing.sm }}>
                      <Text style={{ fontSize: 14 }}>🔎</Text>
                      <TextInput value={inspQuery} onChangeText={setInspQuery} placeholder="Buscar inspector…" placeholderTextColor={colors.muted} style={{ flex: 1, color: colors.text, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs }} />
                      {inspQuery ? <TouchableOpacity onPress={() => setInspQuery('')}><Text style={{ color: colors.primary, fontWeight: '800', paddingHorizontal: spacing.xs }}>✕</Text></TouchableOpacity> : null}
                    </View>

                    {/* Lista de inspectores: un toque asigna al turno elegido (reasigna directo). */}
                    <ScrollView style={{ paddingHorizontal: spacing.md }} contentContainerStyle={{ paddingBottom: spacing.xl }} keyboardShouldPersistTaps="handled">
                      {inspShown.length === 0 ? (
                        <Text style={{ color: colors.muted, textAlign: 'center', paddingVertical: spacing.lg }}>Sin inspectores.</Text>
                      ) : inspShown.map((i) => {
                        const sel = current?.id === i.id;
                        return (
                          <TouchableOpacity key={i.id} disabled={assignBusy} onPress={() => applyAssign(assignShift, i)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border, opacity: assignBusy ? 0.5 : 1, backgroundColor: sel ? colors.primary + '12' : 'transparent' }}>
                            <Text style={{ fontSize: 16 }}>{sel ? '✅' : '👮'}</Text>
                            <Text style={{ color: colors.text, fontWeight: sel ? '800' : '600', fontSize: 14, flex: 1 }}>{i.name}</Text>
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
      ) : null}
    </Screen>
  );
}
