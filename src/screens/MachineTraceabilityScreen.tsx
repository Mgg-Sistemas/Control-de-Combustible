// Reporte "Trazabilidad e Historial por Equipo" — Módulo de Reportes → Maquinaria/
// Vehículos. Muestra, para UNA máquina y un rango de fechas, la línea de tiempo
// completa: días trabajados (machine_rounds, mismas horas reales de Inspecciones)
// y el historial de paradas/averías (maintenance_requests) con inicio, fin/
// reactivación y tiempo total inactivo. Exporta a PDF.
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState } from '../components/ui';
import { DateField } from '../components/DateField';
import { useTable } from '../hooks/useTable';
import { supabase } from '../lib/supabase';
import { norm, cmpText } from '../lib/text';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { generateMachineTraceabilityReport, TraceEvent, TraceWorkedDay } from '../lib/machineTraceabilityReport';

type MachineryRow = { id: string; code: string; serial: string | null; plate: string | null; company_id: string | null; encargado: string | null; operational: boolean };
type CompanyRow = { id: string; name: string | null };

function caracasTodayISO(): string {
  const p: any = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = (t: string) => p.find((x: any) => x.type === t)?.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
function addDaysISO(iso: string, delta: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
const dmy = (iso: string) => { const [y, m, d] = (iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : (iso || '—'); };
const dmyHm = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fmtDuration = (ms: number) => {
  const totalH = Math.max(0, ms / 3600000);
  const d = Math.floor(totalH / 24);
  const h2 = Math.round(totalH - d * 24);
  return d > 0 ? `${d}d ${h2}h` : `${Math.round(totalH)}h`;
};

export default function MachineTraceabilityScreen({ route }: any) {
  const { colors } = useTheme();
  const today = caracasTodayISO();

  const { data: machinery } = useTable<MachineryRow>('machinery', { select: 'id, code, serial, plate, company_id, encargado, operational', orderBy: 'code', realtimeFrom: 'machinery' });
  const { data: companies } = useTable<CompanyRow>('companies', { select: 'id, name', orderBy: 'name' });
  const companiesMap = useMemo(() => {
    const m: Record<string, string> = {};
    companies.forEach((c) => { if (c.id) m[c.id] = c.name || '—'; });
    return m;
  }, [companies]);

  // Preselección: si se llega desde otro reporte (p. ej. "Ver detalle" en la
  // Trazabilidad de Maquinaria/Vehículo) con un `machineId` ya elegido, arranca
  // directo en esa máquina en vez de pedir que la busquen de nuevo.
  const [machineId, setMachineId] = useState(route?.params?.machineId ?? '');
  const [machineOpen, setMachineOpen] = useState(false);
  const [machineQuery, setMachineQuery] = useState('');
  const machineInfo = machineId ? machinery.find((m) => m.id === machineId) : undefined;
  const machineLabel = machineInfo?.code ?? '';

  const machineOptions = useMemo(() => {
    const q = norm(machineQuery);
    const withInfo = machinery.map((m) => ({ ...m, companyName: m.company_id ? (companiesMap[m.company_id] ?? '') : '' }));
    const list = q
      ? withInfo.filter((m) => norm(`${m.code} ${m.serial ?? ''} ${m.plate ?? ''} ${m.companyName} ${m.encargado ?? ''}`).includes(q))
      : withInfo;
    return list.slice().sort((a, b) => cmpText(a.code, b.code)).slice(0, 30);
  }, [machinery, machineQuery, companiesMap]);

  const [fromISO, setFromISO] = useState(addDaysISO(today, -30));
  const [toISO, setToISO] = useState(today);

  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [workedDays, setWorkedDays] = useState<TraceWorkedDay[]>([]);
  const [queried, setQueried] = useState(false);

  const consultar = async () => {
    if (!machineId) return;
    setLoading(true);
    setQueried(true);
    try {
      const rangeStart = new Date(fromISO + 'T00:00:00-04:00').getTime();
      const rangeEnd = new Date(addDaysISO(toISO, 1) + 'T00:00:00-04:00').getTime();

      const [maintRes, roundsRes] = await Promise.all([
        supabase
          .from('maintenance_requests')
          .select('material, notes, created_at, resolved_at, status')
          .eq('machinery_id', machineId)
          .order('created_at', { ascending: false }),
        supabase
          .from('machine_rounds')
          .select('round_date, day_hours, night_hours')
          .eq('machinery_id', machineId)
          .gte('round_date', fromISO)
          .lte('round_date', toISO),
      ]);

      const ev: TraceEvent[] = (maintRes.data ?? [])
        .map((r: any) => ({
          tipo: (r.material === 'MÁQUINA PARADA' ? 'parada' : 'averia') as 'averia' | 'parada',
          motivo: r.notes || (r.material === 'MÁQUINA PARADA' ? null : r.material),
          startIso: r.created_at,
          endIso: r.resolved_at ?? null,
        }))
        .filter((e) => {
          const s = new Date(e.startIso).getTime();
          const en = e.endIso ? new Date(e.endIso).getTime() : Date.now();
          return s < rangeEnd && en >= rangeStart; // se solapa con el rango
        });
      setEvents(ev);

      const wd: TraceWorkedDay[] = (roundsRes.data ?? []).map((r: any) => ({
        date: r.round_date,
        dayH: Number(r.day_hours) || 0,
        nightH: Number(r.night_hours) || 0,
      }));
      setWorkedDays(wd);
    } finally {
      setLoading(false);
    }
  };

  const resumen = useMemo(() => {
    const diasTrabajados = workedDays.filter((d) => d.dayH + d.nightH > 0).length;
    const horasTotales = workedDays.reduce((s, d) => s + d.dayH + d.nightH, 0);
    const averias = events.filter((e) => e.tipo === 'averia').length;
    const paradas = events.filter((e) => e.tipo === 'parada').length;
    const nowMs = Date.now();
    const msInactivo = events.reduce((s, e) => s + Math.max(0, (e.endIso ? new Date(e.endIso).getTime() : nowMs) - new Date(e.startIso).getTime()), 0);
    return { diasTrabajados, horasTotales, averias, paradas, msInactivo };
  }, [events, workedDays]);

  const [exporting, setExporting] = useState(false);
  const exportar = async () => {
    if (!machineId) return;
    setExporting(true);
    try {
      await generateMachineTraceabilityReport({ machineLabel, fromISO, toISO, events, workedDays });
    } finally {
      setExporting(false);
    }
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  return (
    <Screen>
      <SectionTitle>🧭 Trazabilidad e Historial por Equipo</SectionTitle>

      <Card>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>🚜 Máquina</Text>
        <TouchableOpacity onPress={() => setMachineOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.xs }}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>
            {machineId ? `${machineLabel}${machineInfo && !machineInfo.operational ? '  ⛔ Inactiva' : ''}` : 'Selecciona una máquina…'}
          </Text>
          <Text style={{ color: colors.brandText, fontWeight: '800' }}>{machineOpen ? '▲' : '▼'}</Text>
        </TouchableOpacity>
        {machineOpen ? (
          <View style={{ marginTop: spacing.xs }}>
            <TextInput value={machineQuery} onChangeText={setMachineQuery} placeholder="🔎 Buscar por código, serial, placa, empresa o encargado…" placeholderTextColor={colors.muted} style={input} />
            <View style={{ maxHeight: 240, marginTop: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' }}>
              {machineOptions.length === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 12, padding: spacing.sm }}>Sin resultados.</Text>
              ) : machineOptions.map((m) => (
                <TouchableOpacity key={m.id} onPress={() => { setMachineId(m.id); setMachineOpen(false); setMachineQuery(''); setQueried(false); }} style={{ paddingVertical: 8, paddingHorizontal: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{m.code}{!m.operational ? '  ⛔' : ''}</Text>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>{[m.serial, m.plate, (m as any).companyName].filter(Boolean).join(' · ')}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Desde</Text>
            <DateField value={fromISO} onChange={setFromISO} maxISO={today} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Hasta</Text>
            <DateField value={toISO} onChange={setToISO} maxISO={today} minISO={fromISO} />
          </View>
        </View>

        <TouchableOpacity onPress={consultar} disabled={!machineId || loading} style={{ marginTop: spacing.md, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', opacity: !machineId || loading ? 0.6 : 1 }}>
          <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>{loading ? 'Consultando…' : '🔎 Consultar historial'}</Text>
        </TouchableOpacity>
      </Card>

      {!queried ? null : (
        <>
          <Card>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, marginBottom: spacing.xs }}>📊 Resumen del rango</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              <Text style={{ color: colors.text, fontSize: 12 }}>🗓️ Días trabajados: <Text style={{ fontWeight: '800' }}>{resumen.diasTrabajados}</Text></Text>
              <Text style={{ color: colors.text, fontSize: 12 }}>⏱️ Horas totales: <Text style={{ fontWeight: '800' }}>{resumen.horasTotales.toFixed(1)} h</Text></Text>
              <Text style={{ color: colors.text, fontSize: 12 }}>🔴 Averías: <Text style={{ fontWeight: '800' }}>{resumen.averias}</Text></Text>
              <Text style={{ color: colors.text, fontSize: 12 }}>🟡 Paradas: <Text style={{ fontWeight: '800' }}>{resumen.paradas}</Text></Text>
              <Text style={{ color: colors.text, fontSize: 12 }}>⏸️ Inactivo total: <Text style={{ fontWeight: '800' }}>{fmtDuration(resumen.msInactivo)}</Text></Text>
            </View>
            <TouchableOpacity onPress={exportar} disabled={exporting} style={{ marginTop: spacing.md, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', opacity: exporting ? 0.6 : 1 }}>
              <Text style={{ color: colors.accentContrast, fontWeight: '800' }}>{exporting ? 'Generando…' : '📄 Exportar PDF'}</Text>
            </TouchableOpacity>
          </Card>

          <Card>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, marginBottom: spacing.xs }}>🕘 Historial de paradas y averías</Text>
            {events.length === 0 ? (
              <Text style={{ color: colors.muted, fontSize: 12 }}>Sin paradas ni averías en el rango.</Text>
            ) : (
              events
                .slice()
                .sort((a, b) => new Date(b.startIso).getTime() - new Date(a.startIso).getTime())
                .map((e, i) => (
                  <View key={i} style={{ paddingVertical: spacing.xs, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
                    <Text style={{ color: e.tipo === 'averia' ? colors.danger : colors.warning, fontWeight: '800', fontSize: 13 }}>
                      {e.tipo === 'averia' ? '🔴 Avería' : '🟡 Parada'}{e.motivo ? ` — ${e.motivo}` : ''}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>
                      {dmyHm(e.startIso)} → {e.endIso ? dmyHm(e.endIso) : 'vigente'} · Total: {fmtDuration((e.endIso ? new Date(e.endIso).getTime() : Date.now()) - new Date(e.startIso).getTime())}
                    </Text>
                  </View>
                ))
            )}
          </Card>

          <Card>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, marginBottom: spacing.xs }}>✅ Días trabajados</Text>
            {workedDays.filter((d) => d.dayH + d.nightH > 0).length === 0 ? (
              <Text style={{ color: colors.muted, fontSize: 12 }}>Sin horas registradas en el rango.</Text>
            ) : (
              workedDays
                .filter((d) => d.dayH + d.nightH > 0)
                .slice()
                .sort((a, b) => (a.date < b.date ? 1 : -1))
                .map((d) => (
                  <View key={d.date} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                    <Text style={{ color: colors.text, fontSize: 12 }}>{dmy(d.date)}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>Día {d.dayH.toFixed(1)}h · Noche {d.nightH.toFixed(1)}h · Total {(d.dayH + d.nightH).toFixed(1)}h</Text>
                  </View>
                ))
            )}
          </Card>
        </>
      )}

      {!machineId ? <EmptyState title="Selecciona una máquina" subtitle="Elige un equipo y un rango de fechas para ver su trazabilidad." /> : null}
    </Screen>
  );
}
