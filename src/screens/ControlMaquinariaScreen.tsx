import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, TextInput, Alert, Platform, Modal, ScrollView } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { supabase } from '../lib/supabase';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { elapsedSince } from '../lib/time';
import { useConfirm } from '../components/ConfirmProvider';
import { useAuth } from '../context/AuthContext';
import { Machinery, MachineRound, MachineDayOperator, ControlClosure, ClosureMachine } from '../types/database';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

export const ROUND_TIMES = ['07:00', '11:00', '15:00', '19:00'];
export const ROUND_LABELS = ['1ª RONDA', '2ª RONDA', '3ª RONDA', '4ª RONDA'];
/** Horas de un turno completo. Medio turno = 6 h. */
export const SHIFT_HOURS = 12;
export const HALF_SHIFT = 6;
/** Opciones por turno (día/noche): sin turno, medio (6h) o completo (12h). */
export const SHIFT_OPTS: { label: string; hours: number }[] = [
  { label: '—', hours: 0 },
  { label: 'Medio · 6h', hours: 6 },
  { label: 'Completo · 12h', hours: 12 },
];
/** Horas trabajadas del día = (turno día + turno noche) − parada + extras (mín. 0 antes de extras). */
export const workedFromShifts = (dayH: number, nightH: number, stopped: number, overtime: number) =>
  Math.max(0, (Number(dayH) || 0) + (Number(nightH) || 0) - (Number(stopped) || 0)) + Math.max(0, Number(overtime) || 0);
/** Fracción de jornada según las horas (proporcional): 12 h = 1, 6 h = 0.5, 10 h = 0.833… (horas ÷ 12). */
export const shiftPayUnits = (h: number): number => (Number(h) || 0) / 12;
/** Jornadas del día = (horas día + horas noche) ÷ 12. Monto = precio por jornada × jornadas. */
export const payUnitsFromShifts = (dayH: number, nightH: number): number =>
  ((Number(dayH) || 0) + (Number(nightH) || 0)) / 12;
/** Texto del turno según las horas de turno totales (día + noche). */
export function shiftLabel(totalShiftHours: number): string {
  const h = Number(totalShiftHours) || 0;
  if (h <= 0) return 'Sin turno';
  if (h === 6) return 'Medio turno';
  if (h === 12) return 'Turno completo';
  if (h === 18) return 'Turno y medio';
  if (h === 24) return 'Dos turnos';
  return `${(h / 12).toLocaleString()} turno(s)`;
}
/** Compat: horas trabajadas asumiendo turno completo (para datos viejos sin turnos). */
export const workedHours = (hoursStopped: number) => Math.max(0, SHIFT_HOURS - (hoursStopped || 0));

/** Campo de fecha con calendario: en web usa <input type="date">; en nativo, texto. */
function DateField({ value, onChange, colors }: { value: string; onChange: (v: string) => void; colors: any }) {
  if (Platform.OS === 'web') {
    return React.createElement('input', {
      type: 'date',
      value: value || '',
      onChange: (e: any) => onChange(e.target.value),
      // Al hacer clic (o enfocar) abre directamente el calendario del navegador.
      onClick: (e: any) => { try { e.currentTarget.showPicker && e.currentTarget.showPicker(); } catch (_) {} },
      onFocus: (e: any) => { try { e.currentTarget.showPicker && e.currentTarget.showPicker(); } catch (_) {} },
      style: {
        padding: '9px',
        borderRadius: '10px',
        border: '1px solid ' + colors.border,
        background: colors.surface,
        color: colors.text,
        fontSize: '14px',
        width: '100%',
        boxSizing: 'border-box',
      },
    });
  }
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder="AAAA-MM-DD"
      placeholderTextColor={colors.muted}
      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }}
    />
  );
}

function todayISO(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
/** Fecha + hora (Caracas) legible, p. ej. "08/07/2026 07:35". */
function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-VE', {
      timeZone: 'America/Caracas',
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
function shiftDay(iso: string, delta: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
/** Lunes de la semana de la fecha dada (ISO). */
function weekStartISO(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  const dow = (d.getDay() + 6) % 7; // Lunes = 0
  return shiftDay(iso, -dow);
}
const DOW_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
/** Etiqueta corta de un día ISO: "Lun 30/06". */
function dayLabel(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  const dow = (d.getDay() + 6) % 7;
  return `${DOW_LABELS[dow]} ${`${d.getDate()}`.padStart(2, '0')}/${`${d.getMonth() + 1}`.padStart(2, '0')}`;
}

export default function ControlMaquinariaScreen({ navigation }: any) {
  const { colors } = useTheme();
  const confirm = useConfirm();
  const { session } = useAuth();
  const [date, setDate] = useState(todayISO());
  const [machines, setMachines] = useState<Machinery[]>([]);
  const [companies, setCompanies] = useState<Record<string, string>>({}); // id → nombre
  const [rounds, setRounds] = useState<Record<string, MachineRound>>({}); // key: machineId|fecha
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [hoursInput, setHoursInput] = useState<Record<string, string>>({}); // parada en edición (máquina|fecha)
  const [overtimeInput, setOvertimeInput] = useState<Record<string, string>>({}); // extras en edición (máquina|fecha)
  const [companyFilter, setCompanyFilter] = useState<string>('__all__'); // '__all__' | '__none__' | company id
  const [companyPickerOpen, setCompanyPickerOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({}); // empresa → desplegada
  const [cardOpen, setCardOpen] = useState<Record<string, boolean>>({}); // máquina → tarjeta desplegada
  const [priceFor, setPriceFor] = useState<Machinery | null>(null); // máquina cuyo precio/hora se edita
  const [priceInput, setPriceInput] = useState('');

  // Operador por turno: máquina + fecha + turno (día/noche) que se está editando.
  const [opFor, setOpFor] = useState<{ m: Machinery; d: string; which: 'day' | 'night' } | null>(null);
  const [opFirst, setOpFirst] = useState('');
  const [opLast, setOpLast] = useState('');
  const [opCedula, setOpCedula] = useState('');

  // Bloque de días: arranca el lunes de la fecha elegida y muestra `dayCount` días
  // (por defecto 7, pero se pueden añadir 8, 10, … los que se necesiten).
  const [dayCount, setDayCount] = useState(7);
  const weekStart = weekStartISO(date);
  const weekDays = Array.from({ length: dayCount }, (_, i) => shiftDay(weekStart, i));
  const weekEnd = weekDays[weekDays.length - 1];

  // Cierre de control + histórico
  const [closing, setClosing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [histOpen, setHistOpen] = useState(false);
  const [closures, setClosures] = useState<ControlClosure[]>([]);
  const [closureSel, setClosureSel] = useState<ControlClosure | null>(null);
  const [closureSearch, setClosureSearch] = useState(''); // buscador dentro del cierre
  const [closureCompany, setClosureCompany] = useState<string | null>(null); // filtra el cierre a una empresa
  const [closureExpanded, setClosureExpanded] = useState<Record<string, boolean>>({}); // código → detalle abierto

  const rkey = (mId: string, d: string) => `${mId}|${d}`;

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const ws = weekStartISO(date);
    const days = Array.from({ length: dayCount }, (_, i) => shiftDay(ws, i));
    try {
      const [{ data: m }, { data: r }, { data: c }] = await Promise.all([
        supabase.from('machinery').select('*').order('code', { ascending: true }),
        supabase.from('machine_rounds').select('*').in('round_date', days),
        supabase.from('companies').select('id, name'),
      ]);
      setMachines((m ?? []) as Machinery[]);
      const cmap: Record<string, string> = {};
      (c ?? []).forEach((row: any) => (cmap[row.id] = row.name));
      setCompanies(cmap);
      // El control activo ignora lo ya cerrado (archivado en el histórico); esos datos
      // siguen en la BD y cuentan para pagos/reportes, pero no se editan aquí.
      const map: Record<string, MachineRound> = {};
      (r ?? []).forEach((row: any) => { if (!row.closed) map[rkey(row.machinery_id, row.round_date)] = row; });
      setRounds(map);
      if (!silent) { setHoursInput({}); setOvertimeInput({}); }
    } catch (e: any) {
      if (!silent) Alert.alert('Aviso', 'No se pudo cargar el control. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setLoading(false); // pase lo que pase, se quita el spinner (nunca se queda colgado)
    }
  }, [date, dayCount]);

  useEffect(() => {
    load();
    // Sincronización multiusuario: refresca (silencioso) al cambiar turnos/máquinas.
    let timer: any;
    const bump = () => { clearTimeout(timer); timer = setTimeout(() => load(true), 300); };
    const ch = supabase.channel('rt-control-maquinaria');
    ['machine_rounds', 'machinery'].forEach((t) =>
      ch.on('postgres_changes' as any, { event: '*', schema: 'public', table: t }, bump)
    );
    ch.subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(ch); };
  }, [load]);

  // Guarda/actualiza el registro base (round_no=1) de una máquina en un día concreto,
  // conservando lo demás. Todo el control es por (máquina, fecha).
  const upsertRound = async (m: Machinery, dISO: string, patch: Record<string, any>) => {
    const ex = rounds[rkey(m.id, dISO)];
    const payload: any = {
      machinery_id: m.id,
      round_date: dISO,
      round_no: 1,
      day_hours: Number(ex?.day_hours ?? 0),
      night_hours: Number(ex?.night_hours ?? 0),
      hours_stopped: Number(ex?.hours_stopped ?? 0),
      overtime_hours: Number(ex?.overtime_hours ?? 0),
      day_operator: ex?.day_operator ?? null,
      day_operator_ci: ex?.day_operator_ci ?? null,
      night_operator: ex?.night_operator ?? null,
      night_operator_ci: ex?.night_operator_ci ?? null,
      ...patch,
    };
    payload.status = Number(payload.day_hours) + Number(payload.night_hours) > 0 ? 'operativa' : 'parada';
    const { data, error } = await supabase
      .from('machine_rounds')
      .upsert(payload, { onConflict: 'machinery_id,round_date,round_no' })
      .select()
      .single();
    if (error) { Alert.alert('Aviso', error.message); return; }
    setRounds((p) => ({ ...p, [rkey(m.id, dISO)]: data as MachineRound }));
  };

  // Fija el turno de DÍA o NOCHE (0 / 6 / 12 h) de una máquina en un día.
  const setShift = async (m: Machinery, dISO: string, which: 'day' | 'night', hoursVal: number) => {
    const ex = rounds[rkey(m.id, dISO)];
    const hadOp = which === 'day' ? ex?.day_operator : ex?.night_operator;
    await upsertRound(m, dISO, which === 'day' ? { day_hours: hoursVal } : { night_hours: hoursVal });
    // Al asignar un turno y si aún no hay operador de esa jornada, pedir sus datos.
    if (hoursVal > 0 && !hadOp) openOperator(m, dISO, which);
  };

  const setHours = async (m: Machinery, dISO: string, val: string) => {
    await upsertRound(m, dISO, { hours_stopped: Math.max(0, Number(val.replace(',', '.')) || 0) });
  };
  const setOvertime = async (m: Machinery, dISO: string, val: string) => {
    await upsertRound(m, dISO, { overtime_hours: Math.max(0, Number(val.replace(',', '.')) || 0) });
  };

  // ── Operador por turno (cada jornada puede tener uno distinto) ────────────────
  const openOperator = (m: Machinery, dISO: string, which: 'day' | 'night') => {
    const ex = rounds[rkey(m.id, dISO)];
    const name = (which === 'day' ? ex?.day_operator : ex?.night_operator) ?? '';
    const ci = (which === 'day' ? ex?.day_operator_ci : ex?.night_operator_ci) ?? '';
    const parts = name.trim().split(' ');
    setOpFor({ m, d: dISO, which });
    setOpFirst(parts[0] ?? '');
    setOpLast(parts.slice(1).join(' '));
    setOpCedula(ci);
  };

  const saveOperator = async () => {
    if (!opFor) return;
    const full = `${opFirst.trim()} ${opLast.trim()}`.trim();
    const patch =
      opFor.which === 'day'
        ? { day_operator: full || null, day_operator_ci: opCedula.trim() || null }
        : { night_operator: full || null, night_operator_ci: opCedula.trim() || null };
    await upsertRound(opFor.m, opFor.d, patch);
    setOpFor(null);
  };

  // ── Cerrar control → archiva TODO lo pendiente (todas las fechas) en el histórico.
  //    El cierre abarca desde el primer turno (día o noche) registrado hasta el último día.
  const cerrarControl = async () => {
    setClosing(true);
    // Trae todos los turnos sin cerrar (de cualquier fecha) con sus operadores por turno.
    const { data: openRounds } = await supabase
      .from('machine_rounds')
      .select('round_date, day_hours, night_hours, hours_stopped, overtime_hours, day_operator, day_operator_ci, night_operator, night_operator_ci, machinery:machinery_id(id, code, serial, plate, company:company_id(name))')
      .eq('closed', false);
    const rows = (openRounds ?? []).filter(
      (r: any) => (Number(r.day_hours) || 0) + (Number(r.night_hours) || 0) > 0 || (Number(r.hours_stopped) || 0) > 0 || (Number(r.overtime_hours) || 0) > 0
    );
    if (rows.length === 0) {
      setClosing(false);
      setNotice('No hay turnos registrados (día o noche) para cerrar.');
      return;
    }
    const dates = rows.map((r: any) => r.round_date).sort();
    const from = dates[0];
    const to = dates[dates.length - 1];
    const snapshot: ClosureMachine[] = rows
      .sort((a: any, b: any) => (a.round_date === b.round_date ? String(a.machinery?.code).localeCompare(String(b.machinery?.code)) : a.round_date.localeCompare(b.round_date)))
      .map((r: any) => {
        const dayH = Number(r.day_hours) || 0;
        const nightH = Number(r.night_hours) || 0;
        const stopped = Number(r.hours_stopped) || 0;
        const ot = Number(r.overtime_hours) || 0;
        return {
          code: r.machinery?.code ?? '—',
          machineId: r.machinery?.id ?? null,
          serial: r.machinery?.serial ?? r.machinery?.plate ?? null,
          company: r.machinery?.company?.name ?? 'Sin empresa',
          operator: [r.day_operator, r.night_operator].filter(Boolean).join(' / '),
          cedula: '',
          date: r.round_date,
          dayOperator: r.day_operator ?? '',
          dayCedula: r.day_operator_ci ?? '',
          nightOperator: r.night_operator ?? '',
          nightCedula: r.night_operator_ci ?? '',
          dayHours: dayH,
          nightHours: nightH,
          hoursStopped: stopped,
          overtime: ot,
          worked: workedFromShifts(dayH, nightH, stopped, ot),
        } as ClosureMachine;
      });
    const uniqueMachines = new Set(snapshot.map((s) => s.machineId || s.serial || s.code)).size;
    const rangeTxt = from === to ? `del ${from}` : `del ${from} al ${to}`;
    setClosing(false);
    const ok = await confirm({
      title: 'Cerrar control',
      message: `¿Cerrar el control ${rangeTxt}? Se guardará en el histórico con ${uniqueMachines} máquina(s) en ${snapshot.length} registro(s) y sus operadores.`,
      confirmText: 'Cerrar y guardar',
      cancelText: 'Cancelar',
    });
    if (!ok) return;
    setClosing(true);
    const { error } = await supabase.from('control_closures').insert({
      closure_date: to,
      closed_by: session?.user?.id ?? null,
      detail: { machines: snapshot, totalMachines: uniqueMachines, dateFrom: from, dateTo: to },
    });
    if (error) {
      setClosing(false);
      return Alert.alert('Aviso', error.message);
    }
    // Marca TODO lo pendiente como cerrado: sale del control activo pero queda en la BD.
    await supabase.from('machine_rounds').update({ closed: true }).eq('closed', false);
    setClosing(false);
    setNotice(`✅ Control ${rangeTxt} cerrado y guardado en el histórico. El control activo quedó limpio.`);
    load(true);
  };

  const openHistorico = async () => {
    setHistOpen(true);
    const { data } = await supabase.from('control_closures').select('*').order('closure_date', { ascending: false }).limit(200);
    setClosures((data ?? []) as ControlClosure[]);
  };

  const shiftCell = (h?: number) => (h ? `${h} h` : '—');
  const opCell = (name?: string, ci?: string) => (name ? `${name}${ci ? `<br/><span style="color:#888">C.I ${ci}</span>` : ''}` : '—');
  const downloadClosurePdf = async (c: ControlClosure) => {
    // Si el cierre se abrió desde una empresa, el PDF sale solo con sus máquinas.
    const machs = (c.detail?.machines ?? []).filter((m) => !closureCompany || (m.company || 'Sin empresa') === closureCompany);
    const range = c.detail?.dateFrom && c.detail?.dateTo && c.detail.dateFrom !== c.detail.dateTo
      ? `del ${c.detail.dateFrom} al ${c.detail.dateTo}`
      : `del ${c.detail?.dateFrom ?? c.closure_date}`;
    // Precio POR JORNADA (12 h) de cada máquina. Monto = precio × unidades (12h=1, 6h=0.5).
    const priceBySerial = new Map(machines.filter((mm) => mm.serial).map((mm) => [mm.serial as string, Number(mm.price_per_hour) || 0]));
    const priceByCode = new Map(machines.map((mm) => [mm.code, Number(mm.price_per_hour) || 0]));
    const priceOf = (m: ClosureMachine) => (m.serial ? priceBySerial.get(m.serial) : undefined) ?? priceByCode.get(m.code) ?? 0;
    const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const rows = machs
      .map((m) => {
        const price = priceOf(m);
        const amount = payUnitsFromShifts(m.dayHours ?? 0, m.nightHours ?? 0) * price;
        return (
          `<tr><td>${m.date ?? '—'}</td><td>${m.code}${m.serial ? `<br/><span style="color:#888">${m.serial}</span>` : ''}</td><td>${m.company || '—'}</td>` +
          `<td style="text-align:center">${shiftCell(m.dayHours)}</td><td>${opCell(m.dayOperator, m.dayCedula)}</td>` +
          `<td style="text-align:center">${shiftCell(m.nightHours)}</td><td>${opCell(m.nightOperator, m.nightCedula)}</td>` +
          `<td style="text-align:center">${m.hoursStopped ? m.hoursStopped.toLocaleString() : '—'}</td><td style="text-align:center">${m.overtime ? m.overtime.toLocaleString() : '—'}</td><td style="text-align:center;font-weight:700">${m.worked} h</td>` +
          `<td style="text-align:right;font-weight:700">${price ? usd(amount) : '—'}</td></tr>`
        );
      })
      .join('');
    // Totales del cierre.
    const tot = machs.reduce(
      (a, m) => {
        const price = priceOf(m);
        return {
          day: a.day + (Number(m.dayHours) || 0),
          night: a.night + (Number(m.nightHours) || 0),
          stopped: a.stopped + (Number(m.hoursStopped) || 0),
          extra: a.extra + (Number(m.overtime) || 0),
          worked: a.worked + (Number(m.worked) || 0),
          amount: a.amount + payUnitsFromShifts(m.dayHours ?? 0, m.nightHours ?? 0) * price,
        };
      },
      { day: 0, night: 0, stopped: 0, extra: 0, worked: 0, amount: 0 }
    );
    const foot = `<tfoot><tr>
      <td colspan="3" style="text-align:right;font-weight:800">TOTALES</td>
      <td style="text-align:center;font-weight:800">${tot.day} h</td><td></td>
      <td style="text-align:center;font-weight:800">${tot.night} h</td><td></td>
      <td style="text-align:center;font-weight:800">${tot.stopped} h</td>
      <td style="text-align:center;font-weight:800">${tot.extra} h</td>
      <td style="text-align:center;font-weight:800">${tot.worked} h</td>
      <td style="text-align:right;font-weight:800">${usd(tot.amount)}</td></tr></tfoot>`;
    const html = pdfDocument({
      title: 'Control de maquinaria',
      subtitle: `Cierre ${range}${closureCompany ? ` · ${closureCompany}` : ''} · ${new Set(machs.map((x) => x.machineId || x.serial || x.code)).size} máquina(s) · ${machs.length} registro(s)`,
      extraCss: `
        table{width:100%;border-collapse:collapse;margin-top:14px;font-size:10px}
        th,td{border:1px solid #ccc;padding:4px 6px;text-align:left}
        th{background:#1E3A5F;color:#fff}
        tfoot td{background:#EEF2F7}
        .note{color:#666;font-size:11px;margin-top:8px}
        .totals{display:flex;gap:12px;margin-top:14px}
        .totals .c{flex:1;border:1px solid #E5E7EB;border-radius:8px;padding:10px 12px;background:#FBFBFB}
        .totals .c.pay{background:#1E3A5F;border-color:#1E3A5F}
        .totals .c.pay .k,.totals .c.pay .v{color:#fff}
        .totals .k{color:#6B7280;font-size:11px;text-transform:uppercase;letter-spacing:.4px}
        .totals .v{font-weight:800;font-size:20px;color:#1E3A5F;margin-top:2px}`,
      body: `
      <table><thead><tr><th>Fecha</th><th>Máquina</th><th>Empresa</th>
        <th>☀️ Día</th><th>Operador día</th><th>🌙 Noche</th><th>Operador noche</th>
        <th>H. PARADA</th><th>H. EXTRA</th><th>H. TRAB.</th><th>Monto ($)</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="11" style="text-align:center">Sin datos</td></tr>'}</tbody>${foot}</table>
      <div class="totals">
        <div class="c"><div class="k">Total de horas trabajadas</div><div class="v">${tot.worked} h</div></div>
        <div class="c"><div class="k">☀️ Total horas de día</div><div class="v">${tot.day} h</div></div>
        <div class="c"><div class="k">🌙 Total horas de noche</div><div class="v">${tot.night} h</div></div>
        <div class="c pay"><div class="k">💵 Total a pagar</div><div class="v">${usd(tot.amount)}</div></div>
      </div>
      <p class="note">Trabajadas = (turno día + turno noche) − parada + extras · Monto = precio por jornada: turno completo (12 h) = precio, medio turno (6 h) = mitad</p>`,
    });
    await exportPdf(html);
  };

  const setMoveDate = async (m: Machinery, field: 'entry_date' | 'exit_date', value: string | null) => {
    const { error } = await supabase.from('machinery').update({ [field]: value }).eq('id', m.id);
    if (error) return Alert.alert('Aviso', error.message);
    setMachines((prev) => prev.map((x) => (x.id === m.id ? ({ ...x, [field]: value } as Machinery) : x)));
  };

  // Marca/limpia la ENTRADA o SALIDA guardando el MOMENTO exacto (fecha + hora).
  // Desde la entrada se cuenta que la máquina empieza a trabajar.
  const setMove = async (m: Machinery, kind: 'entry' | 'exit', on: boolean) => {
    const patch = on
      ? { [`${kind}_date`]: date, [`${kind}_at`]: new Date().toISOString() }
      : { [`${kind}_date`]: null, [`${kind}_at`]: null };
    const { error } = await supabase.from('machinery').update(patch).eq('id', m.id);
    if (error) return Alert.alert('Aviso', error.message);
    setMachines((prev) => prev.map((x) => (x.id === m.id ? ({ ...x, ...patch } as Machinery) : x)));
  };

  const openPrice = (m: Machinery) => {
    setPriceFor(m);
    setPriceInput(m.price_per_hour != null ? String(m.price_per_hour) : '');
  };

  const savePrice = async (m: Machinery, value: string) => {
    const n = Number(value.replace(',', '.'));
    const val = value.trim() === '' ? null : isFinite(n) && n >= 0 ? n : null;
    const { error } = await supabase.from('machinery').update({ price_per_hour: val }).eq('id', m.id);
    if (error) return Alert.alert('Aviso', error.message);
    setMachines((prev) => prev.map((x) => (x.id === m.id ? ({ ...x, price_per_hour: val } as Machinery) : x)));
    setPriceFor(null);
  };

  const q = query.trim().toLowerCase();
  const matchCompany = (m: Machinery) =>
    companyFilter === '__all__' ? true : companyFilter === '__none__' ? !m.company_id : m.company_id === companyFilter;
  const shown = machines.filter(
    (m) =>
      matchCompany(m) &&
      (!q ||
        m.code.toLowerCase().includes(q) ||
        (m.serial ?? '').toLowerCase().includes(q) ||
        (m.company_id ? (companies[m.company_id] ?? '').toLowerCase().includes(q) : false)),
  );

  // Opciones de empresa (con conteo) para el filtro desplegable.
  const companyOptions = [
    { label: 'Todas las empresas', value: '__all__', count: machines.length },
    ...Object.entries(companies)
      .map(([id, name]) => ({ label: name, value: id, count: machines.filter((m) => m.company_id === id).length }))
      .filter((o) => o.count > 0)
      .sort((a, b) => a.label.localeCompare(b.label)),
    { label: 'Sin empresa', value: '__none__', count: machines.filter((m) => !m.company_id).length },
  ];
  const companyFilterLabel = companyOptions.find((o) => o.value === companyFilter)?.label ?? 'Todas las empresas';
  // Empresa seleccionada para sincronizar el reporte (null = todas).
  const reportCompanyName =
    companyFilter === '__all__' ? null : companyFilter === '__none__' ? 'Sin empresa' : companies[companyFilter] ?? null;

  // Agrupa las máquinas mostradas por empresa (acordeón, como en el catálogo).
  const machinesByCompany = (() => {
    const map = new Map<string, { key: string; name: string; items: Machinery[] }>();
    shown.forEach((it) => {
      const k = it.company_id ?? '__none__';
      const name = it.company_id ? companies[it.company_id] || 'Empresa' : 'Sin empresa';
      const g = map.get(k) ?? { key: k, name, items: [] };
      g.items.push(it);
      map.set(k, g);
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  })();

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Control de maquinaria</SectionTitle>

      {notice ? (
        <TouchableOpacity onPress={() => setNotice(null)}>
          <View style={{ backgroundColor: colors.surfaceAlt, borderLeftWidth: 4, borderLeftColor: colors.primary, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm }}>
            <Text style={{ color: colors.text, fontSize: 13 }}>{notice}</Text>
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>Toca para cerrar</Text>
          </View>
        </TouchableOpacity>
      ) : null}

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
        <TouchableOpacity
          onPress={cerrarControl}
          disabled={closing}
          style={{ flex: 2, paddingVertical: spacing.md, backgroundColor: colors.danger, borderRadius: radius.md, alignItems: 'center' }}
        >
          <Text style={{ color: '#fff', fontWeight: '800' }}>{closing ? 'Cerrando…' : '🔒 Cerrar control'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={openHistorico}
          style={{ flex: 1, paddingVertical: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border }}
        >
          <Text style={{ color: colors.text, fontWeight: '700' }}>🗂️ Histórico</Text>
        </TouchableOpacity>
      </View>

      <Card>
        <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 2 }}>Semana del control · elige cualquier día en el calendario</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <TouchableOpacity
            onPress={() => setDate(shiftDay(weekStart, -7))}
            style={{ paddingVertical: spacing.sm, paddingHorizontal: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}
          >
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>◀</Text>
          </TouchableOpacity>
          <View style={{ flex: 1, minWidth: 0 }}>
            <DateField value={date} onChange={(v) => v && setDate(v)} colors={colors} />
          </View>
          <TouchableOpacity
            onPress={() => setDate(shiftDay(weekStart, 7))}
            style={{ paddingVertical: spacing.sm, paddingHorizontal: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}
          >
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>▶</Text>
          </TouchableOpacity>
        </View>
        <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 14, marginTop: spacing.xs }}>
          🗓️ {dayLabel(weekStart)} → {dayLabel(weekEnd)} · {dayCount} día(s)
        </Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, alignItems: 'center' }}>
          <TouchableOpacity
            onPress={() => setDate(todayISO())}
            style={{ flex: 1, paddingVertical: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border }}
          >
            <Text style={{ color: colors.text, fontWeight: '700' }}>📅 Esta semana</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => navigation?.navigate('More', { screen: 'Reports', params: { autoReport: 'rounds', date: weekStart, dateTo: weekEnd, company: reportCompanyName, nonce: Date.now() } })}
            style={{ flex: 1, paddingVertical: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center' }}
          >
            <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>📊 Ver reporte{reportCompanyName ? ' · empresa' : ''}</Text>
          </TouchableOpacity>
        </View>
        {/* Días del bloque: por defecto 7, pero se pueden añadir (8, 10, …). */}
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, alignItems: 'center' }}>
          <Text style={{ color: colors.muted, fontSize: 12, flex: 1 }}>Días en el bloque: {dayCount}</Text>
          <TouchableOpacity
            onPress={() => setDayCount((n) => Math.max(1, n - 1))}
            style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}
          >
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>−</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setDayCount((n) => Math.min(31, n + 1))}
            style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.md, backgroundColor: colors.primary, borderRadius: radius.md }}
          >
            <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 16 }}>+ día</Text>
          </TouchableOpacity>
        </View>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>
          Cada máquina muestra el bloque completo. Por día marca turno de día y de noche (Medio 6h / Completo 12h); cada jornada puede tener su operador.
        </Text>
      </Card>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="🔎 Buscar por nombre, serial o empresa…"
        placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: spacing.sm }}
      />

      {/* Filtro por empresa (desplegable). Al elegir una, el reporte se sincroniza con ella. */}
      <View style={{ marginBottom: spacing.sm }}>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Empresa (se trabaja y se reporta sobre estas máquinas)</Text>
        <TouchableOpacity
          onPress={() => setCompanyPickerOpen(true)}
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}
        >
          <Text style={{ color: colors.text, fontWeight: '700' }}>🏢 {companyFilterLabel}</Text>
          <Text style={{ color: colors.muted, fontSize: 16 }}>▾</Text>
        </TouchableOpacity>
      </View>

      {loading && machines.length === 0 ? (
        <Loading />
      ) : shown.length === 0 ? (
        <EmptyState title={query || companyFilter !== '__all__' ? 'Sin resultados' : 'Sin maquinaria'} subtitle={query || companyFilter !== '__all__' ? 'Prueba con otra búsqueda o empresa.' : 'Agrega máquinas en Equipos.'} />
      ) : (
        machinesByCompany.map((g) => {
          // Colapsadas por defecto; se abren al buscar o al filtrar una empresa.
          const open = expanded[g.key] ?? (!!q || companyFilter !== '__all__');
          return (
            <View key={g.key} style={{ marginBottom: spacing.xs }}>
              <TouchableOpacity
                onPress={() => setExpanded((p) => ({ ...p, [g.key]: !open }))}
                activeOpacity={0.7}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: open ? colors.primary : colors.surfaceAlt, borderWidth: 1, borderColor: open ? colors.primary : colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, marginBottom: spacing.sm }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 }}>
                  <Text style={{ color: open ? colors.primaryContrast : colors.muted, fontSize: 16 }}>{open ? '▾' : '▸'}</Text>
                  <Text style={{ color: open ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>🏢 {g.name}</Text>
                </View>
                <View style={{ backgroundColor: open ? colors.primaryContrast : colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
                  <Text style={{ color: open ? colors.primary : colors.primaryContrast, fontWeight: '800', fontSize: 13 }}>{g.items.length}</Text>
                </View>
              </TouchableOpacity>
              {open ? g.items.map((m) => {
          const weekWorked = weekDays.reduce((s, d) => {
            const b = rounds[rkey(m.id, d)];
            return s + workedFromShifts(Number(b?.day_hours ?? 0), Number(b?.night_hours ?? 0), Number(b?.hours_stopped ?? 0), Number(b?.overtime_hours ?? 0));
          }, 0);
          const isOpen = cardOpen[m.id] ?? true;
          return (
            <Card key={m.id}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
                <TouchableOpacity activeOpacity={0.6} onPress={() => openPrice(m)} style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', color: colors.text, fontSize: 16 }}>
                    {m.code} <Text style={{ color: colors.primary, fontSize: 13 }}>✎</Text>
                  </Text>
                  <Text style={{ color: m.company_id ? colors.primary : colors.muted, fontSize: 13, fontWeight: '600' }}>
                    🏢 {m.company_id ? (companies[m.company_id] ?? 'Empresa') : 'Sin empresa'}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    💵 {m.price_per_hour != null ? `$${Number(m.price_per_hour).toLocaleString()} / hora · toca para editar` : 'Sin precio · toca el nombre para fijarlo'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setCardOpen((p) => ({ ...p, [m.id]: !isOpen }))}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={{ width: 34, height: 34, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ color: colors.muted, fontSize: 16, fontWeight: '800' }}>{isOpen ? '▾' : '▸'}</Text>
                </TouchableOpacity>
              </View>

              {/* Resumen compacto cuando la tarjeta está colapsada. */}
              {!isOpen ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xs }}>
                  <Text style={{ color: m.entry_at && !m.exit_at ? colors.success : colors.muted, fontSize: 12, fontWeight: '700' }}>
                    {m.entry_at && !m.exit_at ? '▶ En obra' : '⏹ Sin entrada activa'}
                  </Text>
                  <Text style={{ color: weekWorked > 0 ? colors.success : colors.muted, fontWeight: '800', fontSize: 14 }}>{weekWorked} h</Text>
                </View>
              ) : null}

              {/* La entrada se MANTIENE hasta la salida, aunque cambie la semana o se cierre. */}
              {isOpen ? (<>
              {m.entry_at && !m.exit_at ? (
                <View style={{ backgroundColor: colors.surfaceAlt, borderLeftWidth: 3, borderLeftColor: colors.success, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4, marginTop: spacing.xs }}>
                  <Text style={{ color: colors.success, fontSize: 12, fontWeight: '700' }}>
                    ▶ En obra desde {fmtDateTime(m.entry_at)} · Trabajando {elapsedSince(m.entry_at)}
                  </Text>
                </View>
              ) : null}

              {/* Entrada / Salida (momento exacto, nivel máquina). */}
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                {(['entry', 'exit'] as const).map((kind) => {
                  const label = kind === 'entry' ? '📥 ENTRADA' : '📤 SALIDA';
                  const dateField = kind === 'entry' ? 'entry_date' : 'exit_date';
                  const atVal = (kind === 'entry' ? m.entry_at : m.exit_at) as string | null;
                  const val = (m as any)[dateField] as string | null;
                  const active = !!val;
                  return (
                    <View key={kind} style={{ flex: 1 }}>
                      <TouchableOpacity
                        onPress={() => setMove(m, kind, !active)}
                        style={{ paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary : colors.surfaceAlt, alignItems: 'center' }}
                      >
                        <Text style={{ color: active ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13 }}>
                          {active ? '✓ ' : ''}{label}
                        </Text>
                      </TouchableOpacity>
                      {active ? (
                        <View style={{ marginTop: 4, gap: 4 }}>
                          <Text style={{ color: kind === 'entry' ? colors.success : colors.text, fontSize: 11, fontWeight: '700' }}>🕒 {fmtDateTime(atVal)}</Text>
                          <DateField value={val ?? ''} onChange={(v) => setMoveDate(m, dateField, v || null)} colors={colors} />
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>

              {/* Bloque de la semana: un sub-bloque por cada día. */}
              <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
                {weekDays.map((dISO) => {
                  const b = rounds[rkey(m.id, dISO)];
                  const dayH = Number(b?.day_hours ?? 0);
                  const nightH = Number(b?.night_hours ?? 0);
                  const stopped = Number(b?.hours_stopped ?? 0);
                  const ot = Number(b?.overtime_hours ?? 0);
                  const worked = workedFromShifts(dayH, nightH, stopped, ot);
                  const ik = `${m.id}|${dISO}`;
                  return (
                    <View key={dISO} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>{dayLabel(dISO)}</Text>
                        <Text style={{ color: worked > 0 ? colors.success : colors.muted, fontWeight: '800', fontSize: 13 }}>{worked} h · {shiftLabel(dayH + nightH)}</Text>
                      </View>
                      {(['day', 'night'] as const).map((which) => {
                        const cur = which === 'day' ? dayH : nightH;
                        const opName = which === 'day' ? b?.day_operator : b?.night_operator;
                        const opCi = which === 'day' ? b?.day_operator_ci : b?.night_operator_ci;
                        return (
                          <View key={which} style={{ marginBottom: 4 }}>
                            <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }}>
                              <Text style={{ width: 20, fontSize: 14, textAlign: 'center' }}>{which === 'day' ? '☀️' : '🌙'}</Text>
                              {SHIFT_OPTS.map((opt) => {
                                const active = cur === opt.hours;
                                const activeBg = opt.hours === 0 ? colors.danger : colors.success;
                                return (
                                  <TouchableOpacity
                                    key={opt.hours}
                                    onPress={() => setShift(m, dISO, which, opt.hours)}
                                    style={{ flex: 1, minHeight: 36, borderRadius: radius.sm, borderWidth: 1, borderColor: active ? activeBg : colors.border, backgroundColor: active ? activeBg : colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}
                                  >
                                    <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '700', fontSize: 11, textAlign: 'center' }}>{opt.label}</Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                            {cur > 0 ? (
                              <TouchableOpacity onPress={() => openOperator(m, dISO, which)} style={{ marginTop: 2, marginLeft: 24 }}>
                                <Text style={{ fontSize: 11, color: opName ? colors.text : colors.warning }}>
                                  👷 {opName ? `${opName}${opCi ? ` · C.I ${opCi}` : ''}` : 'Sin operador · toca'} <Text style={{ color: colors.primary }}>✎</Text>
                                </Text>
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        );
                      })}
                      <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center', marginTop: 2 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 }}>
                          <Text style={{ color: colors.muted, fontSize: 11 }}>⏸ parada</Text>
                          <TextInput
                            value={hoursInput[ik] !== undefined ? hoursInput[ik] : stopped ? String(stopped) : ''}
                            onChangeText={(t) => setHoursInput((p) => ({ ...p, [ik]: t }))}
                            onBlur={() => hoursInput[ik] !== undefined && setHours(m, dISO, hoursInput[ik])}
                            onSubmitEditing={() => hoursInput[ik] !== undefined && setHours(m, dISO, hoursInput[ik])}
                            keyboardType="numeric" placeholder="0" placeholderTextColor={colors.muted}
                            style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: 6, color: colors.text, textAlign: 'right', fontSize: 12 }}
                          />
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 }}>
                          <Text style={{ color: colors.muted, fontSize: 11 }}>➕ extra</Text>
                          <TextInput
                            value={overtimeInput[ik] !== undefined ? overtimeInput[ik] : ot ? String(ot) : ''}
                            onChangeText={(t) => setOvertimeInput((p) => ({ ...p, [ik]: t }))}
                            onBlur={() => overtimeInput[ik] !== undefined && setOvertime(m, dISO, overtimeInput[ik])}
                            onSubmitEditing={() => overtimeInput[ik] !== undefined && setOvertime(m, dISO, overtimeInput[ik])}
                            keyboardType="numeric" placeholder="0" placeholderTextColor={colors.muted}
                            style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: '#0EA5E9', borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: 6, color: colors.text, textAlign: 'right', fontSize: 12 }}
                          />
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>

              <View style={{ marginTop: spacing.sm, paddingTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Total del bloque ({dayCount} día(s))</Text>
                <Text style={{ color: weekWorked > 0 ? colors.success : colors.muted, fontWeight: '800', fontSize: 16 }}>{weekWorked} h</Text>
              </View>
              </>) : null}
            </Card>
          );
              }) : null}
            </View>
          );
        })
      )}

      {/* Lista desplegable de empresas para filtrar */}
      <Modal visible={companyPickerOpen} transparent animationType="fade" onRequestClose={() => setCompanyPickerOpen(false)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setCompanyPickerOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, maxHeight: '75%', overflow: 'hidden' }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16, padding: spacing.md }}>Filtrar por empresa</Text>
            <ScrollView>
              {companyOptions.map((o) => {
                const active = companyFilter === o.value;
                return (
                  <TouchableOpacity
                    key={o.value}
                    onPress={() => { setCompanyFilter(o.value); setCompanyPickerOpen(false); }}
                    style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: active ? colors.surfaceAlt : 'transparent', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}
                  >
                    <Text style={{ color: active ? colors.primary : colors.text, fontWeight: active ? '800' : '500', flex: 1 }}>{o.label}</Text>
                    <View style={{ backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, minWidth: 26, alignItems: 'center' }}>
                      <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 12 }}>{o.count}</Text>
                    </View>
                    {active ? <Text style={{ color: colors.primary, fontWeight: '800' }}>✓</Text> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Modal: precio por hora trabajada → total */}
      <Modal visible={!!priceFor} transparent animationType="fade" onRequestClose={() => setPriceFor(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border }}>
            {priceFor ? (() => {
              const units = weekDays.reduce((s, d) => {
                const b = rounds[rkey(priceFor.id, d)];
                return s + payUnitsFromShifts(Number(b?.day_hours ?? 0), Number(b?.night_hours ?? 0));
              }, 0);
              const price = Number(priceInput.replace(',', '.')) || 0;
              const total = price * units;
              return (
                <>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17, marginBottom: 2 }}>{priceFor.code}</Text>
                  <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.md }}>
                    Precio por jornada (12 h) · bloque {dayLabel(weekStart)} → {dayLabel(weekEnd)}
                  </Text>

                  <Text style={{ color: colors.muted, fontSize: 12 }}>Precio por jornada de 12 h ($)</Text>
                  <TextInput
                    value={priceInput}
                    onChangeText={setPriceInput}
                    keyboardType="numeric"
                    placeholder="0.00"
                    placeholderTextColor={colors.muted}
                    autoFocus
                    style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.text, fontSize: 16, marginTop: 4 }}
                  />

                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md }}>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>Jornadas del bloque (12h=1, 6h=0.5)</Text>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>{Number(units.toFixed(2))}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
                    <Text style={{ color: colors.text, fontWeight: '800' }}>Total del bloque</Text>
                    <Text style={{ color: colors.success, fontWeight: '800', fontSize: 18 }}>${total.toLocaleString()}</Text>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>
                    El precio es por jornada de 12 h: turno completo = precio, medio turno (6 h) = mitad. Ej.: $750 el completo, $375 el medio.
                  </Text>

                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                    <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setPriceFor(null)}>
                      <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary }} onPress={() => savePrice(priceFor, priceInput)}>
                      <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>Guardar precio</Text>
                    </TouchableOpacity>
                  </View>
                </>
              );
            })() : null}
          </View>
        </View>
      </Modal>

      {/* Modal: datos del operador (nombre, apellido, cédula) */}
      <Modal visible={!!opFor} transparent animationType="fade" onRequestClose={() => setOpFor(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }}>
              Operador · {opFor?.which === 'day' ? '☀️ Turno de día' : '🌙 Turno de noche'}
            </Text>
            {opFor ? <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.md }}>{opFor.m.code} · {dayLabel(opFor.d)}</Text> : null}

            <Text style={{ color: colors.muted, fontSize: 12 }}>Nombre</Text>
            <TextInput value={opFirst} onChangeText={setOpFirst} placeholder="Nombre" placeholderTextColor={colors.muted} autoCapitalize="words"
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.text, marginTop: 4, marginBottom: spacing.sm }} />
            <Text style={{ color: colors.muted, fontSize: 12 }}>Apellido</Text>
            <TextInput value={opLast} onChangeText={setOpLast} placeholder="Apellido" placeholderTextColor={colors.muted} autoCapitalize="words"
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.text, marginTop: 4, marginBottom: spacing.sm }} />
            <Text style={{ color: colors.muted, fontSize: 12 }}>Cédula</Text>
            <TextInput value={opCedula} onChangeText={setOpCedula} placeholder="C.I" placeholderTextColor={colors.muted} keyboardType="numeric"
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.text, marginTop: 4 }} />

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
              <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setOpFor(null)}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary }} onPress={saveOperator}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>Guardar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Histórico de cierres */}
      <Modal visible={histOpen} animationType="slide" onRequestClose={() => setHistOpen(false)}>
        <Screen>
          <TouchableOpacity onPress={() => setHistOpen(false)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm }}>
            <Text style={{ color: colors.primary, fontSize: 20, fontWeight: '800' }}>←</Text>
            <Text style={{ color: colors.primary, fontWeight: '700' }}>Volver</Text>
          </TouchableOpacity>
          <SectionTitle>Histórico de controles</SectionTitle>
          {closures.length === 0 ? (
            <EmptyState title="Sin cierres" subtitle="Cierra un control del día y aparecerá aquí para reportarlo." />
          ) : (
            (() => {
              // Agrupar el histórico POR EMPRESA (un cierre con varias empresas sale en cada una).
              const groups = new Map<string, { company: string; items: { c: ControlClosure; machines: number }[] }>();
              closures.forEach((c) => {
                const machs = c.detail?.machines ?? [];
                const perComp = new Map<string, Set<string>>();
                machs.forEach((mm) => {
                  const comp = mm.company || 'Sin empresa';
                  const key = (mm.machineId || mm.serial || mm.code) as string;
                  if (!perComp.has(comp)) perComp.set(comp, new Set());
                  perComp.get(comp)!.add(key);
                });
                if (perComp.size === 0) perComp.set('Sin empresa', new Set());
                perComp.forEach((set, comp) => {
                  if (!groups.has(comp)) groups.set(comp, { company: comp, items: [] });
                  groups.get(comp)!.items.push({ c, machines: set.size });
                });
              });
              const list = Array.from(groups.values()).sort((a, b) =>
                a.company === 'Sin empresa' ? 1 : b.company === 'Sin empresa' ? -1 : a.company.localeCompare(b.company)
              );
              return list.map((g) => (
                <View key={g.company} style={{ marginBottom: spacing.sm }}>
                  <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 15, marginBottom: spacing.xs }}>
                    🏢 {g.company} <Text style={{ color: colors.muted, fontWeight: '600', fontSize: 12 }}>· {g.items.length} cierre(s)</Text>
                  </Text>
                  {g.items.map(({ c, machines }) => {
                    const rng = c.detail?.dateFrom && c.detail?.dateTo && c.detail.dateFrom !== c.detail.dateTo
                      ? `${c.detail.dateFrom} → ${c.detail.dateTo}`
                      : c.detail?.dateFrom ?? c.closure_date;
                    return (
                      <TouchableOpacity key={g.company + c.id} activeOpacity={0.7} onPress={() => { setClosureSearch(''); setClosureExpanded({}); setClosureCompany(g.company); setClosureSel(c); }}>
                        <Card>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text style={{ color: colors.text, fontWeight: '700' }}>📅 {rng}</Text>
                            <Text style={{ color: colors.primary, fontWeight: '800' }}>{machines} máq.</Text>
                          </View>
                          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>Toca para ver e imprimir el reporte</Text>
                        </Card>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ));
            })()
          )}
          <TouchableOpacity style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary }} onPress={() => setHistOpen(false)}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>Cerrar</Text>
          </TouchableOpacity>
        </Screen>
      </Modal>

      {/* Vista previa de un cierre + PDF */}
      <Modal visible={!!closureSel} animationType="slide" onRequestClose={() => setClosureSel(null)}>
        <Screen>
          {closureSel ? (
            <>
              <TouchableOpacity onPress={() => setClosureSel(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm }}>
                <Text style={{ color: colors.primary, fontSize: 20, fontWeight: '800' }}>←</Text>
                <Text style={{ color: colors.primary, fontWeight: '700' }}>Volver</Text>
              </TouchableOpacity>
              <SectionTitle>
                Control {closureSel.detail?.dateFrom && closureSel.detail?.dateTo && closureSel.detail.dateFrom !== closureSel.detail.dateTo
                  ? `del ${closureSel.detail.dateFrom} al ${closureSel.detail.dateTo}`
                  : `del ${closureSel.detail?.dateFrom ?? closureSel.closure_date}`}
              </SectionTitle>
              {closureCompany ? (
                <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '800', marginBottom: 2 }}>🏢 {closureCompany}</Text>
              ) : null}
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
                {(() => { const mm = (closureSel.detail?.machines ?? []).filter((x) => !closureCompany || (x.company || 'Sin empresa') === closureCompany); return `${new Set(mm.map((x) => x.machineId || x.serial || x.code)).size} máquina(s) · ${mm.length} registro(s)`; })()}
              </Text>
              <TextInput
                value={closureSearch}
                onChangeText={setClosureSearch}
                placeholder="🔎 Buscar máquina o empresa..."
                placeholderTextColor={colors.muted}
                style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, backgroundColor: colors.surfaceAlt, marginBottom: spacing.sm }}
              />
              {(() => {
                const usdFmt = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                // Precio por SERIAL (único) y por código (respaldo para datos viejos).
                const priceBySerial = new Map(machines.filter((mm) => mm.serial).map((mm) => [mm.serial as string, Number(mm.price_per_hour) || 0]));
                const priceByCode = new Map(machines.map((mm) => [mm.code, Number(mm.price_per_hour) || 0]));
                // Agrupar los registros del cierre POR MÁQUINA ÚNICA (serial/id, no el nombre que puede repetirse).
                const map = new Map<string, { key: string; code: string; serial: string | null; company: string; days: ClosureMachine[] }>();
                (closureSel.detail?.machines ?? [])
                  .filter((m) => !closureCompany || (m.company || 'Sin empresa') === closureCompany)
                  .forEach((m) => {
                  const key = (m.machineId || m.serial || m.code) as string;
                  const g = map.get(key) ?? { key, code: m.code, serial: m.serial ?? null, company: m.company || '', days: [] };
                  if (!g.company && m.company) g.company = m.company;
                  if (!g.serial && m.serial) g.serial = m.serial;
                  g.days.push(m);
                  map.set(key, g);
                });
                const q = closureSearch.trim().toLowerCase();
                let groups = Array.from(map.values());
                if (q) groups = groups.filter((g) => g.code.toLowerCase().includes(q) || (g.serial || '').toLowerCase().includes(q) || g.company.toLowerCase().includes(q));
                groups.sort((a, b) => a.code.localeCompare(b.code));
                if (groups.length === 0)
                  return <EmptyState title="Sin resultados" subtitle="Ninguna máquina coincide con la búsqueda." />;
                const StatBox = ({ k, v, accent }: { k: string; v: string; accent?: boolean }) => (
                  <View style={{ flex: 1, borderWidth: 1, borderColor: accent ? colors.primary : colors.border, backgroundColor: accent ? colors.primary : colors.surfaceAlt, borderRadius: radius.md, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm }}>
                    <Text style={{ color: accent ? colors.primaryContrast : colors.muted, fontSize: 10 }}>{k}</Text>
                    <Text style={{ color: accent ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 15 }}>{v}</Text>
                  </View>
                );
                return groups.map((g) => {
                  const t = g.days.reduce(
                    (a, m) => ({
                      day: a.day + (Number(m.dayHours) || 0),
                      night: a.night + (Number(m.nightHours) || 0),
                      stopped: a.stopped + (Number(m.hoursStopped) || 0),
                      extra: a.extra + (Number(m.overtime) || 0),
                      worked: a.worked + (Number(m.worked) || 0),
                      units: a.units + payUnitsFromShifts(m.dayHours ?? 0, m.nightHours ?? 0),
                    }),
                    { day: 0, night: 0, stopped: 0, extra: 0, worked: 0, units: 0 }
                  );
                  const price = (g.serial ? priceBySerial.get(g.serial) : undefined) ?? priceByCode.get(g.code) ?? 0;
                  const amount = t.units * price;
                  const open = !!closureExpanded[g.key];
                  return (
                    <Card key={g.key}>
                      <TouchableOpacity activeOpacity={0.7} onPress={() => setClosureExpanded((p) => ({ ...p, [g.key]: !p[g.key] }))}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>{g.code}{g.serial ? <Text style={{ color: colors.muted, fontWeight: '600', fontSize: 12 }}>  ·  {g.serial}</Text> : null}</Text>
                          <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>{open ? '▲ ocultar' : '▼ ver detalle'}</Text>
                        </View>
                        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>🏢 {g.company || 'Sin empresa'} · {g.days.length} día(s)</Text>
                        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                          <StatBox k="Total horas" v={`${t.worked} h`} />
                          <StatBox k="☀️ Día" v={`${t.day} h`} />
                          <StatBox k="🌙 Noche" v={`${t.night} h`} />
                          <StatBox k="💵 Monto" v={price ? usdFmt(amount) : '—'} accent />
                        </View>
                      </TouchableOpacity>
                      {open && (
                        <View style={{ marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: spacing.sm }}>
                          {g.days.map((m, i) => (
                            <View key={i} style={{ gap: 2 }}>
                              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>{m.date ?? ''}</Text>
                              <Text style={{ color: colors.text, fontSize: 12 }}>
                                ☀️ Día {m.dayHours ? `${m.dayHours}h` : '—'} · 👷 {m.dayOperator || 'sin operador'}{m.dayCedula ? ` (C.I ${m.dayCedula})` : ''}
                              </Text>
                              <Text style={{ color: colors.text, fontSize: 12 }}>
                                🌙 Noche {m.nightHours ? `${m.nightHours}h` : '—'} · 👷 {m.nightOperator || 'sin operador'}{m.nightCedula ? ` (C.I ${m.nightCedula})` : ''}
                              </Text>
                              <Text style={{ color: colors.muted, fontSize: 11 }}>
                                {shiftLabel((m.dayHours || 0) + (m.nightHours || 0))} · Parada {m.hoursStopped} h{m.overtime ? ` · Extras ${m.overtime} h` : ''} · Trabajadas {m.worked} h
                              </Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </Card>
                  );
                });
              })()}
              <TouchableOpacity style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary }} onPress={() => downloadClosurePdf(closureSel)}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>⬇️ Descargar PDF</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setClosureSel(null)}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Volver</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </Screen>
      </Modal>
    </Screen>
  );
}
