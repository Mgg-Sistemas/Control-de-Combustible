import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, TextInput, ScrollView } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { supabase } from '../lib/supabase';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { workedFromShifts } from './ControlMaquinariaScreen';
import { CompanyPayment, PaymentDetail } from '../types/database';
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
  price: number | null;
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
  company: string;
  companyId: string | null;
  weekStart: string;
  weekEnd: string;
  machines: Record<string, MachineAgg>;
  total: number;
  hoursWorked: number;
  noPrice: boolean;
  // Abonos (pagos parciales) de la semana: se acumulan hasta cubrir el total.
  abonos: CompanyPayment[]; // todos los abonos de esta empresa+semana
  paidAmount: number;       // suma de abonos
  saldo: number;            // total − abonado (nunca negativo)
  fullyPaid: boolean;       // saldado por completo
};

export default function ControlPagosScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { canSee, role, session } = useAuth();
  const confirm = useConfirm();
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<Group[]>([]);
  const [payments, setPayments] = useState<CompanyPayment[]>([]);
  const [selected, setSelected] = useState<Group | null>(null);
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
  const [repCompany, setRepCompany] = useState<string>('__all__');
  const [repFrom, setRepFrom] = useState(addDaysISO(todayISO(), -30));
  const [repTo, setRepTo] = useState(todayISO());

  const load = async () => {
    setLoading(true);
    const [{ data: rounds }, { data: pays }] = await Promise.all([
      supabase
        .from('machine_rounds')
        .select('round_date, round_no, hours_stopped, overtime_hours, day_hours, night_hours, status, machinery:machinery_id(id, code, serial, plate, price_per_hour, company:company_id(id, name))')
        .order('round_date', { ascending: false }),
      supabase.from('company_payments').select('*').order('paid_at', { ascending: false }),
    ]);

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
        ({ company, companyId, weekStart, weekEnd: addDaysISO(weekStart, 6), machines: {}, total: 0, hoursWorked: 0, noPrice: false, abonos: [], paidAmount: 0, saldo: 0, fullyPaid: false } as Group);
      const ma = g.machines[machineId] ?? { machine: label, serial, price, hours: 0, dayHours: 0, nightHours: 0, subtotal: 0, perDay: {} };
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
      let total = 0;
      let hoursWorked = 0;
      let noPrice = false;
      Object.values(g.machines).forEach((ma) => {
        const days = Object.values(ma.perDay);
        const hrs = days.reduce((s, d) => s + billableHours(d), 0);
        // Monto = horas TRABAJADAS × precio por hora (precio jornada ÷ 12); las paradas ya están descontadas en hrs.
        const units = hrs / 12;
        ma.hours = hrs;
        ma.dayHours = days.reduce((s, d) => s + (d.day + d.night > 0 ? d.day : 0), 0);
        ma.nightHours = days.reduce((s, d) => s + (d.day + d.night > 0 ? d.night : 0), 0);
        ma.subtotal = round2((ma.price ?? 0) * units);
        total += ma.subtotal;
        hoursWorked += hrs;
        if (ma.price == null && hrs > 0) noPrice = true;
      });
      g.total = round2(total);
      g.hoursWorked = hoursWorked;
      g.noPrice = noPrice;
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
    setLoading(false);
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
  const q = query.trim().toLowerCase();
  const shown = !q ? visible : visible.filter((g) => g.company.toLowerCase().includes(q));

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
    const [{ data: mach }, { data: rnds }] = await Promise.all([
      supabase.from('machinery').select('id, code, serial, tipo, entry_date, price_per_hour, company:company_id(id, name)'),
      supabase.from('machine_rounds').select('machinery_id, round_date, day_hours, night_hours, hours_stopped, overtime_hours'),
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
        key = ws; label = `Semana ${ws} → ${end}`; order = Number(ws.replace(/-/g, ''));
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
    await exportPdf(html);
  };

  // ── Reporte PDF por empresa y rango de fechas ────────────────────────────────
  const generateReport = async () => {
    const inRange = groups.filter(
      (g) => g.weekStart >= repFrom && g.weekStart <= repTo && (repCompany === '__all__' || g.company === repCompany)
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
        return `<h3 style="margin:16px 0 2px;color:#1E3A5F">${g.company} · Semana ${g.weekStart} → ${g.weekEnd} <span style="color:#666;font-weight:400">· ${estado}</span></h3>
          <table><thead><tr><th>Máquina</th><th>☀️ Día</th><th>🌙 Noche</th><th>Horas trab.</th><th>Precio/jornada</th><th>Subtotal</th></tr></thead>
          <tbody>${mrows || '<tr><td colspan="6" style="text-align:center">Sin máquinas</td></tr>'}</tbody>
          <tfoot><tr><td style="font-weight:700">TOTAL</td><td style="text-align:right;font-weight:700">${totDay.toLocaleString()} h</td><td style="text-align:right;font-weight:700">${totNight.toLocaleString()} h</td><td style="text-align:right;font-weight:700">${g.hoursWorked.toLocaleString()} h</td><td></td><td style="text-align:right;font-weight:800">$${money(g.total)}</td></tr></tfoot></table>`;
      })
      .join('');
    const totalPend = inRange.reduce((s, g) => s + g.saldo, 0);
    const totalPag = inRange.reduce((s, g) => s + g.paidAmount, 0);
    const title = repCompany === '__all__' ? 'Todas las empresas' : repCompany;
    const html = pdfDocument({
      title: 'Control de pagos por maquinaria',
      subtitle: `${title} · del ${repFrom} al ${repTo}`,
      extraCss: `
        table{width:100%;border-collapse:collapse;margin-top:4px;font-size:11px}
        th,td{border:1px solid #ccc;padding:5px 7px;text-align:left}
        th{background:#1E3A5F;color:#fff}
        tfoot td{background:#EEF2F7}
        .tot{margin-top:16px;font-size:13px}
        .muted{color:#666;font-size:12px}`,
      body: `
      ${sections || '<p class="muted">Sin datos en el rango.</p>'}
      <div class="tot"><b>Total pendiente:</b> $${money(totalPend)} &nbsp;·&nbsp; <b>Total pagado (rango):</b> $${money(totalPag)}</div>`,
    });
    await exportPdf(html);
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
          // Máquinas con jornada = máquinas distintas que trabajaron en la empresa.
          const machineSet = new Set<string>();
          weeks.forEach((g) => machinesOf(g).forEach((m) => machineSet.add(m.machine)));
          return (
            <View key={company}>
              <TouchableOpacity activeOpacity={0.7} onPress={() => setExpandedCompany((p) => ({ ...p, [company]: !p[company] }))}>
                <Card style={{ backgroundColor: colors.surfaceAlt, marginTop: spacing.sm }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>🏢 {company}</Text>
                    <Text style={{ color: debt > 0 ? colors.primary : colors.success, fontWeight: '800', fontSize: 15 }}>${money(debt)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>🚜 {machineSet.size} máquina(s) con jornada · {weeks.length} semana(s)</Text>
                    <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>{open ? '▲ ocultar' : '▼ ver detalle'}</Text>
                  </View>
                </Card>
              </TouchableOpacity>
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

      {/* ── Detalle de la cuenta (empresa + semana) ── */}
      <Modal visible={!!selected} animationType="slide" onRequestClose={() => setSelected(null)}>
        <Screen>
          {selected ? (
            <>
              <SectionTitle>{selected.company}</SectionTitle>
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

              {selected.fullyPaid ? (
                <Card style={{ borderColor: colors.success, marginTop: spacing.sm }}>
                  <Text style={{ color: colors.success, fontWeight: '800' }}>✓ Pagada por completo</Text>
                  <Text style={{ color: colors.text, fontSize: 13 }}>
                    Total abonado: ${money(selected.paidAmount)}
                  </Text>
                </Card>
              ) : (
                <TouchableOpacity
                  style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.success }}
                  onPress={() => openPay(selected)}
                >
                  <Text style={{ color: '#fff', fontWeight: '800' }}>
                    {selected.paidAmount > 0 ? `＋ Registrar abono · resta $${money(selected.saldo)}` : '＋ Registrar abono / pago'}
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}
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
              onChangeText={setPayAmount}
              keyboardType="numeric"
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

            <Text style={{ color: colors.muted, fontSize: 12 }}>Empresa</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4, marginBottom: spacing.sm }}>
              <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                {[{ label: 'Todas', value: '__all__' }, ...companyNames.map((c) => ({ label: c, value: c }))].map((c) => {
                  const active = repCompany === c.value;
                  return (
                    <TouchableOpacity
                      key={c.value}
                      onPress={() => setRepCompany(c.value)}
                      style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary : colors.surface }}
                    >
                      <Text style={{ color: active ? colors.primaryContrast : colors.text, fontSize: 12, fontWeight: '700' }}>{c.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Desde</Text>
                <TextInput value={repFrom} onChangeText={setRepFrom} placeholder="AAAA-MM-DD" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginTop: 4 }} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Hasta</Text>
                <TextInput value={repTo} onChangeText={setRepTo} placeholder="AAAA-MM-DD" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginTop: 4 }} />
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
    </Screen>
  );
}
