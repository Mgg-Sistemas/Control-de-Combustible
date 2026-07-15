import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { exportPdf, dateRangeLabel } from '../lib/pdf';
import { LOGO_DATA_URI } from '../lib/logoData';
import { COMPANY_NAME } from '../lib/company';
import { SHIFT_HOURS, workedFromShifts, shiftLabel } from './ControlMaquinariaScreen';
import { canonTipo } from './EquiposScreen';
import { fetchActiveGuards } from '../lib/guards';
import { DateField } from '../components/DateField';
import { spacing, radius, AppColors } from '../theme';
import { useTheme } from '../theme/ThemeContext';

// Máquina agregada en el informe por rondas (por empresa → maquinaria).
type RoundMachine = {
  machine: string;
  tipo: string;         // marca / modelo
  clasificacion: string; // clasificación del equipo
  serial: string | null;
  entryDate: string | null; // fecha de llegada de la máquina (entry_date)
  days: number;         // días (jornadas) que trabajó
  dayH: number;         // total horas de día
  nightH: number;       // total horas de noche
  totalH: number;       // total de horas (día + noche)
  priceJornada: number | null; // precio por jornada de 12 h
  totalUSD: number;     // total $ = totalH / 12 × precio por jornada
};
// Viaje registrado en una máquina (solo Golden Touch): nº de viajes y precio unitario.
type ViajeItem = { code: string; clasificacion: string; viajes: number; precio: number };
type RoundCompany = {
  company: string;
  machines: RoundMachine[];
  days: number; dayH: number; nightH: number; totalH: number; totalUSD: number;
  viajes: ViajeItem[];      // viajes por máquina (Golden)
  viajesUSD: number;        // total $ de viajes
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
  marcaModelo: string; // marca / modelo del equipo
  tipo: string;        // clasificación (se usa para agrupar/filtrar)
  referencia: string | null;
  company: string;
  liters: number;
  worked: number; // horas trabajadas acumuladas hasta el 05/07/2026
  amount: number; // total a pagar por esas horas (horas × precio/hora)
  pricePerHour: number; // precio por hora = precio jornada ÷ 12
  guard: string | null; // guardia/militar encargado actual (para el reporte)
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

// ── Semanas del mes (domingo → sábado, como "semana 2 del 05 al 11/07") ──────
const MES_NOMBRES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const isoUTC = (d: Date) => `${d.getUTCFullYear()}-${`${d.getUTCMonth() + 1}`.padStart(2, '0')}-${`${d.getUTCDate()}`.padStart(2, '0')}`;
type MonthWeek = { n: number; from: string; to: string; days: { name: string; iso: string }[] };
/** Semanas (dom→sáb) del mes dado (0-based). Los días se RECORTAN al mes: la
 *  primera y última semana solo muestran los días que caen dentro del mes, así
 *  no aparecen fechas de otro mes. Numeradas 1..N. */
function weeksOfMonth(year: number, month0: number): MonthWeek[] {
  const first = new Date(Date.UTC(year, month0, 1));
  const last = new Date(Date.UTC(year, month0 + 1, 0));
  // Domingo en/antes del día 1 (getUTCDay: 0=domingo).
  const start = new Date(first);
  start.setUTCDate(first.getUTCDate() - first.getUTCDay());
  const weeks: MonthWeek[] = [];
  let cur = start;
  let n = 0;
  while (cur <= last) {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(cur);
      d.setUTCDate(cur.getUTCDate() + i);
      return { name: DIAS_SEMANA[i], iso: isoUTC(d), inMonth: d.getUTCMonth() === month0 && d.getUTCFullYear() === year };
    }).filter((d) => d.inMonth).map(({ name, iso }) => ({ name, iso }));
    if (days.length) {
      n += 1;
      weeks.push({ n, from: days[0].iso, to: days[days.length - 1].iso, days });
    }
    const nx = new Date(cur);
    nx.setUTCDate(cur.getUTCDate() + 7);
    cur = nx;
  }
  return weeks;
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
  /* Forzar impresión de fondos de color (encabezados azules) al guardar/imprimir PDF. */
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:Tahoma,Geneva,Verdana,sans-serif;color:#333;padding:0;background:#fff}
  /* En pantalla (vista previa) el documento se ve como una hoja blanca con márgenes. */
  @media screen{ body{ padding:28px 34px } }
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
// Categoría de equipo para el "Conteo de equipos": agrupa por tipo real leyendo el
// nombre/código. Las categorías pedidas se detectan por palabras clave; el resto
// queda por la primera palabra del código (p. ej. PAYLOADER, RETROEXCAVADORA…).
function equipCategory(code: string): string {
  const c = (code || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (c.includes('volteo') || c.includes('toronto')) return 'CAMIÓN VOLTEO - TORONTO';
  if (c.includes('pitman')) return 'PITMAN';
  if (c.includes('jumbo')) return 'JUMBO';
  if (c.includes('oruga')) return 'TRACTORES DE ORUGA';
  if (c.includes('lowboy') || c.includes('low boy')) return 'CHUTO CON LOWBOY';
  if (c.includes('batea')) return 'CHUTO CON BATEA';
  if (c.includes('volqueta')) return 'CHUTO CON VOLQUETA';
  if (c.includes('cisterna') && c.includes('agua')) return 'CISTERNA DE AGUA';
  if (c.includes('cisterna') && (c.includes('diesel') || c.includes('gasoil'))) return 'CISTERNA DE DIESEL';
  if (c.includes('plataforma') && !c.includes('grua')) return 'CAMIÓN PLATAFORMA';
  return ((code || '').trim().split(/\s+/)[0] || '—').toUpperCase();
}

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
      <div class="company"><b>${COMPANY_NAME}</b><br/>Sistema de control interno</div>
    </div>
    ${body}
    <div class="foot">${COMPANY_NAME} · Documento generado por el sistema de control interno</div>
  </body></html>`;
}

// ── Reporte "Despliegue de Maquinaria" (infográfico apaisado, mismo diseño que
//    el resumen operativo). Se imprime a PDF en láminas 1280×720 (landscape).
type DeployData = {
  periodLabel: string;
  byCo: { company: string; count: number; hours: number }[];
  byTp: { tipo: string; count: number; hours: number }[];
  inact: { code: string; serial: string; tipo: string; company: string }[];
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
  @page { size: 15in 9.1in; margin: 2cm; }
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
  table.emp.tight td { padding:8px 12px; font-size:14px; }
  table.emp.tight tfoot td { padding-top:10px; font-size:15px; }
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
    <div class="brand"><img src="${LOGO_DATA_URI}" alt="logo"/><div><div class="co">${COMPANY_NAME}</div></div></div>
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
    <thead><tr><th>Clasificación</th><th class="tnum">Eq.</th><th>Horas</th></tr></thead>
    <tbody>
${arr.map((t) => `    <tr>
      <td class="tname">${t.tipo}</td>
      <td class="tnum">${t.count}</td>
      <td class="thrs"><span class="mini"><span style="width:${t.hours > 0 ? Math.max(6, (t.hours / maxTp) * 100) : 0}%"></span></span>${fmtMiles(t.hours)} h</td>
    </tr>`).join('\n')}</tbody></table>`;
  const slide3 = `<section class="slide"><div class="pad">
${header()}
  <div class="stitle-row" style="margin-top:20px">
    <h2 class="stitle">Capacidad por <span class="accent">Clasificación</span></h2>
    <span class="hint">${totals.tipos} clasificaciones · nº = equipos · barra = horas</span>
  </div>
  <div class="tcols">${tpTable(byTp.slice(0, half))}${tpTable(byTp.slice(half))}</div>
  <div class="foot"><span class="sys">${sys}</span><span>Total: ${totals.equipos} equipos · ${fmtMiles(totals.horas)} h</span></div>
</div></section>`;
  const inRows = inact.map((m, i) => `    <tr>
      <td class="rank">${i + 1}</td>
      <td class="name">${m.code}</td>
      <td class="num" style="text-align:left;width:auto;font-weight:700;font-variant-numeric:tabular-nums">${m.serial || '—'}</td>
      <td class="num" style="text-align:left;width:auto;font-weight:600">${m.tipo}</td>
      <td class="num" style="text-align:left;width:auto;font-weight:700;color:var(--navy)">${m.company}</td>
    </tr>`).join('\n');
  const slide4 = `<section class="slide"><div class="pad">
${header()}
  <div class="stitle-row" style="margin-top:16px">
    <h2 class="stitle">Equipos <span class="accent">Inactivos</span></h2>
    <span class="hint">${totals.inactivos} de ${totals.equipos} equipos · fuera de operación</span>
  </div>
  <table class="emp tight">
    <thead><tr><th></th><th>Equipo</th><th style="text-align:left">Serial / Placa</th><th style="text-align:left">Tipo</th><th style="text-align:left">Empresa a la que pertenece</th></tr></thead>
    <tbody>
${inRows || '    <tr><td colspan="5" style="text-align:center;color:#6b7280">Sin equipos inactivos</td></tr>'}</tbody>
    <tfoot><tr><td></td><td>TOTAL INACTIVOS</td><td class="num">${totals.inactivos}</td><td></td><td></td></tr></tfoot>
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
        <Text style={{ color: colors.muted, fontSize: 11 }}>{COMPANY_NAME}</Text>
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
  const [mode, setMode] = useState<'fuel' | 'rounds' | 'fleet' | 'deploy' | 'camiones' | 'conteo'>('fuel');
  // Reporte "Conteo de equipos": cantidad por clasificación y por tipo + totales de estado.
  type ConteoRow = { name: string; count: number; conHoras: number; sinHoras: number };
  type ConteoMachine = { code: string; serial: string | null; clas: string };
  const [conteo, setConteo] = useState<{ byClas: ConteoRow[]; byTipo: ConteoRow[]; total: number; conHoras: number; sinHoras: number; activos: number; inactivos: number; standby: number; sinList: ConteoMachine[] } | null>(null);
  const [conteoPreview, setConteoPreview] = useState(false);
  // Filtro del conteo: todos / solo con horas / solo sin horas (botones).
  const [conteoFilter, setConteoFilter] = useState<'todos' | 'con' | 'sin'>('todos');
  // Reporte "Control camiones Entradas/Salidas" (por mes → semanas dom→sáb).
  const nowRef = new Date();
  const [camYear, setCamYear] = useState(nowRef.getFullYear());
  const [camMonth0, setCamMonth0] = useState(nowRef.getMonth());
  const [camPreview, setCamPreview] = useState(false);
  const [camData, setCamData] = useState<{ monthLabel: string; weeks: MonthWeek[]; companies: { company: string; items: { code: string; plate: string | null; serial: string | null }[] }[] } | null>(null);
  const [roundGroups, setRoundGroups] = useState<RoundCompany[]>([]);
  const [roundsPreview, setRoundsPreview] = useState(false);
  const [roundsCompany, setRoundsCompany] = useState<string | null>(null); // empresa seleccionada (sincronía con Control)
  const [companyList, setCompanyList] = useState<string[]>([]); // empresas para el selector del reporte
  const [companyRif, setCompanyRif] = useState<Record<string, string>>({}); // nombre → RIF (para imprimir en reportes)
  const [typeList, setTypeList] = useState<string[]>([]); // tipos de maquinaria para el filtro
  const [fleetTypes, setFleetTypes] = useState<string[]>([]); // tipos marcados (vacío = todos)
  // Empresas marcadas para filtrar CUALQUIER reporte (vacío = todas / general).
  const [repCompanies, setRepCompanies] = useState<string[]>([]);
  // Estado de la flota (para el bloque final del informe por jornada).
  const [fleetStatus, setFleetStatus] = useState<{ total: number; operativa: number; transito: number; inactivos: number; totalFlota: number }>({ total: 0, operativa: 0, transito: 0, inactivos: 0, totalFlota: 0 });
  const [fleetItems, setFleetItems] = useState<FleetItem[]>([]);
  const [fleetFletes, setFleetFletes] = useState<{ company: string; viajes: number; usd: number }[]>([]);
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
    // Orden ALFABÉTICO por empresa (así se ve en el sistema y en los reportes).
    return Array.from(m.values()).sort((a, b) => a.company.localeCompare(b.company, 'es', { sensitivity: 'base' }));
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
      'round_date, day_hours, night_hours, hours_stopped, overtime_hours, frozen_price, machinery:machinery_id(id, code, serial, tipo, clasificacion, entry_date, price_per_hour, company:company_id(name))',
      (q) => q.gte('round_date', fromArg).lte('round_date', toArg)
    );
    // Primer paso: por (máquina única, fecha) tomamos el máximo (dedupe de rondas).
    // Cada fecha guarda el precio EFECTIVO de esa ronda: si la ronda está cerrada trae
    // frozen_price (precio congelado del corte); si no, el precio actual de la máquina.
    // Así un corte cerrado se reporta con SUS precios aunque después cambien.
    type Acc = { machine: string; tipo: string; clasificacion: string; serial: string | null; entry: string | null; company: string; price: number | null; byDate: Map<string, { d: number; n: number; s: number; o: number; price: number | null }> };
    const accs = new Map<string, Acc>();
    (data ?? []).forEach((r: any) => {
      const mm = r.machinery || {};
      const key = (mm.id || mm.serial || mm.code) as string;
      const a = accs.get(key) ?? {
        machine: mm.code ?? '—',
        tipo: (mm.tipo && String(mm.tipo).trim()) || '—',
        clasificacion: (mm.clasificacion && String(mm.clasificacion).trim()) || 'Sin clasificación',
        serial: mm.serial ?? null,
        entry: mm.entry_date ?? null,
        company: mm.company?.name ?? 'Sin empresa',
        price: mm.price_per_hour != null ? Number(mm.price_per_hour) : null,
        byDate: new Map(),
      };
      const cur = a.byDate.get(r.round_date) ?? { d: 0, n: 0, s: 0, o: 0, price: null };
      cur.d = Math.max(cur.d, Number(r.day_hours) || 0);
      cur.n = Math.max(cur.n, Number(r.night_hours) || 0);
      cur.s = Math.max(cur.s, Number(r.hours_stopped) || 0);
      cur.o = Math.max(cur.o, Number(r.overtime_hours) || 0);
      // Precio efectivo de la ronda: congelado si la ronda está cerrada; si no, el actual.
      // Un frozen_price 0 (o nulo) NO es un precio válido: cae al precio actual de la máquina.
      cur.price = r.frozen_price != null && Number(r.frozen_price) > 0 ? Number(r.frozen_price) : (mm.price_per_hour != null ? Number(mm.price_per_hour) : null);
      a.byDate.set(r.round_date, cur);
      accs.set(key, a);
    });
    // Segundo paso: agrupar por empresa → máquina con totales.
    // Horas trabajadas = día + noche − parada + extras (igual que el reporte de Maquinaria),
    // por eso restamos paradas: así Jornada y Maquinaria cuadran con el Excel.
    const groups = new Map<string, RoundCompany>();
    accs.forEach((a) => {
      if (cos && !cos.includes(a.company)) return; // filtro por empresa(s)
      let dayH = 0, nightH = 0, totalH = 0, days = 0, totalUSD = 0, repPrice: number | null = null;
      a.byDate.forEach(({ d, n, s, o, price }) => {
        const w = workedFromShifts(d, n, s, o);
        dayH += d; nightH += n; totalH += w;
        if (w > 0) days += 1; // solo jornadas con horas trabajadas > 0
        // Monto por ronda con SU precio efectivo (congelado o actual); así los cortes
        // cerrados suman con sus precios aunque el precio de la máquina haya cambiado.
        const p = price != null ? price : a.price;
        if (p != null) { totalUSD += (w / 12) * p; if (w > 0) repPrice = p; }
      });
      if (totalH <= 0) return; // solo equipos que SÍ trabajaron (nada en 0)
      const rm: RoundMachine = { machine: a.machine, tipo: a.tipo, clasificacion: a.clasificacion, serial: a.serial, entryDate: a.entry, days, dayH, nightH, totalH, priceJornada: repPrice != null ? repPrice : a.price, totalUSD };
      const g = groups.get(a.company) ?? { company: a.company, machines: [], days: 0, dayH: 0, nightH: 0, totalH: 0, totalUSD: 0, viajes: [], viajesUSD: 0 };
      g.machines.push(rm);
      g.days += days; g.dayH += dayH; g.nightH += nightH; g.totalH += totalH; g.totalUSD += totalUSD;
      groups.set(a.company, g);
    });
    // Fletes/viajes CON FECHA: solo los del rango del informe (así aparecen únicamente
    // en la semana en que ocurrieron). Se suman como extra al subtotal por empresa.
    const fletesRows = await selectAllRows(
      'fletes',
      'code, viajes, precio, flete_date, company:company_id(name)',
      (q) => q.gte('flete_date', fromArg).lte('flete_date', toArg)
    );
    (fletesRows ?? []).forEach((f: any) => {
      const co = f.company?.name ?? 'Sin empresa';
      if (cos && !cos.includes(co)) return;
      const g = groups.get(co);
      if (!g) return; // solo si la empresa aparece en el informe
      const v = Number(f.viajes) || 0;
      const precio = Number(f.precio) || 0;
      if (v <= 0) return;
      g.viajes.push({ code: f.code || '—', clasificacion: '—', viajes: v, precio });
      g.viajesUSD += v * precio;
    });
    const list = Array.from(groups.values()).sort((x, y) =>
      x.company === 'Sin empresa' ? 1 : y.company === 'Sin empresa' ? -1 : x.company.localeCompare(y.company)
    );
    // Alfabético por NOMBRE de máquina (acentos/mayúsculas indiferentes), luego serial.
    list.forEach((g) => g.machines.sort((x, y) =>
      x.machine.localeCompare(y.machine, 'es', { sensitivity: 'base' }) ||
      String(x.serial ?? '').localeCompare(String(y.serial ?? ''), 'es', { sensitivity: 'base' })
    ));

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
    // Bloque de VIAJES por empresa: agrupa por precio unitario y detalla las máquinas.
    // Se suma al subtotal para dar el "TOTAL POR PAGAR" (ej.: Golden Touch).
    const renderViajes = (g: RoundCompany): string => {
      if (!g.viajes.length) return '';
      const byPrice = new Map<number, ViajeItem[]>();
      g.viajes.forEach((v) => { const a = byPrice.get(v.precio) ?? []; a.push(v); byPrice.set(v.precio, a); });
      const groupRows = [...byPrice.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([precio, items]) => {
          const totViajes = items.reduce((s, v) => s + v.viajes, 0);
          // Detalle por tipo de equipo (primera palabra del nombre): "2 JUMBO · 1 PAYLOADER".
          const kinds = new Map<string, number>();
          items.forEach((v) => { const k = (v.code.split(/\s+/)[0] || v.code).toUpperCase(); kinds.set(k, (kinds.get(k) ?? 0) + 1); });
          const detalle = [...kinds.entries()].map(([k, n]) => `${n} ${esc(k)}`).join(' · ');
          const monto = totViajes * precio;
          return `<tr><td style="padding:4px 8px">TOTAL POR <b>${totViajes}</b> VIAJE${totViajes === 1 ? '' : 'S'}: ${detalle} <span style="color:#666">(${usd(precio)} c/u)</span></td><td style="text-align:right;font-weight:700;padding:4px 8px">${usd(monto)}</td></tr>`;
        })
        .join('');
      const totalPagar = g.totalUSD + g.viajesUSD;
      return `<table style="margin-top:-4px;margin-bottom:10px"><tbody>${groupRows}
        <tr><td style="text-align:right;font-weight:800;background:#1E3A5F;color:#fff;padding:6px 8px">TOTAL POR PAGAR ${esc(g.company)}</td><td style="text-align:right;font-weight:800;background:#1E3A5F;color:#fff;padding:6px 8px">${usd(totalPagar)}</td></tr>
      </tbody></table>`;
    };
    const head = `<tr><th style="text-align:left">Máquina</th><th style="text-align:left">Marca/Modelo</th><th style="text-align:left">Clasificación</th><th>📅 Llegada</th><th>Días</th><th>☀️ H. Día</th><th>🌙 H. Noche</th><th>Total horas</th><th>Precio/hora</th><th>Total $</th></tr>`;
    const sections = roundGroups
      .map((g) => {
        const rows = g.machines
          .map(
            (m) =>
              `<tr><td>${esc(m.machine)}${m.serial ? `<br/><span style="color:#888">${esc(m.serial)}</span>` : ''}</td>` +
              `<td>${esc(m.tipo)}</td>` +
              `<td>${esc(m.clasificacion)}</td>` +
              `<td style="text-align:center">${m.entryDate ? fmtDMY(m.entryDate) : '—'}</td>` +
              `<td style="text-align:center">${m.days}</td>` +
              `<td style="text-align:center">${nH(m.dayH)}</td>` +
              `<td style="text-align:center">${nH(m.nightH)}</td>` +
              `<td style="text-align:center;font-weight:700">${nH(m.totalH)}</td>` +
              `<td style="text-align:right">${m.priceJornada != null ? usd(m.priceJornada / 12) : '—'}</td>` +
              `<td style="text-align:right;font-weight:700">${m.priceJornada != null ? usd(m.totalUSD) : '—'}</td></tr>`
          )
          .join('');
        // Bloque de VIAJES (extra al subtotal). Agrupa las máquinas por precio unitario.
        const viajesBlock = renderViajes(g);
        return `<h2>🏢 ${esc(g.company)}${companyRif[g.company] ? ` <span style="color:#666;font-weight:400;font-size:13px">· RIF ${esc(companyRif[g.company])}</span>` : ''} <span style="color:#666;font-weight:400">(${g.machines.length} máquina${g.machines.length === 1 ? '' : 's'})</span></h2>
          <table><thead>${head}</thead><tbody>${rows}</tbody>
          <tfoot><tr><td colspan="5" style="text-align:right;font-weight:800">${g.viajes.length ? 'SUB TOTAL' : 'TOTAL'} ${esc(g.company)}</td>
            <td style="text-align:center;font-weight:800">${nH(g.dayH)}</td>
            <td style="text-align:center;font-weight:800">${nH(g.nightH)}</td>
            <td style="text-align:center;font-weight:800">${nH(g.totalH)}</td>
            <td></td><td style="text-align:right;font-weight:800">${usd(g.totalUSD)}</td></tr></tfoot></table>${viajesBlock}`;
      })
      .join('');
    const grandViajes = roundGroups.reduce((s, g) => s + g.viajesUSD, 0);
    const grandUSD = roundGroups.reduce((s, g) => s + g.totalUSD, 0) + grandViajes;
    const grandH = roundGroups.reduce((s, g) => s + g.totalH, 0);
    const grandMachines = roundGroups.reduce((s, g) => s + g.machines.length, 0);
    // ── Reporte general (mismo bloque que el reporte de maquinaria): resumen de
    // equipos por CLASIFICACIÓN y por EMPRESA (horas × precio). No incluye fletes.
    const phStr = (amount: number, worked: number) => (worked > 0 ? usd(amount / worked) : '—');
    const clasAgg = new Map<string, { count: number; worked: number; amount: number }>();
    roundGroups.forEach((g) =>
      g.machines.forEach((m) => {
        const key = m.clasificacion || 'Sin clasificación';
        const a = clasAgg.get(key) ?? { count: 0, worked: 0, amount: 0 };
        a.count += 1; a.worked += m.totalH; a.amount += m.priceJornada != null ? m.totalUSD : 0;
        clasAgg.set(key, a);
      })
    );
    const genWorked = roundGroups.reduce((s, g) => s + g.totalH, 0);
    const genAmount = roundGroups.reduce((s, g) => s + g.totalUSD, 0);
    const genEquipos = grandMachines;
    const clasRows = [...clasAgg.entries()]
      .sort((a, b) => (b[1].count - a[1].count) || a[0].localeCompare(b[0]))
      .map(([clas, a]) => `<tr><td>${esc(clas)}</td><td style="text-align:right;font-weight:700">${a.count}</td><td style="text-align:right">${nH(a.worked)}</td><td style="text-align:right">${phStr(a.amount, a.worked)}</td><td style="text-align:right;font-weight:700">${usd(a.amount)}</td></tr>`)
      .join('');
    const empRows = roundGroups
      .map((g) => `<tr><td>${esc(g.company)}</td><td style="text-align:right;font-weight:700">${g.machines.length}</td><td style="text-align:right">${nH(g.totalH)}</td><td style="text-align:right">${phStr(g.totalUSD, g.totalH)}</td><td style="text-align:right;font-weight:700">${usd(g.totalUSD)}</td></tr>`)
      .join('');
    const generalBlockJ = `
      <h2 style="margin-top:20px">Reporte general</h2>
      <h3 style="margin:12px 0 2px">Total por clasificación</h3>
      <table><thead><tr><th style="text-align:left">Clasificación</th><th style="text-align:right">Cantidad</th><th style="text-align:right">Horas</th><th style="text-align:right">Precio/hora</th><th style="text-align:right">Total a pagar</th></tr></thead>
      <tbody>${clasRows || '<tr><td colspan="5" style="text-align:center">Sin datos</td></tr>'}</tbody>
      <tfoot><tr><td style="text-align:right">TOTAL</td><td style="text-align:right">${genEquipos}</td><td style="text-align:right">${nH(genWorked)}</td><td style="text-align:right">${phStr(genAmount, genWorked)}</td><td style="text-align:right">${usd(genAmount)}</td></tr></tfoot></table>
      <h3 style="margin:12px 0 2px">Totales de equipos por empresa</h3>
      <table><thead><tr><th style="text-align:left">Empresa</th><th style="text-align:right">Equipos</th><th style="text-align:right">Horas</th><th style="text-align:right">Precio/hora</th><th style="text-align:right">Total a pagar</th></tr></thead>
      <tbody>${empRows || '<tr><td colspan="5" style="text-align:center">Sin datos</td></tr>'}</tbody>
      <tfoot><tr><td style="text-align:right">TOTAL</td><td style="text-align:right">${genEquipos}</td><td style="text-align:right">${nH(genWorked)}</td><td style="text-align:right">${phStr(genAmount, genWorked)}</td><td style="text-align:right">${usd(genAmount)}</td></tr></tfoot></table>
      <p class="muted" style="margin-top:6px">Resumen de equipos (horas × precio). No incluye fletes/viajes; ver el detalle por empresa.</p>`;
    const content = `
      <div class="muted">Informe por jornada · del ${fmtDMY(from)} al ${fmtDMY(to)}${roundsCompany ? ` · Empresa: ${roundsCompany}` : ''}</div>
      ${generalBlockJ}
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
    // Nombre del archivo: "Reporte EMPRESA del DD al DD". Si es de una sola empresa lleva su
    // nombre; siempre incluye el rango de fechas.
    const rng = dateRangeLabel(from, to);
    const jornadaFile = roundsCompany ? `Reporte ${roundsCompany} ${rng}` : `Reporte por jornada ${rng}`;
    await exportPdf(pdfShell('INFORME POR JORNADA', 'Por empresa y maquinaria', content), jornadaFile);
  };

  const generateFleet = async () => {
    setLoading(true);
    const [{ data: mach }, { data: vehs }, { data: disp }, rnds] = await Promise.all([
      supabase.from('machinery').select('id, code, description, plate, machinery_type, tipo, clasificacion, referencia, price_per_hour, company:company_id(name)'),
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
    // Guardia/militar actual de cada máquina, para mostrarlo en el reporte.
    const guardMap = await fetchActiveGuards((mach ?? []).map((m: any) => m.id));
    const items: FleetItem[] = [];
    (mach ?? []).forEach((m: any) => {
      const worked = mHours.get(m.id) ?? 0;
      const price = m.price_per_hour != null ? Number(m.price_per_hour) : 0;
      const gd = guardMap[m.id];
      items.push({
        name: m.code,
        desc: m.description || '—',
        plate: m.plate,
        kind: m.machinery_type || 'maquinaria',
        marcaModelo: (m.tipo && String(m.tipo).trim()) || '—',
        // El reporte de maquinaria agrupa/filtra por CLASIFICACIÓN (no por modelo).
        tipo: canonTipo(m.clasificacion) || 'Sin clasificación',
        referencia: m.referencia || null,
        company: m.company?.name || 'Sin empresa',
        liters: mLit.get(m.id) ?? 0,
        worked,
        amount: (worked / 12) * price,
        pricePerHour: price / 12,
        guard: gd ? `${gd.rank ? gd.rank + ' ' : ''}${gd.guard_name}` : null,
      });
    });
    (vehs ?? []).forEach((v: any) =>
      items.push({
        name: v.plate,
        desc: [v.brand, v.model].filter(Boolean).join(' ') || '—',
        plate: v.plate,
        kind: 'vehiculo',
        marcaModelo: [v.brand, v.model].filter(Boolean).join(' ') || '—',
        tipo: 'Vehículo',
        referencia: null,
        company: 'Vehículos',
        liters: vLit.get(v.id) ?? 0,
        worked: 0,
        amount: 0,
        pricePerHour: 0,
        guard: null,
      })
    );
    const filtered = items.filter(
      (it) => (repCompanies.length === 0 || repCompanies.includes(it.company)) && (fleetTypes.length === 0 || fleetTypes.includes(it.tipo))
    );
    setFleetItems(filtered);
    // Fletes/viajes del rango, por empresa (para mostrar el flete también aquí).
    const fletesRows = await selectAllRows('fletes', 'viajes, precio, flete_date, company:company_id(name)', (q) => q.gte('flete_date', from).lte('flete_date', to));
    const flByCo = new Map<string, { company: string; viajes: number; usd: number }>();
    (fletesRows ?? []).forEach((f: any) => {
      const co = f.company?.name ?? 'Sin empresa';
      if (repCompanies.length && !repCompanies.includes(co)) return;
      const v = Number(f.viajes) || 0;
      const precio = Number(f.precio) || 0;
      if (v <= 0) return;
      const a = flByCo.get(co) ?? { company: co, viajes: 0, usd: 0 };
      a.viajes += v; a.usd += v * precio;
      flByCo.set(co, a);
    });
    setFleetFletes([...flByCo.values()].sort((a, b) => a.company.localeCompare(b.company)));
    setLoading(false);
    setFleetPreview(true);
  };

  // Reporte "Despliegue de Maquinaria": genera el infográfico (4 láminas) con
  // datos EN VIVO del rango — horas trabajadas y equipos activos/inactivos.
  const generateDeploy = async () => {
    setLoading(true);
    const [{ data: mach }, rnds] = await Promise.all([
      supabase.from('machinery').select('id, code, tipo, clasificacion, active, serial, plate, company:company_id(name)'),
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
      serial: (m.serial || m.plate || '') as string,
      tipo: canonTipo(m.tipo) || 'SIN TIPO',
      clas: canonTipo(m.clasificacion) || 'SIN CLASIFICACIÓN',
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
    // Agregado por CLASIFICACIÓN (lámina 3 "Capacidad por Clasificación").
    const tpMap = new Map<string, { tipo: string; count: number; hours: number }>();
    list.forEach((m) => { const a = tpMap.get(m.clas) ?? { tipo: m.clas, count: 0, hours: 0 }; a.count++; a.hours += m.hours; tpMap.set(m.clas, a); });
    const byTp = [...tpMap.values()].sort((a, b) => b.hours - a.hours || b.count - a.count);
    // Inactivos con su empresa.
    const inact = list
      .filter((m) => !m.active)
      .sort((a, b) => a.company.localeCompare(b.company) || a.code.localeCompare(b.code))
      .map((m) => ({ code: m.code, serial: m.serial, tipo: m.tipo, company: m.company }));
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
    await exportPdf(html, 'Reportes - Despliegue');
  };

  // ── Reporte "Conteo de equipos" ─────────────────────────────────────────────
  // Cantidad de equipos del catálogo por CLASIFICACIÓN (REMOCIÓN Y EXCAVACIÓN 70…)
  // y por TIPO de equipo (JUMBO, RETROEXCAVADORA…), con totales de estado al final.
  const generateConteo = async () => {
    setLoading(true);
    const mach = await selectAllRows('machinery', 'id, code, serial, clasificacion, active, operational, en_espera');
    const list = (mach ?? []) as any[];
    // Horas trabajadas por máquina (todas las jornadas registradas). Dedupe por máquina+día.
    const rnds = await selectAllRows('machine_rounds', 'machinery_id, round_date, day_hours, night_hours, hours_stopped, overtime_hours');
    const byMD = new Map<string, any>();
    (rnds ?? []).forEach((r: any) => byMD.set(`${r.machinery_id}|${r.round_date}`, r));
    const hoursByMachine = new Map<string, number>();
    byMD.forEach((r) => {
      const w = workedFromShifts(Number(r.day_hours ?? 0), Number(r.night_hours ?? 0), Number(r.hours_stopped ?? 0), Number(r.overtime_hours ?? 0));
      if (w > 0) hoursByMachine.set(r.machinery_id, (hoursByMachine.get(r.machinery_id) ?? 0) + w);
    });
    const clasMap = new Map<string, ConteoRow>();
    const tipoMap = new Map<string, ConteoRow>();
    list.forEach((m) => {
      const tieneHoras = (hoursByMachine.get(m.id) ?? 0) > 0;
      const ck = (m.clasificacion && String(m.clasificacion).trim()) || 'Sin clasificación';
      const tk = equipCategory(m.code);
      const cc = clasMap.get(ck) ?? { name: ck, count: 0, conHoras: 0, sinHoras: 0 }; cc.count += 1; if (tieneHoras) cc.conHoras += 1; else cc.sinHoras += 1; clasMap.set(ck, cc);
      const tt = tipoMap.get(tk) ?? { name: tk, count: 0, conHoras: 0, sinHoras: 0 }; tt.count += 1; if (tieneHoras) tt.conHoras += 1; else tt.sinHoras += 1; tipoMap.set(tk, tt);
    });
    const byClas = [...clasMap.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const byTipo = [...tipoMap.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const conHoras = list.filter((m) => (hoursByMachine.get(m.id) ?? 0) > 0).length;
    const sinHoras = list.length - conHoras;
    // Listado de máquinas SIN horas (para mostrarlo tal cual, sin agrupar).
    const sinList: ConteoMachine[] = list
      .filter((m) => (hoursByMachine.get(m.id) ?? 0) <= 0)
      .map((m) => ({ code: m.code ?? '—', serial: m.serial ?? null, clas: (m.clasificacion && String(m.clasificacion).trim()) || 'Sin clasificación' }))
      .sort((a, b) => a.code.localeCompare(b.code));
    // Estado: stand by (en espera) tiene prioridad; luego inactivo (active/operational false); el resto, activo.
    const standby = list.filter((m) => m.en_espera === true).length;
    const inactivos = list.filter((m) => m.en_espera !== true && (m.active === false || m.operational === false)).length;
    const activos = list.length - standby - inactivos;
    setConteo({ byClas, byTipo, total: list.length, conHoras, sinHoras, activos, inactivos, standby, sinList });
    setLoading(false);
    setConteoPreview(true);
  };

  const downloadConteoPdf = async () => {
    if (!conteo) return;
    const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const cnt = (r: ConteoRow) => (conteoFilter === 'con' ? r.conHoras : conteoFilter === 'sin' ? r.sinHoras : r.count);
    const totalCnt = conteoFilter === 'con' ? conteo.conHoras : conteoFilter === 'sin' ? conteo.sinHoras : conteo.total;
    const colHead = conteoFilter === 'con' ? 'Con horas' : conteoFilter === 'sin' ? 'Sin horas' : 'Cantidad';
    const filtroTxt = conteoFilter === 'con' ? ' · solo equipos CON horas' : conteoFilter === 'sin' ? ' · solo equipos SIN horas' : '';
    const rowsFor = (arr: ConteoRow[]) => arr.filter((r) => cnt(r) > 0 || conteoFilter === 'todos').map((r) => `<tr><td>${esc(r.name)}</td><td style="text-align:right;font-weight:700">${cnt(r)}</td></tr>`).join('');
    // En "Sin horas" no se cuenta/agrupa: se lista cada máquina.
    const sinListHtml = `
      <h2 style="font-size:14px;color:#1E3A5F;margin-bottom:2px">Máquinas sin horas (${conteo.sinList.length})</h2>
      <table class="cnt"><thead><tr><th style="width:34px">#</th><th>Máquina</th><th>Serial</th><th>Clasificación</th></tr></thead>
        <tbody>${conteo.sinList.map((m, i) => `<tr><td>${i + 1}</td><td style="font-weight:700">${esc(m.code)}</td><td>${esc(m.serial ?? '—')}</td><td>${esc(m.clas)}</td></tr>`).join('')}</tbody></table>`;
    const tablasHtml = `
      <h2 style="font-size:14px;color:#1E3A5F;margin-bottom:2px">Cantidad de equipos por clasificación${filtroTxt}</h2>
      <table class="cnt"><thead><tr><th>Clasificación</th><th style="text-align:right">${colHead}</th></tr></thead>
        <tbody>${rowsFor(conteo.byClas)}</tbody>
        <tfoot><tr><td>TOTAL</td><td style="text-align:right">${totalCnt}</td></tr></tfoot></table>
      <h2 style="font-size:14px;color:#1E3A5F;margin-bottom:2px">Cantidad de equipos por tipo${filtroTxt}</h2>
      <table class="cnt"><thead><tr><th>Tipo de equipo</th><th style="text-align:right">${colHead}</th></tr></thead>
        <tbody>${rowsFor(conteo.byTipo)}</tbody>
        <tfoot><tr><td>TOTAL</td><td style="text-align:right">${totalCnt}</td></tr></tfoot></table>`;
    const body = `
      <style>
        table.cnt{width:100%;border-collapse:collapse;margin:6px 0 16px;font-size:12px}
        table.cnt th,table.cnt td{border:1px solid #ccc;padding:6px 10px;text-align:left}
        table.cnt th{background:#1E3A5F;color:#fff}
        table.cnt tfoot td{background:#EEF2F7;font-weight:800}
        .estado{display:flex;gap:12px;margin-top:10px}
        .estado .c{flex:1;border:1px solid #E5E7EB;border-radius:10px;padding:12px;text-align:center}
        .estado .c .v{font-size:24px;font-weight:800}
        .estado .c .k{font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:.5px;margin-top:2px}
        .estado .act{background:#ECFDF5;border-color:#A7F3D0}.estado .act .v{color:#059669}
        .estado .ina{background:#FEF2F2;border-color:#FECACA}.estado .ina .v{color:#DC2626}
        .estado .stb{background:#FFFBEB;border-color:#FDE68A}.estado .stb .v{color:#B45309}
        .estado .hrs{background:#EFF6FF;border-color:#BFDBFE}.estado .hrs .v{color:#1E3A5F}
      </style>
      ${conteoFilter === 'sin' ? sinListHtml : tablasHtml}
      <h2 style="font-size:14px;color:#1E3A5F;margin-bottom:2px">Estado de la flota</h2>
      <div class="estado">
        <div class="c act"><div class="v">${conteo.activos}</div><div class="k">Activos</div></div>
        <div class="c ina"><div class="v">${conteo.inactivos}</div><div class="k">Inactivos</div></div>
        <div class="c stb"><div class="v">${conteo.standby}</div><div class="k">Stand by</div></div>
        <div class="c"><div class="v">${conteo.total}</div><div class="k">Total equipos</div></div>
        <div class="c hrs"><div class="v">${conteo.conHoras}</div><div class="k">Con horas</div></div>
        <div class="c stb"><div class="v">${conteo.sinHoras}</div><div class="k">Sin horas</div></div>
      </div>`;
    await exportPdf(pdfShell('CONTEO DE EQUIPOS', 'Cantidad de equipos por clasificación y por tipo', body), 'Reportes - Conteo de equipos');
  };

  // Reporte "Control camiones Entradas/Salidas": camiones por empresa, por semana
  // (dom→sáb) del mes elegido. Hoja para registrar entrada/salida por día.
  // Trae y agrupa por empresa TODOS los camiones/transporte. Entran: camión, chuto (con
  // volqueta/batea/lowboy), volteo/toronto/volquetas y cisternas (agua o combustible).
  // Se busca en el NOMBRE (code), el modelo (tipo) y la clasificación, porque en muchas
  // máquinas el "modelo" viene vacío y el tipo real está en el nombre.
  const buildTruckCompanies = useCallback(async () => {
    const mach = await selectAllRows('machinery', 'code, plate, serial, tipo, clasificacion, company:company_id(name)');
    const TRUCK_RE = /CAMION|CHUTO|VOLQUETA|VOLTEO|TORONTO|CISTERNA|PIPA/;
    const trucks = (mach ?? [])
      .filter((m: any) => TRUCK_RE.test(`${m.code || ''} ${canonTipo(m.tipo) || ''} ${m.clasificacion || ''}`.toUpperCase()))
      .map((m: any) => ({ code: m.code as string, plate: (m.plate ?? null) as string | null, serial: (m.serial ?? null) as string | null, company: m.company?.name || 'Sin empresa' }))
      .sort((a, b) => a.company.localeCompare(b.company) || (a.code || '').localeCompare(b.code || ''));
    const map = new Map<string, { code: string; plate: string | null; serial: string | null }[]>();
    trucks.forEach((t) => { const a = map.get(t.company) ?? []; a.push({ code: t.code, plate: t.plate, serial: t.serial }); map.set(t.company, a); });
    return [...map.entries()].map(([company, items]) => ({ company, items }));
  }, []);

  const generateCamiones = async () => {
    setLoading(true);
    const companies = await buildTruckCompanies();
    setCamData({ monthLabel: `${MES_NOMBRES[camMonth0]} ${camYear}`, weeks: weeksOfMonth(camYear, camMonth0), companies });
    setLoading(false);
    setCamPreview(true);
  };

  // weekN: número de semana a imprimir; si es undefined, imprime todas.
  const downloadCamionesPdf = async (weekN?: number) => {
    if (!camData) return;
    const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const dayTh = (d: { name: string; iso: string }) => `<th class="d">${d.name.slice(0, 3).toUpperCase()}<br><span class="dt">${fmtDM(d.iso)}</span></th>`;
    const cell = `<td class="c"><div class="ln">S</div><div class="ln">E</div></td>`;
    const weeksToPrint = weekN == null ? camData.weeks : camData.weeks.filter((w) => w.n === weekN);
    const sel = weekN == null ? null : weeksToPrint[0] || null;
    const weeksHtml = weeksToPrint
      .map((w) => {
        const companiesHtml = camData.companies
          .map((co) => {
            const rows = co.items
              .map((t) => `<tr><td class="nm">${esc(t.code)}</td><td class="ps">${esc(t.plate || t.serial || '—')}</td>${w.days.map(() => cell).join('')}</tr>`)
              .join('');
            return `<h3 class="emp">🏢 ${esc(co.company)} — ${co.items.length} camión(es)</h3>
              <table class="cam"><thead><tr><th class="nm">Máquina</th><th class="ps">Placa/Serial</th>${w.days.map(dayTh).join('')}</tr></thead>
              <tbody>${rows || '<tr><td colspan="9" style="text-align:center">Sin camiones</td></tr>'}</tbody></table>`;
          })
          .join('');
        return `<h2 class="wk">Semana ${w.n} · del ${fmtDMY(w.from)} al ${fmtDMY(w.to)}</h2>${companiesHtml}`;
      })
      .join('');
    const body = `<style>
      .wk{background:#1E3A5F;color:#fff;font-size:13px;padding:7px 10px;border-radius:5px;margin:16px 0 6px}
      .emp{font-size:12px;color:#1E3A5F;font-weight:800;margin:10px 0 2px}
      table.cam{width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:6px}
      table.cam th,table.cam td{border:1px solid #bbb;padding:2px 2px;font-size:8px;line-height:1.05;overflow:hidden;word-break:break-word;vertical-align:middle}
      table.cam th{background:#1E3A5F;color:#fff;text-align:center}
      table.cam th.nm,table.cam td.nm{width:18%;text-align:left}
      table.cam th.ps,table.cam td.ps{width:15%;text-align:left}
      table.cam th.d,table.cam td.c{width:9.5%;text-align:center}
      .dt{font-weight:400;font-size:7px}
      table.cam td.c{height:34px;vertical-align:top}
      table.cam td.c .ln{border-bottom:1px solid #999;font-size:7px;color:#999;padding:1px 2px;height:15px;text-align:left}
    </style>
    <div class="muted">${esc(camData.monthLabel)}${sel ? ` · Semana ${sel.n} (del ${fmtDMY(sel.from)} al ${fmtDMY(sel.to)})` : ''} · Salida (S) y Entrada (E) por día — hoja para registrar</div>
    ${weeksHtml || '<p class="muted">Sin camiones registrados.</p>'}`;
    const subLabel = sel ? `${camData.monthLabel} · Semana ${sel.n}` : camData.monthLabel;
    const fileLabel = sel ? `Reportes - Camiones E-S Semana ${sel.n}` : 'Reportes - Camiones E-S';
    await exportPdf(pdfShell('CONTROL CAMIONES ENTRADAS/SALIDAS', subLabel, body), fileLabel);
  };

  const downloadFleetPdf = async (onlyCompany?: string, withPrices: boolean = true) => {
    const companies = onlyCompany ? fleetByCompany.filter((c) => c.company === onlyCompany) : fleetByCompany;
    const totalEquipos = companies.reduce((s, c) => s + c.count, 0);
    // Encabezados y celdas de precio se incluyen sólo si withPrices.
    const priceHead = withPrices ? '<th style="text-align:right">Precio/hora</th><th style="text-align:right">Total</th>' : '';
    // Fletes/viajes del rango, por empresa (solo con precios). Se suman al total a pagar.
    const fletesRows = withPrices
      ? await selectAllRows('fletes', 'code, viajes, precio, flete_date, company:company_id(name)', (q) => q.gte('flete_date', from).lte('flete_date', to))
      : [];
    const viajesByCo = new Map<string, { items: { code: string; viajes: number; precio: number }[]; usd: number }>();
    (fletesRows ?? []).forEach((f: any) => {
      const co = f.company?.name ?? 'Sin empresa';
      if (onlyCompany && co !== onlyCompany) return;
      if (!companies.some((c) => c.company === co)) return;
      const v = Number(f.viajes) || 0;
      const precio = Number(f.precio) || 0;
      if (v <= 0) return;
      const a = viajesByCo.get(co) ?? { items: [], usd: 0 };
      a.items.push({ code: f.code || '—', viajes: v, precio }); a.usd += v * precio;
      viajesByCo.set(co, a);
    });
    const grandViajes = [...viajesByCo.values()].reduce((s, a) => s + a.usd, 0);
    // Bloque de fletes de una empresa: agrupa por precio unitario y detalla los equipos.
    const renderFletes = (co: string): string => {
      const a = viajesByCo.get(co);
      if (!a || !a.items.length) return '';
      const byPrice = new Map<number, { code: string; viajes: number; precio: number }[]>();
      a.items.forEach((v) => { const arr = byPrice.get(v.precio) ?? []; arr.push(v); byPrice.set(v.precio, arr); });
      const rows = [...byPrice.entries()].sort((x, y) => x[0] - y[0]).map(([precio, items]) => {
        const tot = items.reduce((s, v) => s + v.viajes, 0);
        const kinds = new Map<string, number>();
        items.forEach((v) => { const k = (v.code.split(/\s+/)[0] || v.code).toUpperCase(); kinds.set(k, (kinds.get(k) ?? 0) + 1); });
        const detalle = [...kinds.entries()].map(([k, n]) => `${n} ${k}`).join(' · ');
        return `<tr><td style="padding:4px 8px">TOTAL POR <b>${tot}</b> VIAJE${tot === 1 ? '' : 'S'}: ${detalle} <span style="color:#666">($${money2(precio)} c/u)</span></td><td style="text-align:right;font-weight:700;padding:4px 8px">$${money2(tot * precio)}</td></tr>`;
      }).join('');
      return `<table style="margin-top:-4px;margin-bottom:4px"><tbody>${rows}</tbody></table>`;
    };
    const companyBlocks = companies
      .map((c) => {
        const machTot = c.items.reduce((s, i) => s + i.amount, 0);
        const fl = viajesByCo.get(c.company);
        const fletesBlock = withPrices && fl
          ? renderFletes(c.company) +
            `<table style="margin-bottom:12px"><tbody><tr><td style="text-align:right;font-weight:800;background:#1E3A5F;color:#fff;padding:6px 8px">TOTAL POR PAGAR ${c.company} (equipos + fletes)</td><td style="text-align:right;font-weight:800;background:#1E3A5F;color:#fff;padding:6px 8px">$${money2(machTot + fl.usd)}</td></tr></tbody></table>`
          : '';
        return `<h3 style="margin:12px 0 2px">${c.company}${companyRif[c.company] ? ` <span style="color:#666;font-weight:400;font-size:12px">· RIF ${companyRif[c.company]}</span>` : ''} — ${c.count} equipo(s)</h3>` +
          `<table><thead><tr><th style="text-align:left">Equipo</th><th style="text-align:left">Marca/Modelo</th><th style="text-align:left">Clasificación</th><th style="text-align:left">Guardia</th><th style="text-align:right">Horas</th>${priceHead}</tr></thead><tbody>${c.items
            .map(
              (i) =>
                `<tr><td>${i.name}</td><td>${i.marcaModelo}</td><td>${i.tipo}</td><td>${i.guard ? '🪖 ' + i.guard : '—'}</td><td style="text-align:right">${i.worked} h</td>${withPrices ? `<td style="text-align:right">${i.pricePerHour ? '$' + money2(i.pricePerHour) : '—'}</td><td style="text-align:right;font-weight:700">${i.amount ? '$' + money2(i.amount) : '—'}</td>` : ''}</tr>`
            )
            .join('')}</tbody><tfoot><tr><td style="text-align:right" colspan="4">${fl ? 'SUB TOTAL' : 'TOTAL'} ${c.company}</td><td style="text-align:right;font-weight:700">${c.items.reduce((s, i) => s + i.worked, 0)} h</td>${withPrices ? `<td></td><td style="text-align:right;font-weight:700">$${money2(machTot)}</td>` : ''}</tr></tfoot></table>${fletesBlock}`;
      })
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
      <h3 style="margin:12px 0 2px">Total por clasificación</h3>
      <table><thead><tr><th style="text-align:left">Clasificación</th><th style="text-align:right">Cantidad</th><th style="text-align:right">Horas</th>${genPriceHead}</tr></thead>
      <tbody>${typeRows || `<tr><td colspan="${genColspan}" style="text-align:center">Sin datos</td></tr>`}</tbody>
      <tfoot><tr><td style="text-align:right">TOTAL</td><td style="text-align:right">${totalEquipos}</td><td style="text-align:right">${grandWorked} h</td>${withPrices ? `<td style="text-align:right">${phStr(grandAmount, grandWorked)}</td><td style="text-align:right">$${money2(grandAmount)}</td>` : ''}</tr></tfoot></table>
      <h3 style="margin:12px 0 2px">Totales de equipos por empresa</h3>
      <table><thead><tr><th style="text-align:left">Empresa</th><th style="text-align:right">Equipos</th><th style="text-align:right">Horas</th>${genPriceHead}</tr></thead>
      <tbody>${companyCountRows || `<tr><td colspan="${genColspan}" style="text-align:center">Sin datos</td></tr>`}</tbody>
      <tfoot><tr><td style="text-align:right">TOTAL</td><td style="text-align:right">${totalEquipos}</td><td style="text-align:right">${grandWorked} h</td>${withPrices ? `<td style="text-align:right">${phStr(grandAmount, grandWorked)}</td><td style="text-align:right">$${money2(grandAmount)}</td>` : ''}</tr></tfoot></table>`;
    // Resumen de FLETES por empresa + total general (equipos + fletes).
    const fletesGeneralBlock =
      withPrices && grandViajes > 0
        ? `<h3 style="margin:12px 0 2px">Fletes / viajes por empresa</h3>
      <table><thead><tr><th style="text-align:left">Empresa</th><th style="text-align:right">Monto fletes</th></tr></thead>
      <tbody>${[...viajesByCo.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([co, a]) => `<tr><td>${co}</td><td style="text-align:right;font-weight:700">$${money2(a.usd)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td style="text-align:right">TOTAL FLETES</td><td style="text-align:right;font-weight:800">$${money2(grandViajes)}</td></tr></tfoot></table>
      <div style="margin-top:10px;padding:10px 14px;background:#1E3A5F;color:#fff;font-weight:800;font-size:14px;border-radius:6px;text-align:right">TOTAL GENERAL A PAGAR (equipos + fletes): $${money2(grandAmount + grandViajes)}</div>`
        : '';
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
      ${fletesGeneralBlock}
      <h2>Detalle por empresa</h2>
      ${companyBlocks || '<span class="muted">Sin datos</span>'}`;
    await exportPdf(pdfShell('REPORTE DE MAQUINARIA/VEHÍCULOS', sub, body), 'Reportes - Maquinaria-Vehículo');
  };

  // Abrir automáticamente un reporte al llegar con parámetros (p. ej. desde
  // "Ver reporte" en Control de maquinaria → reporte de rondas de ese día).
  // Carga la lista de empresas para el selector del reporte por jornada.
  useEffect(() => {
    supabase.from('companies').select('name, rif, hidden').order('name').then(({ data }) => {
      const visibles = (data ?? []).filter((c: any) => !c.hidden && c.name);
      setCompanyList(visibles.map((c: any) => c.name));
      const rif: Record<string, string> = {};
      visibles.forEach((c: any) => { if (c.rif) rif[c.name] = c.rif; });
      setCompanyRif(rif);
    });
    // Lista de CLASIFICACIONES (canónicas) para el filtro del reporte de maquinaria.
    selectAllRows('machinery', 'clasificacion').then((rows) => {
      const set = new Set<string>();
      (rows ?? []).forEach((m: any) => { const t = canonTipo(m.clasificacion); if (t) set.add(t); });
      setTypeList(Array.from(set).sort((a, b) => a.localeCompare(b)));
    });
  }, []);

  // Camiones E/S EN LÍNEA: mientras la vista previa esté abierta, refresca la lista de
  // camiones al instante si cambian las máquinas (nueva, editada o eliminada).
  useEffect(() => {
    if (!camPreview) return;
    let timer: any;
    const refresh = async () => {
      const companies = await buildTruckCompanies();
      setCamData((prev) => (prev ? { ...prev, companies } : prev));
    };
    const ch = supabase.channel('rt-camiones-es');
    ch.on('postgres_changes' as any, { event: '*', schema: 'public', table: 'machinery' }, () => {
      clearTimeout(timer); timer = setTimeout(refresh, 300);
    });
    ch.subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(ch); };
  }, [camPreview, buildTruckCompanies]);

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
    await exportPdf(pdfShell('REPORTE DE COMBUSTIBLE', 'Consumo de combustible', body), 'Reportes - Combustible');
  };

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Reportes</SectionTitle>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm }}>
        {([
          { v: 'fuel', label: '⛽ Combustible' },
          { v: 'rounds', label: '🛠️ Jornada' },
          { v: 'fleet', label: '🚚 Maquinaria/Vehículo' },
          { v: 'deploy', label: '🚜 Despliegue' },
          { v: 'conteo', label: '📊 Conteo equipos' },
          { v: 'camiones', label: '🚛 Camiones E/S' },
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
                flexGrow: 1,
                flexBasis: '30%',
                minWidth: 110,
                paddingVertical: spacing.md,
                borderRadius: radius.md,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: active ? colors.primary : colors.border,
                backgroundColor: active ? colors.primary : colors.surfaceAlt,
              }}
            >
              <Text style={{ color: active ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Card>
        {/* Selector de MES para el reporte de camiones */}
        {mode === 'camiones' ? (
          <View>
            <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.xs }}>Mes del reporte (muestra sus 4–5 semanas)</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <TouchableOpacity
                onPress={() => { const m = camMonth0 - 1; if (m < 0) { setCamMonth0(11); setCamYear((y) => y - 1); } else setCamMonth0(m); }}
                style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}
              >
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>◀</Text>
              </TouchableOpacity>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>{MES_NOMBRES[camMonth0]} {camYear}</Text>
              <TouchableOpacity
                onPress={() => { const m = camMonth0 + 1; if (m > 11) { setCamMonth0(0); setCamYear((y) => y + 1); } else setCamMonth0(m); }}
                style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}
              >
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>▶</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>
              Solo camiones · agrupados por empresa · puedes descargar el PDF de cada semana por separado (S = salida, E = entrada por día).
            </Text>
          </View>
        ) : mode === 'conteo' ? (
          <Text style={{ color: colors.muted, fontSize: 13 }}>
            Cuenta TODOS los equipos del catálogo por clasificación y por tipo, con totales de activos, inactivos y stand by. No depende de fechas.
          </Text>
        ) : (
        <>
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
              <Text style={{ color: colors.muted, fontSize: 12 }}>Clasificación (marca una o varias)</Text>
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
        </>
        )}
        <TouchableOpacity
          style={styles.genBtn}
          onPress={() =>
            mode === 'fuel'
              ? generate()
              : mode === 'rounds'
              ? generateRounds(from, to, repCompanies)
              : mode === 'fleet'
              ? generateFleet()
              : mode === 'deploy'
              ? generateDeploy()
              : mode === 'conteo'
              ? generateConteo()
              : generateCamiones()
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
              : mode === 'deploy'
              ? '🚜 Descargar despliegue de maquinaria (PDF)'
              : mode === 'conteo'
              ? '📊 Ver conteo de equipos'
              : '🚛 Ver camiones Entradas/Salidas del mes'}
          </Text>
        </TouchableOpacity>
      </Card>

      {loading ? <Loading /> : null}

      {/* Vista previa del CONTEO de equipos */}
      <Modal visible={conteoPreview} animationType="slide" onRequestClose={() => setConteoPreview(false)}>
        <Screen>
          <TouchableOpacity onPress={() => setConteoPreview(false)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm }}>
            <Text style={{ color: colors.primary, fontSize: 20, fontWeight: '800' }}>←</Text>
            <Text style={{ color: colors.primary, fontWeight: '700' }}>Volver</Text>
          </TouchableOpacity>
          <SectionTitle>📊 Conteo de equipos</SectionTitle>
          {conteo ? (
            <>
              {/* Estado de la flota */}
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
                {[
                  { k: 'Activos', v: conteo.activos, c: colors.success },
                  { k: 'Inactivos', v: conteo.inactivos, c: colors.danger },
                  { k: 'Stand by', v: conteo.standby, c: colors.warning },
                  { k: 'Total', v: conteo.total, c: colors.text },
                ].map((s) => (
                  <View key={s.k} style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                    <Text style={{ color: s.c, fontSize: 22, fontWeight: '900' }}>{s.v}</Text>
                    <Text style={{ color: colors.muted, fontSize: 10, textAlign: 'center' }}>{s.k}</Text>
                  </View>
                ))}
              </View>

              {/* Botones: Todos / Con horas / Sin horas */}
              {(() => {
                const cnt = (r: ConteoRow) => (conteoFilter === 'con' ? r.conHoras : conteoFilter === 'sin' ? r.sinHoras : r.count);
                const totalCnt = conteoFilter === 'con' ? conteo.conHoras : conteoFilter === 'sin' ? conteo.sinHoras : conteo.total;
                const colFor = conteoFilter === 'con' ? colors.success : conteoFilter === 'sin' ? colors.warning : colors.primary;
                const btn = (key: 'todos' | 'con' | 'sin', label: string, c: string) => {
                  const on = conteoFilter === key;
                  return (
                    <TouchableOpacity
                      onPress={() => setConteoFilter(key)}
                      style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: on ? c : colors.surface, borderWidth: 1, borderColor: on ? c : colors.border }}
                    >
                      <Text style={{ color: on ? '#fff' : colors.text, fontWeight: '800', fontSize: 13 }}>{label}</Text>
                    </TouchableOpacity>
                  );
                };
                const tableCard = (title: string, rows: ConteoRow[]) => (
                  <Card>
                    <View style={{ flexDirection: 'row', marginBottom: 4 }}>
                      <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 15, flex: 1 }}>{title}</Text>
                      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700', width: 70, textAlign: 'right' }}>
                        {conteoFilter === 'con' ? 'CON HORAS' : conteoFilter === 'sin' ? 'SIN HORAS' : 'CANTIDAD'}
                      </Text>
                    </View>
                    {rows.filter((r) => cnt(r) > 0 || conteoFilter === 'todos').map((r) => (
                      <View key={r.name} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 5, borderTopWidth: 1, borderTopColor: colors.border }}>
                        <Text style={{ color: colors.text, fontSize: 13, flex: 1 }}>{r.name}</Text>
                        <Text style={{ color: colFor, fontSize: 14, fontWeight: '800', width: 70, textAlign: 'right' }}>{cnt(r)}</Text>
                      </View>
                    ))}
                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderTopWidth: 2, borderTopColor: colors.border }}>
                      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800', flex: 1 }}>TOTAL</Text>
                      <Text style={{ color: colFor, fontSize: 15, fontWeight: '900', width: 70, textAlign: 'right' }}>{totalCnt}</Text>
                    </View>
                  </Card>
                );
                return (
                  <>
                    <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
                      {btn('todos', 'Todos', colors.primary)}
                      {btn('con', `Con horas (${conteo.conHoras})`, colors.success)}
                      {btn('sin', `Sin horas (${conteo.sinHoras})`, colors.warning)}
                    </View>
                    {conteoFilter === 'sin' ? (
                      // Sin horas: NO se cuenta/agrupa, se muestra el listado de máquinas.
                      <Card>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                          <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 15 }}>Máquinas sin horas</Text>
                          <Text style={{ color: colors.warning, fontWeight: '900', fontSize: 15 }}>{conteo.sinList.length}</Text>
                        </View>
                        {conteo.sinList.length === 0 ? (
                          <Text style={{ color: colors.muted, fontSize: 13, paddingVertical: 4 }}>Todas las máquinas tienen horas.</Text>
                        ) : (
                          conteo.sinList.map((m, i) => (
                            <View key={`${m.code}-${m.serial ?? i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 5, borderTopWidth: 1, borderTopColor: colors.border }}>
                              <Text style={{ color: colors.muted, fontSize: 12, width: 26, textAlign: 'right' }}>{i + 1}</Text>
                              <View style={{ flex: 1 }}>
                                <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{m.code}</Text>
                                <Text style={{ color: colors.muted, fontSize: 11 }}>{m.serial ? `Serial ${m.serial} · ` : ''}{m.clas}</Text>
                              </View>
                            </View>
                          ))
                        )}
                      </Card>
                    ) : (
                      <>
                        {tableCard('Por clasificación', conteo.byClas)}
                        {tableCard('Por tipo de equipo', conteo.byTipo)}
                      </>
                    )}
                  </>
                );
              })()}

              <TouchableOpacity style={[styles.btn, { backgroundColor: colors.primary }]} onPress={downloadConteoPdf}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>⬇️ Descargar PDF</Text>
              </TouchableOpacity>
              <View style={{ height: spacing.xl }} />
            </>
          ) : null}
        </Screen>
      </Modal>

      <Modal visible={preview} animationType="slide" onRequestClose={() => setPreview(false)}>
        <Screen>
          <TouchableOpacity onPress={() => setPreview(false)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm }}>
            <Text style={{ color: colors.primary, fontSize: 20, fontWeight: '800' }}>←</Text>
            <Text style={{ color: colors.primary, fontWeight: '700' }}>Volver</Text>
          </TouchableOpacity>
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
              {roundGroups.reduce((s, g) => s + g.machines.length, 0)} máquina(s) · {nH(roundGroups.reduce((s, g) => s + g.totalH, 0))} · {usd(roundGroups.reduce((s, g) => s + g.totalUSD + g.viajesUSD, 0))}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>Solo equipos que trabajaron</Text>
          </Card>

          {/* Alcance del informe: general (todas) o una empresa. Regenera al tocar. */}
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Ver</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
            {[{ c: '', label: '🏢 Todas (general)' }, ...companyList.map((c) => ({ c, label: c }))].map((opt) => {
              const on = opt.c === '' ? repCompanies.length === 0 : (repCompanies.length === 1 && repCompanies[0] === opt.c);
              return (
                <TouchableOpacity
                  key={opt.c || 'all'}
                  onPress={() => { const arg = opt.c ? [opt.c] : []; setRepCompanies(arg); generateRounds(from, to, arg); }}
                  style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}
                >
                  <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity style={[styles.btn, { backgroundColor: colors.primary, marginBottom: spacing.sm }]} onPress={downloadRoundsPdf}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>⬇️ Descargar PDF</Text>
          </TouchableOpacity>

          {/* Reporte general (arriba): por clasificación + por empresa (igual al de maquinaria). */}
          {roundGroups.length > 0 ? (() => {
            const clasAgg = new Map<string, { count: number; worked: number; amount: number }>();
            roundGroups.forEach((g) => g.machines.forEach((m) => {
              const k = m.clasificacion || 'Sin clasificación';
              const a = clasAgg.get(k) ?? { count: 0, worked: 0, amount: 0 };
              a.count += 1; a.worked += m.totalH; a.amount += m.priceJornada != null ? m.totalUSD : 0;
              clasAgg.set(k, a);
            }));
            const genWorked = roundGroups.reduce((s, g) => s + g.totalH, 0);
            const genAmount = roundGroups.reduce((s, g) => s + g.totalUSD, 0);
            const genEquipos = roundGroups.reduce((s, g) => s + g.machines.length, 0);
            const ph = (a: number, w: number) => (w > 0 ? usd(a / w) : '—');
            const clas = [...clasAgg.entries()].sort((a, b) => (b[1].count - a[1].count) || a[0].localeCompare(b[0]));
            const hdr = (a: string, b: string, c: string, d: string, e: string) => (
              <View style={{ flexDirection: 'row', backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 5, marginBottom: 2 }}>
                <Text style={{ flex: 2.4, fontSize: 11, color: colors.primaryContrast, fontWeight: '800' }}>{a}</Text>
                <Text style={{ flex: 1, fontSize: 11, color: colors.primaryContrast, fontWeight: '800', textAlign: 'right' }}>{b}</Text>
                <Text style={{ flex: 1.2, fontSize: 11, color: colors.primaryContrast, fontWeight: '800', textAlign: 'right' }}>{c}</Text>
                <Text style={{ flex: 1.4, fontSize: 11, color: colors.primaryContrast, fontWeight: '800', textAlign: 'right' }}>{d}</Text>
                <Text style={{ flex: 1.6, fontSize: 11, color: colors.primaryContrast, fontWeight: '800', textAlign: 'right' }}>{e}</Text>
              </View>
            );
            const row = (a: string, b: string, c: string, d: string, e: string, bold = false) => (
              <View style={{ flexDirection: 'row', paddingHorizontal: spacing.sm, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <Text style={{ flex: 2.4, fontSize: 12, color: colors.text, fontWeight: bold ? '800' : '400' }}>{a}</Text>
                <Text style={{ flex: 1, fontSize: 12, color: colors.text, fontWeight: '700', textAlign: 'right' }}>{b}</Text>
                <Text style={{ flex: 1.2, fontSize: 12, color: colors.muted, textAlign: 'right' }}>{c}</Text>
                <Text style={{ flex: 1.4, fontSize: 12, color: colors.muted, textAlign: 'right' }}>{d}</Text>
                <Text style={{ flex: 1.6, fontSize: 12, color: colors.text, fontWeight: '700', textAlign: 'right' }}>{e}</Text>
              </View>
            );
            return (
              <Card style={{ marginBottom: spacing.md }}>
                <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 15, marginBottom: spacing.xs }}>📋 Reporte general</Text>
                <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 4 }}>Total por clasificación</Text>
                {hdr('CLASIFICACIÓN', 'CANT.', 'HORAS', '$/HORA', 'TOTAL')}
                {clas.map(([c, a]) => (
                  <React.Fragment key={c}>{row(c, String(a.count), nH(a.worked), ph(a.amount, a.worked), usd(a.amount))}</React.Fragment>
                ))}
                {row('TOTAL', String(genEquipos), nH(genWorked), ph(genAmount, genWorked), usd(genAmount), true)}

                <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: spacing.sm, marginBottom: 4 }}>Totales de equipos por empresa</Text>
                {hdr('EMPRESA', 'EQUIP.', 'HORAS', '$/HORA', 'TOTAL')}
                {roundGroups.map((g) => (
                  <React.Fragment key={g.company}>{row(g.company, String(g.machines.length), nH(g.totalH), ph(g.totalUSD, g.totalH), usd(g.totalUSD))}</React.Fragment>
                ))}
                {row('TOTAL', String(genEquipos), nH(genWorked), ph(genAmount, genWorked), usd(genAmount), true)}
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: 6 }}>Resumen por horas × precio. No incluye fletes/viajes (ver detalle por empresa).</Text>
              </Card>
            );
          })() : null}

          {roundGroups.length === 0 ? (
            <EmptyState title="Sin datos" subtitle="No hay rondas en el rango seleccionado." />
          ) : (
            roundGroups.map((g) => (
              <View key={g.company} style={{ marginBottom: spacing.sm }}>
                <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 15, marginBottom: 4, textTransform: 'uppercase' }}>
                  🏢 {g.company}{companyRif[g.company] ? ` · RIF ${companyRif[g.company]}` : ''} ({g.machines.length})
                </Text>
                {g.machines.map((m, i) => (
                  <Card key={i}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>{m.machine}{m.serial ? <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '400' }}>  ·  {m.serial}</Text> : null}</Text>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>Clasificación: {m.clasificacion}</Text>
                      </View>
                      <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 1 }}>
                        <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '700' }}>{m.tipo}</Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: 4 }}>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>📅 Llegada: {m.entryDate ? fmtDMY(m.entryDate) : '—'}</Text>
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
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>{g.viajes.length ? 'SUB TOTAL' : 'TOTAL'} {g.company}</Text>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>{nH(g.totalH)} · {usd(g.totalUSD)}</Text>
                </View>
                {g.viajes.length ? (
                  <View style={{ marginTop: 2 }}>
                    {[...new Map(g.viajes.map((v) => [v.precio, g.viajes.filter((x) => x.precio === v.precio)])).entries()]
                      .sort((a, b) => a[0] - b[0])
                      .map(([precio, items]) => {
                        const totV = items.reduce((s, v) => s + v.viajes, 0);
                        const kinds = new Map<string, number>();
                        items.forEach((v) => { const k = (v.code.split(/\s+/)[0] || v.code).toUpperCase(); kinds.set(k, (kinds.get(k) ?? 0) + 1); });
                        const detalle = [...kinds.entries()].map(([k, n]) => `${n} ${k}`).join(' · ');
                        return (
                          <View key={precio} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: 2 }}>
                            <Text style={{ color: colors.muted, fontSize: 12, flex: 1, paddingRight: spacing.sm }}>🚚 {totV} viaje(s): {detalle} ({usd(precio)} c/u)</Text>
                            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>{usd(totV * precio)}</Text>
                          </View>
                        );
                      })}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginTop: 2 }}>
                      <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 13 }}>TOTAL POR PAGAR</Text>
                      <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 13 }}>{usd(g.totalUSD + g.viajesUSD)}</Text>
                    </View>
                  </View>
                ) : null}
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
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 2 }}>Total por clasificación</Text>
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

          {/* Fletes / viajes por empresa (mismo dato que en el reporte de jornada). */}
          {fleetWithPrices && fleetFletes.length > 0 ? (
            <Card>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, marginBottom: spacing.xs }}>🚚 Fletes / viajes por empresa</Text>
              {fleetFletes.map((f) => (
                <View key={f.company} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Text style={{ color: colors.text, fontSize: 13, flex: 1, paddingRight: spacing.sm }}>{f.company} <Text style={{ color: colors.muted, fontSize: 11 }}>· {f.viajes} viaje(s)</Text></Text>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{usd(f.usd)}</Text>
                </View>
              ))}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>TOTAL FLETES</Text>
                <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '800' }}>{usd(fleetFletes.reduce((s, f) => s + f.usd, 0))}</Text>
              </View>
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>En el PDF, cada empresa muestra sus viajes y el "TOTAL POR PAGAR (equipos + fletes)".</Text>
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

      {/* Vista previa: Control camiones Entradas/Salidas (por mes → semanas) */}
      <Modal visible={camPreview} animationType="slide" onRequestClose={() => setCamPreview(false)}>
        <Screen>
          <TouchableOpacity onPress={() => setCamPreview(false)} style={{ alignSelf: 'flex-start', paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}>
            <Text style={{ color: colors.text, fontWeight: '800' }}>← Volver</Text>
          </TouchableOpacity>
          <SectionTitle>Control camiones Entradas/Salidas</SectionTitle>
          <ReportHeader title="CONTROL CAMIONES ENTRADAS/SALIDAS" colors={colors} />
          {camData ? (
            <>
              <Card>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>{camData.monthLabel}</Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                  {camData.weeks.length} semana(s) · {camData.companies.reduce((s, c) => s + c.items.length, 0)} camión(es) · {camData.companies.length} empresa(s)
                </Text>
              </Card>

              {/* Descarga por SEMANA (una hoja por semana) */}
              <Card>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, marginBottom: spacing.xs }}>Descargar por semana</Text>
                {camData.weeks.map((w) => (
                  <View key={w.n} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>Semana {w.n}</Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>del {fmtDMY(w.from)} al {fmtDMY(w.to)}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => downloadCamionesPdf(w.n)}
                      style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md }}
                    >
                      <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 13 }}>⬇️ PDF</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </Card>

              <TouchableOpacity style={[styles.genBtn, { marginTop: 0, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }]} onPress={() => downloadCamionesPdf()}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>⬇️ Descargar todo el mes (todas las semanas)</Text>
              </TouchableOpacity>

              {/* Camiones por empresa */}
              {camData.companies.map((co) => (
                <Card key={co.company}>
                  <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 14, marginBottom: spacing.xs }}>🏢 {co.company} — {co.items.length} camión(es)</Text>
                  {co.items.map((t) => (
                    <View key={t.code} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                      <Text style={{ color: colors.text, fontSize: 13, flex: 1 }}>{t.code}</Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>{t.plate || t.serial || '—'}</Text>
                    </View>
                  ))}
                </Card>
              ))}
              {camData.companies.length === 0 ? (
                <Card><Text style={{ color: colors.muted }}>No hay camiones registrados.</Text></Card>
              ) : null}
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>
                En el PDF, cada semana trae una tabla por empresa con columnas por día (E = entrada, S = salida) para registrar a mano.
              </Text>
            </>
          ) : null}
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
