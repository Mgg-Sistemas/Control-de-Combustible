import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Alert } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import { supabase } from '../lib/supabase';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { onlyDecimal } from '../lib/text';
import {
  Company, StaffPayConfig, StaffPayPeriod, StaffPayItem, StaffPayPayment, StaffPayLine,
} from '../types/database';
import { useTable } from '../hooks/useTable';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

// ── Formato / utilidades ──────────────────────────────────────────────────────
const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const round4 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
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
const METODOS = ['efectivo', 'pago móvil', 'transferencia', 'otro'];

const devengadoOf = (it: StaffPayItem, mode: StaffPayPeriod['mode']) =>
  round2(mode === 'horas' ? Number(it.horas) * Number(it.tarifa_hora) : Number(it.dias) * Number(it.tarifa_dia));
const totalOf = (it: StaffPayItem, mode: StaffPayPeriod['mode']) =>
  round2(devengadoOf(it, mode) + sumLines(it.bonos) - sumLines(it.deducciones));

type AutoAgg = { diasV: number; horasV: number; diasAll: number; horasAll: number; val: number; pend: number };

export default function PagoPersonalScreen() {
  const { colors } = useTheme();
  const { session, role } = useAuth();
  const confirm = useConfirm();
  const puedeTarifa = role !== 'analista'; // analista NO modifica sueldo base ni divisores

  const { data: periods, loading, refetch } = useTable<StaffPayPeriod>('staff_pay_periods', { orderBy: 'created_at', ascending: false });
  const { data: companies } = useTable<Company>('companies', { orderBy: 'name' });
  const companyName = (id: string | null) => (id ? companies.find((c) => c.id === id)?.name ?? 'Empresa' : 'Sin empresa');

  const [cfg, setCfg] = useState<StaffPayConfig>({ id: 1, dias_mes: 30, horas_mes: 240, updated_at: '' });

  // Crear período
  const [createOpen, setCreateOpen] = useState(false);
  const [cCompany, setCCompany] = useState('');
  const [cName, setCName] = useState('');
  const [cType, setCType] = useState<StaffPayPeriod['period_type']>('semana');
  const [cRef, setCRef] = useState(todayISO());
  const [cFrom, setCFrom] = useState(todayISO());
  const [cTo, setCTo] = useState(todayISO());
  const [cMode, setCMode] = useState<StaffPayPeriod['mode']>('dias');
  const [cValid, setCValid] = useState(true);
  const [creating, setCreating] = useState(false);

  // Config de divisores
  const [cfgOpen, setCfgOpen] = useState(false);
  const [dDias, setDDias] = useState('30');
  const [dHoras, setDHoras] = useState('240');

  // Detalle
  const [sel, setSel] = useState<StaffPayPeriod | null>(null);
  const [items, setItems] = useState<StaffPayItem[]>([]);
  const [pays, setPays] = useState<StaffPayPayment[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const readOnly = sel?.status !== 'borrador';

  // Editor de renglón
  const [editItem, setEditItem] = useState<StaffPayItem | null>(null);
  const [eBase, setEBase] = useState('');
  const [eDias, setEDias] = useState('');
  const [eHoras, setEHoras] = useState('');
  const [eBonos, setEBonos] = useState<StaffPayLine[]>([]);
  const [eDed, setEDed] = useState<StaffPayLine[]>([]);
  const [eNote, setENote] = useState('');

  // Abono
  const [payFor, setPayFor] = useState<StaffPayItem | null>(null);
  const [pMonto, setPMonto] = useState('');
  const [pMetodo, setPMetodo] = useState('efectivo');
  const [pFecha, setPFecha] = useState(todayISO());

  useEffect(() => {
    supabase.from('staff_pay_config').select('*').eq('id', 1).single().then(({ data }) => {
      if (data) { setCfg(data as StaffPayConfig); setDDias(String(data.dias_mes)); setDHoras(String(data.horas_mes)); }
    });
  }, []);

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  // ── Carga de jornadas automáticas (operadores) para un rango ────────────────
  const buildAuto = async (from: string, to: string) => {
    const [{ data: asg }, { data: vis }] = await Promise.all([
      supabase.from('operator_assignments').select('cedula, machinery_id, work_date, worked_hours').gte('work_date', from).lte('work_date', to),
      supabase.from('supervisor_visits').select('machinery_id, visit_date, status').gte('visit_date', from).lte('visit_date', to),
    ]);
    const valid = new Set((vis ?? []).filter((v: any) => v.status === 'trabajando').map((v: any) => `${v.machinery_id}|${v.visit_date}`));
    const byCed = new Map<string, AutoAgg>();
    (asg ?? []).forEach((r: any) => {
      const g = byCed.get(r.cedula) ?? { diasV: 0, horasV: 0, diasAll: 0, horasAll: 0, val: 0, pend: 0 };
      const h = Number(r.worked_hours) || 0;
      const isVal = valid.has(`${r.machinery_id}|${r.work_date}`);
      g.diasAll += 1; g.horasAll += h;
      if (isVal) { g.diasV += 1; g.horasV += h; g.val += 1; } else g.pend += 1;
      byCed.set(r.cedula, g);
    });
    return byCed;
  };

  const loadDetail = async (p: StaffPayPeriod) => {
    setItemsLoading(true);
    const { data: its } = await supabase.from('staff_pay_items').select('*').eq('period_id', p.id).order('person_name');
    const list = (its ?? []) as StaffPayItem[];
    const ids = list.map((i) => i.id);
    const { data: pp } = ids.length
      ? await supabase.from('staff_pay_payments').select('*').in('item_id', ids)
      : { data: [] as StaffPayPayment[] };
    setItems(list);
    setPays((pp ?? []) as StaffPayPayment[]);
    setItemsLoading(false);
  };
  const openDetail = (p: StaffPayPeriod) => { setSel(p); setItems([]); setPays([]); loadDetail(p); };

  const recomputeTotal = async (pid: string, list: StaffPayItem[], mode: StaffPayPeriod['mode']) => {
    const total = round2(list.reduce((s, it) => s + totalOf(it, mode), 0));
    await supabase.from('staff_pay_periods').update({ total_amount: total }).eq('id', pid);
    setSel((p) => (p && p.id === pid ? { ...p, total_amount: total } : p));
    refetch();
  };

  // ── Crear período: precarga TODOS los empleados activos; operadores con sus jornadas ──
  const crearPeriodo = async () => {
    if (!cCompany) return Alert.alert('Aviso', 'Elige la empresa.');
    if (!cName.trim()) return Alert.alert('Aviso', 'Escribe el nombre (ej. "Semana 1 - julio").');
    if (!cFrom || !cTo) return Alert.alert('Aviso', 'Define el rango de fechas.');
    setCreating(true);
    const { data: per, error } = await supabase.from('staff_pay_periods').insert({
      company_id: cCompany, name: cName.trim(), period_type: cType, date_from: cFrom, date_to: cTo,
      mode: cMode, only_validated: cValid, status: 'borrador', created_by: session?.user?.id ?? null,
    }).select().single();
    if (error || !per) { setCreating(false); return Alert.alert('Aviso', error?.message ?? 'No se pudo crear.'); }

    const { data: emps } = await supabase.from('employees')
      .select('id, first_name, last_name, cedula, cargo, base_salary').eq('company_id', cCompany).eq('status', 'activo');
    const byCed = await buildAuto(cFrom, cTo);
    const rows = (emps ?? []).map((e: any) => {
      const base = Number(e.base_salary) || 0;
      const tarifa_dia = round4(base / (cfg.dias_mes || 30));
      const tarifa_hora = round4(base / (cfg.horas_mes || 240));
      const g = byCed.get(e.cedula);
      const source = g ? 'auto' : 'manual';
      const dias = g ? (cValid ? g.diasV : g.diasAll) : 0;
      const horas = g ? (cValid ? g.horasV : g.horasAll) : 0;
      const dev = round2(cMode === 'horas' ? horas * tarifa_hora : dias * tarifa_dia);
      return {
        period_id: per.id, employee_id: e.id, cedula: e.cedula, person_name: `${e.first_name} ${e.last_name}`.trim(),
        cargo: e.cargo ?? null, source, base_salary: base, tarifa_dia, tarifa_hora, dias, horas,
        jornadas_validadas: g ? g.val : 0, jornadas_pendientes: g ? g.pend : 0, overridden: false,
        devengado: dev, bonos: [], deducciones: [], total: dev, nota: null,
      };
    });
    if (rows.length) await supabase.from('staff_pay_items').insert(rows);
    const total = round2(rows.reduce((s, r) => s + r.total, 0));
    await supabase.from('staff_pay_periods').update({ total_amount: total }).eq('id', per.id);
    setCreating(false); setCreateOpen(false); setCName('');
    refetch();
    openDetail({ ...(per as StaffPayPeriod), total_amount: total });
  };

  // ── Recalcular jornadas automáticas (operadores no ajustados a mano) ─────────
  const recalcularAuto = async () => {
    if (!sel) return;
    setBusy(true);
    const byCed = await buildAuto(sel.date_from, sel.date_to);
    const updated: StaffPayItem[] = [];
    for (const it of items) {
      if (it.source === 'auto' && !it.overridden) {
        const g = byCed.get(it.cedula ?? '');
        const dias = g ? (sel.only_validated ? g.diasV : g.diasAll) : 0;
        const horas = g ? (sel.only_validated ? g.horasV : g.horasAll) : 0;
        const merged = { ...it, dias, horas, jornadas_validadas: g ? g.val : 0, jornadas_pendientes: g ? g.pend : 0 };
        const dev = devengadoOf(merged, sel.mode);
        const tot = totalOf(merged, sel.mode);
        const row = { ...merged, devengado: dev, total: tot };
        await supabase.from('staff_pay_items').update({
          dias, horas, jornadas_validadas: row.jornadas_validadas, jornadas_pendientes: row.jornadas_pendientes,
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
    const { data: emps } = await supabase.from('employees')
      .select('id, first_name, last_name, cedula, cargo, base_salary').eq('company_id', sel.company_id).eq('status', 'activo');
    const byCed = await buildAuto(sel.date_from, sel.date_to);
    const have = new Set(items.map((i) => i.employee_id));
    const rows = (emps ?? []).filter((e: any) => !have.has(e.id)).map((e: any) => {
      const base = Number(e.base_salary) || 0;
      const tarifa_dia = round4(base / (cfg.dias_mes || 30));
      const tarifa_hora = round4(base / (cfg.horas_mes || 240));
      const g = byCed.get(e.cedula);
      const source = g ? 'auto' : 'manual';
      const dias = g ? (sel.only_validated ? g.diasV : g.diasAll) : 0;
      const horas = g ? (sel.only_validated ? g.horasV : g.horasAll) : 0;
      const dev = round2(sel.mode === 'horas' ? horas * tarifa_hora : dias * tarifa_dia);
      return {
        period_id: sel.id, employee_id: e.id, cedula: e.cedula, person_name: `${e.first_name} ${e.last_name}`.trim(),
        cargo: e.cargo ?? null, source, base_salary: base, tarifa_dia, tarifa_hora, dias, horas,
        jornadas_validadas: g ? g.val : 0, jornadas_pendientes: g ? g.pend : 0, overridden: false,
        devengado: dev, bonos: [], deducciones: [], total: dev, nota: null,
      };
    });
    if (rows.length) await supabase.from('staff_pay_items').insert(rows);
    await loadDetail(sel);
    const { data: fresh } = await supabase.from('staff_pay_items').select('*').eq('period_id', sel.id);
    await recomputeTotal(sel.id, (fresh ?? []) as StaffPayItem[], sel.mode);
    setBusy(false);
    if (!rows.length) Alert.alert('Aviso', 'No hay empleados activos nuevos para agregar.');
  };

  // ── Editor de renglón ───────────────────────────────────────────────────────
  const openItem = (it: StaffPayItem) => {
    setEditItem(it);
    setEBase(String(it.base_salary ?? 0));
    setEDias(String(it.dias ?? 0));
    setEHoras(String(it.horas ?? 0));
    setEBonos(Array.isArray(it.bonos) ? it.bonos : []);
    setEDed(Array.isArray(it.deducciones) ? it.deducciones : []);
    setENote(it.nota ?? '');
  };
  const guardarItem = async () => {
    if (!editItem || !sel) return;
    const base = puedeTarifa ? parseNum(eBase) : Number(editItem.base_salary) || 0;
    const dias = parseNum(eDias);
    const horas = parseNum(eHoras);
    const tarifa_dia = round4(base / (cfg.dias_mes || 30));
    const tarifa_hora = round4(base / (cfg.horas_mes || 240));
    const bonos = eBonos.filter((l) => l.label?.trim() || l.amount);
    const ded = eDed.filter((l) => l.label?.trim() || l.amount);
    // Ajuste a mano si cambió días/horas respecto a lo cargado automáticamente.
    const overridden = editItem.overridden || dias !== Number(editItem.dias) || horas !== Number(editItem.horas);
    const merged: StaffPayItem = { ...editItem, base_salary: base, tarifa_dia, tarifa_hora, dias, horas, bonos, deducciones: ded };
    const dev = devengadoOf(merged, sel.mode);
    const tot = totalOf(merged, sel.mode);
    const { error } = await supabase.from('staff_pay_items').update({
      base_salary: base, tarifa_dia, tarifa_hora, dias, horas, overridden,
      bonos, deducciones: ded, devengado: dev, total: tot, nota: eNote.trim() || null,
    }).eq('id', editItem.id);
    if (error) return Alert.alert('Aviso', error.message);
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

  // ── Divisores ───────────────────────────────────────────────────────────────
  const guardarDivisores = async () => {
    const d = Math.max(1, Math.round(parseNum(dDias)));
    const h = Math.max(1, Math.round(parseNum(dHoras)));
    const { error } = await supabase.from('staff_pay_config').update({ dias_mes: d, horas_mes: h, updated_at: new Date().toISOString() }).eq('id', 1);
    if (error) return Alert.alert('Aviso', error.message);
    setCfg({ ...cfg, dias_mes: d, horas_mes: h });
    setCfgOpen(false);
    Alert.alert('Divisores', `Actualizados: día = base ÷ ${d}, hora = base ÷ ${h}. Aplica a los próximos períodos y al recalcular.`);
  };

  // ── PDF: recibo por persona ─────────────────────────────────────────────────
  const reciboPdf = async (it: StaffPayItem) => {
    if (!sel) return;
    const line = (l: StaffPayLine) => `<tr><td>${l.label || '—'}</td><td style="text-align:right">${usd(l.amount)}</td></tr>`;
    const pagado = paidOf(it.id); const saldo = saldoOf(it);
    const abonos = pays.filter((p) => p.item_id === it.id).sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
    const dev = devengadoOf(it, sel.mode);
    const html = pdfDocument({
      title: 'Recibo de pago a personal',
      subtitle: `${it.person_name} · ${companyName(sel.company_id)} · ${sel.name}`,
      extraCss: `table{width:100%;border-collapse:collapse;margin-top:10px;font-size:12px}
        th,td{border:1px solid #ccc;padding:6px 8px} th{background:#1E3A5F;color:#fff;text-align:left}
        .tot{font-weight:800;background:#EEF2F7} .net{font-size:20px;font-weight:800;color:#1E3A5F;text-align:right;margin-top:12px}`,
      body: `
        <table><tbody>
          <tr><td>Persona</td><td style="text-align:right">${it.person_name}</td></tr>
          <tr><td>Cargo</td><td style="text-align:right">${it.cargo ?? '—'}</td></tr>
          <tr><td>Cédula</td><td style="text-align:right">${it.cedula ?? '—'}</td></tr>
          <tr><td>Período</td><td style="text-align:right">${TYPE_LABEL[sel.period_type]} · ${fmtDMY(sel.date_from)} → ${fmtDMY(sel.date_to)}</td></tr>
          <tr><td>Modo de cálculo</td><td style="text-align:right">${sel.mode === 'horas' ? 'Por horas' : 'Por días'} trabajados</td></tr>
          <tr><td>Sueldo base</td><td style="text-align:right">${usd(it.base_salary)}</td></tr>
          <tr><td>Tarifa</td><td style="text-align:right">${sel.mode === 'horas' ? `${usd(it.tarifa_hora)} / hora` : `${usd(it.tarifa_dia)} / día`}</td></tr>
          <tr><td>${sel.mode === 'horas' ? 'Horas trabajadas' : 'Días trabajados'}</td><td style="text-align:right">${sel.mode === 'horas' ? `${it.horas} h` : `${it.dias} d`}</td></tr>
          ${it.source === 'auto' ? `<tr><td>Jornadas validadas / pendientes</td><td style="text-align:right">${it.jornadas_validadas} / ${it.jornadas_pendientes}</td></tr>` : ''}
        </tbody></table>
        <table><thead><tr><th>Concepto</th><th style="text-align:right">Monto</th></tr></thead>
        <tbody>
          <tr><td>Devengado</td><td style="text-align:right">${usd(dev)}</td></tr>
          ${(it.bonos || []).map((l) => `<tr><td>+ Bono: ${l.label || '—'}</td><td style="text-align:right">${usd(l.amount)}</td></tr>`).join('')}
          ${(it.deducciones || []).map((l) => `<tr><td>− Deducción: ${l.label || '—'}</td><td style="text-align:right">−${usd(l.amount)}</td></tr>`).join('')}
          <tr class="tot"><td>Total a pagar</td><td style="text-align:right">${usd(it.total)}</td></tr>
        </tbody></table>
        ${abonos.length ? `<table><thead><tr><th>Abono</th><th>Fecha</th><th>Método</th><th style="text-align:right">Monto</th></tr></thead>
          <tbody>${abonos.map((p, i) => `<tr><td>🟢 Abono ${i + 1}</td><td>${fmtDMY(p.fecha)}</td><td>${p.metodo}</td><td style="text-align:right">${usd(p.monto)}</td></tr>`).join('')}
          <tr class="tot"><td colspan="3" style="text-align:right">Total abonado</td><td style="text-align:right">${usd(pagado)}</td></tr></tbody></table>` : ''}
        <div class="net">Saldo pendiente: ${usd(saldo)}</div>`,
    });
    await exportPdf(html, `Recibo - ${it.person_name}`);
  };

  // ── PDF: reporte del período ────────────────────────────────────────────────
  const reportePdf = async () => {
    if (!sel) return;
    const rows = items.map((it) => {
      const pagado = paidOf(it.id); const saldo = saldoOf(it);
      return `<tr><td>${it.person_name}</td><td>${it.cargo ?? '—'}</td>` +
        `<td style="text-align:center">${sel.mode === 'horas' ? `${it.horas} h` : `${it.dias} d`}</td>` +
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
      subtitle: `${companyName(sel.company_id)} · ${sel.name} · ${TYPE_LABEL[sel.period_type]} ${fmtDMY(sel.date_from)} → ${fmtDMY(sel.date_to)} · ${sel.mode === 'horas' ? 'Por horas' : 'Por días'}`,
      extraCss: `table{width:100%;border-collapse:collapse;margin-top:12px;font-size:11px}
        th,td{border:1px solid #ccc;padding:5px 7px;text-align:left} th{background:#1E3A5F;color:#fff}
        tfoot td{background:#EEF2F7;font-weight:800}`,
      body: `
        <table><thead><tr><th>Persona</th><th>Cargo</th><th style="text-align:center">${sel.mode === 'horas' ? 'Horas' : 'Días'}</th>
          <th style="text-align:right">Devengado</th><th style="text-align:right">Bonos</th><th style="text-align:right">Deducc.</th>
          <th style="text-align:right">Total</th><th style="text-align:right">Pagado</th><th style="text-align:right">Saldo</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="9" style="text-align:center">Sin personal</td></tr>'}</tbody>
        <tfoot><tr><td colspan="6" style="text-align:right">TOTAL (${items.length} persona(s))</td>
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
    ...editItem, base_salary: puedeTarifa ? parseNum(eBase) : editItem.base_salary,
    tarifa_dia: round4((puedeTarifa ? parseNum(eBase) : editItem.base_salary) / (cfg.dias_mes || 30)),
    tarifa_hora: round4((puedeTarifa ? parseNum(eBase) : editItem.base_salary) / (cfg.horas_mes || 240)),
    dias: parseNum(eDias), horas: parseNum(eHoras), bonos: eBonos, deducciones: eDed,
  } : null;

  return (
    <Screen>
      <ConfigBanner />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>Pago a personal</SectionTitle>
        <TouchableOpacity onPress={() => { setCCompany(''); setCName(''); setCType('semana'); setCRef(todayISO()); const r = rangeFor('semana', todayISO()); setCFrom(r.from); setCTo(r.to); setCMode('dias'); setCValid(true); setCreateOpen(true); }} style={{ backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
          <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>+ Nuevo</Text>
        </TouchableOpacity>
      </View>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
        Paga por días u horas trabajados, derivado del sueldo base. Los operadores se cargan solos desde sus jornadas; el resto se ajusta a mano.
      </Text>

      {puedeTarifa ? (
        <TouchableOpacity onPress={() => { setDDias(String(cfg.dias_mes)); setDHoras(String(cfg.horas_mes)); setCfgOpen(true); }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md }}>
          <Text style={{ fontSize: 20 }}>⚙️</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>Divisores de tarifa</Text>
            <Text style={{ color: colors.muted, fontSize: 11 }}>Día = base ÷ {cfg.dias_mes} · Hora = base ÷ {cfg.horas_mes}</Text>
          </View>
          <Text style={{ color: colors.primary, fontWeight: '800' }}>›</Text>
        </TouchableOpacity>
      ) : null}

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
                      <Text style={{ color: colors.muted, fontSize: 12 }}>{TYPE_LABEL[p.period_type]} · {fmtDMY(p.date_from)} → {fmtDMY(p.date_to)} · {p.mode === 'horas' ? 'horas' : 'días'}</Text>
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
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, paddingVertical: spacing.xs }}>
                {companies.map((c) => {
                  const on = cCompany === c.id;
                  return <TouchableOpacity key={c.id} onPress={() => setCCompany(c.id)} style={chip(on)}><Text style={chipTxt(on)}>{c.name}</Text></TouchableOpacity>;
                })}
              </ScrollView>

              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Nombre (ej. "Semana 1 - julio")</Text>
              <TextInput value={cName} onChangeText={setCName} placeholder="Nombre del período" placeholderTextColor={colors.muted} style={input} />

              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Período</Text>
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

              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Modo de cálculo</Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
                {(['dias', 'horas'] as const).map((mo) => (
                  <TouchableOpacity key={mo} onPress={() => setCMode(mo)} style={{ flex: 1, ...chip(cMode === mo), alignItems: 'center' }}>
                    <Text style={chipTxt(cMode === mo)}>{mo === 'dias' ? 'Por días' : 'Por horas'}</Text>
                  </TouchableOpacity>
                ))}
              </View>

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

      {/* Modal: divisores */}
      <Modal visible={cfgOpen} transparent animationType="slide" onRequestClose={() => setCfgOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18, marginBottom: spacing.xs }}>Divisores de tarifa</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>Definen cómo se reparte el sueldo base mensual.</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>Días por mes (tarifa/día = base ÷ días)</Text>
            <TextInput value={dDias} onChangeText={(t) => setDDias(onlyDecimal(t))} keyboardType="numeric" style={input} />
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Horas por mes (tarifa/hora = base ÷ horas)</Text>
            <TextInput value={dHoras} onChangeText={(t) => setDHoras(onlyDecimal(t))} keyboardType="numeric" style={input} />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
              <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setCfgOpen(false)}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary }} onPress={guardarDivisores}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>Guardar</Text>
              </TouchableOpacity>
            </View>
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
                <Text style={{ color: colors.muted, fontSize: 12 }}>{TYPE_LABEL[sel.period_type]} · {fmtDMY(sel.date_from)} → {fmtDMY(sel.date_to)} · {sel.mode === 'horas' ? 'Por horas' : 'Por días'}{sel.only_validated ? ' · solo validadas' : ''}</Text>
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
                            {sel.mode === 'horas' ? `${it.horas} h` : `${it.dias} d`} × {usd(sel.mode === 'horas' ? it.tarifa_hora : it.tarifa_dia)} = {usd(devengadoOf(it, sel.mode))}
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

                <Text style={{ color: colors.muted, fontSize: 12 }}>Sueldo base mensual ($){!puedeTarifa ? ' — solo lectura' : ''}</Text>
                <TextInput value={eBase} onChangeText={(t) => setEBase(onlyDecimal(t))} keyboardType="numeric" editable={!readOnly && puedeTarifa} placeholder="0" placeholderTextColor={colors.muted} style={{ ...input, opacity: puedeTarifa ? 1 : 0.6 }} />
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>Tarifa: {usd(previewItem.tarifa_dia)}/día · {usd(previewItem.tarifa_hora)}/hora</Text>

                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>Días trabajados{sel.mode === 'dias' ? ' ✓' : ''}</Text>
                    <TextInput value={eDias} onChangeText={(t) => setEDias(onlyDecimal(t))} keyboardType="numeric" editable={!readOnly} style={input} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>Horas trabajadas{sel.mode === 'horas' ? ' ✓' : ''}</Text>
                    <TextInput value={eHoras} onChangeText={(t) => setEHoras(onlyDecimal(t))} keyboardType="numeric" editable={!readOnly} style={input} />
                  </View>
                </View>
                {editItem.source === 'auto' ? (
                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>Auto: {editItem.jornadas_validadas} validada(s) · {editItem.jornadas_pendientes} pendiente(s). Si editas, queda como ajuste manual.</Text>
                ) : null}

                <LineEditor title="Bonos" lines={eBonos} setLines={setEBonos} color={colors.success} />
                <LineEditor title="Deducciones" lines={eDed} setLines={setEDed} color={colors.danger} />

                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Nota (opcional)</Text>
                <TextInput value={eNote} onChangeText={setENote} editable={!readOnly} placeholder="Observación…" placeholderTextColor={colors.muted} style={input} />

                <View style={{ marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>Devengado ({sel.mode === 'horas' ? 'horas' : 'días'})</Text>
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
