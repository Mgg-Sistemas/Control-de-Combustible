import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
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
import { DateField } from '../components/DateField';
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

/** Suma (o resta) días a una fecha ISO "AAAA-MM-DD" sin depender de la zona horaria. */
function addDaysISO(iso: string, delta: number): string {
  const [y, mo, d] = (iso || '').split('-').map((n) => parseInt(n, 10));
  if (!y || !mo || !d) return iso;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  const mm = `${dt.getUTCMonth() + 1}`.padStart(2, '0');
  const dd = `${dt.getUTCDate()}`.padStart(2, '0');
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

/** Fecha ISO "AAAA-MM-DD" → "DD/MM/AAAA" (para los PDF). */
function fmtDMY(iso: string): string {
  const [y, m, d] = (iso || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : (iso || '');
}
/** Fecha ISO "AAAA-MM-DD" → "DD/MM" (etiquetas cortas en PDF). */
function fmtDM(iso: string): string {
  const [, m, d] = (iso || '').split('-');
  return m && d ? `${d}/${m}` : (iso || '');
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

// ── Reporte "Despliegue de Maquinaria" (infográfico apaisado, mismo diseño que
//    el resumen operativo). Se imprime a PDF en láminas 1280×720 (landscape).
type DeployData = {
  periodLabel: string;
  byCo: { company: string; count: number; hours: number }[];
  byTp: { tipo: string; count: number; hours: number }[];
  inact: { code: string; tipo: string; company: string }[];
  totals: { equipos: number; horas: number; activos: number; inactivos: number; empresas: number; tipos: number };
};
/** Número con punto de miles (17.075). */
const fmtMiles = (n: number) => Math.round(n).toLocaleString('de-DE');
/** HTML del infográfico de despliegue de maquinaria (4 láminas landscape). */
function deployInfographicHtml(d: DeployData): string {
  const { byCo, byTp, inact, totals, periodLabel } = d;
  const maxCo = Math.max(1, ...byCo.map((c) => c.hours));
  const maxTp = Math.max(1, ...byTp.map((t) => t.hours));
  const style = `<style>
  @page { size: 13.333in 7.5in; margin: 0; }
  * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  :root { --navy:#16324F; --gold:#B4924E; --gold-soft:#EFE7D6; --ink:#1a1c20; --muted:#6b7280; --line:#e3e6ea; --bg:#ffffff; --panel:#F7F5F1; }
  body { font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif; color:var(--ink); background:#54606b; }
  .slide { width:1280px; height:720px; background:var(--bg); position:relative; overflow:hidden; page-break-after:always; margin:0 auto; }
  .slide:last-child { page-break-after:auto; }
  .pad { padding:54px 64px; height:100%; display:flex; flex-direction:column; }
  .brand { display:flex; align-items:center; gap:16px; }
  .brand img { height:56px; width:56px; object-fit:contain; border-radius:8px; }
  .brand .co { font-weight:800; font-size:16px; letter-spacing:.3px; color:var(--navy); line-height:1.1; }
  .brand .rif { font-size:12px; color:var(--muted); margin-top:2px; }
  .top { display:flex; justify-content:space-between; align-items:center; border-bottom:3px solid var(--gold); padding-bottom:18px; }
  .top .period { text-align:right; }
  .top .period .lbl { font-size:11px; letter-spacing:2px; color:var(--muted); text-transform:uppercase; }
  .top .period .val { font-size:15px; font-weight:700; color:var(--navy); margin-top:2px; }
  h1.title { font-size:52px; font-weight:800; color:var(--ink); line-height:1.02; letter-spacing:-.5px; }
  h1.title .sub2 { display:block; font-size:30px; font-weight:600; color:var(--gold); margin-top:6px; letter-spacing:0; }
  h2.stitle { font-size:34px; font-weight:800; color:var(--navy); letter-spacing:-.3px; }
  h2.stitle .accent { color:var(--gold); }
  .stitle-row { display:flex; align-items:baseline; justify-content:space-between; margin-bottom:6px; }
  .stitle-row .hint { font-size:13px; color:var(--muted); }
  .kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:22px; margin-top:8px; }
  .kpi { background:var(--panel); border:1px solid var(--line); border-top:5px solid var(--gold); border-radius:14px; padding:26px 24px; }
  .kpi .k { font-size:13px; letter-spacing:1.5px; text-transform:uppercase; color:var(--muted); font-weight:700; }
  .kpi .v { font-size:44px; font-weight:800; color:var(--navy); margin-top:10px; line-height:1; }
  .kpi .note { font-size:12px; color:var(--muted); margin-top:8px; }
  .cover-lead { font-size:16px; color:var(--muted); max-width:840px; line-height:1.5; margin-top:4px; }
  table.emp { width:100%; border-collapse:collapse; margin-top:14px; }
  table.emp th { text-align:left; font-size:12px; letter-spacing:1px; text-transform:uppercase; color:var(--muted); padding:0 12px 10px; border-bottom:2px solid var(--line); }
  table.emp th.num { text-align:right; }
  table.emp td { padding:13px 12px; border-bottom:1px solid var(--line); font-size:16px; vertical-align:middle; }
  table.emp td.rank { color:var(--gold); font-weight:800; width:34px; }
  table.emp td.name { font-weight:700; color:var(--ink); width:270px; }
  table.emp td.num { text-align:right; width:90px; font-weight:600; }
  table.emp tfoot td { border-top:2px solid var(--navy); border-bottom:none; font-weight:800; font-size:17px; padding-top:14px; }
  .bar-cell { min-width:260px; }
  .bar-track { display:inline-block; width:200px; height:12px; background:var(--gold-soft); border-radius:6px; overflow:hidden; vertical-align:middle; }
  .bar-fill { height:100%; background:linear-gradient(90deg,var(--gold),#caa968); border-radius:6px; }
  .bar-val { font-size:14px; color:var(--muted); margin-left:10px; font-weight:600; }
  .tcols { display:grid; grid-template-columns:1fr 1fr; gap:34px; margin-top:16px; }
  table.tipos { width:100%; border-collapse:collapse; }
  table.tipos th { text-align:left; font-size:11px; letter-spacing:.8px; text-transform:uppercase; color:var(--muted); padding:0 10px 8px; border-bottom:2px solid var(--line); }
  table.tipos th.tnum { text-align:right; }
  table.tipos td { padding:9px 10px; border-bottom:1px solid var(--line); font-size:13.5px; vertical-align:middle; }
  td.tname { font-weight:700; color:var(--ink); }
  td.tnum { text-align:right; font-weight:800; color:var(--gold); width:40px; }
  td.thrs { color:var(--muted); font-size:12.5px; white-space:nowrap; width:130px; }
  .mini { display:inline-block; width:52px; height:6px; background:var(--gold-soft); border-radius:3px; overflow:hidden; vertical-align:middle; margin-right:8px; }
  .mini > span { display:block; height:100%; background:var(--gold); }
  .foot { margin-top:auto; padding-top:16px; display:flex; justify-content:space-between; align-items:center; font-size:11.5px; color:var(--muted); border-top:1px solid var(--line); }
  .foot .sys { font-weight:700; color:var(--navy); }
  .pill { display:inline-block; background:var(--navy); color:#fff; font-size:12px; font-weight:700; padding:6px 14px; border-radius:999px; letter-spacing:.5px; }
</style>`;
  const header = (lbl = 'Período') => `  <div class="top">
    <div class="brand"><img src="${LOGO_DATA_URI}" alt="logo"/><div><div class="co">${COMPANY_NAME}</div><div class="rif">RIF ${COMPANY_RIF}</div></div></div>
    <div class="period"><div class="lbl">${lbl}</div><div class="val">${periodLabel}</div></div>
  </div>`;
  const sys = 'Sistema de Control de Combustible y Maquinaria';
  const slide1 = `<section class="slide"><div class="pad">
${header('Período del reporte')}
  <div style="margin-top:34px">
    <div class="pill">RESUMEN OPERATIVO</div>
    <h1 class="title" style="margin-top:16px">Despliegue de Maquinaria<span class="sub2">Fuerza de Despeje, Transporte y Reconstrucción</span></h1>
    <p class="cover-lead" style="margin-top:14px">Consolidado de horas trabajadas por empresa contratista y por tipo de equipo, e incluye el estado de la flota (equipos activos e inactivos), según los registros de jornada del sistema de control interno.</p>
  </div>
  <div class="kpis" style="margin-top:32px">
    <div class="kpi"><div class="k">Equipos totales</div><div class="v">${totals.equipos}</div><div class="note">flota completa en inventario</div></div>
    <div class="kpi"><div class="k">Horas trabajadas</div><div class="v">${fmtMiles(totals.horas)}</div><div class="note">día + noche − paradas + extras</div></div>
    <div class="kpi"><div class="k">Equipos activos</div><div class="v">${totals.activos}</div><div class="note">${totals.inactivos} inactivo(s)</div></div>
    <div class="kpi"><div class="k">Empresas</div><div class="v">${totals.empresas}</div><div class="note">${totals.tipos} tipos de equipo</div></div>
  </div>
  <div class="foot"><span class="sys">${sys}</span><span>Documento generado por el sistema de control interno · ${periodLabel}</span></div>
</div></section>`;
  const empRows = byCo.map((c, i) => `    <tr>
      <td class="rank">${i + 1}</td>
      <td class="name">${c.company}</td>
      <td class="num">${c.count}</td>
      <td class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width:${c.hours > 0 ? Math.max(4, (c.hours / maxCo) * 100) : 0}%"></div></div><span class="bar-val">${fmtMiles(c.hours)} h</span></td>
    </tr>`).join('\n');
  const slide2 = `<section class="slide"><div class="pad">
${header()}
  <div class="stitle-row" style="margin-top:24px">
    <h2 class="stitle">Fuerza por <span class="accent">Empresa</span></h2>
    <span class="hint">Todas las empresas · barra proporcional a horas</span>
  </div>
  <table class="emp">
    <thead><tr><th></th><th>Empresa</th><th class="num">Equipos</th><th>Horas trabajadas</th></tr></thead>
    <tbody>
${empRows || '<tr><td colspan="4" style="text-align:center;color:#6b7280">Sin datos</td></tr>'}</tbody>
    <tfoot><tr><td></td><td>TOTAL GENERAL</td><td class="num">${totals.equipos}</td><td>${fmtMiles(totals.horas)} h</td></tr></tfoot>
  </table>
  <div class="foot"><span class="sys">${sys}</span><span>Incluye equipos con y sin horas · Horas = día + noche − paradas + extras</span></div>
</div></section>`;
  const half = Math.ceil(byTp.length / 2);
  const tpTable = (arr: DeployData['byTp']) => `<table class="tipos">
    <thead><tr><th>Tipo de maquinaria</th><th class="tnum">Eq.</th><th>Horas</th></tr></thead>
    <tbody>
${arr.map((t) => `    <tr>
      <td class="tname">${t.tipo}</td>
      <td class="tnum">${t.count}</td>
      <td class="thrs"><span class="mini"><span style="width:${t.hours > 0 ? Math.max(6, (t.hours / maxTp) * 100) : 0}%"></span></span>${fmtMiles(t.hours)} h</td>
    </tr>`).join('\n')}</tbody></table>`;
  const slide3 = `<section class="slide"><div class="pad">
${header()}
  <div class="stitle-row" style="margin-top:20px">
    <h2 class="stitle">Capacidad por <span class="accent">Tipo de Maquinaria</span></h2>
    <span class="hint">${totals.tipos} categorías · nº = equipos · barra = horas</span>
  </div>
  <div class="tcols">${tpTable(byTp.slice(0, half))}${tpTable(byTp.slice(half))}</div>
  <div class="foot"><span class="sys">${sys}</span><span>Total: ${totals.equipos} equipos · ${fmtMiles(totals.horas)} h</span></div>
</div></section>`;
  const inRows = inact.map((m, i) => `    <tr>
      <td class="rank">${i + 1}</td>
      <td class="name">${m.code}</td>
      <td class="num" style="text-align:left;width:auto;font-weight:600">${m.tipo}</td>
      <td class="num" style="text-align:left;width:auto;font-weight:700;color:var(--navy)">${m.company}</td>
    </tr>`).join('\n');
  const slide4 = `<section class="slide"><div class="pad">
${header()}
  <div class="stitle-row" style="margin-top:24px">
    <h2 class="stitle">Equipos <span class="accent">Inactivos</span></h2>
    <span class="hint">${totals.inactivos} de ${totals.equipos} equipos · fuera de operación</span>
  </div>
  <table class="emp">
    <thead><tr><th></th><th>Equipo</th><th style="text-align:left">Tipo</th><th style="text-align:left">Empresa a la que pertenece</th></tr></thead>
    <tbody>
${inRows || '    <tr><td colspan="4" style="text-align:center;color:#6b7280">Sin equipos inactivos</td></tr>'}</tbody>
    <tfoot><tr><td></td><td>TOTAL INACTIVOS</td><td class="num">${totals.inactivos}</td><td></td></tr></tfoot>
  </table>
  <div class="foot"><span class="sys">${sys}</span><span>Activos: ${totals.activos} · Inactivos: ${totals.inactivos} · Total flota: ${totals.equipos}</span></div>
</div></section>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title></title>
${style}</head><body>
${slide1}
${slide2}
${slide3}
${slide4}
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
  const [mode, setMode] = useState<'fuel' | 'rounds' | 'fleet' | 'deploy'>('fuel');
  const [roundGroups, setRoundGroups] = useState<RoundCompany[]>([]);
  const [roundsPreview, setRoundsPreview] = useState(false);
  const [roundsCompany, setRoundsCompany] = useState<string | null>(null); // empresa seleccionada (sincronía con Control)
  const [companyList, setCompanyList] = useState<string[]>([]); // empresas para el selector del reporte
  const [typeList, setTypeList] = useState<string[]>([]); // tipos de maquinaria para el filtro
  const [fleetTypes, setFleetTypes] = useState<string[]>([]); // tipos marcados (vacío = todos)
  // Empresas marcadas para filtrar CUALQUIER reporte (vacío = todas / general).
  const [repCompanies, setRepCompanies] = useState<string[]>([]);
  // Estado de la flota (para el bloque final del informe por jornada).
  const [fleetStatus, setFleetStatus] = useState<{ total: number; operativa: number; transito: number; inactivos: number; totalFlota: number }>({ total: 0, operativa: 0, transito: 0, inactivos: 0, totalFlota: 0 });
  const [fleetItems, setFleetItems] = useState<FleetItem[]>([]);
  const [fleetPreview, setFleetPreview] = useState(false);
  const [showCompanyBtns, setShowCompanyBtns] = useState(false);
  const [fleetWithPrices, setFleetWithPrices] = useState(true);

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
    // Filtro por empresa (vacío = todas).
    const shown = repCompanies.length ? mapped.filter((r) => repCompanies.includes(r.company)) : mapped;
    setRows(shown);
    setLoading(false);
    setPreview(true);
  };

  const generateRounds = async (fromArg: string = from, toArg: string = to, companiesArg?: string[] | null) => {
    const cos = companiesArg && companiesArg.length ? companiesArg : null;
    setLoading(true);
    // Paginado: con >1000 rondas en el rango la consulta se truncaba.
    const data = await selectAllRows(
      'machine_rounds',
      'round_date, day_hours, night_hours, hours_stopped, overtime_hours, machinery:machinery_id(id, code, serial, tipo, price_per_hour, company:company_id(name))',
      (q) => q.gte('round_date', fromArg).lte('round_date', toArg)
    );
    // Primer paso: por (máquina única, fecha) tomamos el máximo (dedupe de rondas).
    type Acc = { machine: string; tipo: string; serial: string | null; company: string; price: number | null; byDate: Map<string, { d: number; n: number; s: number; o: number }> };
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
      const cur = a.byDate.get(r.round_date) ?? { d: 0, n: 0, s: 0, o: 0 };
      cur.d = Math.max(cur.d, Number(r.day_hours) || 0);
      cur.n = Math.max(cur.n, Number(r.night_hours) || 0);
      cur.s = Math.max(cur.s, Number(r.hours_stopped) || 0);
      cur.o = Math.max(cur.o, Number(r.overtime_hours) || 0);
      a.byDate.set(r.round_date, cur);
      accs.set(key, a);
    });
    // Segundo paso: agrupar por empresa → máquina con totales.
    // Horas trabajadas = día + noche − parada + extras (igual que el reporte de Maquinaria),
    // por eso restamos paradas: así Jornada y Maquinaria cuadran con el Excel.
    const groups = new Map<string, RoundCompany>();
    accs.forEach((a) => {
      if (cos && !cos.includes(a.company)) return; // filtro por empresa(s)
      let dayH = 0, nightH = 0, totalH = 0, days = 0;
      a.byDate.forEach(({ d, n, s, o }) => {
        const w = workedFromShifts(d, n, s, o);
        dayH += d; nightH += n; totalH += w;
        if (w > 0) days += 1; // solo jornadas con horas trabajadas > 0
      });
      if (totalH <= 0) return; // solo equipos que SÍ trabajaron (nada en 0)
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

    // Estado de la flota: total de activos, en producción (trabajaron), en tránsito
    // (activas que aún no trabajaron = pendientes de incorporación), inactivas y
    // el total de la flota (activas + inactivas), según el alcance del informe.
    const machAll = await selectAllRows('machinery', 'active, company:company_id(name)');
    const inScope = (machAll ?? []).filter((m: any) =>
      !cos || cos.includes(m.company?.name ?? 'Sin empresa')
    );
    const totalActivos = inScope.filter((m: any) => m.active).length;
    const inactivos = inScope.filter((m: any) => !m.active).length;
    const enProduccion = list.reduce((s, g) => s + g.machines.length, 0);
    setFleetStatus({
      total: totalActivos,
      operativa: enProduccion,
      transito: Math.max(0, totalActivos - enProduccion),
      inactivos,
      totalFlota: inScope.length,
    });

    setRoundsCompany(cos ? (cos.length === 1 ? cos[0] : `${cos.length} empresas`) : null);
    setRoundGroups(list);
    setLoading(false);
    setRoundsPreview(true);
  };

  const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const nH = (n: number) => `${Number(n.toFixed(2)).toLocaleString()} h`;
  const downloadRoundsPdf = async () => {
    const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const head = `<tr><th style="text-align:left">Máquina</th><th style="text-align:left">Tipo</th><th>Días</th><th>☀️ H. Día</th><th>🌙 H. Noche</th><th>Total horas</th><th>Precio/hora</th><th>Total $</th></tr>`;
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
              `<td style="text-align:right">${m.priceJornada != null ? usd(m.priceJornada / 12) : '—'}</td>` +
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
    const grandMachines = roundGroups.reduce((s, g) => s + g.machines.length, 0);
    const content = `
      <div class="muted">Informe por jornada · del ${fmtDMY(from)} al ${fmtDMY(to)}${roundsCompany ? ` · Empresa: ${roundsCompany}` : ''}</div>
      ${sections || '<p class="muted">Sin datos en el rango.</p>'}
      <div style="margin-top:16px;padding:10px 14px;background:#1E3A5F;color:#fff;font-weight:800;font-size:14px;border-radius:6px;text-align:right">Total general: ${grandMachines} equipo(s) · ${nH(grandH)} · ${usd(grandUSD)}</div>
      <h2 style="margin-top:20px">Estado de la flota de maquinaria</h2>
      <table><tbody>
        <tr><td style="width:70%"><b>Total de activos</b></td><td style="text-align:right;font-weight:800">${fleetStatus.total} unidades</td></tr>
        <tr><td><b>Capacidad operativa actual</b><br/><span class="muted">Operativas y en producción (con jornada en el período)</span></td><td style="text-align:right;font-weight:800">${fleetStatus.operativa} unidades${fleetStatus.total > 0 ? ` (${Math.round((fleetStatus.operativa / fleetStatus.total) * 100)}%)` : ''}</td></tr>
        <tr><td><b>Máquinas en stand by</b><br/><span class="muted">En espera / pendientes de incorporación</span></td><td style="text-align:right;font-weight:800">${fleetStatus.transito} unidades</td></tr>
        <tr><td><b>Unidades inactivas</b><br/><span class="muted">Fuera de servicio / dadas de baja</span></td><td style="text-align:right;font-weight:800">${fleetStatus.inactivos} unidades</td></tr>
      </tbody>
      <tfoot><tr><td style="font-weight:800;border-top:2px solid #1E3A5F">TOTAL DE LA FLOTA <span class="muted" style="font-weight:400">(activas + inactivas)</span></td><td style="text-align:right;font-weight:800;border-top:2px solid #1E3A5F">${fleetStatus.totalFlota} unidades</td></tr></tfoot>
      </table>
      <p class="muted" style="margin-top:8px">Solo se incluyen equipos que trabajaron (horas > 0). Horas trabajadas = día + noche − parada + extras. Precio/hora = precio de la jornada de 12 h ÷ 12. Total $ = horas trabajadas × precio/hora.</p>`;
    await exportPdf(pdfShell('INFORME POR JORNADA', 'Por empresa y maquinaria', content));
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
      // Horas trabajadas dentro del rango del reporte (día + noche − parada + extras).
      // Paginado: con >1000 rondas la consulta se truncaba y faltaban horas (HBS quedaba corto).
      selectAllRows('machine_rounds', 'machinery_id, round_date, day_hours, night_hours, hours_stopped, overtime_hours', (q) => q.gte('round_date', from).lte('round_date', to)),
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
    const filtered = items.filter(
      (it) => (repCompanies.length === 0 || repCompanies.includes(it.company)) && (fleetTypes.length === 0 || fleetTypes.includes(it.tipo))
    );
    setFleetItems(filtered);
    setLoading(false);
    setFleetPreview(true);
  };

  // Reporte "Despliegue de Maquinaria": genera el infográfico (4 láminas) con
  // datos EN VIVO del rango — horas trabajadas y equipos activos/inactivos.
  const generateDeploy = async () => {
    setLoading(true);
    const [{ data: mach }, rnds] = await Promise.all([
      supabase.from('machinery').select('id, code, tipo, active, company:company_id(name)'),
      selectAllRows(
        'machine_rounds',
        'machinery_id, round_date, day_hours, night_hours, hours_stopped, overtime_hours',
        (q) => q.gte('round_date', from).lte('round_date', to)
      ),
    ]);
    // Horas por máquina en el rango (dedupe por máquina+día, igual que los demás reportes).
    const byMD = new Map<string, any>();
    (rnds ?? []).forEach((r: any) => byMD.set(`${r.machinery_id}|${r.round_date}`, r));
    const mHours = new Map<string, number>();
    byMD.forEach((r) => {
      const w = workedFromShifts(Number(r.day_hours ?? 0), Number(r.night_hours ?? 0), Number(r.hours_stopped ?? 0), Number(r.overtime_hours ?? 0));
      if (w > 0) mHours.set(r.machinery_id, (mHours.get(r.machinery_id) ?? 0) + w);
    });
    const listAll = (mach ?? []).map((m: any) => ({
      code: m.code as string,
      tipo: canonTipo(m.tipo) || 'SIN TIPO',
      active: m.active !== false,
      company: m.company?.name || 'Sin empresa',
      hours: mHours.get(m.id) ?? 0,
    }));
    // Filtro por empresa (vacío = todas).
    const list = repCompanies.length ? listAll.filter((m) => repCompanies.includes(m.company)) : listAll;
    // Agregado por empresa (todas las máquinas, con y sin horas).
    const coMap = new Map<string, { company: string; count: number; hours: number }>();
    list.forEach((m) => { const a = coMap.get(m.company) ?? { company: m.company, count: 0, hours: 0 }; a.count++; a.hours += m.hours; coMap.set(m.company, a); });
    const byCo = [...coMap.values()].sort((a, b) => b.hours - a.hours || b.count - a.count);
    // Agregado por tipo.
    const tpMap = new Map<string, { tipo: string; count: number; hours: number }>();
    list.forEach((m) => { const a = tpMap.get(m.tipo) ?? { tipo: m.tipo, count: 0, hours: 0 }; a.count++; a.hours += m.hours; tpMap.set(m.tipo, a); });
    const byTp = [...tpMap.values()].sort((a, b) => b.hours - a.hours || b.count - a.count);
    // Inactivos con su empresa.
    const inact = list
      .filter((m) => !m.active)
      .sort((a, b) => a.company.localeCompare(b.company) || a.code.localeCompare(b.code))
      .map((m) => ({ code: m.code, tipo: m.tipo, company: m.company }));
    const totals = {
      equipos: list.length,
      horas: list.reduce((s, m) => s + m.hours, 0),
      activos: list.filter((m) => m.active).length,
      inactivos: inact.length,
      empresas: new Set(list.map((m) => m.company)).size,
      tipos: byTp.length,
    };
    setLoading(false);
    const html = deployInfographicHtml({ periodLabel: `${fmtDMY(from)} — ${fmtDMY(to)}`, byCo, byTp, inact, totals });
    await exportPdf(html);
  };

  const downloadFleetPdf = async (onlyCompany?: string, withPrices: boolean = true) => {
    const companies = onlyCompany ? fleetByCompany.filter((c) => c.company === onlyCompany) : fleetByCompany;
    const totalEquipos = companies.reduce((s, c) => s + c.count, 0);
    // Encabezados y celdas de precio se incluyen sólo si withPrices.
    const priceHead = withPrices ? '<th style="text-align:right">Precio/hora</th><th style="text-align:right">Total</th>' : '';
    const companyBlocks = companies
      .map(
        (c) =>
          `<h3 style="margin:12px 0 2px">${c.company} — ${c.count} equipo(s)</h3>` +
          `<table><thead><tr><th style="text-align:left">Equipo</th><th style="text-align:left">Tipo</th><th style="text-align:left">Referencia</th><th style="text-align:right">Horas</th>${priceHead}</tr></thead><tbody>${c.items
            .map(
              (i) =>
                `<tr><td>${i.name}</td><td>${i.tipo}</td><td>${i.referencia ?? '—'}</td><td style="text-align:right">${i.worked} h</td>${withPrices ? `<td style="text-align:right">${i.pricePerHour ? '$' + money2(i.pricePerHour) : '—'}</td><td style="text-align:right;font-weight:700">${i.amount ? '$' + money2(i.amount) : '—'}</td>` : ''}</tr>`
            )
            .join('')}</tbody><tfoot><tr><td style="text-align:right" colspan="3">TOTAL ${c.company}</td><td style="text-align:right;font-weight:700">${c.items.reduce((s, i) => s + i.worked, 0)} h</td>${withPrices ? `<td></td><td style="text-align:right;font-weight:700">$${money2(c.items.reduce((s, i) => s + i.amount, 0))}</td>` : ''}</tr></tfoot></table>`
      )
      .join('');
    const priceTag = withPrices ? ' (con precios)' : ' (sin precios)';
    const sub = (onlyCompany ? `Empresa: ${onlyCompany}` : 'Resumen general') + priceTag;
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
    const genPriceHead = withPrices ? '<th style="text-align:right">Precio/hora</th><th style="text-align:right">Total a pagar</th>' : '';
    const genColspan = withPrices ? 5 : 3;
    const typeRows = Array.from(typeAgg.entries())
      .sort((a, b) => (b[1].count - a[1].count) || a[0].localeCompare(b[0]))
      .map(
        ([tipo, a]) =>
          `<tr><td>${tipo}</td><td style="text-align:right;font-weight:700">${a.count}</td><td style="text-align:right">${a.worked} h</td>${withPrices ? `<td style="text-align:right">${phStr(a.amount, a.worked)}</td><td style="text-align:right;font-weight:700">${a.amount ? '$' + money2(a.amount) : '—'}</td>` : ''}</tr>`
      )
      .join('');
    const companyCountRows = companies
      .map((c) => {
        const w = c.items.reduce((s, i) => s + i.worked, 0);
        const am = c.items.reduce((s, i) => s + i.amount, 0);
        return `<tr><td>${c.company}</td><td style="text-align:right;font-weight:700">${c.count}</td><td style="text-align:right">${w} h</td>${withPrices ? `<td style="text-align:right">${phStr(am, w)}</td><td style="text-align:right;font-weight:700">${am ? '$' + money2(am) : '—'}</td>` : ''}</tr>`;
      })
      .join('');
    const generalBlock = `
      <h2>Reporte general</h2>
      <h3 style="margin:12px 0 2px">Total por tipo de maquinaria</h3>
      <table><thead><tr><th style="text-align:left">Tipo</th><th style="text-align:right">Cantidad</th><th style="text-align:right">Horas</th>${genPriceHead}</tr></thead>
      <tbody>${typeRows || `<tr><td colspan="${genColspan}" style="text-align:center">Sin datos</td></tr>`}</tbody>
      <tfoot><tr><td style="text-align:right">TOTAL</td><td style="text-align:right">${totalEquipos}</td><td style="text-align:right">${grandWorked} h</td>${withPrices ? `<td style="text-align:right">${phStr(grandAmount, grandWorked)}</td><td style="text-align:right">$${money2(grandAmount)}</td>` : ''}</tr></tfoot></table>
      <h3 style="margin:12px 0 2px">Totales de equipos por empresa</h3>
      <table><thead><tr><th style="text-align:left">Empresa</th><th style="text-align:right">Equipos</th><th style="text-align:right">Horas</th>${genPriceHead}</tr></thead>
      <tbody>${companyCountRows || `<tr><td colspan="${genColspan}" style="text-align:center">Sin datos</td></tr>`}</tbody>
      <tfoot><tr><td style="text-align:right">TOTAL</td><td style="text-align:right">${totalEquipos}</td><td style="text-align:right">${grandWorked} h</td>${withPrices ? `<td style="text-align:right">${phStr(grandAmount, grandWorked)}</td><td style="text-align:right">$${money2(grandAmount)}</td>` : ''}</tr></tfoot></table>`;
    // GENERAL = resumen (por tipo + por empresa) + DETALLE agrupado por empresa.
    // POR EMPRESA = detalle de esa empresa.
    const body = onlyCompany
      ? `
      <div class="muted">Del ${fmtDMY(from)} al ${fmtDMY(to)}</div>
      <div class="summary">
        <div><span class="k">Equipos</span><b>${totalEquipos}</b></div>
        <div><span class="k">Empresas</span><b>${companies.length}</b></div>
      </div>
      <h2>Detalle de la empresa</h2>
      ${companyBlocks || '<span class="muted">Sin datos</span>'}`
      : `
      <div class="muted">Del ${fmtDMY(from)} al ${fmtDMY(to)}</div>
      <div class="summary">
        <div><span class="k">Equipos</span><b>${totalEquipos}</b></div>
        <div><span class="k">Empresas</span><b>${companies.length}</b></div>
      </div>
      ${generalBlock}
      <h2>Detalle por empresa</h2>
      ${companyBlocks || '<span class="muted">Sin datos</span>'}`;
    await exportPdf(pdfShell('REPORTE DE MAQUINARIA/VEHÍCULOS', sub, body));
  };

  // Abrir automáticamente un reporte al llegar con parámetros (p. ej. desde
  // "Ver reporte" en Control de maquinaria → reporte de rondas de ese día).
  // Carga la lista de empresas para el selector del reporte por jornada.
  useEffect(() => {
    supabase.from('companies').select('name').order('name').then(({ data }) => {
      setCompanyList((data ?? []).map((c: any) => c.name).filter(Boolean));
    });
    // Lista de tipos de maquinaria (canónicos) para el filtro por tipo.
    selectAllRows('machinery', 'tipo').then((rows) => {
      const set = new Set<string>();
      (rows ?? []).forEach((m: any) => { const t = canonTipo(m.tipo); if (t) set.add(t); });
      setTypeList(Array.from(set).sort((a, b) => a.localeCompare(b)));
    });
  }, []);

  useEffect(() => {
    const p = route?.params;
    if (p?.autoReport === 'rounds') {
      const d = p.date || to;
      const d2 = p.dateTo || d;
      setMode('rounds');
      setFrom(d);
      setTo(d2);
      const cos = p.company ? [p.company] : [];
      setRepCompanies(cos);
      generateRounds(d, d2, cos);
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
      .map((r) => `<div class="col"><div class="bar" style="height:${Math.round((r.liters / maxDay) * 120)}px"></div><div class="lbl">${fmtDM(r.label)}</div><div class="val">${r.liters.toLocaleString()}</div></div>`)
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
      .map((r) => `<tr><td>${fmtDMY(r.label)}</td><td style="text-align:right">${r.liters.toLocaleString()} L</td></tr>`)
      .join('');
    const body = `
      <div class="muted">Consumo del ${fmtDMY(from)} al ${fmtDMY(to)}</div>
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
          { v: 'rounds', label: '🛠️ Jornada' },
          { v: 'fleet', label: '🚚 Maquinaria/Vehículo' },
          { v: 'deploy', label: '🚜 Despliegue' },
        ] as const).map((t) => {
          const active = mode === t.v;
          return (
            <TouchableOpacity
              key={t.v}
              onPress={() => {
                setMode(t.v);
                // Jornada y Maquinaria arrancan en la semana base (26/06 → 05/07);
                // el usuario puede ampliar el rango (añadir días) con los botones.
                if (t.v === 'rounds' || t.v === 'fleet') { setFrom(FLEET_HOURS_START); setTo(FLEET_HOURS_CUTOFF); }
                // Despliegue arranca desde la semana base hasta HOY (editable).
                if (t.v === 'deploy') { setFrom(FLEET_HOURS_START); setTo(isoDaysAgo(0)); }
              }}
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
            <DateField value={from} onChange={setFrom} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.lbl}>Hasta</Text>
            <DateField value={to} onChange={setTo} />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
          {[{ label: 'Hoy', d: 0 }, { label: '7 días', d: 7 }, { label: '30 días', d: 30 }].map((q) => (
            <TouchableOpacity key={q.label} style={styles.quick} onPress={() => setRange(q.d)}>
              <Text style={{ color: colors.text, fontSize: 13 }}>{q.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {mode !== 'fuel' && (
          <>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>
              Semana del reporte · añade o quita días al final
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs, flexWrap: 'wrap' }}>
              <TouchableOpacity style={styles.quick} onPress={() => { setFrom(FLEET_HOURS_START); setTo(FLEET_HOURS_CUTOFF); }}>
                <Text style={{ color: colors.text, fontSize: 13 }}>Semana base</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.quick} onPress={() => setTo((t) => addDaysISO(t, -1))}>
                <Text style={{ color: colors.text, fontSize: 13 }}>− 1 día</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.quick} onPress={() => setTo((t) => addDaysISO(t, 1))}>
                <Text style={{ color: colors.text, fontSize: 13 }}>+ 1 día</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.quick} onPress={() => setTo((t) => addDaysISO(t, 7))}>
                <Text style={{ color: colors.text, fontSize: 13 }}>+ 1 semana</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
        {/* Filtro por empresa (multi-selección con checks) — aplica a TODOS los reportes. */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm }}>
          <Text style={{ color: colors.muted, fontSize: 12 }}>Empresas (marca una o varias)</Text>
          {repCompanies.length > 0 ? (
            <TouchableOpacity onPress={() => setRepCompanies([])}>
              <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>Limpiar</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <View style={{ marginTop: spacing.xs }}>
          <TouchableOpacity
            onPress={() => setRepCompanies([])}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs }}
          >
            <View style={{ width: 22, height: 22, borderRadius: radius.sm, borderWidth: 2, borderColor: repCompanies.length === 0 ? colors.primary : colors.border, backgroundColor: repCompanies.length === 0 ? colors.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              {repCompanies.length === 0 ? <Text style={{ color: colors.primaryContrast, fontWeight: '900', fontSize: 13 }}>✓</Text> : null}
            </View>
            <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800' }}>🏢 Todas (general)</Text>
          </TouchableOpacity>
          {companyList.map((c) => {
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
        </View>

        {/* Filtro por TIPO de maquinaria (checks) — solo en Maquinaria/Vehículo */}
        {mode === 'fleet' && typeList.length > 0 ? (
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm }}>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Tipo de maquinaria (marca uno o varios)</Text>
              {fleetTypes.length > 0 ? (
                <TouchableOpacity onPress={() => setFleetTypes([])}>
                  <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>Limpiar ({fleetTypes.length})</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
              {typeList.map((t) => {
                const on = fleetTypes.includes(t);
                return (
                  <TouchableOpacity
                    key={t}
                    onPress={() => setFleetTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}
                  >
                    <Text style={{ color: on ? colors.primaryContrast : colors.muted, fontSize: 13, fontWeight: '800' }}>{on ? '☑' : '☐'}</Text>
                    <Text style={{ color: on ? colors.primaryContrast : colors.text, fontSize: 13, fontWeight: '700' }}>{t}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        ) : null}
        <TouchableOpacity
          style={styles.genBtn}
          onPress={() =>
            mode === 'fuel'
              ? generate()
              : mode === 'rounds'
              ? generateRounds(from, to, repCompanies)
              : mode === 'fleet'
              ? generateFleet()
              : generateDeploy()
          }
          disabled={loading}
        >
          <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>
            {mode === 'fuel'
              ? '📊 Generar reporte de combustible'
              : mode === 'rounds'
              ? '🛠️ Generar reporte de jornada'
              : mode === 'fleet'
              ? '🚚 Generar reporte de maquinaria/vehículo'
              : '🚜 Descargar despliegue de maquinaria (PDF)'}
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
          <SectionTitle>Informe por jornada</SectionTitle>
          <ReportHeader title="INFORME POR JORNADA" colors={colors} />
          <Card>
            <Text style={{ color: colors.muted, fontSize: 13 }}>Del {from} al {to}</Text>
            {roundsCompany ? <Text style={{ color: colors.primary, fontWeight: '700', marginTop: 2 }}>🏢 {roundsCompany}</Text> : null}
            <Text style={{ color: colors.text, fontWeight: '800', marginTop: 2 }}>
              {roundGroups.reduce((s, g) => s + g.machines.length, 0)} máquina(s) · {nH(roundGroups.reduce((s, g) => s + g.totalH, 0))} · {usd(roundGroups.reduce((s, g) => s + g.totalUSD, 0))}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>Solo equipos que trabajaron</Text>
          </Card>

          <TouchableOpacity style={[styles.btn, { backgroundColor: colors.primary, marginBottom: spacing.sm }]} onPress={downloadRoundsPdf}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>⬇️ Descargar PDF</Text>
          </TouchableOpacity>

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
                      <Text style={{ color: colors.muted, fontSize: 12 }}>Precio/hora: {m.priceJornada != null ? usd(m.priceJornada / 12) : '⚠️ sin precio'}</Text>
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

          {/* Estado de la flota de maquinaria */}
          {roundGroups.length > 0 ? (
            <Card style={{ marginTop: spacing.md }}>
              <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 15, marginBottom: spacing.xs }}>Estado de la flota de maquinaria</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Total de activos</Text>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>{fleetStatus.total} unidades</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1, paddingRight: spacing.sm }}>Capacidad operativa actual{'\n'}<Text style={{ color: colors.muted, fontWeight: '400', fontSize: 11 }}>Operativas y en producción</Text></Text>
                <Text style={{ color: colors.success, fontWeight: '800', fontSize: 13 }}>{fleetStatus.operativa} unidades{fleetStatus.total > 0 ? ` (${Math.round((fleetStatus.operativa / fleetStatus.total) * 100)}%)` : ''}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1, paddingRight: spacing.sm }}>Máquinas en stand by{'\n'}<Text style={{ color: colors.muted, fontWeight: '400', fontSize: 11 }}>En espera / pendientes de incorporación</Text></Text>
                <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 13 }}>{fleetStatus.transito} unidades</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1, paddingRight: spacing.sm }}>Unidades inactivas{'\n'}<Text style={{ color: colors.muted, fontWeight: '400', fontSize: 11 }}>Fuera de servicio / dadas de baja</Text></Text>
                <Text style={{ color: colors.muted, fontWeight: '800', fontSize: 13 }}>{fleetStatus.inactivos} unidades</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTopWidth: 2, borderTopColor: colors.primary }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>TOTAL DE LA FLOTA</Text>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>{fleetStatus.totalFlota} unidades</Text>
              </View>
            </Card>
          ) : null}

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <TouchableOpacity style={[styles.btn, { backgroundColor: colors.surfaceAlt }]} onPress={() => setRoundsPreview(false)}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
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
            <Text style={{ color: colors.muted, fontSize: 13 }}>Del {from} al {to}</Text>
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

          {/* Interruptor: con / sin precios en $ (aplica a General y Por empresa) */}
          <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.xs }}>
            <TouchableOpacity
              style={[styles.quick, { backgroundColor: fleetWithPrices ? colors.primary : colors.surfaceAlt, borderColor: fleetWithPrices ? colors.primary : colors.border }]}
              onPress={() => setFleetWithPrices(true)}
            >
              <Text style={{ color: fleetWithPrices ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13 }}>💲 Con precios</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.quick, { backgroundColor: !fleetWithPrices ? colors.primary : colors.surfaceAlt, borderColor: !fleetWithPrices ? colors.primary : colors.border }]}
              onPress={() => setFleetWithPrices(false)}
            >
              <Text style={{ color: !fleetWithPrices ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13 }}>Sin precios</Text>
            </TouchableOpacity>
          </View>

          {/* Botones de descarga arriba */}
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <TouchableOpacity style={[styles.btn, { backgroundColor: colors.primary }]} onPress={() => downloadFleetPdf(undefined, fleetWithPrices)}>
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
                    onPress={() => downloadFleetPdf(c.company, fleetWithPrices)}
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
