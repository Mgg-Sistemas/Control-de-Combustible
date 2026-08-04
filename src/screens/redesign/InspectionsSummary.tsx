import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, ScrollView, Modal, Pressable } from 'react-native';
import { supabase, selectAllRows } from '../../lib/supabase';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { cmpText, norm } from '../../lib/text';
import { useRealtimeRefresh } from '../../hooks/useRealtime';
import { listInspectorAssignments } from '../../lib/machineInspectors';
import { generateInspectorReport } from '../../lib/inspectorReport';
import { DateField } from '../../components/DateField';

/**
 * RESUMEN DE INSPECCIONES (rediseño) — dashboard analítico, autocontenido.
 * - Switch ☀️ DÍA / 🌙 NOCHE.
 * - KPIs del DÍA elegido (sincronizan al tocar otro día): INICIADAS, PENDIENTES por
 *   iniciar, PARADAS/no trabajó y AVERIADAS.
 * - Gráfica de barras (horizontal): iniciadas por día (14 días); tocar una barra
 *   elige ese día.
 * - Gráfica de barras VERTICALES por inspector (del turno): tocar un inspector
 *   muestra sus mismos 4 datos + sus máquinas por categoría.
 * Lee machine_rounds + maintenance_requests + profiles + asignaciones; no toca la
 * lógica de SupervisionScreen. Se inserta arriba de esa vista.
 */

const CARACAS_TZ = 'America/Caracas';
function caracasToday(): string {
  const p: any = new Intl.DateTimeFormat('en-CA', { timeZone: CARACAS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((a: any, x: any) => { a[x.type] = x.value; return a; }, {});
  return `${p.year}-${p.month}-${p.day}`;
}
const shortDate = (iso: string) => { const [, m, d] = (iso || '').split('-'); return m && d ? `${d}/${m}` : iso; };
// Turno de una PARADA por la hora (Caracas) en que se marcó: día 7-19, resto noche.
const paradaShiftOf = (iso: string): 'day' | 'night' => { const d = new Date(iso); let h = d.getUTCHours() - 4; if (h < 0) h += 24; return h >= 7 && h < 19 ? 'day' : 'night'; };

type Round = {
  machinery_id: string; round_date: string; day_hours: number | null; night_hours: number | null;
  jornada_shift: string | null; jornada_start_at: string | null; recorded_by: string | null; machine?: { code?: string } | null;
};
type Maint = { machinery_id: string; material: string | null; created_at: string; machine?: { code?: string } | null };
type Assign = { machinery_id: string; inspector_name: string | null; shift: 'day' | 'night'; code: string };

// ¿La ronda cuenta como jornada INICIADA? (arrancada o con horas). Igual que SupervisionScreen.
const roundStarted = (r: Round) => !!r.jornada_start_at || (Number(r.day_hours) || 0) > 0 || (Number(r.night_hours) || 0) > 0;
// Turno de la ronda (una ronda pertenece a UN turno). Igual que inspectorReport.
const roundShift = (r: Round): 'day' | 'night' =>
  r.jornada_shift === 'night' ? 'night'
    : r.jornada_shift === 'day' ? 'day'
    : ((Number(r.night_hours) || 0) > 0 && (Number(r.day_hours) || 0) === 0 ? 'night' : 'day');
const startedForShift = (r: Round, sh: 'day' | 'night') => roundStarted(r) && roundShift(r) === sh;

export default function InspectionsSummary({ date, onDateChange }: { date?: string; onDateChange?: (d: string) => void } = {}) {
  const { colors } = useTheme();
  const [shift, setShift] = useState<'day' | 'night'>('day');
  const [rounds, setRounds] = useState<Round[]>([]);
  const [maint, setMaint] = useState<Maint[]>([]);
  const [assignments, setAssignments] = useState<Assign[]>([]);
  const [loading, setLoading] = useState(true);
  // El día visible puede venir CONTROLADO por la pantalla padre (para compartir la
  // misma fecha con la lista de rondas de abajo); si no, se maneja internamente.
  const [internalDay, setInternalDay] = useState(caracasToday());
  const selDay = date ?? internalDay;
  const setSelDay = useCallback((d: string) => { if (onDateChange) onDateChange(d); else setInternalDay(d); }, [onDateChange]);
  // Navegar ±1 día (sin pasar de hoy). Al cambiar el día se limpia el inspector abierto.
  const shiftDay = (delta: number) => {
    const d = new Date(selDay + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    const iso = d.toISOString().slice(0, 10);
    const today = caracasToday();
    setSelDay(iso > today ? today : iso);
    setSelInsp(null);
  };
  const [inspQ, setInspQ] = useState('');
  const [selInsp, setSelInsp] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null); // '' = general, o el nombre del inspector

  // Genera el REPORTE OFICIAL de inspectores (PDF con firma) para el día + turno.
  // `inspector` opcional: solo ese inspector; si no, todos los del turno.
  const makeReport = async (inspector?: string) => {
    setPdfBusy(inspector ?? '');
    try {
      await generateInspectorReport({ date: selDay, shift, inspectors: inspector ? [inspector] : null });
    } finally {
      setPdfBusy(null);
    }
  };

  // Últimos 14 días (antiguo → hoy).
  const days = useMemo(() => {
    const base = new Date(caracasToday() + 'T12:00:00Z');
    return Array.from({ length: 14 }, (_, i) => { const d = new Date(base); d.setUTCDate(d.getUTCDate() - (13 - i)); return d.toISOString().slice(0, 10); });
  }, []);
  const fromDate = days[0];

  const load = useCallback(async () => {
    // Cubre los 14 días de la gráfica y, si el día elegido es más antiguo, también ese
    // (para que los KPIs del día no queden en 0 al navegar a una fecha vieja).
    const minDate = selDay < fromDate ? selDay : fromDate;
    const [roundsRows, maintRes, asg] = await Promise.all([
      selectAllRows('machine_rounds', 'machinery_id, round_date, day_hours, night_hours, jornada_shift, jornada_start_at, recorded_by, machine:machinery_id(code)', (q) => q.gte('round_date', minDate)),
      supabase.from('maintenance_requests').select('machinery_id, material, created_at, machine:machinery_id(code)').eq('status', 'pendiente'),
      listInspectorAssignments(),
    ]);
    setRounds((roundsRows ?? []) as any);
    setMaint((maintRes.data ?? []) as any);
    setAssignments(((asg?.rows ?? []) as any[]).map((a) => ({ machinery_id: a.machinery_id, inspector_name: a.inspector_name ?? '—', shift: a.shift, code: a.code ?? '—' })));
    setLoading(false);
  }, [fromDate, selDay]);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(['machine_rounds', 'maintenance_requests', 'machine_inspectors'], load);

  // Iniciadas por día (según turno) para la gráfica de días.
  const perDay = useMemo(() => {
    const m = new Map<string, Set<string>>(); days.forEach((d) => m.set(d, new Set()));
    rounds.forEach((r) => { if (startedForShift(r, shift)) m.get(r.round_date)?.add(r.machinery_id); });
    return m;
  }, [rounds, shift, days]);
  const maxBar = Math.max(1, ...days.map((d) => perDay.get(d)?.size ?? 0));

  // Conjuntos de estado para el DÍA + TURNO elegidos.
  const daySets = useMemo(() => {
    // Iniciadas del día elegido, directo de las rondas (robusto aunque el día quede
    // fuera de la ventana de 14 días de la gráfica).
    const startedSet = new Set<string>();
    rounds.forEach((r) => { if (r.round_date === selDay && startedForShift(r, shift)) startedSet.add(r.machinery_id); });
    const dayStartMs = new Date(selDay + 'T00:00:00-04:00').getTime();
    const dayEndMs = new Date(selDay + 'T23:59:59.999-04:00').getTime();
    const averSet = new Set<string>();
    maint.forEach((m) => { if (m.material !== 'MÁQUINA PARADA' && new Date(m.created_at).getTime() <= dayEndMs) averSet.add(m.machinery_id); });
    const paradaSet = new Set<string>();
    maint.forEach((m) => {
      if (m.material !== 'MÁQUINA PARADA') return;
      const t = new Date(m.created_at).getTime();
      if (t > dayEndMs || averSet.has(m.machinery_id)) return; // avería tiene su propia categoría
      const arr = t < dayStartMs; // marcada antes del día = arrastrada (aplica si no trabaja hoy)
      const applies = arr ? !startedSet.has(m.machinery_id) : paradaShiftOf(m.created_at) === shift;
      if (applies) paradaSet.add(m.machinery_id);
    });
    const assignedShift = new Set(assignments.filter((a) => a.shift === shift).map((a) => a.machinery_id));
    return { startedSet, paradaSet, averSet, assignedShift };
  }, [rounds, selDay, shift, maint, assignments]);

  // KPIs del día (totales).
  const top = useMemo(() => {
    const { startedSet, paradaSet, averSet, assignedShift } = daySets;
    let pend = 0; assignedShift.forEach((id) => { if (!startedSet.has(id) && !paradaSet.has(id) && !averSet.has(id)) pend++; });
    return { iniciadas: startedSet.size, pendientes: pend, paradas: paradaSet.size, averiadas: averSet.size };
  }, [daySets]);

  // Código de máquina por id (de asignaciones, rondas o mantenimiento).
  const codeById = useMemo(() => {
    const m = new Map<string, string>();
    assignments.forEach((a) => { if (a.code) m.set(a.machinery_id, a.code); });
    rounds.forEach((r) => { const c = (r.machine as any)?.code; if (c && !m.has(r.machinery_id)) m.set(r.machinery_id, c); });
    maint.forEach((x) => { const c = (x.machine as any)?.code; if (c && !m.has(x.machinery_id)) m.set(x.machinery_id, c); });
    return m;
  }, [assignments, rounds, maint]);

  // Códigos de máquina por estado (para la lista al tocar una KPI de arriba).
  const topCodes = useMemo(() => {
    const { startedSet, paradaSet, averSet, assignedShift } = daySets;
    const codeOf = (id: string) => codeById.get(id) || '—';
    const pendIds: string[] = [];
    assignedShift.forEach((id) => { if (!startedSet.has(id) && !paradaSet.has(id) && !averSet.has(id)) pendIds.push(id); });
    const s = (ids: Iterable<string>) => [...ids].map(codeOf).sort(cmpText);
    return { ini: s(startedSet), pend: s(pendIds), par: s(paradaSet), ave: s(averSet) };
  }, [daySets, codeById]);

  // Modal de LISTA de máquinas de un estado (filtrable).
  const [listModal, setListModal] = useState<{ title: string; codes: string[] } | null>(null);
  const [listQ, setListQ] = useState('');
  const openList = (title: string, codes: string[]) => { setListQ(''); setListModal({ title, codes }); };
  const listShown = useMemo(() => {
    if (!listModal) return [];
    const nq = norm(listQ.trim());
    return nq ? listModal.codes.filter((c) => norm(c).includes(nq)) : listModal.codes;
  }, [listModal, listQ]);

  // Desglose por INSPECTOR (asignaciones del turno como columna vertebral).
  const perInspector = useMemo(() => {
    const { startedSet, paradaSet, averSet } = daySets;
    const byName = new Map<string, { name: string; ids: Set<string>; code: Map<string, string> }>();
    assignments.filter((a) => a.shift === shift).forEach((a) => {
      const nm = a.inspector_name || '—';
      const e = byName.get(nm) ?? { name: nm, ids: new Set<string>(), code: new Map<string, string>() };
      e.ids.add(a.machinery_id); e.code.set(a.machinery_id, a.code || '—');
      byName.set(nm, e);
    });
    return [...byName.values()].map((e) => {
      const ini: string[] = [], pend: string[] = [], par: string[] = [], ave: string[] = [];
      e.ids.forEach((id) => {
        const c = e.code.get(id) || '—';
        if (startedSet.has(id)) ini.push(c);          // iniciada gana (trabajó)
        else if (averSet.has(id)) ave.push(c);
        else if (paradaSet.has(id)) par.push(c);
        else pend.push(c);
      });
      const s = (a: string[]) => a.sort(cmpText);
      return { name: e.name, ini: s(ini), pend: s(pend), par: s(par), ave: s(ave), total: e.ids.size };
    }).sort((a, b) => b.ini.length - a.ini.length || cmpText(a.name, b.name));
  }, [assignments, shift, daySets]);

  const inspShown = useMemo(() => {
    const nq = norm(inspQ.trim());
    return nq ? perInspector.filter((i) => norm(i.name).includes(nq)) : perInspector;
  }, [perInspector, inspQ]);
  const maxInsp = Math.max(1, ...inspShown.map((i) => i.ini.length));
  const sel = selInsp ? perInspector.find((i) => i.name === selInsp) ?? null : null;

  const shiftIcon = shift === 'day' ? '☀️' : '🌙';
  const shiftLbl = shift === 'day' ? 'DÍA' : 'NOCHE';

  const KpiCard = ({ label, value, tone, onPress }: { label: string; value: number; tone: 'brand' | 'muted' | 'warn' | 'crit'; onPress?: () => void }) => {
    const map = {
      brand: { fg: colors.brandText, bg: colors.surface },
      muted: { fg: colors.muted, bg: colors.surfaceAlt },
      warn: { fg: colors.accentSoftText, bg: colors.accentSoftBg },
      crit: { fg: colors.dangerSoftText, bg: colors.dangerSoftBg },
    } as const;
    const t = map[tone];
    const Comp: any = onPress ? TouchableOpacity : View;
    return (
      <Comp onPress={onPress} activeOpacity={0.7} style={{ flex: 1, backgroundColor: t.bg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
        <Text style={{ color: t.fg, fontWeight: '900', fontSize: 24, fontVariant: ['tabular-nums'] as any }}>{value}</Text>
        <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700', textAlign: 'center', marginTop: 2 }} numberOfLines={2}>{label}{onPress ? ' ›' : ''}</Text>
      </Comp>
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
              <TouchableOpacity key={s} onPress={() => { setShift(s); setSelInsp(null); }} style={{ flex: 1, paddingVertical: 8, borderRadius: radius.pill, alignItems: 'center', backgroundColor: on ? colors.brandContrast : 'transparent' }}>
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
          {/* Navegador de FECHA (arriba, junto a las gráficas). Controla los KPIs, las
              barras y la lista de rondas de abajo (misma fecha en todo). */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md }}>
            <TouchableOpacity onPress={() => shiftDay(-1)} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.background }}>
              <Text style={{ color: colors.brandText, fontWeight: '800' }}>◀</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <DateField value={selDay} onChange={(d) => { setSelDay(d); setSelInsp(null); }} maxISO={caracasToday()} />
            </View>
            <TouchableOpacity onPress={() => shiftDay(1)} disabled={selDay >= caracasToday()} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.background, opacity: selDay >= caracasToday() ? 0.4 : 1 }}>
              <Text style={{ color: colors.brandText, fontWeight: '800' }}>▶</Text>
            </TouchableOpacity>
          </View>

          {/* KPIs del día elegido. */}
          <View style={{ flexDirection: 'row', gap: spacing.xs }}>
            <KpiCard label={`Iniciadas ${shiftIcon} (${shortDate(selDay)})`} value={top.iniciadas} tone="brand" onPress={() => openList(`✅ Iniciadas · ${shortDate(selDay)} ${shiftIcon}`, topCodes.ini)} />
            <KpiCard label="Pendientes por iniciar" value={top.pendientes} tone="muted" onPress={() => openList(`⏳ Pendientes por iniciar · ${shortDate(selDay)} ${shiftIcon}`, topCodes.pend)} />
            <KpiCard label="Paradas / no trabajó" value={top.paradas} tone="warn" onPress={() => openList(`🟡 Paradas / no trabajó · ${shortDate(selDay)} ${shiftIcon}`, topCodes.par)} />
            <KpiCard label="Averiadas" value={top.averiadas} tone="crit" onPress={() => openList(`🔴 Averiadas · ${shortDate(selDay)} ${shiftIcon}`, topCodes.ave)} />
          </View>

          {/* Gráfica horizontal: iniciadas por día. */}
          <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 13, marginTop: spacing.md, marginBottom: spacing.xs, letterSpacing: 0.3 }}>
            📊 MÁQUINAS INICIADAS POR DÍA · {shiftIcon} {shiftLbl}
          </Text>
          <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.sm }}>Toca un día para sincronizar los datos y ver el desglose.</Text>
          <View style={{ gap: 5 }}>
            {[...days].reverse().map((d) => {
              const n = perDay.get(d)?.size ?? 0;
              const on = d === selDay;
              return (
                <TouchableOpacity key={d} onPress={() => { setSelDay(d); setSelInsp(null); }} activeOpacity={0.7}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
                    <Text style={{ color: on ? colors.brandText : colors.text, fontWeight: on ? '900' : '600', fontSize: 12 }}>{shortDate(d)}{on ? '  ◀' : ''}</Text>
                    <Text style={{ color: on ? colors.brandText : colors.muted, fontWeight: '800', fontSize: 12, fontVariant: ['tabular-nums'] as any }}>{n}</Text>
                  </View>
                  <View style={{ height: 12, backgroundColor: colors.tankTrack, borderRadius: radius.pill, overflow: 'hidden' }}>
                    <View style={{ height: 12, width: `${Math.max(2, (n / maxBar) * 100)}%`, backgroundColor: on ? colors.accent : colors.tankFill, borderRadius: radius.pill }} />
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Barras VERTICALES por inspector (del turno). Tocar → detalle. */}
          <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 13, marginTop: spacing.md, marginBottom: spacing.xs, letterSpacing: 0.3, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
            👷 POR INSPECTOR · {shortDate(selDay)} · {shiftIcon} {shiftLbl}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, marginBottom: spacing.sm }}>
            <Text style={{ fontSize: 14 }}>🔎</Text>
            <TextInput value={inspQ} onChangeText={setInspQ} placeholder="Buscar inspector…" placeholderTextColor={colors.muted} style={{ flex: 1, color: colors.text, fontSize: 13, paddingVertical: 8 }} />
            {inspQ ? <TouchableOpacity onPress={() => setInspQ('')}><Text style={{ color: colors.muted, fontWeight: '800' }}>✕</Text></TouchableOpacity> : null}
          </View>

          {inspShown.length === 0 ? (
            <Text style={{ color: colors.muted, fontSize: 12.5, paddingVertical: spacing.md, textAlign: 'center' }}>Sin inspectores {shiftIcon} para el {shortDate(selDay)}.</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.xs, alignItems: 'flex-end' }}>
              {inspShown.map((ins) => {
                const on = ins.name === selInsp;
                const h = Math.max(6, (ins.ini.length / maxInsp) * 96);
                return (
                  <TouchableOpacity key={ins.name} onPress={() => setSelInsp(on ? null : ins.name)} activeOpacity={0.7} style={{ width: 58, alignItems: 'center' }}>
                    <Text style={{ color: on ? colors.brandText : colors.text, fontWeight: '900', fontSize: 12, marginBottom: 2, fontVariant: ['tabular-nums'] as any }}>{ins.ini.length}</Text>
                    <View style={{ height: 96, width: 26, backgroundColor: colors.tankTrack, borderRadius: 6, justifyContent: 'flex-end', overflow: 'hidden', borderWidth: on ? 2 : 0, borderColor: colors.accent }}>
                      <View style={{ height: h, width: '100%', backgroundColor: on ? colors.accent : colors.tankFill }} />
                    </View>
                    <Text numberOfLines={2} style={{ color: on ? colors.brandText : colors.muted, fontSize: 9.5, fontWeight: on ? '800' : '600', textAlign: 'center', marginTop: 4, height: 24 }}>{ins.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {/* Detalle del inspector elegido: los MISMOS 4 datos, por inspector. */}
          {sel ? (
            <View style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.background }}>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 14, marginBottom: spacing.sm }}>👷 {sel.name} <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 12 }}>· {sel.total} asignada(s)</Text></Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <KpiCard label="Iniciadas" value={sel.ini.length} tone="brand" onPress={() => openList(`✅ Iniciadas · ${sel.name}`, sel.ini)} />
                <KpiCard label="Pendientes" value={sel.pend.length} tone="muted" onPress={() => openList(`⏳ Pendientes · ${sel.name}`, sel.pend)} />
                <KpiCard label="Paradas" value={sel.par.length} tone="warn" onPress={() => openList(`🟡 Paradas · ${sel.name}`, sel.par)} />
                <KpiCard label="Averiadas" value={sel.ave.length} tone="crit" onPress={() => openList(`🔴 Averiadas · ${sel.name}`, sel.ave)} />
              </View>
              {/* Reporte OFICIAL con FIRMA de SOLO este inspector. */}
              <TouchableOpacity onPress={() => makeReport(sel.name)} disabled={pdfBusy !== null} activeOpacity={0.85} style={{ marginTop: spacing.sm, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 10, alignItems: 'center', opacity: pdfBusy !== null ? 0.6 : 1 }}>
                <Text style={{ color: colors.accentContrast, fontWeight: '900', fontSize: 12.5 }}>{pdfBusy === sel.name ? 'Generando…' : `📄 Reporte de ${sel.name} (con firma)`}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={{ color: colors.muted, fontSize: 11.5, textAlign: 'center', marginTop: spacing.xs }}>Toca la barra de un inspector para ver sus máquinas por estado.</Text>
          )}
        </View>
      )}

      {/* Lista filtrable de máquinas del estado que se tocó (KPI de arriba o de inspector). */}
      <Modal visible={listModal != null} transparent animationType="slide" onRequestClose={() => setListModal(null)}>
        <Pressable onPress={() => setListModal(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '82%', padding: spacing.lg }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.sm }}>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15, flex: 1 }} numberOfLines={2}>{listModal?.title} ({listModal?.codes.length ?? 0})</Text>
              <TouchableOpacity onPress={() => setListModal(null)} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>Cerrar ✕</Text>
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, marginBottom: spacing.sm }}>
              <Text style={{ fontSize: 14 }}>🔎</Text>
              <TextInput value={listQ} onChangeText={setListQ} placeholder="Filtrar máquina…" placeholderTextColor={colors.muted} style={{ flex: 1, color: colors.text, fontSize: 14, paddingVertical: 9 }} />
              {listQ ? <TouchableOpacity onPress={() => setListQ('')}><Text style={{ color: colors.muted, fontWeight: '800' }}>✕</Text></TouchableOpacity> : null}
            </View>
            <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
              {listShown.length === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center', paddingVertical: spacing.lg }}>Sin máquinas.</Text>
              ) : (
                listShown.map((c, i) => (
                  <View key={`${c}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 9, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border }}>
                    <Text style={{ color: colors.muted, fontSize: 12, width: 28, textAlign: 'right', fontVariant: ['tabular-nums'] as any }}>{i + 1}</Text>
                    <Text style={{ color: colors.text, fontSize: 13.5, fontWeight: '700', flex: 1 }}>{c}</Text>
                  </View>
                ))
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
