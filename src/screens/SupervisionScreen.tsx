import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput } from 'react-native';
import { Screen, Card, SectionTitle, Loading, EmptyState } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import { supabase } from '../lib/supabase';
import { listVisits, VisitRow } from '../lib/supervisorVisits';
import { listInspectorAssignments, AssignmentRow, shiftLabel } from '../lib/machineInspectors';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { sectorOf, sectorLabel } from '../lib/mapZones';
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
  const { colors } = useTheme();
  // Abre el Catálogo filtrado a ESA máquina (por serial único; si no hay, por código).
  const openMachine = (v: VisitRow) => {
    const term = v.machineSerial || v.machineCode;
    if (term) navigation?.navigate?.('Equipos', { q: String(term) });
  };
  const [date, setDate] = useState(caracasToday());
  const [loading, setLoading] = useState(true);
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [jornadas, setJornadas] = useState<Jornada[]>([]);
  // IDs de usuarios ADMIN: sus visitas (pruebas) NO cuentan como inspección.
  const [adminIds, setAdminIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('profiles').select('id').eq('role', 'admin');
      setAdminIds(new Set(((data ?? []) as any[]).map((a) => a.id as string)));
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
  // ── Filtros del reporte de asignaciones ──────────────────────────────────
  const [asgQuery, setAsgQuery] = useState('');                 // búsqueda libre
  const [asgSel, setAsgSel] = useState<Set<string>>(new Set()); // inspectores (check)
  const [edifSel, setEdifSel] = useState<Set<string>>(new Set()); // edificios (check)
  const [edifQuery, setEdifQuery] = useState('');               // buscar dentro de los edificios
  const [edifOpen, setEdifOpen] = useState(false);              // desplegable abierto/cerrado
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
    const [vs, { data: rs }, { data: js }] = await Promise.all([
      listVisits(date),
      supabase
        .from('machine_rounds')
        .select('machinery_id, day_hours, night_hours, day_operator, night_operator, machine:machinery_id(code, company:company_id(name))')
        .eq('round_date', date),
      supabase
        .from('operator_assignments')
        .select('id, first_name, last_name, cedula, company_name, started_at, ended_at, worked_hours, start_lat, start_lng, end_lat, end_lng, machine:machinery_id(code)')
        .eq('work_date', date)
        .order('started_at', { ascending: true }),
    ]);
    setVisits(vs);
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
    setLoading(false);
  }, [date]);
  useEffect(() => { load(); }, [load]);

  // TIEMPO REAL: al marcar una máquina (supervisor) o registrar/finalizar una
  // jornada, la supervisión del día se actualiza sola.
  useRealtimeRefresh(['supervisor_visits', 'machine_rounds', 'operator_assignments'], () => { load(); });
  // Al asignar/quitar una máquina con el CHECK (teléfono), refresca las asignaciones.
  useRealtimeRefresh(['machine_inspectors'], () => { loadAssigns(); });

  const shiftDay = (delta: number) => {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    setDate(d.toISOString().slice(0, 10));
  };

  // Visitas SIN las de admin (pruebas): así el admin no aparece como inspector.
  const cleanVisits = useMemo(() => visits.filter(noAdmin), [visits, adminIds]);
  const visitedIds = useMemo(() => new Set(cleanVisits.map((v) => v.machinery_id)), [cleanVisits]);
  const unvalidated = useMemo(() => rounds.filter((r) => !visitedIds.has(r.machinery_id)), [rounds, visitedIds]);
  const validated = rounds.length - unvalidated.length;

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

  const kpi = (label: string, value: React.ReactNode, color: string) => (
    <View style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
      <Text style={{ color, fontSize: 22, fontWeight: '900' }}>{value}</Text>
      <Text style={{ color: colors.muted, fontSize: 11, textAlign: 'center' }}>{label}</Text>
    </View>
  );

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
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          {kpi('Visitas', cleanVisits.length, colors.text)}
          {kpi('Jornadas validadas', validated, colors.success)}
          {kpi('Sin validar', unvalidated.length, unvalidated.length > 0 ? colors.danger : colors.success)}
        </View>
      </Card>

      {/* ── ✅ MÁQUINAS ASIGNADAS (CHECK del teléfono) — inspector ↔ máquina ── */}
      <SectionTitle>✅ Máquinas asignadas por inspector (CHECK)</SectionTitle>
      {assignsMissing ? (
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
          ) : asgByInspector.map(([name, list]) => (
            <Card key={name}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>👮 {name}</Text>
                <Text style={{ color: colors.success, fontSize: 12, fontWeight: '800' }}>{list.length} máq.</Text>
              </View>
              {list.map((a) => (
                <View key={a.id} style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{a.shift === 'night' ? '🌙' : '☀️'} {shiftLabel(a.shift)} · 🚜 {a.code} <Text style={{ color: colors.muted, fontWeight: '400' }}>· {a.companyName}</Text></Text>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>📍 {sectorOfAssign(a)}{refOf(a) !== '—' ? ` · ${refOf(a)}` : ''} · 🔖 {a.serial || '—'} / {a.plate || '—'}{a.encargado ? ` · 👤 ${a.encargado}` : ''}</Text>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>✅ asignada {dmy(a.assigned_at.slice(0, 10))} {caracasClock(a.assigned_at)}</Text>
                </View>
              ))}
            </Card>
          ))}
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

      {/* ── JORNADAS SIN VALIDAR (el operador no cobra) ── */}
      <SectionTitle>⛔ Jornadas sin validar</SectionTitle>
      <Card>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
          Máquinas que trabajaron este día pero que <Text style={{ fontWeight: '800', color: colors.danger }}>ningún inspector marcó</Text>. Regla: sin visita, el operador no cobra.
        </Text>
        {unvalidated.length === 0 ? (
          <Text style={{ color: colors.success, fontWeight: '800' }}>✓ Todas las jornadas del día están validadas.</Text>
        ) : (
          unvalidated.map((r) => (
            <View key={r.machinery_id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>{r.code}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{r.companyName}{r.operator ? ` · ${r.operator}` : ''}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>{r.worked} h</Text>
                <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '800' }}>NO cobra</Text>
              </View>
            </View>
          ))
        )}
      </Card>

      {/* ── JORNADAS DEL DÍA (operadores) — traza de inicio/fin + ubicación ── */}
      <SectionTitle>🚜 Jornadas de operadores</SectionTitle>
      {jornadas.length === 0 ? (
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
      <SectionTitle>Traza por inspector</SectionTitle>
      {bySupervisor.length > 0 ? (
        <>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Toca una máquina para ver su ficha en el Catálogo.</Text>
          <TouchableOpacity onPress={reporte} style={{ marginBottom: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
            <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 13 }}>📄 Reporte de inspecciones (PDF)</Text>
          </TouchableOpacity>
        </>
      ) : null}
      {bySupervisor.length === 0 ? (
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
    </Screen>
  );
}
