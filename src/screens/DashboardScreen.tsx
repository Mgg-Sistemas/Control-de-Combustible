import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading, Badge } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { useTable } from '../hooks/useTable';
import { supabase, selectAllRows } from '../lib/supabase';
import { TankLevel } from '../types/database';
import { workedFromShifts, PERIODO_INICIO, PERIODO_CORTE } from './ControlMaquinariaScreen';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

function levelTone(pct: number | null): 'success' | 'warning' | 'danger' {
  if (pct === null) return 'warning';
  if (pct <= 15) return 'danger';
  if (pct <= 30) return 'warning';
  return 'success';
}

const money = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Paleta para las barras de empresas.
const PALETTE = ['#2563EB', '#16A34A', '#F59E0B', '#DC2626', '#7C3AED', '#0891B2', '#DB2777', '#65A30D', '#EA580C', '#0D9488'];

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
}
/** Rango [desde, hasta] según el modo (día de hoy / mes actual / año actual). */
function rangeForMode(mode: 'dia' | 'mes' | 'anio'): [string, string] {
  const d = new Date();
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const to = todayISO();
  if (mode === 'dia') return [to, to];
  if (mode === 'mes') return [`${y}-${m}-01`, to];
  return [`${y}-01-01`, to];
}

/** Tarjeta de métrica: se puede tocar para ir al módulo con la info real. */
function StatCard({ label, value, color, onPress, flex = 1 }: { label: string; value: React.ReactNode; color: string; onPress?: () => void; flex?: number }) {
  const { colors } = useTheme();
  const inner = (
    <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{label}</Text>
        {onPress ? <Text style={{ color: colors.muted, fontSize: 12 }}>›</Text> : null}
      </View>
      <Text style={{ fontSize: 20, fontWeight: '700', color }}>{value}</Text>
    </>
  );
  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.7} onPress={onPress} style={{ flex }}>
        <Card>{inner}</Card>
      </TouchableOpacity>
    );
  }
  return <Card style={{ flex }}>{inner}</Card>;
}

/** Formatea horas con separador de miles: 2.916 h. */
const fmtHoras = (n: number) => `${Number(n.toFixed(Number.isInteger(n) ? 0 : 1)).toLocaleString('es-VE')} h`;

/** Gráfica de barras horizontales (sin librerías): cada empresa con su valor. */
function BarChart({ data, fmt = money }: { data: { label: string; value: number; color: string }[]; fmt?: (n: number) => string }) {
  const { colors } = useTheme();
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <View style={{ gap: spacing.sm }}>
      {data.map((d, i) => (
        <View key={d.label}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
            <Text numberOfLines={1} style={{ color: colors.text, fontWeight: i === 0 ? '800' : '600', fontSize: 13, flex: 1, paddingRight: spacing.sm }}>
              {i === 0 ? '🥇 ' : `${i + 1}. `}{d.label}
            </Text>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{fmt(d.value)}</Text>
          </View>
          <View style={{ height: 12, backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, overflow: 'hidden' }}>
            <View style={{ height: 12, width: `${Math.max(2, (d.value / max) * 100)}%`, backgroundColor: d.color, borderRadius: radius.pill }} />
          </View>
        </View>
      ))}
    </View>
  );
}

export default function DashboardScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { data: tanks, loading } = useTable<TankLevel>('tank_levels', { realtimeFrom: ['stock_movements', 'tanks'] });

  const [activeMachines, setActiveMachines] = useState<number | null>(null);
  const [activeLocations, setActiveLocations] = useState<number | null>(null);
  const [activeAssets, setActiveAssets] = useState<number | null>(null);
  const [states, setStates] = useState<{ op: number; esp: number; no: number } | null>(null);

  // Gráfica de ingreso por empresa + modo (día / mes / año).
  const [chartMode, setChartMode] = useState<'dia' | 'mes' | 'anio'>('mes');
  const [chart, setChart] = useState<{ label: string; value: number; color: string }[] | null>(null);
  const [chartTotal, setChartTotal] = useState(0);

  const loadCounts = useCallback(async () => {
    const [{ data: rounds }, { count: locCount }, { data: machs }, { count: vehCount }, { data: comps }] = await Promise.all([
      supabase.from('machine_rounds').select('machinery_id').eq('status', 'operativa').eq('closed', false),
      supabase.from('machinery').select('id', { count: 'exact', head: true }).not('latitude', 'is', null),
      supabase.from('machinery').select('id, operational, en_espera, active'),
      supabase.from('vehicles').select('id', { count: 'exact', head: true }).eq('active', true),
      supabase.from('companies').select('id, name'),
    ]);
    const uniq = new Set((rounds ?? []).map((r: any) => r.machinery_id));
    setActiveMachines(uniq.size);
    setActiveLocations(locCount ?? 0);
    // Estado de la flota completa. La maquinaria INACTIVA se define por
    // operational=false (mismo criterio que el catálogo), para que los números
    // coincidan siempre. Los tres cubos suman el total de la flota.
    let op = 0, esp = 0, no = 0, activas = 0;
    (machs ?? []).forEach((m: any) => {
      if (m.operational === false) { no++; return; }
      activas++;
      if (m.en_espera) esp++;
      else op++;
    });
    setStates({ op, esp, no });
    setActiveAssets(activas + (vehCount ?? 0));
  }, []);

  // Carga las HORAS TRABAJADAS (jornadas) por empresa para el rango del modo elegido.
  const loadChart = useCallback(async (mode: 'dia' | 'mes' | 'anio') => {
    const [from, to] = rangeForMode(mode);
    const [rows, comps, machs] = await Promise.all([
      selectAllRows('machine_rounds', 'machinery_id, round_date, day_hours, night_hours, hours_stopped, overtime_hours', (q) => q.gte('round_date', from).lte('round_date', to)),
      supabase.from('companies').select('id, name').then((r) => r.data ?? []),
      selectAllRows('machinery', 'id, company_id'),
    ]);
    const cname = new Map<string, string>((comps as any[]).map((c) => [c.id, c.name]));
    const mInfo = new Map<string, { cid: string | null }>();
    (machs ?? []).forEach((m: any) => mInfo.set(m.id, { cid: m.company_id }));
    // Una fila por (máquina, día) para no duplicar.
    const byMD = new Map<string, any>();
    (rows ?? []).forEach((b: any) => byMD.set(`${b.machinery_id}|${b.round_date}`, b));
    const byCompany = new Map<string, number>();
    byMD.forEach((b) => {
      const info = mInfo.get(b.machinery_id);
      if (!info) return;
      const w = workedFromShifts(Number(b.day_hours ?? 0), Number(b.night_hours ?? 0), Number(b.hours_stopped ?? 0), Number(b.overtime_hours ?? 0));
      if (w <= 0) return;
      const key = info.cid ? cname.get(info.cid) ?? 'Empresa' : 'Sin empresa';
      byCompany.set(key, (byCompany.get(key) ?? 0) + w);
    });
    const list = [...byCompany.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    setChart(list.map((x, i) => ({ ...x, color: PALETTE[i % PALETTE.length] })));
    setChartTotal(list.reduce((s, x) => s + x.value, 0));
  }, []);

  useEffect(() => {
    loadCounts();
    let timer: any;
    const bump = () => { clearTimeout(timer); timer = setTimeout(loadCounts, 300); };
    const ch = supabase.channel('rt-dashboard-counts');
    ['machine_rounds', 'machinery', 'vehicles'].forEach((t) =>
      ch.on('postgres_changes' as any, { event: '*', schema: 'public', table: t }, bump)
    );
    ch.subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(ch); };
  }, [loadCounts]);

  useEffect(() => { setChart(null); loadChart(chartMode); }, [chartMode, loadChart]);

  const totalCurrent = tanks.reduce((s, t) => s + Number(t.current_l || 0), 0);
  const lowTanks = tanks.filter((t) => (t.pct ?? 0) <= 30).length;
  const modeLabel = chartMode === 'dia' ? 'hoy' : chartMode === 'mes' ? 'este mes' : 'este año';

  return (
    <Screen>
      <ConfigBanner />
      <Card style={{ backgroundColor: colors.primary }}>
        <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 16, textAlign: 'center' }}>
          BIENVENIDO AL CONTROL INTERNO DE
        </Text>
        <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 16, textAlign: 'center' }}>
          SOS LA GUAIRA 2026
        </Text>
      </Card>

      {/* ── Gráfica: jornadas (horas trabajadas) por empresa (día / mes / año) ── */}
      <SectionTitle>Jornadas Totales por Empresa</SectionTitle>
      <Card>
        <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
          {([['dia', '📅 Día'], ['mes', '🗓️ Mes'], ['anio', '📆 Año']] as const).map(([k, lbl]) => {
            const on = chartMode === k;
            return (
              <TouchableOpacity
                key={k}
                onPress={() => setChartMode(k)}
                style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt }}
              >
                <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{lbl}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
          <Text style={{ color: colors.muted, fontSize: 12 }}>Total {modeLabel}</Text>
          <Text style={{ color: colors.success, fontWeight: '800', fontSize: 16 }}>{fmtHoras(chartTotal)}</Text>
        </View>
        {chart === null ? (
          <Loading />
        ) : chart.length === 0 ? (
          <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center', paddingVertical: spacing.md }}>
            Sin jornadas registradas {modeLabel}.
          </Text>
        ) : (
          <BarChart data={chart} fmt={fmtHoras} />
        )}
        <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm }}>
          Total de horas trabajadas (día + noche − paradas + extras) por empresa. Toca Día/Mes/Año para cambiar el período.
        </Text>
      </Card>

      <SectionTitle>Resumen</SectionTitle>

      {/* Estados de las máquinas: cada uno lleva al módulo Equipos mostrando esas máquinas. */}
      <Card>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Estado de las máquinas · toca uno para ver las máquinas</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {([
            { key: 'active', n: states?.op, color: colors.success, label: '🟢 Operativas' },
            { key: 'espera', n: states?.esp, color: colors.warning, label: '🕓 En espera' },
            { key: 'inactive', n: states?.no, color: colors.danger, label: '🔴 No operativa' },
          ] as const).map((s) => (
            <TouchableOpacity
              key={s.key}
              activeOpacity={0.7}
              onPress={() => navigation?.navigate('Equipos', { status: s.key })}
              style={{ alignItems: 'center', flex: 1 }}
            >
              <Text style={{ color: s.color, fontWeight: '800', fontSize: 22 }}>{states ? s.n : '…'}</Text>
              <Text style={{ color: colors.muted, fontSize: 11 }}>{s.label}</Text>
              <Text style={{ color: colors.muted, fontSize: 10, marginTop: 2 }}>ver ›</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Card>

      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <StatCard
          label="Máquinas activas (rondas)"
          value={activeMachines === null ? '…' : activeMachines}
          color={activeMachines ? colors.success : colors.text}
          onPress={() => navigation?.navigate('ControlMaquinaria')}
        />
        <StatCard
          label="Ubicaciones activas"
          value={activeLocations === null ? '…' : activeLocations}
          color={activeLocations ? colors.primary : colors.text}
          onPress={() => navigation?.navigate('Map')}
        />
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <StatCard
          label="Existencia total"
          value={`${totalCurrent.toLocaleString()} L`}
          color={colors.text}
          onPress={() => navigation?.navigate('More', { screen: 'Combustible' })}
        />
        <StatCard
          label="Maquinaria/Vehículos activos"
          value={activeAssets === null ? '…' : activeAssets}
          color={activeAssets ? colors.primary : colors.text}
          onPress={() => navigation?.navigate('Equipos')}
        />
      </View>

      <StatCard
        label="Tanques con stock bajo"
        value={`${lowTanks} / ${tanks.length}`}
        color={lowTanks ? colors.warning : colors.success}
        onPress={() => navigation?.navigate('More', { screen: 'Combustible' })}
      />

      <SectionTitle>Cisternas / Niveles de tanque</SectionTitle>
      {loading ? (
        <Loading />
      ) : tanks.length === 0 ? (
        <EmptyState
          title="Sin tanques registrados"
          subtitle="Cuando configures Supabase y agregues tanques, verás aquí sus niveles."
        />
      ) : (
        tanks.map((t) => {
          const pct = Math.max(0, Math.min(100, t.pct ?? 0));
          const tone = levelTone(t.pct);
          const barColor =
            tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning : colors.success;
          return (
            <TouchableOpacity key={t.id} activeOpacity={0.7} onPress={() => navigation?.navigate('More', { screen: 'Combustible' })}>
              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontWeight: '600', color: colors.text }}>{t.name}</Text>
                  <Badge label={t.fuel} />
                </View>
                <Text style={{ color: colors.muted, fontSize: 13 }}>
                  {Number(t.current_l).toLocaleString()} / {Number(t.capacity_l).toLocaleString()} L ({pct}%)
                </Text>
                <View style={{ height: 8, backgroundColor: colors.surfaceAlt, borderRadius: radius.pill }}>
                  <View
                    style={{
                      height: 8,
                      width: `${pct}%`,
                      backgroundColor: barColor,
                      borderRadius: radius.pill,
                    }}
                  />
                </View>
              </Card>
            </TouchableOpacity>
          );
        })
      )}
    </Screen>
  );
}
