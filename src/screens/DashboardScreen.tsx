import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading, Badge } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { TankLevel as TankGauge } from '../components/TankLevel'; // rediseño: medidor con marca de umbral (el tipo TankLevel viene de types/database)
import { AsistenciaButton } from '../components/AsistenciaButton';
import { useTable } from '../hooks/useTable';
import { supabase, selectAllRows } from '../lib/supabase';
import { nextRtInstanceId } from '../hooks/useRealtime';
import { TankLevel } from '../types/database';
import { workedFromShifts } from './ControlMaquinariaScreen';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { caracasParts } from '../lib/jornada';
import { fetchAveriaCat, fetchJornadaCat, fetchInspByShift, bucketMachineStatus, makeLiveStatusOf } from '../lib/machineLiveStatus';

const money = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Paleta para las barras de empresas.
const PALETTE = ['#2563EB', '#16A34A', '#F59E0B', '#DC2626', '#7C3AED', '#0891B2', '#DB2777', '#65A30D', '#EA580C', '#0D9488'];

function todayISO(): string {
  // Fecha de HOY según la hora de Caracas (no la zona horaria del dispositivo).
  return caracasParts(new Date()).iso;
}
/** Rango [desde, hasta] según el modo (día de hoy / mes actual / año actual). */
function rangeForMode(mode: 'dia' | 'mes' | 'anio'): [string, string] {
  const to = todayISO();
  const [y, m] = to.split('-');
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
  // Detalle de las máquinas activas (con ronda) agrupadas por empresa.
  const [activeByCompany, setActiveByCompany] = useState<{ company: string; items: { code: string; serial: string | null; tipo: string | null }[] }[]>([]);
  const [showActive, setShowActive] = useState(false);
  const [activeLocations, setActiveLocations] = useState<number | null>(null);
  const [activeAssets, setActiveAssets] = useState<number | null>(null);
  const [states, setStates] = useState<{ op: number; ave: number; ret: number; esp: number } | null>(null);

  // Gráfica de ingreso por empresa + modo (día / mes / año).
  const [chartMode, setChartMode] = useState<'dia' | 'mes' | 'anio'>('mes');
  const chartModeRef = useRef(chartMode);
  chartModeRef.current = chartMode;
  const [chart, setChart] = useState<{ label: string; value: number; color: string }[] | null>(null);
  const [chartTotal, setChartTotal] = useState(0);

  const loadCounts = useCallback(async () => {
    const [{ data: rounds }, { count: locCount }, { data: machs }, { count: vehCount }, { data: comps }, averiaCat, jornadaCat, inspByShift] = await Promise.all([
      supabase.from('machine_rounds').select('machinery_id').eq('status', 'operativa').eq('closed', false),
      supabase.from('machinery').select('id', { count: 'exact', head: true }).not('latitude', 'is', null),
      supabase.from('machinery').select('id, operational, en_espera, active'),
      supabase.from('vehicles').select('id', { count: 'exact', head: true }).eq('active', true),
      supabase.from('companies').select('id, name'),
      // OPERATIVAS/AVERIADAS/RETIRADAS/ESPERANDO: MISMO clasificador EN VIVO que el
      // Catálogo (`makeLiveStatusOf` en machineLiveStatus.ts, extraído de
      // `EquiposScreen.liveStatusOf`) — antes esta tarjeta reconstruía su propia
      // versión sobre `buildDaySets` (pensado para el panel de Inspecciones, por-turno
      // aislado) + un parche manual de reactivación cruzada, y se desincronizaba del
      // Catálogo en casos reales (avería arrastrada + la máquina ya trabajó en el OTRO
      // turno hoy) — queja del cliente 11-ago-2026 (Catálogo 203/23 vs Inicio 200/26).
      // Usar EXACTAMENTE las mismas funciones garantiza que nunca más se desincronicen.
      fetchAveriaCat(),
      fetchJornadaCat(),
      fetchInspByShift(),
    ]);
    const retiredIds = new Set((machs ?? []).filter((m: any) => m.operational === false).map((m: any) => m.id));
    const liveStatusOf = makeLiveStatusOf({ jornadaCat, averiaCat, inspByShift, retiredIds, nowTick: Date.now() });
    const { averiadaMachines, activeMachines: activeMachinesBucket, retiradaMachines, esperaMachines } = bucketMachineStatus((machs ?? []) as any, liveStatusOf);
    const uniq = new Set((rounds ?? []).map((r: any) => r.machinery_id));
    setActiveMachines(uniq.size);
    // Detalle de esas máquinas activas agrupado por empresa (para ver al tocar la tarjeta).
    const ids = Array.from(uniq).filter(Boolean);
    if (ids.length) {
      const { data: actMd } = await supabase
        .from('machinery')
        .select('code, serial, tipo, company:company_id(name)')
        .in('id', ids as any)
        .order('code');
      const map = new Map<string, { company: string; items: { code: string; serial: string | null; tipo: string | null }[] }>();
      (actMd ?? []).forEach((m: any) => {
        const cn = (m.company?.name && String(m.company.name).trim()) || 'Sin empresa';
        const g = map.get(cn) ?? { company: cn, items: [] as { code: string; serial: string | null; tipo: string | null }[] };
        g.items.push({ code: m.code ?? '—', serial: m.serial ?? null, tipo: (m.tipo && String(m.tipo).trim()) || null });
        map.set(cn, g);
      });
      setActiveByCompany([...map.values()].sort((a, b) => a.company.localeCompare(b.company, 'es')));
    } else setActiveByCompany([]);
    setActiveLocations(locCount ?? 0);
    // Estado de la flota completa (4 cubos exclusivos que suman el total) — MISMOS
    // buckets que el Catálogo (`bucketMachineStatus`, ver comentario arriba).
    const op = activeMachinesBucket.length, ave = averiadaMachines.length, ret = retiradaMachines.length, esp = esperaMachines.length;
    setStates({ op, ave, ret, esp });
    // "Maquinaria/Vehículos activos": operativas + averiadas (excluye retiradas Y
    // en_espera), consistente con el widget de 4 cubos de arriba — antes sumaba TODAS
    // las `operational` (incluyendo en_espera), así que no cuadraba con "🟢 Operativas"
    // + "🔴 Averiadas" del mismo panel.
    setActiveAssets(op + ave + (vehCount ?? 0));
  }, []);

  // Carga las HORAS TRABAJADAS (jornadas) por empresa para el rango del modo elegido.
  const loadChart = useCallback(async (mode: 'dia' | 'mes' | 'anio') => {
    const [from, to] = rangeForMode(mode);
    const [rows, comps, machs] = await Promise.all([
      selectAllRows('machine_rounds', 'machinery_id, round_date, day_hours, night_hours, hours_stopped, overtime_hours, jornada_start_at, jornada_shift', (q) => q.gte('round_date', from).lte('round_date', to)),
      supabase.from('companies').select('id, name').then((r) => r.data ?? []),
      selectAllRows('machinery', 'id, company_id'),
    ]);
    const cname = new Map<string, string>((comps as any[]).map((c) => [c.id, c.name]));
    const mInfo = new Map<string, string | null>();
    (machs ?? []).forEach((m: any) => mInfo.set(m.id, m.company_id));
    const nowMs = Date.now();
    // Una fila por (máquina, día): acumula con Math.max y guarda el inicio de la jornada
    // EN CURSO para sumar el tiempo transcurrido EN VIVO (igual que el Informe por jornada).
    const byMD = new Map<string, { mid: string; date: string; d: number; n: number; s: number; o: number; js: number | null; jsh: string | null }>();
    (rows ?? []).forEach((b: any) => {
      const k = `${b.machinery_id}|${b.round_date}`;
      const cur = byMD.get(k) ?? { mid: b.machinery_id, date: b.round_date, d: 0, n: 0, s: 0, o: 0, js: null, jsh: null };
      cur.d = Math.max(cur.d, Number(b.day_hours ?? 0));
      cur.n = Math.max(cur.n, Number(b.night_hours ?? 0));
      cur.s = Math.max(cur.s, Number(b.hours_stopped ?? 0));
      cur.o = Math.max(cur.o, Number(b.overtime_hours ?? 0));
      if (b.jornada_start_at) { const ms = new Date(b.jornada_start_at).getTime(); if (isFinite(ms)) { cur.js = ms; cur.jsh = b.jornada_shift ?? null; } }
      byMD.set(k, cur);
    });
    const byCompany = new Map<string, number>();
    byMD.forEach((r) => {
      if (!mInfo.has(r.mid)) return;
      // Jornada EN CURSO: sumar el tiempo transcurrido desde el inicio del turno (día 7am /
      // noche 7pm, hora Caracas), tope 12h — así el total del día va EN VIVO y aparecen las
      // empresas que están trabajando aunque aún no hayan finalizado la jornada.
      let dd = r.d, nn = r.n;
      if (r.js != null) {
        const shiftStart = new Date(`${r.date}T${r.jsh === 'night' ? '19:00:00' : '07:00:00'}-04:00`).getTime();
        const elapsed = Math.min(12, Math.max(0, (nowMs - shiftStart) / 3600000));
        if (r.jsh === 'night') nn = Math.max(nn, elapsed); else dd = Math.max(dd, elapsed);
      }
      const w = workedFromShifts(dd, nn, r.s, r.o);
      if (w <= 0) return;
      const cid = mInfo.get(r.mid);
      const key = cid ? cname.get(cid) ?? 'Empresa' : 'Sin empresa';
      byCompany.set(key, (byCompany.get(key) ?? 0) + w);
    });
    const list = [...byCompany.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    setChart(list.map((x, i) => ({ ...x, color: PALETTE[i % PALETTE.length] })));
    setChartTotal(list.reduce((s, x) => s + x.value, 0));
  }, []);

  const rtId = useRef(0);
  if (!rtId.current) rtId.current = nextRtInstanceId();

  useEffect(() => {
    loadCounts();
    let timer: any;
    // También refresca la gráfica de jornadas: sin esto, una ronda registrada desde
    // otro dispositivo no aparecía en el gráfico hasta cambiar de pestaña día/mes/año.
    const bump = () => { clearTimeout(timer); timer = setTimeout(() => { loadCounts(); loadChart(chartModeRef.current); }, 300); };
    const ch = supabase.channel(`rt-dashboard-counts-${rtId.current}`);
    // maintenance_requests/machine_inspectors: sin estas, marcar una avería/parada o
    // reasignar el inspector "SIEMPRE ACTIVO" de una máquina no refrescaba este widget
    // en vivo (solo lo hacía al recargar la pantalla).
    ['machine_rounds', 'machinery', 'vehicles', 'maintenance_requests', 'machine_inspectors'].forEach((t) =>
      ch.on('postgres_changes' as any, { event: '*', schema: 'public', table: t }, bump)
    );
    ch.subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadCounts]);

  useEffect(() => {
    setChart(null);
    loadChart(chartMode);
    // EN VIVO: en modo Día, refresca cada 60s para que las jornadas en curso vayan
    // sumando su tiempo transcurrido sin tener que cambiar de pestaña.
    if (chartMode !== 'dia') return;
    const id = setInterval(() => loadChart('dia'), 60000);
    return () => clearInterval(id);
  }, [chartMode, loadChart]);

  const totalCurrent = tanks.reduce((s, t) => s + Number(t.current_l || 0), 0);
  // Umbral de "stock bajo" (20%): mismo valor que usa el módulo Combustible ▸ Tanques
  // (TanksShowcase/TanksPilot, LOW_PCT) y que el medidor TankLevel usa por defecto.
  const lowTanks = tanks.filter((t) => (t.pct ?? 0) <= 20).length;
  const modeLabel = chartMode === 'dia' ? 'hoy' : chartMode === 'mes' ? 'este mes' : 'este año';

  return (
    <Screen>
      <ConfigBanner />
      <Card style={{ backgroundColor: colors.brand, borderColor: colors.brand }}>
        <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 16, textAlign: 'center', letterSpacing: 0.3 }}>
          BIENVENIDO AL CONTROL INTERNO DE
        </Text>
        <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 16, textAlign: 'center', letterSpacing: 0.3 }}>
          SOS LA GUAIRA 2026
        </Text>
      </Card>

      {/* Marcar asistencia de empleados (escaneo de carnet). Solo para usuarios
          sin acceso completo (no-admin); el admin ya la tiene en el menú "Más". */}
      <AsistenciaButton onPress={() => navigation?.navigate('More', { screen: 'Asistencia' })} />

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
                style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt }}
              >
                <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{lbl}</Text>
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
        {/* TOTAL DE FLOTA DISPONIBLE = operativas + averiadas + esperando (las retiradas NO cuentan). */}
        <View style={{ backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, marginBottom: spacing.sm }}>
          <Text style={{ color: colors.brandContrast, fontSize: 11, fontWeight: '800', letterSpacing: 1, opacity: 0.9 }}>TOTAL DE FLOTA DISPONIBLE</Text>
          <Text style={{ color: colors.brandContrast, fontSize: 34, fontWeight: '900', fontVariant: ['tabular-nums'] as any, lineHeight: 38 }}>
            {states ? (states.op + states.ave + states.esp) : '…'}
          </Text>
        </View>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Estado de las máquinas · toca uno para ver las máquinas</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {([
            { key: 'active', n: states?.op, color: colors.success, label: '🟢 Operativas' },
            { key: 'averiada', n: states?.ave, color: colors.warning, label: '🔴 Averiadas' },
            { key: 'espera', n: states?.esp, color: '#3B82F6', label: '🔵 Esperando instrucciones' },
            { key: 'retirada', n: states?.ret, color: colors.danger, label: '⬛ Retiradas' },
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
          return (
            <TouchableOpacity key={t.id} activeOpacity={0.7} onPress={() => navigation?.navigate('More', { screen: 'Combustible' })}>
              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontWeight: '700', color: colors.text }}>{t.name}</Text>
                  <Badge label={t.fuel} />
                </View>
                <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 6 }}>
                  {Number(t.current_l).toLocaleString()} / {Number(t.capacity_l).toLocaleString()} L ({pct}%)
                </Text>
                {/* Rediseño: medidor con marca de umbral (umbral 20% = "stock bajo" del panel,
                    igual al umbral del módulo Combustible ▸ Tanques). */}
                <TankGauge pct={pct} thresholdPct={20} height={9} />
              </Card>
            </TouchableOpacity>
          );
        })
      )}

      {/* Detalle de máquinas activas (con ronda) desplegadas por empresa. */}
      <Modal visible={showActive} animationType="slide" transparent onRequestClose={() => setShowActive(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '85%', padding: spacing.lg }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 17 }}>Máquinas activas por empresa ({activeMachines ?? 0})</Text>
              <TouchableOpacity onPress={() => setShowActive(false)} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              {activeByCompany.length === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 13, paddingVertical: spacing.md }}>No hay máquinas con ronda activa ahora mismo.</Text>
              ) : activeByCompany.map((g) => (
                <View key={g.company} style={{ marginBottom: spacing.md }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 14 }}>🏢 {g.company}</Text>
                    <Text style={{ color: colors.muted, fontWeight: '800', fontSize: 13 }}>{g.items.length}</Text>
                  </View>
                  {g.items.map((it, i) => (
                    <TouchableOpacity
                      key={`${g.company}-${it.code}-${it.serial ?? i}`}
                      activeOpacity={0.6}
                      onPress={() => { setShowActive(false); navigation?.navigate('ControlMaquinaria', { q: it.serial || it.code }); }}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}
                    >
                      <Text style={{ color: colors.muted, fontSize: 12, width: 24, textAlign: 'right' }}>{i + 1}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{it.code}</Text>
                        {it.tipo ? <Text style={{ color: colors.muted, fontSize: 11 }}>🏷️ {it.tipo}</Text> : null}
                        {it.serial ? <Text style={{ color: colors.muted, fontSize: 11 }}>Serial {it.serial}</Text> : null}
                      </View>
                      <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>ver ›</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
              <View style={{ height: spacing.xl }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
