import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, Pressable, ScrollView } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, SkeletonList } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { caracasBusinessToday, caracasNowShift } from '../lib/caracasDay';
import { buildDaySets, computeMachineVisibilitySets, DaySetRound, DaySetMaint, DaySetAssign } from '../lib/inspectorDaySets';
import { listInspectorAssignments } from '../lib/machineInspectors';
import { listOperatorAssignments, assignOperator, unassignOperator, Shift, shiftIcon, shiftLabel, OperatorAssignmentRow } from '../lib/machineOperators';
import { isOperatorCargo } from '../lib/jornada';
import { pairMarks } from '../lib/attendance';
import { norm, cmpText } from '../lib/text';
import { pdfDocument, exportPdf } from '../lib/pdf';
import { logAudit } from '../lib/audit';

type MachRow = {
  id: string; code: string; plate: string | null; serial: string | null; tipo: string | null;
  companyName: string; sector: string | null; encargado: string | null;
  active: boolean | null; operational: boolean | null; en_espera: boolean | null;
};
type Operator = { id: string; name: string; cedula: string | null; cargo: string | null };

type MachineState = 'averia' | 'parada' | 'activa' | 'cerrada' | 'pendiente';
const STATE_META: Record<MachineState, { label: string; bg: string; text: (c: any) => string }> = {
  averia: { label: 'Avería', bg: 'dangerSoftBg', text: (c) => c.dangerSoftText },
  parada: { label: 'Parada', bg: 'warningSoftBg', text: (c) => c.warningSoftText },
  activa: { label: 'Activa', bg: 'successSoftBg', text: (c) => c.successSoftText },
  cerrada: { label: 'Cerrada', bg: 'infoSoftBg', text: (c) => c.infoSoftText },
  pendiente: { label: 'Pendiente', bg: 'infoSoftBg', text: (c) => c.infoSoftText },
};

type Row = {
  id: string; code: string; plate: string | null; serial: string | null; tipo: string | null;
  companyName: string; sector: string | null;
  state: MachineState;
  planned: OperatorAssignmentRow | null;
  liveName: string | null;
  liveOpen: boolean;
  mismatch: boolean;
  attendance: 'ok' | 'no' | 'out' | null;
  attendanceTs: string | null;
};

const CARACAS_TZ = 'America/Caracas';
function fmtHora(ts: string): string {
  return new Intl.DateTimeFormat('es-VE', { timeZone: CARACAS_TZ, hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(ts));
}

/**
 * Vista de máquinas para el COORDINADOR DE OPERADORES: mismo motor de estado
 * (`buildDaySets`) que "Inspecciones" pero organizado por máquina en vez de
 * por persona. Por cada máquina: estado en vivo, operador PLANEADO (nuevo,
 * `machine_operators`) vs. el que de verdad está en sitio (`machine_rounds`),
 * y su asistencia del día — para asignar/reasignar, detectar máquinas sin
 * cubrir y avisar novedades hacia arriba (Coordinador de Operaciones/Jefe).
 */
export default function CoordinadorOperadoresScreen() {
  const { colors } = useTheme();
  const { session } = useAuth();
  const uid = session?.user?.id ?? '';
  const today = caracasBusinessToday();

  const [shift, setShift] = useState<Shift>(caracasNowShift);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'maquinas' | 'sinasignar' | 'novedades'>('maquinas');

  const [machList, setMachList] = useState<MachRow[]>([]);
  // `DaySetRound` + operador día/noche: `buildDaySets` solo necesita los campos de
  // `DaySetRound`, pero `liveByMachine` (abajo) necesita también day_operator/
  // night_operator para saber quién está EN SITIO ahora mismo.
  const [rounds, setRounds] = useState<(DaySetRound & { day_operator: string | null; night_operator: string | null })[]>([]);
  const [maint, setMaint] = useState<DaySetMaint[]>([]);
  const [inspectorAssigns, setInspectorAssigns] = useState<DaySetAssign[]>([]);
  const [planned, setPlanned] = useState<OperatorAssignmentRow[]>([]);
  const [plannedMissing, setPlannedMissing] = useState(false);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [attendanceByEmp, setAttendanceByEmp] = useState<Record<string, { kind: 'entrada' | 'salida'; ts: string }[]>>({});

  const load = useCallback(async () => {
    const [{ data: machs }, { data: rs }, { data: mr }, insp, { rows: op, missing }, { data: emps }, { data: att }] = await Promise.all([
      supabase.from('machinery').select('id, code, plate, serial, tipo, sector, active, operational, en_espera, encargado, company:company_id(name)').eq('active', true),
      supabase.from('machine_rounds').select('machinery_id, round_date, day_hours, night_hours, day_operator, night_operator, jornada_shift, jornada_start_at').eq('round_date', today),
      supabase.from('maintenance_requests').select('machinery_id, material, notes, created_at').eq('status', 'pendiente'),
      listInspectorAssignments(),
      listOperatorAssignments(),
      supabase.from('employees').select('id, first_name, last_name, cedula, cargo').eq('status', 'activo'),
      supabase.from('attendance').select('employee_id, kind, ts').eq('work_date', today),
    ]);
    setMachList(((machs ?? []) as any[]).map((m) => ({
      id: m.id, code: m.code ?? '—', plate: m.plate ?? null, serial: m.serial ?? null, tipo: m.tipo ?? null,
      companyName: m.company?.name ?? 'Sin empresa', sector: m.sector ?? null, encargado: m.encargado ?? null,
      active: m.active, operational: m.operational, en_espera: m.en_espera,
    })));
    setRounds(((rs ?? []) as any[]).map((r) => ({
      machinery_id: r.machinery_id, round_date: r.round_date, day_hours: r.day_hours, night_hours: r.night_hours,
      jornada_shift: r.jornada_shift, jornada_start_at: r.jornada_start_at,
      day_operator: r.day_operator ?? null, night_operator: r.night_operator ?? null,
    })));
    setMaint(((mr ?? []) as any[]).map((m) => ({ machinery_id: m.machinery_id, material: m.material, created_at: m.created_at })));
    setInspectorAssigns((insp.rows ?? []).map((a) => ({ machinery_id: a.machinery_id, inspector_name: a.inspector_name, shift: a.shift })));
    setPlanned(op);
    setPlannedMissing(missing);
    setOperators(((emps ?? []) as any[])
      .filter((e) => isOperatorCargo(e.cargo))
      .map((e) => ({ id: e.id, name: `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || 'Sin nombre', cedula: e.cedula ?? null, cargo: e.cargo ?? null })));
    const byEmp: Record<string, { kind: 'entrada' | 'salida'; ts: string }[]> = {};
    ((att ?? []) as any[]).forEach((r) => { const k = r.employee_id as string; (byEmp[k] ??= []).push({ kind: r.kind, ts: r.ts }); });
    setAttendanceByEmp(byEmp);
    setLoading(false);
  }, [today]);
  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(['machine_operators', 'machine_rounds', 'attendance', 'operator_assignments', 'maintenance_requests', 'machine_inspectors', 'machinery'], () => load(), { debounceMs: 1000, maxWaitMs: 3000 });

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const { machInactiveSet, machHardInactiveSet } = useMemo(() => computeMachineVisibilitySets(machList), [machList]);
  const daySets = useMemo(
    () => buildDaySets({ rounds, maint, assignments: inspectorAssigns, selDay: today, shiftArg: shift, machInactiveSet, machHardInactiveSet }),
    [rounds, maint, inspectorAssigns, today, shift, machInactiveSet, machHardInactiveSet],
  );

  // Operador PLANEADO por máquina, para el turno elegido (y también el otro turno, para el modal).
  const plannedByMachine = useMemo(() => {
    const map = new Map<string, { day?: OperatorAssignmentRow; night?: OperatorAssignmentRow }>();
    planned.forEach((p) => { const cur = map.get(p.machinery_id) ?? {}; cur[p.shift] = p; map.set(p.machinery_id, cur); });
    return map;
  }, [planned]);

  // Operador REAL (en sitio) por máquina, del round de hoy, para el turno elegido.
  const liveByMachine = useMemo(() => {
    const map = new Map<string, { name: string | null; open: boolean }>();
    rounds.forEach((r: any) => {
      const name = (shift === 'day' ? r.day_operator : r.night_operator) as string | null;
      const open = !!r.jornada_start_at && (r.jornada_shift === shift || (!r.jornada_shift));
      if (name || open) map.set(r.machinery_id, { name: name || null, open });
    });
    return map;
  }, [rounds, shift]);

  const attendanceOf = (employeeId: string | null): { status: 'ok' | 'no' | 'out' | null; ts: string | null } => {
    if (!employeeId) return { status: null, ts: null };
    const marks = attendanceByEmp[employeeId];
    if (!marks || marks.length === 0) return { status: 'no', ts: null };
    const { pairs, open } = pairMarks(marks);
    if (pairs.length === 0) return { status: 'no', ts: null };
    const last = pairs[pairs.length - 1];
    return open ? { status: 'ok', ts: last.in } : { status: 'out', ts: last.out };
  };

  // Universo de máquinas relevantes de ESTE turno: asignadas (inspector), en curso,
  // paradas o averiadas — mismo criterio de visibilidad que Inspecciones/Catálogo.
  const universeRows: Row[] = useMemo(() => {
    const ids = new Set<string>([...daySets.assignedShift, ...daySets.startedSet, ...daySets.averSet, ...daySets.paradaSet]);
    // Suma también las que ya tienen operador PLANEADO en este turno, aunque
    // todavía no haya actividad registrada (el coordinador planea antes de que
    // el operador escanee el QR).
    planned.forEach((p) => { if (p.shift === shift) ids.add(p.machinery_id); });
    const rows: Row[] = [];
    ids.forEach((id) => {
      if (machHardInactiveSet.has(id) || (machInactiveSet.has(id) && !daySets.anyOpenSet.has(id))) return;
      const m = machList.find((x) => x.id === id);
      if (!m) return;
      const state: MachineState = daySets.averSet.has(id) ? 'averia'
        : daySets.paradaSet.has(id) ? 'parada'
        : daySets.activeNowSet.has(id) ? 'activa'
        : daySets.closedSet.has(id) ? 'cerrada'
        : 'pendiente';
      const plan = plannedByMachine.get(id)?.[shift] ?? null;
      const live = liveByMachine.get(id) ?? null;
      const mismatch = !!(plan && live?.name && norm(plan.operator_name) !== norm(live.name));
      const att = attendanceOf(plan?.employee_id ?? null);
      rows.push({
        id, code: m.code, plate: m.plate, serial: m.serial, tipo: m.tipo, companyName: m.companyName, sector: m.sector,
        state, planned: plan, liveName: live?.name ?? null, liveOpen: !!live?.open, mismatch,
        attendance: att.status, attendanceTs: att.ts,
      });
    });
    rows.sort((a, b) => {
      const aUnassigned = !a.planned, bUnassigned = !b.planned;
      if (aUnassigned !== bUnassigned) return aUnassigned ? -1 : 1;
      if (a.mismatch !== b.mismatch) return a.mismatch ? -1 : 1;
      return cmpText(a.code, b.code);
    });
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daySets, planned, plannedByMachine, liveByMachine, machList, machInactiveSet, machHardInactiveSet, shift, attendanceByEmp]);

  const sinAsignarRows = useMemo(() => universeRows.filter((r) => !r.planned), [universeRows]);
  const mismatchRows = useMemo(() => universeRows.filter((r) => r.mismatch), [universeRows]);
  const ausenciaRows = useMemo(() => universeRows.filter((r) => r.planned && r.attendance === 'no'), [universeRows]);

  // ── Asignar / reasignar operador ──────────────────────────────────────────
  const [assignFor, setAssignFor] = useState<{ id: string; code: string; companyName: string } | null>(null);
  const [assignShift, setAssignShift] = useState<Shift>('day');
  const [opQuery, setOpQuery] = useState('');
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignNotice, setAssignNotice] = useState<string | null>(null);
  const openAssign = (r: { id: string; code: string; companyName: string }) => {
    setAssignFor(r); setAssignShift(shift); setOpQuery(''); setAssignNotice(null);
  };
  const opsShown = useMemo(() => {
    const q = norm(opQuery.trim());
    return [...operators].sort((a, b) => cmpText(a.name, b.name)).filter((o) => !q || norm(o.name).includes(q) || norm(o.cedula || '').includes(q));
  }, [operators, opQuery]);
  const applyAssign = async (s: Shift, op: Operator | null) => {
    if (!assignFor || assignBusy) return;
    setAssignBusy(true); setAssignNotice(null);
    const res = op
      ? await assignOperator(assignFor.id, op.id, op.name, op.cedula, s, uid || null)
      : await unassignOperator(assignFor.id, s);
    setAssignBusy(false);
    if (res.error) {
      setAssignNotice(res.missing ? '❌ Falta activar la tabla machine_operators en Supabase.' : '❌ ' + res.error);
      return;
    }
    logAudit('CHECK', 'machinery', assignFor.id, `Operador ${assignFor.code} · ${shiftIcon(s)} ${shiftLabel(s)} → ${op ? op.name : 'quitado'}`);
    await load();
    setAssignNotice(op ? `✅ ${shiftIcon(s)} ${shiftLabel(s)} → ${op.name}` : `➖ ${shiftIcon(s)} ${shiftLabel(s)} quitado`);
  };

  // ── Compartir novedades (PDF) ─────────────────────────────────────────────
  const [shareBusy, setShareBusy] = useState(false);
  const compartirNovedades = async () => {
    setShareBusy(true);
    try {
      const esc = (t: any) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const sec = (title: string, rows: Row[], detail: (r: Row) => string) => rows.length === 0 ? '' : `
        <h3>${esc(title)} · ${rows.length}</h3>
        <table><thead><tr><th>Máquina</th><th>Empresa</th><th>Detalle</th></tr></thead><tbody>
          ${rows.map((r) => `<tr><td>${esc(r.code)}</td><td>${esc(r.companyName)}</td><td>${esc(detail(r))}</td></tr>`).join('')}
        </tbody></table>`;
      const body = [
        sec('🧩 Máquinas sin operador asignado', sinAsignarRows, () => 'Sin operador planeado para este turno.'),
        sec('⚠️ No coincide', mismatchRows, (r) => `Planeado ${r.planned?.operator_name} · en sitio ${r.liveName}`),
        sec('🔴 Sin marcar entrada', ausenciaRows, (r) => `Operador planeado: ${r.planned?.operator_name}, sin asistencia registrada hoy.`),
      ].join('');
      if (!body) { setShareBusy(false); return; }
      const html = pdfDocument({
        title: 'Novedades del Coordinador de Operadores',
        subtitle: `${shiftIcon(shift)} ${shiftLabel(shift)} · ${today}`,
        extraCss: `table{width:100%;border-collapse:collapse;margin:6px 0 14px;font-size:11px}
          th,td{border:1px solid #c9d2dc;padding:5px 7px;text-align:left} th{background:#16324F;color:#fff}
          tr:nth-child(even) td{background:#f4f7fb} h3{margin:14px 0 2px;font-size:14px;color:#16324F}`,
        body,
      });
      await exportPdf(html, `Novedades operadores ${today}`);
    } finally {
      setShareBusy(false);
    }
  };

  const badge = (state: MachineState) => {
    const meta = STATE_META[state];
    return (
      <View style={{ backgroundColor: (colors as any)[meta.bg], borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 }}>
        <Text style={{ color: meta.text(colors), fontWeight: '800', fontSize: 10.5 }}>{meta.label}</Text>
      </View>
    );
  };

  const attendanceChip = (r: Row) => {
    if (!r.planned) return null;
    if (!r.planned.employee_id) return <Text style={{ color: colors.muted, fontSize: 10.5 }}>· sin ficha vinculada</Text>;
    if (r.attendance === 'ok') return <Text style={{ color: colors.success, fontSize: 10.5 }}>🟢 Marcó entrada {r.attendanceTs ? fmtHora(r.attendanceTs) : ''}</Text>;
    if (r.attendance === 'out') return <Text style={{ color: colors.warning, fontSize: 10.5 }}>🟡 Marcó salida {r.attendanceTs ? fmtHora(r.attendanceTs) : ''}</Text>;
    return <Text style={{ color: colors.danger, fontSize: 10.5 }}>🔴 Sin marcar entrada hoy</Text>;
  };

  const machineCard = (r: Row) => (
    <TouchableOpacity key={r.id} onPress={() => openAssign(r)} activeOpacity={0.8}>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>{r.code}</Text>
            <Text style={{ color: colors.muted, fontSize: 11 }}>{r.companyName}{r.tipo ? ` · ${r.tipo}` : ''}</Text>
          </View>
          {badge(r.state)}
        </View>
        <View style={{ marginTop: spacing.xs, gap: 2 }}>
          <Text style={{ color: colors.muted, fontSize: 11.5 }}>Planeado <Text style={{ color: colors.text, fontWeight: '700' }}>{r.planned ? `👷 ${r.planned.operator_name}` : '— sin asignar'}</Text></Text>
          {r.liveName ? (
            <Text style={{ color: colors.muted, fontSize: 11.5 }}>En sitio <Text style={{ color: r.mismatch ? colors.danger : colors.text, fontWeight: '700' }}>👷 {r.liveName}</Text></Text>
          ) : null}
          {r.mismatch ? (
            <View style={{ backgroundColor: colors.dangerSoftBg, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4, marginTop: 3 }}>
              <Text style={{ color: colors.dangerSoftText, fontWeight: '700', fontSize: 10.5 }}>⚠️ El operador en sitio no es el planeado</Text>
            </View>
          ) : null}
          {attendanceChip(r)}
        </View>
      </Card>
    </TouchableOpacity>
  );

  if (loading) return <Screen><ConfigBanner /><SkeletonList /></Screen>;

  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      <ConfigBanner />
      <SectionTitle>👷‍♂️ Coordinador de Operadores</SectionTitle>

      {plannedMissing ? (
        <Card><Text style={{ color: colors.danger, fontWeight: '700' }}>❌ Falta activar la tabla machine_operators en Supabase.</Text></Card>
      ) : null}

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
        {(['day', 'night'] as Shift[]).map((s) => {
          const on = shift === s;
          return (
            <TouchableOpacity key={s} onPress={() => setShift(s)} style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}>
              <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 13 }}>{shiftIcon(s)} {shiftLabel(s)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
        <View style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
          <Text style={{ color: colors.success, fontSize: 18, fontWeight: '900' }}>{daySets.activeNowSet.size}</Text>
          <Text style={{ color: colors.muted, fontSize: 10, textAlign: 'center' }}>Activas</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
          <Text style={{ color: colors.warning, fontSize: 18, fontWeight: '900' }}>{sinAsignarRows.length}</Text>
          <Text style={{ color: colors.muted, fontSize: 10, textAlign: 'center' }}>Sin asignar</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
          <Text style={{ color: colors.danger, fontSize: 18, fontWeight: '900' }}>{mismatchRows.length}</Text>
          <Text style={{ color: colors.muted, fontSize: 10, textAlign: 'center' }}>No coincide</Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md }}>
        {([
          { key: 'maquinas', label: `🚜 Máquinas (${universeRows.length})` },
          { key: 'sinasignar', label: `🧩 Sin asignar (${sinAsignarRows.length})` },
          { key: 'novedades', label: `📋 Novedades (${sinAsignarRows.length + mismatchRows.length + ausenciaRows.length})` },
        ] as { key: typeof tab; label: string }[]).map((t) => {
          const on = tab === t.key;
          return (
            <TouchableOpacity key={t.key} onPress={() => setTab(t.key)} style={{ flex: 1, paddingVertical: spacing.xs, borderRadius: radius.md, alignItems: 'center', backgroundColor: on ? colors.primary : colors.surface, borderWidth: 1, borderColor: on ? colors.primary : colors.border }}>
              <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 11 }}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {tab === 'maquinas' ? (
        universeRows.length === 0
          ? <EmptyState title="Sin máquinas en este turno" subtitle="No hay máquinas asignadas, trabajando ni con novedades para el turno elegido." />
          : universeRows.map(machineCard)
      ) : null}

      {tab === 'sinasignar' ? (
        sinAsignarRows.length === 0
          ? <EmptyState title="Todo asignado" subtitle="Ninguna máquina relevante de este turno está sin operador planeado." />
          : sinAsignarRows.map(machineCard)
      ) : null}

      {tab === 'novedades' ? (
        <>
          <TouchableOpacity onPress={compartirNovedades} disabled={shareBusy} style={{ backgroundColor: colors.brand, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginBottom: spacing.md, opacity: shareBusy ? 0.6 : 1 }}>
            <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{shareBusy ? 'Generando…' : '📤 Compartir novedades'}</Text>
          </TouchableOpacity>
          {sinAsignarRows.length === 0 && mismatchRows.length === 0 && ausenciaRows.length === 0 ? (
            <EmptyState title="Sin novedades" subtitle="No hay máquinas sin asignar, mismatches ni ausencias en este turno." />
          ) : (
            <>
              {sinAsignarRows.length > 0 ? (<><SectionTitle>🧩 Máquinas sin operador ({sinAsignarRows.length})</SectionTitle>{sinAsignarRows.map(machineCard)}</>) : null}
              {mismatchRows.length > 0 ? (<><SectionTitle>⚠️ No coincide ({mismatchRows.length})</SectionTitle>{mismatchRows.map(machineCard)}</>) : null}
              {ausenciaRows.length > 0 ? (<><SectionTitle>🔴 Sin marcar entrada ({ausenciaRows.length})</SectionTitle>{ausenciaRows.map(machineCard)}</>) : null}
            </>
          )}
        </>
      ) : null}

      {/* ── Asignar / reasignar operador ── */}
      <Modal visible={assignFor !== null} transparent animationType="fade" onRequestClose={() => setAssignFor(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }} onPress={() => setAssignFor(null)}>
          <Pressable onPress={(e) => e.stopPropagation?.()} style={{ backgroundColor: colors.background, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '85%', paddingTop: spacing.md }}>
            {assignFor ? (() => {
              const current = plannedByMachine.get(assignFor.id)?.[assignShift] ?? null;
              return (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, marginBottom: spacing.sm }}>
                    <Text style={{ color: colors.text, fontWeight: '900', fontSize: 16, flex: 1 }} numberOfLines={1}>👷 Asignar operador · 🚜 {assignFor.code}</Text>
                    <TouchableOpacity onPress={() => setAssignFor(null)} style={{ paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                      <Text style={{ color: colors.primary, fontWeight: '900', fontSize: 18 }}>✕</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={{ flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, marginBottom: spacing.sm }}>
                    {(['day', 'night'] as Shift[]).map((s) => {
                      const on = assignShift === s;
                      return (
                        <TouchableOpacity key={s} onPress={() => setAssignShift(s)} style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 2, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface }}>
                          <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 13 }}>{shiftIcon(s)} {shiftLabel(s)}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <View style={{ paddingHorizontal: spacing.md, marginBottom: spacing.sm }}>
                    {current ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm }}>
                        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700', flex: 1 }} numberOfLines={1}>Planeado ahora: 👷 {current.operator_name}</Text>
                        <TouchableOpacity disabled={assignBusy} onPress={() => applyAssign(assignShift, null)} style={{ borderWidth: 1, borderColor: colors.warning, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 5, opacity: assignBusy ? 0.5 : 1 }}>
                          <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 12 }}>➖ Quitar</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <Text style={{ color: colors.muted, fontSize: 12, fontStyle: 'italic' }}>Sin operador planeado en {shiftLabel(assignShift)}. Elige uno de la lista.</Text>
                    )}
                    {assignNotice ? <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700', marginTop: spacing.xs }}>{assignNotice}</Text> : null}
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, marginHorizontal: spacing.md, marginBottom: spacing.sm }}>
                    <Text style={{ fontSize: 14 }}>🔎</Text>
                    <TextInput value={opQuery} onChangeText={setOpQuery} placeholder="Buscar operador…" placeholderTextColor={colors.muted} style={{ flex: 1, color: colors.text, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs }} />
                    {opQuery ? <TouchableOpacity onPress={() => setOpQuery('')}><Text style={{ color: colors.primary, fontWeight: '800', paddingHorizontal: spacing.xs }}>✕</Text></TouchableOpacity> : null}
                  </View>

                  <ScrollView style={{ paddingHorizontal: spacing.md }} contentContainerStyle={{ paddingBottom: spacing.xl }} keyboardShouldPersistTaps="handled">
                    {opsShown.length === 0 ? (
                      <Text style={{ color: colors.muted, textAlign: 'center', paddingVertical: spacing.lg }}>Sin operadores (cargo operador/chofer/obrero/servicios generales).</Text>
                    ) : opsShown.map((o) => {
                      const sel = current?.employee_id === o.id;
                      return (
                        <TouchableOpacity key={o.id} disabled={assignBusy} onPress={() => applyAssign(assignShift, o)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border, opacity: assignBusy ? 0.5 : 1, backgroundColor: sel ? colors.primary + '12' : 'transparent' }}>
                          <Text style={{ fontSize: 16 }}>{sel ? '✅' : '👷'}</Text>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: colors.text, fontWeight: sel ? '800' : '600', fontSize: 14 }}>{o.name}</Text>
                            <Text style={{ color: colors.muted, fontSize: 10.5, textTransform: 'capitalize' }}>{o.cargo || '—'}</Text>
                          </View>
                          {sel ? <Text style={{ color: colors.success, fontWeight: '800', fontSize: 12 }}>asignado</Text> : null}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </>
              );
            })() : null}
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}
