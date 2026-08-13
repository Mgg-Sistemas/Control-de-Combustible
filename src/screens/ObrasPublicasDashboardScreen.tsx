import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ActivityIndicator, Linking, ScrollView } from 'react-native';
import { Screen, Card, SectionTitle, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import InspectorKpiGrid, { KpiItem } from '../components/redesign/InspectorKpiGrid';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { caracasParts } from '../lib/jornada';
import { cmpText } from '../lib/text';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import {
  fetchOpDashboard, OpDashboard, OpDashMachine,
  fetchOpDailyReports, fetchOpReportSettings, saveOpReportSettings, computeOpAccumulated,
  fetchEdificioResumen, OpEdificioResumen,
  fetchEdificioRemovidosRange, OpEdificioHist,
  OpDailyReport, OpReportSettings,
} from '../lib/obrasPublicas';

/** Miles con "." y decimales con "," (sin depender de Intl). */
function fmtNum(n: number): string {
  const r = Math.round((Number(n) || 0) * 10) / 10;
  const neg = r < 0 ? '-' : '';
  const [int, dec] = String(Math.abs(r)).split('.');
  return `${neg}${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${dec ? ',' + dec : ''}`;
}

// ============================================================================
// OBRAS PÚBLICAS — Panel de admin/coordinador. AGREGA todo el módulo (todas las
// máquinas asignadas a cualquier supervisor). Lo alimenta la vista de teléfono del
// "Supervisor Externo Obras Públicas" (tablas op_*). Solo lectura: KPIs + gráficos
// (barras/estado/por día) + estado de flota en campo + tabla de últimas visitas.
// Gráficos con Views puros (sin librerías/CDN → CSP-safe), mismo lenguaje que el
// resto del sistema (InspectorKpiGrid, RBarChart, tokens del tema).
// ============================================================================

type Estado = 'averia' | 'parada' | 'trabajando' | 'cerrada' | 'pendiente';

const ESTADO_META: Record<Estado, { label: string; icon: string; tone: 'danger' | 'warning' | 'success' | 'brand' | 'muted' }> = {
  averia: { label: 'Averiada', icon: '🔴', tone: 'danger' },
  parada: { label: 'Parada', icon: '🟡', tone: 'warning' },
  trabajando: { label: 'Trabajando', icon: '🟢', tone: 'success' },
  cerrada: { label: 'Trabajó hoy', icon: '🔵', tone: 'brand' },
  pendiente: { label: 'Por revisar', icon: '⏳', tone: 'muted' },
};

/** Suma (o resta) días a una fecha ISO "AAAA-MM-DD" sin depender de la zona horaria. */
function addDaysISO(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/** DD/MM a partir de una fecha ISO. */
function dm(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

export default function ObrasPublicasDashboardScreen({ navigation }: any) {
  const { colors } = useTheme();
  const toast = useToast();
  const { session, moduleLevel } = useAuth();
  const isAdmin = moduleLevel('obras_publicas') === 'full';
  const today = caracasParts(new Date()).iso;
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<OpDashboard | null>(null);
  const [reports, setReports] = useState<OpDailyReport[]>([]);
  const [resumenEdif, setResumenEdif] = useState<Record<string, OpEdificioResumen>>({}); // m³ removidos por edificio
  const [settings, setSettings] = useState<OpReportSettings>({ base_m3: 0, base_cuerpos: 0, base_date: null });
  const [nowTick, setNowTick] = useState(Date.now());
  const [filter, setFilter] = useState<string | null>(null); // KPI seleccionado (filtra la flota)
  const [chartDays, setChartDays] = useState<7 | 30>(7);
  const [selDay, setSelDay] = useState<string | null>(null); // día tocado en el gráfico → detalle
  const [histOpen, setHistOpen] = useState(false); // histórico buscable de registros de acarreo
  const [histQ, setHistQ] = useState('');
  const [histFrom, setHistFrom] = useState('');
  const [histTo, setHistTo] = useState('');
  const [kpiDetail, setKpiDetail] = useState<string | null>(null); // KPI tocado → detalle
  const [histEdifOpen, setHistEdifOpen] = useState(false); // HISTÓRICO de datos diarios por edificio
  const [histEdifRows, setHistEdifRows] = useState<OpEdificioHist[] | null>(null);
  const [histEdifQ, setHistEdifQ] = useState('');
  const [histEdifFrom, setHistEdifFrom] = useState('');
  const [histEdifTo, setHistEdifTo] = useState('');
  const [supFilter, setSupFilter] = useState<string | null>(null); // supervisor_id | null = todos

  // Editor de la base acumulada (solo admin).
  const [baseOpen, setBaseOpen] = useState(false);
  const [baseDraft, setBaseDraft] = useState<OpReportSettings>({ base_m3: 0, base_cuerpos: 0, base_date: null });
  const [baseBusy, setBaseBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, reps, st, resu] = await Promise.all([
        fetchOpDashboard(today, addDaysISO(today, -30)),
        fetchOpDailyReports('2000-01-01'), // todos: el acumulado suma desde el corte
        fetchOpReportSettings(),
        fetchEdificioResumen(today).catch(() => ({} as Record<string, OpEdificioResumen>)),
      ]);
      setData(d); setReports(reps); setSettings(st); setResumenEdif(resu);
    } catch {
      setData({ machines: [], rounds: {}, maint: {}, roundsRange: [], visits: [] });
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => { load(); }, [load]);
  // Sincronía EN VIVO con las vistas de teléfono de las supervisoras: si registran jornada,
  // avería/parada, m³ o el reporte del día, el panel se actualiza solo.
  useRealtimeRefresh(['op_machine_supervisors', 'op_machine_rounds', 'op_maintenance', 'op_supervisor_visits', 'op_daily_reports', 'op_report_settings', 'op_edificio_removidos', 'op_edificio_base', 'op_external_machines'], () => { load(); });
  // Tictaqueo cada 60s: las horas EN VIVO de las jornadas abiertas crecen solas.
  useEffect(() => { const t = setInterval(() => setNowTick(Date.now()), 60000); return () => clearInterval(t); }, []);

  const d = data ?? { machines: [], rounds: {}, maint: {}, roundsRange: [], visits: [] };

  // Estado por máquina (misma prioridad que la vista de teléfono / el reporte):
  // avería > parada > trabajando (jornada abierta) > cerrada (trabajó) > pendiente.
  const estadoOf = useCallback((id: string): Estado => {
    const mt = d.maint[id];
    if (mt?.tipo === 'averia') return 'averia';
    if (mt?.tipo === 'parada') return 'parada';
    const r = d.rounds[id];
    if (r?.jornada_start_at) return 'trabajando';
    if (r && r.day_hours + r.night_hours > 0) return 'cerrada';
    return 'pendiente';
  }, [d.maint, d.rounds]);

  // Horas de HOY de una máquina: bancado (día+noche) + lo transcurrido en vivo si la
  // jornada sigue abierta. Tope 24h (día+noche).
  const horasHoy = useCallback((id: string): number => {
    const r = d.rounds[id];
    if (!r) return 0;
    let h = r.day_hours + r.night_hours;
    if (r.jornada_start_at) h += Math.max(0, (nowTick - new Date(r.jornada_start_at).getTime()) / 3600000);
    return Math.round(Math.min(24, h) * 100) / 100;
  }, [d.rounds, nowTick]);

  // Supervisores (para el filtro por chip).
  const supervisores = useMemo(() => {
    const m = new Map<string, string>();
    d.machines.forEach((x) => { if (x.supervisor_id) m.set(x.supervisor_id, x.supervisor_name || '(sin nombre)'); });
    return Array.from(m.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => cmpText(a.name, b.name));
  }, [d.machines]);

  // Máquinas visibles (filtro por supervisor).
  const machines = useMemo(() => (
    supFilter ? d.machines.filter((x) => x.supervisor_id === supFilter) : d.machines
  ), [d.machines, supFilter]);

  const visibleIds = useMemo(() => new Set(machines.map((x) => x.id)), [machines]);

  // Conteos por estado (para KPIs, distribución y filtro).
  const counts = useMemo(() => {
    const c: Record<Estado, number> = { averia: 0, parada: 0, trabajando: 0, cerrada: 0, pendiente: 0 };
    machines.forEach((x) => { c[estadoOf(x.id)] += 1; });
    return c;
  }, [machines, estadoOf]);

  // m³ del día: total removido hoy por EDIFICIO (módulo independiente, global; ya no por máquina).
  const m3Dia = useMemo(() => {
    const s = Object.values(resumenEdif).reduce((a, r) => a + r.removido_hoy, 0);
    return Math.round(s * 10) / 10;
  }, [resumenEdif]);
  // Edificios tratados HOY (con removido del día) en el módulo por edificio.
  const edificiosHoyCount = useMemo(() => Object.values(resumenEdif).filter((r) => r.removido_hoy > 0).length, [resumenEdif]);

  // Reporte de Actividades: consolidado del día (suma de reportes de las supervisoras)
  // respetando el filtro por supervisor; y ACUMULADOS globales (base + todos los reportes).
  const reportsView = useMemo(() => (supFilter ? reports.filter((r) => r.supervisor_id === supFilter) : reports), [reports, supFilter]);
  const consolidado = useMemo(() => {
    const hoy = reportsView.filter((r) => r.report_date === today);
    return hoy.reduce((a, r) => ({
      m3_removidos: a.m3_removidos + r.m3_removidos_dia,
      m3_acarreo: a.m3_acarreo + r.m3_acarreo_dia,
      cuerpos: a.cuerpos + r.cuerpos_dia,
      traslado: a.traslado + r.traslado_camion_dia,
      reportes: a.reportes + 1,
    }), { m3_removidos: 0, m3_acarreo: 0, cuerpos: 0, traslado: 0, reportes: 0 });
  }, [reportsView, today]);
  // Edificios reportados hoy (según el filtro por supervisor).
  const edificiosDia = useMemo(() => {
    const s = new Set<string>();
    reportsView.filter((r) => r.report_date === today).forEach((r) => { const e = (r.edificio ?? '').trim(); if (e) s.add(e); });
    return Array.from(s).sort((a, b) => cmpText(a, b));
  }, [reportsView, today]);
  // Los acumulados "desde inicio" son de TODA la operación (base global + todos los reportes).
  const acumulado = useMemo(() => computeOpAccumulated(reports, settings), [reports, settings]);

  const abrirBase = () => { setBaseDraft(settings); setBaseOpen(true); };
  const guardarBase = async () => {
    setBaseBusy(true);
    try {
      await saveOpReportSettings(baseDraft, session?.user?.id ?? null);
      setSettings(baseDraft); setBaseOpen(false);
      toast.success('Base acumulada guardada.');
    } catch (e: any) { toast.error(e?.message ?? 'No se pudo guardar la base.'); }
    finally { setBaseBusy(false); }
  };

  // KPIs (tarjetas de arriba). El valor es numérico (InspectorKpiGrid).
  const kpis: KpiItem[] = useMemo(() => [
    { key: 'asignadas', label: 'Máquinas asignadas', value: machines.length, tone: 'brand', icon: '🚜' },
    { key: 'trabajando', label: 'Trabajando ahora', value: counts.trabajando, tone: 'success', icon: '🟢' },
    { key: 'incidencias', label: 'Averiadas / Paradas', value: counts.averia + counts.parada, tone: 'danger', icon: '🔧' },
    { key: 'm3', label: 'm³ del día', value: m3Dia, tone: 'accent', icon: '⛰️' },
    { key: 'edificios', label: 'Edificios hoy', value: edificiosHoyCount, tone: 'warning', icon: '🏢' },
  ], [machines.length, counts, m3Dia, edificiosHoyCount]);

  // Filtro de la flota según el KPI tocado.
  const fleetPred = useCallback((id: string): boolean => {
    if (filter === 'trabajando') return estadoOf(id) === 'trabajando';
    if (filter === 'incidencias') { const e = estadoOf(id); return e === 'averia' || e === 'parada'; }
    return true; // asignadas / horas / visitas / sin filtro
  }, [filter, estadoOf]);

  // Serie "actividad por día" (rondas con horas o jornada abierta), últimos chartDays.
  const perDay = useMemo(() => {
    const byDate = new Map<string, number>();
    d.roundsRange.forEach((r) => {
      if (!visibleIds.has(r.machinery_id)) return;
      if (r.day_hours + r.night_hours > 0 || r.jornada_start_at) byDate.set(r.round_date, (byDate.get(r.round_date) ?? 0) + 1);
    });
    const days: { iso: string; count: number }[] = [];
    for (let i = chartDays - 1; i >= 0; i--) {
      const iso = addDaysISO(today, -i);
      days.push({ iso, count: byDate.get(iso) ?? 0 });
    }
    return days;
  }, [d.roundsRange, visibleIds, chartDays, today]);
  const perDayMax = Math.max(1, ...perDay.map((x) => x.count));

  // Distribución por estado (barra segmentada + leyenda).
  const dist = useMemo(() => (
    (['trabajando', 'cerrada', 'pendiente', 'parada', 'averia'] as Estado[])
      .map((e) => ({ e, count: counts[e], color: toneColor(colors, ESTADO_META[e].tone), meta: ESTADO_META[e] }))
  ), [counts, colors]);
  const distTotal = Math.max(1, dist.reduce((s, x) => s + x.count, 0));

  const codeById = useMemo(() => { const m = new Map<string, string>(); d.machines.forEach((x) => m.set(x.id, x.code)); return m; }, [d.machines]);
  const machById = useMemo(() => { const m = new Map<string, OpDashMachine>(); d.machines.forEach((x) => m.set(x.id, x)); return m; }, [d.machines]);
  // Subtítulo Serial · Placa · Empresa de una máquina (para tablas/detalle).
  const machSub = useCallback((id: string): string => {
    const m = machById.get(id);
    if (!m) return '';
    return [m.serial ? `S/N ${m.serial}` : null, m.plate ? `Placa ${m.plate}` : null, m.company_name].filter(Boolean).join(' · ');
  }, [machById]);

  // Detalle del día tocado en el gráfico: máquinas con actividad ese día.
  const dayDetail = useMemo(() => {
    if (!selDay) return [] as { id: string; horas: number; abierta: boolean }[];
    return d.roundsRange
      .filter((r) => r.round_date === selDay && visibleIds.has(r.machinery_id) && (r.day_hours + r.night_hours > 0 || r.jornada_start_at))
      .map((r) => ({ id: r.machinery_id, horas: r.day_hours + r.night_hours, abierta: !!r.jornada_start_at }))
      .sort((a, b) => cmpText(codeById.get(a.id) ?? '', codeById.get(b.id) ?? ''));
  }, [selDay, d.roundsRange, visibleIds, codeById]);

  // Registros de acarreo VISIBLES (de mis máquinas del filtro) — más recientes primero.
  const visibleVisits = useMemo(() => d.visits.filter((v) => visibleIds.has(v.machinery_id)), [d.visits, visibleIds]);
  // Histórico filtrado por fechas + búsqueda por TODAS las características.
  const histRows = useMemo(() => {
    const n = histQ.trim().toLowerCase();
    return visibleVisits.filter((v) => {
      if (histFrom && v.visit_date < histFrom) return false;
      if (histTo && v.visit_date > histTo) return false;
      if (!n) return true;
      const m = machById.get(v.machinery_id);
      const hay = [codeById.get(v.machinery_id), m?.serial, m?.plate, m?.company_name, m?.sector, m?.parroquia,
        v.supervisor_name, visitStatusLabel(v.status), v.visit_date, dm(v.visit_date), v.note]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(n);
    });
  }, [visibleVisits, histQ, histFrom, histTo, machById, codeById]);
  const enviarHistWhatsApp = () => {
    if (!histRows.length) return;
    const L: string[] = ['🗒️ *REGISTROS DE ACARREO*'];
    if (histFrom || histTo) L.push(`📅 ${histFrom ? dm(histFrom) : '…'} → ${histTo ? dm(histTo) : '…'}`);
    if (histQ.trim()) L.push(`🔎 ${histQ.trim()}`);
    L.push(`Total: ${histRows.length}`, '');
    histRows.forEach((v) => {
      const code = codeById.get(v.machinery_id) ?? '—';
      const sub = machSub(v.machinery_id);
      L.push(`• ${code}${sub ? ` (${sub})` : ''} — ${visitStatusLabel(v.status)} — ${v.supervisor_name || '—'} — ${dm(v.visit_date)}`);
    });
    try { Linking.openURL('https://wa.me/?text=' + encodeURIComponent(L.join('\n'))); } catch {}
  };

  // Detalle de la tarjeta KPI tocada (solo lo del DÍA).
  const r1n = (n: number) => Math.round(n * 10) / 10;
  const machSubSup = (m: OpDashMachine) => [machSub(m.id), m.supervisor_name ? `🪖 ${m.supervisor_name}` : null].filter(Boolean).join(' · ');
  const kpiDetalle = useMemo(() => {
    if (kpiDetail === 'asignadas') return { title: '🚜 Máquinas asignadas', isEdif: false, rows: machines.map((m) => ({ title: m.code, sub: machSubSup(m), right: ESTADO_META[estadoOf(m.id)].label })) };
    if (kpiDetail === 'trabajando') return { title: '🟢 Trabajando ahora', isEdif: false, rows: machines.filter((m) => estadoOf(m.id) === 'trabajando').map((m) => ({ title: m.code, sub: machSubSup(m), right: `${r1n(horasHoy(m.id))} h` })) };
    if (kpiDetail === 'incidencias') return { title: '🔧 Averiadas / Paradas', isEdif: false, rows: machines.filter((m) => { const e = estadoOf(m.id); return e === 'averia' || e === 'parada'; }).map((m) => ({ title: m.code, sub: machSubSup(m), right: ESTADO_META[estadoOf(m.id)].label })) };
    const edifs = Object.values(resumenEdif);
    if (kpiDetail === 'edificios' || kpiDetail === 'm3') return { title: kpiDetail === 'edificios' ? '🏢 Edificios de hoy' : '⛰️ m³ del día', isEdif: true, rows: edifs.filter((r) => r.removido_hoy > 0).sort((a, b) => b.removido_hoy - a.removido_hoy).map((r) => ({ title: r.edificio, sub: r.supervisor_name || '', right: `${r1n(r.removido_hoy)} m³` })) };
    return { title: '', isEdif: false, rows: [] as { title: string; sub: string; right: string }[] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kpiDetail, machines, resumenEdif]);

  // HISTÓRICO de datos diarios por edificio (se carga al abrirlo; default últimos 90 días).
  const abrirHistEdif = async () => {
    setHistEdifOpen(true);
    if (histEdifRows == null) {
      try { setHistEdifRows(await fetchEdificioRemovidosRange(addDaysISO(today, -90), today)); }
      catch { setHistEdifRows([]); }
    }
  };
  const histEdifFiltrado = useMemo(() => {
    const n = histEdifQ.trim().toLowerCase();
    return (histEdifRows ?? []).filter((r) => {
      if (histEdifFrom && r.report_date < histEdifFrom) return false;
      if (histEdifTo && r.report_date > histEdifTo) return false;
      if (!n) return true;
      const hay = [r.edificio, r.sub_sector, r.supervisor_name, r.maq_en_uso, r.maq_inoperativo, r.maq_requerimiento, r.actividades, r.report_date, dm(r.report_date)]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(n);
    });
  }, [histEdifRows, histEdifQ, histEdifFrom, histEdifTo]);

  if (loading) return <Screen><Loading /></Screen>;

  const fleet = machines.filter((x) => fleetPred(x.id))
    .sort((a, b) => cmpText(a.code, b.code));

  return (
    <Screen onRefresh={load} refreshing={loading}>
      <ConfigBanner />
      <SectionTitle>🏛️ Obras Públicas — Panel</SectionTitle>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
        {d.machines.length} máquina(s) · {supervisores.length} supervisor(es) · {dm(today)}
      </Text>

      {/* Filtro por supervisor (chips) — "Todos" + uno por supervisor. */}
      {supervisores.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.md }}>
          {[{ id: null as string | null, name: 'Todos' }, ...supervisores].map((s) => {
            const on = supFilter === s.id;
            return (
              <TouchableOpacity key={s.id ?? 'all'} onPress={() => setSupFilter(s.id)}
                style={{ paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt }}>
                <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{s.name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      {/* KPIs — tocar una tarjeta abre su DETALLE (solo lo del día). */}
      <InspectorKpiGrid items={kpis} activeKey={filter} onSelect={(k) => setKpiDetail(k)} />

      {/* HISTÓRICO de los datos diarios (por edificio), filtrable por fecha y características. */}
      <TouchableOpacity onPress={abrirHistEdif} style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
        <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 13 }}>📚 Histórico (por día, buscable)</Text>
      </TouchableOpacity>

      {/* REPORTE DE ACTIVIDADES — consolidado del día + acumulados */}
      <Card style={{ marginTop: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>📋 Reporte de Actividades</Text>
          {isAdmin ? (
            <TouchableOpacity onPress={abrirBase}><Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>⚙️ Editar base</Text></TouchableOpacity>
          ) : null}
        </View>
        <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.sm }}>
          Del día{supFilter ? ' (supervisor seleccionado)' : ''} · {consolidado.reportes} reporte(s)
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {[
            { l: 'M³ removidos', v: fmtNum(consolidado.m3_removidos), u: 'm³' },
            { l: 'M³ acarreo vestigios', v: fmtNum(consolidado.m3_acarreo), u: 'm³' },
            { l: 'Cuerpos siniestrados', v: fmtNum(consolidado.cuerpos), u: '' },
            { l: 'Traslado camión', v: fmtNum(consolidado.traslado), u: '' },
          ].map((k) => (
            <View key={k.l} style={{ flexBasis: '47%', flexGrow: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm }}>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 20, fontVariant: ['tabular-nums'] as any }}>{k.v}<Text style={{ fontSize: 11, color: colors.muted, fontWeight: '700' }}>{k.u ? ` ${k.u}` : ''}</Text></Text>
              <Text style={{ color: colors.muted, fontSize: 10.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 }}>{k.l}</Text>
            </View>
          ))}
        </View>
        {edificiosDia.length > 0 ? (
          <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: spacing.sm }}>🏢 Edificios de hoy: <Text style={{ color: colors.text, fontWeight: '700' }}>{edificiosDia.join(' · ')}</Text></Text>
        ) : null}
        <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.md, marginBottom: spacing.xs }}>Acumulado desde el inicio (toda la operación)</Text>
        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          <View style={{ flex: 1, backgroundColor: colors.accentSoftBg, borderWidth: 1, borderColor: colors.accent, borderRadius: radius.md, padding: spacing.sm }}>
            <Text style={{ color: colors.accentSoftText, fontWeight: '900', fontSize: 20, fontVariant: ['tabular-nums'] as any }}>{fmtNum(acumulado.m3)}<Text style={{ fontSize: 11, fontWeight: '700' }}> m³</Text></Text>
            <Text style={{ color: colors.accentSoftText, fontSize: 10.5, fontWeight: '700', textTransform: 'uppercase' }}>Total m³ acumulados</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: colors.accentSoftBg, borderWidth: 1, borderColor: colors.accent, borderRadius: radius.md, padding: spacing.sm }}>
            <Text style={{ color: colors.accentSoftText, fontWeight: '900', fontSize: 20, fontVariant: ['tabular-nums'] as any }}>{fmtNum(acumulado.cuerpos)}</Text>
            <Text style={{ color: colors.accentSoftText, fontSize: 10.5, fontWeight: '700', textTransform: 'uppercase' }}>Cuerpos acumulados</Text>
          </View>
        </View>
        {settings.base_date ? <Text style={{ color: colors.muted, fontSize: 10, marginTop: spacing.xs }}>Base al {dm(settings.base_date)}/{settings.base_date.split('-')[0]} + reportes posteriores.</Text> : null}
      </Card>

      {/* M³ REMOVIDOS HOY POR EDIFICIO (módulo independiente, sincronizado con el teléfono) */}
      <Card style={{ marginTop: spacing.md }}>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, marginBottom: 2 }}>⛰️ m³ removidos hoy · por edificio</Text>
        <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.sm }}>
          {edificiosHoyCount} edificio(s) · {fmtNum(m3Dia)} m³ hoy
        </Text>
        {(() => {
          const filas = Object.values(resumenEdif).filter((r) => r.removido_hoy > 0).sort((a, b) => b.removido_hoy - a.removido_hoy);
          if (filas.length === 0) return <Text style={{ color: colors.muted, fontSize: 12.5 }}>Aún no se han registrado m³ por edificio hoy.</Text>;
          return (
            <View style={{ gap: spacing.xs }}>
              {filas.map((r) => (
                <View key={r.edificio} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>{r.edificio}</Text>
                    <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11 }}>Acumulado: {fmtNum(r.acumulado)} m³{r.supervisor_name ? ` · ${r.supervisor_name}` : ''}</Text>
                  </View>
                  <Text style={{ color: colors.accentSoftText, fontSize: 13, fontWeight: '900', fontVariant: ['tabular-nums'] as any }}>⛰️ {fmtNum(r.removido_hoy)} m³</Text>
                </View>
              ))}
            </View>
          );
        })()}
      </Card>

      {/* GRÁFICO 1 — Distribución por estado (barra segmentada + leyenda) */}
      <Card style={{ marginTop: spacing.md }}>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, marginBottom: spacing.sm }}>📊 Distribución por estado</Text>
        <View style={{ flexDirection: 'row', height: 16, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.surfaceAlt }}>
          {dist.map((s) => (s.count > 0 ? <View key={s.e} style={{ flex: s.count, backgroundColor: s.color }} /> : null))}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
          {dist.map((s) => (
            <View key={s.e} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: s.color }} />
              <Text style={{ color: colors.muted, fontSize: 11.5 }}>{s.meta.label}</Text>
              <Text style={{ color: colors.text, fontSize: 11.5, fontWeight: '800', fontVariant: ['tabular-nums'] as any }}>
                {s.count} · {Math.round((s.count / distTotal) * 100)}%
              </Text>
            </View>
          ))}
        </View>
      </Card>

      {/* GRÁFICO 3 — Actividad por día (barras verticales) con selector 7/30 días */}
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>🚚 Acarreo Total</Text>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {([7, 30] as const).map((n) => {
              const on = chartDays === n;
              return (
                <TouchableOpacity key={n} onPress={() => setChartDays(n)}
                  style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.accent : colors.border, backgroundColor: on ? colors.accent : colors.surfaceAlt }}>
                  <Text style={{ color: on ? colors.accentContrast : colors.text, fontWeight: '800', fontSize: 11.5 }}>{n} días</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
        <Text style={{ color: colors.muted, fontSize: 10.5, marginBottom: 4 }}>Toca un día para ver el detalle 👇</Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 110, gap: chartDays === 7 ? 6 : 2 }}>
          {perDay.map((x) => {
            const on = selDay === x.iso;
            return (
              <TouchableOpacity key={x.iso} activeOpacity={0.7} onPress={() => setSelDay(on ? null : x.iso)} style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ color: on ? colors.accent : colors.muted, fontSize: 9, marginBottom: 2, fontWeight: on ? '900' : '400', fontVariant: ['tabular-nums'] as any }}>{x.count > 0 ? x.count : ''}</Text>
                <View style={{ width: '72%', height: Math.max(2, (x.count / perDayMax) * 82), backgroundColor: on ? colors.accent : (x.count > 0 ? colors.tankFill : colors.tankTrack), borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={{ flexDirection: 'row', gap: chartDays === 7 ? 6 : 2, marginTop: 4 }}>
          {perDay.map((x, i) => (
            <TouchableOpacity key={x.iso} onPress={() => setSelDay(selDay === x.iso ? null : x.iso)} style={{ flex: 1, alignItems: 'center' }}>
              {(chartDays === 7 || i % 5 === 0) ? <Text style={{ color: selDay === x.iso ? colors.accent : colors.muted, fontSize: 8.5, fontWeight: selDay === x.iso ? '900' : '400' }}>{dm(x.iso)}</Text> : null}
            </TouchableOpacity>
          ))}
        </View>

        {/* Detalle del día tocado: máquinas con actividad, con serial/placa/empresa */}
        {selDay ? (
          <View style={{ marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: spacing.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>📅 {dm(selDay)} · {dayDetail.length} máquina(s)</Text>
              <TouchableOpacity onPress={() => setSelDay(null)}><Text style={{ color: colors.muted, fontWeight: '700', fontSize: 12 }}>Cerrar ✕</Text></TouchableOpacity>
            </View>
            {dayDetail.length === 0 ? (
              <Text style={{ color: colors.muted, fontSize: 12 }}>Sin actividad ese día.</Text>
            ) : dayDetail.map((it) => {
              const m = machById.get(it.id);
              const sub = machSub(it.id);
              return (
                <View key={it.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '800', fontSize: 12.5 }}>{m?.code ?? '—'}</Text>
                    {sub ? <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 10.5 }}>{sub}</Text> : null}
                  </View>
                  {it.horas > 0 ? <Text style={{ color: colors.text, fontSize: 11.5, fontWeight: '800', fontVariant: ['tabular-nums'] as any }}>{Math.round(it.horas * 100) / 100} h</Text> : null}
                  {it.abierta ? <Text style={{ color: colors.success, fontSize: 10, fontWeight: '900' }}>● EN CURSO</Text> : null}
                </View>
              );
            })}
          </View>
        ) : null}
      </Card>

      {/* ESTADO DE FLOTA EN CAMPO */}
      <Card>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, marginBottom: spacing.sm }}>
          🚜 Estado de flota{filter === 'trabajando' ? ' · Trabajando' : filter === 'incidencias' ? ' · Averiadas/Paradas' : ''} ({fleet.length})
        </Text>
        {fleet.length === 0 ? (
          <Text style={{ color: colors.muted, fontSize: 12.5 }}>Sin máquinas para este filtro.</Text>
        ) : (
          <View style={{ gap: spacing.xs }}>
            {fleet.map((m) => {
              const e = estadoOf(m.id);
              const meta = ESTADO_META[e];
              const col = toneColor(colors, meta.tone);
              const h = horasHoy(m.id);
              return (
                <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderLeftWidth: 3, borderLeftColor: col, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>{m.code}</Text>
                    <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11 }}>
                      {[m.company_name, m.sector || m.parroquia, m.supervisor_name ? `🪖 ${m.supervisor_name}` : null].filter(Boolean).join(' · ') || '—'}
                    </Text>
                  </View>
                  {h > 0 ? <Text style={{ color: colors.text, fontSize: 11.5, fontWeight: '800', fontVariant: ['tabular-nums'] as any }}>{Math.round(h * 100) / 100} h</Text> : null}
                  <View style={{ backgroundColor: col, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ color: '#fff', fontWeight: '900', fontSize: 10 }}>{meta.icon} {meta.label}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </Card>

      {/* TABLA — Últimas visitas / jornadas */}
      <Card style={{ marginBottom: spacing.xl }}>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, marginBottom: spacing.sm }}>🗒️ Registros de acarreo</Text>
        {d.visits.filter((v) => visibleIds.has(v.machinery_id)).length === 0 ? (
          <Text style={{ color: colors.muted, fontSize: 12.5 }}>Sin registros en el rango.</Text>
        ) : (
          <View>
            <View style={{ flexDirection: 'row', paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ flex: 1.4, color: colors.muted, fontSize: 10.5, fontWeight: '800', textTransform: 'uppercase' }}>Máquina</Text>
              <Text style={{ flex: 1.2, color: colors.muted, fontSize: 10.5, fontWeight: '800', textTransform: 'uppercase' }}>Supervisor</Text>
              <Text style={{ flex: 0.9, color: colors.muted, fontSize: 10.5, fontWeight: '800', textTransform: 'uppercase' }}>Estado</Text>
              <Text style={{ flex: 0.7, color: colors.muted, fontSize: 10.5, fontWeight: '800', textTransform: 'uppercase', textAlign: 'right' }}>Fecha</Text>
            </View>
            {visibleVisits.slice(0, 10).map((v, i) => {
              const sub = machSub(v.machinery_id);
              return (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <View style={{ flex: 1.4, minWidth: 0, paddingRight: 4 }}>
                    <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>{codeById.get(v.machinery_id) ?? '—'}</Text>
                    {sub ? <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 10 }}>{sub}</Text> : null}
                  </View>
                  <Text numberOfLines={1} style={{ flex: 1.2, color: colors.muted, fontSize: 11.5 }}>{v.supervisor_name || '—'}</Text>
                  <Text numberOfLines={1} style={{ flex: 0.9, color: colors.text, fontSize: 11 }}>{visitStatusLabel(v.status)}</Text>
                  <Text style={{ flex: 0.7, color: colors.muted, fontSize: 11, textAlign: 'right', fontVariant: ['tabular-nums'] as any }}>{dm(v.visit_date)}</Text>
                </View>
              );
            })}
            <TouchableOpacity onPress={() => setHistOpen(true)} style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
              <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 13 }}>📚 Ver histórico completo ({visibleVisits.length})</Text>
            </TouchableOpacity>
          </View>
        )}
      </Card>

      {/* HISTÓRICO de registros de acarreo — buscable por fechas + características */}
      <Modal visible={histOpen} animationType="slide" transparent onRequestClose={() => setHistOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '92%' }}>
            <View style={{ padding: spacing.lg, paddingBottom: spacing.sm, gap: spacing.xs }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>📚 Histórico de acarreo · {histRows.length}</Text>
                <TouchableOpacity onPress={() => setHistOpen(false)}><Text style={{ color: colors.muted, fontWeight: '700' }}>Cerrar ✕</Text></TouchableOpacity>
              </View>
              <TextInput value={histQ} onChangeText={setHistQ} placeholder="🔎 Buscar (máquina, serial, placa, empresa, supervisor, estado…)" placeholderTextColor={colors.muted}
                style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm, color: colors.text }} />
              <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                <TextInput value={histFrom} onChangeText={setHistFrom} placeholder="Desde AAAA-MM-DD" placeholderTextColor={colors.muted}
                  style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm, color: colors.text }} />
                <TextInput value={histTo} onChangeText={setHistTo} placeholder="Hasta AAAA-MM-DD" placeholderTextColor={colors.muted}
                  style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm, color: colors.text }} />
              </View>
              {(histQ || histFrom || histTo) ? (
                <TouchableOpacity onPress={() => { setHistQ(''); setHistFrom(''); setHistTo(''); }} style={{ alignSelf: 'flex-start' }}>
                  <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 11.5 }}>Limpiar filtros ✕</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: 4 }}>
              {histRows.length === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 12.5, marginVertical: spacing.md }}>Sin registros para ese filtro.</Text>
              ) : histRows.map((v, i) => {
                const sub = machSub(v.machinery_id);
                return (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '800', fontSize: 12.5 }}>{codeById.get(v.machinery_id) ?? '—'}</Text>
                      {sub ? <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 10 }}>{sub}</Text> : null}
                      <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 10.5 }}>{v.supervisor_name || '—'} · 📅 {dm(v.visit_date)}</Text>
                    </View>
                    <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>{visitStatusLabel(v.status)}</Text>
                  </View>
                );
              })}
              <View style={{ height: spacing.md }} />
            </ScrollView>
            <View style={{ padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }}>
              <TouchableOpacity onPress={enviarHistWhatsApp} disabled={histRows.length === 0} style={{ borderWidth: 1, borderColor: '#25D366', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: histRows.length === 0 ? 0.6 : 1 }}>
                <Text style={{ color: '#25D366', fontWeight: '800' }}>📤 Reporte del histórico por WhatsApp ({histRows.length})</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Detalle de una tarjeta KPI (solo lo del día) */}
      <Modal visible={!!kpiDetail} animationType="slide" transparent onRequestClose={() => setKpiDetail(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '85%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.lg, paddingBottom: spacing.sm }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>{kpiDetalle.title} · {kpiDetalle.rows.length}</Text>
              <TouchableOpacity onPress={() => setKpiDetail(null)}><Text style={{ color: colors.muted, fontWeight: '700' }}>Cerrar ✕</Text></TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: 0, gap: spacing.xs }}>
              {kpiDetalle.rows.length === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 13 }}>Sin registros hoy.</Text>
              ) : kpiDetalle.rows.map((row, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>{row.title}</Text>
                    {row.sub ? <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11 }}>{row.sub}</Text> : null}
                  </View>
                  {row.right ? <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12.5 }}>{row.right}</Text> : null}
                </View>
              ))}
              {kpiDetail === 'asignadas' ? (
                <TouchableOpacity onPress={() => { setKpiDetail(null); navigation?.navigate?.('Equipos', { obrasPublicas: true }); }} style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
                  <Text style={{ color: colors.brand, fontWeight: '800', fontSize: 13 }}>🏛️ Asignar máquinas (Catálogo)</Text>
                </TouchableOpacity>
              ) : null}
              <View style={{ height: spacing.xl }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* HISTÓRICO de datos diarios por edificio — filtrable por fechas + características */}
      <Modal visible={histEdifOpen} animationType="slide" transparent onRequestClose={() => setHistEdifOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '92%' }}>
            <View style={{ padding: spacing.lg, paddingBottom: spacing.sm, gap: spacing.xs }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>📚 Histórico por edificio · {histEdifFiltrado.length}</Text>
                <TouchableOpacity onPress={() => setHistEdifOpen(false)}><Text style={{ color: colors.muted, fontWeight: '700' }}>Cerrar ✕</Text></TouchableOpacity>
              </View>
              <Text style={{ color: colors.muted, fontSize: 11 }}>Cada día queda guardado. Filtra por fecha o por cualquier característica.</Text>
              <TextInput value={histEdifQ} onChangeText={setHistEdifQ} placeholder="🔎 Buscar (edificio, sub-sector, supervisor, maquinaria, actividad…)" placeholderTextColor={colors.muted}
                style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm, color: colors.text }} />
              <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                <TextInput value={histEdifFrom} onChangeText={setHistEdifFrom} placeholder="Desde AAAA-MM-DD" placeholderTextColor={colors.muted}
                  style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm, color: colors.text }} />
                <TextInput value={histEdifTo} onChangeText={setHistEdifTo} placeholder="Hasta AAAA-MM-DD" placeholderTextColor={colors.muted}
                  style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm, color: colors.text }} />
              </View>
              {(histEdifQ || histEdifFrom || histEdifTo) ? (
                <TouchableOpacity onPress={() => { setHistEdifQ(''); setHistEdifFrom(''); setHistEdifTo(''); }} style={{ alignSelf: 'flex-start' }}>
                  <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 11.5 }}>Limpiar filtros ✕</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: 4 }}>
              {histEdifRows == null ? (
                <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
              ) : histEdifFiltrado.length === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 12.5, marginVertical: spacing.md }}>Sin registros para ese filtro.</Text>
              ) : histEdifFiltrado.map((r, i) => (
                <View key={i} style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm, gap: 2 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '800', fontSize: 12.5, flex: 1 }}>🏢 {r.edificio}{r.entregado ? '  ✅' : ''}</Text>
                    <Text style={{ color: colors.accent, fontWeight: '900', fontSize: 12.5 }}>{r1n(r.m3)} m³</Text>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 10.5 }}>📅 {dm(r.report_date)}{r.sub_sector ? ` · 📍 ${r.sub_sector}` : ''}{r.supervisor_name ? ` · ${r.supervisor_name}` : ''}</Text>
                  {(r.m3_acarreados || r.viajes) ? <Text style={{ color: colors.muted, fontSize: 10.5 }}>Acarreados: {r1n(r.m3_acarreados)} m³ · Viajes: {r.viajes}</Text> : null}
                  {r.maq_requerimiento ? <Text style={{ color: colors.muted, fontSize: 10.5 }}>📋 {r.maq_requerimiento}</Text> : null}
                  {(r.supervivientes || r.fallecidos) ? <Text style={{ color: colors.muted, fontSize: 10.5 }}>⚰️ {r.supervivientes} sup · {r.fallecidos} fall</Text> : null}
                  {r.actividades ? <Text numberOfLines={2} style={{ color: colors.muted, fontSize: 10.5 }}>📝 {r.actividades}</Text> : null}
                </View>
              ))}
              <View style={{ height: spacing.md }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Editor de la base acumulada (solo admin) */}
      <Modal visible={baseOpen} animationType="slide" transparent onRequestClose={() => setBaseOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>⚙️ Base acumulada</Text>
              <TouchableOpacity onPress={() => setBaseOpen(false)}><Text style={{ color: colors.muted, fontWeight: '700' }}>Cerrar ✕</Text></TouchableOpacity>
            </View>
            <Text style={{ color: colors.muted, fontSize: 11.5 }}>
              Lo acumulado ANTES de usar el sistema. A partir de la fecha de corte, los reportes se van sumando solos.
            </Text>
            {([
              ['Total m³ acumulados (base)', 'base_m3'],
              ['Total cuerpos siniestrados (base)', 'base_cuerpos'],
            ] as const).map(([label, key]) => (
              <View key={key} style={{ gap: 4 }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12.5 }}>{label}</Text>
                <TextInput
                  value={(baseDraft as any)[key] ? String((baseDraft as any)[key]) : ''}
                  onChangeText={(t) => { const n = Number((t || '').replace(',', '.')); setBaseDraft((p) => ({ ...p, [key]: isFinite(n) && n >= 0 ? n : 0 })); }}
                  placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric"
                  style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm, color: colors.text }}
                />
              </View>
            ))}
            <View style={{ gap: 4 }}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12.5 }}>Fecha de corte (AAAA-MM-DD)</Text>
              <TextInput
                value={baseDraft.base_date ?? ''}
                onChangeText={(t) => setBaseDraft((p) => ({ ...p, base_date: t.trim() === '' ? null : t.trim() }))}
                placeholder="2026-08-12" placeholderTextColor={colors.muted}
                autoCapitalize="none"
                style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm, color: colors.text }}
              />
              <Text style={{ color: colors.muted, fontSize: 10.5 }}>Se suman los reportes con fecha POSTERIOR a esta.</Text>
            </View>
            <TouchableOpacity onPress={guardarBase} disabled={baseBusy} style={{ backgroundColor: '#16A34A', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.xs, opacity: baseBusy ? 0.6 : 1 }}>
              <Text style={{ color: '#fff', fontWeight: '800' }}>{baseBusy ? 'Guardando…' : '💾 Guardar base'}</Text>
            </TouchableOpacity>
            {baseBusy ? <ActivityIndicator color={colors.primary} /> : null}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

/** Color sólido de un tono de estado, con los tokens del tema. */
function toneColor(colors: any, tone: 'danger' | 'warning' | 'success' | 'brand' | 'muted'): string {
  switch (tone) {
    case 'danger': return colors.danger;
    case 'warning': return colors.warning;
    case 'success': return colors.success;
    case 'brand': return colors.brandText;
    default: return colors.muted;
  }
}

/** Etiqueta legible del estado de una visita (registrarVisita: trabajando/parada/no_esta). */
function visitStatusLabel(s: string | null): string {
  const v = (s ?? '').toLowerCase();
  if (v.includes('trabaj')) return '🟢 Trabajando';
  if (v.includes('parad')) return '🟡 Parada';
  if (v.includes('no_esta') || v.includes('no esta')) return '⚪ No está';
  return s || '—';
}
