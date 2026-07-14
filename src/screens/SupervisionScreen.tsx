import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Screen, Card, SectionTitle, Loading, EmptyState } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import { supabase } from '../lib/supabase';
import { listVisits, VisitRow } from '../lib/supervisorVisits';
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

/**
 * Módulo de SUPERVISIÓN (para el jefe): traza de las rondas de los supervisores
 * en un día. Muestra quién visitó qué máquina, a qué hora, con qué estado y qué
 * tan cerca estaba. Y lo clave: las JORNADAS SIN VALIDAR — máquinas que
 * trabajaron ese día pero que ningún supervisor marcó (regla: el operador no
 * cobra). Así el jefe evalúa la cobertura de cada supervisor.
 */
export default function SupervisionScreen() {
  const { colors } = useTheme();
  const [date, setDate] = useState(caracasToday());
  const [loading, setLoading] = useState(true);
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [vs, { data: rs }] = await Promise.all([
      listVisits(date),
      supabase
        .from('machine_rounds')
        .select('machinery_id, day_hours, night_hours, day_operator, night_operator, machine:machinery_id(code, company:company_id(name))')
        .eq('round_date', date),
    ]);
    setVisits(vs);
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

  const shiftDay = (delta: number) => {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    setDate(d.toISOString().slice(0, 10));
  };

  const visitedIds = useMemo(() => new Set(visits.map((v) => v.machinery_id)), [visits]);
  const unvalidated = useMemo(() => rounds.filter((r) => !visitedIds.has(r.machinery_id)), [rounds, visitedIds]);
  const validated = rounds.length - unvalidated.length;

  // Traza agrupada por supervisor.
  const bySupervisor = useMemo(() => {
    const map = new Map<string, VisitRow[]>();
    visits.forEach((v) => {
      const k = v.supervisor_name || '—';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(v);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [visits]);

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
      <SectionTitle>🪖 Supervisión — rondas del día</SectionTitle>

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
          {kpi('Visitas', visits.length, colors.text)}
          {kpi('Jornadas validadas', validated, colors.success)}
          {kpi('Sin validar', unvalidated.length, unvalidated.length > 0 ? colors.danger : colors.success)}
        </View>
      </Card>

      {/* ── JORNADAS SIN VALIDAR (el operador no cobra) ── */}
      <SectionTitle>⛔ Jornadas sin validar</SectionTitle>
      <Card>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
          Máquinas que trabajaron este día pero que <Text style={{ fontWeight: '800', color: colors.danger }}>ningún supervisor marcó</Text>. Regla: sin visita, el operador no cobra.
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

      {/* ── TRAZA POR SUPERVISOR ── */}
      <SectionTitle>Traza por supervisor</SectionTitle>
      {bySupervisor.length === 0 ? (
        <EmptyState title="Sin visitas este día" subtitle="Ningún supervisor marcó máquinas en la fecha elegida." />
      ) : (
        bySupervisor.map(([name, list]) => (
          <Card key={name}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>👮 {name}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{list.length} máquina(s)</Text>
            </View>
            {list.map((v) => {
              const sm = STATUS_META[v.status];
              return (
                <View key={v.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{v.machineCode} <Text style={{ color: colors.muted, fontWeight: '400' }}>· {v.companyName}</Text></Text>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>
                      {caracasClock(v.visited_at)} · {sm.icon} {sm.label}
                      {v.distance_m != null ? ` · a ~${v.distance_m} m ${v.near ? '(en sitio ✓)' : '(lejos ⚠️)'}` : ' · sin GPS'}
                    </Text>
                    {v.note ? <Text style={{ color: colors.muted, fontSize: 11, fontStyle: 'italic' }}>“{v.note}”</Text> : null}
                  </View>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: v.near === false ? colors.warning : sm.color }} />
                </View>
              );
            })}
          </Card>
        ))
      )}
      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}
