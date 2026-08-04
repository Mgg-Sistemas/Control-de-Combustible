import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { supabase, selectAllRows } from '../../lib/supabase';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { cmpText, norm } from '../../lib/text';
import { useRealtimeRefresh } from '../../hooks/useRealtime';

/**
 * RESUMEN DE INSPECCIONES (rediseño) — dashboard analítico, autocontenido.
 * - Switch ☀️ DÍA / 🌙 NOCHE.
 * - KPIs: máquinas INICIADAS (del día elegido, por turno), PARADAS/no trabajó y
 *   AVERIADAS (vigentes).
 * - Gráfica de barras: máquinas iniciadas por día (últimos 14 días). Tocar una
 *   barra elige ese día y despliega el desglose POR INSPECTOR (solo los del turno
 *   elegido), buscable y colapsable.
 * Lee sus propios datos (machine_rounds + maintenance_requests + profiles); no
 * toca la lógica de SupervisionScreen. Se inserta arriba de esa vista.
 */

const CARACAS_TZ = 'America/Caracas';
function caracasToday(): string {
  const p: any = new Intl.DateTimeFormat('en-CA', { timeZone: CARACAS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((a: any, x: any) => { a[x.type] = x.value; return a; }, {});
  return `${p.year}-${p.month}-${p.day}`;
}
const shortDate = (iso: string) => { const [, m, d] = (iso || '').split('-'); return m && d ? `${d}/${m}` : iso; };

type Round = {
  machinery_id: string; round_date: string; day_hours: number | null; night_hours: number | null;
  jornada_shift: string | null; jornada_start_at: string | null; recorded_by: string | null; machine?: { code?: string } | null;
};

// ¿La ronda cuenta como jornada INICIADA? (arrancada o con horas). Mismo criterio
// que SupervisionScreen: r.jornada_start_at || worked > 0.
const roundStarted = (r: Round) => !!r.jornada_start_at || (Number(r.day_hours) || 0) > 0 || (Number(r.night_hours) || 0) > 0;
// Turno de la ronda: por jornada_shift; si falta, se infiere (noche si solo tiene
// horas de noche). Igual que inspectorReport → una ronda pertenece a UN turno.
const roundShift = (r: Round): 'day' | 'night' =>
  r.jornada_shift === 'night' ? 'night'
    : r.jornada_shift === 'day' ? 'day'
    : ((Number(r.night_hours) || 0) > 0 && (Number(r.day_hours) || 0) === 0 ? 'night' : 'day');
const startedForShift = (r: Round, sh: 'day' | 'night') => roundStarted(r) && roundShift(r) === sh;

export default function InspectionsSummary() {
  const { colors } = useTheme();
  const [shift, setShift] = useState<'day' | 'night'>('day');
  const [rounds, setRounds] = useState<Round[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [adminIds, setAdminIds] = useState<Set<string>>(new Set());
  const [paradaCount, setParadaCount] = useState(0);
  const [averiaCount, setAveriaCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selDay, setSelDay] = useState(caracasToday());
  const [inspQ, setInspQ] = useState('');
  const [openInsp, setOpenInsp] = useState<Set<string>>(new Set());
  const [showDrill, setShowDrill] = useState(true);

  // Últimos 14 días (antiguo → hoy).
  const days = useMemo(() => {
    const base = new Date(caracasToday() + 'T12:00:00Z');
    return Array.from({ length: 14 }, (_, i) => { const d = new Date(base); d.setUTCDate(d.getUTCDate() - (13 - i)); return d.toISOString().slice(0, 10); });
  }, []);
  const fromDate = days[0];

  const load = useCallback(async () => {
    const [profRes, roundsRows, maintRes] = await Promise.all([
      supabase.from('profiles').select('id, full_name, role'),
      selectAllRows('machine_rounds', 'machinery_id, round_date, day_hours, night_hours, jornada_shift, jornada_start_at, recorded_by, machine:machinery_id(code)', (q) => q.gte('round_date', fromDate)),
      supabase.from('maintenance_requests').select('machinery_id, material').eq('status', 'pendiente'),
    ]);
    const nm: Record<string, string> = {}; const admins = new Set<string>();
    ((profRes.data ?? []) as any[]).forEach((p) => { if (p.full_name) nm[p.id] = p.full_name; if (p.role === 'admin') admins.add(p.id); });
    setNames(nm); setAdminIds(admins);
    setRounds((roundsRows ?? []) as any);
    const aver = new Set<string>(); const parada = new Set<string>();
    ((maintRes.data ?? []) as any[]).forEach((m) => { if (m.material === 'MÁQUINA PARADA') parada.add(m.machinery_id); else aver.add(m.machinery_id); });
    setAveriaCount(aver.size);
    let pnt = 0; parada.forEach((id) => { if (!aver.has(id)) pnt++; }); // parada/no-trabajó = parada que NO es avería
    setParadaCount(pnt);
    setLoading(false);
  }, [fromDate]);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(['machine_rounds', 'maintenance_requests'], load);

  // Iniciadas por día (según turno).
  const perDay = useMemo(() => {
    const m = new Map<string, Set<string>>(); days.forEach((d) => m.set(d, new Set()));
    rounds.forEach((r) => { if (startedForShift(r, shift)) m.get(r.round_date)?.add(r.machinery_id); });
    return m;
  }, [rounds, shift, days]);

  const iniciadasSel = perDay.get(selDay)?.size ?? 0;
  const maxBar = Math.max(1, ...days.map((d) => perDay.get(d)?.size ?? 0));

  // Desglose por inspector para el día + turno elegidos.
  const byInspector = useMemo(() => {
    const m = new Map<string, { name: string; codes: string[] }>();
    rounds.filter((r) => r.round_date === selDay && startedForShift(r, shift) && r.recorded_by && !adminIds.has(r.recorded_by))
      .forEach((r) => {
        const key = r.recorded_by!;
        const e = m.get(key) ?? { name: names[key] ?? '—', codes: [] };
        const code = (r.machine as any)?.code || '—';
        if (!e.codes.includes(code)) e.codes.push(code);
        m.set(key, e);
      });
    return [...m.values()].map((v) => ({ ...v, codes: v.codes.sort(cmpText) })).sort((a, b) => b.codes.length - a.codes.length || cmpText(a.name, b.name));
  }, [rounds, selDay, shift, adminIds, names]);

  const inspFiltered = useMemo(() => {
    const nq = norm(inspQ.trim());
    return nq ? byInspector.filter((i) => norm(i.name).includes(nq)) : byInspector;
  }, [byInspector, inspQ]);

  const toggleInsp = (name: string) => setOpenInsp((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; });

  const shiftIcon = shift === 'day' ? '☀️' : '🌙';
  const shiftLbl = shift === 'day' ? 'DÍA' : 'NOCHE';

  const Kpi = ({ label, value, tone }: { label: string; value: number; tone: 'brand' | 'warn' | 'crit' }) => {
    const fg = tone === 'brand' ? colors.brandText : tone === 'warn' ? colors.accentSoftText : colors.dangerSoftText;
    const bg = tone === 'brand' ? colors.surface : tone === 'warn' ? colors.accentSoftBg : colors.dangerSoftBg;
    return (
      <View style={{ flex: 1, backgroundColor: bg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
        <Text style={{ color: fg, fontWeight: '900', fontSize: 26, fontVariant: ['tabular-nums'] as any }}>{value}</Text>
        <Text style={{ color: colors.muted, fontSize: 10.5, fontWeight: '700', textAlign: 'center', marginTop: 2 }} numberOfLines={2}>{label}</Text>
      </View>
    );
  };

  return (
    <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden', marginBottom: spacing.md }}>
      {/* Cabecera navy + switch de turno. */}
      <View style={{ backgroundColor: colors.brand, paddingHorizontal: spacing.md, paddingVertical: spacing.md }}>
        <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 16, letterSpacing: 0.4 }}>RESUMEN DE INSPECCIONES</Text>
        <View style={{ flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: radius.pill, padding: 3, marginTop: spacing.sm }}>
          {(['day', 'night'] as const).map((s) => {
            const on = shift === s;
            return (
              <TouchableOpacity key={s} onPress={() => setShift(s)} style={{ flex: 1, paddingVertical: 8, borderRadius: radius.pill, alignItems: 'center', backgroundColor: on ? colors.brandContrast : 'transparent' }}>
                <Text style={{ color: on ? colors.brand : colors.brandContrast, fontWeight: '900', fontSize: 13 }}>{s === 'day' ? '☀️ DÍA' : '🌙 NOCHE'}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {loading ? (
        <View style={{ padding: spacing.xl, alignItems: 'center' }}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <View style={{ padding: spacing.md }}>
          {/* KPIs. */}
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Kpi label={`Iniciadas ${shiftIcon} (${shortDate(selDay)})`} value={iniciadasSel} tone="brand" />
            <Kpi label="Paradas / no trabajó" value={paradaCount} tone="warn" />
            <Kpi label="Averiadas" value={averiaCount} tone="crit" />
          </View>

          {/* Gráfica de barras: iniciadas por día (tocar una elige el día). */}
          <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 13, marginTop: spacing.md, marginBottom: spacing.xs, letterSpacing: 0.3 }}>
            📊 MÁQUINAS INICIADAS POR DÍA · {shiftIcon} {shiftLbl}
          </Text>
          <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.sm }}>Toca un día para ver el desglose por inspector.</Text>
          <View style={{ gap: 5 }}>
            {[...days].reverse().map((d) => {
              const n = perDay.get(d)?.size ?? 0;
              const sel = d === selDay;
              return (
                <TouchableOpacity key={d} onPress={() => setSelDay(d)} activeOpacity={0.7}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
                    <Text style={{ color: sel ? colors.brandText : colors.text, fontWeight: sel ? '900' : '600', fontSize: 12 }}>{shortDate(d)}{sel ? '  ◀' : ''}</Text>
                    <Text style={{ color: sel ? colors.brandText : colors.muted, fontWeight: '800', fontSize: 12, fontVariant: ['tabular-nums'] as any }}>{n}</Text>
                  </View>
                  <View style={{ height: 12, backgroundColor: colors.tankTrack, borderRadius: radius.pill, overflow: 'hidden' }}>
                    <View style={{ height: 12, width: `${Math.max(2, (n / maxBar) * 100)}%`, backgroundColor: sel ? colors.accent : colors.tankFill, borderRadius: radius.pill }} />
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Desglose por inspector (colapsable + buscable). */}
          <TouchableOpacity onPress={() => setShowDrill((v) => !v)} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 13, letterSpacing: 0.3 }}>👷 INSPECTORES · {shortDate(selDay)} · {shiftIcon} {shiftLbl}</Text>
            <Text style={{ color: colors.muted, fontWeight: '900', fontSize: 16 }}>{showDrill ? '▴' : '▾'}</Text>
          </TouchableOpacity>

          {showDrill ? (
            <View style={{ marginTop: spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, marginBottom: spacing.sm }}>
                <Text style={{ fontSize: 14 }}>🔎</Text>
                <TextInput value={inspQ} onChangeText={setInspQ} placeholder="Buscar inspector…" placeholderTextColor={colors.muted} style={{ flex: 1, color: colors.text, fontSize: 13, paddingVertical: 8 }} />
                {inspQ ? <TouchableOpacity onPress={() => setInspQ('')}><Text style={{ color: colors.muted, fontWeight: '800' }}>✕</Text></TouchableOpacity> : null}
              </View>

              {inspFiltered.length === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 12.5, paddingVertical: spacing.md, textAlign: 'center' }}>
                  Sin inspectores {shiftIcon} con máquinas iniciadas el {shortDate(selDay)}.
                </Text>
              ) : (
                inspFiltered.map((ins) => {
                  const open = openInsp.has(ins.name);
                  return (
                    <View key={ins.name} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, marginBottom: spacing.xs, overflow: 'hidden' }}>
                      <TouchableOpacity onPress={() => toggleInsp(ins.name)} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.sm, backgroundColor: colors.surfaceAlt }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flex: 1 }}>
                          <Text style={{ color: colors.muted, fontSize: 13 }}>{open ? '▾' : '▸'}</Text>
                          <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '800', fontSize: 13.5, flex: 1 }}>{ins.name}</Text>
                        </View>
                        <View style={{ backgroundColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
                          <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 12 }}>{ins.codes.length}</Text>
                        </View>
                      </TouchableOpacity>
                      {open ? (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, padding: spacing.sm }}>
                          {ins.codes.map((c) => (
                            <View key={c} style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 3 }}>
                              <Text style={{ color: colors.text, fontSize: 11.5, fontWeight: '600' }}>{c}</Text>
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  );
                })
              )}
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}
