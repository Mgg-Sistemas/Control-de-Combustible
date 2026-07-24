import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Alert, Platform } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import { supabase } from '../lib/supabase';
import { exportPdf, exportCardImage, pdfDocument } from '../lib/pdf';
import { organigramaHtml, organigramaCard, ORG_STYLES, ORG_SHEET_MM, fichasHtml, fichaCargoHtml, listaCargos } from '../lib/organigrama';
import { EyeIcon } from '../components/EyeIcon';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { onlyDecimal, cmpText } from '../lib/text';
import { PayrollPeriod, PayrollItem, PayrollLine, Company } from '../types/database';
import { generalCompanies } from '../lib/companies';
import { useTable } from '../hooks/useTable';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

const usd = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function parseNum(t: string): number { const n = Number(String(t ?? '').replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; }
function todayISO(): string { const d = new Date(); return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`; }
const sumLines = (l: PayrollLine[]) => (l || []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
const netOf = (base: number, add: PayrollLine[], ded: PayrollLine[]) => Math.round((base + sumLines(add) - sumLines(ded)) * 100) / 100;
const fmtDMY = (iso?: string | null) => { const [y, m, d] = String(iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : (iso || '—'); };

const STATUS_META: Record<string, { label: string; color: string }> = {
  borrador: { label: '📝 Borrador', color: '#F59E0B' },
  aprobada: { label: '✅ Aprobada', color: '#2563EB' },
  pagada: { label: '💵 Pagada', color: '#16A34A' },
};

export default function NominaScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { session, canSee } = useAuth();
  const confirm = useConfirm();
  const { data: periods, loading, refetch } = useTable<PayrollPeriod>('payroll_periods', { orderBy: 'created_at', ascending: false });
  const { data: companies } = useTable<Company>('companies', { orderBy: 'name' });
  const companyName = (id: string | null) => (id ? companies.find((c) => c.id === id)?.name ?? 'Empresa' : 'Sin empresa');

  // Crear período
  const [createOpen, setCreateOpen] = useState(false);
  const [cCompany, setCCompany] = useState('');
  const [cName, setCName] = useState('');
  const [cFrom, setCFrom] = useState(todayISO());
  const [cTo, setCTo] = useState(todayISO());
  const [creating, setCreating] = useState(false);

  // Detalle
  const [sel, setSel] = useState<PayrollPeriod | null>(null);
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
  const verFichasGeneral = () => { exportPdf(fichasHtml(), 'Manual de cargos SOS La Guaira'); };
  const verFichaCargo = (title: string) => { exportPdf(fichaCargoHtml(title), `Ficha - ${title}`); };

  const loadItems = async (pid: string) => {
    setItemsLoading(true);
    const { data } = await supabase.from('payroll_items').select('*').eq('period_id', pid).order('employee_name');
    setItems((data ?? []) as PayrollItem[]);
    setItemsLoading(false);
  };
  const openDetail = (p: PayrollPeriod) => { setSel(p); setItems([]); loadItems(p.id); };

  const crearPeriodo = async () => {
    if (!cCompany) return Alert.alert('Aviso', 'Elige la empresa.');
    if (!cName.trim()) return Alert.alert('Aviso', 'Escribe el nombre de la nómina (ej. "Quincena 1 - julio").');
    setCreating(true);
    const { data: per, error } = await supabase.from('payroll_periods')
      .insert({ company_id: cCompany, name: cName.trim(), period_start: cFrom || null, period_end: cTo || null, status: 'borrador', created_by: session?.user?.id ?? null })
      .select().single();
    if (error || !per) { setCreating(false); return Alert.alert('Aviso', error?.message ?? 'No se pudo crear.'); }
    // Precarga: un renglón por cada empleado ACTIVO de la empresa, con su salario base.
    const { data: emps } = await supabase.from('employees')
      .select('id, first_name, last_name, cargo, ficha_number, cedula, hire_date, base_salary')
      .eq('company_id', cCompany).eq('status', 'activo');
    const rows = (emps ?? []).map((e: any) => {
      const base = Number(e.base_salary) || 0;
      return { period_id: per.id, employee_id: e.id, employee_name: `${e.first_name} ${e.last_name}`.trim(), cargo: e.cargo, ficha_number: e.ficha_number, cedula: e.cedula, hire_date: e.hire_date ?? null, base_amount: base, additions: [], deductions: [], net_amount: base };
    });
    if (rows.length) await supabase.from('payroll_items').insert(rows);
    const total = rows.reduce((s, r) => s + r.net_amount, 0);
    await supabase.from('payroll_periods').update({ total_amount: total }).eq('id', per.id);
    setCreating(false); setCreateOpen(false); setCName('');
    refetch();
    openDetail({ ...(per as PayrollPeriod), total_amount: total });
  };

  const agregarFaltantes = async () => {
    if (!sel) return;
    setBusy(true);
    const { data: emps } = await supabase.from('employees')
      .select('id, first_name, last_name, cargo, ficha_number, cedula, hire_date, base_salary')
      .eq('company_id', sel.company_id).eq('status', 'activo');
    const have = new Set(items.map((it) => it.employee_id));
    const rows = (emps ?? []).filter((e: any) => !have.has(e.id)).map((e: any) => {
      const base = Number(e.base_salary) || 0;
      return { period_id: sel.id, employee_id: e.id, employee_name: `${e.first_name} ${e.last_name}`.trim(), cargo: e.cargo, ficha_number: e.ficha_number, cedula: e.cedula, hire_date: e.hire_date ?? null, base_amount: base, additions: [], deductions: [], net_amount: base };
    });
    if (rows.length) await supabase.from('payroll_items').insert(rows);
    await loadItems(sel.id);
    await recomputeTotal(sel.id);
    setBusy(false);
    if (!rows.length) Alert.alert('Aviso', 'No hay empleados activos nuevos para agregar.');
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
    if (error) return Alert.alert('Aviso', error.message);
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
    if (error) return Alert.alert('Aviso', error.message);
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
    if (error) return Alert.alert('Aviso', error.message);
    setSel(null);
    refetch();
  };

  // ── PDF: recibo de un empleado ────────────────────────────────────────────
  const reciboPdf = async (it: PayrollItem) => {
    if (!sel) return;
    const line = (l: PayrollLine) => `<tr><td>${(l.label || '—')}</td><td style="text-align:right">${usd(l.amount)}</td></tr>`;
    const add = (it.additions || []); const ded = (it.deductions || []);
    const html = pdfDocument({
      title: 'Recibo de pago',
      subtitle: `${it.employee_name ?? ''} · ${companyName(sel.company_id)} · ${sel.name}`,
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
        </tbody></table>
        <table><thead><tr><th>Asignaciones</th><th style="text-align:right">Monto</th></tr></thead>
        <tbody><tr><td>Sueldo base</td><td style="text-align:right">${usd(it.base_amount)}</td></tr>
          ${add.map(line).join('')}
          <tr class="tot"><td>Total asignaciones</td><td style="text-align:right">${usd(Number(it.base_amount) + sumLines(add))}</td></tr></tbody></table>
        ${ded.length ? `<table><thead><tr><th>Deducciones</th><th style="text-align:right">Monto</th></tr></thead>
        <tbody>${ded.map(line).join('')}
          <tr class="tot"><td>Total deducciones</td><td style="text-align:right">${usd(sumLines(ded))}</td></tr></tbody></table>` : ''}
        <div class="net">Neto a pagar: ${usd(it.net_amount)}</div>`,
    });
    await exportPdf(html, `Recibo - ${it.employee_name}`);
  };

  // ── PDF: reporte del período completo ─────────────────────────────────────
  const reportePdf = async () => {
    if (!sel) return;
    const rows = items.map((it) =>
      `<tr><td>${it.employee_name ?? '—'}</td><td>${it.cargo ?? '—'}</td><td>${it.ficha_number ?? '—'}</td><td>${fmtDMY(it.hire_date)}</td>` +
      `<td style="text-align:right">${usd(it.base_amount)}</td><td style="text-align:right">${usd(sumLines(it.additions))}</td>` +
      `<td style="text-align:right">${usd(sumLines(it.deductions))}</td><td style="text-align:right;font-weight:800">${usd(it.net_amount)}</td></tr>`
    ).join('');
    const total = items.reduce((s, it) => s + (Number(it.net_amount) || 0), 0);
    const html = pdfDocument({
      title: 'Nómina',
      subtitle: `${companyName(sel.company_id)} · ${sel.name} · ${fmtDMY(sel.period_start)} → ${fmtDMY(sel.period_end)} · ${STATUS_META[sel.status]?.label ?? sel.status}`,
      extraCss: `table{width:100%;border-collapse:collapse;margin-top:12px;font-size:11px}
        th,td{border:1px solid #ccc;padding:5px 7px;text-align:left} th{background:#1E3A5F;color:#fff}
        tfoot td{background:#EEF2F7;font-weight:800}`,
      body: `
        <table><thead><tr><th>Empleado</th><th>Cargo</th><th>Ficha</th><th>Ingreso</th><th style="text-align:right">Base</th>
          <th style="text-align:right">Asign.</th><th style="text-align:right">Deducc.</th><th style="text-align:right">Neto</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" style="text-align:center">Sin empleados</td></tr>'}</tbody>
        <tfoot><tr><td colspan="7" style="text-align:right">TOTAL A PAGAR (${items.length} empleado(s))</td><td style="text-align:right">${usd(total)}</td></tr></tfoot></table>`,
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
  const LineEditor = ({ title, lines, setLines, color }: { title: string; lines: PayrollLine[]; setLines: (l: PayrollLine[]) => void; color: string }) => (
    <View style={{ marginTop: spacing.sm }}>
      <Text style={{ color, fontWeight: '800', fontSize: 13, marginBottom: 4 }}>{title}</Text>
      {lines.map((l, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: 4, alignItems: 'center' }}>
          <TextInput value={l.label} onChangeText={(t) => setLines(lines.map((x, j) => (j === i ? { ...x, label: t } : x)))} placeholder="Concepto" placeholderTextColor={colors.muted} style={{ ...input, flex: 2 }} />
          <TextInput value={l.amount ? String(l.amount) : ''} onChangeText={(t) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: parseNum(t) } : x)))} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.muted} style={{ ...input, flex: 1, textAlign: 'right' }} />
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
        <TouchableOpacity onPress={() => { setCCompany(''); setCName(''); setCFrom(todayISO()); setCTo(todayISO()); setCreateOpen(true); }} style={{ backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
          <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>+ Nueva</Text>
        </TouchableOpacity>
      </View>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>Crea una nómina por empresa y período. Se precargan los empleados activos con su salario.</Text>

      {/* Acceso a la ficha de EMPLEADOS (RRHH) desde Nómina. */}
      <TouchableOpacity
        onPress={() => navigation?.navigate('Empleados')}
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md }}
      >
        <Text style={{ fontSize: 20 }}>🪪</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>Empleados</Text>
          <Text style={{ color: colors.muted, fontSize: 11 }}>Fichas del personal (foto, cédula, cargo) y carnet con QR</Text>
        </View>
        <Text style={{ color: colors.primary, fontWeight: '800' }}>›</Text>
      </TouchableOpacity>

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
          <Text style={{ color: colors.primary, fontWeight: '800' }}>›</Text>
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
        <Text style={{ color: colors.primary, fontWeight: '800' }}>›</Text>
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
        <Text style={{ color: colors.primary, fontWeight: '800' }}>›</Text>
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
        <Text style={{ color: colors.primary, fontWeight: '800' }}>›</Text>
      </TouchableOpacity>

      {loading && periods.length === 0 ? (
        <Loading />
      ) : periods.length === 0 ? (
        <EmptyState title="Sin nóminas" subtitle="Toca “+ Nueva” para crear la primera." />
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
                      <Text style={{ color: colors.muted, fontSize: 12 }}>{fmtDMY(p.period_start)} → {fmtDMY(p.period_end)}</Text>
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
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18, marginBottom: spacing.md }}>Nueva nómina</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>Empresa</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, paddingVertical: spacing.xs }}>
              {generalCompanies(companies).map((c) => {
                const on = cCompany === c.id;
                return (
                  <TouchableOpacity key={c.id} onPress={() => setCCompany(c.id)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                    <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{c.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Nombre (ej. "Quincena 1 - julio")</Text>
            <TextInput value={cName} onChangeText={setCName} placeholder="Nombre de la nómina" placeholderTextColor={colors.muted} style={input} />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <View style={{ flex: 1 }}><Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Desde</Text><DateField value={cFrom} onChange={setCFrom} /></View>
              <View style={{ flex: 1 }}><Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Hasta</Text><DateField value={cTo} onChange={setCTo} /></View>
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
              <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setCreateOpen(false)}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 2, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary, opacity: creating ? 0.7 : 1 }} onPress={crearPeriodo} disabled={creating}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>{creating ? 'Creando…' : 'Crear y precargar empleados'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal: Organigrama (vista previa + descarga) */}
      <Modal visible={orgOpen} transparent animationType="slide" onRequestClose={() => setOrgOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <ScrollView style={{ maxHeight: '88%' }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18 }}>🗂️ Organigrama</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>Estructura corporativa de la empresa por cargos (fija y completa): Dirección arriba y dos áreas — azul (Administración, servicios y soporte) y naranja (Operaciones y mantenimiento de maquinaria).</Text>

            <TouchableOpacity onPress={verOrganigrama} style={{ marginTop: spacing.md, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm }}>
              <EyeIcon size={20} color={colors.primaryContrast} open />
              <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>Vista previa {Platform.OS === 'web' ? '(y guardar PDF)' : '(PDF)'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={descargarOrgPng} style={{ marginTop: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
              <Text style={{ color: colors.primary, fontWeight: '800' }}>🖼️ Descargar imagen (PNG)</Text>
            </TouchableOpacity>

            {/* Manual de cargos: funciones + de quién depende + a quién manda. */}
            <View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing.md }} />
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>📋 Manual de cargos</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2, marginBottom: spacing.sm }}>Funciones de cada cargo, de quién depende y qué personal tiene a su cargo.</Text>
            <TouchableOpacity onPress={verFichasGeneral} style={{ backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm }}>
              <EyeIcon size={20} color={colors.primaryContrast} open />
              <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>PDF general — todos los cargos</Text>
            </TouchableOpacity>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>…o toca un cargo para ver su ficha:</Text>
            <ScrollView style={{ maxHeight: 170 }} showsVerticalScrollIndicator>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, paddingBottom: 4 }}>
                {cargosLista.map((c) => (
                  <TouchableOpacity key={c.title} onPress={() => { setCargoSel(c.title); verFichaCargo(c.title); }} style={{ borderWidth: 1, borderColor: cargoSel === c.title ? colors.primary : colors.border, backgroundColor: cargoSel === c.title ? colors.primary : colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                    <Text style={{ color: cargoSel === c.title ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{c.title}</Text>
                  </TouchableOpacity>
                ))}
              </View>
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
                <Text style={{ color: colors.primary, fontSize: 20, fontWeight: '800' }}>←</Text>
                <Text style={{ color: colors.primary, fontWeight: '700' }}>Volver</Text>
              </TouchableOpacity>
              <SectionTitle>{sel.name}</SectionTitle>
              <Card>
                <Text style={{ color: colors.text, fontWeight: '700' }}>🏢 {companyName(sel.company_id)}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{fmtDMY(sel.period_start)} → {fmtDMY(sel.period_end)}</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xs }}>
                  <Text style={{ color: (STATUS_META[sel.status] ?? STATUS_META.borrador).color, fontWeight: '800' }}>{(STATUS_META[sel.status] ?? STATUS_META.borrador).label}</Text>
                  <Text style={{ color: colors.success, fontWeight: '800', fontSize: 18 }}>{usd(sel.total_amount)}</Text>
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
                  <TouchableOpacity onPress={() => setStatus('aprobada')} disabled={busy} style={{ flexGrow: 1, flexBasis: 100, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: '#2563EB' }}>
                    <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>✅ Aprobar</Text>
                  </TouchableOpacity>
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
                      <Text style={{ color: colors.success, fontWeight: '800', fontSize: 16 }}>{usd(it.net_amount)}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
                      <TouchableOpacity onPress={() => openItem(it)} style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: readOnly ? colors.surfaceAlt : colors.primary, borderWidth: readOnly ? 1 : 0, borderColor: colors.border }}>
                        <Text style={{ color: readOnly ? colors.text : colors.primaryContrast, fontWeight: '700', fontSize: 12 }}>{readOnly ? '👁 Ver' : '✎ Editar'}</Text>
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

                <Text style={{ color: colors.muted, fontSize: 12 }}>Sueldo base ($)</Text>
                <TextInput value={eBase} onChangeText={(t) => setEBase(onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" editable={!readOnly} placeholder="0" placeholderTextColor={colors.muted} style={input} />

                <LineEditor title="Asignaciones" lines={eAdd} setLines={setEAdd} color={colors.success} />
                <LineEditor title="Deducciones" lines={eDed} setLines={setEDed} color={colors.danger} />

                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Nota (opcional)</Text>
                <TextInput value={eNote} onChangeText={setENote} editable={!readOnly} placeholder="Observación…" placeholderTextColor={colors.muted} style={input} />

                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <Text style={{ color: colors.text, fontWeight: '800' }}>Neto a pagar</Text>
                  <Text style={{ color: colors.success, fontWeight: '800', fontSize: 20 }}>{usd(netOf(parseNum(eBase), eAdd, eDed))}</Text>
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
                <View style={{ height: spacing.lg }} />
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
