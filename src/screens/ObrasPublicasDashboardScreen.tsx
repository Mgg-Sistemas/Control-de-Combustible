import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Screen, Card, SectionTitle, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import InspectorKpiGrid, { KpiItem } from '../components/redesign/InspectorKpiGrid';
import { RBarChart } from '../components/redesign/RList';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { caracasParts } from '../lib/jornada';
import { cmpText } from '../lib/text';
import { fetchOpDashboard, OpDashboard, OpDashMachine } from '../lib/obrasPublicas';

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

export default function ObrasPublicasDashboardScreen() {
  const { colors } = useTheme();
  const today = caracasParts(new Date()).iso;
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<OpDashboard | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [filter, setFilter] = useState<string | null>(null); // KPI seleccionado (filtra la flota)
  const [chartDays, setChartDays] = useState<7 | 30>(7);
  const [supFilter, setSupFilter] = useState<string | null>(null); // supervisor_id | null = todos

  const load = useCallback(async () => {
    try {
      const d = await fetchOpDashboard(today, addDaysISO(today, -30));
      setData(d);
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

  const horasTotalHoy = useMemo(() => machines.reduce((s, x) => s + horasHoy(x.id), 0), [machines, horasHoy]);
  const visitasHoy = useMemo(() => d.visits.filter((v) => v.visit_date === today && visibleIds.has(v.machinery_id)).length, [d.visits, today, visibleIds]);

  // KPIs (tarjetas de arriba). El valor es numérico (InspectorKpiGrid).
  const kpis: KpiItem[] = useMemo(() => [
    { key: 'asignadas', label: 'Máquinas asignadas', value: machines.length, tone: 'brand', icon: '🚜' },
    { key: 'trabajando', label: 'Trabajando ahora', value: counts.trabajando, tone: 'success', icon: '🟢' },
    { key: 'incidencias', label: 'Averiadas / Paradas', value: counts.averia + counts.parada, tone: 'danger', icon: '🔧' },
    { key: 'horas', label: 'Horas de hoy', value: Math.round(horasTotalHoy * 10) / 10, tone: 'accent', icon: '🕒' },
    { key: 'visitas', label: 'Visitas de hoy', value: visitasHoy, tone: 'warning', icon: '🪖' },
  ], [machines.length, counts, horasTotalHoy, visitasHoy]);

  // Filtro de la flota según el KPI tocado.
  const fleetPred = useCallback((id: string): boolean => {
    if (filter === 'trabajando') return estadoOf(id) === 'trabajando';
    if (filter === 'incidencias') { const e = estadoOf(id); return e === 'averia' || e === 'parada'; }
    return true; // asignadas / horas / visitas / sin filtro
  }, [filter, estadoOf]);

  // Horas por máquina (barras) — top 8 con horas > 0.
  const horasPorMaquina = useMemo(() => (
    machines
      .map((x) => ({ label: x.code, value: horasHoy(x.id) }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
  ), [machines, horasHoy]);

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
      <InspectorKpiGrid items={kpis} activeKey={filter} onSelect={(k) => setFilter((p) => (p === k ? null : k))} />

      {/* GRÁFICO 1 — Horas por máquina (hoy) */}
      <Card style={{ marginTop: spacing.md }}>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, marginBottom: spacing.sm }}>🏁 Horas por máquina (hoy)</Text>
        {horasPorMaquina.length ? (
          <RBarChart data={horasPorMaquina} fmt={(n) => `${Math.round(n * 100) / 100} h`} />
        ) : (
          <Text style={{ color: colors.muted, fontSize: 12.5 }}>Sin horas registradas hoy.</Text>
        )}
      </Card>

      {/* GRÁFICO 2 — Distribución por estado (barra segmentada + leyenda) */}
      <Card>
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
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>📅 Máquinas activas por día</Text>
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
          ⛰️ Metros Cúbicos Removidos{filter === 'trabajando' ? ' · Trabajando' : filter === 'incidencias' ? ' · Averiadas/Paradas' : ''} ({fleet.length})
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
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, marginBottom: spacing.sm }}>🚚 Acarreo total</Text>
        {d.visits.filter((v) => visibleIds.has(v.machinery_id)).length === 0 ? (
          <Text style={{ color: colors.muted, fontSize: 12.5 }}>Sin acarreo registrado en el rango.</Text>
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
