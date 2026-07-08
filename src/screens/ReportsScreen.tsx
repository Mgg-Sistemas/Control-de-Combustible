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
import { Screen, Card, SectionTitle, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { supabase } from '../lib/supabase';
import { exportPdf } from '../lib/pdf';
import { LOGO_DATA_URI } from '../lib/logoData';
import { COMPANY_NAME, COMPANY_RIF } from '../lib/company';
import { ROUND_TIMES, ROUND_LABELS, SHIFT_HOURS, workedHours } from './ControlMaquinariaScreen';
import { spacing, radius, AppColors } from '../theme';
import { useTheme } from '../theme/ThemeContext';

type RoundRow = {
  round_date: string;
  machine: string;
  company: string;
  statuses: (string | null)[]; // len 4
  hours_stopped: number;
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
  company: string;
  liters: number;
};
type FleetCompany = { company: string; count: number; liters: number; items: FleetItem[] };

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
  *{box-sizing:border-box}
  body{font-family:Tahoma,Geneva,Verdana,sans-serif;color:#333;padding:30px 32px}
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
  return `<!doctype html><html><head><meta charset="utf-8"><style>${PDF_CSS}</style></head><body>
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
  const [roundRows, setRoundRows] = useState<RoundRow[]>([]);
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
  const fleetGeneric = useMemo(
    () => [...fleetItems].sort((a, b) => b.liters - a.liters),
    [fleetItems]
  );
  const fleetTotalLiters = fleetItems.reduce((s, it) => s + it.liters, 0);

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
    const { data } = await supabase
      .from('machine_rounds')
      .select('round_date, round_no, status, hours_stopped, machinery:machinery_id(code, company:company_id(name))')
      .gte('round_date', fromArg)
      .lte('round_date', toArg)
      .order('round_date', { ascending: true });
    const map = new Map<string, RoundRow>();
    (data ?? []).forEach((r: any) => {
      const machine = r.machinery?.code ?? '—';
      const company = r.machinery?.company?.name ?? 'Sin empresa';
      const k = `${r.round_date}|${machine}`;
      const row = map.get(k) ?? { round_date: r.round_date, machine, company, statuses: [null, null, null, null], hours_stopped: 0 };
      row.statuses[r.round_no - 1] = r.status;
      row.hours_stopped += Number(r.hours_stopped) || 0;
      map.set(k, row);
    });
    let list = Array.from(map.values()).sort((a, b) =>
      a.round_date === b.round_date ? a.machine.localeCompare(b.machine) : a.round_date.localeCompare(b.round_date)
    );
    // Sincronía con Control de maquinaria: si viene una empresa, filtra solo sus máquinas.
    if (companyArg) list = list.filter((r) => r.company === companyArg);
    setRoundsCompany(companyArg ?? null);
    setRoundRows(list);
    setLoading(false);
    setRoundsPreview(true);
  };

  const cell = (s: string | null) => (s === 'operativa' ? '✓' : s === 'parada' ? '✕' : '—');
  const cellColor = (s: string | null) => (s === 'operativa' ? '#16A34A' : s === 'parada' ? '#DC2626' : '#9CA3AF');

  const downloadRoundsPdf = async () => {
    const head = `<tr><th style="text-align:left">Fecha</th><th style="text-align:left">Máquina</th>${ROUND_LABELS
      .map((l, i) => `<th>${l}<br/>${ROUND_TIMES[i]}</th>`)
      .join('')}<th>HORAS<br/>PARADA</th><th>HORAS<br/>TRABAJADAS</th></tr>`;
    const body = roundRows
      .map(
        (r) =>
          `<tr><td>${r.round_date}</td><td>${r.machine}</td>${r.statuses
            .map((s) => `<td style="text-align:center;color:${cellColor(s)};font-weight:700">${cell(s)}</td>`)
            .join('')}<td style="text-align:center">${r.hours_stopped ? r.hours_stopped.toLocaleString() : '—'}</td>` +
          `<td style="text-align:center;font-weight:700">${workedHours(r.hours_stopped)} h</td></tr>`
      )
      .join('');
    const content = `
      <div class="muted">Rondas del ${from} al ${to} · Turno de ${SHIFT_HOURS} h (07:00–19:00)${roundsCompany ? ` · Empresa: ${roundsCompany}` : ''}</div>
      <table style="margin-top:10px"><thead>${head}</thead><tbody>${body || '<tr><td colspan="8" style="text-align:center">Sin datos</td></tr>'}</tbody></table>
      <p class="muted" style="margin-top:8px">✓ Operativa · ✕ Parada · — Sin registro · Horas trabajadas = turno (${SHIFT_HOURS} h) − horas parada</p>`;
    await exportPdf(pdfShell('CONTROL DE MAQUINARIA', 'Rondas por día y hora', content));
  };

  const generateFleet = async () => {
    setLoading(true);
    const [{ data: mach }, { data: vehs }, { data: disp }] = await Promise.all([
      supabase.from('machinery').select('id, code, description, plate, machinery_type, company:company_id(name)'),
      supabase.from('vehicles').select('id, plate, brand, model'),
      supabase
        .from('dispatches')
        .select('machinery_id, vehicle_id, liters')
        .gte('dispatch_date', from)
        .lte('dispatch_date', to),
    ]);
    const mLit = new Map<string, number>();
    const vLit = new Map<string, number>();
    (disp ?? []).forEach((d: any) => {
      if (d.machinery_id) mLit.set(d.machinery_id, (mLit.get(d.machinery_id) ?? 0) + Number(d.liters));
      if (d.vehicle_id) vLit.set(d.vehicle_id, (vLit.get(d.vehicle_id) ?? 0) + Number(d.liters));
    });
    const items: FleetItem[] = [];
    (mach ?? []).forEach((m: any) =>
      items.push({
        name: m.code,
        desc: m.description || '—',
        plate: m.plate,
        kind: m.machinery_type || 'maquinaria',
        company: m.company?.name || 'Sin empresa',
        liters: mLit.get(m.id) ?? 0,
      })
    );
    (vehs ?? []).forEach((v: any) =>
      items.push({
        name: v.plate,
        desc: [v.brand, v.model].filter(Boolean).join(' ') || '—',
        plate: v.plate,
        kind: 'vehiculo',
        company: 'Vehículos',
        liters: vLit.get(v.id) ?? 0,
      })
    );
    setFleetItems(items);
    setLoading(false);
    setFleetPreview(true);
  };

  const downloadFleetPdf = async (onlyCompany?: string) => {
    const companies = onlyCompany ? fleetByCompany.filter((c) => c.company === onlyCompany) : fleetByCompany;
    const generic = onlyCompany ? fleetGeneric.filter((i) => i.company === onlyCompany) : fleetGeneric;
    const totalLiters = companies.reduce((s, c) => s + c.liters, 0);
    const totalEquipos = companies.reduce((s, c) => s + c.count, 0);
    const companyBlocks = companies
      .map(
        (c) =>
          `<h3 style="margin:12px 0 2px">${c.company} — ${c.count} equipo(s) · ${c.liters.toLocaleString()} L</h3>` +
          `<table><thead><tr><th style="text-align:left">Equipo</th><th style="text-align:left">Descripción</th><th style="text-align:left">Placa</th><th style="text-align:right">Litros</th></tr></thead><tbody>${c.items
            .map(
              (i) =>
                `<tr><td>${i.name}</td><td>${i.desc}</td><td>${i.plate ?? '—'}</td><td style="text-align:right">${i.liters.toLocaleString()} L</td></tr>`
            )
            .join('')}</tbody></table>`
      )
      .join('');
    const genericRows = generic
      .map(
        (i) =>
          `<tr><td>${i.name}</td><td>${i.desc}</td><td>${i.company}</td><td style="text-align:right">${i.liters.toLocaleString()} L</td></tr>`
      )
      .join('');
    const sub = onlyCompany ? `Empresa: ${onlyCompany}` : 'Inventario por empresa';
    const body = `
      <div class="muted">Consumo del ${from} al ${to}</div>
      <div class="summary">
        <div><span class="k">Equipos</span><b>${totalEquipos}</b></div>
        <div><span class="k">Empresas</span><b>${companies.length}</b></div>
        <div><span class="k">Consumo total</span><b>${totalLiters.toLocaleString()} L</b></div>
      </div>
      <h2>Por empresa</h2>
      ${companyBlocks || '<span class="muted">Sin datos</span>'}
      <h2>${onlyCompany ? 'Máquinas de la empresa y sus totales' : 'Genérico — todas las máquinas y sus totales'}</h2>
      <table><thead><tr><th>Equipo</th><th>Descripción</th><th>Empresa</th><th style="text-align:right">Litros</th></tr></thead>
      <tbody>${genericRows || '<tr><td colspan="4" style="text-align:center">Sin datos</td></tr>'}</tbody>
      <tfoot><tr><td colspan="3" style="text-align:right">TOTAL</td><td style="text-align:right">${totalLiters.toLocaleString()} L</td></tr></tfoot></table>`;
    await exportPdf(pdfShell('REPORTE DE FLOTA', sub, body));
  };

  // Abrir automáticamente un reporte al llegar con parámetros (p. ej. desde
  // "Ver reporte" en Control de maquinaria → reporte de rondas de ese día).
  useEffect(() => {
    const p = route?.params;
    if (p?.autoReport === 'rounds') {
      const d = p.date || to;
      setMode('rounds');
      setFrom(d);
      setTo(d);
      generateRounds(d, d, p.company ?? null);
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
          { v: 'fleet', label: '🚚 Flota' },
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
              : '🚚 Generar reporte de flota'}
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
          <SectionTitle>Control de máquinas (rondas)</SectionTitle>
          <ReportHeader title="CONTROL DE MAQUINARIA" colors={colors} />
          <Card>
            <Text style={{ color: colors.muted, fontSize: 13 }}>Del {from} al {to}</Text>
            {roundsCompany ? <Text style={{ color: colors.primary, fontWeight: '700', marginTop: 2 }}>🏢 {roundsCompany}</Text> : null}
            <Text style={{ color: colors.text, fontWeight: '700', marginTop: 2 }}>{roundRows.length} registro(s)</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>
              ✓ Operativa · ✕ Parada · — Sin registro
            </Text>
          </Card>

          <ScrollView horizontal showsHorizontalScrollIndicator>
            <View>
              <View style={{ flexDirection: 'row', backgroundColor: colors.surfaceAlt }}>
                <Text style={[styles.th, { width: 84 }]}>Fecha</Text>
                <Text style={[styles.th, { width: 90 }]}>Máquina</Text>
                {ROUND_TIMES.map((t, i) => (
                  <Text key={t} style={[styles.th, { width: 56 }]}>{i + 1}ª{'\n'}{t}</Text>
                ))}
                <Text style={[styles.th, { width: 56 }]}>Horas{'\n'}parada</Text>
                <Text style={[styles.th, { width: 64 }]}>Horas{'\n'}trabaj.</Text>
              </View>
              {roundRows.length === 0 ? (
                <Text style={{ color: colors.muted, padding: spacing.md }}>Sin datos en el rango.</Text>
              ) : (
                roundRows.map((r, idx) => (
                  <View key={idx} style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border }}>
                    <Text style={[styles.td, { width: 84, color: colors.text }]}>{r.round_date.slice(5)}</Text>
                    <Text style={[styles.td, { width: 90, color: colors.text }]}>{r.machine}</Text>
                    {r.statuses.map((s, i) => (
                      <Text key={i} style={[styles.td, { width: 56, textAlign: 'center', color: cellColor(s), fontWeight: '700' }]}>{cell(s)}</Text>
                    ))}
                    <Text style={[styles.td, { width: 56, textAlign: 'center', color: colors.text }]}>{r.hours_stopped || '—'}</Text>
                    <Text style={[styles.td, { width: 64, textAlign: 'center', color: colors.success, fontWeight: '700' }]}>{workedHours(r.hours_stopped)} h</Text>
                  </View>
                ))
              )}
            </View>
          </ScrollView>

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
          <SectionTitle>Flota por empresa</SectionTitle>
          <ReportHeader title="REPORTE DE FLOTA" colors={colors} />
          <Card>
            <Text style={{ color: colors.muted, fontSize: 13 }}>Consumo del {from} al {to}</Text>
            <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: spacing.xs }}>
              <View>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Equipos</Text>
                <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>{fleetItems.length}</Text>
              </View>
              <View>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Empresas</Text>
                <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>{fleetByCompany.length}</Text>
              </View>
              <View>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Consumo total</Text>
                <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>{fleetTotalLiters.toLocaleString()} L</Text>
              </View>
            </View>
          </Card>

          {fleetByCompany.length === 0 ? (
            <Card><Text style={{ color: colors.muted }}>Sin equipos registrados.</Text></Card>
          ) : (
            fleetByCompany.map((c) => (
              <Card key={c.company}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15 }}>{c.company}</Text>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>{c.count} equipo(s)</Text>
                </View>
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
                  Consumo del grupo: {c.liters.toLocaleString()} L
                </Text>
                {c.items.map((i, idx) => (
                  <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderTopWidth: idx ? 1 : 0, borderTopColor: colors.border }}>
                    <View style={{ flex: 1, paddingRight: spacing.sm }}>
                      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{i.name}</Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>
                        {i.desc}{i.plate ? ` · ${i.plate}` : ''}
                      </Text>
                    </View>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>{i.liters.toLocaleString()} L</Text>
                  </View>
                ))}
              </Card>
            ))
          )}

          <Card>
            <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>
              Genérico — todas las máquinas y sus totales
            </Text>
            {fleetGeneric.map((i, idx) => (
              <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
                <Text style={{ color: colors.text, fontSize: 13, flex: 1, paddingRight: spacing.sm }}>
                  {i.name} <Text style={{ color: colors.muted }}>· {i.desc}</Text>
                </Text>
                <Text style={{ color: colors.muted, fontSize: 13 }}>{i.liters.toLocaleString()} L</Text>
              </View>
            ))}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.sm, marginTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>TOTAL</Text>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{fleetTotalLiters.toLocaleString()} L</Text>
            </View>
          </Card>

          <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
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

            <TouchableOpacity style={[styles.btn, { backgroundColor: colors.surfaceAlt }]} onPress={() => setFleetPreview(false)}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
            </TouchableOpacity>
          </View>
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
