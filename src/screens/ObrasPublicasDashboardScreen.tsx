import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ActivityIndicator } from 'react-native';
import { Screen, Card, SectionTitle, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import InspectorKpiGrid, { KpiItem } from '../components/redesign/InspectorKpiGrid';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { caracasParts } from '../lib/jornada';
import { cmpText } from '../lib/text';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import {
  fetchOpDashboard, OpDashboard, OpDashMachine,
  fetchOpDailyReports, fetchOpReportSettings, saveOpReportSettings, computeOpAccumulated,
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
  const [settings, setSettings] = useState<OpReportSettings>({ base_m3: 0, base_cuerpos: 0, base_date: null });
  const [nowTick, setNowTick] = useState(Date.now());
  const [filter, setFilter] = useState<string | null>(null); // KPI seleccionado (filtra la flota)
  const [chartDays, setChartDays] = useState<7 | 30>(7);
  const [supFilter, setSupFilter] = useState<string | null>(null); // supervisor_id | null = todos

  // Editor de la base acumulada (solo admin).
  const [baseOpen, setBaseOpen] = useState(false);
  const [baseDraft, setBaseDraft] = useState<OpReportSettings>({ base_m3: 0, base_cuerpos: 0, base_date: null });
  const [baseBusy, setBaseBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, reps, st] = await Promise.all([
        fetchOpDashboard(today, addDaysISO(today, -30)),
        fetchOpDailyReports('2000-01-01'), // todos: el acumulado suma desde el corte
        fetchOpReportSettings(),
      ]);
      setData(d); setReports(reps); setSettings(st);
    } catch {
      setData({ machines: [], rounds: {}, maint: {}, roundsRange: [], visits: [] });
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => { load(); }, [load]);
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

  // Edificios distintos donde están las máquinas asignadas (machinery.referencia = EDIFICIO).
  const edificios = useMemo(() => {
    const s = new Set<string>();
    machines.forEach((x) => { const e = (x.edificio ?? '').trim(); if (e) s.add(e.toLowerCase()); });
    return s.size;
  }, [machines]);
  // m³ del día: suma de los m³ removidos hoy por las máquinas visibles (capturados en la vista del supervisor).
  const m3Dia = useMemo(() => {
    let s = 0;
    machines.forEach((x) => { s += d.rounds[x.id]?.m3 ?? 0; });
    return Math.round(s * 10) / 10;
  }, [machines, d.rounds]);

  // Reporte de Actividades OPP: consolidado del día (suma de reportes de las supervisoras)
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
    { key: 'edificios', label: 'Edificios', value: edificios, tone: 'warning', icon: '🏢' },
  ], [machines.length, counts, m3Dia, edificios]);

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

      {/* KPIs */}
      <InspectorKpiGrid items={kpis} activeKey={filter} onSelect={(k) => {
        // "Máquinas asignadas" abre el botón 🏛️ Obras Públicas del Catálogo (asignar
        // supervisores). El resto solo filtra la flota de abajo.
        if (k === 'asignadas') { navigation?.navigate?.('Equipos', { obrasPublicas: true }); return; }
        setFilter((p) => (p === k ? null : k));
      }} />

      {/* REPORTE DE ACTIVIDADES OPP — consolidado del día + acumulados */}
      <Card style={{ marginTop: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>📋 Reporte de Actividades OPP</Text>
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
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 110, gap: chartDays === 7 ? 6 : 2 }}>
          {perDay.map((x) => (
            <View key={x.iso} style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ color: colors.muted, fontSize: 9, marginBottom: 2, fontVariant: ['tabular-nums'] as any }}>{x.count > 0 ? x.count : ''}</Text>
              <View style={{ width: '72%', height: Math.max(2, (x.count / perDayMax) * 82), backgroundColor: x.count > 0 ? colors.tankFill : colors.tankTrack, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
            </View>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: chartDays === 7 ? 6 : 2, marginTop: 4 }}>
          {perDay.map((x, i) => (
            <View key={x.iso} style={{ flex: 1, alignItems: 'center' }}>
              {(chartDays === 7 || i % 5 === 0) ? <Text style={{ color: colors.muted, fontSize: 8.5 }}>{dm(x.iso)}</Text> : null}
            </View>
          ))}
        </View>
      </Card>

      {/* ESTADO DE FLOTA EN CAMPO */}
      <Card>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, marginBottom: spacing.sm }}>
          ⛰️ m³ removidos{filter === 'trabajando' ? ' · Trabajando' : filter === 'incidencias' ? ' · Averiadas/Paradas' : ''} ({fleet.length})
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
              const m3 = d.rounds[m.id]?.m3 ?? 0;
              return (
                <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderLeftWidth: 3, borderLeftColor: col, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>{m.code}</Text>
                    <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11 }}>
                      {[m.company_name, m.sector || m.parroquia, m.supervisor_name ? `🪖 ${m.supervisor_name}` : null].filter(Boolean).join(' · ') || '—'}
                    </Text>
                  </View>
                  {m3 > 0 ? <Text style={{ color: colors.accentSoftText, fontSize: 11.5, fontWeight: '900', fontVariant: ['tabular-nums'] as any }}>⛰️ {Math.round(m3 * 10) / 10} m³</Text> : null}
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
            {d.visits.filter((v) => visibleIds.has(v.machinery_id)).slice(0, 15).map((v, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <Text numberOfLines={1} style={{ flex: 1.4, color: colors.text, fontSize: 12, fontWeight: '700' }}>{codeById.get(v.machinery_id) ?? '—'}</Text>
                <Text numberOfLines={1} style={{ flex: 1.2, color: colors.muted, fontSize: 11.5 }}>{v.supervisor_name || '—'}</Text>
                <Text numberOfLines={1} style={{ flex: 0.9, color: colors.text, fontSize: 11 }}>{visitStatusLabel(v.status)}</Text>
                <Text style={{ flex: 0.7, color: colors.muted, fontSize: 11, textAlign: 'right', fontVariant: ['tabular-nums'] as any }}>{dm(v.visit_date)}</Text>
              </View>
            ))}
          </View>
        )}
      </Card>

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
