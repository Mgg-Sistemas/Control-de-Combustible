import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
  Image,
} from 'react-native';
import { Screen, Card, SectionTitle, Loading, EmptyState } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { supabase, selectAllRows } from '../lib/supabase';
import { exportPdf } from '../lib/pdf';
import { LOGO_DATA_URI } from '../lib/logoData';
import { COMPANY_NAME, COMPANY_RIF } from '../lib/company';
import { SHIFT_HOURS, workedFromShifts, shiftLabel } from './ControlMaquinariaScreen';
import { canonTipo } from './EquiposScreen';
import { spacing, radius, AppColors } from '../theme';
import { useTheme } from '../theme/ThemeContext';

// Máquina agregada en el informe por rondas (por empresa → maquinaria).
type RoundMachine = {
  machine: string;
  tipo: string;
  serial: string | null;
  days: number;         // días (jornadas) que trabajó
  dayH: number;         // total horas de día
  nightH: number;       // total horas de noche
  totalH: number;       // total de horas (día + noche)
  priceJornada: number | null; // precio por jornada de 12 h
  totalUSD: number;     // total $ = totalH / 12 × precio por jornada
};
type RoundCompany = {
  company: string;
  machines: RoundMachine[];
  days: number; dayH: number; nightH: number; totalH: number; totalUSD: number;
};

type Row = {
  dispatch_date: string;
  liters: number;
  asset_kind: string;
  driver_operator: string | null;
  asset: string;
  tank: string;
  company: string;
};

type FleetItem = {
  name: string;
  desc: string;
  plate: string | null;
  kind: string;
  tipo: string;
  referencia: string | null;
  company: string;
  liters: number;
  worked: number; // horas trabajadas acumuladas hasta el 05/07/2026
  amount: number; // total a pagar por esas horas (horas × precio/hora)
  pricePerHour: number; // precio por hora = precio jornada ÷ 12
};
type FleetCompany = { company: string; count: number; liters: number; items: FleetItem[] };

// Período de las jornadas que resume el reporte de flota (horas trabajadas).
const FLEET_HOURS_START = '2026-06-26';
const FLEET_HOURS_CUTOFF = '2026-07-05';
// Dinero con 2 decimales y redondeo estándar.
const money2 = (n: number) => (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

const MESES = ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sep.', 'oct.', 'nov.', 'dic.'];
function nowStamp(): string {
  const d = new Date();
  let h = d.getHours();
  const ap = h < 12 ? 'a. m.' : 'p. m.';
  h = h % 12;
  if (h === 0) h = 12;
  const mm = `${d.getMinutes()}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${dd} ${MESES[d.getMonth()]} ${d.getFullYear()}, ${`${h}`.padStart(2, '0')}:${mm} ${ap}`;
}

/** Estilo del PDF: membrete tipo "ORDEN DE SALIDA" en azul oscuro y gris. */
const PDF_ACCENT = '#1E3A5F'; // azul oscuro
const PDF_INK = '#1E3A5F';
const PDF_CSS = `
  @page{margin:2cm}
  *{box-sizing:border-box}
  body{font-family:Tahoma,Geneva,Verdana,sans-serif;color:#333;padding:0}
  .top{display:flex;justify-content:space-between;align-items:flex-start}
  .brand{display:flex;gap:16px;align-items:center}
  .brand img{height:70px;width:auto}
  .doc-title{font-size:30px;font-weight:800;color:${PDF_INK};letter-spacing:1px;text-transform:uppercase;margin:0;line-height:1.02}
  .doc-sub{color:#6B7280;font-size:12px;margin-top:5px}
  .emit{text-align:right;font-size:12px;color:#333;white-space:nowrap}
  .emit .k{color:#6B7280;font-weight:700}
  .rule{height:4px;background:${PDF_ACCENT};border:0;margin:14px 0 16px}
  .meta{display:flex;justify-content:space-between;gap:30px;font-size:12px;line-height:1.7;margin-bottom:8px}
  .meta .company{color:#333}
  .meta .company b{color:${PDF_INK};font-size:13px}
  .meta .info{color:#333}
  .meta .info .row{display:flex;gap:8px}
  .meta .info .lbl{font-weight:700;color:${PDF_INK};min-width:120px}
  h2{font-size:14px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:${PDF_INK};margin:22px 0 4px;padding-bottom:5px;border-bottom:2px solid #E5E7EB}
  h3{font-size:13px;color:${PDF_INK};font-weight:700;margin:14px 0 2px}
  table{width:100%;border-collapse:collapse;font-size:12px;margin-top:6px}
  thead th{background:${PDF_ACCENT};color:#fff;text-align:left;padding:9px 10px;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.3px}
  td{padding:8px 10px;border-bottom:1px solid #ECECEC}
  tbody tr:nth-child(even){background:#FAFAFA}
  tfoot td{background:#EDEDED;font-weight:800;color:${PDF_INK}}
  .muted{color:#6B7280;font-size:12px}
  .summary{display:flex;gap:14px;margin:12px 0 4px}
  .summary > div{flex:1;border:1px solid #E9E9E9;border-radius:8px;padding:10px 12px;background:#FBFBFB}
  .summary .k{color:#6B7280;font-size:11px;text-transform:uppercase;letter-spacing:.4px}
  .summary b{display:block;font-size:22px;color:${PDF_INK};margin-top:2px}
  .chart{display:flex;align-items:flex-end;gap:8px;height:170px;border-bottom:1px solid #E5E7EB;padding-bottom:4px;overflow-x:auto}
  .col{display:flex;flex-direction:column;align-items:center;justify-content:flex-end}
  .bar{width:26px;background:${PDF_ACCENT};border-radius:4px 4px 0 0}
  .lbl{font-size:10px;color:#6B7280;margin-top:4px}.val{font-size:10px;color:#333}
  .foot{margin-top:26px;padding-top:10px;border-top:1px solid #E5E7EB;text-align:center;color:#9CA3AF;font-size:10px}
`;
function pdfShell(title: string, sub: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title></title><style>${PDF_CSS}</style></head><body>
    <div class="top">
      <div class="brand"><img src="${LOGO_DATA_URI}"/>
        <div><h1 class="doc-title">${title}</h1><div class="doc-sub">${sub}</div></div>
      </div>
      <div class="emit"><span class="k">Emitida:</span> ${nowStamp()}</div>
    </div>
    <div class="rule"></div>
    <div class="meta">
      <div class="company"><b>${COMPANY_NAME}</b><br/>RIF ${COMPANY_RIF}<br/>Sistema de control interno</div>
    </div>
    ${body}
    <div class="foot">${COMPANY_NAME} · RIF ${COMPANY_RIF} · Documento generado por el sistema de control interno</div>
  </body></html>`;
}

/** Encabezado de la vista previa: logo + título azul + empresa (como el PDF). */
function ReportHeader({ title, colors }: { title: string; colors: AppColors }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm, paddingBottom: spacing.sm, borderBottomWidth: 3, borderBottomColor: '#1E3A5F' }}>
      <Image source={{ uri: LOGO_DATA_URI }} style={{ width: 46, height: 46, borderRadius: 8 }} resizeMode="contain" />
      <View style={{ flex: 1 }}>
        <Text style={{ color: '#2563EB', fontWeight: '800', fontSize: 17 }}>{title}</Text>
        <Text style={{ color: colors.muted, fontSize: 11 }}>{COMPANY_NAME} · RIF {COMPANY_RIF}</Text>
      </View>
    </View>
  );
}

function totalsBy<T extends string>(rows: Row[], key: (r: Row) => T): { label: T; liters: number }[] {
  const m = new Map<T, number>();
  rows.forEach((r) => m.set(key(r), (m.get(key(r)) ?? 0) + r.liters));
  return Array.from(m.entries())
    .map(([label, liters]) => ({ label, liters }))
    .sort((a, b) => b.liters - a.liters);
}

export default function ReportsScreen({ route }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [from, setFrom] = useState(isoDaysAgo(7));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [preview, setPreview] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [mode, setMode] = useState<'fuel' | 'rounds' | 'fleet'>('fuel');
  const [roundGroups, setRoundGroups] = useState<RoundCompany[]>([]);
  const [roundsPreview, setRoundsPreview] = useState(false);
  const [roundsCompany, setRoundsCompany] = useState<string | null>(null); // empresa seleccionada (sincronía con Control)
  const [fleetItems, setFleetItems] = useState<FleetItem[]>([]);
  const [fleetPreview, setFleetPreview] = useState(false);
  const [showCompanyBtns, setShowCompanyBtns] = useState(false);

  const fleetByCompany = useMemo(() => {
    const m = new Map<string, FleetCompany>();
    fleetItems.forEach((it) => {
      const c = m.get(it.company) ?? { company: it.company, count: 0, liters: 0, items: [] };
      c.count += 1;
      c.liters += it.liters;
      c.items.push(it);
      m.set(it.company, c);
    });
    return Array.from(m.values()).sort((a, b) => b.count - a.count);
  }, [fleetItems]);
  // Reporte general: total de equipos por TIPO de maquinaria y por EMPRESA.
  const fleetByType = useMemo(() => {
    const m = new Map<string, number>();
    fleetItems.forEach((it) => { const t = canonTipo(it.tipo) || 'Sin tipo'; m.set(t, (m.get(t) ?? 0) + 1); });
    return Array.from(m.entries())
      .map(([tipo, count]) => ({ tipo, count }))
      .sort((a, b) => (b.count - a.count) || a.tipo.localeCompare(b.tipo));
  }, [fleetItems]);

  const all = rows ?? [];
  const total = all.reduce((s, r) => s + r.liters, 0);
  const byDay = useMemo(() => totalsBy(all, (r) => r.dispatch_date), [rows]);
  const byAsset = useMemo(() => totalsBy(all, (r) => r.asset as any), [rows]);
  const byCompany = useMemo(() => {
    const m = new Map<string, { liters: number; assets: Map<string, number> }>();
    all.forEach((r) => {
      const c = m.get(r.company) ?? { liters: 0, assets: new Map<string, number>() };
      c.liters += r.liters;
      c.assets.set(r.asset, (c.assets.get(r.asset) ?? 0) + r.liters);
      m.set(r.company, c);
    });
    return Array.from(m.entries())
      .map(([company, v]) => ({
        company,
        liters: v.liters,
        assets: Array.from(v.assets.entries())
          .map(([asset, liters]) => ({ asset, liters }))
          .sort((a, b) => b.liters - a.liters),
      }))
      .sort((a, b) => b.liters - a.liters);
  }, [rows]);
  const maxDay = Math.max(1, ...byDay.map((d) => d.liters));
  const maxAsset = Math.max(1, ...byAsset.map((d) => d.liters));
  const dayDetail = selectedDay ? all.filter((r) => r.dispatch_date === selectedDay) : [];

  const generate = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('dispatches')
      .select('dispatch_date, liters, asset_kind, driver_operator, vehicle:vehicle_id(plate), machinery:machinery_id(code, company:company_id(name)), tank:tank_id(name)')
      .gte('dispatch_date', from)
      .lte('dispatch_date', to)
      .order('dispatch_date', { ascending: true });
    const mapped: Row[] = (data ?? []).map((d: any) => ({
      dispatch_date: d.dispatch_date,
      liters: Number(d.liters),
      asset_kind: d.asset_kind,
      driver_operator: d.driver_operator,
      asset: d.vehicle?.plate ?? d.machinery?.code ?? '—',
      tank: d.tank?.name ?? '—',
      company: d.machinery?.company?.name ?? (d.vehicle ? 'Vehículos' : 'Sin empresa'),
    }));
    setRows(mapped);
    setLoading(false);
    setPreview(true);
  };

  const generateRounds = async (fromArg: string = from, toArg: string = to, companyArg?: string | null) => {
    setLoading(true);
    // Paginado: con >1000 rondas en el rango la consulta se truncaba.
    const data = await selectAllRows(
      'machine_rounds',
      'round_date, day_hours, night_hours, machinery:machinery_id(id, code, serial, tipo, price_per_hour, company:company_id(name))',
      (q) => q.gte('round_date', fromArg).lte('round_date', toArg)
    );
    // Primer paso: por (máquina única, fecha) tomamos el máximo (dedupe de rondas).
    type Acc = { machine: string; tipo: string; serial: string | null; company: string; price: number | null; byDate: Map<string, { d: number; n: number }> };
    const accs = new Map<string, Acc>();
    (data ?? []).forEach((r: any) => {
      const mm = r.machinery || {};
      const key = (mm.id || mm.serial || mm.code) as string;
      const a = accs.get(key) ?? {
        machine: mm.code ?? '—',
        tipo: (mm.tipo && String(mm.tipo).trim()) || 'Sin tipo',
        serial: mm.serial ?? null,
        company: mm.company?.name ?? 'Sin empresa',
        price: mm.price_per_hour != null ? Number(mm.price_per_hour) : null,
        byDate: new Map(),
      };
      const cur = a.byDate.get(r.round_date) ?? { d: 0, n: 0 };
      cur.d = Math.max(cur.d, Number(r.day_hours) || 0);
      cur.n = Math.max(cur.n, Number(r.night_hours) || 0);
      a.byDate.set(r.round_date, cur);
      accs.set(key, a);
    });
    // Segundo paso: agrupar por empresa → máquina con totales.
    const groups = new Map<string, RoundCompany>();
    accs.forEach((a) => {
      if (companyArg && a.company !== companyArg) return; // sincronía con Control
      let dayH = 0, nightH = 0, days = 0;
      a.byDate.forEach(({ d, n }) => { dayH += d; nightH += n; if (d + n > 0) days += 1; });
      const totalH = dayH + nightH;
      const totalUSD = a.price != null ? (totalH / 12) * a.price : 0;
      const rm: RoundMachine = { machine: a.machine, tipo: a.tipo, serial: a.serial, days, dayH, nightH, totalH, priceJornada: a.price, totalUSD };
      const g = groups.get(a.company) ?? { company: a.company, machines: [], days: 0, dayH: 0, nightH: 0, totalH: 0, totalUSD: 0 };
      g.machines.push(rm);
      g.days += days; g.dayH += dayH; g.nightH += nightH; g.totalH += totalH; g.totalUSD += totalUSD;
      groups.set(a.company, g);
    });
    const list = Array.from(groups.values()).sort((x, y) =>
      x.company === 'Sin empresa' ? 1 : y.company === 'Sin empresa' ? -1 : x.company.localeCompare(y.company)
    );
    list.forEach((g) => g.machines.sort((x, y) => x.tipo.localeCompare(y.tipo) || x.machine.localeCompare(y.machine)));
    setRoundsCompany(companyArg ?? null);
    setRoundGroups(list);
    setLoading(false);
    setRoundsPreview(true);
  };

  const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const nH = (n: number) => `${Number(n.toFixed(2)).toLocaleString()} h`;

  const downloadRoundsPdf = async () => {
    const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const head = `<tr><th style="text-align:left">Máquina</th><th style="text-align:left">Tipo</th><th>Días</th><th>☀️ H. Día</th><th>🌙 H. Noche</th><th>Total horas</th><th>Precio/jornada (12h)</th><th>Total $</th></tr>`;
    const sections = roundGroups
      .map((g) => {
        const rows = g.machines
          .map(
            (m) =>
              `<tr><td>${esc(m.machine)}${m.serial ? `<br/><span style="color:#888">${esc(m.serial)}</span>` : ''}</td>` +
              `<td>${esc(m.tipo)}</td>` +
              `<td style="text-align:center">${m.days}</td>` +
              `<td style="text-align:center">${nH(m.dayH)}</td>` +
              `<td style="text-align:center">${nH(m.nightH)}</td>` +
              `<td style="text-align:center;font-weight:700">${nH(m.totalH)}</td>` +
              `<td style="text-align:right">${m.priceJornada != null ? usd(m.priceJornada) : '—'}</td>` +
              `<td style="text-align:right;font-weight:700">${m.priceJornada != null ? usd(m.totalUSD) : '—'}</td></tr>`
          )
          .join('');
        return `<h2>🏢 ${esc(g.company)} <span style="color:#666;font-weight:400">(${g.machines.length} máquina${g.machines.length === 1 ? '' : 's'})</span></h2>
          <table><thead>${head}</thead><tbody>${rows}</tbody>
          <tfoot><tr><td colspan="3" style="text-align:right;font-weight:800">TOTAL ${esc(g.company)}</td>
            <td style="text-align:center;font-weight:800">${nH(g.dayH)}</td>
            <td style="text-align:center;font-weight:800">${nH(g.nightH)}</td>
            <td style="text-align:center;font-weight:800">${nH(g.totalH)}</td>
            <td></td><td style="text-align:right;font-weight:800">${usd(g.totalUSD)}</td></tr></tfoot></table>`;
      })
      .join('');
    const grandUSD = roundGroups.reduce((s, g) => s + g.totalUSD, 0);
    const grandH = roundGroups.reduce((s, g) => s + g.totalH, 0);
    const content = `
      <div class="muted">Informe por rondas · del ${from} al ${to}${roundsCompany ? ` · Empresa: ${roundsCompany}` : ''}</div>
      ${sections || '<p class="muted">Sin datos en el rango.</p>'}
      <div style="margin-top:16px;padding:10px 14px;background:#1E3A5F;color:#fff;font-weight:800;font-size:14px;border-radius:6px;text-align:right">Total general: ${nH(grandH)} · ${usd(grandUSD)}</div>
      <p class="muted" style="margin-top:8px">Total $ = (total de horas ÷ 12) × precio por jornada de 12 h. Total horas = horas de día + horas de noche.</p>`;
    await exportPdf(pdfShell('INFORME POR RONDAS', 'Por empresa y maquinaria', content));
  };

  const generateFleet = async () => {
    setLoading(true);
    const [{ data: mach }, { data: vehs }, { data: disp }, rnds] = await Promise.all([
      supabase.from('machinery').select('id, code, description, plate, machinery_type, tipo, referencia, price_per_hour, company:company_id(name)'),
      supabase.from('vehicles').select('id, plate, brand, model'),
      supabase
        .from('dispatches')
        .select('machinery_id, vehicle_id, liters')
        .gte('dispatch_date', from)
        .lte('dispatch_date', to),
      // Horas trabajadas HASTA el 05/07/2026 (día + noche − parada + extras).
      // Paginado: con >1000 rondas la consulta se truncaba y faltaban horas (HBS quedaba corto).
      selectAllRows('machine_rounds', 'machinery_id, round_date, day_hours, night_hours, hours_stopped, overtime_hours', (q) => q.lte('round_date', FLEET_HOURS_CUTOFF)),
    ]);
    const mLit = new Map<string, number>();
    const vLit = new Map<string, number>();
    (disp ?? []).forEach((d: any) => {
      if (d.machinery_id) mLit.set(d.machinery_id, (mLit.get(d.machinery_id) ?? 0) + Number(d.liters));
      if (d.vehicle_id) vLit.set(d.vehicle_id, (vLit.get(d.vehicle_id) ?? 0) + Number(d.liters));
    });
    // Horas por máquina (dedupe por máquina+día).
    const byMD = new Map<string, any>();
    (rnds ?? []).forEach((r: any) => byMD.set(`${r.machinery_id}|${r.round_date}`, r));
    const mHours = new Map<string, number>();
    byMD.forEach((r) => {
      const w = workedFromShifts(Number(r.day_hours ?? 0), Number(r.night_hours ?? 0), Number(r.hours_stopped ?? 0), Number(r.overtime_hours ?? 0));
      if (w > 0) mHours.set(r.machinery_id, (mHours.get(r.machinery_id) ?? 0) + w);
    });
    const items: FleetItem[] = [];
    (mach ?? []).forEach((m: any) => {
      const worked = mHours.get(m.id) ?? 0;
      const price = m.price_per_hour != null ? Number(m.price_per_hour) : 0;
      items.push({
        name: m.code,
        desc: m.description || '—',
        plate: m.plate,
        kind: m.machinery_type || 'maquinaria',
        tipo: canonTipo(m.tipo) || 'Sin tipo',
        referencia: m.referencia || null,
        company: m.company?.name || 'Sin empresa',
        liters: mLit.get(m.id) ?? 0,
        worked,
        amount: (worked / 12) * price,
        pricePerHour: price / 12,
      });
    });
    (vehs ?? []).forEach((v: any) =>
      items.push({
        name: v.plate,
        desc: [v.brand, v.model].filter(Boolean).join(' ') || '—',
        plate: v.plate,
        kind: 'vehiculo',
        tipo: 'Vehículo',
        referencia: null,
        company: 'Vehículos',
        liters: vLit.get(v.id) ?? 0,
        worked: 0,
        amount: 0,
        pricePerHour: 0,
      })
    );
    setFleetItems(items);
    setLoading(false);
    setFleetPreview(true);
  };

  const downloadFleetPdf = async (onlyCompany?: string) => {
    const companies = onlyCompany ? fleetByCompany.filter((c) => c.company === onlyCompany) : fleetByCompany;
    const totalEquipos = companies.reduce((s, c) => s + c.count, 0);
    const companyBlocks = companies
      .map(
        (c) =>
          `<h3 style="margin:12px 0 2px">${c.company} — ${c.count} equipo(s)</h3>` +
          `<table><thead><tr><th style="text-align:left">Equipo</th><th style="text-align:left">Tipo</th><th style="text-align:left">Referencia</th><th style="text-align:right">Precio/hora</th><th style="text-align:right">Horas ≤05/07</th><th style="text-align:right">Total</th></tr></thead><tbody>${c.items
            .map(
              (i) =>
                `<tr><td>${i.name}</td><td>${i.tipo}</td><td>${i.referencia ?? '—'}</td><td style="text-align:right">${i.pricePerHour ? '$' + money2(i.pricePerHour) : '—'}</td><td style="text-align:right">${i.worked} h</td><td style="text-align:right;font-weight:700">${i.amount ? '$' + money2(i.amount) : '—'}</td></tr>`
            )
            .join('')}</tbody><tfoot><tr><td style="text-align:right" colspan="4">TOTAL ${c.company}</td><td style="text-align:right;font-weight:700">${c.items.reduce((s, i) => s + i.worked, 0)} h</td><td style="text-align:right;font-weight:700">$${money2(c.items.reduce((s, i) => s + i.amount, 0))}</td></tr></tfoot></table>`
      )
      .join('');
    const sub = onlyCompany ? `Empresa: ${onlyCompany}` : 'Resumen general';
    // Reporte general (solo en el reporte completo, no cuando se filtra una empresa).
    const typeAgg = new Map<string, { count: number; worked: number; amount: number }>();
    companies.forEach((c) =>
      c.items.forEach((i) => {
        const a = typeAgg.get(i.tipo) ?? { count: 0, worked: 0, amount: 0 };
        a.count += 1; a.worked += i.worked; a.amount += i.amount;
        typeAgg.set(i.tipo, a);
      })
    );
    const grandWorked = companies.reduce((s, c) => s + c.items.reduce((t, i) => t + i.worked, 0), 0);
    const grandAmount = companies.reduce((s, c) => s + c.items.reduce((t, i) => t + i.amount, 0), 0);
    const phStr = (amount: number, worked: number) => (worked > 0 ? '$' + money2(amount / worked) : '—');
    const typeRows = Array.from(typeAgg.entries())
      .sort((a, b) => (b[1].count - a[1].count) || a[0].localeCompare(b[0]))
      .map(
        ([tipo, a]) =>
          `<tr><td>${tipo}</td><td style="text-align:right;font-weight:700">${a.count}</td><td style="text-align:right">${a.worked} h</td><td style="text-align:right">${phStr(a.amount, a.worked)}</td><td style="text-align:right;font-weight:700">${a.amount ? '$' + money2(a.amount) : '—'}</td></tr>`
      )
      .join('');
    const companyCountRows = companies
      .map((c) => {
        const w = c.items.reduce((s, i) => s + i.worked, 0);
        const am = c.items.reduce((s, i) => s + i.amount, 0);
        return `<tr><td>${c.company}</td><td style="text-align:right;font-weight:700">${c.count}</td><td style="text-align:right">${w} h</td><td style="text-align:right">${phStr(am, w)}</td><td style="text-align:right;font-weight:700">${am ? '$' + money2(am) : '—'}</td></tr>`;
      })
      .join('');
    const generalBlock = `
      <h2>Reporte general</h2>
      <h3 style="margin:12px 0 2px">Total por tipo de maquinaria</h3>
      <table><thead><tr><th style="text-align:left">Tipo</th><th style="text-align:right">Cantidad</th><th style="text-align:right">Horas ≤05/07</th><th style="text-align:right">Precio/hora</th><th style="text-align:right">Total a pagar</th></tr></thead>
      <tbody>${typeRows || '<tr><td colspan="5" style="text-align:center">Sin datos</td></tr>'}</tbody>
      <tfoot><tr><td style="text-align:right">TOTAL</td><td style="text-align:right">${totalEquipos}</td><td style="text-align:right">${grandWorked} h</td><td style="text-align:right">${phStr(grandAmount, grandWorked)}</td><td style="text-align:right">$${money2(grandAmount)}</td></tr></tfoot></table>
      <h3 style="margin:12px 0 2px">Totales de equipos por empresa</h3>
      <table><thead><tr><th style="text-align:left">Empresa</th><th style="text-align:right">Equipos</th><th style="text-align:right">Horas ≤05/07</th><th style="text-align:right">Precio/hora</th><th style="text-align:right">Total a pagar</th></tr></thead>
      <tbody>${companyCountRows || '<tr><td colspan="5" style="text-align:center">Sin datos</td></tr>'}</tbody>
      <tfoot><tr><td style="text-align:right">TOTAL</td><td style="text-align:right">${totalEquipos}</td><td style="text-align:right">${grandWorked} h</td><td style="text-align:right">${phStr(grandAmount, grandWorked)}</td><td style="text-align:right">$${money2(grandAmount)}</td></tr></tfoot></table>`;
    // GENERAL = solo resumen (por tipo + por empresa). POR EMPRESA = detalle de esa empresa.
    const body = onlyCompany
      ? `
      <div class="muted">Del ${FLEET_HOURS_START} al ${FLEET_HOURS_CUTOFF}</div>
      <div class="summary">
        <div><span class="k">Equipos</span><b>${totalEquipos}</b></div>
        <div><span class="k">Empresas</span><b>${companies.length}</b></div>
      </div>
      <h2>Detalle de la empresa</h2>
      ${companyBlocks || '<span class="muted">Sin datos</span>'}`
      : `
      <div class="muted">Del ${FLEET_HOURS_START} al ${FLEET_HOURS_CUTOFF}</div>
      <div class="summary">
        <div><span class="k">Equipos</span><b>${totalEquipos}</b></div>
        <div><span class="k">Empresas</span><b>${companies.length}</b></div>
      </div>
      ${generalBlock}`;
    await exportPdf(pdfShell('REPORTE DE MAQUINARIA/VEHÍCULOS', sub, body));
  };

  // Abrir automáticamente un reporte al llegar con parámetros (p. ej. desde
  // "Ver reporte" en Control de maquinaria → reporte de rondas de ese día).
  useEffect(() => {
    const p = route?.params;
    if (p?.autoReport === 'rounds') {
      const d = p.date || to;
      const d2 = p.dateTo || d;
      setMode('rounds');
      setFrom(d);
      setTo(d2);
      generateRounds(d, d2, p.company ?? null);
    }
    // 'nonce' cambia en cada navegación para permitir re-abrir el reporte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.nonce]);

  const setRange = (days: number) => {
    setFrom(isoDaysAgo(days));
    setTo(isoDaysAgo(0));
  };

  const downloadPdf = async () => {
    const dayBars = byDay
      .map((r) => `<div class="col"><div class="bar" style="height:${Math.round((r.liters / maxDay) * 120)}px"></div><div class="lbl">${r.label.slice(5)}</div><div class="val">${r.liters.toLocaleString()}</div></div>`)
      .join('');
    const assetRows = byAsset
      .map((r) => `<tr><td>${r.label}</td><td style="text-align:right">${r.liters.toLocaleString()} L</td></tr>`)
      .join('');
    const companyBlocks = byCompany
      .map(
        (c) =>
          `<h3 style="margin:10px 0 2px">${c.company} — ${c.liters.toLocaleString()} L</h3>` +
          `<table><tbody>${c.assets
            .map((a) => `<tr><td>• ${a.asset}</td><td style="text-align:right">${a.liters.toLocaleString()} L</td></tr>`)
            .join('')}</tbody></table>`
      )
      .join('');
    const dayRows = byDay
      .map((r) => `<tr><td>${r.label}</td><td style="text-align:right">${r.liters.toLocaleString()} L</td></tr>`)
      .join('');
    const body = `
      <div class="muted">Consumo del ${from} al ${to}</div>
      <div class="summary"><div><span class="k">Total</span><b>${total.toLocaleString()} L</b></div>
        <div><span class="k">Despachos</span><b>${all.length}</b></div></div>
      <h2>Consumo por día</h2>
      <div class="chart">${dayBars || '<span class="muted">Sin datos</span>'}</div>
      <table><tbody>${dayRows}</tbody></table>
      <h2>Consumo por equipo / máquina</h2>
      <table><thead><tr><th>Equipo/Máquina</th><th style="text-align:right">Litros</th></tr></thead><tbody>${assetRows}</tbody></table>
      <h2>Consumo por empresa supervisora</h2>
      ${companyBlocks || '<span class="muted">Sin datos</span>'}`;
    await exportPdf(pdfShell('REPORTE DE COMBUSTIBLE', 'Consumo de combustible', body));
  };

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Reportes</SectionTitle>

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
        {([
          { v: 'fuel', label: '⛽ Combustible' },
          { v: 'rounds', label: '🛠️ Rondas' },
          { v: 'fleet', label: '🚚 Maquinaria/Vehículo' },
        ] as const).map((t) => {
          const active = mode === t.v;
          return (
            <TouchableOpacity
              key={t.v}
              onPress={() => setMode(t.v)}
              style={{
                flex: 1,
                paddingVertical: spacing.md,
                borderRadius: radius.md,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: active ? colors.primary : colors.border,
                backgroundColor: active ? colors.primary : colors.surfaceAlt,
              }}
            >
              <Text style={{ color: active ? colors.primaryContrast : colors.text, fontWeight: '700' }}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Card>
        <Text style={{ color: colors.muted, fontSize: 13 }}>Rango de fechas</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.lbl}>Desde</Text>
            <TextInput style={styles.input} value={from} onChangeText={setFrom} placeholder="AAAA-MM-DD" placeholderTextColor={colors.muted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.lbl}>Hasta</Text>
            <TextInput style={styles.input} value={to} onChangeText={setTo} placeholder="AAAA-MM-DD" placeholderTextColor={colors.muted} />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
          {[{ label: 'Hoy', d: 0 }, { label: '7 días', d: 7 }, { label: '30 días', d: 30 }].map((q) => (
            <TouchableOpacity key={q.label} style={styles.quick} onPress={() => setRange(q.d)}>
              <Text style={{ color: colors.text, fontSize: 13 }}>{q.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity
          style={styles.genBtn}
          onPress={() => (mode === 'fuel' ? generate() : mode === 'rounds' ? generateRounds() : generateFleet())}
          disabled={loading}
        >
          <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>
            {mode === 'fuel'
              ? '📊 Generar reporte de combustible'
              : mode === 'rounds'
              ? '🛠️ Generar reporte de rondas'
              : '🚚 Generar reporte de maquinaria/vehículo'}
          </Text>
        </TouchableOpacity>
      </Card>

      {loading ? <Loading /> : null}

      <Modal visible={preview} animationType="slide" onRequestClose={() => setPreview(false)}>
        <Screen>
          <SectionTitle>Vista previa del reporte</SectionTitle>
          <ReportHeader title="REPORTE DE COMBUSTIBLE" colors={colors} />
          <Card>
            <Text style={{ color: colors.muted, fontSize: 13 }}>Del {from} al {to}</Text>
            <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: spacing.xs }}>
              <View>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Total</Text>
                <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>{total.toLocaleString()} L</Text>
              </View>
              <View>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Despachos</Text>
                <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>{all.length}</Text>
              </View>
            </View>
          </Card>

          <Card>
            <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.sm }}>
              Consumo diario (L) · toca un día para ver el detalle
            </Text>
            {byDay.length === 0 ? (
              <Text style={{ color: colors.muted }}>Sin consumos en el rango.</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, height: 160 }}>
                  {byDay.map((r) => (
                    <TouchableOpacity key={r.label} onPress={() => setSelectedDay(r.label)} style={{ alignItems: 'center', justifyContent: 'flex-end' }}>
                      <Text style={{ fontSize: 10, color: colors.text }}>{r.liters.toLocaleString()}</Text>
                      <View style={{ width: 28, height: Math.max(4, (r.liters / maxDay) * 120), backgroundColor: colors.primary, borderRadius: 4 }} />
                      <Text style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>{r.label.slice(5)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            )}
          </Card>

          <Card>
            <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.sm }}>Consumo por equipo / máquina (L)</Text>
            {byAsset.length === 0 ? (
              <Text style={{ color: colors.muted }}>Sin datos.</Text>
            ) : (
              byAsset.map((r) => (
                <View key={r.label} style={{ marginBottom: spacing.sm }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{r.label}</Text>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>{r.liters.toLocaleString()} L</Text>
                  </View>
                  <View style={{ height: 8, backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, marginTop: 2 }}>
                    <View style={{ height: 8, width: `${(r.liters / maxAsset) * 100}%`, backgroundColor: colors.primary, borderRadius: radius.pill }} />
                  </View>
                </View>
              ))
            )}
          </Card>

          <Card>
            <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.sm }}>
              Consumo por empresa supervisora
            </Text>
            {byCompany.length === 0 ? (
              <Text style={{ color: colors.muted }}>Sin datos.</Text>
            ) : (
              byCompany.map((c) => (
                <View key={c.company} style={{ marginBottom: spacing.md }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>{c.company}</Text>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>{c.liters.toLocaleString()} L</Text>
                  </View>
                  {c.assets.map((a) => (
                    <View key={a.asset} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingLeft: spacing.md }}>
                      <Text style={{ color: colors.muted, fontSize: 13 }}>• {a.asset}</Text>
                      <Text style={{ color: colors.muted, fontSize: 13 }}>{a.liters.toLocaleString()} L</Text>
                    </View>
                  ))}
                </View>
              ))
            )}
          </Card>

          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <TouchableOpacity style={[styles.btn, { backgroundColor: colors.surfaceAlt }]} onPress={() => setPreview(false)}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, { backgroundColor: colors.primary }]} onPress={downloadPdf}>
              <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>⬇️ Descargar PDF</Text>
            </TouchableOpacity>
          </View>

          {/* Detalle del día seleccionado */}
          <Modal visible={!!selectedDay} animationType="slide" onRequestClose={() => setSelectedDay(null)}>
            <Screen>
              <SectionTitle>Detalle del {selectedDay}</SectionTitle>
              <Card>
                <Text style={{ color: colors.muted, fontSize: 13 }}>
                  {dayDetail.length} despacho(s) · {dayDetail.reduce((s, r) => s + r.liters, 0).toLocaleString()} L
                </Text>
              </Card>
              {dayDetail.map((r, i) => (
                <Card key={i}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontWeight: '700', color: colors.text }}>{r.asset}</Text>
                    <Text style={{ fontWeight: '700', color: colors.text }}>{r.liters.toLocaleString()} L</Text>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 13 }}>{r.asset_kind} · Tanque: {r.tank}</Text>
                  {r.driver_operator ? <Text style={{ color: colors.muted, fontSize: 13 }}>Operó: {r.driver_operator}</Text> : null}
                </Card>
              ))}
              <TouchableOpacity style={[styles.btn, { backgroundColor: colors.primary }]} onPress={() => setSelectedDay(null)}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>Volver</Text>
              </TouchableOpacity>
            </Screen>
          </Modal>
        </Screen>
      </Modal>

      {/* Vista previa: control de rondas */}
      <Modal visible={roundsPreview} animationType="slide" onRequestClose={() => setRoundsPreview(false)}>
        <Screen>
          <TouchableOpacity
            onPress={() => setRoundsPreview(false)}
            activeOpacity={0.7}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}
          >
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>← Volver</Text>
          </TouchableOpacity>
          <SectionTitle>Informe por rondas</SectionTitle>
          <ReportHeader title="INFORME POR RONDAS" colors={colors} />
          <Card>
            <Text style={{ color: colors.muted, fontSize: 13 }}>Del {from} al {to}</Text>
            {roundsCompany ? <Text style={{ color: colors.primary, fontWeight: '700', marginTop: 2 }}>🏢 {roundsCompany}</Text> : null}
            <Text style={{ color: colors.text, fontWeight: '800', marginTop: 2 }}>
              {roundGroups.reduce((s, g) => s + g.machines.length, 0)} máquina(s) · {usd(roundGroups.reduce((s, g) => s + g.totalUSD, 0))}
            </Text>
          </Card>

          {roundGroups.length === 0 ? (
            <EmptyState title="Sin datos" subtitle="No hay rondas en el rango seleccionado." />
          ) : (
            roundGroups.map((g) => (
              <View key={g.company} style={{ marginBottom: spacing.sm }}>
                <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 15, marginBottom: 4, textTransform: 'uppercase' }}>
                  🏢 {g.company} ({g.machines.length})
                </Text>
                {g.machines.map((m, i) => (
                  <Card key={i}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14, flex: 1 }}>{m.machine}{m.serial ? <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '400' }}>  ·  {m.serial}</Text> : null}</Text>
                      <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 1 }}>
                        <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '700' }}>{m.tipo}</Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: 4 }}>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>📆 {m.days} jornada(s)</Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>☀️ {nH(m.dayH)}</Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>🌙 {nH(m.nightH)}</Text>
                      <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>Σ {nH(m.totalH)}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, paddingTop: 4, borderTopWidth: 1, borderTopColor: colors.border }}>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>Precio/jornada: {m.priceJornada != null ? usd(m.priceJornada) : '⚠️ sin precio'}</Text>
                      <Text style={{ color: colors.success, fontWeight: '800', fontSize: 15 }}>{m.priceJornada != null ? usd(m.totalUSD) : '—'}</Text>
                    </View>
                  </Card>
                ))}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginTop: 2 }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>TOTAL {g.company}</Text>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>{nH(g.totalH)} · {usd(g.totalUSD)}</Text>
                </View>
              </View>
            ))
          )}

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <TouchableOpacity style={[styles.btn, { backgroundColor: colors.surfaceAlt }]} onPress={() => setRoundsPreview(false)}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, { backgroundColor: colors.primary }]} onPress={downloadRoundsPdf}>
              <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>⬇️ Descargar PDF</Text>
            </TouchableOpacity>
          </View>
        </Screen>
      </Modal>

      {/* Vista previa: flota / inventario por empresa */}
      <Modal visible={fleetPreview} animationType="slide" onRequestClose={() => setFleetPreview(false)}>
        <Screen>
          <TouchableOpacity
            onPress={() => setFleetPreview(false)}
            activeOpacity={0.7}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}
          >
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>← Volver</Text>
          </TouchableOpacity>
          <SectionTitle>Maquinaria/Vehículo por empresa</SectionTitle>
          <ReportHeader title="REPORTE DE MAQUINARIA/VEHÍCULOS" colors={colors} />
          <Card>
            <Text style={{ color: colors.muted, fontSize: 13 }}>Del {FLEET_HOURS_START} al {FLEET_HOURS_CUTOFF}</Text>
            <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: spacing.xs }}>
              <View>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Equipos</Text>
                <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>{fleetItems.length}</Text>
              </View>
              <View>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Empresas</Text>
                <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>{fleetByCompany.length}</Text>
              </View>
            </View>
          </Card>

          {/* Botones de descarga arriba */}
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <TouchableOpacity style={[styles.btn, { backgroundColor: colors.primary }]} onPress={() => downloadFleetPdf()}>
              <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>⬇️ General</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: showCompanyBtns ? colors.primary : colors.surfaceAlt }]}
              onPress={() => setShowCompanyBtns((v) => !v)}
            >
              <Text style={{ color: showCompanyBtns ? colors.primaryContrast : colors.text, fontWeight: '700' }}>🏢 Por empresa</Text>
            </TouchableOpacity>
          </View>
          {showCompanyBtns ? (
            <View>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
                Toca una empresa para descargar su informe:
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {fleetByCompany.map((c) => (
                  <TouchableOpacity
                    key={c.company}
                    onPress={() => downloadFleetPdf(c.company)}
                    style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}
                  >
                    <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>
                      {c.company} ({c.count})
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : null}

          {/* Reporte general: total por tipo de maquinaria + totales de equipos por empresa. */}
          {fleetItems.length > 0 ? (
            <Card>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, marginBottom: spacing.xs }}>📋 Reporte general</Text>
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 2 }}>Total por tipo de maquinaria</Text>
              {fleetByType.map((t) => (
                <View key={t.tipo} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Text style={{ color: colors.text, fontSize: 13 }}>{t.tipo}</Text>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{t.count}</Text>
                </View>
              ))}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>TOTAL</Text>
                <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '800' }}>{fleetItems.length}</Text>
              </View>

              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: spacing.sm, marginBottom: 2 }}>Totales de equipos por empresa</Text>
              {fleetByCompany.map((c) => (
                <View key={c.company} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Text style={{ color: colors.text, fontSize: 13 }}>{c.company}</Text>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{c.count}</Text>
                </View>
              ))}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>TOTAL</Text>
                <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '800' }}>{fleetItems.length}</Text>
              </View>
            </Card>
          ) : null}

          {fleetByCompany.length === 0 ? (
            <Card><Text style={{ color: colors.muted }}>Sin equipos registrados.</Text></Card>
          ) : null}

          <TouchableOpacity style={[styles.btn, { backgroundColor: colors.surfaceAlt, marginTop: spacing.md }]} onPress={() => setFleetPreview(false)}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
          </TouchableOpacity>
        </Screen>
      </Modal>
    </Screen>
  );
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  lbl: { color: colors.muted, fontSize: 12, marginBottom: 2 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    color: colors.text,
  },
  quick: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  genBtn: { backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.md },
  btn: { flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center' },
  th: { color: colors.text, fontWeight: '700', fontSize: 11, padding: 6, textAlign: 'center' },
  td: { fontSize: 12, paddingVertical: 8, paddingHorizontal: 6 },
});
