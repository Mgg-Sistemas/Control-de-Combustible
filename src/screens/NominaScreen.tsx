import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Platform } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading, Badge } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import { supabase } from '../lib/supabase';
import { exportPdf, exportCardImage, pdfDocument } from '../lib/pdf';
import { organigramaHtml, organigramaCard, ORG_STYLES, ORG_SHEET_MM, fichasHtml, fichaCargoHtml, listaCargos } from '../lib/organigrama';
import { generatePersonalReport } from '../lib/personalReport';
import { EyeIcon } from '../components/EyeIcon';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { useToast } from '../components/ToastProvider';
import { onlyDecimal, cmpText, norm } from '../lib/text';
import { PayrollPeriod, PayrollItem, PayrollLine, Company } from '../types/database';
import { generalCompanies } from '../lib/companies';
import { useTable } from '../hooks/useTable';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { caracasParts } from '../lib/jornada';
import { PAGO_STATUS_META, PAGO_STATUS_LABEL } from '../lib/statusMeta';
import { useBcvRate, setManualBcvRate, refreshBcvRate } from '../lib/bcv';
import {
  resolverTasaPeriodo,
  validarTasaManual,
  calcularVesDesdeUsd,
  fmtMontoVes,
  fmtTasaCambio,
} from '../lib/nominaBimonetario';

const usd = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// `onlyDecimal` (lib/text.ts) ya deja como mucho UN separador decimal (. o ,,
// el primero que se tipeó) — acá solo hace falta pasar la coma a punto, NUNCA
// borrar puntos (si no, "450.50" se leía como 45050: el sueldo quedaba 100x
// inflado).
function parseNum(t: string): number { const n = Number(String(t ?? '').replace(',', '.').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; }
function todayISO(): string { return caracasParts(new Date()).iso; }
const sumLines = (l: PayrollLine[]) => (l || []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
const netOf = (base: number, add: PayrollLine[], ded: PayrollLine[]) => Math.round((base + sumLines(add) - sumLines(ded)) * 100) / 100;
const fmtDMY = (iso?: string | null) => { const [y, m, d] = String(iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : (iso || '—'); };

export default function NominaScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { session, canSee } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const { data: periods, loading, refetch } = useTable<PayrollPeriod>('payroll_periods', { orderBy: 'created_at', ascending: false });
  const { data: companies } = useTable<Company>('companies', { orderBy: 'name' });
  const companyName = (id: string | null) => (id ? companies.find((c) => c.id === id)?.name ?? 'Empresa' : 'Sin empresa');

  // Crear período
  const [createOpen, setCreateOpen] = useState(false);
  const [cCompany, setCCompany] = useState('');
  const [cName, setCName] = useState('');
  const [cFrom, setCFrom] = useState(todayISO());
  const [cTo, setCTo] = useState(todayISO());
  const [cRateText, setCRateText] = useState('');
  const [creating, setCreating] = useState(false);

  // Tasa de cambio BCV / manual por período
  const bcvRateInfo = useBcvRate();
  const [globalRateEditOpen, setGlobalRateEditOpen] = useState(false);
  const [globalRateText, setGlobalRateText] = useState('');
  const [periodRateEditOpen, setPeriodRateEditOpen] = useState(false);
  const [periodRateText, setPeriodRateText] = useState('');
  const [periodRateSaving, setPeriodRateSaving] = useState(false);

  // Detalle
  const [sel, setSel] = useState<PayrollPeriod | null>(null);
  const activePeriodRate = useMemo(
    () => resolverTasaPeriodo(sel?.exchange_rate, bcvRateInfo.rate),
    [sel?.exchange_rate, bcvRateInfo.rate],
  );
  const fmtVes = (usdAmt: number, rateOverride?: number | null) => {
    const r = rateOverride !== undefined ? rateOverride : activePeriodRate;
    if (!r || r <= 0) return null;
    const ves = calcularVesDesdeUsd(usdAmt, r);
    return fmtMontoVes(ves);
  };
  const [items, setItems] = useState<PayrollItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // Editor de renglón
  const [editItem, setEditItem] = useState<PayrollItem | null>(null);
  const [eBase, setEBase] = useState('');
  const [eAdd, setEAdd] = useState<PayrollLine[]>([]);
  const [eDed, setEDed] = useState<PayrollLine[]>([]);
  const [eNote, setENote] = useState('');

  const readOnly = sel?.status !== 'borrador';

  // ── Organigrama corporativo (estructura fija por cargos) ──────────────────────
  const [orgOpen, setOrgOpen] = useState(false);
  const verOrganigrama = () => { exportPdf(organigramaHtml(), 'Organigrama SOS La Guaira'); };
  const descargarOrgPng = async () => {
    if (Platform.OS !== 'web') return verOrganigrama(); // en móvil se comparte el PDF
    await exportCardImage({ styles: ORG_STYLES, card: organigramaCard(), mmW: ORG_SHEET_MM.w, mmH: ORG_SHEET_MM.h, dpi: 150, fileName: 'Organigrama SOS La Guaira', htmlForFallback: organigramaHtml() });
  };
  // Manual de cargos (funciones + subordinados): general y por cargo.
  const cargosLista = useMemo(() => listaCargos(), []);
  const [cargoSel, setCargoSel] = useState<string>('');
  const [fichaQ, setFichaQ] = useState('');
  const cargosFiltrados = useMemo(() => {
    const nq = norm(fichaQ.trim());
    return nq ? cargosLista.filter((c) => norm(c.title).includes(nq) || norm(c.area).includes(nq)) : cargosLista;
  }, [cargosLista, fichaQ]);
  const verFichasGeneral = () => { exportPdf(fichasHtml(), 'Manual de cargos SOS La Guaira'); };
  const verFichaCargo = (title: string) => { exportPdf(fichaCargoHtml(title), `Ficha - ${title}`); };

  const loadItems = async (pid: string, periodStatus?: string) => {
    setItemsLoading(true);
    const { data } = await supabase.from('payroll_items').select('*').eq('period_id', pid).order('employee_name');
    let list = (data ?? []) as PayrollItem[];
    const st = periodStatus ?? sel?.status;
    if (st === 'borrador' && list.length > 0) {
      const empIds = Array.from(new Set(list.map((it) => it.employee_id).filter(Boolean))) as string[];
      if (empIds.length > 0) {
        const { data: emps } = await supabase
          .from('employees')
          .select('id, status, first_name, last_name, cargo, ficha_number, cedula')
          .in('id', empIds);
        const empMap = new Map<string, any>();
        (emps ?? []).forEach((e: any) => empMap.set(e.id, e));
        const toDeleteIds: string[] = [];
        for (const it of list) {
          if (!it.employee_id) continue;
          const emp = empMap.get(it.employee_id);
          const empSt = String(emp?.status || '').toLowerCase();
          if (!emp || empSt === 'inactivo' || empSt === 'suspendido' || empSt === 'otro') {
            toDeleteIds.push(it.id);
          } else {
            const full = `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim() || it.employee_name;
            if ((emp.cargo ?? null) !== (it.cargo ?? null) || full !== it.employee_name) {
              it.cargo = emp.cargo ?? it.cargo;
              it.employee_name = full;
              await supabase.from('payroll_items').update({
                cargo: emp.cargo ?? null,
                employee_name: full,
                ficha_number: emp.ficha_number ?? it.ficha_number,
                cedula: emp.cedula ?? it.cedula,
              }).eq('id', it.id);
            }
          }
        }
        if (toDeleteIds.length > 0) {
          await supabase.from('payroll_items').delete().in('id', toDeleteIds);
          const delSet = new Set(toDeleteIds);
          list = list.filter((it) => !delSet.has(it.id));
          const newTotal = list.reduce((s, r) => s + (Number(r.net_amount) || 0), 0);
          await supabase.from('payroll_periods').update({ total_amount: newTotal }).eq('id', pid);
          setSel((prev) => (prev && prev.id === pid ? { ...prev, total_amount: newTotal } : prev));
          refetch();
        }
      }
    }
    setItems(list);
    setItemsLoading(false);
  };
  const openDetail = (p: PayrollPeriod) => { setSel(p); setItems([]); loadItems(p.id, p.status); };
  // Los renglones (payroll_items) del período abierto no vienen de useTable, así
  // que se refrescan aparte; solo mientras hay un período abierto en el modal.
  useRealtimeRefresh(['payroll_items', 'employees'], () => { if (sel) loadItems(sel.id, sel.status); });

  const crearPeriodo = async () => {
    if (!cCompany) return toast.error('Elige la empresa.');
    if (!cName.trim()) return toast.error('Escribe el nombre de la nómina (ej. "Quincena 1 - julio").');
    let chosenRate: number | null = bcvRateInfo.rate ?? null;
    if (cRateText.trim()) {
      const check = validarTasaManual(cRateText);
      if (!check.ok) return toast.error(check.error);
      chosenRate = check.valor;
    }
    setCreating(true);
    const { data: per, error } = await supabase.from('payroll_periods')
      .insert({ company_id: cCompany, name: cName.trim(), period_start: cFrom || null, period_end: cTo || null, exchange_rate: chosenRate, status: 'borrador', created_by: session?.user?.id ?? null })
      .select().single();
    if (error || !per) { setCreating(false); return toast.error(error?.message ?? 'No se pudo crear.'); }
    // Precarga: un renglón por cada empleado ACTIVO de la empresa, con su salario semanal / base.
    const { data: emps } = await supabase.from('employees')
      .select('id, first_name, last_name, cargo, ficha_number, cedula, hire_date, base_salary, precio_semana')
      .eq('company_id', cCompany).eq('status', 'activo');
    const rows = (emps ?? []).map((e: any) => {
      const base = Number(e.base_salary) || Number(e.precio_semana) || 0;
      return { period_id: per.id, employee_id: e.id, employee_name: `${e.first_name} ${e.last_name}`.trim(), cargo: e.cargo, ficha_number: e.ficha_number, cedula: e.cedula, hire_date: e.hire_date ?? null, base_amount: base, additions: [], deductions: [], net_amount: base };
    });
    if (rows.length) await supabase.from('payroll_items').insert(rows);
    const total = rows.reduce((s, r) => s + r.net_amount, 0);
    await supabase.from('payroll_periods').update({ total_amount: total }).eq('id', per.id);
    setCreating(false); setCreateOpen(false); setCName(''); setCRateText('');
    refetch();
    openDetail({ ...(per as PayrollPeriod), total_amount: total });
  };

  const agregarFaltantes = async () => {
    if (!sel) return;
    setBusy(true);
    const { data: emps } = await supabase.from('employees')
      .select('id, first_name, last_name, cargo, ficha_number, cedula, hire_date, base_salary, precio_semana')
      .eq('company_id', sel.company_id).eq('status', 'activo');
    const have = new Set(items.map((it) => it.employee_id));
    const rows = (emps ?? []).filter((e: any) => !have.has(e.id)).map((e: any) => {
      const base = Number(e.base_salary) || Number(e.precio_semana) || 0;
      return { period_id: sel.id, employee_id: e.id, employee_name: `${e.first_name} ${e.last_name}`.trim(), cargo: e.cargo, ficha_number: e.ficha_number, cedula: e.cedula, hire_date: e.hire_date ?? null, base_amount: base, additions: [], deductions: [], net_amount: base };
    });
    if (rows.length) await supabase.from('payroll_items').insert(rows);
    await loadItems(sel.id);
    await recomputeTotal(sel.id);
    setBusy(false);
    if (!rows.length) toast.info('No hay empleados activos nuevos para agregar.');
  };

  const guardarTasaGlobal = async () => {
    const check = validarTasaManual(globalRateText);
    if (!check.ok) return toast.error(check.error);
    await setManualBcvRate(check.valor);
    setGlobalRateEditOpen(false);
    toast.ok(`Tasa del día actualizada: ${fmtTasaCambio(check.valor)}`);
  };

  const guardarTasaPeriodo = async (usarAutomatica = false) => {
    if (!sel) return;
    let nextRate: number | null = null;
    if (!usarAutomatica) {
      const check = validarTasaManual(periodRateText);
      if (!check.ok) return toast.error(check.error);
      nextRate = check.valor;
    }
    setPeriodRateSaving(true);
    const { data: updatedRows, error } = await supabase
      .from('payroll_periods')
      .update({ exchange_rate: nextRate })
      .eq('id', sel.id)
      .select('id, exchange_rate');
    setPeriodRateSaving(false);
    if (error) return toast.error(error.message);
    if (!updatedRows || updatedRows.length === 0) return toast.error('No se pudo actualizar la tasa del período (permisos insuficientes).');
    setSel({ ...sel, exchange_rate: nextRate });
    setPeriodRateEditOpen(false);
    refetch();
    toast.ok(nextRate ? `Tasa del período fijada en ${fmtTasaCambio(nextRate)} Bs/$` : 'El período ahora usa la tasa del día');
  };

  const recomputeTotal = async (pid: string) => {
    const { data } = await supabase.from('payroll_items').select('net_amount').eq('period_id', pid);
    const total = (data ?? []).reduce((s: number, r: any) => s + (Number(r.net_amount) || 0), 0);
    await supabase.from('payroll_periods').update({ total_amount: total }).eq('id', pid);
    setSel((p) => (p && p.id === pid ? { ...p, total_amount: total } : p));
    refetch();
  };

  const openItem = (it: PayrollItem) => {
    setEditItem(it);
    setEBase(String(it.base_amount ?? 0));
    setEAdd(Array.isArray(it.additions) ? it.additions : []);
    setEDed(Array.isArray(it.deductions) ? it.deductions : []);
    setENote(it.note ?? '');
  };
  const guardarItem = async () => {
    if (!editItem || !sel) return;
    const base = parseNum(eBase);
    const add = eAdd.filter((l) => l.label?.trim() || l.amount);
    const ded = eDed.filter((l) => l.label?.trim() || l.amount);
    const net = netOf(base, add, ded);
    const { error } = await supabase.from('payroll_items')
      .update({ base_amount: base, additions: add, deductions: ded, net_amount: net, note: eNote.trim() || null })
      .eq('id', editItem.id);
    if (error) return toast.error(error.message);
    const newItems = items.map((it) => (it.id === editItem.id ? { ...it, base_amount: base, additions: add, deductions: ded, net_amount: net, note: eNote } : it));
    setItems(newItems);
    const total = newItems.reduce((s, it) => s + (Number(it.net_amount) || 0), 0);
    await supabase.from('payroll_periods').update({ total_amount: total }).eq('id', sel.id);
    setSel({ ...sel, total_amount: total });
    refetch();
    setEditItem(null);
  };

  const setStatus = async (status: PayrollPeriod['status']) => {
    if (!sel) return;
    setBusy(true);
    const { error } = await supabase.from('payroll_periods').update({ status }).eq('id', sel.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    setSel({ ...sel, status });
    refetch();
  };

  const eliminarPeriodo = async () => {
    if (!sel) return;
    const ok = await confirm({ title: 'Eliminar nómina', message: `¿Eliminar "${sel.name}"? Se borran sus renglones. No se puede deshacer.`, confirmText: 'Eliminar', cancelText: 'Cancelar' });
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase.from('payroll_periods').delete().eq('id', sel.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    setSel(null);
    refetch();
  };

  // ── PDF: recibo de un empleado ────────────────────────────────────────────
  const reciboPdf = async (it: PayrollItem) => {
    if (!sel) return;
    const rate = activePeriodRate;
    const bimo = (amt: number) => {
      const ves = calcularVesDesdeUsd(amt, rate);
      return ves != null ? `${usd(amt)} <span style="color:#475569;font-size:11px">(${fmtMontoVes(ves)})</span>` : usd(amt);
    };
    const line = (l: PayrollLine) => `<tr><td>${(l.label || '—')}</td><td style="text-align:right">${bimo(l.amount)}</td></tr>`;
    const add = (it.additions || []); const ded = (it.deductions || []);
    const html = pdfDocument({
      title: 'Recibo de pago',
      subtitle: `${it.employee_name ?? ''} · ${companyName(sel.company_id)} · ${sel.name}${rate ? ` · Tasa: ${fmtTasaCambio(rate)} Bs/$` : ''}`,
      extraCss: `table{width:100%;border-collapse:collapse;margin-top:10px;font-size:12px}
        th,td{border:1px solid #ccc;padding:6px 8px} th{background:#1E3A5F;color:#fff;text-align:left}
        .tot{font-weight:800;background:#EEF2F7} .net{font-size:20px;font-weight:800;color:#1E3A5F;text-align:right;margin-top:12px}`,
      body: `
        <table><tbody>
          <tr><td>Empleado</td><td style="text-align:right">${it.employee_name ?? '—'}</td></tr>
          <tr><td>Cargo</td><td style="text-align:right">${it.cargo ?? '—'}</td></tr>
          <tr><td>N° de ficha</td><td style="text-align:right">${it.ficha_number ?? '—'}</td></tr>
          <tr><td>Cédula</td><td style="text-align:right">${it.cedula ?? '—'}</td></tr>
          <tr><td>Fecha de ingreso</td><td style="text-align:right">${fmtDMY(it.hire_date)}</td></tr>
          <tr><td>Período</td><td style="text-align:right">${fmtDMY(sel.period_start)} → ${fmtDMY(sel.period_end)}</td></tr>
          ${rate ? `<tr><td>Tasa de cambio aplicada</td><td style="text-align:right;font-weight:700">${fmtTasaCambio(rate)} Bs/$</td></tr>` : ''}
        </tbody></table>
        <table><thead><tr><th>Asignaciones</th><th style="text-align:right">Monto</th></tr></thead>
        <tbody><tr><td>Salario Semanal / Base</td><td style="text-align:right">${bimo(it.base_amount)}</td></tr>
          ${add.map(line).join('')}
          <tr class="tot"><td>Total asignaciones</td><td style="text-align:right">${bimo(Number(it.base_amount) + sumLines(add))}</td></tr></tbody></table>
        ${ded.length ? `<table><thead><tr><th>Deducciones</th><th style="text-align:right">Monto</th></tr></thead>
        <tbody>${ded.map(line).join('')}
          <tr class="tot"><td>Total deducciones</td><td style="text-align:right">${bimo(sumLines(ded))}</td></tr></tbody></table>` : ''}
        <div class="net">Neto a pagar: ${usd(it.net_amount)}${rate ? `<div style="font-size:14px;color:#0f766e;margin-top:2px">Equivalente: ${fmtMontoVes(calcularVesDesdeUsd(it.net_amount, rate) || 0)}</div>` : ''}</div>`,
    });
    await exportPdf(html, `Recibo - ${it.employee_name}`);
  };

  // ── PDF: reporte del período completo ─────────────────────────────────────
  const reportePdf = async () => {
    if (!sel) return;
    const rate = activePeriodRate;
    const rows = items.map((it) => {
      const vesCell = rate ? `<td style="text-align:right;font-weight:700;color:#0f766e">${fmtMontoVes(calcularVesDesdeUsd(it.net_amount, rate) || 0)}</td>` : '';
      return `<tr><td>${it.employee_name ?? '—'}</td><td>${it.cargo ?? '—'}</td><td>${it.ficha_number ?? '—'}</td><td>${fmtDMY(it.hire_date)}</td>` +
        `<td style="text-align:right">${usd(it.base_amount)}</td><td style="text-align:right">${usd(sumLines(it.additions))}</td>` +
        `<td style="text-align:right">${usd(sumLines(it.deductions))}</td><td style="text-align:right;font-weight:800">${usd(it.net_amount)}</td>${vesCell}</tr>`;
    }).join('');
    const total = items.reduce((s, it) => s + (Number(it.net_amount) || 0), 0);
    const totalVesCell = rate ? `<td style="text-align:right;color:#0f766e">${fmtMontoVes(calcularVesDesdeUsd(total, rate) || 0)}</td>` : '';
    const html = pdfDocument({
      title: 'Nómina',
      subtitle: `${companyName(sel.company_id)} · ${sel.name} · ${fmtDMY(sel.period_start)} → ${fmtDMY(sel.period_end)} · ${PAGO_STATUS_LABEL[sel.status] ?? sel.status}${rate ? ` · Tasa: ${fmtTasaCambio(rate)} Bs/$` : ''}`,
      extraCss: `table{width:100%;border-collapse:collapse;margin-top:12px;font-size:11px}
        th,td{border:1px solid #ccc;padding:5px 7px;text-align:left} th{background:#1E3A5F;color:#fff}
        tfoot td{background:#EEF2F7;font-weight:800}`,
      body: `
        <table><thead><tr><th>Empleado</th><th>Cargo</th><th>Ficha</th><th>Ingreso</th><th style="text-align:right">Base ($)</th>
          <th style="text-align:right">Asign. ($)</th><th style="text-align:right">Deducc. ($)</th><th style="text-align:right">Neto ($)</th>${rate ? '<th style="text-align:right">Neto (Bs)</th>' : ''}</tr></thead>
        <tbody>${rows || `<tr><td colspan="${rate ? 9 : 8}" style="text-align:center">Sin empleados</td></tr>`}</tbody>
        <tfoot><tr><td colspan="7" style="text-align:right">TOTAL A PAGAR (${items.length} empleado(s))</td><td style="text-align:right">${usd(total)}</td>${totalVesCell}</tr></tfoot></table>`,
    });
    await exportPdf(html, `Nomina - ${sel.name}`);
  };

  // Agrupar períodos por empresa.
  const byCompany = useMemo(() => {
    const m = new Map<string, { key: string; name: string; items: PayrollPeriod[] }>();
    periods.forEach((p) => {
      const k = p.company_id ?? '__none__';
      const g = m.get(k) ?? { key: k, name: companyName(p.company_id), items: [] };
      g.items.push(p);
      m.set(k, g);
    });
    return Array.from(m.values()).sort((a, b) => cmpText(a.name, b.name));
  }, [periods, companies]);

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  // Editor de una lista de conceptos (asignaciones o deducciones).
  // ⌨️ Es una FUNCIÓN que se LLAMA —`{lineEditor({...})}`—, NO un `<LineEditor/>`:
  //    definida dentro del componente, montarla como etiqueta la volvía un tipo
  //    nuevo en cada render, remontaba el TextInput y el campo perdía el foco a
  //    cada letra (15-oct-2026). Lo vigila scripts/test-inputs-no-pierden-foco.mjs.
  const lineEditor = ({ title, lines, setLines, color }: { title: string; lines: PayrollLine[]; setLines: (l: PayrollLine[]) => void; color: string }) => (
    <View style={{ marginTop: spacing.sm }}>
      <Text style={{ color, fontWeight: '800', fontSize: 13, marginBottom: 4 }}>{title}</Text>
      {lines.map((l, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: 4, alignItems: 'center' }}>
          <TextInput value={l.label} onChangeText={(t) => setLines(lines.map((x, j) => (j === i ? { ...x, label: t } : x)))} placeholder="Concepto" placeholderTextColor={colors.muted} style={{ ...input, flex: 2 }} />
          <TextInput value={l.amount ? String(l.amount) : ''} onChangeText={(t) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: parseNum(onlyDecimal(t)) } : x)))} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.muted} style={{ ...input, flex: 1, textAlign: 'right' }} />
          <TouchableOpacity onPress={() => setLines(lines.filter((_, j) => j !== i))} style={{ padding: spacing.xs }}>
            <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 16 }}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity onPress={() => setLines([...lines, { label: '', amount: 0 }])} style={{ paddingVertical: spacing.xs, alignItems: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: color, borderRadius: radius.md }}>
        <Text style={{ color, fontWeight: '700', fontSize: 12 }}>+ Agregar {title.toLowerCase()}</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <Screen>
      <ConfigBanner />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>Nómina</SectionTitle>
        <TouchableOpacity onPress={() => { setCCompany(''); setCName(''); setCFrom(todayISO()); setCTo(todayISO()); setCRateText(bcvRateInfo.rate ? String(bcvRateInfo.rate).replace('.', ',') : ''); setCreateOpen(true); }} style={{ backgroundColor: colors.accent, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
          <Text style={{ color: colors.accentContrast, fontWeight: '800' }}>+ Nueva</Text>
        </TouchableOpacity>
      </View>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Crea una nómina por empresa y período. Se precargan los empleados activos con su salario semanal.</Text>

      {/* Barra de Tasa de Cambio del Día (BCV / Manual) */}
      <View
        style={{
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          paddingVertical: spacing.xs,
          paddingHorizontal: spacing.sm,
          marginBottom: spacing.sm,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 1, maxWidth: '100%' }}>
            <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>💱 Tasa del día:</Text>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13 }}>
              {bcvRateInfo.rate ? `${fmtTasaCambio(bcvRateInfo.rate)} Bs/$` : 'Sin configurar'}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 11 }}>
              ({bcvRateInfo.source === 'manual' ? 'Manual' : bcvRateInfo.source === 'live' ? 'BCV en línea' : 'Caché'})
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap', flexShrink: 1, maxWidth: '100%' }}>
            <TouchableOpacity
              onPress={() => {
                setGlobalRateText(bcvRateInfo.rate ? String(bcvRateInfo.rate).replace('.', ',') : '');
                setGlobalRateEditOpen((v) => !v);
              }}
              style={{
                paddingHorizontal: spacing.sm,
                paddingVertical: 4,
                borderRadius: radius.pill,
                backgroundColor: colors.surfaceAlt,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 11 }}>
                {globalRateEditOpen ? '✕ Cerrar' : '✎ Configurar tasa'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={async () => {
                const res = await refreshBcvRate();
                if (res.rate) toast.ok(`Tasa BCV actualizada: ${fmtTasaCambio(res.rate)} Bs/$`);
                else toast.info('No se pudo consultar BCV en línea; usa Configurar tasa manual.');
              }}
              style={{
                paddingHorizontal: spacing.sm,
                paddingVertical: 4,
                borderRadius: radius.pill,
                backgroundColor: colors.surfaceAlt,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11 }}>↻ BCV</Text>
            </TouchableOpacity>
          </View>
        </View>
        {globalRateEditOpen ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs, flexWrap: 'wrap' }}>
            <TextInput
              value={globalRateText}
              onChangeText={(t) => setGlobalRateText(onlyDecimal(t))}
              keyboardType="decimal-pad"
              inputMode="decimal"
              placeholder="Ej: 45,50"
              placeholderTextColor={colors.muted}
              style={{ ...input, flex: 1, minWidth: 120, paddingVertical: 6 }}
            />
            <TouchableOpacity
              onPress={guardarTasaGlobal}
              style={{
                paddingHorizontal: spacing.md,
                paddingVertical: 8,
                borderRadius: radius.md,
                backgroundColor: colors.accent,
              }}
            >
              <Text style={{ color: colors.accentContrast, fontWeight: '800', fontSize: 12 }}>Guardar tasa</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      {/* Acceso a la ficha de EMPLEADOS (RRHH) y al Apartado de Inactivos desde Nómina. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          backgroundColor: colors.surfaceAlt,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          padding: spacing.md,
          marginBottom: spacing.md,
          flexWrap: 'wrap',
        }}
      >
        <TouchableOpacity
          onPress={() => navigation?.navigate('Empleados', { initialFilter: 'todos' })}
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1, minWidth: 200 }}
        >
          <Text style={{ fontSize: 20 }}>🪪</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>Empleados (Personal Vigente)</Text>
            <Text style={{ color: colors.muted, fontSize: 11 }}>Fichas del personal activo, pestañas aparte (CDT, Carbozulia, etc.) y carnet con QR</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => navigation?.navigate('Empleados', { initialFilter: 'inactivo' })}
          style={{
            backgroundColor: 'rgba(220,38,38,0.1)',
            borderWidth: 1,
            borderColor: colors.danger,
            borderRadius: radius.pill,
            paddingHorizontal: spacing.md,
            paddingVertical: 6,
          }}
        >
          <Text style={{ color: colors.danger, fontWeight: '900', fontSize: 11.5 }}>🚫 Apartado de Inactivos ›</Text>
        </TouchableOpacity>
      </View>

      {/* Control de asistencia por carnet (entrada/salida) — solo quien tenga el módulo. */}
      {canSee('asistencia') ? (
        <TouchableOpacity
          onPress={() => navigation?.navigate('Asistencia')}
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md }}
        >
          <Text style={{ fontSize: 20 }}>🕒</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>Control de asistencia</Text>
            <Text style={{ color: colors.muted, fontSize: 11 }}>Marcar entrada/salida escaneando el carnet (hora y fecha) + reporte</Text>
          </View>
          <Text style={{ color: colors.brandText, fontWeight: '800' }}>›</Text>
        </TouchableOpacity>
      ) : null}

      {/* Control de pago a personal (jornadas + sueldo base + bonos/deducciones + abonos). */}
      <TouchableOpacity
        onPress={() => navigation?.navigate('PagoPersonal')}
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md }}
      >
        <Text style={{ fontSize: 20 }}>💵</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>Control de pago a personal</Text>
          <Text style={{ color: colors.muted, fontSize: 11 }}>Pago por precio hora, día o semana (por trabajador), con bonos, deducciones y abonos</Text>
        </View>
        <Text style={{ color: colors.brandText, fontWeight: '800' }}>›</Text>
      </TouchableOpacity>

      {/* Distribución de uniformes (tallas por empleado + listado imprimible con firma). */}
      <TouchableOpacity
        onPress={() => navigation?.navigate('Uniformes')}
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md }}
      >
        <Text style={{ fontSize: 20 }}>👕</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>Distribución de uniformes</Text>
          <Text style={{ color: colors.muted, fontSize: 11 }}>Tallas (camisa, pantalón, zapatos) por empleado y listado imprimible con firma</Text>
        </View>
        <Text style={{ color: colors.brandText, fontWeight: '800' }}>›</Text>
      </TouchableOpacity>

      {/* Distribución de días libres por TIPO DE CARGO (semana libre rotativa, autogenerada). */}
      <TouchableOpacity
        onPress={() => navigation?.navigate('DiasLibresCargo')}
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md }}
      >
        <Text style={{ fontSize: 20 }}>🗓️</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>Distribución de días libres</Text>
          <Text style={{ color: colors.muted, fontSize: 11 }}>Semana libre por tipo de cargo: rotación autogenerada y editable, con calendario y PDF</Text>
        </View>
        <Text style={{ color: colors.brandText, fontWeight: '800' }}>›</Text>
      </TouchableOpacity>

      {/* Organigrama por cargos (vista previa + descarga PDF/PNG, sincronizado con la nómina). */}
      <TouchableOpacity
        onPress={() => setOrgOpen(true)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md }}
      >
        <Text style={{ fontSize: 20 }}>🗂️</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>Organigrama y manual de cargos</Text>
          <Text style={{ color: colors.muted, fontSize: 11 }}>Estructura corporativa por cargos + funciones y subordinados (PDF/imagen)</Text>
        </View>
        <Text style={{ color: colors.brandText, fontWeight: '800' }}>›</Text>
      </TouchableOpacity>

      {/* 👥 Reporte de PERSONAL por departamento (movido desde Reportes). Toda la
          nómina activa agrupada por departamento + totales por departamento y cargo. */}
      <TouchableOpacity
        onPress={() => generatePersonalReport()}
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md }}
      >
        <Text style={{ fontSize: 20 }}>👥</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>Personal por departamento</Text>
          <Text style={{ color: colors.muted, fontSize: 11 }}>Reporte PDF de toda la nómina agrupada por departamento (totales por departamento y cargo)</Text>
        </View>
        <Text style={{ color: colors.brandText, fontWeight: '800' }}>›</Text>
      </TouchableOpacity>

      {loading && periods.length === 0 ? (
        <Loading />
      ) : periods.length === 0 ? (
        <EmptyState title="Sin nóminas" subtitle="Toca “+ Nueva” para crear la primera." />
      ) : (
        byCompany.map((g) => (
          <View key={g.key} style={{ marginBottom: spacing.sm }}>
            <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 15, marginBottom: spacing.xs }}>🏢 {g.name}</Text>
            {g.items.map((p) => {
              const st = PAGO_STATUS_META[p.status] ?? PAGO_STATUS_META.borrador;
              const pRate = resolverTasaPeriodo(p.exchange_rate, bcvRateInfo.rate);
              const pVes = pRate ? calcularVesDesdeUsd(p.total_amount, pRate) : null;
              return (
                <TouchableOpacity key={p.id} activeOpacity={0.7} onPress={() => openDetail(p)}>
                  <Card>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>{p.name}</Text>
                      <Badge label={st.label} tone={st.tone} />
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 2 }}>
                      <View>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>{fmtDMY(p.period_start)} → {fmtDMY(p.period_end)}</Text>
                        {pRate ? (
                          <Text style={{ color: colors.muted, fontSize: 10.5 }}>
                            💱 Tasa: {fmtTasaCambio(pRate)} Bs/${p.exchange_rate ? ' (fijada)' : ''}
                          </Text>
                        ) : null}
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 15, fontVariant: ['tabular-nums'] as any }}>{usd(p.total_amount)}</Text>
                        {pVes != null ? (
                          <Text style={{ color: colors.success, fontWeight: '800', fontSize: 12, fontVariant: ['tabular-nums'] as any }}>
                            {fmtMontoVes(pVes)}
                          </Text>
                        ) : null}
                      </View>
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
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg }}>
            <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 18, marginBottom: spacing.md }}>Nueva nómina</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>Empresa</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, paddingVertical: spacing.xs }}>
              {generalCompanies(companies).map((c) => {
                const on = cCompany === c.id;
                return (
                  <TouchableOpacity key={c.id} onPress={() => setCCompany(c.id)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                    <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{c.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Nombre (ej. "Quincena 1 - julio")</Text>
            <TextInput value={cName} onChangeText={setCName} placeholder="Nombre de la nómina" placeholderTextColor={colors.muted} style={input} />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' }}>
              <View style={{ flex: 1, minWidth: 130 }}><Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Desde</Text><DateField value={cFrom} onChange={setCFrom} /></View>
              <View style={{ flex: 1, minWidth: 130 }}><Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Hasta</Text><DateField value={cTo} onChange={setCTo} /></View>
            </View>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>💱 Tasa de cambio para esta nómina (Bs/$)</Text>
            <TextInput
              value={cRateText}
              onChangeText={(t) => setCRateText(onlyDecimal(t))}
              keyboardType="decimal-pad"
              inputMode="decimal"
              placeholder={bcvRateInfo.rate ? `Por defecto: ${fmtTasaCambio(bcvRateInfo.rate)}` : 'Ej: 45,50'}
              placeholderTextColor={colors.muted}
              style={input}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
              <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setCreateOpen(false)}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 2, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.accent, opacity: creating ? 0.7 : 1 }} onPress={crearPeriodo} disabled={creating}>
                <Text style={{ color: colors.accentContrast, fontWeight: '800' }}>{creating ? 'Creando…' : 'Crear y precargar empleados'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal: Organigrama (vista previa + descarga) */}
      <Modal visible={orgOpen} transparent animationType="slide" onRequestClose={() => setOrgOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <ScrollView style={{ maxHeight: '88%' }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg }}>
            <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 18 }}>🗂️ Organigrama</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>Estructura corporativa de la empresa por cargos (fija y completa): Dirección arriba y dos áreas — azul (Administración, servicios y soporte) y naranja (Operaciones y mantenimiento de maquinaria).</Text>

            <TouchableOpacity onPress={verOrganigrama} style={{ marginTop: spacing.md, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm }}>
              <EyeIcon size={20} color={colors.accentContrast} open />
              <Text style={{ color: colors.accentContrast, fontWeight: '800' }}>Vista previa {Platform.OS === 'web' ? '(y guardar PDF)' : '(PDF)'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={descargarOrgPng} style={{ marginTop: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
              <Text style={{ color: colors.brandText, fontWeight: '800' }}>🖼️ Descargar imagen (PNG)</Text>
            </TouchableOpacity>

            {/* Manual de cargos: funciones + de quién depende + a quién manda. */}
            <View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing.md }} />
            <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 15 }}>📋 Manual de cargos</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2, marginBottom: spacing.sm }}>Funciones de cada cargo, de quién depende y qué personal tiene a su cargo.</Text>
            <TouchableOpacity onPress={verFichasGeneral} style={{ backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm }}>
              <EyeIcon size={20} color={colors.accentContrast} open />
              <Text style={{ color: colors.accentContrast, fontWeight: '800' }}>PDF general — todos los cargos</Text>
            </TouchableOpacity>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>…o busca un cargo y toca para ver su ficha:</Text>
            <TextInput value={fichaQ} onChangeText={setFichaQ} placeholder="🔎 Buscar cargo…" placeholderTextColor={colors.muted} style={input} />
            <ScrollView style={{ maxHeight: 220, marginTop: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }} showsVerticalScrollIndicator keyboardShouldPersistTaps="handled">
              {cargosFiltrados.length === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center', padding: spacing.md }}>Sin cargos que coincidan.</Text>
              ) : cargosFiltrados.map((c) => (
                <TouchableOpacity key={c.title} onPress={() => { setCargoSel(c.title); verFichaCargo(c.title); }} style={{ paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: cargoSel === c.title ? colors.surfaceAlt : 'transparent' }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{c.title.toUpperCase()}</Text>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>{c.area}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity onPress={() => setOrgOpen(false)} style={{ marginTop: spacing.md, paddingVertical: spacing.md, alignItems: 'center' }}>
              <Text style={{ color: colors.muted, fontWeight: '700' }}>Cerrar</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* Modal: detalle del período */}
      <Modal visible={!!sel} animationType="slide" onRequestClose={() => setSel(null)}>
        <Screen>
          {sel ? (
            <>
              <TouchableOpacity onPress={() => setSel(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm }}>
                <Text style={{ color: colors.brandText, fontSize: 20, fontWeight: '800' }}>←</Text>
                <Text style={{ color: colors.brandText, fontWeight: '700' }}>Volver</Text>
              </TouchableOpacity>
              <SectionTitle>{sel.name}</SectionTitle>
              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>🏢 {companyName(sel.company_id)}</Text>
                  <Badge label={(PAGO_STATUS_META[sel.status] ?? PAGO_STATUS_META.borrador).label} tone={(PAGO_STATUS_META[sel.status] ?? PAGO_STATUS_META.borrador).tone} />
                </View>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{fmtDMY(sel.period_start)} → {fmtDMY(sel.period_end)}</Text>

                {/* Tasa de cambio del período */}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: spacing.xs,
                    backgroundColor: colors.surfaceAlt,
                    borderRadius: radius.md,
                    paddingVertical: 6,
                    paddingHorizontal: spacing.sm,
                    marginTop: spacing.xs,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 1, maxWidth: '100%' }}>
                    <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>💱 Tasa período:</Text>
                    <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13 }}>
                      {activePeriodRate ? `${fmtTasaCambio(activePeriodRate)} Bs/$` : 'Sin tasa'}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>
                      ({sel.exchange_rate ? 'Fijada en esta nómina' : 'Tasa del día'})
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      setPeriodRateText(activePeriodRate ? String(activePeriodRate).replace('.', ',') : '');
                      setPeriodRateEditOpen((v) => !v);
                    }}
                    style={{
                      paddingHorizontal: spacing.sm,
                      paddingVertical: 3,
                      borderRadius: radius.pill,
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                    }}
                  >
                    <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 11 }}>
                      {periodRateEditOpen ? '✕ Cerrar' : '✎ Cambiar tasa'}
                    </Text>
                  </TouchableOpacity>
                </View>
                {periodRateEditOpen ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs, flexWrap: 'wrap' }}>
                    <TextInput
                      value={periodRateText}
                      onChangeText={(t) => setPeriodRateText(onlyDecimal(t))}
                      keyboardType="decimal-pad"
                      inputMode="decimal"
                      placeholder="Ej: 45,50"
                      placeholderTextColor={colors.muted}
                      style={{ ...input, flex: 1, minWidth: 110, paddingVertical: 6 }}
                    />
                    <TouchableOpacity
                      onPress={() => guardarTasaPeriodo(false)}
                      disabled={periodRateSaving}
                      style={{
                        paddingHorizontal: spacing.md,
                        paddingVertical: 7,
                        borderRadius: radius.md,
                        backgroundColor: colors.accent,
                      }}
                    >
                      <Text style={{ color: colors.accentContrast, fontWeight: '800', fontSize: 12 }}>
                        {periodRateSaving ? '…' : 'Fijar en período'}
                      </Text>
                    </TouchableOpacity>
                    {sel.exchange_rate ? (
                      <TouchableOpacity
                        onPress={() => guardarTasaPeriodo(true)}
                        disabled={periodRateSaving}
                        style={{
                          paddingHorizontal: spacing.sm,
                          paddingVertical: 7,
                          borderRadius: radius.md,
                          backgroundColor: colors.surfaceAlt,
                          borderWidth: 1,
                          borderColor: colors.border,
                        }}
                      >
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11 }}>Usar tasa del día</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : null}

                <View style={{ backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.xs, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs }}>
                  <Text style={{ color: colors.brandContrast, opacity: 0.85, fontWeight: '800', fontSize: 12, letterSpacing: 0.5 }}>TOTAL A PAGAR</Text>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 22, fontVariant: ['tabular-nums'] as any }}>{usd(sel.total_amount)}</Text>
                    {fmtVes(sel.total_amount) ? (
                      <Text style={{ color: colors.brandContrast, opacity: 0.92, fontWeight: '800', fontSize: 13, fontVariant: ['tabular-nums'] as any }}>
                        {fmtVes(sel.total_amount)}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </Card>

              {/* Acciones del período */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
                {sel.status === 'borrador' ? (
                  <TouchableOpacity onPress={agregarFaltantes} disabled={busy} style={{ flexGrow: 1, flexBasis: 130, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>{busy ? '…' : '＋ Empleados faltantes'}</Text>
                  </TouchableOpacity>
                ) : null}
                {sel.status === 'borrador' ? (
                  <TouchableOpacity onPress={() => setStatus('aprobada')} disabled={busy} style={{ flexGrow: 1, flexBasis: 100, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.accent }}>
                    <Text style={{ color: colors.accentContrast, fontWeight: '800', fontSize: 12 }}>✅ Aprobar</Text>
                  </TouchableOpacity>
                ) : null}
                {sel.status === 'aprobada' ? (
                  <TouchableOpacity onPress={() => setStatus('pagada')} disabled={busy} style={{ flexGrow: 1, flexBasis: 100, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.successSoftBg, borderWidth: 1, borderColor: colors.successSoftBorder }}>
                    <Text style={{ color: colors.successSoftText, fontWeight: '800', fontSize: 12 }}>💵 Marcar pagada</Text>
                  </TouchableOpacity>
                ) : null}
                {sel.status !== 'borrador' ? (
                  <TouchableOpacity onPress={() => setStatus('borrador')} disabled={busy} style={{ flexGrow: 1, flexBasis: 100, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>↩ Reabrir</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity onPress={reportePdf} style={{ flexGrow: 1, flexBasis: 100, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.brand }}>
                  <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>⬇️ Reporte</Text>
                </TouchableOpacity>
              </View>

              {itemsLoading ? (
                <Loading />
              ) : items.length === 0 ? (
                <EmptyState title="Sin empleados" subtitle="No hay empleados activos en esta empresa. Agrégalos en Empleados y usa “Empleados faltantes”." />
              ) : (
                items.map((it) => (
                  <Card key={it.id}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{it.employee_name}</Text>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>{[it.cargo, it.ficha_number ? `Ficha ${it.ficha_number}` : ''].filter(Boolean).join(' · ')}</Text>
                        {it.hire_date ? <Text style={{ color: colors.muted, fontSize: 12 }}>📅 Ingreso: {fmtDMY(it.hire_date)}</Text> : null}
                        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                          Base {usd(it.base_amount)}{sumLines(it.additions) ? ` · +${usd(sumLines(it.additions))}` : ''}{sumLines(it.deductions) ? ` · −${usd(sumLines(it.deductions))}` : ''}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 16, fontVariant: ['tabular-nums'] as any }}>{usd(it.net_amount)}</Text>
                        {fmtVes(it.net_amount) ? (
                          <Text style={{ color: colors.success, fontWeight: '800', fontSize: 12, fontVariant: ['tabular-nums'] as any }}>
                            {fmtVes(it.net_amount)}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
                      <TouchableOpacity onPress={() => openItem(it)} style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: readOnly ? colors.surfaceAlt : colors.accent, borderWidth: readOnly ? 1 : 0, borderColor: colors.border }}>
                        <Text style={{ color: readOnly ? colors.text : colors.accentContrast, fontWeight: '800', fontSize: 12 }}>{readOnly ? '👁 Ver' : '✎ Editar'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => reciboPdf(it)} style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>🧾 Recibo</Text>
                      </TouchableOpacity>
                    </View>
                  </Card>
                ))
              )}

              {sel.status === 'borrador' ? (
                <TouchableOpacity onPress={eliminarPeriodo} disabled={busy} style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.danger }}>
                  <Text style={{ color: colors.danger, fontWeight: '700' }}>🗑️ Eliminar nómina</Text>
                </TouchableOpacity>
              ) : null}
              <View style={{ height: spacing.lg }} />
            </>
          ) : null}
        </Screen>
      </Modal>

      {/* Modal: editor de renglón (empleado) */}
      <Modal visible={!!editItem} transparent animationType="slide" onRequestClose={() => setEditItem(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: '90%' }}>
            {editItem ? (
              <ScrollView>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }}>{editItem.employee_name}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{editItem.cargo ?? ''}{editItem.ficha_number ? ` · Ficha ${editItem.ficha_number}` : ''}</Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>{editItem.hire_date ? `📅 Ingreso: ${fmtDMY(editItem.hire_date)}` : ''}</Text>

                <Text style={{ color: colors.muted, fontSize: 12 }}>Salario Semanal / Base ($)</Text>
                <TextInput value={eBase} onChangeText={(t) => setEBase(onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" editable={!readOnly} placeholder="0" placeholderTextColor={colors.muted} style={input} />

                {lineEditor({ title: 'Asignaciones', lines: eAdd, setLines: setEAdd, color: colors.success })}
                {lineEditor({ title: 'Deducciones', lines: eDed, setLines: setEDed, color: colors.danger })}

                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Nota (opcional)</Text>
                <TextInput value={eNote} onChangeText={setENote} editable={!readOnly} placeholder="Observación…" placeholderTextColor={colors.muted} style={input} />

                <View style={{ backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs }}>
                  <Text style={{ color: colors.brandContrast, opacity: 0.85, fontWeight: '800', fontSize: 12, letterSpacing: 0.5 }}>NETO A PAGAR</Text>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 22, fontVariant: ['tabular-nums'] as any }}>{usd(netOf(parseNum(eBase), eAdd, eDed))}</Text>
                    {fmtVes(netOf(parseNum(eBase), eAdd, eDed)) ? (
                      <Text style={{ color: colors.brandContrast, opacity: 0.92, fontWeight: '800', fontSize: 13, fontVariant: ['tabular-nums'] as any }}>
                        {fmtVes(netOf(parseNum(eBase), eAdd, eDed))}
                      </Text>
                    ) : null}
                  </View>
                </View>

                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                  <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setEditItem(null)}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>{readOnly ? 'Cerrar' : 'Cancelar'}</Text>
                  </TouchableOpacity>
                  {!readOnly ? (
                    <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.accent }} onPress={guardarItem}>
                      <Text style={{ color: colors.accentContrast, fontWeight: '800' }}>Guardar</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                <View style={{ height: spacing.lg }} />
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
