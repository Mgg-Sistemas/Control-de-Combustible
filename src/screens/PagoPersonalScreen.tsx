import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Alert } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import { supabase } from '../lib/supabase';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { onlyDecimal, norm } from '../lib/text';
import { Company, StaffPayPeriod, StaffPayItem, StaffPayPayment, StaffPayLine } from '../types/database';
import { useTable } from '../hooks/useTable';
import { TabuladorCargos } from '../components/TabuladorCargos';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

// ── Formato / utilidades ──────────────────────────────────────────────────────
const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const usd = (n: number) => `$${round2(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const parseNum = (t: string): number => { const n = Number(String(t ?? '').replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; };
const sumLines = (l: StaffPayLine[]) => (l || []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
const fmtDMY = (iso?: string | null) => { const [y, m, d] = String(iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : (iso || '—'); };

function toISO(d: Date): string { return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`; }
function todayISO(): string { return toISO(new Date()); }
function addDaysISO(iso: string, n: number): string { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return toISO(d); }
/** Domingo→sábado que contiene la fecha. */
function weekRange(iso: string): { from: string; to: string } {
  const d = new Date(iso + 'T12:00:00'); const from = addDaysISO(iso, -d.getDay()); return { from, to: addDaysISO(from, 6) };
}
/** Inicio de semana (domingo) de una fecha — clave para contar semanas trabajadas. */
const weekKey = (iso: string) => weekRange(iso).from;
/** Quincena (1–15 / 16–fin de mes) que contiene la fecha. */
function quincenaRange(iso: string): { from: string; to: string } {
  const [y, m, d] = iso.split('-').map(Number);
  if (d <= 15) return { from: `${y}-${`${m}`.padStart(2, '0')}-01`, to: `${y}-${`${m}`.padStart(2, '0')}-15` };
  const last = new Date(y, m, 0).getDate();
  return { from: `${y}-${`${m}`.padStart(2, '0')}-16`, to: `${y}-${`${m}`.padStart(2, '0')}-${last}` };
}
function rangeFor(type: StaffPayPeriod['period_type'], ref: string): { from: string; to: string } {
  if (type === 'dia') return { from: ref, to: ref };
  if (type === 'semana') return weekRange(ref);
  return quincenaRange(ref);
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  borrador: { label: '📝 Borrador', color: '#F59E0B' },
  aprobada: { label: '✅ Aprobada', color: '#2563EB' },
  pagada: { label: '💵 Pagada', color: '#16A34A' },
};
const TYPE_LABEL: Record<string, string> = { dia: 'Día', semana: 'Semana', quincena: 'Quincena' };
const MODE_LABEL: Record<string, string> = { hora: 'Por hora', dia: 'Por día', semana: 'Por semana' };
const UNIT: Record<string, string> = { hora: 'h', dia: 'd', semana: 'sem' };
const METODOS = ['efectivo', 'pago móvil', 'transferencia', 'otro'];
// El personal se paga SIEMPRE por la organización dueña (SOS LA GUAIRA), no por los
// contratistas. Por eso los períodos no se scopean por empresa: se carga a TODO el
// personal activo y se rotula como SOS LA GUAIRA.
const EMPLEADOR = 'SOS LA GUAIRA';

type Mode = StaffPayPeriod['mode'];
// Regla: SOLO los operadores cobran por día. Un período "Por día" precarga/agrega
// únicamente empleados con cargo operador (los demás se pagan por hora/semana).
const esOperador = (cargo?: string | null) => norm(cargo ?? '').includes('operador');
const soloOperadoresSi = (mode: Mode) => mode === 'dia';
const qtyOf = (it: StaffPayItem, mode: Mode) => Number(mode === 'hora' ? it.horas : mode === 'semana' ? it.semanas : it.dias) || 0;
const priceOf = (it: StaffPayItem, mode: Mode) => Number(mode === 'hora' ? it.precio_hora : mode === 'semana' ? it.precio_semana : it.precio_dia) || 0;
// Jornadas de NOCHE y su precio (solo aplica al modo "Por día").
const nightQty = (it: StaffPayItem) => Number(it.dias_noche) || 0;
const nightPrice = (it: StaffPayItem) => Number(it.precio_noche) || 0;
// Devengado: en "Por día" = (jornadas de DÍA × precio día) + (jornadas de NOCHE × precio noche).
// En "Por hora"/"Por semana" = cantidad × precio (un solo precio).
const devengadoOf = (it: StaffPayItem, mode: Mode) =>
  mode === 'dia'
    ? round2((Number(it.dias) || 0) * (Number(it.precio_dia) || 0) + nightQty(it) * nightPrice(it))
    : round2(qtyOf(it, mode) * priceOf(it, mode));
const totalOf = (it: StaffPayItem, mode: Mode) => round2(devengadoOf(it, mode) + sumLines(it.bonos) - sumLines(it.deducciones));
// Desglose legible del devengado: en "Por día" separa ☀️ día y 🌙 noche; si no, cantidad × precio.
const devDesc = (it: StaffPayItem, mode: Mode): string =>
  mode === 'dia'
    ? `☀️ ${Number(it.dias) || 0} × ${usd(Number(it.precio_dia) || 0)} · 🌙 ${nightQty(it)} × ${usd(nightPrice(it))}`
    : `${qtyOf(it, mode)} ${UNIT[mode]} × ${usd(priceOf(it, mode))}`;

// Agregación de jornadas por cédula: DÍA/NOCHE separadas (validadas y todas), horas y semanas.
type AutoAgg = { diaV: number; nocheV: number; diaAll: number; nocheAll: number; horasV: number; horasAll: number; val: number; pend: number; weeksV: Set<string>; weeksAll: Set<string> };

export default function PagoPersonalScreen() {
  const { colors } = useTheme();
  const { session, role } = useAuth();
  const confirm = useConfirm();
  const puedeTarifa = role !== 'analista'; // analista NO modifica precios

  const { data: periods, loading, refetch } = useTable<StaffPayPeriod>('staff_pay_periods', { orderBy: 'created_at', ascending: false });
  const { data: companies } = useTable<Company>('companies', { orderBy: 'name' });
  // Sin empresa (id null) = personal de la organización → se rotula SOS LA GUAIRA.
  const companyName = (id: string | null) => (id ? companies.find((c) => c.id === id)?.name ?? 'Empresa' : EMPLEADOR);

  // Crear período
  const [createOpen, setCreateOpen] = useState(false);
  const [cCompany, setCCompany] = useState('');
  const [cName, setCName] = useState('');
  const [cType, setCType] = useState<StaffPayPeriod['period_type']>('semana');
  const [cRef] = useState(todayISO());
  const [cFrom, setCFrom] = useState(todayISO());
  const [cTo, setCTo] = useState(todayISO());
  const [cMode, setCMode] = useState<Mode>('dia');
  const [cValid, setCValid] = useState(true);
  const [creating, setCreating] = useState(false);

  // Tabulador de sueldos por cargo (lista desplegable, editable, sincroniza a empleados)
  const [tabOpen, setTabOpen] = useState(false);

  // Detalle
  const [sel, setSel] = useState<StaffPayPeriod | null>(null);
  const [items, setItems] = useState<StaffPayItem[]>([]);
  const [pays, setPays] = useState<StaffPayPayment[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const readOnly = sel?.status !== 'borrador';

  // Editor de renglón
  const [editItem, setEditItem] = useState<StaffPayItem | null>(null);
  const [ePHora, setEPHora] = useState('');
  const [ePDia, setEPDia] = useState('');
  const [ePNoche, setEPNoche] = useState('');   // precio por jornada de NOCHE
  const [ePSemana, setEPSemana] = useState('');
  const [eDias, setEDias] = useState('');
  const [eDiasNoche, setEDiasNoche] = useState(''); // jornadas de NOCHE
  const [eHoras, setEHoras] = useState('');
  const [eSemanas, setESemanas] = useState('');
  const [eBonos, setEBonos] = useState<StaffPayLine[]>([]);
  const [eDed, setEDed] = useState<StaffPayLine[]>([]);
  const [eNote, setENote] = useState('');

  // Abono
  const [payFor, setPayFor] = useState<StaffPayItem | null>(null);
  const [pMonto, setPMonto] = useState('');
  const [pMetodo, setPMetodo] = useState('efectivo');
  const [pFecha, setPFecha] = useState(todayISO());

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  // ── Carga de jornadas automáticas (operadores) para un rango ────────────────
  const buildAuto = async (from: string, to: string) => {
    const [{ data: asg }, { data: vis }] = await Promise.all([
      supabase.from('operator_assignments').select('cedula, machinery_id, work_date, worked_hours, shift').gte('work_date', from).lte('work_date', to),
      supabase.from('supervisor_visits').select('machinery_id, visit_date, status').gte('visit_date', from).lte('visit_date', to),
    ]);
    const valid = new Set((vis ?? []).filter((v: any) => v.status === 'trabajando').map((v: any) => `${v.machinery_id}|${v.visit_date}`));
    const byCed = new Map<string, AutoAgg>();
    (asg ?? []).forEach((r: any) => {
      const g = byCed.get(r.cedula) ?? { diaV: 0, nocheV: 0, diaAll: 0, nocheAll: 0, horasV: 0, horasAll: 0, val: 0, pend: 0, weeksV: new Set<string>(), weeksAll: new Set<string>() };
      const h = Number(r.worked_hours) || 0;
      const wk = weekKey(r.work_date);
      const isVal = valid.has(`${r.machinery_id}|${r.work_date}`);
      const isNight = String(r.shift) === 'night'; // sin turno definido → cuenta como DÍA
      g.horasAll += h; g.weeksAll.add(wk);
      if (isNight) g.nocheAll += 1; else g.diaAll += 1;
      if (isVal) { g.horasV += h; g.val += 1; g.weeksV.add(wk); if (isNight) g.nocheV += 1; else g.diaV += 1; } else g.pend += 1;
      byCed.set(r.cedula, g);
    });
    return byCed;
  };

  const loadDetail = async (p: StaffPayPeriod) => {
    setItemsLoading(true);
    const { data: its } = await supabase.from('staff_pay_items').select('*').eq('period_id', p.id).order('person_name');
    const list = (its ?? []) as StaffPayItem[];
    const ids = list.map((i) => i.id);
    const { data: pp } = ids.length ? await supabase.from('staff_pay_payments').select('*').in('item_id', ids) : { data: [] as StaffPayPayment[] };
    setItems(list);
    setPays((pp ?? []) as StaffPayPayment[]);
    setItemsLoading(false);
  };
  const openDetail = (p: StaffPayPeriod) => { setSel(p); setItems([]); setPays([]); loadDetail(p); };

  const recomputeTotal = async (pid: string, list: StaffPayItem[], mode: Mode) => {
    const total = round2(list.reduce((s, it) => s + totalOf(it, mode), 0));
    await supabase.from('staff_pay_periods').update({ total_amount: total }).eq('id', pid);
    setSel((p) => (p && p.id === pid ? { ...p, total_amount: total } : p));
    refetch();
  };

  // Arma un renglón (item) para un empleado, con precios del trabajador y cantidades auto.
  const rowFor = (e: any, pid: string, g: AutoAgg | undefined, onlyValidated: boolean, mode: Mode) => {
    const precio_hora = Number(e.precio_hora) || 0;
    const precio_dia = Number(e.precio_dia) || 0;
    const precio_noche = Number(e.precio_noche) || 0;
    const precio_semana = Number(e.precio_semana) || 0;
    const source = g ? 'auto' : 'manual';
    const dias = g ? (onlyValidated ? g.diaV : g.diaAll) : 0;        // jornadas de DÍA
    const dias_noche = g ? (onlyValidated ? g.nocheV : g.nocheAll) : 0; // jornadas de NOCHE
    const horas = g ? (onlyValidated ? g.horasV : g.horasAll) : 0;
    const semanas = g ? (onlyValidated ? g.weeksV.size : g.weeksAll.size) : 0;
    const base = { precio_hora, precio_dia, precio_noche, precio_semana, dias, dias_noche, horas, semanas } as StaffPayItem;
    const dev = devengadoOf(base, mode);
    return {
      period_id: pid, employee_id: e.id, cedula: e.cedula, person_name: `${e.first_name} ${e.last_name}`.trim(),
      cargo: e.cargo ?? null, source, precio_hora, precio_dia, precio_noche, precio_semana, dias, dias_noche, horas, semanas,
      jornadas_validadas: g ? g.val : 0, jornadas_pendientes: g ? g.pend : 0, overridden: false,
      devengado: dev, bonos: [], deducciones: [], total: dev, nota: null,
    };
  };

  const EMP_COLS = 'id, first_name, last_name, cedula, cargo, precio_hora, precio_dia, precio_noche, precio_semana';

  // ── Crear período: precarga TODOS los empleados activos con sus precios ──────
  const crearPeriodo = async () => {
    if (!cName.trim()) return Alert.alert('Aviso', 'Escribe el nombre (ej. "Semana 1 - julio").');
    if (!cFrom || !cTo) return Alert.alert('Aviso', 'Define el rango de fechas.');
    setCreating(true);
    // Empleador = SOS LA GUAIRA (company_id null): el personal no se separa por contratista.
    const { data: per, error } = await supabase.from('staff_pay_periods').insert({
      company_id: null, name: cName.trim(), period_type: cType, date_from: cFrom, date_to: cTo,
      mode: cMode, only_validated: cValid, status: 'borrador', created_by: session?.user?.id ?? null,
    }).select().single();
    if (error || !per) { setCreating(false); return Alert.alert('Aviso', error?.message ?? 'No se pudo crear.'); }

    // TODO el personal activo (de toda la organización), no solo el de un contratista.
    const { data: emps } = await supabase.from('employees').select(EMP_COLS).eq('status', 'activo');
    const byCed = await buildAuto(cFrom, cTo);
    // "Por día" → SOLO operadores. En hora/semana entran todos los activos.
    const empList = (emps ?? []).filter((e: any) => !soloOperadoresSi(cMode) || esOperador(e.cargo));
    const rows = empList.map((e: any) => rowFor(e, per.id, byCed.get(e.cedula), cValid, cMode));
    if (rows.length) await supabase.from('staff_pay_items').insert(rows);
    const total = round2(rows.reduce((s, r) => s + r.total, 0));
    await supabase.from('staff_pay_periods').update({ total_amount: total }).eq('id', per.id);
    setCreating(false); setCreateOpen(false); setCName('');
    refetch();
    openDetail({ ...(per as StaffPayPeriod), total_amount: total });
  };

  // ── Recalcular cantidades automáticas (operadores no ajustados a mano) ───────
  const recalcularAuto = async () => {
    if (!sel) return;
    setBusy(true);
    const byCed = await buildAuto(sel.date_from, sel.date_to);
    const updated: StaffPayItem[] = [];
    for (const it of items) {
      if (it.source === 'auto' && !it.overridden) {
        const g = byCed.get(it.cedula ?? '');
        const dias = g ? (sel.only_validated ? g.diaV : g.diaAll) : 0;
        const dias_noche = g ? (sel.only_validated ? g.nocheV : g.nocheAll) : 0;
        const horas = g ? (sel.only_validated ? g.horasV : g.horasAll) : 0;
        const semanas = g ? (sel.only_validated ? g.weeksV.size : g.weeksAll.size) : 0;
        const merged = { ...it, dias, dias_noche, horas, semanas, jornadas_validadas: g ? g.val : 0, jornadas_pendientes: g ? g.pend : 0 };
        const dev = devengadoOf(merged, sel.mode);
        const tot = totalOf(merged, sel.mode);
        const row = { ...merged, devengado: dev, total: tot };
        await supabase.from('staff_pay_items').update({
          dias, dias_noche, horas, semanas, jornadas_validadas: row.jornadas_validadas, jornadas_pendientes: row.jornadas_pendientes,
          devengado: dev, total: tot,
        }).eq('id', it.id);
        updated.push(row);
      } else updated.push(it);
    }
    setItems(updated);
    await recomputeTotal(sel.id, updated, sel.mode);
    setBusy(false);
  };

  // ── Agregar empleados activos que falten ────────────────────────────────────
  const agregarFaltantes = async () => {
    if (!sel) return;
    setBusy(true);
    const { data: emps } = await supabase.from('employees').select(EMP_COLS).eq('status', 'activo');
    const byCed = await buildAuto(sel.date_from, sel.date_to);
    const have = new Set(items.map((i) => i.employee_id));
    // "Por día" → SOLO operadores nuevos. En hora/semana entran todos los activos.
    const rows = (emps ?? [])
      .filter((e: any) => !have.has(e.id) && (!soloOperadoresSi(sel.mode) || esOperador(e.cargo)))
      .map((e: any) => rowFor(e, sel.id, byCed.get(e.cedula), sel.only_validated, sel.mode));
    if (rows.length) await supabase.from('staff_pay_items').insert(rows);
    await loadDetail(sel);
    const { data: fresh } = await supabase.from('staff_pay_items').select('*').eq('period_id', sel.id);
    await recomputeTotal(sel.id, (fresh ?? []) as StaffPayItem[], sel.mode);
    setBusy(false);
    if (!rows.length) Alert.alert('Aviso', soloOperadoresSi(sel.mode) ? 'No hay operadores activos nuevos para agregar (los períodos "Por día" solo incluyen operadores).' : 'No hay empleados activos nuevos para agregar.');
  };

  // ── Editor de renglón ───────────────────────────────────────────────────────
  const openItem = (it: StaffPayItem) => {
    setEditItem(it);
    setEPHora(String(it.precio_hora ?? 0));
    setEPDia(String(it.precio_dia ?? 0));
    setEPNoche(String(it.precio_noche ?? 0));
    setEPSemana(String(it.precio_semana ?? 0));
    setEDias(String(it.dias ?? 0));
    setEDiasNoche(String(it.dias_noche ?? 0));
    setEHoras(String(it.horas ?? 0));
    setESemanas(String(it.semanas ?? 0));
    setEBonos(Array.isArray(it.bonos) ? it.bonos : []);
    setEDed(Array.isArray(it.deducciones) ? it.deducciones : []);
    setENote(it.nota ?? '');
  };
  const guardarItem = async () => {
    if (!editItem || !sel) return;
    const precio_hora = puedeTarifa ? parseNum(ePHora) : Number(editItem.precio_hora) || 0;
    const precio_dia = puedeTarifa ? parseNum(ePDia) : Number(editItem.precio_dia) || 0;
    const precio_noche = puedeTarifa ? parseNum(ePNoche) : Number(editItem.precio_noche) || 0;
    const precio_semana = puedeTarifa ? parseNum(ePSemana) : Number(editItem.precio_semana) || 0;
    const dias = parseNum(eDias); const dias_noche = parseNum(eDiasNoche); const horas = parseNum(eHoras); const semanas = parseNum(eSemanas);
    const bonos = eBonos.filter((l) => l.label?.trim() || l.amount);
    const ded = eDed.filter((l) => l.label?.trim() || l.amount);
    const overridden = editItem.overridden || dias !== Number(editItem.dias) || dias_noche !== Number(editItem.dias_noche) || horas !== Number(editItem.horas) || semanas !== Number(editItem.semanas);
    const merged: StaffPayItem = { ...editItem, precio_hora, precio_dia, precio_noche, precio_semana, dias, dias_noche, horas, semanas, bonos, deducciones: ded };
    const dev = devengadoOf(merged, sel.mode);
    const tot = totalOf(merged, sel.mode);
    const { error } = await supabase.from('staff_pay_items').update({
      precio_hora, precio_dia, precio_noche, precio_semana, dias, dias_noche, horas, semanas, overridden,
      bonos, deducciones: ded, devengado: dev, total: tot, nota: eNote.trim() || null,
    }).eq('id', editItem.id);
    if (error) return Alert.alert('Aviso', error.message);
    // Los precios se guardan también en la ficha del trabajador (persisten para el próximo período).
    if (puedeTarifa && editItem.employee_id) {
      await supabase.from('employees').update({ precio_hora, precio_dia, precio_noche, precio_semana }).eq('id', editItem.employee_id);
    }
    const newItems = items.map((it) => (it.id === editItem.id ? { ...merged, overridden, devengado: dev, total: tot, nota: eNote.trim() || null } : it));
    setItems(newItems);
    await recomputeTotal(sel.id, newItems, sel.mode);
    setEditItem(null);
  };

  const eliminarItem = async (it: StaffPayItem) => {
    if (!sel) return;
    const ok = await confirm({ title: 'Quitar persona', message: `¿Quitar a ${it.person_name} de este período?`, confirmText: 'Quitar', cancelText: 'Cancelar' });
    if (!ok) return;
    await supabase.from('staff_pay_items').delete().eq('id', it.id);
    const newItems = items.filter((x) => x.id !== it.id);
    setItems(newItems);
    setPays((prev) => prev.filter((p) => p.item_id !== it.id));
    await recomputeTotal(sel.id, newItems, sel.mode);
  };

  // ── Abonos ──────────────────────────────────────────────────────────────────
  const paidOf = (itemId: string) => round2(pays.filter((p) => p.item_id === itemId).reduce((s, p) => s + (Number(p.monto) || 0), 0));
  const saldoOf = (it: StaffPayItem) => Math.max(0, round2(Number(it.total) - paidOf(it.id)));

  const openPay = (it: StaffPayItem) => { setPayFor(it); setPMonto(String(saldoOf(it) || '')); setPMetodo('efectivo'); setPFecha(todayISO()); };
  const confirmPay = async () => {
    if (!payFor) return;
    const monto = parseNum(pMonto);
    if (monto <= 0) return Alert.alert('Aviso', 'Ingresa un monto mayor a 0.');
    const { data, error } = await supabase.from('staff_pay_payments').insert({
      item_id: payFor.id, monto, metodo: pMetodo, fecha: pFecha, created_by: session?.user?.id ?? null,
    }).select().single();
    if (error) return Alert.alert('Aviso', error.message);
    setPays((prev) => [...prev, data as StaffPayPayment]);
    setPayFor(null);
  };
  const deleteAbono = async (p: StaffPayPayment) => {
    const ok = await confirm({ title: 'Eliminar abono', message: `¿Eliminar el abono de ${usd(Number(p.monto))}?`, confirmText: 'Eliminar', cancelText: 'Cancelar' });
    if (!ok) return;
    await supabase.from('staff_pay_payments').delete().eq('id', p.id);
    setPays((prev) => prev.filter((x) => x.id !== p.id));
  };

  // ── Estado del período ──────────────────────────────────────────────────────
  const setStatus = async (status: StaffPayPeriod['status']) => {
    if (!sel) return;
    setBusy(true);
    const { error } = await supabase.from('staff_pay_periods').update({ status }).eq('id', sel.id);
    setBusy(false);
    if (error) return Alert.alert('Aviso', error.message);
    setSel({ ...sel, status });
    refetch();
  };
  const eliminarPeriodo = async () => {
    if (!sel) return;
    const ok = await confirm({ title: 'Eliminar período', message: `¿Eliminar "${sel.name}"? Se borran sus renglones y abonos.`, confirmText: 'Eliminar', cancelText: 'Cancelar' });
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase.from('staff_pay_periods').delete().eq('id', sel.id);
    setBusy(false);
    if (error) return Alert.alert('Aviso', error.message);
    setSel(null);
    refetch();
  };

  // ── PDF: recibo por persona ─────────────────────────────────────────────────
  const reciboPdf = async (it: StaffPayItem) => {
    if (!sel) return;
    const pagado = paidOf(it.id); const saldo = saldoOf(it);
    const abonos = pays.filter((p) => p.item_id === it.id).sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
    const dev = devengadoOf(it, sel.mode);
    const html = pdfDocument({
      title: 'Recibo de pago a personal',
      subtitle: `${it.person_name} · ${companyName(sel.company_id)} · ${sel.name}`,
      extraCss: `table{width:100%;border-collapse:collapse;margin-top:10px;font-size:12px}
        th,td{border:1px solid #ccc;padding:6px 8px} th{background:#1E3A5F;color:#fff;text-align:left}
        .tot{font-weight:800;background:#EEF2F7} .net{font-size:20px;font-weight:800;color:#1E3A5F;text-align:right;margin-top:12px}
        .firmas{display:flex;gap:40px;margin-top:58px}
        .firmas .firma{flex:1;text-align:center}
        .firmas .firma .l{border-top:1px solid #1a1a1a;margin:0 8px;padding-top:6px;font-weight:800;color:#1E3A5F;font-size:12px}
        .firmas .firma .s{color:#777;font-size:10px;margin-top:1px}`,
      body: `
        <table><tbody>
          <tr><td>Persona</td><td style="text-align:right">${it.person_name}</td></tr>
          <tr><td>Cargo</td><td style="text-align:right">${it.cargo ?? '—'}</td></tr>
          <tr><td>Cédula</td><td style="text-align:right">${it.cedula ?? '—'}</td></tr>
          <tr><td>Empresa</td><td style="text-align:right">${companyName(sel.company_id)}</td></tr>
          <tr><td>Período</td><td style="text-align:right">${TYPE_LABEL[sel.period_type]} · ${fmtDMY(sel.date_from)} → ${fmtDMY(sel.date_to)}</td></tr>
          <tr><td>Pago</td><td style="text-align:right">${MODE_LABEL[sel.mode]}</td></tr>
          ${sel.mode === 'dia'
            ? `<tr><td>Precio ☀️ día / 🌙 noche</td><td style="text-align:right">${usd(Number(it.precio_dia) || 0)} / ${usd(nightPrice(it))}</td></tr>
               <tr><td>Jornadas ☀️ día / 🌙 noche</td><td style="text-align:right">${Number(it.dias) || 0} / ${nightQty(it)}</td></tr>`
            : `<tr><td>Precio (${MODE_LABEL[sel.mode].toLowerCase()})</td><td style="text-align:right">${usd(priceOf(it, sel.mode))}</td></tr>
               <tr><td>Cantidad</td><td style="text-align:right">${qtyOf(it, sel.mode)} ${UNIT[sel.mode]}</td></tr>`}
          ${it.source === 'auto' ? `<tr><td>Jornadas validadas / pendientes</td><td style="text-align:right">${it.jornadas_validadas} / ${it.jornadas_pendientes}</td></tr>` : ''}
        </tbody></table>
        <table><thead><tr><th>Concepto</th><th style="text-align:right">Monto</th></tr></thead>
        <tbody>
          <tr><td>Devengado (${devDesc(it, sel.mode)})</td><td style="text-align:right">${usd(dev)}</td></tr>
          ${(it.bonos || []).map((l) => `<tr><td>+ Bono: ${l.label || '—'}</td><td style="text-align:right">${usd(l.amount)}</td></tr>`).join('')}
          ${(it.deducciones || []).map((l) => `<tr><td>− Deducción: ${l.label || '—'}</td><td style="text-align:right">−${usd(l.amount)}</td></tr>`).join('')}
          <tr class="tot"><td>Total a pagar</td><td style="text-align:right">${usd(it.total)}</td></tr>
        </tbody></table>
        ${abonos.length ? `<table><thead><tr><th>Abono</th><th>Fecha</th><th>Método</th><th style="text-align:right">Monto</th></tr></thead>
          <tbody>${abonos.map((p, i) => `<tr><td>🟢 Abono ${i + 1}</td><td>${fmtDMY(p.fecha)}</td><td>${p.metodo}</td><td style="text-align:right">${usd(p.monto)}</td></tr>`).join('')}
          <tr class="tot"><td colspan="3" style="text-align:right">Total abonado</td><td style="text-align:right">${usd(pagado)}</td></tr></tbody></table>` : ''}
        <div class="net">Saldo pendiente: ${usd(saldo)}</div>
        <div class="firmas">
          <div class="firma"><div class="l">${it.person_name}</div><div class="s">Recibí conforme${it.cedula ? ' · C.I. ' + it.cedula : ''}</div></div>
          <div class="firma"><div class="l">Administración</div><div class="s">Pagado por</div></div>
        </div>`,
    });
    await exportPdf(html, `Recibo - ${it.person_name}`);
  };

  // ── PDF: reporte del período ────────────────────────────────────────────────
  const reportePdf = async () => {
    if (!sel) return;
    const rows = items.map((it) => {
      const pagado = paidOf(it.id); const saldo = saldoOf(it);
      const precioCell = sel.mode === 'dia'
        ? `☀️ ${usd(Number(it.precio_dia) || 0)}<br/>🌙 ${usd(nightPrice(it))}`
        : usd(priceOf(it, sel.mode));
      const cantCell = sel.mode === 'dia'
        ? `☀️ ${Number(it.dias) || 0}<br/>🌙 ${nightQty(it)}`
        : `${qtyOf(it, sel.mode)} ${UNIT[sel.mode]}`;
      return `<tr><td>${it.person_name}</td><td>${it.cargo ?? '—'}</td>` +
        `<td style="text-align:right">${precioCell}</td>` +
        `<td style="text-align:center">${cantCell}</td>` +
        `<td style="text-align:right">${usd(devengadoOf(it, sel.mode))}</td>` +
        `<td style="text-align:right">${usd(sumLines(it.bonos))}</td>` +
        `<td style="text-align:right">${usd(sumLines(it.deducciones))}</td>` +
        `<td style="text-align:right;font-weight:800">${usd(it.total)}</td>` +
        `<td style="text-align:right;color:#087443">${usd(pagado)}</td>` +
        `<td style="text-align:right;font-weight:700">${usd(saldo)}</td></tr>`;
    }).join('');
    const total = round2(items.reduce((s, it) => s + Number(it.total), 0));
    const pagadoT = round2(items.reduce((s, it) => s + paidOf(it.id), 0));
    const saldoT = round2(items.reduce((s, it) => s + saldoOf(it), 0));
    const html = pdfDocument({
      title: 'Control de pago a personal',
      subtitle: `${companyName(sel.company_id)} · ${sel.name} · ${TYPE_LABEL[sel.period_type]} ${fmtDMY(sel.date_from)} → ${fmtDMY(sel.date_to)} · ${MODE_LABEL[sel.mode]}`,
      extraCss: `table{width:100%;border-collapse:collapse;margin-top:12px;font-size:11px}
        th,td{border:1px solid #ccc;padding:5px 7px;text-align:left} th{background:#1E3A5F;color:#fff}
        tfoot td{background:#EEF2F7;font-weight:800}`,
      body: `
        <table><thead><tr><th>Persona</th><th>Cargo</th><th style="text-align:right">Precio</th><th style="text-align:center">Cant.</th>
          <th style="text-align:right">Devengado</th><th style="text-align:right">Bonos</th><th style="text-align:right">Deducc.</th>
          <th style="text-align:right">Total</th><th style="text-align:right">Pagado</th><th style="text-align:right">Saldo</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="10" style="text-align:center">Sin personal</td></tr>'}</tbody>
        <tfoot><tr><td colspan="7" style="text-align:right">TOTAL (${items.length} persona(s))</td>
          <td style="text-align:right">${usd(total)}</td><td style="text-align:right">${usd(pagadoT)}</td><td style="text-align:right">${usd(saldoT)}</td></tr></tfoot></table>`,
    });
    await exportPdf(html, `Pago personal - ${sel.name}`);
  };

  // Agrupar períodos por empresa.
  const byCompany = useMemo(() => {
    const m = new Map<string, { key: string; name: string; items: StaffPayPeriod[] }>();
    periods.forEach((p) => {
      const k = p.company_id ?? '__none__';
      const g = m.get(k) ?? { key: k, name: companyName(p.company_id), items: [] };
      g.items.push(p);
      m.set(k, g);
    });
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [periods, companies]);

  const totalPagado = useMemo(() => (sel ? round2(items.reduce((s, it) => s + paidOf(it.id), 0)) : 0), [items, pays, sel]);
  const totalSaldo = useMemo(() => (sel ? round2(items.reduce((s, it) => s + saldoOf(it), 0)) : 0), [items, pays, sel]);

  const chip = (on: boolean) => ({ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs } as const);
  const chipTxt = (on: boolean) => ({ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13 } as const);

  const LineEditor = ({ title, lines, setLines, color }: { title: string; lines: StaffPayLine[]; setLines: (l: StaffPayLine[]) => void; color: string }) => (
    <View style={{ marginTop: spacing.sm }}>
      <Text style={{ color, fontWeight: '800', fontSize: 13, marginBottom: 4 }}>{title}</Text>
      {lines.map((l, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: 4, alignItems: 'center' }}>
          <TextInput value={l.label} onChangeText={(t) => setLines(lines.map((x, j) => (j === i ? { ...x, label: t } : x)))} editable={!readOnly} placeholder="Concepto" placeholderTextColor={colors.muted} style={{ ...input, flex: 2 }} />
          <TextInput value={l.amount ? String(l.amount) : ''} onChangeText={(t) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: parseNum(t) } : x)))} editable={!readOnly} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.muted} style={{ ...input, flex: 1, textAlign: 'right' }} />
          <TouchableOpacity onPress={() => setLines(lines.filter((_, j) => j !== i))} disabled={readOnly} style={{ padding: spacing.xs }}>
            <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 16 }}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}
      {!readOnly ? (
        <TouchableOpacity onPress={() => setLines([...lines, { label: '', amount: 0 }])} style={{ paddingVertical: spacing.xs, alignItems: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: color, borderRadius: radius.md }}>
          <Text style={{ color, fontWeight: '700', fontSize: 12 }}>+ Agregar {title.toLowerCase()}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  // Vista previa del renglón en edición.
  const previewItem: StaffPayItem | null = editItem && sel ? {
    ...editItem,
    precio_hora: puedeTarifa ? parseNum(ePHora) : editItem.precio_hora,
    precio_dia: puedeTarifa ? parseNum(ePDia) : editItem.precio_dia,
    precio_noche: puedeTarifa ? parseNum(ePNoche) : editItem.precio_noche,
    precio_semana: puedeTarifa ? parseNum(ePSemana) : editItem.precio_semana,
    dias: parseNum(eDias), dias_noche: parseNum(eDiasNoche), horas: parseNum(eHoras), semanas: parseNum(eSemanas), bonos: eBonos, deducciones: eDed,
  } : null;

  return (
    <Screen>
      <ConfigBanner />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>Pago a personal</SectionTitle>
        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          <TouchableOpacity onPress={() => setTabOpen(true)} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
            <Text style={{ color: colors.primary, fontWeight: '800' }}>🏷️ Tabulador</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setCCompany(''); setCName(''); setCType('semana'); const r = rangeFor('semana', cRef); setCFrom(r.from); setCTo(r.to); setCMode('dia'); setCValid(true); setCreateOpen(true); }} style={{ backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>+ Nuevo</Text>
          </TouchableOpacity>
        </View>
      </View>
      <TabuladorCargos visible={tabOpen} onClose={() => setTabOpen(false)} canEdit={puedeTarifa} onSynced={refetch} />
      <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>💡 El sueldo se define en el "🏷️ Tabulador" por cargo y se sincroniza a los empleados (no uno por uno).</Text>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
        Paga por precio por hora, día o semana, definido por trabajador. Los operadores cargan sus jornadas solos; el resto se ajusta a mano. Los períodos "Por día" incluyen SOLO a los operadores.
      </Text>

      {loading && periods.length === 0 ? (
        <Loading />
      ) : periods.length === 0 ? (
        <EmptyState title="Sin períodos" subtitle="Toca “+ Nuevo” para crear el primer pago a personal." />
      ) : (
        byCompany.map((g) => (
          <View key={g.key} style={{ marginBottom: spacing.sm }}>
            <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 15, marginBottom: spacing.xs }}>🏢 {g.name}</Text>
            {g.items.map((p) => {
              const st = STATUS_META[p.status] ?? STATUS_META.borrador;
              return (
                <TouchableOpacity key={p.id} activeOpacity={0.7} onPress={() => openDetail(p)}>
                  <Card>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>{p.name}</Text>
                      <Text style={{ color: st.color, fontWeight: '800', fontSize: 12 }}>{st.label}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>{TYPE_LABEL[p.period_type]} · {fmtDMY(p.date_from)} → {fmtDMY(p.date_to)} · {MODE_LABEL[p.mode]}</Text>
                      <Text style={{ color: colors.success, fontWeight: '800', fontSize: 15 }}>{usd(p.total_amount)}</Text>
                    </View>
                  </Card>
                </TouchableOpacity>
              );
            })}
          </View>
        ))
      )}

      {/* Modal: crear período */}
      <Modal visible={createOpen} transparent animationType="slide" onRequestClose={() => setCreateOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: '92%' }}>
            <ScrollView>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18, marginBottom: spacing.md }}>Nuevo pago a personal</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Empresa</Text>
              <View style={{ ...chip(true), alignSelf: 'flex-start', marginTop: spacing.xs, marginBottom: spacing.xs, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={chipTxt(true)}>🏢 {EMPLEADOR}</Text>
              </View>
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.xs }}>Se carga a TODO el personal activo (el pago es por {EMPLEADOR}, no por contratista).</Text>

              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Nombre (ej. "Semana 1 - julio")</Text>
              <TextInput value={cName} onChangeText={setCName} placeholder="Nombre del período" placeholderTextColor={colors.muted} style={input} />

              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Período (rango de fechas)</Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
                {(['dia', 'semana', 'quincena'] as const).map((t) => (
                  <TouchableOpacity key={t} onPress={() => { setCType(t); const r = rangeFor(t, cRef); setCFrom(r.from); setCTo(r.to); }} style={{ flex: 1, ...chip(cType === t), alignItems: 'center' }}>
                    <Text style={chipTxt(cType === t)}>{TYPE_LABEL[t]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                <View style={{ flex: 1 }}><Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Desde</Text><DateField value={cFrom} onChange={setCFrom} /></View>
                <View style={{ flex: 1 }}><Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Hasta</Text><DateField value={cTo} onChange={setCTo} /></View>
              </View>

              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Pago por</Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
                {(['hora', 'dia', 'semana'] as const).map((mo) => (
                  <TouchableOpacity key={mo} onPress={() => setCMode(mo)} style={{ flex: 1, ...chip(cMode === mo), alignItems: 'center' }}>
                    <Text style={chipTxt(cMode === mo)}>{MODE_LABEL[mo]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {cMode === 'dia' ? (
                <Text style={{ color: colors.warning, fontSize: 11, marginTop: 4, fontWeight: '700' }}>
                  ⚠️ "Por día" precarga SOLO a los operadores. Al resto se le paga por hora o semana.
                </Text>
              ) : null}

              <TouchableOpacity onPress={() => setCValid((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md }}>
                <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: cValid ? colors.primary : colors.border, backgroundColor: cValid ? colors.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {cValid ? <Text style={{ color: colors.primaryContrast, fontWeight: '900', fontSize: 14 }}>✓</Text> : null}
                </View>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>Solo jornadas validadas por el supervisor</Text>
              </TouchableOpacity>
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>Sin visita del supervisor (máquina + día), la jornada del operador queda pendiente y no suma.</Text>

              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setCreateOpen(false)}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={{ flex: 2, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary, opacity: creating ? 0.7 : 1 }} onPress={crearPeriodo} disabled={creating}>
                  <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>{creating ? 'Creando…' : 'Crear y precargar personal'}</Text>
                </TouchableOpacity>
              </View>
              <View style={{ height: spacing.lg }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Modal: detalle del período */}
      <Modal visible={!!sel} animationType="slide" onRequestClose={() => setSel(null)}>
        <Screen>
          {sel ? (
            <ScrollView>
              <TouchableOpacity onPress={() => setSel(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm }}>
                <Text style={{ color: colors.primary, fontSize: 20, fontWeight: '800' }}>←</Text>
                <Text style={{ color: colors.primary, fontWeight: '700' }}>Volver</Text>
              </TouchableOpacity>
              <SectionTitle>{sel.name}</SectionTitle>
              <Card>
                <Text style={{ color: colors.text, fontWeight: '700' }}>🏢 {companyName(sel.company_id)}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{TYPE_LABEL[sel.period_type]} · {fmtDMY(sel.date_from)} → {fmtDMY(sel.date_to)} · {MODE_LABEL[sel.mode]}{sel.only_validated ? ' · solo validadas' : ''}</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xs }}>
                  <Text style={{ color: (STATUS_META[sel.status] ?? STATUS_META.borrador).color, fontWeight: '800' }}>{(STATUS_META[sel.status] ?? STATUS_META.borrador).label}</Text>
                  <Text style={{ color: colors.success, fontWeight: '800', fontSize: 18 }}>{usd(sel.total_amount)}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
                  <Text style={{ color: '#087443', fontSize: 12, fontWeight: '700' }}>Pagado {usd(totalPagado)}</Text>
                  <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700' }}>Saldo {usd(totalSaldo)}</Text>
                </View>
              </Card>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
                {sel.status === 'borrador' ? (
                  <>
                    <TouchableOpacity onPress={recalcularAuto} disabled={busy} style={{ flexGrow: 1, flexBasis: 130, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}>
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>{busy ? '…' : '🔄 Recalcular jornadas'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={agregarFaltantes} disabled={busy} style={{ flexGrow: 1, flexBasis: 130, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}>
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>＋ Personal faltante</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setStatus('aprobada')} disabled={busy} style={{ flexGrow: 1, flexBasis: 100, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: '#2563EB' }}>
                      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>✅ Aprobar</Text>
                    </TouchableOpacity>
                  </>
                ) : null}
                {sel.status === 'aprobada' ? (
                  <TouchableOpacity onPress={() => setStatus('pagada')} disabled={busy} style={{ flexGrow: 1, flexBasis: 100, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: '#16A34A' }}>
                    <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>💵 Marcar pagada</Text>
                  </TouchableOpacity>
                ) : null}
                {sel.status !== 'borrador' ? (
                  <TouchableOpacity onPress={() => setStatus('borrador')} disabled={busy} style={{ flexGrow: 1, flexBasis: 100, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>↩ Reabrir</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity onPress={reportePdf} style={{ flexGrow: 1, flexBasis: 100, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: '#111827' }}>
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>⬇️ Reporte</Text>
                </TouchableOpacity>
              </View>

              {itemsLoading ? (
                <Loading />
              ) : items.length === 0 ? (
                <EmptyState title="Sin personal" subtitle="No hay empleados activos en esta empresa. Agrégalos en Empleados y usa “Personal faltante”." />
              ) : (
                items.map((it) => {
                  const pagado = paidOf(it.id); const saldo = saldoOf(it);
                  const abonos = pays.filter((p) => p.item_id === it.id);
                  return (
                    <Card key={it.id}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{it.person_name}</Text>
                          <Text style={{ color: colors.muted, fontSize: 12 }}>
                            {[it.cargo, it.source === 'auto' ? '⚙️ operador (auto)' : '✍️ manual'].filter(Boolean).join(' · ')}
                          </Text>
                          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                            {devDesc(it, sel.mode)} = {usd(devengadoOf(it, sel.mode))}
                            {sumLines(it.bonos) ? ` · +${usd(sumLines(it.bonos))}` : ''}{sumLines(it.deducciones) ? ` · −${usd(sumLines(it.deducciones))}` : ''}
                          </Text>
                          {it.source === 'auto' && it.jornadas_pendientes > 0 ? (
                            <Text style={{ color: colors.warning, fontSize: 11, marginTop: 2 }}>⚠️ {it.jornadas_pendientes} jornada(s) sin validar (no suman)</Text>
                          ) : null}
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={{ color: colors.success, fontWeight: '800', fontSize: 16 }}>{usd(it.total)}</Text>
                          {pagado > 0 ? <Text style={{ color: saldo > 0 ? colors.danger : '#087443', fontSize: 11, fontWeight: '700' }}>{saldo > 0 ? `saldo ${usd(saldo)}` : '✓ pagado'}</Text> : null}
                        </View>
                      </View>
                      {abonos.length ? (
                        <View style={{ marginTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs }}>
                          {abonos.map((p) => (
                            <View key={p.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                              <Text style={{ color: colors.muted, fontSize: 11 }}>🟢 {fmtDMY(p.fecha)} · {p.metodo}</Text>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                                <Text style={{ color: '#087443', fontSize: 12, fontWeight: '700' }}>{usd(p.monto)}</Text>
                                {sel.status !== 'pagada' ? <TouchableOpacity onPress={() => deleteAbono(p)}><Text style={{ color: colors.danger, fontSize: 12 }}>✕</Text></TouchableOpacity> : null}
                              </View>
                            </View>
                          ))}
                        </View>
                      ) : null}
                      <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
                        <TouchableOpacity onPress={() => openItem(it)} style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: readOnly ? colors.surfaceAlt : colors.primary, borderWidth: readOnly ? 1 : 0, borderColor: colors.border }}>
                          <Text style={{ color: readOnly ? colors.text : colors.primaryContrast, fontWeight: '700', fontSize: 12 }}>{readOnly ? '👁 Ver' : '✎ Editar'}</Text>
                        </TouchableOpacity>
                        {saldo > 0 && sel.status !== 'borrador' ? (
                          <TouchableOpacity onPress={() => openPay(it)} style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: '#16A34A' }}>
                            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>💵 Abonar</Text>
                          </TouchableOpacity>
                        ) : null}
                        <TouchableOpacity onPress={() => reciboPdf(it)} style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}>
                          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>🧾 Recibo</Text>
                        </TouchableOpacity>
                      </View>
                    </Card>
                  );
                })
              )}

              {sel.status === 'borrador' ? (
                <TouchableOpacity onPress={eliminarPeriodo} disabled={busy} style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.danger }}>
                  <Text style={{ color: colors.danger, fontWeight: '700' }}>🗑️ Eliminar período</Text>
                </TouchableOpacity>
              ) : null}
              <View style={{ height: spacing.xl }} />
            </ScrollView>
          ) : null}
        </Screen>
      </Modal>

      {/* Modal: editor de renglón */}
      <Modal visible={!!editItem} transparent animationType="slide" onRequestClose={() => setEditItem(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: '92%' }}>
            {editItem && sel && previewItem ? (
              <ScrollView>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }}>{editItem.person_name}</Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
                  {[editItem.cargo, editItem.source === 'auto' ? 'operador (auto)' : 'manual'].filter(Boolean).join(' · ')}
                </Text>

                <Text style={{ color: colors.muted, fontSize: 12 }}>Precios del trabajador{!puedeTarifa ? ' — solo lectura' : ''}{sel.mode === 'dia' ? ' · en "Por día" se usan precio DÍA y precio NOCHE' : ''}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs }}>
                  <View style={{ flexGrow: 1, flexBasis: '47%' }}>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>Precio hora ($){sel.mode === 'hora' ? ' ✓' : ''}</Text>
                    <TextInput value={ePHora} onChangeText={(t) => setEPHora(onlyDecimal(t))} keyboardType="numeric" editable={!readOnly && puedeTarifa} style={{ ...input, opacity: puedeTarifa ? 1 : 0.6 }} />
                  </View>
                  <View style={{ flexGrow: 1, flexBasis: '47%' }}>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>Precio semana ($){sel.mode === 'semana' ? ' ✓' : ''}</Text>
                    <TextInput value={ePSemana} onChangeText={(t) => setEPSemana(onlyDecimal(t))} keyboardType="numeric" editable={!readOnly && puedeTarifa} style={{ ...input, opacity: puedeTarifa ? 1 : 0.6 }} />
                  </View>
                  <View style={{ flexGrow: 1, flexBasis: '47%' }}>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>☀️ Precio día ($){sel.mode === 'dia' ? ' ✓' : ''}</Text>
                    <TextInput value={ePDia} onChangeText={(t) => setEPDia(onlyDecimal(t))} keyboardType="numeric" editable={!readOnly && puedeTarifa} style={{ ...input, opacity: puedeTarifa ? 1 : 0.6 }} />
                  </View>
                  <View style={{ flexGrow: 1, flexBasis: '47%' }}>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>🌙 Precio noche ($){sel.mode === 'dia' ? ' ✓' : ''}</Text>
                    <TextInput value={ePNoche} onChangeText={(t) => setEPNoche(onlyDecimal(t))} keyboardType="numeric" editable={!readOnly && puedeTarifa} style={{ ...input, opacity: puedeTarifa ? 1 : 0.6 }} />
                  </View>
                </View>
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>Los precios se guardan en la ficha del trabajador para el próximo período.</Text>

                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Cantidad trabajada</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs }}>
                  <View style={{ flexGrow: 1, flexBasis: '47%' }}>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>Horas{sel.mode === 'hora' ? ' ✓' : ''}</Text>
                    <TextInput value={eHoras} onChangeText={(t) => setEHoras(onlyDecimal(t))} keyboardType="numeric" editable={!readOnly} style={input} />
                  </View>
                  <View style={{ flexGrow: 1, flexBasis: '47%' }}>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>Semanas{sel.mode === 'semana' ? ' ✓' : ''}</Text>
                    <TextInput value={eSemanas} onChangeText={(t) => setESemanas(onlyDecimal(t))} keyboardType="numeric" editable={!readOnly} style={input} />
                  </View>
                  <View style={{ flexGrow: 1, flexBasis: '47%' }}>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>☀️ Jornadas día{sel.mode === 'dia' ? ' ✓' : ''}</Text>
                    <TextInput value={eDias} onChangeText={(t) => setEDias(onlyDecimal(t))} keyboardType="numeric" editable={!readOnly} style={input} />
                  </View>
                  <View style={{ flexGrow: 1, flexBasis: '47%' }}>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>🌙 Jornadas noche{sel.mode === 'dia' ? ' ✓' : ''}</Text>
                    <TextInput value={eDiasNoche} onChangeText={(t) => setEDiasNoche(onlyDecimal(t))} keyboardType="numeric" editable={!readOnly} style={input} />
                  </View>
                </View>
                {editItem.source === 'auto' ? (
                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>Auto: {editItem.jornadas_validadas} validada(s) · {editItem.jornadas_pendientes} pendiente(s). Si editas la cantidad, queda como ajuste manual.</Text>
                ) : null}

                <LineEditor title="Bonos" lines={eBonos} setLines={setEBonos} color={colors.success} />
                <LineEditor title="Deducciones" lines={eDed} setLines={setEDed} color={colors.danger} />

                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Nota (opcional)</Text>
                <TextInput value={eNote} onChangeText={setENote} editable={!readOnly} placeholder="Observación…" placeholderTextColor={colors.muted} style={input} />

                <View style={{ marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>Devengado: {devDesc(previewItem, sel.mode)}</Text>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>{usd(devengadoOf(previewItem, sel.mode))}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                    <Text style={{ color: colors.text, fontWeight: '800' }}>Total a pagar</Text>
                    <Text style={{ color: colors.success, fontWeight: '800', fontSize: 20 }}>{usd(totalOf(previewItem, sel.mode))}</Text>
                  </View>
                </View>

                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                  <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setEditItem(null)}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>{readOnly ? 'Cerrar' : 'Cancelar'}</Text>
                  </TouchableOpacity>
                  {!readOnly ? (
                    <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary }} onPress={guardarItem}>
                      <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>Guardar</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                {!readOnly && editItem.source === 'manual' ? (
                  <TouchableOpacity onPress={() => { setEditItem(null); eliminarItem(editItem); }} style={{ marginTop: spacing.sm, padding: spacing.sm, alignItems: 'center' }}>
                    <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>🗑️ Quitar del período</Text>
                  </TouchableOpacity>
                ) : null}
                <View style={{ height: spacing.lg }} />
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Modal: abono */}
      <Modal visible={!!payFor} transparent animationType="slide" onRequestClose={() => setPayFor(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg }}>
            {payFor ? (
              <>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }}>Abonar a {payFor.person_name}</Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>Total {usd(payFor.total)} · saldo {usd(saldoOf(payFor))}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Monto del abono ($)</Text>
                <TextInput value={pMonto} onChangeText={(t) => setPMonto(onlyDecimal(t))} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.muted} style={input} />
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Método</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
                  {METODOS.map((m) => (
                    <TouchableOpacity key={m} onPress={() => setPMetodo(m)} style={chip(pMetodo === m)}><Text style={chipTxt(pMetodo === m)}>{m}</Text></TouchableOpacity>
                  ))}
                </View>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Fecha</Text>
                <DateField value={pFecha} onChange={setPFecha} />
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                  <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setPayFor(null)}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: '#16A34A' }} onPress={confirmPay}>
                    <Text style={{ color: '#fff', fontWeight: '800' }}>Registrar abono</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
