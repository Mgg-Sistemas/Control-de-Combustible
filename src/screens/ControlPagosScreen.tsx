import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, TextInput, ScrollView } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { supabase, selectAllRows } from '../lib/supabase';
import { norm, onlyDecimal } from '../lib/text';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { workedFromShifts } from './ControlMaquinariaScreen';
import { DateField } from '../components/DateField';
import { CompanyPayment, PaymentDetail, Payroll, PriceTariff } from '../types/database';
import { matchTariffModelo } from '../lib/tariffs';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

// ── Utilidades de fecha (semana lunes→domingo, rangos de 7 días) ──────────────
function toISO(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
function weekStartISO(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  const diff = (d.getDay() + 6) % 7; // días desde el lunes
  d.setDate(d.getDate() - diff);
  return toISO(d);
}
function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return toISO(d);
}
function todayISO(): string {
  return toISO(new Date());
}
/** Días entre dos fechas ISO (b − a). Mismo día = 0. */
function daysBetween(aISO: string, bISO: string): number {
  const a = new Date(aISO + 'T12:00:00').getTime();
  const b = new Date(bISO + 'T12:00:00').getTime();
  return Math.round((b - a) / 86400000);
}
/** Fecha ISO "AAAA-MM-DD" → "DD/MM/AAAA" (para los PDF). */
function fmtDMY(iso?: string | null): string {
  const [y, m, d] = (iso || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : (iso || '');
}

// ── Formato de dinero: SIEMPRE 2 decimales, redondeo estándar (si el 3er decimal
//    es ≥ 5 sube el 2º). Ej.: 46,666 → 46,67 · 85895833,333 → 85.895.833,33 ──────
function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
function money(n: number): string {
  return round2(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const CURRENCIES = [
  { label: 'Dólares (USD)', value: 'USD' },
  { label: 'Bolívares (Bs)', value: 'Bs' },
  { label: 'Euros (EUR)', value: 'EUR' },
  { label: 'Pesos (COP)', value: 'COP' },
];

type DayInfo = { stopped: number; overtime: number; day: number; night: number };
type MachineAgg = {
  machine: string;        // etiqueta visible (nombre · serial/placa)
  serial: string | null;  // serial único (identifica la máquina física)
  price: number | null;   // precio EFECTIVO en uso (actual o del cierre según el modo)
  priceCurrent: number | null; // precio actual de la máquina
  priceFrozen: number | null;  // precio congelado en el cierre de esa semana (si existe)
  hours: number;      // horas trabajadas totales (día + noche − parada + extras)
  dayHours: number;   // total horas de turno de día
  nightHours: number; // total horas de turno de noche
  subtotal: number;
  perDay: Record<string, DayInfo>;
};

/**
 * Horas cobrables de un día = (turno día + turno noche) − parada + extras.
 * Solo se cobra si la máquina trabajó al menos un turno ese día.
 */
function billableHours(d: DayInfo): number {
  return d.day + d.night > 0 ? workedFromShifts(d.day, d.night, d.stopped, d.overtime) : 0;
}
type Group = {
  key: string;            // company|weekStart (para el toggle de precios)
  company: string;
  companyId: string | null;
  weekStart: string;
  weekEnd: string;
  machines: Record<string, MachineAgg>;
  total: number;
  hoursWorked: number;
  noPrice: boolean;
  // Precios: si la semana está cerrada y tiene precio congelado, se puede elegir
  // "Del cierre" (revertir) o "Actuales" (sincronizar). hasFrozen = hay precio de cierre.
  hasFrozen: boolean;
  priceMode: 'actual' | 'cierre';
  // Abonos (pagos parciales) de la semana: se acumulan hasta cubrir el total.
  abonos: CompanyPayment[]; // todos los abonos de esta empresa+semana
  paidAmount: number;       // suma de abonos
  saldo: number;            // total − abonado (nunca negativo)
  fullyPaid: boolean;       // saldado por completo
};

/**
 * Recalcula un grupo (empresa+semana) según el MODO de precio elegido:
 * - 'cierre'  → usa el precio congelado del cierre (revertir / inmutable)
 * - 'actual'  → usa el precio actual de la máquina (sincronizar con lo nuevo)
 * Ajusta precio efectivo, subtotales, total, saldo y "pagado por completo".
 */
function recomputeGroup(g: Group): void {
  let total = 0;
  let hoursWorked = 0;
  let noPrice = false;
  Object.values(g.machines).forEach((ma) => {
    const eff = g.priceMode === 'cierre' && ma.priceFrozen != null ? ma.priceFrozen : ma.priceCurrent;
    ma.price = eff;
    const days = Object.values(ma.perDay);
    const hrs = days.reduce((s, d) => s + billableHours(d), 0);
    const units = hrs / 12;
    ma.hours = hrs;
    ma.dayHours = days.reduce((s, d) => s + (d.day + d.night > 0 ? d.day : 0), 0);
    ma.nightHours = days.reduce((s, d) => s + (d.day + d.night > 0 ? d.night : 0), 0);
    ma.subtotal = round2((eff ?? 0) * units);
    total += ma.subtotal;
    hoursWorked += hrs;
    if (eff == null && hrs > 0) noPrice = true;
  });
  g.total = round2(total);
  g.hoursWorked = hoursWorked;
  g.noPrice = noPrice;
  g.saldo = Math.max(0, round2(g.total - (g.paidAmount || 0)));
  g.fullyPaid = g.total > 0 && (g.paidAmount || 0) >= g.total - 0.01;
}

export default function ControlPagosScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { canSee, role, session } = useAuth();
  const confirm = useConfirm();
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<Group[]>([]);
  const [payments, setPayments] = useState<CompanyPayment[]>([]);
  const [payrolls, setPayrolls] = useState<Payroll[]>([]); // nóminas por empresa
  const [selected, setSelected] = useState<Group | null>(null);
  // Nómina
  const [nominaFor, setNominaFor] = useState<string | null>(null); // empresa
  const [nominaAmount, setNominaAmount] = useState('');
  const [nominaNote, setNominaNote] = useState('');
  const [savingNomina, setSavingNomina] = useState(false);
  const [query, setQuery] = useState('');
  const [expandedCompany, setExpandedCompany] = useState<Record<string, boolean>>({}); // empresa → desplegada

  // Marcar como pagada
  const [payFor, setPayFor] = useState<Group | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payCurrency, setPayCurrency] = useState('USD');
  const [saving, setSaving] = useState(false);

  // Histórico y detalle de un pago
  const [histOpen, setHistOpen] = useState(false);
  const [histSel, setHistSel] = useState<CompanyPayment | null>(null);

  // Reporte
  const [repOpen, setRepOpen] = useState(false);
  // Empresas seleccionadas para el reporte. Vacío = TODAS (reporte general).
  const [repCompanies, setRepCompanies] = useState<string[]>([]);
  const [repFrom, setRepFrom] = useState(addDaysISO(todayISO(), -30));
  const [repTo, setRepTo] = useState(todayISO());

  // Tabulador de precios (editable) + sincronización
  const [tarOpen, setTarOpen] = useState(false);
  const [tariffs, setTariffs] = useState<PriceTariff[]>([]);
  const [tarEdits, setTarEdits] = useState<Record<string, string>>({}); // modelo → precio (texto) del ámbito actual
  const [tarSaving, setTarSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // Ámbito del tabulador: 'general' o el id de una empresa (precio propio de esa empresa).
  const [tarScope, setTarScope] = useState<string>('general');
  const [tarCompanies, setTarCompanies] = useState<{ id: string; name: string }[]>([]);
  // Overrides por empresa: companyId → (modelo → precio).
  const [companyTar, setCompanyTar] = useState<Record<string, Record<string, number>>>({});
  // Vista previa del sync: filas emparejadas (con cuántas máquinas cambian) y sin emparejar.
  const [syncPreview, setSyncPreview] = useState<null | {
    changes: { modelo: string; price: number; machines: { id: string; label: string; from: number | null }[] }[];
    unmatched: { id: string; label: string; tipo: string | null }[];
    totalChanges: number;
  }>(null);

  const canEditTar = role === 'admin' || role === 'supervisor';

  const load = async () => {
    setLoading(true);
    const [rounds, { data: pays }, { data: prs }, { data: closs }] = await Promise.all([
      // Paginado: con >1000 rondas la consulta simple se truncaba y faltaban pagos.
      selectAllRows(
        'machine_rounds',
        'round_date, round_no, hours_stopped, overtime_hours, day_hours, night_hours, status, machinery:machinery_id(id, code, serial, plate, price_per_hour, company:company_id(id, name))'
      ),
      supabase.from('company_payments').select('*').order('paid_at', { ascending: false }),
      supabase.from('payrolls').select('*').order('created_at', { ascending: false }),
      supabase.from('control_closures').select('detail'),
    ]);

    // Precio CONGELADO por (máquina, semana) tomado de los cierres: permite ver
    // el monto "del cierre" aunque el precio actual haya cambiado.
    const frozen = new Map<string, number>();
    (closs ?? []).forEach((c: any) => {
      (c.detail?.machines ?? []).forEach((m: any) => {
        if (m.price == null || !m.machineId || !m.date) return;
        frozen.set(`${m.machineId}|${weekStartISO(m.date)}`, Number(m.price));
      });
    });

    const map = new Map<string, Group>();
    (rounds ?? []).forEach((r: any) => {
      const company = r.machinery?.company?.name ?? 'Sin empresa';
      const companyId = r.machinery?.company?.id ?? null;
      // Identidad ÚNICA por máquina física: id de la máquina (no el nombre, que puede repetirse).
      const machineId = r.machinery?.id ?? r.machinery?.code ?? '—';
      const serial = r.machinery?.serial ?? null;
      const plate = r.machinery?.plate ?? null;
      const code = r.machinery?.code ?? '—';
      // Etiqueta visible: nombre + serial (o placa) para distinguir máquinas del mismo nombre.
      const label = `${code}${serial ? ` · ${serial}` : plate ? ` · ${plate}` : ''}`;
      const price = r.machinery?.price_per_hour != null ? Number(r.machinery.price_per_hour) : null;
      const weekStart = weekStartISO(r.round_date);
      const k = `${company}|${weekStart}`;
      const g =
        map.get(k) ??
        ({ key: k, company, companyId, weekStart, weekEnd: addDaysISO(weekStart, 6), machines: {}, total: 0, hoursWorked: 0, noPrice: false, abonos: [], paidAmount: 0, saldo: 0, fullyPaid: false, hasFrozen: false, priceMode: 'actual' } as Group);
      const priceFrozen = frozen.has(`${machineId}|${weekStart}`) ? Number(frozen.get(`${machineId}|${weekStart}`)) : null;
      if (priceFrozen != null) g.hasFrozen = true;
      const ma = g.machines[machineId] ?? { machine: label, serial, price, priceCurrent: price, priceFrozen, hours: 0, dayHours: 0, nightHours: 0, subtotal: 0, perDay: {} };
      // Por día: turno de día/noche, parada y extras (todo en el registro base).
      const prev = ma.perDay[r.round_date] ?? { stopped: 0, overtime: 0, day: 0, night: 0 };
      ma.perDay[r.round_date] = {
        stopped: Math.max(prev.stopped, Number(r.hours_stopped) || 0),
        overtime: Math.max(prev.overtime, Number(r.overtime_hours) || 0),
        day: Math.max(prev.day, Number(r.day_hours) || 0),
        night: Math.max(prev.night, Number(r.night_hours) || 0),
      };
      ma.price = price;
      g.machines[machineId] = ma;
      map.set(k, g);
    });

    // Segunda pasada: horas cobrables y totales.
    // Solo cuentan las rondas en verde (3 h c/u), descontando las horas parada.
    const list = Array.from(map.values());
    list.forEach((g) => {
      // Semana cerrada con precio congelado → por defecto muestra "del cierre"
      // (inmutable); si no hay cierre, usa el precio actual (sincronizado).
      g.priceMode = g.hasFrozen ? 'cierre' : 'actual';
      recomputeGroup(g);
    });

    // Vincular abonos ya realizados (empresa + inicio de semana). Una semana puede
    // tener VARIOS abonos que se suman hasta cubrir el total; el saldo es lo que resta.
    const payList = (pays ?? []) as CompanyPayment[];
    list.forEach((g) => {
      g.abonos = payList
        .filter((p) => p.company_name === g.company && p.period_start === g.weekStart)
        .sort((a, b) => (a.paid_at < b.paid_at ? -1 : 1));
      g.paidAmount = round2(g.abonos.reduce((s, p) => s + (Number(p.amount) || 0), 0));
      g.saldo = Math.max(0, round2(g.total - g.paidAmount));
      g.fullyPaid = g.total > 0 && g.paidAmount >= g.total - 0.01;
    });

    list.sort((a, b) => (a.weekStart === b.weekStart ? a.company.localeCompare(b.company) : b.weekStart.localeCompare(a.weekStart)));
    setGroups(list);
    setPayments(payList);
    setPayrolls((prs ?? []) as Payroll[]);
    setLoading(false);
  };

  // Nómina total por empresa (se descuenta de la cuenta general).
  const nominaByCompany = useMemo(() => {
    const m = new Map<string, { total: number; items: Payroll[] }>();
    payrolls.forEach((p) => {
      const a = m.get(p.company_name) ?? { total: 0, items: [] };
      a.total = round2(a.total + (Number(p.amount) || 0));
      a.items.push(p);
      m.set(p.company_name, a);
    });
    return m;
  }, [payrolls]);

  const openNomina = (company: string) => {
    setNominaFor(company);
    setNominaAmount('');
    setNominaNote('');
  };
  const saveNomina = async () => {
    if (!nominaFor) return;
    const amt = Number((nominaAmount || '').replace(/\./g, '').replace(',', '.'));
    if (!isFinite(amt) || amt <= 0) return;
    setSavingNomina(true);
    const { error } = await supabase.from('payrolls').insert({
      company_name: nominaFor,
      amount: amt,
      note: nominaNote.trim() || null,
      created_by: session?.user?.id ?? null,
    });
    setSavingNomina(false);
    if (error) return;
    setNominaFor(null);
    load();
  };
  const deleteNomina = async (p: Payroll) => {
    await supabase.from('payrolls').delete().eq('id', p.id);
    load();
  };

  useEffect(() => {
    load();
    const unsub = navigation?.addListener?.('focus', load);
    // Sincronización multiusuario en vivo.
    let timer: any;
    const bump = () => { clearTimeout(timer); timer = setTimeout(load, 300); };
    const ch = supabase.channel('rt-control-pagos');
    ['machine_rounds', 'company_payments', 'machinery'].forEach((t) =>
      ch.on('postgres_changes' as any, { event: '*', schema: 'public', table: t }, bump)
    );
    ch.subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(ch);
      unsub?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  const machinesOf = (g: Group) => Object.values(g.machines).filter((m) => m.hours > 0).sort((a, b) => b.subtotal - a.subtotal);

  // Cambia el modo de precio de una semana: "del cierre" (revertir/inmutable) ↔
  // "actuales" (sincronizar con los precios nuevos). Recalcula total y saldo.
  const togglePriceMode = (grp: Group) => {
    grp.priceMode = grp.priceMode === 'cierre' ? 'actual' : 'cierre';
    recomputeGroup(grp);
    setGroups((prev) => [...prev]);
    if (selected?.key === grp.key) setSelected({ ...grp });
  };

  // ── Tabulador de precios ────────────────────────────────────────────────────
  // Precios del ámbito actual como texto: en 'general' el precio general de cada
  // modelo; en una empresa, su override (vacío = usa el general, que va de placeholder).
  const editsForScope = (scope: string, rows: PriceTariff[], overrides: Record<string, Record<string, number>>): Record<string, string> => {
    const edits: Record<string, string> = {};
    if (scope === 'general') {
      rows.forEach((t) => (edits[t.modelo] = String(Number(t.price_jornada))));
    } else {
      const ov = overrides[scope] ?? {};
      rows.forEach((t) => (edits[t.modelo] = ov[t.modelo] != null ? String(Number(ov[t.modelo])) : ''));
    }
    return edits;
  };

  const loadTariffs = async (scope: string = tarScope) => {
    const [{ data: gen }, { data: comps }, { data: cpt }] = await Promise.all([
      supabase.from('price_tariffs').select('*').order('sort_order', { ascending: true }),
      supabase.from('companies').select('id, name, hidden, food_only').order('name'),
      supabase.from('company_price_tariffs').select('company_id, modelo, price_jornada'),
    ]);
    const rows = (gen ?? []) as PriceTariff[];
    setTariffs(rows);
    setTarCompanies(((comps ?? []) as any[]).filter((c) => !c.hidden && !c.food_only).map((c) => ({ id: c.id, name: c.name })));
    const overrides: Record<string, Record<string, number>> = {};
    ((cpt ?? []) as any[]).forEach((r) => {
      (overrides[r.company_id] = overrides[r.company_id] ?? {})[r.modelo] = Number(r.price_jornada);
    });
    setCompanyTar(overrides);
    setTarEdits(editsForScope(scope, rows, overrides));
    return { rows, overrides };
  };

  const openTabulador = async () => {
    setSyncPreview(null);
    setTarScope('general');
    await loadTariffs('general');
    setTarOpen(true);
  };

  // Cambia de ámbito (General / empresa) recargando los precios de ese ámbito.
  const switchScope = (scope: string) => {
    setTarScope(scope);
    setTarEdits(editsForScope(scope, tariffs, companyTar));
  };

  // Persiste los precios del ámbito actual (sin diálogo). Devuelve nº de cambios.
  const persistCurrentScope = async (): Promise<number> => {
    if (tarScope === 'general') {
      const changed = tariffs.filter((t) => {
        const v = Number(tarEdits[t.modelo]);
        return Number.isFinite(v) && v !== Number(t.price_jornada);
      });
      for (const t of changed) {
        await supabase
          .from('price_tariffs')
          .update({ price_jornada: Number(tarEdits[t.modelo]), updated_at: new Date().toISOString() })
          .eq('id', t.id);
      }
      return changed.length;
    }
    // Ámbito empresa: fila vacía → borra override (usa el general); con número → upsert.
    const ov = companyTar[tarScope] ?? {};
    let n = 0;
    for (const t of tariffs) {
      const raw = (tarEdits[t.modelo] ?? '').trim();
      const has = ov[t.modelo] != null;
      if (raw === '') {
        if (has) { await supabase.from('company_price_tariffs').delete().eq('company_id', tarScope).eq('modelo', t.modelo); n++; }
        continue;
      }
      const v = Number(raw);
      if (!Number.isFinite(v)) continue;
      if (!has || v !== Number(ov[t.modelo])) {
        await supabase.from('company_price_tariffs')
          .upsert({ company_id: tarScope, modelo: t.modelo, price_jornada: v, updated_at: new Date().toISOString() }, { onConflict: 'company_id,modelo' });
        n++;
      }
    }
    return n;
  };

  // Guarda los precios editados del tabulador (ámbito actual).
  const saveTariffs = async () => {
    if (!canEditTar) return;
    setTarSaving(true);
    try {
      const n = await persistCurrentScope();
      await loadTariffs(tarScope);
      await confirm({
        title: 'Tabulador guardado',
        message: n ? `Se actualizaron ${n} precio(s).` : 'No hubo cambios.',
        confirmText: 'Ok',
      });
    } finally {
      setTarSaving(false);
    }
  };

  // Precio de un modelo para una empresa: usa el override de la empresa si existe,
  // si no cae al precio general del tabulador.
  const resolvePrice = (modelo: string, companyId: string | null, gen: Map<string, number>, overrides: Record<string, Record<string, number>>): number | null => {
    if (companyId && overrides[companyId]?.[modelo] != null) return Number(overrides[companyId][modelo]);
    return gen.has(modelo) ? gen.get(modelo)! : null;
  };

  // Arma la vista previa del sync: empareja cada máquina activa con su precio
  // (el de su empresa si tiene, si no el general) y calcula qué cambiaría.
  const buildSyncPreview = async () => {
    // Guarda primero las ediciones del ámbito actual y recarga los precios frescos.
    await persistCurrentScope();
    const { rows, overrides } = await loadTariffs(tarScope);
    const genMap = new Map<string, number>();
    rows.forEach((t) => genMap.set(t.modelo, Number(t.price_jornada)));
    const { data } = await supabase
      .from('machinery')
      .select('id, code, tipo, clasificacion, serial, plate, price_per_hour, active, company:company_id(id, name)')
      .eq('active', true);
    const machines = (data ?? []) as any[];
    const byKey = new Map<string, { modelo: string; price: number; company: string; machines: { id: string; label: string; from: number | null }[] }>();
    const unmatched: { id: string; label: string; tipo: string | null }[] = [];
    machines.forEach((m) => {
      const modelo = matchTariffModelo(m);
      const companyId = m.company?.id ?? null;
      const companyName = m.company?.name ?? 'Sin empresa';
      const label = `${m.code}${m.serial ? ` · ${m.serial}` : m.plate ? ` · ${m.plate}` : ''}`;
      const price = modelo ? resolvePrice(modelo, companyId, genMap, overrides) : null;
      if (!modelo || price == null) {
        unmatched.push({ id: m.id, label, tipo: m.tipo ?? null });
        return;
      }
      const from = m.price_per_hour != null ? Number(m.price_per_hour) : null;
      if (from === price) return; // ya está en el precio correcto
      const key = `${modelo}|${price}`;
      const row = byKey.get(key) ?? { modelo, price, company: companyName, machines: [] as { id: string; label: string; from: number | null }[] };
      row.machines.push({ id: m.id, label: `${label} · ${companyName}`, from });
      byKey.set(key, row);
    });
    const changes = Array.from(byKey.values())
      .filter((r) => r.machines.length > 0)
      .sort((a, b) => a.modelo.localeCompare(b.modelo) || a.price - b.price);
    const totalChanges = changes.reduce((s, r) => s + r.machines.length, 0);
    setSyncPreview({ changes, unmatched, totalChanges });
  };

  // Aplica la sincronización: escribe el precio del tabulador en machinery.price_per_hour.
  // Solo toca precios ACTUALES; los cierres viejos quedan congelados.
  const applySync = async () => {
    if (!syncPreview || !canEditTar) return;
    setSyncing(true);
    try {
      // Agrupa TODAS las máquinas por precio destino para hacer el mínimo de consultas
      // (antes era una consulta por modelo y se hacía lento / parecía colgado).
      const byPrice = new Map<number, string[]>();
      for (const r of syncPreview.changes) {
        const arr = byPrice.get(r.price) ?? [];
        r.machines.forEach((x) => arr.push(x.id));
        byPrice.set(r.price, arr);
      }
      for (const [price, ids] of byPrice) {
        for (let i = 0; i < ids.length; i += 200) {
          await supabase.from('machinery').update({ price_per_hour: price }).in('id', ids.slice(i, i + 200));
        }
      }
      const n = syncPreview.totalChanges;
      setSyncPreview(null);
      await confirm({
        title: 'Sincronización aplicada',
        message: `Se actualizaron los precios actuales de ${n} equipo(s). Los cierres anteriores no se tocaron.`,
        confirmText: 'Ok',
      });
      await load();
    } finally {
      setSyncing(false);
    }
  };

  // ── Deudas pendientes (no pagadas, con monto) → alerta de los lunes ──────────
  const outstandingByCompany = useMemo(() => {
    const m = new Map<string, number>();
    groups.forEach((g) => {
      if (g.saldo > 0) m.set(g.company, (m.get(g.company) ?? 0) + g.saldo);
    });
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [groups]);

  const isMonday = new Date().getDay() === 1;
  const canAlert = role === 'admin' || role === 'supervisor';
  const showMondayAlert = isMonday && canAlert && outstandingByCompany.length > 0;

  // Solo cuentas con monto por cobrar o con algún abono (evita mostrar $0 sin actividad).
  const visible = groups.filter((g) => g.total > 0 || g.paidAmount > 0);
  const q = norm(query.trim());
  const shown = !q ? visible : visible.filter((g) => norm(g.company).includes(q));

  const byCompany = useMemo(() => {
    const m = new Map<string, Group[]>();
    shown.forEach((g) => {
      const arr = m.get(g.company) ?? [];
      arr.push(g);
      m.set(g.company, arr);
    });
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [shown]);

  const companyNames = useMemo(() => Array.from(new Set(groups.map((g) => g.company))).sort(), [groups]);

  // ── Registrar abono (pago parcial o total) ───────────────────────────────────
  const openPay = (g: Group) => {
    setPayFor(g);
    // Por defecto el abono cubre el saldo pendiente (paga todo lo que resta).
    setPayAmount(g.saldo ? String(g.saldo) : '');
    setPayCurrency('USD');
  };

  const confirmPay = async () => {
    if (!payFor) return;
    const amount = Number(payAmount.replace(',', '.')) || 0;
    if (amount <= 0) {
      await confirm({ title: 'Monto inválido', message: 'Ingresa un monto mayor a 0 para el abono.', confirmText: 'Entendido', cancelText: ' ' });
      return;
    }
    const detail: PaymentDetail = {
      machines: machinesOf(payFor).map((m) => ({ machine: m.machine, hours: m.hours, price: m.price ?? 0, subtotal: m.subtotal })),
      totalHours: payFor.hoursWorked,
      total: payFor.total,
    };
    setSaving(true);
    const { error } = await supabase.from('company_payments').insert({
      company_id: payFor.companyId,
      company_name: payFor.company,
      period_start: payFor.weekStart,
      period_end: payFor.weekEnd,
      amount,
      currency: payCurrency,
      detail,
      created_by: session?.user?.id ?? null,
    });
    setSaving(false);
    if (error) {
      await confirm({ title: 'Error', message: error.message, confirmText: 'Entendido', cancelText: ' ' });
      return;
    }
    setPayFor(null);
    setSelected(null);
    load();
  };

  // Eliminar un abono (para corregir errores). Devuelve el monto al saldo.
  const deleteAbono = async (p: CompanyPayment) => {
    const ok = await confirm({
      title: 'Eliminar abono',
      message: `¿Eliminar el abono de ${p.currency} ${money(Number(p.amount))}? El saldo volverá a incluir ese monto.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
    });
    if (!ok) return;
    const { error } = await supabase.from('company_payments').delete().eq('id', p.id);
    if (error) {
      await confirm({ title: 'Error', message: error.message, confirmText: 'Entendido', cancelText: ' ' });
      return;
    }
    setSelected(null);
    load();
  };

  // ── Reporte por EMPRESA → TIPO de maquinaria, con apartado especial y semanas ──
  // 1er apartado: desde la fecha de llegada de cada máquina hasta el 05/07/2026.
  // Luego, un apartado por SEMANA (lun→dom) alineado con la semana de la jornada.
  // Muestra: horas trabajadas por máquina y por empresa, total a pagar y días transcurridos.
  const CUTOFF_APARTADO = '2026-07-05';
  const openTipoReport = async () => {
    const [{ data: mach }, rnds] = await Promise.all([
      supabase.from('machinery').select('id, code, serial, tipo, entry_date, price_per_hour, company:company_id(id, name)'),
      selectAllRows('machine_rounds', 'machinery_id, round_date, day_hours, night_hours, hours_stopped, overtime_hours'),
    ]);
    const machById = new Map<string, any>();
    (mach ?? []).forEach((m: any) => machById.set(m.id, m));
    // Una fila por (máquina, fecha) para no duplicar.
    const byMD = new Map<string, any>();
    (rnds ?? []).forEach((r: any) => byMD.set(`${r.machinery_id}|${r.round_date}`, r));

    type Period = { key: string; label: string; end: string; order: number; companies: Map<string, Map<string, Map<string, number>>> };
    const periods = new Map<string, Period>();
    for (const r of byMD.values()) {
      const m = machById.get(r.machinery_id);
      if (!m) continue;
      const worked = workedFromShifts(Number(r.day_hours ?? 0), Number(r.night_hours ?? 0), Number(r.hours_stopped ?? 0), Number(r.overtime_hours ?? 0));
      if (worked <= 0) continue;
      let key: string, label: string, end: string, order: number;
      if (r.round_date <= CUTOFF_APARTADO) {
        key = '__apartado__'; label = 'Fecha de llegada → 05/07/2026'; end = CUTOFF_APARTADO; order = 0;
      } else {
        const ws = weekStartISO(r.round_date); end = addDaysISO(ws, 6);
        key = ws; label = `Semana ${fmtDMY(ws)} → ${fmtDMY(end)}`; order = Number(ws.replace(/-/g, ''));
      }
      const p = periods.get(key) ?? { key, label, end, order, companies: new Map() };
      const cname = m.company?.name ?? 'Sin empresa';
      const comp = p.companies.get(cname) ?? new Map<string, Map<string, number>>();
      const tkey = m.tipo && String(m.tipo).trim() ? String(m.tipo).trim().toUpperCase() : 'SIN TIPO';
      const tmap = comp.get(tkey) ?? new Map<string, number>();
      tmap.set(m.id, (tmap.get(m.id) ?? 0) + worked);
      comp.set(tkey, tmap);
      p.companies.set(cname, comp);
      periods.set(key, p);
    }

    const diasStr = (entry: string | null, end: string) => (entry ? `${Math.max(0, daysBetween(entry, end) + 1)} d` : '—');
    let grandWorked = 0;
    let grandAmount = 0;
    const periodList = [...periods.values()].sort((a, b) => a.order - b.order);
    const sections = periodList
      .map((p) => {
        const compNames = [...p.companies.keys()].sort((a, b) => a.localeCompare(b));
        let pWorked = 0;
        let pAmount = 0;
        const compHtml = compNames
          .map((cn) => {
            const comp = p.companies.get(cn)!;
            const tipoKeys = [...comp.keys()].sort((a, b) => a.localeCompare(b));
            let cWorked = 0;
            let cAmount = 0;
            let earliest = '';
            const rowsHtml = tipoKeys
              .map((tk) => {
                const tmap = comp.get(tk)!;
                let tW = 0;
                let tA = 0;
                const ms = [...tmap.entries()]
                  .map(([mid, worked]) => {
                    const m = machById.get(mid);
                    const price = m.price_per_hour != null ? Number(m.price_per_hour) : 0;
                    const amount = round2((worked / 12) * price);
                    tW += worked; tA += amount;
                    const entry = m.entry_date || null;
                    if (entry && (!earliest || entry < earliest)) earliest = entry;
                    return `<tr><td>${m.code}${m.serial ? `<br/><span class="s">${m.serial}</span>` : ''}</td>` +
                      `<td class="c">${diasStr(entry, p.end)}</td>` +
                      `<td class="c b">${worked} h</td>` +
                      `<td class="r b">${amount ? '$' + money(amount) : '—'}</td></tr>`;
                  })
                  .join('');
                cWorked += tW; cAmount += tA;
                return `<tr class="tipo"><td colspan="4">🔧 ${tk} — ${tmap.size} máquina(s)</td></tr>${ms}` +
                  `<tr class="sub"><td class="r">Subtotal ${tk}</td><td></td><td class="c b">${tW} h</td><td class="r b">$${money(tA)}</td></tr>`;
              })
              .join('');
            pWorked += cWorked; pAmount += cAmount;
            return `<h3 class="emp">🏢 ${cn} — ${cWorked} h · $${money(cAmount)}</h3>
              <table><thead><tr><th>Tipo / Máquina</th><th>Días transc.</th><th>Horas trab.</th><th>Total a pagar</th></tr></thead>
              <tbody>${rowsHtml}</tbody>
              <tfoot><tr><td class="r">TOTAL ${cn}</td><td class="c b">${diasStr(earliest || null, p.end)}</td><td class="c b">${cWorked} h</td><td class="r b">$${money(cAmount)}</td></tr></tfoot></table>`;
          })
          .join('');
        grandWorked += pWorked; grandAmount += pAmount;
        const dtxt = p.key === '__apartado__' ? '' : ' · 7 día(s)';
        return `<h2 class="per">📅 ${p.label}${dtxt}</h2>${compHtml}
          <div class="pt">Total del período: ${pWorked} h · $${money(pAmount)}</div>`;
      })
      .join('');

    const html = pdfDocument({
      title: 'Reporte por empresa y tipo',
      subtitle: `Apartado inicial (llegada → 05/07/2026) + semanas · horas, pago y días transcurridos`,
      extraCss: `
        h2.per{font-size:15px;color:#fff;background:#1E3A5F;padding:8px 12px;border-radius:6px;margin:20px 0 8px}
        h3.emp{font-size:13px;font-weight:800;color:#1E3A5F;margin:14px 0 3px}
        table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:4px}
        th,td{border:1px solid #ccc;padding:4px 7px;text-align:left}
        th{background:#1E3A5F;color:#fff}
        td.c{text-align:center}td.r{text-align:right}td.b{font-weight:700}
        span.s{color:#888;font-size:9px}
        tr.tipo td{background:#DCE4EE;font-weight:800;color:#1E3A5F}
        tr.sub td{background:#F3F6FA;font-weight:700}
        tfoot td{background:#1E3A5F;color:#fff;font-weight:800}
        .pt{text-align:right;font-weight:800;color:#1E3A5F;margin:2px 0 6px}
        .grand{margin-top:16px;padding:10px 14px;background:#1E3A5F;color:#fff;font-weight:800;font-size:14px;border-radius:6px;text-align:right}`,
      body: `
        ${sections || '<p style="text-align:center;color:#888">Sin jornadas registradas.</p>'}
        <div class="grand">TOTAL GENERAL: ${grandWorked} h · $${money(grandAmount)}</div>
        <p style="color:#666;font-size:11px;margin-top:8px">Horas = (día + noche) − parada + extras · Pago = horas trabajadas × precio por hora (precio jornada ÷ 12) · Días transcurridos = desde la fecha de llegada hasta el fin del período.</p>`,
    });
    await exportPdf(html, 'Control de Pagos - Reporte por empresa y tipo');
  };

  // ── Reporte PDF por empresa y rango de fechas ────────────────────────────────
  const generateReport = async () => {
    const allCompanies = repCompanies.length === 0;
    const inRange = groups.filter(
      (g) => g.weekStart >= repFrom && g.weekStart <= repTo && (allCompanies || repCompanies.includes(g.company))
    );
    // Por cada semana/empresa: encabezado + desglose por máquina (horas día/noche,
    // horas trabajadas totales, precio y subtotal).
    const sections = inRange
      .map((g) => {
        const estado = g.fullyPaid
          ? `PAGADA ($${money(g.paidAmount)})`
          : g.paidAmount > 0
          ? `ABONADA · pagado $${money(g.paidAmount)} · resta $${money(g.saldo)}`
          : 'PENDIENTE';
        const machs = machinesOf(g);
        const mrows = machs
          .map(
            (m) =>
              `<tr><td>${m.machine}</td>` +
              `<td style="text-align:right">${m.dayHours.toLocaleString()} h</td>` +
              `<td style="text-align:right">${m.nightHours.toLocaleString()} h</td>` +
              `<td style="text-align:right;font-weight:700">${m.hours.toLocaleString()} h</td>` +
              `<td style="text-align:right">${m.price != null ? '$' + money(m.price) : '—'}</td>` +
              `<td style="text-align:right;font-weight:700">$${money(m.subtotal)}</td></tr>`
          )
          .join('');
        const totDay = machs.reduce((s, m) => s + m.dayHours, 0);
        const totNight = machs.reduce((s, m) => s + m.nightHours, 0);
        // Detalle de abonos de esta semana/empresa.
        const abonosHtml =
          g.abonos.length > 0
            ? `<table class="ab"><thead><tr><th>Abono</th><th>Fecha</th><th style="text-align:right">Monto</th></tr></thead>
              <tbody>${g.abonos
                .map((p, i) => `<tr><td>🟢 Abono ${i + 1}</td><td>${fmtDMY((p.paid_at || '').slice(0, 10))}</td><td style="text-align:right;font-weight:700">$${money(Number(p.amount) || 0)}</td></tr>`)
                .join('')}</tbody>
              <tfoot>
                <tr><td colspan="2" style="text-align:right;font-weight:700">Total abonado</td><td style="text-align:right;font-weight:800">$${money(g.paidAmount)}</td></tr>
                <tr><td colspan="2" style="text-align:right;font-weight:700">Saldo pendiente</td><td style="text-align:right;font-weight:800">$${money(g.saldo)}</td></tr>
              </tfoot></table>`
            : `<div class="muted" style="margin:3px 0 6px">Sin abonos registrados · saldo pendiente $${money(g.saldo)}</div>`;
        return `<h3 style="margin:16px 0 2px;color:#1E3A5F">${g.company} · Semana ${fmtDMY(g.weekStart)} → ${fmtDMY(g.weekEnd)} <span style="color:#666;font-weight:400">· ${estado}</span></h3>
          <table><thead><tr><th>Máquina</th><th>☀️ Día</th><th>🌙 Noche</th><th>Horas trab.</th><th>Precio/jornada</th><th>Subtotal</th></tr></thead>
          <tbody>${mrows || '<tr><td colspan="6" style="text-align:center">Sin máquinas</td></tr>'}</tbody>
          <tfoot><tr><td style="font-weight:700">TOTAL</td><td style="text-align:right;font-weight:700">${totDay.toLocaleString()} h</td><td style="text-align:right;font-weight:700">${totNight.toLocaleString()} h</td><td style="text-align:right;font-weight:700">${g.hoursWorked.toLocaleString()} h</td><td></td><td style="text-align:right;font-weight:800">$${money(g.total)}</td></tr></tfoot></table>
          <div class="abt">💵 Abonos</div>${abonosHtml}`;
      })
      .join('');
    const totalFact = inRange.reduce((s, g) => s + g.total, 0);
    const totalPend = inRange.reduce((s, g) => s + g.saldo, 0);
    const totalPag = inRange.reduce((s, g) => s + g.paidAmount, 0);
    const title = allCompanies
      ? 'Todas las empresas (general)'
      : repCompanies.length === 1
      ? repCompanies[0]
      : `${repCompanies.length} empresas seleccionadas`;
    // Resumen general por empresa (facturado / abonado / saldo) — útil sobre todo en el general.
    const byCompany = new Map<string, { total: number; pag: number; saldo: number }>();
    inRange.forEach((g) => {
      const a = byCompany.get(g.company) ?? { total: 0, pag: 0, saldo: 0 };
      a.total += g.total; a.pag += g.paidAmount; a.saldo += g.saldo;
      byCompany.set(g.company, a);
    });
    // Nómina por empresa (se descuenta de la cuenta general) y neto final.
    const nominaOf = (c: string) => nominaByCompany.get(c)?.total ?? 0;
    let totalNomina = 0;
    let totalNeto = 0;
    const resumenRows = [...byCompany.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([c, v]) => {
        const nom = nominaOf(c);
        const neto = round2(v.saldo - nom);
        totalNomina += nom; totalNeto += neto;
        return `<tr><td>${c}</td><td style="text-align:right">$${money(v.total)}</td>` +
          `<td style="text-align:right;color:#087443;font-weight:700">$${money(v.pag)}</td>` +
          `<td style="text-align:right;color:#B42318;font-weight:700">${nom > 0 ? '−$' + money(nom) : '—'}</td>` +
          `<td style="text-align:right;font-weight:800">$${money(neto)}</td></tr>`;
      })
      .join('');
    totalNomina = round2(totalNomina); totalNeto = round2(totalNeto);
    const resumenHtml = `<h2 class="res">Resumen ${allCompanies ? 'general por empresa' : repCompanies.length === 1 ? 'de la empresa' : 'por empresa'}</h2>
      <table><thead><tr><th>Empresa</th><th style="text-align:right">Facturado</th><th style="text-align:right">Abonado</th><th style="text-align:right">Pago de nómina</th><th style="text-align:right">Neto a pagar</th></tr></thead>
      <tbody>${resumenRows || '<tr><td colspan="5" style="text-align:center">Sin datos</td></tr>'}</tbody>
      <tfoot><tr><td style="font-weight:800">TOTAL</td><td style="text-align:right;font-weight:800">$${money(totalFact)}</td><td style="text-align:right;font-weight:800">$${money(totalPag)}</td><td style="text-align:right;font-weight:800">−$${money(totalNomina)}</td><td style="text-align:right;font-weight:800">$${money(totalNeto)}</td></tr></tfoot></table>`;
    const html = pdfDocument({
      title: 'Control de pagos por maquinaria',
      subtitle: `${title} · del ${fmtDMY(repFrom)} al ${fmtDMY(repTo)}`,
      extraCss: `
        table{width:100%;border-collapse:collapse;margin-top:4px;font-size:11px}
        th,td{border:1px solid #ccc;padding:5px 7px;text-align:left}
        th{background:#1E3A5F;color:#fff}
        tfoot td{background:#EEF2F7}
        table.ab{margin-bottom:10px}
        table.ab th{background:#087443}
        .abt{font-size:11px;font-weight:800;color:#087443;margin-top:6px}
        h2.res{font-size:14px;color:#fff;background:#1E3A5F;padding:8px 12px;border-radius:6px;margin:22px 0 6px}
        .tot{margin-top:16px;font-size:13px}
        .muted{color:#666;font-size:12px}`,
      body: `
      ${sections || '<p class="muted">Sin datos en el rango.</p>'}
      ${resumenHtml}
      <div class="tot"><b>Total facturado:</b> $${money(totalFact)} &nbsp;·&nbsp; <b>Total abonado:</b> $${money(totalPag)} &nbsp;·&nbsp; <b>Pago de nómina:</b> −$${money(totalNomina)} &nbsp;·&nbsp; <b>Total neto a pagar:</b> $${money(totalNeto)}</div>`,
    });
    await exportPdf(html, 'Control de Pagos - Reporte');
  };

  if (!canSee('control_pagos')) {
    return (
      <Screen>
        <SectionTitle>Control de pagos</SectionTitle>
        <EmptyState title="Sin acceso" subtitle="No tienes permiso para ver este módulo. Pídeselo a un administrador." />
      </Screen>
    );
  }

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Control de pagos</SectionTitle>

      {/* Alerta de los lunes para admin/supervisor */}
      {showMondayAlert ? (
        <Card style={{ backgroundColor: colors.warning, borderColor: colors.warning }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15, marginBottom: spacing.xs }}>
            ⏰ Recordatorio de pagos (lunes)
          </Text>
          {outstandingByCompany.map(([c, amt]) => (
            <Text key={c} style={{ color: '#fff', fontSize: 13 }}>
              • Se le deben <Text style={{ fontWeight: '800' }}>${money(amt)}</Text> a {c}
            </Text>
          ))}
        </Card>
      ) : null}

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
        <TouchableOpacity
          onPress={() => setHistOpen(true)}
          style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}
        >
          <Text style={{ color: colors.text, fontWeight: '700' }}>🗂️ Histórico ({payments.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setRepOpen(true)}
          style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary }}
        >
          <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>📄 Reporte</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        onPress={openTipoReport}
        style={{ padding: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.primary, marginTop: spacing.sm }}
      >
        <Text style={{ color: colors.primary, fontWeight: '700' }}>📊 Reporte por empresa y tipo (llegada → 05/07 + semanas)</Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={openTabulador}
        style={{ padding: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, marginTop: spacing.sm }}
      >
        <Text style={{ color: colors.text, fontWeight: '700' }}>💲 Tabulador de precios (editar / sincronizar)</Text>
      </TouchableOpacity>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="🔎 Buscar empresa…"
        placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginTop: spacing.sm, marginBottom: spacing.sm }}
      />

      {loading ? (
        <Loading />
      ) : byCompany.length === 0 ? (
        <EmptyState title={q ? 'Sin resultados' : 'Sin cuentas por pagar'} subtitle={q ? 'Prueba con otra búsqueda.' : 'Registra rondas y precios en Control de maquinaria.'} />
      ) : (
        byCompany.map(([company, weeks]) => {
          const open = !!expandedCompany[company];
          // Total que se debe = suma de los SALDOS pendientes (descontando abonos).
          const debt = weeks.reduce((s, g) => s + g.saldo, 0);
          // Nómina de la empresa: se descuenta de la cuenta general.
          const nomina = nominaByCompany.get(company);
          const nominaTotal = nomina?.total ?? 0;
          const neto = round2(debt - nominaTotal);
          // Máquinas con jornada = máquinas distintas que trabajaron en la empresa.
          const machineSet = new Set<string>();
          weeks.forEach((g) => machinesOf(g).forEach((m) => machineSet.add(m.machine)));
          return (
            <View key={company}>
              <TouchableOpacity activeOpacity={0.7} onPress={() => setExpandedCompany((p) => ({ ...p, [company]: !p[company] }))}>
                <Card style={{ backgroundColor: colors.surfaceAlt, marginTop: spacing.sm }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>🏢 {company}</Text>
                    <Text style={{ color: neto > 0 ? colors.primary : colors.success, fontWeight: '800', fontSize: 15 }}>${money(neto)}</Text>
                  </View>
                  {nominaTotal > 0 ? (
                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                      Facturado ${money(debt)} · 🧾 Nómina −${money(nominaTotal)}
                    </Text>
                  ) : null}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>🚜 {machineSet.size} máquina(s) con jornada · {weeks.length} semana(s)</Text>
                    <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>{open ? '▲ ocultar' : '▼ ver detalle'}</Text>
                  </View>
                </Card>
              </TouchableOpacity>

              {/* Botón NÓMINA (descuenta de la cuenta general de la empresa) */}
              <TouchableOpacity
                onPress={() => openNomina(company)}
                style={{ alignSelf: 'flex-start', marginTop: spacing.xs, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}
              >
                <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 13 }}>🧾 NÓMINA</Text>
              </TouchableOpacity>
              {open && nomina && nomina.items.length > 0 ? (
                <Card>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, marginBottom: spacing.xs }}>🧾 Nóminas de {company}</Text>
                  {nomina.items.map((p) => (
                    <View key={p.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: '700' }}>−${money(Number(p.amount))}</Text>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>{(p.created_at || '').slice(0, 10)}{p.note ? ` · ${p.note}` : ''}</Text>
                      </View>
                      <TouchableOpacity onPress={() => deleteNomina(p)} style={{ padding: spacing.xs }}>
                        <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>🗑️ Quitar</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                  <Text style={{ color: colors.text, fontWeight: '800', marginTop: spacing.xs }}>Total nómina: −${money(nominaTotal)}</Text>
                </Card>
              ) : null}
              {open ? weeks.map((g) => {
                const partial = g.paidAmount > 0 && !g.fullyPaid;
                return (
                <TouchableOpacity key={g.weekStart} activeOpacity={0.7} onPress={() => setSelected(g)}>
                  <Card style={g.fullyPaid ? { borderColor: colors.success } : partial ? { borderColor: colors.warning } : undefined}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>
                        Semana {g.weekStart} → {g.weekEnd}
                      </Text>
                      <Text style={{ color: g.fullyPaid ? colors.success : colors.primary, fontWeight: '800' }}>
                        ${money(g.total)}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: spacing.xs, flexWrap: 'wrap' }}>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>🚜 {machinesOf(g).length} máquina(s)</Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>⏱️ {g.hoursWorked.toLocaleString()} h trab.</Text>
                      {g.noPrice ? <Text style={{ color: colors.warning, fontSize: 12 }}>⚠️ falta precio</Text> : null}
                    </View>
                    {g.hasFrozen ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs }}>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>Precios:</Text>
                        <TouchableOpacity
                          onPress={() => togglePriceMode(g)}
                          style={{ paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1, borderColor: g.priceMode === 'cierre' ? colors.primary : colors.border, backgroundColor: g.priceMode === 'cierre' ? colors.primary : colors.surfaceAlt }}
                        >
                          <Text style={{ color: g.priceMode === 'cierre' ? colors.primaryContrast : colors.text, fontSize: 11, fontWeight: '700' }}>
                            {g.priceMode === 'cierre' ? '📌 Del cierre' : '🔄 Actuales'} · cambiar
                          </Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                    {g.fullyPaid ? (
                      <Text style={{ color: colors.success, fontSize: 12, marginTop: spacing.xs, fontWeight: '700' }}>
                        ✓ Pagada · abonado ${money(g.paidAmount)}
                      </Text>
                    ) : partial ? (
                      <Text style={{ color: colors.warning, fontSize: 12, marginTop: spacing.xs, fontWeight: '700' }}>
                        🟡 Abonado ${money(g.paidAmount)} · resta ${money(g.saldo)}
                      </Text>
                    ) : (
                      <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>
                        Pendiente · toca para ver el detalle
                      </Text>
                    )}
                  </Card>
                </TouchableOpacity>
              ); }) : null}
            </View>
          );
        })
      )}

      {/* ── Nómina de la empresa ── */}
      <Modal visible={!!nominaFor} transparent animationType="fade" onRequestClose={() => setNominaFor(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }}>🧾 Nómina · {nominaFor}</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2, marginBottom: spacing.sm }}>
              El monto se descuenta de la cuenta general de la empresa.
            </Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>Monto de la nómina</Text>
            <TextInput
              value={nominaAmount}
              onChangeText={(t) => setNominaAmount(onlyDecimal(t))}
              keyboardType="numeric"
              inputMode="decimal"
              placeholder="0,00"
              placeholderTextColor={colors.muted}
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, fontSize: 18, fontWeight: '700' }}
            />
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Nota (opcional)</Text>
            <TextInput
              value={nominaNote}
              onChangeText={setNominaNote}
              placeholder="Detalle…"
              placeholderTextColor={colors.muted}
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
              <TouchableOpacity onPress={() => setNominaFor(null)} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveNomina} disabled={savingNomina} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary }}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>{savingNomina ? 'Guardando…' : 'Registrar nómina'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Detalle de la cuenta (empresa + semana) ── */}
      <Modal visible={!!selected} animationType="slide" onRequestClose={() => setSelected(null)}>
        <Screen>
          {selected ? (
            <>
              <TouchableOpacity onPress={() => setSelected(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm }}>
                <Text style={{ color: colors.primary, fontSize: 20, fontWeight: '800' }}>←</Text>
                <Text style={{ color: colors.primary, fontWeight: '700' }}>Volver</Text>
              </TouchableOpacity>
              <SectionTitle>{selected.company}</SectionTitle>
              {selected.hasFrozen ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm, flexWrap: 'wrap' }}>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>Semana cerrada · precios:</Text>
                  <TouchableOpacity
                    onPress={() => togglePriceMode(selected)}
                    style={{ paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.primary, backgroundColor: selected.priceMode === 'cierre' ? colors.primary : colors.surfaceAlt }}
                  >
                    <Text style={{ color: selected.priceMode === 'cierre' ? colors.primaryContrast : colors.text, fontSize: 12, fontWeight: '800' }}>
                      {selected.priceMode === 'cierre' ? '📌 Del cierre (viejo)' : '🔄 Actuales (nuevo)'} · tocar para cambiar
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              {/* Botón de abono/pago ARRIBA para acceso rápido. */}
              {selected.fullyPaid ? (
                <Card style={{ borderColor: colors.success }}>
                  <Text style={{ color: colors.success, fontWeight: '800' }}>✓ Pagada por completo</Text>
                  <Text style={{ color: colors.text, fontSize: 13 }}>Total abonado: ${money(selected.paidAmount)}</Text>
                </Card>
              ) : (
                <TouchableOpacity
                  style={{ marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.success }}
                  onPress={() => openPay(selected)}
                >
                  <Text style={{ color: '#fff', fontWeight: '800' }}>
                    {selected.paidAmount > 0 ? `＋ Registrar abono · resta $${money(selected.saldo)}` : '＋ Registrar abono / pago'}
                  </Text>
                </TouchableOpacity>
              )}
              <Card>
                <Text style={{ color: colors.text, fontWeight: '700' }}>
                  Semana {selected.weekStart} → {selected.weekEnd}
                </Text>
                <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }}>
                  <View style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm }}>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>Horas trabajadas</Text>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 20 }}>{selected.hoursWorked.toLocaleString()}</Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm }}>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>Máquinas</Text>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 20 }}>{machinesOf(selected).length}</Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm }}>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>Total</Text>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 20 }}>${money(selected.total)}</Text>
                  </View>
                </View>
                {/* Abonado y saldo pendiente */}
                <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }}>
                  <View style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm }}>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>Abonado</Text>
                    <Text style={{ color: colors.success, fontWeight: '800', fontSize: 20 }}>${money(selected.paidAmount)}</Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm }}>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>Saldo pendiente</Text>
                    <Text style={{ color: selected.saldo > 0 ? colors.primary : colors.success, fontWeight: '800', fontSize: 20 }}>${money(selected.saldo)}</Text>
                  </View>
                </View>
              </Card>

              <Text style={{ color: colors.text, fontWeight: '700', marginTop: spacing.sm, marginBottom: spacing.xs }}>
                Máquinas · jornadas × precio
              </Text>
              {machinesOf(selected).map((m) => (
                <Card key={m.machine}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14, flex: 1 }}>{m.machine}</Text>
                    <Text style={{ color: colors.success, fontWeight: '800' }}>${money(m.subtotal)}</Text>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                    ⏱️ {m.hours.toLocaleString()} h · {m.price != null ? `$${money(m.price)}/jornada` : '⚠️ sin precio'}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    ☀️ Día: {m.dayHours.toLocaleString()} h · 🌙 Noche: {m.nightHours.toLocaleString()} h
                  </Text>
                </Card>
              ))}

              {/* Abonos registrados (pagos parciales) */}
              {selected.abonos.length > 0 ? (
                <>
                  <Text style={{ color: colors.text, fontWeight: '700', marginTop: spacing.sm, marginBottom: spacing.xs }}>
                    Abonos ({selected.abonos.length})
                  </Text>
                  {selected.abonos.map((p, i) => (
                    <Card key={p.id}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colors.text, fontWeight: '700' }}>
                            🟢 Abono {i + 1} · {p.currency} {money(Number(p.amount))}
                          </Text>
                          <Text style={{ color: colors.muted, fontSize: 12 }}>{p.paid_at?.slice(0, 10)}</Text>
                        </View>
                        <TouchableOpacity onPress={() => deleteAbono(p)} style={{ padding: spacing.xs }}>
                          <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>🗑️ Eliminar</Text>
                        </TouchableOpacity>
                      </View>
                    </Card>
                  ))}
                </>
              ) : null}

              <TouchableOpacity
                style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}
                onPress={() => setSelected(null)}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }}>Volver</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </Screen>
      </Modal>

      {/* ── Modal: marcar como pagada (moneda + monto) ── */}
      <Modal visible={!!payFor} transparent animationType="fade" onRequestClose={() => setPayFor(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }}>Registrar abono</Text>
            {payFor ? (
              <>
                <Text style={{ color: colors.muted, fontSize: 13 }}>
                  {payFor.company} · Semana {payFor.weekStart} → {payFor.weekEnd}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.md }}>
                  Total ${money(payFor.total)} · abonado ${money(payFor.paidAmount)} · <Text style={{ color: colors.primary, fontWeight: '800' }}>saldo ${money(payFor.saldo)}</Text>
                </Text>
              </>
            ) : null}

            <Text style={{ color: colors.muted, fontSize: 12 }}>Tipo de moneda</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4, marginBottom: spacing.sm }}>
              {CURRENCIES.map((c) => {
                const active = payCurrency === c.value;
                return (
                  <TouchableOpacity
                    key={c.value}
                    onPress={() => setPayCurrency(c.value)}
                    style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary : colors.surface }}
                  >
                    <Text style={{ color: active ? colors.primaryContrast : colors.text, fontSize: 12, fontWeight: '700' }}>{c.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={{ color: colors.muted, fontSize: 12 }}>Monto</Text>
            <TextInput
              value={payAmount}
              onChangeText={(t) => setPayAmount(onlyDecimal(t))}
              keyboardType="numeric"
              inputMode="decimal"
              placeholder="0.00"
              placeholderTextColor={colors.muted}
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.text, fontSize: 16, marginTop: 4 }}
            />

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
              <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setPayFor(null)}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.success }} onPress={confirmPay} disabled={saving}>
                <Text style={{ color: '#fff', fontWeight: '800' }}>{saving ? 'Guardando…' : 'Guardar abono'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Histórico de pagos ── */}
      <Modal visible={histOpen} animationType="slide" onRequestClose={() => setHistOpen(false)}>
        <Screen>
          <TouchableOpacity onPress={() => setHistOpen(false)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm }}>
            <Text style={{ color: colors.primary, fontSize: 20, fontWeight: '800' }}>←</Text>
            <Text style={{ color: colors.primary, fontWeight: '700' }}>Volver</Text>
          </TouchableOpacity>
          <SectionTitle>Histórico de pagos</SectionTitle>
          {payments.length === 0 ? (
            <EmptyState title="Sin pagos" subtitle="Aquí aparecerán todos los pagos hechos a las empresas." />
          ) : (
            payments.map((p) => (
              <TouchableOpacity key={p.id} activeOpacity={0.7} onPress={() => setHistSel(p)}>
                <Card>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: colors.text, fontWeight: '700', flex: 1 }}>🏢 {p.company_name}</Text>
                    <Text style={{ color: colors.success, fontWeight: '800' }}>{p.currency} {money(Number(p.amount))}</Text>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                    Semana {p.period_start} → {p.period_end} · pagado {p.paid_at?.slice(0, 10)}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>Toca para ver el detalle</Text>
                </Card>
              </TouchableOpacity>
            ))
          )}
          <TouchableOpacity style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary }} onPress={() => setHistOpen(false)}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>Cerrar</Text>
          </TouchableOpacity>
        </Screen>
      </Modal>

      {/* ── Detalle de un pago del histórico ── */}
      <Modal visible={!!histSel} animationType="slide" onRequestClose={() => setHistSel(null)}>
        <Screen>
          {histSel ? (
            <>
              <TouchableOpacity onPress={() => setHistSel(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm }}>
                <Text style={{ color: colors.primary, fontSize: 20, fontWeight: '800' }}>←</Text>
                <Text style={{ color: colors.primary, fontWeight: '700' }}>Volver</Text>
              </TouchableOpacity>
              <SectionTitle>{histSel.company_name}</SectionTitle>
              <Card>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Semana {histSel.period_start} → {histSel.period_end}</Text>
                <Text style={{ color: colors.success, fontWeight: '800', fontSize: 22, marginTop: 4 }}>
                  {histSel.currency} {money(Number(histSel.amount))}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Pagado el {histSel.paid_at?.slice(0, 10)}</Text>
              </Card>

              <Text style={{ color: colors.text, fontWeight: '700', marginTop: spacing.sm, marginBottom: spacing.xs }}>
                Máquinas asociadas · horas × precio
              </Text>
              {(histSel.detail?.machines ?? []).map((m, i) => (
                <Card key={i}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: colors.text, fontWeight: '700', flex: 1 }}>{m.machine}</Text>
                    <Text style={{ color: colors.success, fontWeight: '800' }}>${money(Number(m.subtotal))}</Text>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                    ⏱️ {Number(m.hours).toLocaleString()} h × ${money(Number(m.price))}/h
                  </Text>
                </Card>
              ))}
              {histSel.detail ? (
                <Card>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.text, fontWeight: '800' }}>TOTAL calculado</Text>
                    <Text style={{ color: colors.text, fontWeight: '800' }}>${money(Number(histSel.detail.total))}</Text>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{Number(histSel.detail.totalHours).toLocaleString()} h trabajadas</Text>
                </Card>
              ) : null}

              <TouchableOpacity style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary }} onPress={() => setHistSel(null)}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>Volver</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </Screen>
      </Modal>

      {/* ── Reporte por empresa / rango ── */}
      <Modal visible={repOpen} transparent animationType="fade" onRequestClose={() => setRepOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17, marginBottom: spacing.sm }}>Reporte de pagos</Text>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Empresas (marca una o varias)</Text>
              {repCompanies.length > 0 ? (
                <TouchableOpacity onPress={() => setRepCompanies([])}>
                  <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>Limpiar</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <ScrollView style={{ marginTop: 4, marginBottom: spacing.sm, maxHeight: 220 }}>
              {/* "Todas" = ninguna marcada (reporte general). */}
              <TouchableOpacity
                onPress={() => setRepCompanies([])}
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs }}
              >
                <View style={{ width: 22, height: 22, borderRadius: radius.sm, borderWidth: 2, borderColor: repCompanies.length === 0 ? colors.primary : colors.border, backgroundColor: repCompanies.length === 0 ? colors.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {repCompanies.length === 0 ? <Text style={{ color: colors.primaryContrast, fontWeight: '900', fontSize: 13 }}>✓</Text> : null}
                </View>
                <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800' }}>Todas (general)</Text>
              </TouchableOpacity>
              {companyNames.map((c) => {
                const checked = repCompanies.includes(c);
                return (
                  <TouchableOpacity
                    key={c}
                    onPress={() => setRepCompanies((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs }}
                  >
                    <View style={{ width: 22, height: 22, borderRadius: radius.sm, borderWidth: 2, borderColor: checked ? colors.primary : colors.border, backgroundColor: checked ? colors.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                      {checked ? <Text style={{ color: colors.primaryContrast, fontWeight: '900', fontSize: 13 }}>✓</Text> : null}
                    </View>
                    <Text style={{ color: colors.text, fontSize: 14, flex: 1 }}>{c}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Desde</Text>
                <DateField value={repFrom} onChange={setRepFrom} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Hasta</Text>
                <DateField value={repTo} onChange={setRepTo} />
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
              <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setRepOpen(false)}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary }} onPress={generateReport}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>⬇️ Generar PDF</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Tabulador de precios ── */}
      <Modal visible={tarOpen} animationType="slide" onRequestClose={() => setTarOpen(false)}>
        <Screen>
          <TouchableOpacity onPress={() => setTarOpen(false)} style={{ paddingVertical: spacing.xs, marginBottom: spacing.xs }}>
            <Text style={{ color: colors.primary, fontWeight: '700' }}>← Volver</Text>
          </TouchableOpacity>
          <SectionTitle>💲 Tabulador de precios</SectionTitle>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
            Precio por jornada (12 h) por clasificación y modelo. El tabulador General aplica a todas las
            empresas; cada empresa puede tener su propio precio (si lo dejas vacío, usa el General). Al
            sincronizar, cada máquina toma el precio de su empresa; los cierres anteriores quedan congelados.
          </Text>

          {!syncPreview ? (
            // Selector de ámbito: General o una empresa (precio propio de esa empresa).
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm, flexGrow: 0 }} contentContainerStyle={{ gap: spacing.xs }}>
              {[{ id: 'general', name: '💲 General' }, ...tarCompanies.map((c) => ({ id: c.id, name: `🏢 ${c.name}` }))].map((opt) => {
                const on = tarScope === opt.id;
                const nOv = opt.id !== 'general' ? Object.keys(companyTar[opt.id] ?? {}).length : 0;
                return (
                  <TouchableOpacity key={opt.id} onPress={() => switchScope(opt.id)}
                    style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface }}>
                    <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>
                      {opt.name}{nOv > 0 ? ` (${nOv})` : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : null}

          {syncPreview ? (
            // ── Vista previa de la sincronización ──
            <View style={{ flex: 1 }}>
              <Card style={{ backgroundColor: colors.surfaceAlt }}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>
                  Se cambiarán {syncPreview.totalChanges} equipo(s)
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {syncPreview.unmatched.length} sin emparejar (no se tocan)
                </Text>
              </Card>
              <ScrollView style={{ flex: 1, marginTop: spacing.sm }}>
                {syncPreview.changes.map((r) => (
                  <Card key={r.modelo} style={{ marginBottom: spacing.xs }}>
                    <Text style={{ color: colors.text, fontWeight: '800' }}>
                      {r.modelo} → ${money(r.price)} <Text style={{ color: colors.muted, fontWeight: '400' }}>({r.machines.length})</Text>
                    </Text>
                    {r.machines.map((m) => (
                      <Text key={m.id} style={{ color: colors.muted, fontSize: 12 }}>
                        • {m.label}  {m.from != null ? `($${money(m.from)} → $${money(r.price)})` : `(→ $${money(r.price)})`}
                      </Text>
                    ))}
                  </Card>
                ))}
                {syncPreview.unmatched.length > 0 ? (
                  <Card style={{ marginBottom: spacing.xs, borderColor: colors.warning, borderWidth: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '800' }}>
                      ⚠️ Sin emparejar ({syncPreview.unmatched.length}) — se quedan con su precio
                    </Text>
                    {syncPreview.unmatched.map((m) => (
                      <Text key={m.id} style={{ color: colors.muted, fontSize: 12 }}>
                        • {m.label} {m.tipo ? `[${m.tipo}]` : ''}
                      </Text>
                    ))}
                  </Card>
                ) : null}
              </ScrollView>
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setSyncPreview(null)}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>Volver</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={syncing || syncPreview.totalChanges === 0}
                  style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: syncPreview.totalChanges === 0 ? colors.muted : colors.primary, opacity: syncing ? 0.6 : 1 }}
                  onPress={applySync}
                >
                  <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>{syncing ? 'Aplicando…' : '✅ Aplicar sincronización'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            // ── Lista editable del tabulador ──
            <View style={{ flex: 1 }}>
              <ScrollView style={{ flex: 1 }}>
                {tariffs.map((t) => (
                  <View
                    key={t.id}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}
                  >
                    <View style={{ flex: 1, paddingRight: spacing.sm }}>
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{t.modelo}</Text>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>
                        {t.clasificacion}
                        {tarScope !== 'general' && (tarEdits[t.modelo] ?? '').trim() === '' ? `  ·  usa General ($${money(Number(t.price_jornada))})` : ''}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Text style={{ color: colors.muted }}>$</Text>
                      <TextInput
                        editable={canEditTar}
                        value={tarEdits[t.modelo] ?? ''}
                        onChangeText={(v) => setTarEdits((p) => ({ ...p, [t.modelo]: onlyDecimal(v) }))}
                        keyboardType="numeric"
                        inputMode="decimal"
                        placeholder={tarScope !== 'general' ? String(Number(t.price_jornada)) : '0'}
                        placeholderTextColor={colors.muted}
                        style={{ minWidth: 74, textAlign: 'right', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4, color: colors.text }}
                      />
                    </View>
                  </View>
                ))}
                <View style={{ height: spacing.md }} />
              </ScrollView>
              {canEditTar ? (
                <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setTarOpen(false)}>
                      <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity disabled={tarSaving} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.primary, opacity: tarSaving ? 0.6 : 1 }} onPress={saveTariffs}>
                      <Text style={{ color: colors.primary, fontWeight: '800' }}>{tarSaving ? 'Guardando…' : '💾 Guardar precios'}</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity style={{ padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary }} onPress={buildSyncPreview}>
                    <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>🔄 Sincronizar precios actuales…</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={{ padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt, marginTop: spacing.sm }} onPress={() => setTarOpen(false)}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </Screen>
      </Modal>
    </Screen>
  );
}
