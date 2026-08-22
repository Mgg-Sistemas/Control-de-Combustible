import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
  Image,
  Switch,
} from 'react-native';
import { Screen, Card, SectionTitle, Loading, EmptyState } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { supabase, selectAllRows } from '../lib/supabase';
import { nextRtInstanceId } from '../hooks/useRealtime';
import { exportPdf, dateRangeLabel, REPORT_BRAND } from '../lib/pdf';
import { LOGO_DATA_URI } from '../lib/logoData';
import { BCV_LOGO_DATA_URI } from '../lib/logoBcvData';
import { COMPANY_NAME } from '../lib/company';
import { SHIFT_HOURS, workedFromShifts, shiftLabel } from './ControlMaquinariaScreen';
import { canonTipo } from './EquiposScreen';
import { DateField } from '../components/DateField';
import { equipCategory } from '../lib/equipos';
import { cmpText, norm } from '../lib/text';
import { normalizeDept } from '../lib/personal';
import { sectorOf, SUBSECTORS, sectorLabel, sectorMacro } from '../lib/mapZones';
import { latestInspectorByMachine } from '../lib/supervisorVisits';
import { generateInspectorReport, listInspectorNames, InspectorShift } from '../lib/inspectorReport';
import { listInspectorAssignments, inspectorSiempreActivo } from '../lib/machineInspectors';
import { clasificarNoTrabajaron, MaquinaNoTrabajo, MarcaTurno, EstadoNoTrabajo } from '../lib/jornadaEstados';
import { ordenarMaquinas, agruparMaquinas } from '../lib/ordenMaquinas';
import { VenezuelaMap, MapPin } from '../components/VenezuelaMap';
import { spacing, radius, AppColors } from '../theme';
import { useTheme } from '../theme/ThemeContext';

// Máquina agregada en el informe por rondas (por empresa → maquinaria).
type RoundMachine = {
  machine: string;
  tipo: string;         // marca / modelo
  clasificacion: string; // clasificación del equipo
  serial: string | null;
  plate: string | null;
  entryDate: string | null; // fecha de llegada de la máquina (entry_date)
  days: number;         // días (jornadas) que trabajó
  dayH: number;         // total horas de día
  nightH: number;       // total horas de noche
  totalH: number;       // total de horas (día + noche)
  priceJornada: number | null; // precio por jornada de 12 h
  totalUSD: number;     // total $ = totalH / 12 × precio por jornada
  cierreMotivo: string; // motivo de cierre manual anticipado (close_reason), si hubo
  cierreFinBy: string;  // quién FINALIZÓ la jornada (nombre del último cierre manual)
  encargado: string;    // responsable de la máquina (para partir el informe por encargado)
  company: string;      // empresa de la máquina (se necesita al agrupar por encargado)
};
// Viaje registrado en una máquina (solo Golden Touch): nº de viajes y precio unitario.
type ViajeItem = { code: string; clasificacion: string; viajes: number; precio: number };
// Máquina que NO trabajó (0 horas, no suma a horas ni a $): 🔴 averiada, 🟡 parada o
// ⏳ esperando instrucciones. La CLASIFICACIÓN (avería real vs parada vs espera, y el
// turno de cada marca) vive en la función pura `clasificarNoTrabajaron`
// (src/lib/jornadaEstados.ts), blindada por `npm run test:jornada-estados`.
type RoundAveria = MaquinaNoTrabajo;
type RoundCompany = {
  company: string;
  machines: RoundMachine[];
  days: number; dayH: number; nightH: number; totalH: number; totalUSD: number;
  viajes: ViajeItem[];      // viajes por máquina (Golden)
  viajesUSD: number;        // total $ de viajes
  averias: RoundAveria[];   // 🔴 avería REAL pendiente (0 horas) — no suman a totales
  paradas: RoundAveria[];   // 🟡 parada sin avería (marcador "MÁQUINA PARADA") — no suman
  espera: RoundAveria[];    // ⏳ esperando instrucciones (en_espera) — no suman
  abonado?: number;         // abonos (pagos) de la empresa dentro del rango del reporte
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

// Reporte MAQUINARIA (pestaña "fleet"): listado de IDENTIDAD de la maquinaria —
// nombre, marca, modelo, placa, serial y clasificación. Depurado 17-ago-2026 a
// pedido del cliente: antes mezclaba maquinaria + vehículos con horas/averías/
// paradas; ahora es SOLO maquinaria (sin vehículos) y solo las que trabajaron en
// el rango de fechas, con sus datos de catálogo.
type FleetItem = {
  id: string;
  name: string;        // code / nombre de la máquina
  marca: string;       // MARCA (CAT, Komatsu…)
  modelo: string;      // MODELO (320, PC200…)
  plate: string | null;
  serial: string | null;
  tipo: string;        // clasificación (se usa para agrupar/filtrar)
  company: string;
  worked: number;      // horas trabajadas REALES en el rango (activa si > 0)
  averiada: boolean;   // tiene avería pendiente (se incluye aunque no haya trabajado)
  enEspera: boolean;   // esperando instrucciones (stand by) — se incluye aunque no haya trabajado
  retirada: boolean;   // fuera de servicio (operational=false): NO entra a la flota disponible
};

// Período de las jornadas que resume el reporte de flota (horas trabajadas).
// Exportado: Control de Pagos usa el MISMO piso para que el facturado coincida
// con el Informe por jornada (no cobra rondas anteriores a esta fecha).
export const FLEET_HOURS_START = '2026-06-26';
// Fin del PRIMER cierre (26-jun → 05-jul). De ahí en adelante la facturación es semanal.
export const FLEET_HOURS_CUTOFF = '2026-07-05';
// Patrones para los reportes de "camiones" y de "transporte de escombros" (por nombre/tipo/clasificación).
const TRUCK_RE = /CAMION|CHUTO|VOLQUETA|VOLTEO|TORONTO|CISTERNA|PIPA/;
const ESCOMBRO_RE = /VOLQUETA|VOLTEO|TORONTO|ESCOMBRO|BATEA/; // equipos de transporte de escombros (volteo)

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
  body{font-family:Tahoma,Geneva,Verdana,sans-serif;color:#333;padding:0;background:#fff;text-transform:uppercase}
  /* En pantalla (vista previa) el documento se ve como una hoja blanca con márgenes. */
  @media screen{ body{ padding:28px 34px } }
  .top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
  .brand{display:flex;gap:16px;align-items:center}
  .brand-right{display:flex;flex-direction:column;align-items:flex-end;gap:6px}
  .brand img{height:70px;width:auto}
  .logo-box{display:flex;flex-direction:column;align-items:center;gap:4px}
  .logo-box img{height:62px;width:auto}
  .logo-cap{font-size:10px;font-weight:800;color:${PDF_INK};letter-spacing:.3px;text-align:center;max-width:130px;line-height:1.15}
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
function pdfShell(title: string, sub: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title></title><style>${PDF_CSS}</style></head><body>
    <div class="top">
      <div class="brand">
        <div class="logo-box"><img src="${BCV_LOGO_DATA_URI}"/><div class="logo-cap">Banco Central de Venezuela</div></div>
        <div><h1 class="doc-title">${title}</h1><div class="doc-sub">${sub}</div></div>
      </div>
      <div class="brand-right">
        <div class="logo-box"><img src="${LOGO_DATA_URI}"/><div class="logo-cap">SOS La Guaira</div></div>
        <div class="emit"><span class="k">Emitida:</span> ${nowStamp()}</div>
      </div>
    </div>
    <div class="rule"></div>
    <div class="meta">
      <div class="company"><b>${REPORT_BRAND}</b><br/>Sistema de control interno</div>
    </div>
    ${body}
    <div class="foot">${REPORT_BRAND} · Documento generado por el sistema de control interno</div>
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
  body { font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif; color:var(--ink); background:#54606b; text-transform:uppercase; }
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
    <div class="brand"><img src="${BCV_LOGO_DATA_URI}" alt="BCV"/><div><div class="co">Banco Central de Venezuela</div></div></div>
    <div class="brand" style="text-align:right">
      <div><div class="co">SOS La Guaira</div><div class="rif">${lbl}: ${periodLabel}</div></div>
      <img src="${LOGO_DATA_URI}" alt="SOS La Guaira"/>
    </div>
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
    <thead><tr><th></th><th>Equipo</th><th style="text-align:left">Serial / Placa</th><th style="text-align:left">Marca/Modelo</th><th style="text-align:left">Empresa a la que pertenece</th></tr></thead>
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
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm, paddingBottom: spacing.sm, borderBottomWidth: 3, borderBottomColor: colors.brand }}>
      <Image source={{ uri: LOGO_DATA_URI }} style={{ width: 46, height: 46, borderRadius: 8 }} resizeMode="contain" />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 17 }}>{title}</Text>
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
  const navigation = useNavigation<any>();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [from, setFrom] = useState(isoDaysAgo(0)); // por defecto: solo el día de hoy
  const [to, setTo] = useState(isoDaysAgo(0));
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [preview, setPreview] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [mode, setMode] = useState<'fuel' | 'rounds' | 'fleet' | 'deploy' | 'camiones' | 'conteo' | 'inspeccion' | 'inspectores'>('fuel');
  // Turno del reporte de INSPECTORES (jornadas de inspección): Día / Noche / Ambos.
  const [inspShift, setInspShift] = useState<InspectorShift>('both');
  // Agrupamiento del reporte de INSPECTORES: por Inspector (de siempre) o por Encargado.
  const [inspGroupBy, setInspGroupBy] = useState<'inspector' | 'encargado'>('inspector');
  // Inspectores disponibles para el día/turno/empresas actuales (se recalcula dinámicamente,
  // con la MISMA agregación que usa el PDF, para que la lista siempre calce con lo que sale).
  const [inspAvailable, setInspAvailable] = useState<string[]>([]);
  // Inspectores marcados para el reporte (vacío = todos, igual convención que repCompanies).
  const [inspSelected, setInspSelected] = useState<string[]>([]);
  const [inspLoadingList, setInspLoadingList] = useState(false);
  // Reporte "Conteo de equipos": cantidad por clasificación y por tipo + totales de estado.
  type ConteoRow = { name: string; count: number; conHoras: number; sinHoras: number };
  type ConteoMachine = { code: string; serial: string | null; clas: string; company: string };
  // `tipo` aquí es la CATEGORÍA (equipCategory, ej. "JUMBO"), no la marca/modelo real.
  // `modelo` es machinery.tipo (marca/modelo real, ej. "CAT 320") — se muestra aparte.
  type MachineDetail = { code: string; serial: string | null; plate: string | null; company: string; tipo: string; modelo: string | null; clas: string; estado: 'activo' | 'inactivo' | 'standby'; encargado: string | null };
  // Fila activa cruda: ZONA geográfica (GPS) + A DISPOSICIÓN DE (Gobernación/FANB/CVM…),
  // para recalcular el conteo al filtrar y para el cruce disposición×zona, en vivo.
  // `insDia`/`insNoche`: inspector asignado por turno (machine_inspectors). Se cargan
  // SIEMPRE al generar el conteo, pero solo salen en el PDF si se activa el switch
  // "Incluir inspector asignado" — así se puede cambiar de opinión sin regenerar.
  type ActiveRow = { code: string; serial: string | null; company: string; tipo: string; clas: string; zona: string; dispo: string; tieneHoras: boolean; insDia: string | null; insNoche: string | null };
  const [conteo, setConteo] = useState<{ byClas: ConteoRow[]; byTipo: ConteoRow[]; machinesAll: MachineDetail[]; total: number; ubicados: number; ubicadosGps: number; flota: number; conHoras: number; sinHoras: number; activos: number; inactivos: number; standby: number; sinList: ConteoMachine[]; activeRows: ActiveRow[]; zonaCounts: { name: string; count: number }[]; dispoDetail: { name: string; total: number; este: number; oeste: number }[]; mapPins: MapPin[]; zonaCountsGps: { name: string; count: number }[]; sinGpsByTipo: { name: string; count: number }[]; sinGpsCount: number } | null>(null);
  const [conteoMap, setConteoMap] = useState(false); // modal del mapa por sectores
  // Detalle de un estado (al tocar una tarjeta del conteo): lista de máquinas.
  const [conteoDetail, setConteoDetail] = useState<null | 'activo' | 'inactivo' | 'standby' | 'flota'>(null);
  const [conteoPreview, setConteoPreview] = useState(false);
  // Ubicaciones tácticas: ON = incluye personal (operadores por máquina, coordinadores/inspectores por zona).
  const [tacConPersonal, setTacConPersonal] = useState(false);
  // Filtro por ZONA del conteo: '__all__' (todas), un nombre de zona, o 'Sin zona'.
  const [conteoZona, setConteoZona] = useState<string>('__all__');
  // Filtro por EMPRESA del conteo (multi-selección; vacío = TODAS). Pedido del cliente
  // 17-ago-2026: "en reportes, conteo de equipos, no puedo seleccionar por empresa".
  // El conteo del Catálogo sí lo tenía, este no — solo filtraba por zona.
  const [conteoEmpresas, setConteoEmpresas] = useState<Set<string>>(new Set());
  const toggleConteoEmpresa = (name: string) =>
    setConteoEmpresas((prev) => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  /** ¿Esta empresa entra en el conteo? Sin selección = todas. */
  const empresaEnConteo = useCallback(
    (company: string) => conteoEmpresas.size === 0 || conteoEmpresas.has(company),
    [conteoEmpresas],
  );
  // Al reabrir el conteo se limpia la selección de empresas (igual que el buscador por tipo).
  useEffect(() => { if (conteoPreview) setConteoEmpresas(new Set()); }, [conteoPreview]);
  // Conteo de equipos: ON = el PDF agrega el desglose por inspector y el detalle
  // equipo→inspector (☀️ día / 🌙 noche). OFF = el reporte de siempre, solo totales.
  const [conteoConInspector, setConteoConInspector] = useState(false);
  // Al reabrir el conteo, arranca mostrando todas las zonas.
  useEffect(() => { if (conteoPreview) setConteoZona('__all__'); }, [conteoPreview]);
  // Actualización EN VIVO del reporte abierto: guarda la función para regenerarlo con
  // los MISMOS parámetros cuando cambian las jornadas (realtime). Se limpia al cerrar.
  const liveRef = useRef<null | (() => void)>(null);
  const rtId = useRef(0);
  if (!rtId.current) rtId.current = nextRtInstanceId();

  // Realtime: si se agrega/edita una jornada (o flete/máquina), o cambia una avería/parada
  // o un tramo trabajado, mientras el reporte de jornada está abierto, se regenera solo con
  // los mismos filtros (en vivo, sin tocar nada). Antes el canal solo escuchaba
  // machine_rounds/fletes/machinery: una máquina que se averiaba/reactivaba (o un tramo
  // nuevo) NO refrescaba el preview aunque el reporte SÍ lee esas tablas — el estado en vivo
  // se quedaba viejo. Se agregan machine_work_segments y maintenance_requests para que el
  // preview cuadre siempre con Inspecciones/firma.
  useEffect(() => {
    let timer: any;
    const bump = () => { clearTimeout(timer); timer = setTimeout(() => liveRef.current?.(), 500); };
    const ch = supabase.channel(`rt-reportes-jornada-${rtId.current}`);
    ['machine_rounds', 'fletes', 'machinery', 'machine_work_segments', 'maintenance_requests'].forEach((t) =>
      ch.on('postgres_changes' as any, { event: '*', schema: 'public', table: t }, bump)
    );
    ch.subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(ch); };
  }, []);
  // Reporte "Control camiones Entradas/Salidas" (por mes → semanas dom→sáb).
  const nowRef = new Date();
  const [camYear, setCamYear] = useState(nowRef.getFullYear());
  const [camMonth0, setCamMonth0] = useState(nowRef.getMonth());
  const [camPreview, setCamPreview] = useState(false);
  const [camData, setCamData] = useState<{ monthLabel: string; weeks: MonthWeek[]; companies: { company: string; items: { code: string; plate: string | null; serial: string | null; tipo: string | null }[] }[]; escompanies: { company: string; items: { code: string; plate: string | null; serial: string | null; tipo: string | null }[] }[] } | null>(null);
  const [roundGroups, setRoundGroups] = useState<RoundCompany[]>([]);
  // LA MISMA información partida por ENCARGADO. Se calcula SIEMPRE, junto con la de
  // empresa, y se elige al imprimir: así cambiar el agrupador no obliga a volver a
  // consultar la base ni puede dar números distintos por haberse consultado en otro
  // momento. `roundGroups` (por empresa) sigue siendo la ÚNICA fuente de la plata:
  // fletes, abonos y "Totales por empresa" salen de ahí pase lo que pase, porque un
  // flete se le cobra a la empresa y no a la persona que cuida la máquina.
  const [roundGroupsEnc, setRoundGroupsEnc] = useState<RoundCompany[]>([]);
  const [roundsGroupBy, setRoundsGroupBy] = useState<'empresa' | 'encargado'>('empresa');
  const [roundsPreview, setRoundsPreview] = useState(false);
  // Modo del Informe por jornada al IMPRIMIR: 'completo' (el de siempre, con precios y
  // montos) o 'solo_horas' (todos los datos MENOS el dinero — precio/hora, totales $,
  // abonos, fletes). Pedido del cliente 21-ago-2026. Solo afecta el PDF, no el cálculo.
  const [jornadaSoloHoras, setJornadaSoloHoras] = useState(false);
  // Al cerrar la vista previa del reporte de jornada, se apaga la actualización en vivo.
  useEffect(() => { if (!roundsPreview) liveRef.current = null; }, [roundsPreview]);
  // Igual para el conteo: al cerrarlo se apaga la sincronización en vivo.
  useEffect(() => { if (!conteoPreview) liveRef.current = null; }, [conteoPreview]);
  const [roundsCompany, setRoundsCompany] = useState<string | null>(null); // empresa seleccionada (sincronía con Control)
  const [companyList, setCompanyList] = useState<string[]>([]); // empresas para el selector del reporte
  const [companyRif, setCompanyRif] = useState<Record<string, string>>({}); // nombre → RIF (para imprimir en reportes)
  const [typeList, setTypeList] = useState<string[]>([]); // tipos de maquinaria para el filtro
  const [fleetTypes, setFleetTypes] = useState<string[]>([]); // tipos marcados (vacío = todos)
  // Empresas marcadas para filtrar CUALQUIER reporte (vacío = todas / general).
  const [repCompanies, setRepCompanies] = useState<string[]>([]);
  // Informe por jornada · AGRUPAR POR ENCARGADO: lista de encargados por empresa (para
  // que al elegir "Encargado" salgan SOLO los responsables de la(s) empresa(s) marcada(s))
  // y los encargados seleccionados para filtrar el informe (vacío = todos).
  const [encByCompany, setEncByCompany] = useState<Record<string, string[]>>({});
  const [repEncargados, setRepEncargados] = useState<string[]>([]);
  // Lista dinámica de inspectores del reporte de INSPECTORES: se recalcula cada vez que
  // cambia el día, el turno o las empresas marcadas, con la MISMA agregación que el PDF
  // (`listInspectorNames`), para que el selector siempre calce con lo que saldría impreso.
  useEffect(() => {
    if (mode !== 'inspectores') return;
    let cancelled = false;
    setInspLoadingList(true);
    listInspectorNames(from, repCompanies)
      .then(({ day, night }) => {
        if (cancelled) return;
        const names =
          inspShift === 'day' ? day : inspShift === 'night' ? night : Array.from(new Set([...day, ...night])).sort(cmpText);
        setInspAvailable(names);
        setInspSelected([]); // al cambiar día/turno/empresa, vuelve a "todos" por seguridad
      })
      .finally(() => { if (!cancelled) setInspLoadingList(false); });
    return () => { cancelled = true; };
  }, [mode, from, inspShift, repCompanies]);
  // Estado de la flota (para el bloque final del informe por jornada).
  const [fleetStatus, setFleetStatus] = useState<{ total: number; operativa: number; transito: number; inactivos: number; totalFlota: number }>({ total: 0, operativa: 0, transito: 0, inactivos: 0, totalFlota: 0 });
  const [fleetItems, setFleetItems] = useState<FleetItem[]>([]);
  const [fleetPreview, setFleetPreview] = useState(false);
  // Igual que en Jornada/Conteo: al cerrar la vista previa de Maquinaria/Vehículo
  // (Totales por Empresa) se apaga la sincronización en vivo.
  useEffect(() => { if (!fleetPreview) liveRef.current = null; }, [fleetPreview]);

  // Buscador CON CHECKS por tipo de equipo (en el reporte "Conteo de equipos"). Cada tipo
  // (código/modelo del equipo, p. ej. "CAMIÓN VOLTEO TORONTO") es una casilla con su
  // cantidad total; el buscador filtra la lista. Al tildar uno o varios se ve el reporte
  // correspondiente: total (solo número) + cantidad por empresa, con PDF.
  const [tipoQ, setTipoQ] = useState('');
  const [tiposSel, setTiposSel] = useState<Set<string>>(new Set());
  // Alcance por ESTADO del buscador por tipo: todas · solo activas · solo inactivas.
  const [tipoEstado, setTipoEstado] = useState<'todas' | 'activas' | 'inactivas'>('todas');
  const toggleTipo = (key: string) =>
    setTiposSel((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  // Al reabrir el conteo se limpia la selección/búsqueda/alcance del buscador por tipo.
  useEffect(() => { if (conteoPreview) { setTiposSel(new Set()); setTipoQ(''); setTipoEstado('todas'); } }, [conteoPreview]);
  // machinesAll acotado al ESTADO elegido (activas/inactivas/todas) para el buscador por tipo.
  const machinesPorEstado = useMemo(() => {
    const src = conteo?.machinesAll ?? [];
    return tipoEstado === 'todas' ? src : src.filter((m) => (tipoEstado === 'activas' ? m.estado === 'activo' : m.estado === 'inactivo'));
  }, [conteo, tipoEstado]);
  // Mapa de TIPOS unificados: la clave normaliza el código (mayúsculas, sin acentos y
  // con los espacios colapsados) para que "CAMION VOLTEO TORONTO" y "CAMION  VOLTEO
  // TORONTO " cuenten como UN solo tipo. El nombre visible se muestra limpio.
  const tipoMap = useMemo(() => {
    const src = machinesPorEstado;
    const m = new Map<string, { name: string; count: number; clas: string }>();
    src.forEach((it) => {
      const key = norm(it.code).replace(/\s+/g, ' ').trim();
      if (!key) return;
      const e = m.get(key) ?? { name: String(it.code || '').replace(/\s+/g, ' ').trim().toUpperCase(), count: 0, clas: it.clas };
      e.count += 1;
      m.set(key, e);
    });
    return m;
    // Dep CORRECTA: `machinesPorEstado` (no `conteo`). Antes con `[conteo]` no se
    // recomputaba al cambiar el filtro Todas/Activas/Inactivas → conteos por tipo
    // desfasados respecto al estado elegido.
  }, [machinesPorEstado]);
  const tipoKey = (code: string) => norm(code).replace(/\s+/g, ' ').trim();
  // Opciones (tipos de equipo unificados) con su cantidad total, filtradas por el buscador.
  // Lista base ORDENADA una sola vez (no en cada tecla). Solo se reordena si cambia tipoMap.
  const tipoOpcionesBase = useMemo(
    () => [...tipoMap.entries()]
      .map(([key, v]) => ({ key, name: v.name, count: v.count, clas: v.clas }))
      .sort((a, b) => cmpText(a.name, b.name)),
    [tipoMap],
  );
  // En cada tecla solo se FILTRA la base ya ordenada (sin volver a ordenar).
  const tipoOpciones = useMemo(() => {
    const nq = norm(tipoQ.trim());
    return nq ? tipoOpcionesBase.filter((o) => norm(`${o.name} ${o.clas}`).includes(nq)) : tipoOpcionesBase;
  }, [tipoOpcionesBase, tipoQ]);
  // Reporte de los tipos TILDADOS: total + desglose por empresa (A→Z) + LISTADO de los
  // equipos seleccionados (código, empresa, serial/placa, estado), acotado al estado elegido.
  const tipoResultado = useMemo(() => {
    if (!tiposSel.size) return null;
    const match = machinesPorEstado.filter((it) => tiposSel.has(tipoKey(it.code)));
    const byCo = new Map<string, MachineDetail[]>();
    match.forEach((it) => { const l = byCo.get(it.company) ?? []; l.push(it); byCo.set(it.company, l); });
    const empresas = [...byCo.entries()]
      .map(([company, items]) => ({ company, count: items.length, items: items.slice().sort((a, b) => cmpText(a.code, b.code) || cmpText(a.serial || a.plate || '', b.serial || b.plate || '')) }))
      .sort((a, b) => cmpText(a.company, b.company));
    return { total: match.length, empresas };
  }, [tiposSel, machinesPorEstado]);

  const all = rows ?? [];
  const total = all.reduce((s, r) => s + r.liters, 0);
  const byDay = useMemo(() => totalsBy(all, (r) => r.dispatch_date), [rows]);
  const byAsset = useMemo(() => totalsBy(all, (r) => r.asset as any).sort((a, b) => cmpText(a.label, b.label)), [rows]);
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
          .sort((a, b) => cmpText(a.asset, b.asset)),
      }))
      .sort((a, b) => (a.company === 'Sin empresa' ? 1 : b.company === 'Sin empresa' ? -1 : cmpText(a.company, b.company)));
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

  const generateRounds = async (fromArg: string = from, toArg: string = to, companiesArg?: string[] | null, silent = false) => {
    const cos = companiesArg && companiesArg.length ? companiesArg : null;
    // Filtro por ENCARGADO: solo cuando el informe se agrupa por encargado y hay
    // responsables marcados. Vacío = todos. No afecta el modo "empresa".
    const encSel = (roundsGroupBy === 'encargado' && repEncargados.length) ? new Set(repEncargados.map((e) => e.trim())) : null;
    const encOk = (enc: any) => !encSel || encSel.has(String(enc ?? '').trim());
    // Recordar los parámetros para la actualización EN VIVO (realtime) del reporte abierto.
    liveRef.current = () => generateRounds(fromArg, toArg, companiesArg, true);
    if (!silent) setLoading(true);
    // Paginado: con >1000 rondas en el rango la consulta se truncaba.
    const data = await selectAllRows(
      'machine_rounds',
      'round_date, day_hours, night_hours, hours_stopped, overtime_hours, frozen_price, jornada_start_at, jornada_shift, machinery:machinery_id(id, code, serial, plate, tipo, clasificacion, entry_date, price_per_hour, encargado, company:company_id(name))',
      (q) => q.gte('round_date', fromArg).lte('round_date', toArg)
    );
    const nowMs = Date.now();
    // Motivo de CIERRE (cierre manual anticipado) por máquina: close_reason del tramo
    // más reciente del rango (machine_work_segments). Se muestra junto a la máquina.
    const segRows = await selectAllRows(
      'machine_work_segments',
      'machinery_id, ended_at, close_reason, source, recorded_by',
      (q) => q.gte('round_date', fromArg).lte('round_date', toArg)
    );
    const cierreMotivoById = new Map<string, { motivo: string; ms: number }>();
    // FINALIZADA POR: usuario que cerró (recorded_by del último tramo de cierre manual del rango).
    const cierreFinById = new Map<string, { id: string; ms: number }>();
    (segRows ?? []).forEach((s: any) => {
      const ms = s.ended_at ? new Date(s.ended_at).getTime() : 0;
      const cr = (s.close_reason || '').trim();
      if (cr) { const prev = cierreMotivoById.get(s.machinery_id); if (!prev || ms > prev.ms) cierreMotivoById.set(s.machinery_id, { motivo: cr, ms }); }
      if ((s.source === 'manual_finish' || s.source === 'manual_finish_early') && s.recorded_by) {
        const p = cierreFinById.get(s.machinery_id); if (!p || ms > p.ms) cierreFinById.set(s.machinery_id, { id: s.recorded_by, ms });
      }
    });
    // Nombres (full_name) por id para "Finalizada por" (solo los ids que cerraron jornadas).
    const nameById: Record<string, string> = {};
    const finIds = Array.from(new Set(Array.from(cierreFinById.values()).map((v) => v.id)));
    if (finIds.length) {
      const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', finIds);
      ((profs ?? []) as any[]).forEach((p) => { if (p.full_name) nameById[p.id] = p.full_name; });
    }
    // Primer paso: por (máquina única, fecha) tomamos el máximo (dedupe de rondas).
    // Cada fecha guarda el precio EFECTIVO de esa ronda: si la ronda está cerrada trae
    // frozen_price (precio congelado del corte); si no, el precio actual de la máquina.
    // Así un corte cerrado se reporta con SUS precios aunque después cambien.
    type Acc = { machine: string; tipo: string; clasificacion: string; serial: string | null; plate: string | null; entry: string | null; company: string; encargado: string; price: number | null; byDate: Map<string, { d: number; n: number; s: number; o: number; price: number | null; js: number | null; jsh: string | null }> };
    const accs = new Map<string, Acc>();
    (data ?? []).forEach((r: any) => {
      const mm = r.machinery || {};
      const key = (mm.id || mm.serial || mm.code) as string;
      const a = accs.get(key) ?? {
        machine: mm.code ?? '—',
        tipo: (mm.tipo && String(mm.tipo).trim()) || '—',
        clasificacion: (mm.clasificacion && String(mm.clasificacion).trim()) || 'Sin clasificación',
        serial: mm.serial ?? null,
        plate: mm.plate ?? null,
        entry: mm.entry_date ?? null,
        company: mm.company?.name ?? 'Sin empresa',
        encargado: String(mm.encargado ?? ''),
        price: mm.price_per_hour != null ? Number(mm.price_per_hour) : null,
        byDate: new Map(),
      };
      const cur = a.byDate.get(r.round_date) ?? { d: 0, n: 0, s: 0, o: 0, price: null, js: null as number | null, jsh: null as string | null };
      cur.d = Math.max(cur.d, Number(r.day_hours) || 0);
      cur.n = Math.max(cur.n, Number(r.night_hours) || 0);
      cur.s = Math.max(cur.s, Number(r.hours_stopped) || 0);
      cur.o = Math.max(cur.o, Number(r.overtime_hours) || 0);
      // Jornada EN CURSO (marcada por el inspector, aún sin finalizar/auto-cerrar):
      // guardamos su inicio para sumar el tiempo transcurrido en vivo más abajo.
      if (r.jornada_start_at) { const ms = new Date(r.jornada_start_at).getTime(); if (isFinite(ms)) { cur.js = ms; cur.jsh = r.jornada_shift ?? null; } }
      // Precio efectivo de la ronda: congelado del rango (frozen_price>0) si existe; si no,
      // el precio ACTUAL de la máquina (que ya es "el de la semana pasada" si no lo cambiaste).
      cur.price = r.frozen_price != null && Number(r.frozen_price) > 0 ? Number(r.frozen_price) : (mm.price_per_hour != null ? Number(mm.price_per_hour) : null);
      a.byDate.set(r.round_date, cur);
      accs.set(key, a);
    });
    // Segundo paso: agrupar por empresa → máquina con totales.
    // Horas trabajadas = día + noche − parada + extras (igual que el reporte de Maquinaria),
    // por eso restamos paradas: así Jornada y Maquinaria cuadran con el Excel.
    const groups = new Map<string, RoundCompany>();
    const workedIds = new Set<string>(); // ids de máquinas que SÍ trabajaron (para no duplicarlas como averiadas)
    accs.forEach((a, key) => {
      if (cos && !cos.includes(a.company)) return; // filtro por empresa(s)
      if (!encOk(a.encargado)) return;             // filtro por encargado (solo modo encargado)
      let dayH = 0, nightH = 0, totalH = 0, days = 0, totalUSD = 0, repPrice: number | null = null;
      a.byDate.forEach(({ d, n, s, o, price, js, jsh }, dateKey) => {
        // Si hay jornada EN CURSO, sumamos el tiempo transcurrido (cap 12h) al turno
        // abierto para que la máquina APAREZCA aunque no se haya finalizado todavía
        // (sincroniza el informe con lo que el inspector tiene trabajando en vivo).
        // Se cuenta desde el INICIO DEL TURNO (día 7am · noche 7pm), no desde que la
        // marcaron — mismo anclaje que el reporte por empresa, para que ambos coincidan.
        let dd = d, nn = n;
        if (js != null) {
          const shiftStart = new Date(`${dateKey}T${jsh === 'night' ? '19:00:00' : '07:00:00'}-04:00`).getTime();
          const elapsed = Math.min(12, Math.max(0, (nowMs - shiftStart) / 3600000));
          if (jsh === 'night') nn = Math.max(nn, elapsed); else dd = Math.max(dd, elapsed);
        }
        const w = workedFromShifts(dd, nn, s, o);
        dayH += dd; nightH += nn; totalH += w;
        if (w > 0) days += 1; // solo jornadas con horas trabajadas > 0
        // Monto por ronda con SU precio efectivo (congelado o actual); así los cortes
        // cerrados suman con sus precios aunque el precio de la máquina haya cambiado.
        const p = price != null ? price : a.price;
        if (p != null) { totalUSD += (w / 12) * p; if (w > 0) repPrice = p; }
      });
      if (totalH <= 0) return; // solo equipos que SÍ trabajaron (nada en 0)
      workedIds.add(key);
      const rm: RoundMachine = { machine: a.machine, tipo: a.tipo, clasificacion: a.clasificacion, serial: a.serial, plate: a.plate, entryDate: a.entry, days, dayH, nightH, totalH, priceJornada: repPrice != null ? repPrice : a.price, totalUSD, cierreMotivo: cierreMotivoById.get(key)?.motivo || '', cierreFinBy: nameById[cierreFinById.get(key)?.id || ''] || '', encargado: a.encargado, company: a.company };
      const g = groups.get(a.company) ?? { company: a.company, machines: [], days: 0, dayH: 0, nightH: 0, totalH: 0, totalUSD: 0, viajes: [], viajesUSD: 0, averias: [], paradas: [], espera: [] };
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
    // ABONOS (pagos) de cada empresa dentro del rango del informe: sincroniza el Control
    // de Pagos con el reporte. Se cuentan los abonos cuya semana CAE en el rango.
    const abonoRows = await selectAllRows('company_payments', 'company_name, amount, period_start, period_end',
      (q) => q.lte('period_start', toArg).gte('period_end', fromArg));
    const abonoByCompany = new Map<string, number>();
    (abonoRows ?? []).forEach((p: any) => {
      const co = p.company_name ?? '';
      abonoByCompany.set(co, (abonoByCompany.get(co) ?? 0) + (Number(p.amount) || 0));
    });

    // AVERIADAS · PARADAS · ESPERANDO INSTRUCCIONES: máquinas que NO trabajaron en el
    // rango. Se agregan en 0 horas, en TRES renglones separados (no suman a horas ni $).
    // Antes iban todas englobadas en un solo bloque rojo "PARADAS/AVERIADAS" y el bloque
    // de espera no existía — pedido del cliente 19-ago-2026 (ver jornadaEstados.ts).
    const toEndBound = `${toArg}T23:59:59-04:00`;
    // REGLA "SIEMPRE ACTIVO" (SOS LA GUAIRA): sus máquinas nunca cuentan como avería/parada
    // — mismo criterio que Catálogo/Inspecciones/Totales por Empresa (antes solo se
    // aplicaba en generateFleet; este informe las mostraba como averiadas igual).
    const { rows: assignsRounds } = await listInspectorAssignments();
    const siempreActivoSetRounds = new Set(assignsRounds.filter((a) => inspectorSiempreActivo(a.inspector_name)).map((a) => a.machinery_id));
    // Paginado: con >1000 solicitudes pendientes la consulta se truncaba (orden desc por
    // fecha), perdiendo justo las averías/paradas más antiguas y arrastradas.
    const mrPend = await selectAllRows(
      'maintenance_requests',
      'machinery_id, material, notes, created_at, machinery:machinery_id(code, tipo, clasificacion, serial, plate, encargado, active, company:company_id(name))',
      (q) => q.eq('status', 'pendiente').lte('created_at', toEndBound)
    );
    // Catálogo COMPLETO de maquinaria: sirve para el bloque ⏳ ESPERANDO INSTRUCCIONES
    // (en_espera = true, que este informe NO consultaba) y, más abajo, para el "Estado de
    // la flota". Paginado con selectAllRows: con >1000 máquinas se truncaba en 1000.
    const machAll = await selectAllRows(
      'machinery',
      'id, code, tipo, clasificacion, serial, plate, encargado, active, en_espera, company:company_id(name)'
    );
    // Reparto en los TRES bloques (avería real / parada / espera) con la función pura
    // `clasificarNoTrabajaron`: avería > parada > espera, turno por `paradaShiftOf`, y
    // ninguna máquina en dos bloques. Se EXCLUYEN las que ya trabajaron (van donde
    // trabajaron) y las de inspector SIEMPRE ACTIVO (SOS LA GUAIRA, intocable).
    // Nota: entran también las INACTIVAS (pedido cliente 12-ago-2026: "todas las
    // máquinas, estén o no activas"), en 0 h y con su placa/serial.
    const noTrabajaron = clasificarNoTrabajaron({
      tickets: mrPend as any[],
      espera: machAll as any[],
      excluir: (mid) => siempreActivoSetRounds.has(mid) || workedIds.has(mid),
    });
    // El alcance por empresa se aplica acá (todas las filas de una máquina traen la misma).
    const pushNoTrabajo = (items: RoundAveria[], bucket: 'averias' | 'paradas' | 'espera') => {
      items.forEach((it) => {
        if (cos && !cos.includes(it.company)) return;   // fuera del alcance
        if (!encOk(it.encargado)) return;               // filtro por encargado (solo modo encargado)
        const g = groups.get(it.company) ?? { company: it.company, machines: [], days: 0, dayH: 0, nightH: 0, totalH: 0, totalUSD: 0, viajes: [], viajesUSD: 0, averias: [], paradas: [], espera: [] };
        g[bucket].push(it);
        groups.set(it.company, g);
      });
    };
    pushNoTrabajo(noTrabajaron.averiadas, 'averias');
    pushNoTrabajo(noTrabajaron.paradas, 'paradas');
    pushNoTrabajo(noTrabajaron.espera, 'espera');

    const list = Array.from(groups.values()).sort((x, y) =>
      x.company === 'Sin empresa' ? 1 : y.company === 'Sin empresa' ? -1 : cmpText(x.company, y.company)
    );
    // Alfabético por NOMBRE de máquina (acentos/mayúsculas indiferentes), luego serial.
    list.forEach((g) => {
      g.machines.sort((x, y) => cmpText(x.machine, y.machine) || cmpText(x.serial, y.serial));
      const porNombre = (x: RoundAveria, y: RoundAveria) => cmpText(x.machine, y.machine) || cmpText(x.serial, y.serial);
      g.averias.sort(porNombre);
      g.paradas.sort(porNombre);
      g.espera.sort(porNombre);
      g.abonado = abonoByCompany.get(g.company) ?? 0;
    });

    // Estado de la flota: total de activos, en producción (trabajaron), en tránsito
    // (activas que aún no trabajaron = pendientes de incorporación), inactivas y
    // el total de la flota (activas + inactivas), según el alcance del informe.
    // `machAll` ya se trajo arriba (mismo catálogo que alimenta el bloque de espera).
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

    // ── LA MISMA INFORMACIÓN, PARTIDA POR ENCARGADO ───────────────────────────
    // Se arma DESDE `list`, o sea desde lo ya calculado: no se vuelve a consultar
    // nada y no puede dar totales distintos. Entran las máquinas que trabajaron Y
    // las que no (averiadas, paradas y en espera): si estas últimas se quedaran
    // fuera, el corte por encargado escondería justamente las máquinas que tiene
    // detenidas, que es lo primero que uno quiere ver.
    // Quién es "el mismo encargado" lo decide `ordenMaquinas.ts` — la única verdad
    // sobre eso en todo el sistema.
    type WrapEnc = { code: string; encargado: string; kind: 'm' | 'averia' | 'parada' | 'espera'; m?: RoundMachine; a?: RoundAveria };
    const todosEnc: WrapEnc[] = [];
    list.forEach((g) => {
      g.machines.forEach((m) => todosEnc.push({ code: m.machine, encargado: m.encargado, kind: 'm', m }));
      g.averias.forEach((a) => todosEnc.push({ code: a.machine, encargado: a.encargado, kind: 'averia', a }));
      g.paradas.forEach((a) => todosEnc.push({ code: a.machine, encargado: a.encargado, kind: 'parada', a }));
      g.espera.forEach((a) => todosEnc.push({ code: a.machine, encargado: a.encargado, kind: 'espera', a }));
    });
    const listEnc: RoundCompany[] = agruparMaquinas(ordenarMaquinas(todosEnc, 'encargado'), 'encargado').map((grp) => {
      // `viajes`/`viajesUSD`/`abonado` quedan VACÍOS a propósito: los fletes y los
      // abonos son de la empresa. Como el bloque de plata solo se pinta cuando hay
      // fletes, en este corte sencillamente no aparece — y así no puede salir un
      // "SALDO POR PAGAR" que nadie debe.
      const gg: RoundCompany = { company: grp.label, machines: [], days: 0, dayH: 0, nightH: 0, totalH: 0, totalUSD: 0, viajes: [], viajesUSD: 0, averias: [], paradas: [], espera: [], abonado: 0 };
      grp.items.forEach((w) => {
        if (w.kind === 'm' && w.m) {
          gg.machines.push(w.m);
          gg.days += w.m.days; gg.dayH += w.m.dayH; gg.nightH += w.m.nightH; gg.totalH += w.m.totalH; gg.totalUSD += w.m.totalUSD;
        } else if (w.a) {
          if (w.kind === 'averia') gg.averias.push(w.a);
          else if (w.kind === 'parada') gg.paradas.push(w.a);
          else gg.espera.push(w.a);
        }
      });
      return gg;
    });

    setRoundsCompany(cos ? (cos.length === 1 ? cos[0] : `${cos.length} empresas`) : null);
    setRoundGroupsEnc(listEnc);
    setRoundGroups(list);
    setLoading(false);
    setRoundsPreview(true);
  };

  const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const nH = (n: number) => `${Number(n.toFixed(2)).toLocaleString()} h`;
  const downloadRoundsPdf = async () => {
    const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // MODO "SOLO HORAS": todos los datos MENOS el dinero. Cuando `money` es false se
    // omiten las columnas Precio/hora y Total $, los totales/abonos/saldos, el bloque de
    // fletes (que es puramente monetario) y las tarjetas de dinero del resumen.
    const money = !jornadaSoloHoras;
    // Nº de columnas de la tabla por máquina (para los colspan de los títulos de estado).
    const NCOLS = money ? 9 : 7;
    // Bloque de VIAJES por empresa: agrupa por precio unitario y detalla las máquinas.
    // Se suma al subtotal para dar el "TOTAL POR PAGAR" (ej.: Golden Touch).
    const renderViajes = (g: RoundCompany): string => {
      if (!money) return '';           // Solo horas: los fletes son 100% dinero → se omiten
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
      const abonado = Number(g.abonado) || 0;
      const saldo = Math.max(0, totalPagar - abonado);
      // Si hay abonos en el rango, muestra Abonado y Saldo (sincronizado con Control de Pagos).
      const abonoRows = abonado > 0
        ? `<tr><td style="text-align:right;font-weight:700;background:#EAF6EE;color:#15803D;padding:5px 8px">ABONADO ${esc(g.company)}</td><td style="text-align:right;font-weight:700;background:#EAF6EE;color:#15803D;padding:5px 8px">− ${usd(abonado)}</td></tr>
        <tr><td style="text-align:right;font-weight:800;background:#FBEEEE;color:#B91C1C;padding:6px 8px">SALDO POR PAGAR ${esc(g.company)}</td><td style="text-align:right;font-weight:800;background:#FBEEEE;color:#B91C1C;padding:6px 8px">${usd(saldo)}</td></tr>`
        : '';
      return `<table style="margin-top:-4px;margin-bottom:10px"><tbody>${groupRows}
        <tr><td style="text-align:right;font-weight:800;background:#1E3A5F;color:#fff;padding:6px 8px">TOTAL POR PAGAR ${esc(g.company)}</td><td style="text-align:right;font-weight:800;background:#1E3A5F;color:#fff;padding:6px 8px">${usd(totalPagar)}</td></tr>
        ${abonoRows}
      </tbody></table>`;
    };
    const head = `<tr><th style="text-align:left">Máquina</th><th style="text-align:left">Marca/Modelo</th><th style="text-align:left">Clasificación</th><th>Días</th><th>☀️ H. Día</th><th>🌙 H. Noche</th><th>Total horas</th>${money ? '<th>Precio/hora</th><th>Total $</th>' : ''}</tr>`;
    // ── LAS QUE NO TRABAJARON: un renglón-título por ESTADO ────────────────────────
    // 🔴 AVERIADAS (avería real) · 🟡 PARADAS (marcador "MÁQUINA PARADA") · ⏳ ESPERANDO
    // INSTRUCCIONES (en_espera). Antes iban las tres primeras englobadas en un solo
    // bloque rojo y la espera no salía — pedido del cliente 19-ago-2026. Cada máquina
    // sale en UN solo bloque (lo garantiza `clasificarNoTrabajaron`) y ninguna suma a
    // los totales de horas ni de dinero.
    const ESTILO_NT: Record<EstadoNoTrabajo, { emoji: string; titulo: string; color: string; fondo: string; tenue: string }> = {
      averia: { emoji: '🔴', titulo: 'AVERIADAS', color: '#B42318', fondo: '#FBEAEA', tenue: '#C98F8A' },
      parada: { emoji: '🟡', titulo: 'PARADAS', color: '#C2410C', fondo: '#FFF1E3', tenue: '#D6A184' },
      espera: { emoji: '⏳', titulo: 'ESPERANDO INSTRUCCIONES', color: '#B45309', fondo: '#FFFBEB', tenue: '#D6B378' },
    };
    // Celda del turno (☀️ día / 🌙 noche): dice si en ESE turno la máquina estaba
    // AVERIADA o PARADA y por qué, o "—" si en ese turno no tuvo marca. El turno de
    // cada avería/parada sale de `paradaShiftOf` (día 7am–7pm), la misma de Inspecciones.
    const celdaTurno = (m: MarcaTurno | null, estado: EstadoNoTrabajo): string => {
      if (estado === 'espera') return `<td style="text-align:center;font-weight:700">⏳ ESPERA</td>`;
      if (!m) return `<td style="text-align:center;color:#9CA3AF">—</td>`;
      const st = ESTILO_NT[m.estado];
      return `<td style="text-align:center;color:${st.color};font-weight:700">${st.emoji} ${m.estado === 'averia' ? 'AVERÍA' : 'PARADA'}` +
        `${m.motivo ? `<br/><span style="font-weight:400;font-size:8.5px">${esc(m.motivo)}</span>` : ''}</td>`;
    };
    const bloqueNT = (items: RoundAveria[], estado: EstadoNoTrabajo): string => {
      if (!items.length) return '';
      const st = ESTILO_NT[estado];
      const titulo = `<tr><td colspan="${NCOLS}" style="background:${st.fondo};color:${st.color};font-weight:800;letter-spacing:.3px;padding:4px 8px">${st.emoji} ${st.titulo} (${items.length})</td></tr>`;
      const filas = items
        .map(
          (a) =>
            `<tr style="color:${st.color}">` +
            `<td>${esc(a.machine)}${[a.plate, a.serial].filter(Boolean).length ? `<br/><span style="color:${st.tenue}">${esc([a.plate, a.serial].filter(Boolean).join(' · '))}</span>` : ''}</td>` +
            `<td>${esc(a.tipo)}</td>` +
            `<td>${st.emoji} ${esc(a.clasificacion)}${a.motivo ? ` · ${esc(a.motivo)}` : ''}${a.sinTurno ? `<br/><span style="font-size:8.5px">🕓 Sin hora de registro (no se pudo ubicar el turno)</span>` : ''}</td>` +
            `<td style="text-align:center">0</td>` +
            celdaTurno(a.dia, estado) +
            celdaTurno(a.noche, estado) +
            `<td style="text-align:center;font-weight:700">${nH(0)}</td>` +
            (money ? `<td style="text-align:right">—</td><td style="text-align:right">—</td>` : '') +
            `</tr>`
        )
        .join('');
      return titulo + filas;
    };
    // Etiqueta del encabezado de empresa: los TRES números por separado.
    const tagNT = (n: number, estado: EstadoNoTrabajo): string =>
      n ? ` <span style="color:${ESTILO_NT[estado].color};font-weight:400">· ${ESTILO_NT[estado].emoji} ${n} ${ESTILO_NT[estado].titulo}</span>` : '';
    // Las SECCIONES salen del corte elegido (empresa o encargado). Todo lo demás
    // —fletes, abonos, "Totales por empresa" y el gran total— sigue saliendo de
    // `roundGroups`, o sea SIEMPRE por empresa: el reporte funciona igual que
    // siempre y el agrupador solo cambia cómo se presentan las máquinas.
    const gruposVista = roundsGroupBy === 'encargado' ? roundGroupsEnc : roundGroups;
    const icoVista = roundsGroupBy === 'encargado' ? '👤' : '🏢';
    const sections = gruposVista
      .map((g) => {
        const rows = g.machines
          .map(
            (m) =>
              `<tr><td>${esc(m.machine)}${[m.plate, m.serial].filter(Boolean).length ? `<br/><span style="color:#888">${esc([m.plate, m.serial].filter(Boolean).join(' · '))}</span>` : ''}${m.cierreMotivo ? `<br/><span style="color:#B45309;font-size:9px">📝 ${esc(m.cierreMotivo)}</span>` : ''}${m.cierreFinBy ? `<br/><span style="color:#1D4ED8;font-size:9px">🏁 Finalizó: ${esc(m.cierreFinBy)}</span>` : ''}</td>` +
              `<td>${esc(m.tipo)}</td>` +
              `<td>${esc(m.clasificacion)}</td>` +
              `<td style="text-align:center">${m.days}</td>` +
              `<td style="text-align:center">${nH(m.dayH)}</td>` +
              `<td style="text-align:center">${nH(m.nightH)}</td>` +
              `<td style="text-align:center;font-weight:700">${nH(m.totalH)}</td>` +
              (money
                ? `<td style="text-align:right">${m.priceJornada != null ? usd(m.priceJornada / 12) : '—'}</td>` +
                  `<td style="text-align:right;font-weight:700">${m.priceJornada != null ? usd(m.totalUSD) : '—'}</td>`
                : '') +
              `</tr>`
          )
          .join('');
        // Bloque de VIAJES (extra al subtotal). Agrupa las máquinas por precio unitario.
        const viajesBlock = renderViajes(g);
        // Renglones-título que separan de las que trabajaron: 🔴 averiadas, 🟡 paradas y
        // ⏳ esperando instrucciones (cada uno solo si hay). Las columnas ☀️/🌙 dicen qué
        // pasó en cada turno.
        const bloquesNT = bloqueNT(g.averias, 'averia') + bloqueNT(g.paradas, 'parada') + bloqueNT(g.espera, 'espera');
        const estadoTag = tagNT(g.averias.length, 'averia') + tagNT(g.paradas.length, 'parada') + tagNT(g.espera.length, 'espera');
        // El RIF solo tiene sentido cuando el título ES una empresa. Agrupado por
        // encargado, `g.company` es el nombre de una PERSONA y ponerle un RIF al
        // lado sería un dato falso.
        const rifTag = roundsGroupBy === 'empresa' && companyRif[g.company]
          ? ` <span style="color:#666;font-weight:400;font-size:13px">· RIF ${esc(companyRif[g.company])}</span>` : '';
        return `<h2>${icoVista} ${esc(g.company)}${rifTag} <span style="color:#666;font-weight:400">(${g.machines.length} máquina${g.machines.length === 1 ? '' : 's'})</span>${estadoTag}</h2>
          <table><thead>${head}</thead><tbody>${rows}${bloquesNT}</tbody>
          <tfoot><tr><td colspan="4" style="text-align:right;font-weight:800">${money && g.viajes.length ? 'SUB TOTAL' : 'TOTAL'} ${esc(g.company)}</td>
            <td style="text-align:center;font-weight:800">${nH(g.dayH)}</td>
            <td style="text-align:center;font-weight:800">${nH(g.nightH)}</td>
            <td style="text-align:center;font-weight:800">${nH(g.totalH)}</td>
            ${money ? `<td></td><td style="text-align:right;font-weight:800">${usd(g.totalUSD)}</td>` : ''}</tr></tfoot></table>${viajesBlock}`;
      })
      .join('');
    const grandViajes = roundGroups.reduce((s, g) => s + g.viajesUSD, 0);
    const grandUSD = roundGroups.reduce((s, g) => s + g.totalUSD, 0) + grandViajes;
    const grandH = roundGroups.reduce((s, g) => s + g.totalH, 0);
    const grandMachines = roundGroups.reduce((s, g) => s + g.machines.length, 0);
    // Abonos del rango (por empresa) y pendiente del corte = total $ − abonado.
    const grandAbonado = roundGroups.reduce((s, g) => s + (Number(g.abonado) || 0), 0);
    const grandPendiente = Math.max(0, grandUSD - grandAbonado);
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
    const genFletes = roundGroups.reduce((s, g) => s + g.viajesUSD, 0);
    const genEquipos = grandMachines;
    const clasRows = [...clasAgg.entries()]
      .sort((a, b) => (a[0] === 'Sin clasificación' ? 1 : b[0] === 'Sin clasificación' ? -1 : cmpText(a[0], b[0])))
      .map(([clas, a]) => `<tr><td>${esc(clas)}</td><td style="text-align:right;font-weight:700">${a.count}</td><td style="text-align:right">${nH(a.worked)}</td>${money ? `<td style="text-align:right">${phStr(a.amount, a.worked)}</td><td style="text-align:right;font-weight:700">${usd(a.amount)}</td>` : ''}</tr>`)
      .join('');
    // Por empresa: equipos + FLETES = total a pagar (los fletes del rango se suman aquí).
    const empRows = roundGroups
      .map((g) => `<tr><td>${esc(g.company)}</td><td style="text-align:right;font-weight:700">${g.machines.length}</td><td style="text-align:right">${nH(g.totalH)}</td>${money ? `<td style="text-align:right">${usd(g.totalUSD)}</td><td style="text-align:right">${g.viajesUSD > 0 ? usd(g.viajesUSD) : '—'}</td><td style="text-align:right;font-weight:800">${usd(g.totalUSD + g.viajesUSD)}</td>` : ''}</tr>`)
      .join('');
    const generalBlockJ = `
      <h2 style="margin-top:20px">Reporte general</h2>
      <h3 style="margin:12px 0 2px">Total por clasificación</h3>
      <table><thead><tr><th style="text-align:left">Clasificación</th><th style="text-align:right">Cantidad</th><th style="text-align:right">Horas</th>${money ? '<th style="text-align:right">Precio/hora</th><th style="text-align:right">Total a pagar</th>' : ''}</tr></thead>
      <tbody>${clasRows || `<tr><td colspan="${money ? 5 : 3}" style="text-align:center">Sin datos</td></tr>`}</tbody>
      <tfoot><tr><td style="text-align:right">TOTAL</td><td style="text-align:right">${genEquipos}</td><td style="text-align:right">${nH(genWorked)}</td>${money ? `<td style="text-align:right">${phStr(genAmount, genWorked)}</td><td style="text-align:right">${usd(genAmount)}</td>` : ''}</tr></tfoot></table>
      <h3 style="margin:12px 0 2px">Totales por empresa${money ? ' (equipos + fletes)' : ''}</h3>
      <table><thead><tr><th style="text-align:left">Empresa</th><th style="text-align:right">Equipos</th><th style="text-align:right">Horas</th>${money ? '<th style="text-align:right">Equipos $</th><th style="text-align:right">Fletes $</th><th style="text-align:right">Total a pagar</th>' : ''}</tr></thead>
      <tbody>${empRows || `<tr><td colspan="${money ? 6 : 3}" style="text-align:center">Sin datos</td></tr>`}</tbody>
      <tfoot><tr><td style="text-align:right">TOTAL</td><td style="text-align:right">${genEquipos}</td><td style="text-align:right">${nH(genWorked)}</td>${money ? `<td style="text-align:right">${usd(genAmount)}</td><td style="text-align:right">${genFletes > 0 ? usd(genFletes) : '—'}</td><td style="text-align:right;font-weight:800">${usd(genAmount + genFletes)}</td>` : ''}</tr></tfoot></table>
      ${money ? '<p class="muted" style="margin-top:6px">El "Total a pagar" por empresa incluye los fletes/viajes del rango. La tabla por clasificación es solo equipos (un flete no pertenece a una clasificación).</p>' : ''}`;
    // Resumen del CORTE (arriba de todo): horas, total $, abonado y pendiente.
    const resumenCard = (label: string, value: string, color: string, bg: string) =>
      `<td style="border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px;background:${bg};vertical-align:top;width:25%">
        <div style="font-size:10px;color:#555;text-transform:uppercase;font-weight:700;letter-spacing:.3px">${label}</div>
        <div style="font-size:19px;font-weight:800;color:${color};margin-top:3px">${value}</div>
      </td>`;
    // Solo horas: una sola tarjeta grande (equipos + horas). Completo: horas + dinero.
    const resumenTop = money
      ? `
      <table style="width:100%;border-collapse:separate;border-spacing:8px 0;margin:8px 0 12px"><tbody><tr>
        ${resumenCard('Total de horas por corte', nH(grandH), '#1E3A5F', '#F3F6FB')}
        ${resumenCard('Total $', usd(grandUSD), '#1E3A5F', '#EEF3FB')}
        ${resumenCard('Total abonado', usd(grandAbonado), '#15803D', '#EAF6EE')}
        ${resumenCard('TOTAL PENDIENTE', usd(grandPendiente), '#B91C1C', '#FBEEEE')}
      </tr></tbody></table>`
      : `
      <table style="width:100%;border-collapse:separate;border-spacing:8px 0;margin:8px 0 12px"><tbody><tr>
        ${resumenCard('Total de equipos', `${grandMachines}`, '#1E3A5F', '#F3F6FB')}
        ${resumenCard('Total de horas por corte', nH(grandH), '#1E3A5F', '#EEF3FB')}
      </tr></tbody></table>`;
    const content = `
      <div class="muted">Informe por jornada · del ${fmtDMY(from)} al ${fmtDMY(to)}${roundsCompany ? ` · Empresa: ${roundsCompany}` : ''}</div>
      ${resumenTop}
      ${generalBlockJ}
      ${sections || '<p class="muted">Sin datos en el rango.</p>'}
      <div style="margin-top:16px;padding:10px 14px;background:#1E3A5F;color:#fff;font-weight:800;font-size:14px;border-radius:6px;text-align:right">Total general: ${grandMachines} equipo(s) · ${nH(grandH)}${money ? ` · ${usd(grandUSD)}` : ''}</div>`;
    // Nombre del archivo: "Reporte EMPRESA del DD al DD". Si es de una sola empresa lleva su
    // nombre; siempre incluye el rango de fechas.
    const rng = dateRangeLabel(from, to);
    // DOS cortes independientes que se COMBINAN, y los dos tienen que verse en el
    // subtítulo y en el nombre del archivo: cómo está agrupado (empresa/encargado)
    // y si lleva precios o es "solo horas". Dos PDF del mismo rango partidos
    // distinto no se pueden llamar igual, o al guardarlos uno pisa al otro.
    const sufijo = money ? '' : ' - solo horas';
    const porEnc = roundsGroupBy === 'encargado';
    const jornadaFile = (porEnc
      ? `Reporte por jornada por encargado ${rng}`
      : (roundsCompany ? `Reporte ${roundsCompany} ${rng}` : `Reporte por jornada ${rng}`)) + sufijo;
    const sub = (porEnc ? 'Por encargado y maquinaria' : 'Por empresa y maquinaria')
      + (money ? '' : ' · SOLO HORAS (sin precios)');
    await exportPdf(pdfShell('INFORME POR JORNADA', sub, content), jornadaFile);
  };

  const generateFleet = async () => {
    // Recordar la función para la actualización EN VIVO (realtime) del reporte
    // abierto — mismo patrón que generateRounds/generateConteo (ver liveRef arriba).
    liveRef.current = generateFleet;
    setLoading(true);
    // TODA LA FLOTA DISPONIBLE = operativas + averiadas + esperando instrucciones,
    // es decir TODAS menos las RETIRADAS (operational=false). MISMO universo que el
    // Catálogo ("TOTAL DE FLOTA DISPONIBLE"): se sincronizan a propósito (cliente
    // 20-ago-2026: el reporte debía cuadrar con el catálogo). Reporte de IDENTIDAD/
    // catálogo: nombre, marca, modelo, placa, serial, clasificación.
    const [{ data: mach }, rnds, pend] = await Promise.all([
      supabase.from('machinery').select('id, code, marca, modelo, plate, serial, clasificacion, en_espera, operational, company:company_id(name)'),
      // Horas trabajadas REALES dentro del rango del reporte (día + noche − parada + extras).
      // Paginado: con >1000 rondas la consulta se truncaba y faltaban horas.
      selectAllRows('machine_rounds', 'machinery_id, round_date, day_hours, night_hours, hours_stopped, overtime_hours', (q) => q.gte('round_date', from).lte('round_date', to)),
      // Averías PENDIENTES (estado actual): material distinto de 'MÁQUINA PARADA' = avería real.
      selectAllRows('maintenance_requests', 'machinery_id, material', (q) => q.eq('status', 'pendiente')),
    ]);
    // Horas trabajadas por máquina en el rango (dedupe por máquina+día).
    const byMD = new Map<string, any>();
    (rnds ?? []).forEach((r: any) => byMD.set(`${r.machinery_id}|${r.round_date}`, r));
    const mHours = new Map<string, number>();
    byMD.forEach((r) => {
      const w = workedFromShifts(Number(r.day_hours ?? 0), Number(r.night_hours ?? 0), Number(r.hours_stopped ?? 0), Number(r.overtime_hours ?? 0));
      if (w > 0) mHours.set(r.machinery_id, (mHours.get(r.machinery_id) ?? 0) + w);
    });
    // Averiadas = tienen una solicitud pendiente que NO sea "MÁQUINA PARADA" (esa es parada, no avería).
    const averiaSet = new Set<string>();
    (pend ?? []).forEach((r: any) => { if (r.material !== 'MÁQUINA PARADA') averiaSet.add(r.machinery_id); });
    const items: FleetItem[] = (mach ?? []).map((m: any) => ({
      id: m.id,
      name: m.code,
      marca: (m.marca && String(m.marca).trim()) || '—',
      modelo: (m.modelo && String(m.modelo).trim()) || '—',
      plate: m.plate,
      serial: m.serial,
      // El reporte de maquinaria agrupa/filtra por CLASIFICACIÓN.
      tipo: canonTipo(m.clasificacion) || 'Sin clasificación',
      company: m.company?.name || 'Sin empresa',
      worked: mHours.get(m.id) ?? 0,
      averiada: averiaSet.has(m.id),
      enEspera: m.en_espera === true,
      retirada: m.operational === false,
    }));
    const filtered = items.filter(
      (it) =>
        !it.retirada && // TODA la flota disponible (operativas + averiadas + esperando), MENOS retiradas — cuadra con el catálogo
        (repCompanies.length === 0 || repCompanies.includes(it.company)) &&
        (fleetTypes.length === 0 || fleetTypes.includes(it.tipo))
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
      serial: (m.serial || '') as string,
      plate: (m.plate || '') as string,
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
    const byCo = [...coMap.values()].sort((a, b) => (a.company === 'Sin empresa' ? 1 : b.company === 'Sin empresa' ? -1 : cmpText(a.company, b.company)));
    // Agregado por CLASIFICACIÓN (lámina 3 "Capacidad por Clasificación").
    const tpMap = new Map<string, { tipo: string; count: number; hours: number }>();
    list.forEach((m) => { const a = tpMap.get(m.clas) ?? { tipo: m.clas, count: 0, hours: 0 }; a.count++; a.hours += m.hours; tpMap.set(m.clas, a); });
    const byTp = [...tpMap.values()].sort((a, b) => (a.tipo === 'SIN CLASIFICACIÓN' ? 1 : b.tipo === 'SIN CLASIFICACIÓN' ? -1 : cmpText(a.tipo, b.tipo)));
    // Inactivos con su empresa.
    const inact = list
      .filter((m) => !m.active)
      .sort((a, b) => cmpText(a.company, b.company) || cmpText(a.code, b.code))
      .map((m) => ({ code: m.code, serial: [m.plate, m.serial].filter(Boolean).join(' · '), tipo: m.tipo, company: m.company }));
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
    liveRef.current = generateConteo; // se sincroniza solo cuando se cambia/actualiza una máquina
    const mach = await selectAllRows('machinery', 'id, code, tipo, serial, plate, clasificacion, active, operational, en_espera, latitude, longitude, zona, encargado, company:company_id(name)');
    const all = (mach ?? []) as any[];
    // El CONTEO cuenta SOLO los equipos activos: se excluyen los inactivos
    // (active/operational = false) y los que están en espera (stand by).
    const isActivo = (m: any) => m.en_espera !== true && m.active !== false && m.operational !== false;
    const list = all.filter(isActivo);
    // "Tiene horas" por máquina, agregado en el SERVIDOR (RPC machine_worked_flags) para
    // NO descargar toda machine_rounds solo para un booleano. Si el RPC no existe (SQL sin
    // correr), cae al escaneo completo con la MISMA fórmula (workedFromShifts). Verificado:
    // el conjunto del RPC coincide EXACTAMENTE con el del escaneo (dedupe por máquina+día).
    const workedSet = new Set<string>();
    try {
      const { data: wf, error } = await supabase.rpc('machine_worked_flags');
      if (error) throw error;
      ((wf as any[]) ?? []).forEach((r) => workedSet.add(r.machinery_id));
    } catch {
      const rnds = await selectAllRows('machine_rounds', 'machinery_id, round_date, day_hours, night_hours, hours_stopped, overtime_hours');
      const byMD = new Map<string, any>();
      (rnds ?? []).forEach((r: any) => byMD.set(`${r.machinery_id}|${r.round_date}`, r));
      const hoursByMachine = new Map<string, number>();
      byMD.forEach((r) => {
        const w = workedFromShifts(Number(r.day_hours ?? 0), Number(r.night_hours ?? 0), Number(r.hours_stopped ?? 0), Number(r.overtime_hours ?? 0));
        if (w > 0) hoursByMachine.set(r.machinery_id, (hoursByMachine.get(r.machinery_id) ?? 0) + w);
      });
      hoursByMachine.forEach((v, k) => { if (v > 0) workedSet.add(k); });
    }
    // Inspector asignado por máquina y turno. Es aditivo: si la consulta falla (o falta
    // correr el SQL de machine_inspectors), el conteo sale igual y el inspector queda en
    // blanco — no se rompe el reporte por un dato opcional.
    const insByMachine = new Map<string, { day?: string; night?: string }>();
    try {
      const { rows: asg } = await listInspectorAssignments();
      (asg ?? []).forEach((r) => {
        const g = insByMachine.get(r.machinery_id) ?? {};
        if (r.shift === 'night') g.night = r.inspector_name; else g.day = r.inspector_name;
        insByMachine.set(r.machinery_id, g);
      });
    } catch { /* sin asignaciones: el PDF mostrará "—" en las columnas de inspector */ }
    const clasMap = new Map<string, ConteoRow>();
    const tipoMap = new Map<string, ConteoRow>();
    const companyOf = (m: any) => (m.company?.name && String(m.company.name).trim()) || 'Sin empresa';
    list.forEach((m) => {
      const tieneHoras = workedSet.has(m.id);
      const ck = (m.clasificacion && String(m.clasificacion).trim()) || 'Sin clasificación';
      const tk = equipCategory(m.code);
      const cc = clasMap.get(ck) ?? { name: ck, count: 0, conHoras: 0, sinHoras: 0 }; cc.count += 1; if (tieneHoras) cc.conHoras += 1; else cc.sinHoras += 1; clasMap.set(ck, cc);
      const tt = tipoMap.get(tk) ?? { name: tk, count: 0, conHoras: 0, sinHoras: 0 }; tt.count += 1; if (tieneHoras) tt.conHoras += 1; else tt.sinHoras += 1; tipoMap.set(tk, tt);
    });
    // Orden ALFABÉTICO por nombre (es-VE) en las tablas del conteo.
    const alfa = (a: ConteoRow, b: ConteoRow) => cmpText(a.name, b.name);
    const byClas = [...clasMap.values()].sort(alfa);
    const byTipo = [...tipoMap.values()].sort(alfa);
    const conHoras = list.filter((m) => workedSet.has(m.id)).length;
    const sinHoras = list.length - conHoras;
    // Listado de máquinas SIN horas (para mostrarlo tal cual, sin agrupar).
    const sinList: ConteoMachine[] = list
      .filter((m) => !workedSet.has(m.id))
      .map((m) => ({ code: m.code ?? '—', serial: m.serial ?? null, clas: (m.clasificacion && String(m.clasificacion).trim()) || 'Sin clasificación', company: companyOf(m) }))
      .sort((a, b) => cmpText(a.company, b.company) || cmpText(a.code, b.code));
    // Estado (referencia sobre el catálogo COMPLETO): stand by (en espera) tiene
    // prioridad; luego inactivo; el resto son los activos que forman el conteo.
    const standby = all.filter((m) => m.en_espera === true).length;
    const inactivos = all.filter((m) => m.en_espera !== true && (m.active === false || m.operational === false)).length;
    const activos = list.length;
    // Detalle de TODAS las máquinas con su estado (para ver el detalle al tocar una tarjeta).
    const estadoOf = (m: any): 'activo' | 'inactivo' | 'standby' => m.en_espera === true ? 'standby' : (m.active === false || m.operational === false) ? 'inactivo' : 'activo';
    const machinesAll: MachineDetail[] = all
      .map((m) => ({ code: m.code ?? '—', serial: m.serial ?? null, plate: m.plate ?? null, company: companyOf(m), tipo: equipCategory(m.code), modelo: (m.tipo && String(m.tipo).trim()) || null, clas: (m.clasificacion && String(m.clasificacion).trim()) || 'Sin clasificación', estado: estadoOf(m), encargado: (m.encargado && String(m.encargado).trim()) || null }))
      .sort((a, b) => cmpText(a.company, b.company) || cmpText(a.code, b.code));
    // Sector MACRO por máquina para el REPORTE: si tiene GPS, su sector real (Este/Oeste);
    // si NO tiene ubicación, se reparte 50/50 entre Este y Oeste. Esto es SOLO para el
    // reporte: NO toca el mapa ni el GPS (que quedan intactos). Reparto estable: los sin
    // ubicación se ordenan por código y se alternan Este, Oeste, Este, Oeste…
    const macroById = new Map<string, 'Este' | 'Oeste'>();
    list.forEach((m) => { const sec = sectorOf(m.latitude, m.longitude); if (sec != null) macroById.set(m.id, sec.startsWith('Oeste') ? 'Oeste' : 'Este'); });
    list.filter((m) => sectorOf(m.latitude, m.longitude) == null)
      .sort((a, b) => cmpText(a.code, b.code))
      .forEach((m, i) => macroById.set(m.id, i % 2 === 0 ? 'Este' : 'Oeste'));
    // Zona del reporte: SIEMPRE "Este" u "Oeste" (sin sub-sectores). Las ubicadas por GPS
    // toman su lado real; las sin GPS, el reparto 50/50. Así TODAS quedan ubicadas.
    const zonaR = (m: any): string => macroById.get(m.id)!;
    // El conteo cuenta TODAS las máquinas activas (el total es como antes). Cada una lleva
    // su zona del reporte (Este/Oeste), sin ninguna "Sin zona".
    const activeRows: ActiveRow[] = list.map((m) => ({
      code: m.code ?? '—', serial: m.serial ?? null, company: companyOf(m),
      tipo: equipCategory(m.code), clas: (m.clasificacion && String(m.clasificacion).trim()) || 'Sin clasificación',
      zona: zonaR(m),
      dispo: (m.zona && String(m.zona).trim()) || 'Propias',
      tieneHoras: workedSet.has(m.id),
      insDia: insByMachine.get(m.id)?.day ?? null,
      insNoche: insByMachine.get(m.id)?.night ?? null,
    }));
    // Puntos del mapa (solo las ubicadas), coloreados por empresa como el mapa general.
    const mapPins: MapPin[] = list
      .filter((m) => m.latitude != null && m.longitude != null && sectorOf(m.latitude, m.longitude) != null)
      .map((m) => ({
        id: m.id, name: m.code ?? '—', lat: Number(m.latitude), lng: Number(m.longitude),
        active: '', operational: m.operational !== false, company: companyOf(m),
        tipo: equipCategory(m.code), clasificacion: (m.clasificacion && String(m.clasificacion).trim()) || null,
        plate: null, serial: m.serial ?? null, utm: null, route: [],
      }));
    // Conteo por ZONA para los chips: TODAS quedan ubicadas (ninguna "Sin zona"). Suma = total.
    const zonaCountMap = new Map<string, number>();
    activeRows.forEach((r) => { if (r.zona !== 'Sin zona') zonaCountMap.set(r.zona, (zonaCountMap.get(r.zona) ?? 0) + 1); });
    const zonaCounts = [...zonaCountMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => cmpText(a.name, b.name));
    const ubicados = zonaCounts.reduce((s, z) => s + z.count, 0);
    // Ubicados REALMENTE en el mapa (por GPS) — para el modal del mapa (los puntos son solo estos).
    const ubicadosGps = mapPins.length;
    // Zona 100% REAL, tomada del MAPA (mismo cálculo que MapScreen: sectorOf sobre lat/lng,
    // SIN el reparto 50/50 de arriba). Las máquinas sin GPS quedan fuera de Este/Oeste y se
    // listan aparte por tipo, en vez de adivinar su lado.
    const zonaGpsMap = new Map<string, number>();
    const sinGpsTipoMap = new Map<string, number>();
    list.forEach((m) => {
      const sec = sectorOf(m.latitude, m.longitude);
      if (sec != null) {
        const macro = sec.startsWith('Oeste') ? 'Oeste' : 'Este';
        zonaGpsMap.set(macro, (zonaGpsMap.get(macro) ?? 0) + 1);
      } else {
        const tk = equipCategory(m.code);
        sinGpsTipoMap.set(tk, (sinGpsTipoMap.get(tk) ?? 0) + 1);
      }
    });
    const zonaCountsGps = [...zonaGpsMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => cmpText(a.name, b.name));
    const sinGpsByTipo = [...sinGpsTipoMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => cmpText(a.name, b.name));
    const sinGpsCount = list.length - ubicadosGps;
    // "A disposición de" (Gobernación/FANB/CVM…): cuenta TODAS las activas transferidas
    // e indica cuántas caen en Este / Oeste (con el mismo reparto del reporte: GPS o 50/50).
    const dispoMap = new Map<string, { total: number; este: number; oeste: number }>();
    list.forEach((m) => {
      const d = (m.zona && String(m.zona).trim()) || 'Propias';
      if (d === 'Propias') return;
      if (!dispoMap.has(d)) dispoMap.set(d, { total: 0, este: 0, oeste: 0 });
      const e = dispoMap.get(d)!; e.total += 1;
      if (macroById.get(m.id) === 'Oeste') e.oeste += 1; else e.este += 1;
    });
    const dispoDetail = [...dispoMap.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => cmpText(a.name, b.name));
    // total = TODAS las activas; ubicados = todas (las sin GPS repartidas 50/50); ubicadosGps = solo GPS.
    setConteo({ byClas, byTipo, machinesAll, total: list.length, ubicados, ubicadosGps, flota: all.length, conHoras, sinHoras, activos, inactivos, standby, sinList, activeRows, zonaCounts, dispoDetail, mapPins, zonaCountsGps, sinGpsByTipo, sinGpsCount });
    setLoading(false);
    setConteoPreview(true);
  };

  const downloadConteoPdf = async () => {
    if (!conteo) return;
    const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Respeta la ZONA elegida en el filtro: recalcula las tablas con esas máquinas.
    // Filtro por ZONA y por EMPRESA. `rowsZona` es el embudo del que salen TODAS las
    // tablas del conteo (byClas, byTipo, totales, desglose por inspector), así que
    // filtrar acá deja todo consistente de una sola vez. Sin empresas marcadas = todas.
    const rowsZona = conteo.activeRows
      .filter((r) => conteoZona === '__all__' || r.zona === conteoZona)
      .filter((r) => empresaEnConteo(r.company));
    const aggregate = (key: 'clas' | 'tipo') => {
      const m = new Map<string, number>();
      rowsZona.forEach((r) => m.set(r[key], (m.get(r[key]) ?? 0) + 1));
      return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => cmpText(a.name, b.name));
    };
    const byClas = aggregate('clas');
    const byTipo = aggregate('tipo');
    const totalCnt = rowsZona.length;
    const zonaTxt = conteoZona === '__all__' ? 'todas las zonas' : conteoZona;
    const rowsFor = (arr: { name: string; count: number }[]) => arr.map((r) => `<tr><td>${esc(r.name)}</td><td style="text-align:right;font-weight:700">${r.count}</td></tr>`).join('');
    // Resumen por zona (ubicación en el mapa) — solo cuando se ven todas las zonas.
    const zonaSummary = conteoZona === '__all__' ? `
      <h2 style="font-size:14px;color:#1E3A5F;margin-bottom:2px">Máquinas por zona (ubicación en el mapa)</h2>
      <table class="cnt"><thead><tr><th>Zona</th><th style="text-align:right">Cantidad</th></tr></thead>
        <tbody>${conteo.zonaCounts.map((z) => `<tr><td>${esc(z.name)}</td><td style="text-align:right;font-weight:700">${z.count}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>TOTAL UBICADOS</td><td style="text-align:right">${conteo.ubicados}</td></tr></tfoot></table>` : '';
    // A disposición de (entes: Gobernación/FANB/CVM…) — TODAS las transferidas; indica el
    // sector (Este/Oeste) de las que están ubicadas. No depende del filtro de zona.
    const dispoRows = conteo.dispoDetail.map((d) => {
      const parts = [d.este ? `${d.este} en Este` : '', d.oeste ? `${d.oeste} en Oeste` : ''].filter(Boolean).join(' · ');
      return `<tr><td><b>${esc(d.name)}</b></td><td style="text-align:right;font-weight:700">${d.total}</td><td>${parts}</td></tr>`;
    }).join('');
    const dispoHtml = conteo.dispoDetail.length ? `
      <h2 style="font-size:14px;color:#1E3A5F;margin-bottom:2px">A disposición de</h2>
      <table class="cnt"><thead><tr><th>Ente</th><th style="text-align:right">Cantidad</th><th>Sector (ubicadas)</th></tr></thead><tbody>${dispoRows}</tbody></table>` : '';
    // Desglose por TIPO y zona (ej. JUMBO (21): 9 en Este · Caraballeda, 4 en Oeste · Aeropuerto…).
    let tipoZonaHtml = '';
    if (conteoZona === '__all__') {
      const m = new Map<string, { total: number; sec: Map<string, number> }>();
      conteo.activeRows.forEach((r) => { if (r.zona === 'Sin zona') return; if (!m.has(r.tipo)) m.set(r.tipo, { total: 0, sec: new Map() }); const e = m.get(r.tipo)!; e.total += 1; e.sec.set(r.zona, (e.sec.get(r.zona) ?? 0) + 1); });
      const tzRows = [...m.entries()].sort((a, b) => cmpText(a[0], b[0])).map(([tipo, e]) => {
        const parts = [...e.sec.entries()].sort((a, b) => cmpText(a[0], b[0])).map(([s, n]) => `${n} en ${esc(s)}`).join(' · ');
        return `<tr><td><b>${esc(tipo)}</b> (${e.total})</td><td>${parts}</td></tr>`;
      }).join('');
      tipoZonaHtml = `
        <h2 style="font-size:14px;color:#1E3A5F;margin-bottom:2px">Por tipo y zona (Este / Oeste)</h2>
        <table class="cnt"><thead><tr><th>Tipo (total)</th><th>Distribución por zona</th></tr></thead><tbody>${tzRows}</tbody></table>`;
    }
    // Máquinas SIN ubicación por tipo (ej. 3 jumbos, 5 tractores…).
    let sinUbicHtml = '';
    if (conteoZona === '__all__') {
      const su = new Map<string, number>();
      conteo.activeRows.forEach((r) => { if (r.zona === 'Sin zona') su.set(r.tipo, (su.get(r.tipo) ?? 0) + 1); });
      const sinUbic = conteo.total - conteo.ubicadosGps;
      if (sinUbic) {
        const suRows = [...su.entries()].sort((a, b) => cmpText(a[0], b[0])).map(([t, n]) => `<tr><td>${esc(t)}</td><td style="text-align:right;font-weight:700">${n}</td></tr>`).join('');
        sinUbicHtml = `
          <h2 style="font-size:14px;color:#1E3A5F;margin-bottom:2px">Máquinas SIN ubicación en el mapa · por tipo</h2>
          <table class="cnt"><thead><tr><th>Tipo de equipo</th><th style="text-align:right">Cantidad</th></tr></thead>
            <tbody>${suRows}</tbody>
            <tfoot><tr><td>TOTAL SIN UBICACIÓN</td><td style="text-align:right">${sinUbic}</td></tr></tfoot></table>`;
      }
    }
    // ── INSPECTOR ASIGNADO (opcional, switch "Incluir inspector asignado") ──────
    // Dos tablas: cuántos equipos lleva cada inspector por turno, y el detalle
    // equipo→inspector. Respeta el filtro de zona igual que el resto del reporte.
    let inspectorHtml = '';
    if (conteoConInspector) {
      const porInspector = new Map<string, { dia: number; noche: number }>();
      rowsZona.forEach((r) => {
        if (r.insDia) { const e = porInspector.get(r.insDia) ?? { dia: 0, noche: 0 }; e.dia += 1; porInspector.set(r.insDia, e); }
        if (r.insNoche) { const e = porInspector.get(r.insNoche) ?? { dia: 0, noche: 0 }; e.noche += 1; porInspector.set(r.insNoche, e); }
      });
      const insRows = [...porInspector.entries()]
        .sort((a, b) => cmpText(a[0], b[0]))
        .map(([name, c]) => `<tr><td>${esc(name)}</td><td style="text-align:right;font-weight:700">${c.dia || ''}</td><td style="text-align:right;font-weight:700">${c.noche || ''}</td><td style="text-align:right;font-weight:800">${c.dia + c.noche}</td></tr>`)
        .join('');
      const sinAsignar = rowsZona.filter((r) => !r.insDia && !r.insNoche).length;
      const detalleRows = rowsZona
        .slice()
        .sort((a, b) => cmpText(a.company, b.company) || cmpText(a.code, b.code))
        .map((r) => `<tr><td>${esc(r.code)}</td><td>${esc(r.serial || '—')}</td><td>${esc(r.company)}</td><td>${esc(r.insDia || '—')}</td><td>${esc(r.insNoche || '—')}</td></tr>`)
        .join('');
      inspectorHtml = `
      <h2 style="font-size:14px;color:#1E3A5F;margin-bottom:2px">Equipos por inspector · ${esc(zonaTxt)}</h2>
      <table class="cnt"><thead><tr><th>Inspector</th><th style="text-align:right">☀️ Día</th><th style="text-align:right">🌙 Noche</th><th style="text-align:right">Total</th></tr></thead>
        <tbody>${insRows || '<tr><td colspan="4" style="text-align:center">Sin inspectores asignados</td></tr>'}</tbody></table>
      ${sinAsignar ? `<p style="font-size:11px;color:#6B7280;margin:-10px 0 12px">${sinAsignar} equipo(s) sin ningún inspector asignado.</p>` : ''}
      <h2 style="font-size:14px;color:#1E3A5F;margin-bottom:2px">Detalle: equipo e inspector asignado</h2>
      <table class="cnt"><thead><tr><th>Equipo</th><th>Serial</th><th>Empresa</th><th>☀️ Día</th><th>🌙 Noche</th></tr></thead>
        <tbody>${detalleRows}</tbody>
        <tfoot><tr><td colspan="4">TOTAL EQUIPOS</td><td style="text-align:right">${rowsZona.length}</td></tr></tfoot></table>`;
    }
    const tablasHtml = `${zonaSummary}
      <h2 style="font-size:14px;color:#1E3A5F;margin-bottom:2px">Cantidad de equipos por clasificación · ${esc(zonaTxt)}</h2>
      <table class="cnt"><thead><tr><th>Clasificación</th><th style="text-align:right">Cantidad</th></tr></thead>
        <tbody>${rowsFor(byClas)}</tbody>
        <tfoot><tr><td>TOTAL</td><td style="text-align:right">${totalCnt}</td></tr></tfoot></table>
      <h2 style="font-size:14px;color:#1E3A5F;margin-bottom:2px">Cantidad de equipos por tipo · ${esc(zonaTxt)}</h2>
      <table class="cnt"><thead><tr><th>Tipo de equipo</th><th style="text-align:right">Cantidad</th></tr></thead>
        <tbody>${rowsFor(byTipo)}</tbody>
        <tfoot><tr><td>TOTAL</td><td style="text-align:right">${totalCnt}</td></tr></tfoot></table>
      ${dispoHtml}
      ${tipoZonaHtml}
      ${sinUbicHtml}
      ${inspectorHtml}`;
    const body = `
      <style>
        table.cnt{width:100%;border-collapse:collapse;margin:6px 0 16px;font-size:12px}
        table.cnt th,table.cnt td{border:1px solid #ccc;padding:6px 10px;text-align:left}
        table.cnt th{background:#1E3A5F;color:#fff}
        table.cnt tfoot td{background:#EEF2F7;font-weight:800}
      </style>
      ${tablasHtml}`;
    const sub = conteoZona === '__all__'
      ? 'Cantidad de equipos ACTIVOS por zona, clasificación y tipo'
      : `Equipos ACTIVOS ubicados en ${esc(conteoZona)} · por clasificación y tipo`;
    await exportPdf(pdfShell('CONTEO DE EQUIPOS', sub, body), 'Reportes - Conteo de equipos');
  };

  // 🗺️ Zona REAL por GPS (igual que el Mapa): a diferencia del conteo de arriba (que
  // reparte 50/50 las máquinas sin GPS para que "todas queden ubicadas"), este reporte
  // SOLO cuenta Este/Oeste con el punto GPS real de cada máquina (mismo cálculo que usa
  // MapScreen: sectorOf sobre latitude/longitude) y lista aparte, por tipo, las máquinas
  // que no tienen GPS cargado — sin adivinar de qué lado están.
  const downloadConteoZonaMapaPdf = async () => {
    if (!conteo) return;
    const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const zonaRows = conteo.zonaCountsGps.map((z) => `<tr><td>${esc(z.name)}</td><td style="text-align:right;font-weight:700">${z.count}</td></tr>`).join('');
    const sinGpsRows = conteo.sinGpsByTipo.map((t) => `<tr><td>${esc(t.name)}</td><td style="text-align:right;font-weight:700">${t.count}</td></tr>`).join('');
    const body = `
      <style>
        table.cnt{width:100%;border-collapse:collapse;margin:6px 0 16px;font-size:12px}
        table.cnt th,table.cnt td{border:1px solid #ccc;padding:6px 10px;text-align:left}
        table.cnt th{background:#1E3A5F;color:#fff}
        table.cnt tfoot td{background:#EEF2F7;font-weight:800}
        .note{font-size:11px;color:#6B7280;margin:0 0 10px}
      </style>
      <p class="note">Cuenta Este/Oeste con la ubicación GPS real de cada máquina — el mismo cálculo que usa la pantalla del Mapa. Las máquinas sin GPS cargado NO se reparten al azar: quedan aparte, en la tabla de abajo.</p>
      <h2 style="font-size:14px;color:#1E3A5F;margin-bottom:2px">Equipos por zona · SOLO GPS real (como el Mapa)</h2>
      <table class="cnt"><thead><tr><th>Zona</th><th style="text-align:right">Cantidad</th></tr></thead>
        <tbody>${zonaRows || '<tr><td colspan="2" style="text-align:center">Sin equipos ubicados por GPS</td></tr>'}</tbody>
        <tfoot><tr><td>TOTAL UBICADOS POR GPS</td><td style="text-align:right">${conteo.ubicadosGps}</td></tr></tfoot></table>
      ${conteo.sinGpsCount ? `
      <h2 style="font-size:14px;color:#1E3A5F;margin-bottom:2px">Equipos SIN GPS (no aparecen en el Mapa) · por tipo</h2>
      <table class="cnt"><thead><tr><th>Tipo de equipo</th><th style="text-align:right">Cantidad</th></tr></thead>
        <tbody>${sinGpsRows}</tbody>
        <tfoot><tr><td>TOTAL SIN GPS</td><td style="text-align:right">${conteo.sinGpsCount}</td></tr></tfoot></table>` : ''}
      <p class="note">Total de equipos activos: ${conteo.total} · Con GPS: ${conteo.ubicadosGps} · Sin GPS: ${conteo.sinGpsCount}.</p>`;
    await exportPdf(pdfShell('CONTEO DE EQUIPOS — ZONA REAL (GPS, COMO EL MAPA)', 'Este/Oeste con ubicación GPS real, sin repartos', body), 'Reportes - Conteo de equipos (zona real GPS)');
  };

  // 📍 Reporte Diario de Operaciones y Maquinaria (Ubicaciones tácticas): máquinas
  // REALES agrupadas por "a cargo de" (CVM / Gobernación / FANB / SOS La Guaira, según
  // el campo "a disposición de"=zona), con su ubicación real (referencia + sector Este/
  // Oeste + subzona por GPS) y estado. Incluye las pick-up del módulo de Vehículos.
  // Reporte DIARIO "Inspección de equipos": agrupado por inspector (el del ÚLTIMO
  // check-in). Por cada equipo: máquina, serial/placa, sector, edificio y horas del
  // día (día/noche/total, de machine_rounds). Excluye CVM/Gobernación/FANB. Las
  // máquinas sin inspector van a "FALTA INSPECTOR" con su encargado del catálogo.
  const generateInspeccion = async (date: string) => {
    setLoading(true);
    try {
      const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const dmy = (iso: string) => { const [y, m, d] = (iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : iso; };
      const mach = await selectAllRows('machinery', 'id, code, tipo, serial, plate, active, latitude, longitude, zona, encargado, referencia, company:company_id(name)');
      const rounds = await selectAllRows('machine_rounds', 'machinery_id, day_hours, night_hours', (q) => q.eq('round_date', date));
      const insp = await latestInspectorByMachine();
      const hoursBy = new Map<string, { d: number; n: number }>();
      (rounds ?? []).forEach((r: any) => {
        const cur = hoursBy.get(r.machinery_id) ?? { d: 0, n: 0 };
        cur.d += Number(r.day_hours) || 0; cur.n += Number(r.night_hours) || 0;
        hoursBy.set(r.machinery_id, cur);
      });
      // A cargo de (zona): se EXCLUYEN CVM / Gobernación / FANB.
      const esInstitucion = (m: any) => /cvm|gobernaci|fanb/i.test(String(m.zona ?? ''));
      const list = ((mach ?? []) as any[]).filter((m) => m.active !== false && !esInstitucion(m));
      const sectorOfM = (m: any) => { const s = sectorOf(m.latitude, m.longitude); return s ? sectorLabel(s) : 'Desplegadas por todo el territorio de La Guaira'; };
      const edificioOf = (m: any) => { const r = (m.referencia && String(m.referencia).trim()) || ''; return r && !/^[\d.,\s\/-]+$/.test(r) ? r : '—'; };
      const FALTA = 'FALTA INSPECTOR';
      const groups = new Map<string, any[]>();
      list.forEach((m) => { const n = insp[m.id]?.name?.trim() || FALTA; if (!groups.has(n)) groups.set(n, []); groups.get(n)!.push(m); });
      // Orden: inspectores A→Z; "FALTA INSPECTOR" al final.
      const names = [...groups.keys()].sort((a, b) => (a === FALTA ? 1 : b === FALTA ? -1 : cmpText(a, b)));
      let totD = 0, totN = 0;
      const secciones = names.map((name) => {
        const isFalta = name === FALTA;
        const items = groups.get(name)!.slice().sort((a, b) => cmpText(a.code ?? '', b.code ?? ''));
        const rows = items.map((m, i) => {
          const h = hoursBy.get(m.id) ?? { d: 0, n: 0 };
          const tot = Math.round((h.d + h.n) * 100) / 100;
          totD += h.d; totN += h.n;
          const encCol = isFalta ? `<td>${esc((m.encargado && String(m.encargado).trim()) || '—')}</td>` : '';
          return `<tr><td>${i + 1}</td><td><b>${esc(m.code ?? '—')}</b></td><td>${esc((m.tipo && String(m.tipo).trim()) || '—')}</td><td>${esc(m.plate || m.serial || '—')}</td><td>${esc(sectorOfM(m))}</td><td>${esc(edificioOf(m))}</td>${encCol}<td class="r">${h.d || 0}</td><td class="r">${h.n || 0}</td><td class="r" style="font-weight:800">${tot}</td></tr>`;
        }).join('');
        const encHead = isFalta ? '<th>Encargado</th>' : '';
        return `<div class="insp ${isFalta ? 'falta' : ''}">${isFalta ? '⚠️ ' : '👷 '}Inspector: <b>${esc(name)}</b> <span class="cnt">${items.length} equipo(s)</span></div>
          <table class="tac"><thead><tr><th style="width:26px">Nº</th><th>Máquina</th><th>Marca/Modelo</th><th>Serial/Placa</th><th>Sector</th><th>Edificio</th>${encHead}<th class="r">Día</th><th class="r">Noche</th><th class="r">Nº Horas</th></tr></thead><tbody>${rows || ''}</tbody></table>`;
      }).join('');
      const body = `
        <style>
          .insp{margin:14px 0 4px;font-size:12.5px;color:#111;border-left:4px solid ${PDF_ACCENT};padding-left:8px}
          .insp.falta{border-left-color:#B45309;color:#7A4A0B}
          .cnt{background:#EEF2F7;color:#1E3A5F;border-radius:10px;padding:1px 8px;font-size:11px;font-weight:700;margin-left:6px}
          table.tac{width:100%;border-collapse:collapse;margin:4px 0 12px;font-size:11.5px}
          table.tac th,table.tac td{border:1px solid #ccc;padding:5px 7px;text-align:left;vertical-align:top}
          table.tac th{background:#1E3A5F;color:#fff}
          table.tac td.r,table.tac th.r{text-align:right}
        </style>
        <div style="font-size:12px;color:#374151;margin-bottom:6px">Equipos: <b>${list.length}</b> · Horas del día — Día: <b>${Math.round(totD * 100) / 100}</b> · Noche: <b>${Math.round(totN * 100) / 100}</b> · Total: <b>${Math.round((totD + totN) * 100) / 100}</b><br/><span style="color:#6B7280">No incluye equipos de CVM / Gobernación / FANB.</span></div>
        ${secciones || '<p style="color:#6B7280">Sin equipos para el día.</p>'}`;
      await exportPdf(pdfShell('INSPECCIÓN DE EQUIPOS', `Reporte diario · ${dmy(date)}`, body), `Reporte - Inspeccion de equipos ${dmy(date)}`);
    } finally {
      setLoading(false);
    }
  };

  // conPersonal = incluye personal (operadores/inspectores). ficticio = versión
  // SIMULADA: todas las máquinas OPERATIVAS y repartidas al azar Este/Oeste (para
  // presentaciones/demos). Por defecto el reporte es REAL y sincronizado con el mapa.
  const downloadTacticalPdf = async (conPersonal = false, ficticio = false) => {
    const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const mach = await selectAllRows('machinery', 'id, code, tipo, serial, clasificacion, active, operational, en_espera, latitude, longitude, zona, encargado, referencia, location, sector, company:company_id(name)');
    const vehs = await selectAllRows('vehicles', 'plate, brand, model, vehicle_type, active');
    // Los DOS reportes (REAL y SIMULADO) cuentan el MISMO universo que el Catálogo:
    // TODAS las máquinas menos las RETIRADAS (operational=false). Así el TOTAL del
    // reporte siempre cuadra con la cantidad que se ve en el Catálogo. La diferencia
    // REAL vs SIMULADO es solo el ESTADO (real vs todo operativo) y el reparto de zona
    // (GPS real vs Este/Oeste al azar).
    const list = ((mach ?? []) as any[]).filter((m) => m.operational !== false);
    // Solo ficticio: sector aleatorio (fijo por máquina durante el armado del reporte);
    // se elige un subsector al azar del catálogo de zonas → reparte Este/Oeste parejo.
    const randSectorById = new Map<string, string>();
    if (ficticio) list.forEach((m) => { const s = SUBSECTORS[Math.floor(Math.random() * SUBSECTORS.length)]; randSectorById.set(m.id, s.n); });
    // Personal de la nómina (solo cuando se pide "con personal"): operadores por
    // máquina, coordinadores e inspectores repartidos por zona (Este/Oeste).
    const empsRaw = conPersonal ? (((await selectAllRows('employees', 'first_name, last_name, cargo, department, status')) ?? []) as any[]) : [];
    const activeEmps = empsRaw.filter((e) => (e.status ?? 'activo') === 'activo');
    const nameOf = (e: any) => `${(e.first_name ?? '').trim()} ${(e.last_name ?? '').trim()}`.trim() || '—';
    const byCargo = (re: RegExp) => activeEmps.filter((e) => re.test(`${e.cargo ?? ''} ${e.department ?? ''}`)).map(nameOf).sort((a, b) => cmpText(a, b));
    const operadores = byCargo(/operador/i);
    const coordinadores = byCargo(/coordinador/i);
    const inspectores = byCargo(/inspector/i);
    const companyOf = (m: any) => (m.company?.name && String(m.company.name).trim()) || 'Sin empresa';
    // REAL: estado según catálogo. FICTICIO: TODAS como OPERATIVAS (ACTIVAS).
    const estadoOf = (m: any) => (ficticio ? 'Operativo' : m.en_espera === true ? 'En espera por instrucciones' : (m.operational === false || m.active === false) ? 'Inoperativo' : 'Operativo');
    // "A cargo de": el campo zona guarda la institución (Gobernación/FANB/CVM…); Propias/null = SOS La Guaira.
    const enteOf = (m: any) => { const z = (m.zona && String(m.zona).trim()) || ''; return !z || /^propias?$/i.test(z) ? 'SOS La Guaira' : z; };
    // Equipos de apoyo que se mueven por toda la operación (no tienen una base fija):
    // cualquier máquina con CLASIFICACIÓN de servicio o transporte (cisternas de agua,
    // tanques de combustible, camión de servicio…) y las camionetas PICK-UP. Su ubicación
    // en el reporte dice "Desplegadas por los sectores estratégicos".
    const esSectoresEstrategicos = (m: any) => {
      const clas = String(m.clasificacion ?? '').toLowerCase();
      const tipo = String(equipCategory(m.code) ?? '').toLowerCase();
      return /servicio|transporte/.test(clas)
        || /cisterna|combustible|servicio/.test(tipo)
        || /pick|camioneta/i.test(tipo) || /pick|camioneta/i.test(clas);
    };
    const ubicOf = (m: any) => {
      // Los equipos de apoyo (servicio/transporte + pick-ups) van por los sectores
      // estratégicos según la necesidad, no tienen una ubicación fija.
      if (esSectoresEstrategicos(m)) return 'Desplegadas por los sectores estratégicos';
      const rawRef = (m.referencia && String(m.referencia).trim()) || (m.location && String(m.location).trim()) || '';
      // Ignora referencias que son SOLO números (ej. "46564.0"): mejor mostrar el sector.
      const ref = /^[\d.,\s-]+$/.test(rawRef) ? '' : rawRef;
      // REAL: sector por GPS. FICTICIO: sector asignado al azar. sectorLabel → "Este · Macuto".
      const sec = ficticio ? (randSectorById.get(m.id) ?? null) : sectorOf(m.latitude, m.longitude);
      const macro = sec ? (sec.startsWith('Oeste') ? 'Oeste' : 'Este') : '';
      const sub = sec ? sectorLabel(sec).replace(/^(Este|Oeste)\s*·\s*/, '') : '';
      const parts: string[] = [];
      if (macro) parts.push(macro);
      if (sub) parts.push(sub);
      if (ref) parts.push(ref);
      return parts.length ? parts.join(' · ') : 'Desplegadas por todo el territorio de La Guaira';
    };
    // Las camionetas PICK-UP no van en la lista de maquinaria: van en su propia sección
    // (a disposición de los encargados de SOS La Guaira).
    const esPickup = (m: any) => /pick|camioneta/i.test(equipCategory(m.code)) || /pick|camioneta/i.test(String(m.clasificacion ?? ''));
    const pickupMachines = list.filter(esPickup);
    const maqList = list.filter((m) => !esPickup(m));
    // Agrupar por EMPRESA en DOS grupos: LICCIONE (sus máquinas) y GOLDEN TOUCH (las de
    // Golden + TODAS las demás empresas). Liccione se reconoce por el nombre de la empresa
    // supervisora; cualquier otra (o sin empresa) cae en Golden Touch.
    const grupoEmpresaDe = (m: any) => (/liccion/i.test(companyOf(m)) ? 'LICCIONE' : 'GOLDEN TOUCH');
    const groups = new Map<string, any[]>();
    list.forEach((m) => { const e = grupoEmpresaDe(m); if (!groups.has(e)) groups.set(e, []); groups.get(e)!.push(m); }); // TODA la maquinaria (= Catálogo)
    const enteNames = ['LICCIONE', 'GOLDEN TOUCH'].filter((g) => groups.has(g)); // Liccione primero; Golden Touch (el resto) después
    const estadoColor = (e: string) => (e === 'Operativo' ? '#0B7A3B' : e === 'Inoperativo' ? '#B91C1C' : '#B45309');
    const sortMaq = (a: any, b: any) => cmpText(equipCategory(a.code), equipCategory(b.code)) || cmpText(a.code ?? '', b.code ?? '') || cmpText(a.serial ?? '', b.serial ?? '');
    // Operadores: 2 por máquina de SOS La Guaira (1 turno día + 1 turno noche), en
    // rotación por la lista de operadores de la nómina. Solo aplica a los equipos de
    // SOS La Guaira (NO a los de CVM / Gobernación / FANB).
    const opAssign = new Map<any, { dia: string; noche: string }>();
    if (conPersonal && operadores.length) {
      // Los operadores de la nómina son de SOS La Guaira: se asignan a SUS máquinas
      // (2 por máquina, día y noche), sin importar en qué grupo de empresa aparezcan.
      list.filter((m) => enteOf(m) === 'SOS La Guaira').slice().sort(sortMaq).forEach((m, i) => {
        opAssign.set(m, { dia: operadores[(2 * i) % operadores.length], noche: operadores[(2 * i + 1) % operadores.length] });
      });
    }
    const maquinariaHtml = enteNames.map((ente) => {
      const showOps = conPersonal;
      const rows = groups.get(ente)!
        .slice()
        .sort(sortMaq)
        .map((m, i) => {
          const est = estadoOf(m);
          const opCols = showOps ? `<td>${esc(opAssign.get(m)?.dia ?? '—')}</td><td>${esc(opAssign.get(m)?.noche ?? '—')}</td>` : '';
          const marca = (m.tipo && String(m.tipo).trim()) || '';
          return `<tr><td>${i + 1}</td><td><b>${esc(equipCategory(m.code))}</b><br/><span style="color:#6B7280;font-size:11px">${esc(m.code ?? '—')}${m.serial ? ' · ' + esc(m.serial) : ''}${marca ? ' · 🏷️ ' + esc(marca) : ''}</span></td><td>${esc(ubicOf(m))}</td>${opCols}<td style="color:${estadoColor(est)};font-weight:700">${est}</td></tr>`;
        }).join('');
      const opHead = showOps ? '<th>Operador (día)</th><th>Operador (noche)</th>' : '';
      return `<div class="ente">🏢 Empresa: <b>${esc(ente)}</b> <span class="cnt-pill">${groups.get(ente)!.length} equipo(s)</span></div>
        <table class="tac"><thead><tr><th style="width:30px">Nº</th><th>Equipo / Tipo</th><th>Ubicación</th>${opHead}<th>Estado</th></tr></thead><tbody>${rows}</tbody></table>`;
    }).join('');
    // Pick-up: las máquinas clasificadas como pick-up + las del módulo de Vehículos.
    // TODAS a disposición de los encargados de SOS LA GUAIRA.
    const vehPickups = ((vehs ?? []) as any[]).filter((v) => v.active !== false && /pick|camioneta/i.test(String(v.vehicle_type ?? '')));
    // Máquinas pick-up + vehículos pick-up en UNA lista, ordenada ALFABÉTICAMENTE (serial/placa). Sin columna de ubicación.
    const pickItems = [
      ...pickupMachines.map((m) => ({ label: `<b>${esc(m.code ?? '—')}</b>${m.serial ? ' · ' + esc(m.serial) : ''}${m.tipo ? ' · 🏷️ ' + esc(String(m.tipo).trim()) : ''}`, key: String(m.serial || m.code || ''), estado: estadoOf(m), color: estadoColor(estadoOf(m)) })),
      ...vehPickups.map((v) => ({ label: `<b>${esc(v.plate ?? '—')}</b>${v.brand || v.model ? ' · ' + esc([v.brand, v.model].filter(Boolean).join(' ')) : ''}`, key: String(v.plate || ''), estado: 'Operativo', color: '#0B7A3B' })),
    ].sort((a, b) => cmpText(a.key, b.key));
    const pickupsHtml = pickItems.length
      ? `<div class="disp">🔰 A disposición de los encargados de <b>SOS LA GUAIRA</b></div>
         <table class="tac"><thead><tr><th style="width:30px">Nº</th><th>Camioneta pick-up</th><th>Estado</th></tr></thead><tbody>${pickItems
          .map((it, i) => `<tr><td>${i + 1}</td><td>${it.label}</td><td style="color:${it.color};font-weight:700">${it.estado}</td></tr>`)
          .join('')}</tbody></table>`
      : `<p class="muted">No hay camionetas pick-up registradas.</p>`;
    const linea = (n = 1) => Array.from({ length: n }).map(() => '<div class="fill"></div>').join('');
    // Macro ESTE/OESTE de una máquina: ubicación de despliegue (campo `sector`: "oeste"→
    // Oeste, cualquier otra base→Este); si no hay, el GPS; y si tampoco, por defecto ESTE
    // (todas las bases son del ESTE salvo "Oeste"). Así NINGUNA queda "sin ubicación".
    // FICTICIO: usa el sector aleatorio (reparto simulado).
    const zonaMacroDe = (m: any): 'ESTE' | 'OESTE' => {
      if (ficticio) return sectorMacro(randSectorById.get(m.id) ?? null) ?? 'ESTE';
      const s = (m.sector && String(m.sector).trim().toLowerCase()) || '';
      if (s === 'oeste') return 'OESTE';
      if (s) return 'ESTE';
      return sectorMacro(sectorOf(m.latitude, m.longitude)) ?? 'ESTE';
    };
    // Resumen ARRIBA: cantidad de maquinaria por empresa (incluye pick-ups), con el total
    // en ESTE y en OESTE. Mismos DOS grupos que la lista: LICCIONE y GOLDEN TOUCH.
    const countByCo = new Map<string, { total: number; este: number; oeste: number }>();
    list.forEach((m) => {
      const c = grupoEmpresaDe(m);
      const e = countByCo.get(c) ?? { total: 0, este: 0, oeste: 0 };
      e.total += 1;
      if (zonaMacroDe(m) === 'OESTE') e.oeste += 1; else e.este += 1;
      countByCo.set(c, e);
    });
    const coTot = { este: 0, oeste: 0 };
    countByCo.forEach((v) => { coTot.este += v.este; coTot.oeste += v.oeste; });
    const resumenCoHtml = `<div class="sect">🏢 Cantidad de maquinaria por empresa</div>
      <table class="tac"><thead><tr><th>Empresa</th><th style="width:90px;text-align:right">Cantidad</th><th style="width:90px;text-align:right">🟢 Este</th><th style="width:90px;text-align:right">🟠 Oeste</th></tr></thead>
      <tbody>${['LICCIONE', 'GOLDEN TOUCH'].filter((g) => countByCo.has(g)).map((co) => { const v = countByCo.get(co)!; return `<tr><td>${esc(co)}</td><td style="text-align:right;font-weight:700">${v.total}</td><td style="text-align:right">${v.este}</td><td style="text-align:right">${v.oeste}</td></tr>`; }).join('') || '<tr><td colspan="4" style="text-align:center">Sin equipos</td></tr>'}</tbody>
      <tfoot><tr><td style="font-weight:800">TOTAL</td><td style="text-align:right;font-weight:800">${list.length}</td><td style="text-align:right;font-weight:800">${coTot.este}</td><td style="text-align:right;font-weight:800">${coTot.oeste}</td></tr></tfoot></table>`;
    let este = 0, oeste = 0, sinUbic = 0;
    list.forEach((m) => {
      const mac = zonaMacroDe(m);
      if (mac === 'OESTE') oeste++; else if (mac === 'ESTE') este++; else sinUbic++;
    });
    const resumenZonaHtml = `<div class="sect">🧭 Equipos por zona</div>
      <table class="tac"><thead><tr><th>Zona</th><th style="width:100px;text-align:right">Cantidad</th></tr></thead>
      <tbody><tr><td>ESTE</td><td style="text-align:right;font-weight:700">${este}</td></tr>
      <tr><td>OESTE</td><td style="text-align:right;font-weight:700">${oeste}</td></tr>${sinUbic > 0 ? `
      <tr><td>Desplegadas por todo el territorio de La Guaira</td><td style="text-align:right;font-weight:700">${sinUbic}</td></tr>` : ''}</tbody>
      <tfoot><tr><td style="font-weight:800">TOTAL</td><td style="text-align:right;font-weight:800">${list.length}</td></tr></tfoot></table>`;
    // Resumen: equipos por UBICACIÓN DE DESPLIEGUE (base donde están/pernoctan): Este,
    // Oeste, CDT, CDF, Santa Eduviges, Escuela Naval. Es un campo de TEXTO (machinery.sector),
    // NO usa GPS (no satura el mapa). Orden fijo de las 6; "Sin ubicación" solo si queda alguna.
    const UBIS = ['Este', 'Oeste', 'CDT', 'CDF', 'Santa Eduviges', 'Escuela Naval'];
    const ubiCount = new Map<string, number>(UBIS.map((u) => [u, 0]));
    let ubiSin = 0;
    list.forEach((m) => {
      const s = (m.sector && String(m.sector).trim()) || '';
      if (ubiCount.has(s)) ubiCount.set(s, (ubiCount.get(s) || 0) + 1); else ubiSin++;
    });
    const UBI_LABEL: Record<string, string> = {
      'CDT': 'CDT · Centro de Distribución Temporal',
      'CDF': 'CDF · Centro de Distribución Final',
    };
    const ubiRows = UBIS.map((u) => `<tr><td>${esc(UBI_LABEL[u] || u)}</td><td style="text-align:right;font-weight:700">${ubiCount.get(u) || 0}</td></tr>`).join('')
      + (ubiSin > 0 ? `<tr><td>Desplegadas por todo el territorio de La Guaira</td><td style="text-align:right;font-weight:700">${ubiSin}</td></tr>` : '');
    const resumenUbicacionHtml = `<div class="sect">📍 Equipos por ubicación de despliegue</div>
      <table class="tac"><thead><tr><th>Ubicación</th><th style="width:100px;text-align:right">Cantidad</th></tr></thead>
      <tbody>${ubiRows}</tbody>
      <tfoot><tr><td style="font-weight:800">TOTAL</td><td style="text-align:right;font-weight:800">${list.length}</td></tr></tfoot></table>`;
    // Resumen: TOTAL por TIPO de maquinaria (Jumbo, Payloader…) y DÓNDE se ubican
    // (🟢 Este / 🟠 Oeste). Ej.: "PAYLOADER · 7 · 3 Este · 4 Oeste". A→Z natural.
    // Zona REAL por GPS; en el ficticio, por el sector aleatorio asignado.
    const macroDe = (m: any) => zonaMacroDe(m);
    const porTipoZona = new Map<string, { total: number; este: number; oeste: number; su: number }>();
    list.forEach((m) => {
      const k = equipCategory(m.code) || 'SIN TIPO';
      const e = porTipoZona.get(k) ?? { total: 0, este: 0, oeste: 0, su: 0 };
      e.total += 1;
      const mac = macroDe(m);
      if (mac === 'OESTE') e.oeste += 1; else if (mac === 'ESTE') e.este += 1; else e.su += 1;
      porTipoZona.set(k, e);
    });
    const tipoZTot = { este: 0, oeste: 0 };
    porTipoZona.forEach((v) => { tipoZTot.este += v.este; tipoZTot.oeste += v.oeste; });
    const resumenTipoZonaHtml = `<div class="sect">🚜 Total por tipo de maquinaria · 🟢 Este / 🟠 Oeste</div>
      <table class="tac"><thead><tr><th>Tipo de maquinaria</th><th style="width:80px;text-align:right">Total</th><th style="width:80px;text-align:right">🟢 Este</th><th style="width:80px;text-align:right">🟠 Oeste</th></tr></thead>
      <tbody>${[...porTipoZona.entries()].sort((a, b) => cmpText(a[0], b[0])).map(([k, v]) => `<tr><td>${esc(k)}</td><td style="text-align:right;font-weight:700">${v.total}</td><td style="text-align:right">${v.este}</td><td style="text-align:right">${v.oeste}</td></tr>`).join('') || `<tr><td colspan="4" style="text-align:center">Sin equipos</td></tr>`}</tbody>
      <tfoot><tr><td style="font-weight:800">TOTAL</td><td style="text-align:right;font-weight:800">${list.length}</td><td style="text-align:right;font-weight:800">${tipoZTot.este}</td><td style="text-align:right;font-weight:800">${tipoZTot.oeste}</td></tr></tfoot></table>
      <div style="font-size:12px;color:#374151;margin:6px 0 2px 0">🌙 Las <b>VOLQUETAS</b> y los <b>TORONTOS</b> pernoctan en <b>CAMURÍ CHICO (ESTE)</b>; durante el día son desplegados a los sectores que requieran su servicio (<b>ESTE / OESTE</b>).</div>`;
    // ── 📍 DESPLIEGUE POR SECTOR (localidad) Y EDIFICIO ─────────────────────────
    // Pedido: ver las UBICACIONES por sector con su ref/edificio y cuántos equipos de cada
    // tipo hay en cada sitio (ej. "3 JUMBO en Caraballeda Este"). La localidad sale del GPS
    // (sectorLabel → "Este · Caraballeda"). Las máquinas que NO están en el mapa (sin GPS) NO
    // se reparten por sector: van todas a un grupo "SIN UBICACIÓN" mostrando su placa/serial.
    // El edificio es la referencia del catálogo. Refleja la ubicación REAL al generar el reporte.
    const edificioDe = (m: any) => { const r = (m.referencia && String(m.referencia).trim()) || ''; return r && !/^[\d.,\s\/-]+$/.test(r) ? r : 'Sin edificio'; };
    const gpsSectorOf = (m: any) => (ficticio ? (randSectorById.get(m.id) ?? null) : sectorOf(m.latitude, m.longitude));
    const secDot = (label: string) => (label.startsWith('Oeste') ? '🟠' : label.startsWith('Este') ? '🟢' : '⚪');
    // localidad → edificio → tipo → cantidad (+ total por localidad). Solo las UBICADAS (GPS).
    const bySector = new Map<string, { total: number; edificios: Map<string, Map<string, number>> }>();
    const sinUbicMachines: any[] = []; // sin GPS → no aparecen en el mapa
    list.forEach((m) => {
      const gps = gpsSectorOf(m);
      if (!gps) { sinUbicMachines.push(m); return; }
      const secL = sectorLabel(gps); // "Este · Caraballeda"
      const edi = edificioDe(m);
      const tipo = equipCategory(m.code) || 'SIN TIPO';
      const g = bySector.get(secL) ?? { total: 0, edificios: new Map<string, Map<string, number>>() };
      g.total += 1;
      const em = g.edificios.get(edi) ?? new Map<string, number>();
      em.set(tipo, (em.get(tipo) ?? 0) + 1);
      g.edificios.set(edi, em);
      bySector.set(secL, g);
    });
    // Orden: Este primero, luego Oeste; dentro A→Z natural.
    const secRank = (l: string) => (l.startsWith('Este') ? 0 : l.startsWith('Oeste') ? 1 : 2);
    const sectorsSorted = [...bySector.entries()].sort((a, b) => secRank(a[0]) - secRank(b[0]) || cmpText(a[0], b[0]));
    // Grupo SIN UBICACIÓN: las que no marcan GPS, con su placa/serial (para poder ubicarlas).
    const sinUbicSorted = sinUbicMachines.slice().sort((a, b) => cmpText(equipCategory(a.code), equipCategory(b.code)) || cmpText(a.code ?? '', b.code ?? ''));
    const sinUbicHtml = sinUbicSorted.length
      ? `<div class="ente">📍 <b>DESPLEGADAS POR TODO EL TERRITORIO DE LA GUAIRA</b> <span class="cnt-pill">${sinUbicSorted.length} equipo(s)</span></div>
         <table class="tac"><thead><tr><th style="width:30px">Nº</th><th>Equipo · Tipo</th><th>Marca/Modelo</th><th>Placa / Serial</th><th>Edificio / referencia</th></tr></thead><tbody>${sinUbicSorted.map((m, i) => `<tr><td>${i + 1}</td><td><b>${esc(equipCategory(m.code))}</b><br/><span style="color:#6B7280;font-size:11px">${esc(m.code ?? '—')}</span></td><td>${esc((m.tipo && String(m.tipo).trim()) || '—')}</td><td>${esc(m.plate || m.serial || '—')}</td><td>${esc(edificioDe(m))}</td></tr>`).join('')}</tbody></table>`
      : '';
    const despliegueSectorHtml = `<div class="sect">📍 Despliegue por sector y edificio · ubicación al ${new Date().toLocaleString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>`
      + (sectorsSorted.length ? sectorsSorted.map(([secL, g]) => {
        const ediRows = [...g.edificios.entries()].sort((a, b) => cmpText(a[0], b[0])).map(([edi, tipos]) => {
          const tiposTxt = [...tipos.entries()].sort((a, b) => cmpText(a[0], b[0])).map(([t, n]) => `<b>${n}</b> ${esc(t)}`).join(' · ');
          const sub = [...tipos.values()].reduce((s, n) => s + n, 0);
          return `<tr><td>${esc(edi)}</td><td>${tiposTxt}</td><td style="text-align:right;font-weight:700">${sub}</td></tr>`;
        }).join('');
        return `<div class="ente">${secDot(secL)} <b>${esc(secL)}</b> <span class="cnt-pill">${g.total} equipo(s)</span></div>
          <table class="tac"><thead><tr><th>Edificio / referencia</th><th>Equipos (por tipo)</th><th style="width:60px;text-align:right">Cant.</th></tr></thead><tbody>${ediRows}</tbody></table>`;
      }).join('') : (sinUbicHtml ? '' : '<p class="muted">Sin equipos.</p>'))
      + sinUbicHtml;
    // Resumen: cantidad por CLASIFICACIÓN (Excavadora, Volteo…). A→Z natural.
    const countByClasif = new Map<string, number>();
    list.forEach((m) => { const c = (m.clasificacion && String(m.clasificacion).trim()) || 'Sin clasificación'; countByClasif.set(c, (countByClasif.get(c) ?? 0) + 1); });
    const resumenClasifHtml = `<div class="sect">🏷️ Cantidad por clasificación</div>
      <table class="tac"><thead><tr><th>Clasificación</th><th style="width:100px;text-align:right">Cantidad</th></tr></thead>
      <tbody>${[...countByClasif.entries()].sort((a, b) => cmpText(a[0], b[0])).map(([c, n]) => `<tr><td>${esc(c)}</td><td style="text-align:right;font-weight:700">${n}</td></tr>`).join('') || '<tr><td colspan="2" style="text-align:center">Sin equipos</td></tr>'}</tbody>
      <tfoot><tr><td style="font-weight:800">TOTAL</td><td style="text-align:right;font-weight:800">${list.length}</td></tr></tfoot></table>`;
    // Resumen: equipos A DISPOSICIÓN / a cargo de cada ente (CVM, Gobernación, FANB…).
    // SOS La Guaira (equipos propios) va al final. Se cuentan TODOS los equipos.
    const countByEnte = new Map<string, number>();
    list.forEach((m) => { const e = enteOf(m); countByEnte.set(e, (countByEnte.get(e) ?? 0) + 1); });
    const enteSorted = [...countByEnte.entries()].sort((a, b) => (a[0] === 'SOS La Guaira' ? 1 : b[0] === 'SOS La Guaira' ? -1 : cmpText(a[0], b[0])));
    // Etiqueta a mostrar: SOS La Guaira lleva el responsable (Jesús Lozada). El resto igual.
    const enteLabel = (e: string) => (e === 'SOS La Guaira' ? 'SOS La Guaira · Jesús Lozada' : e);
    const resumenEnteHtml = `<div class="sect">🚜 Equipos a disposición de (ente / institución)</div>
      <div style="font-size:12px;color:#374151;margin:-2px 0 8px 0">📍 Los equipos a disposición de (ente / institución) están desplegados por ambos sectores <b>ESTE</b> y <b>OESTE</b>.</div>
      <table class="tac"><thead><tr><th>A cargo de</th><th style="width:100px;text-align:right">Cantidad</th></tr></thead>
      <tbody>${enteSorted.map(([e, n]) => `<tr><td>${esc(enteLabel(e))}</td><td style="text-align:right;font-weight:700">${n}</td></tr>`).join('') || '<tr><td colspan="2" style="text-align:center">Sin equipos</td></tr>'}</tbody>
      <tfoot><tr><td style="font-weight:800">TOTAL</td><td style="text-align:right;font-weight:800">${list.length}</td></tr></tfoot></table>`;
    // Con personal: coordinadores e inspectores repartidos entre ESTE y OESTE (rotación).
    const pickZona = (arr: string[], z: number) => arr.filter((_, i) => i % 2 === z);
    const celda = (arr: string[]) => (arr.length ? arr.map((n) => esc(n)).join('<br/>') : '—');
    const zonaPersonalHtml = conPersonal
      ? `<table class="tac"><thead><tr><th style="width:80px">Zona</th><th>Coordinadores</th><th>Inspectores</th></tr></thead>
         <tbody>${['ESTE', 'OESTE'].map((z, idx) => `<tr><td style="font-weight:700">${z}</td><td>${celda(pickZona(coordinadores, idx))}</td><td>${celda(pickZona(inspectores, idx))}</td></tr>`).join('')}</tbody></table>`
      : '';
    // TODO el personal, SOLO TOTALES por departamento (unificado / inferido del cargo).
    const depTot = new Map<string, number>();
    activeEmps.forEach((e) => { const d = normalizeDept(e.department, e.cargo); depTot.set(d, (depTot.get(d) ?? 0) + 1); });
    const resumenPersonalHtml = conPersonal
      ? `<table class="tac"><thead><tr><th>Departamento</th><th style="width:110px;text-align:right">Cantidad</th></tr></thead>
         <tbody>${[...depTot.entries()].sort((a, b) => cmpText(a[0], b[0])).map(([d, n]) => `<tr><td>${esc(d)}</td><td style="text-align:right;font-weight:700">${n}</td></tr>`).join('') || '<tr><td colspan="2" style="text-align:center">Sin personal</td></tr>'}</tbody>
         <tfoot><tr><td style="font-weight:800">TOTAL PERSONAL</td><td style="text-align:right;font-weight:800">${activeEmps.length}</td></tr></tfoot></table>`
      : '';
    const body = `
      <style>
        .sect{margin:14px 0 4px;font-size:13px;font-weight:800;color:#1E3A5F;border-left:4px solid ${PDF_ACCENT};padding-left:8px}
        .box{border:1px solid #D1D5DB;border-radius:8px;padding:10px 12px;margin:6px 0 12px}
        .fill{border-bottom:1px solid #9CA3AF;height:15px;margin:8px 0}
        .kv{font-size:12px;color:#374151;margin:4px 0}.kv b{color:#111}
        table.tac{width:100%;border-collapse:collapse;margin:4px 0 12px;font-size:12px}
        table.tac th,table.tac td{border:1px solid #ccc;padding:6px 9px;text-align:left;vertical-align:top}
        table.tac th{background:#1E3A5F;color:#fff}
        table.tac tfoot td{background:#EEF2F7;font-weight:800}
        .ente{margin:12px 0 2px;font-size:12.5px;color:#111}
        .cnt-pill{background:#EEF2F7;color:#1E3A5F;border-radius:10px;padding:1px 8px;font-size:11px;font-weight:700}
        .muted{color:#6B7280;font-size:12px}
        .disp{font-size:12.5px;color:#0B3D2E;background:#E7F5EC;border:1px solid #B7E0C4;border-radius:6px;padding:6px 10px;margin:4px 0 8px}
        .legend{font-size:11px;color:#374151}.legend b{color:#111}
      </style>
      ${resumenCoHtml}
      ${resumenTipoZonaHtml}
      ${resumenClasifHtml}
      <div class="sect">🏢 Maquinaria por empresa (LICCIONE / GOLDEN TOUCH)</div>
      ${maquinariaHtml}
      ${conPersonal ? `<div class="sect">👥 Personal por departamento (totales)</div>${resumenPersonalHtml}<div class="sect">👷 Coordinadores e inspectores por zona</div>${zonaPersonalHtml}` : ''}`;
    const subBase = 'Operación Rescate y Esperanza – La Guaira';
    const subtitle = `${subBase}${conPersonal ? ' · Con personal' : ''}${ficticio ? ' · SIMULADO' : ''}`;
    const fileName = `Reporte - Despliegue de maquinaria${conPersonal ? ' con personal' : ''}${ficticio ? ' (simulado)' : ''}`;
    await exportPdf(pdfShell('DESPLIEGUE DE MAQUINARIA', subtitle, body), fileName);
  };

  // Reporte de PERSONAL COMPLETO: MOVIDO a Nómina · Personal → src/lib/personalReport.ts
  // (generatePersonalReport). Se quitó de Reportes por pedido del cliente.

  // Imprime el LISTADO del detalle (activos / inactivos / stand by / total flota).
  const downloadDetailPdf = async (kind: 'activo' | 'inactivo' | 'standby' | 'flota') => {
    if (!conteo) return;
    const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const titulo = kind === 'activo' ? 'Equipos activos' : kind === 'inactivo' ? 'Equipos inactivos' : kind === 'standby' ? 'Equipos en stand by' : 'Total flota';
    const items = kind === 'flota' ? conteo.machinesAll : conteo.machinesAll.filter((m) => m.estado === kind);
    const estLbl = (e: MachineDetail['estado']) => e === 'activo' ? 'ACTIVO' : e === 'inactivo' ? 'INACTIVO' : 'STAND BY';
    const showEstado = kind === 'flota';
    const rows = items.map((m, i) => `<tr><td>${i + 1}</td><td>${esc(m.company)}</td><td style="font-weight:700">${esc(m.code)}</td><td>${esc(m.serial ?? '—')}</td><td>${esc(m.tipo)}</td><td>${esc(m.modelo ?? '—')}</td><td>${esc(m.encargado ?? '—')}</td>${showEstado ? `<td>${estLbl(m.estado)}</td>` : ''}</tr>`).join('');
    const body = `
      <style>
        table.cnt{width:100%;border-collapse:collapse;margin:6px 0 16px;font-size:12px}
        table.cnt th,table.cnt td{border:1px solid #ccc;padding:6px 10px;text-align:left}
        table.cnt th{background:#1E3A5F;color:#fff}
      </style>
      <table class="cnt"><thead><tr><th style="width:30px">#</th><th>Empresa</th><th>Máquina</th><th>Serial</th><th>Tipo de equipo</th><th>Marca/Modelo</th><th>Encargado</th>${showEstado ? '<th>Estado</th>' : ''}</tr></thead>
        <tbody>${rows}</tbody></table>`;
    await exportPdf(pdfShell(titulo.toUpperCase(), `${items.length} equipos`, body), `Reportes - ${titulo}`);
  };

  // Reporte "Control camiones Entradas/Salidas": camiones por empresa, por semana
  // (dom→sáb) del mes elegido. Hoja para registrar entrada/salida por día.
  // Trae y agrupa por empresa TODOS los camiones/transporte. Entran: camión, chuto (con
  // volqueta/batea/lowboy), volteo/toronto/volquetas y cisternas (agua o combustible).
  // Se busca en el NOMBRE (code), el modelo (tipo) y la clasificación, porque en muchas
  // máquinas el "modelo" viene vacío y el tipo real está en el nombre.
  const buildTruckCompanies = useCallback(async (re: RegExp = TRUCK_RE) => {
    const mach = await selectAllRows('machinery', 'code, plate, serial, tipo, clasificacion, company:company_id(name)');
    const trucks = (mach ?? [])
      .filter((m: any) => re.test(`${m.code || ''} ${canonTipo(m.tipo) || ''} ${m.clasificacion || ''}`.toUpperCase()))
      .map((m: any) => ({ code: m.code as string, plate: (m.plate ?? null) as string | null, serial: (m.serial ?? null) as string | null, tipo: (m.tipo && String(m.tipo).trim()) || null, company: m.company?.name || 'Sin empresa' }))
      .sort((a, b) => cmpText(a.company, b.company) || cmpText(a.code, b.code));
    const map = new Map<string, { code: string; plate: string | null; serial: string | null; tipo: string | null }[]>();
    trucks.forEach((t) => { const a = map.get(t.company) ?? []; a.push({ code: t.code, plate: t.plate, serial: t.serial, tipo: t.tipo }); map.set(t.company, a); });
    return [...map.entries()].map(([company, items]) => ({ company, items }));
  }, []);

  const generateCamiones = async () => {
    setLoading(true);
    const companies = await buildTruckCompanies();
    const escompanies = await buildTruckCompanies(ESCOMBRO_RE);
    setCamData({ monthLabel: `${MES_NOMBRES[camMonth0]} ${camYear}`, weeks: weeksOfMonth(camYear, camMonth0), companies, escompanies });
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
              .map((t) => `<tr><td class="nm">${esc(t.code)}${t.tipo ? `<br/><span style="font-weight:400;color:#6B7280">🏷️ ${esc(t.tipo)}</span>` : ''}</td><td class="ps">${esc(t.plate || t.serial || '—')}</td>${w.days.map(() => cell).join('')}</tr>`)
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

  // Reporte "Transporte de escombros": mismos equipos de volteo, hoja por semana con
  // CHECK de turno DÍA / NOCHE por día (se marca a mano al imprimir).
  const downloadEscombrosPdf = async (weekN?: number) => {
    if (!camData) return;
    const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const dayTh = (d: { name: string; iso: string }) => `<th class="d">${d.name.slice(0, 3).toUpperCase()}<br><span class="dt">${fmtDM(d.iso)}</span></th>`;
    const cell = `<td class="c"><div class="ck">☐ Día</div><div class="ck">☐ Noche</div></td>`;
    const weeksToPrint = weekN == null ? camData.weeks : camData.weeks.filter((w) => w.n === weekN);
    const sel = weekN == null ? null : weeksToPrint[0] || null;
    const cos = camData.escompanies ?? [];
    // Resumen ARRIBA: cantidad total de equipos por empresa.
    const totalEq = cos.reduce((s, co) => s + co.items.length, 0);
    const resumenHtml = `<h2 class="wk">Cantidad de equipos por empresa</h2>
      <table class="res"><thead><tr><th>Empresa</th><th class="qty">Cantidad</th></tr></thead>
      <tbody>${cos.map((co) => `<tr><td>${esc(co.company)}</td><td class="qty">${co.items.length}</td></tr>`).join('') || '<tr><td colspan="2" style="text-align:center">Sin equipos</td></tr>'}</tbody>
      <tfoot><tr><td>TOTAL</td><td class="qty">${totalEq}</td></tr></tfoot></table>`;
    const weeksHtml = weeksToPrint
      .map((w) => {
        const companiesHtml = cos
          .map((co) => {
            const rows = co.items
              .map((t) => `<tr><td class="nm">${esc(t.code)}${t.tipo ? `<br/><span style="font-weight:400;color:#6B7280">🏷️ ${esc(t.tipo)}</span>` : ''}</td><td class="ps">${esc(t.plate || t.serial || '—')}</td>${w.days.map(() => cell).join('')}</tr>`)
              .join('');
            return `<h3 class="emp">🏢 ${esc(co.company)} — ${co.items.length} equipo(s)</h3>
              <table class="cam"><thead><tr><th class="nm">Equipo</th><th class="ps">Placa/Serial</th>${w.days.map(dayTh).join('')}</tr></thead>
              <tbody>${rows || '<tr><td colspan="9" style="text-align:center">Sin equipos</td></tr>'}</tbody></table>`;
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
      table.cam td.c .ck{border-bottom:1px solid #ddd;font-size:8px;color:#333;padding:2px;height:15px;text-align:left}
      table.res{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:12px}
      table.res th,table.res td{border:1px solid #bbb;padding:5px 9px;text-align:left}
      table.res th{background:#1E3A5F;color:#fff}
      table.res .qty{text-align:right;font-weight:800;width:110px}
      table.res tfoot td{background:#EEF2F7;font-weight:800}
    </style>
    <div class="muted">${esc(camData.monthLabel)}${sel ? ` · Semana ${sel.n} (del ${fmtDMY(sel.from)} al ${fmtDMY(sel.to)})` : ''} · Marca ☐ Día / ☐ Noche por día (a mano)</div>
    ${resumenHtml}
    ${weeksHtml || '<p class="muted">Sin equipos de transporte de escombros.</p>'}`;
    const subLabel = sel ? `${camData.monthLabel} · Semana ${sel.n}` : camData.monthLabel;
    const fileLabel = sel ? `Reportes - Escombros Semana ${sel.n}` : 'Reportes - Escombros';
    await exportPdf(pdfShell('TRANSPORTE DE ESCOMBROS · TURNOS DÍA/NOCHE', subLabel, body), fileLabel);
  };

  // PDF de MAQUINARIA: listado de identidad/catálogo de las máquinas que trabajaron
  // en el rango — Máquina, Marca, Modelo, Placa, Serial, Clasificación. Depurado
  // 17-ago-2026 a pedido del cliente (antes mezclaba vehículos + horas/averías/paradas).
  const downloadFleetPdf = async () => {
    const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const alcance = repCompanies.length === 1 ? `Empresa: ${repCompanies[0]}` : repCompanies.length > 1 ? `Empresas: ${repCompanies.join(', ')}` : 'General · todas las empresas';

    // Agrupado POR EMPRESA: la empresa va como TÍTULO arriba de cada bloque (no como
    // columna repetida). Dentro de cada empresa, la tabla lista solo los datos de la máquina.
    const groups = new Map<string, FleetItem[]>();
    fleetItems.forEach((it) => {
      const arr = groups.get(it.company) ?? [];
      arr.push(it);
      groups.set(it.company, arr);
    });
    const bloques = Array.from(groups.keys())
      .sort((a, b) => cmpText(a, b))
      .map((co) => {
        const rows = (groups.get(co) ?? [])
          .slice()
          .sort((a, b) => cmpText(a.name, b.name))
          .map(
            (it) =>
              `<tr><td>${esc(it.name)}</td><td>${esc(it.marca)}</td><td>${esc(it.modelo)}</td><td>${esc(it.plate || '—')}</td><td>${esc(it.serial || '—')}</td><td>${esc(it.tipo)}</td></tr>`
          )
          .join('');
        return `<h2 class="emp">🏢 ${esc(co)} — ${(groups.get(co) ?? []).length} máquina(s)</h2>
          <table><thead><tr><th style="text-align:left">Máquina</th><th style="text-align:left">Marca</th><th style="text-align:left">Modelo</th><th style="text-align:left">Placa</th><th style="text-align:left">Serial</th><th style="text-align:left">Clasificación</th></tr></thead>
          <tbody>${rows}</tbody></table>`;
      })
      .join('');

    const body = `<style>.emp{font-size:14px;color:#1E3A5F;font-weight:800;margin:16px 0 4px}</style>
      <div class="muted">${esc(alcance)} · Flota disponible: operativas, averiadas y esperando instrucciones (sin retiradas) · del ${fmtDMY(from)} al ${fmtDMY(to)}</div>
      <div class="summary">
        <div><span class="k">Máquinas</span><b>${fleetItems.length}</b></div>
        <div><span class="k">Empresas</span><b>${groups.size}</b></div>
      </div>
      ${bloques || '<p class="muted">Sin maquinaria en el rango.</p>'}`;
    await exportPdf(pdfShell('REPORTE DE MAQUINARIA', alcance, body), 'Reportes - Maquinaria');
  };

  // PDF del conteo por tipo TILDADO: total (solo número) + cantidad por tipo y por empresa.
  const downloadTipoCountPdf = async () => {
    if (!tipoResultado) return;
    const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const { total, empresas } = tipoResultado;
    const sel = [...tiposSel]
      .map((k) => ({ k, name: tipoMap.get(k)?.name ?? k, count: tipoMap.get(k)?.count ?? 0 }))
      .sort((a, b) => cmpText(a.name, b.name));
    const tipoRows = sel
      .map((t) => `<tr><td>${esc(t.name)}</td><td style="text-align:right;font-weight:700">${t.count}</td></tr>`)
      .join('');
    const estadoLbl = tipoEstado === 'todas' ? 'Todos los estados' : tipoEstado === 'activas' ? 'Solo activas' : 'Solo inactivas';
    // Cantidad POR CLASIFICACIÓN de los equipos seleccionados (Excavadora, Volteo… con su
    // total), A→Z natural. Sale junto al desglose por tipo de equipo.
    const porClasif = new Map<string, number>();
    empresas.forEach((e) => e.items.forEach((m) => {
      const k = ((m as any).clas && String((m as any).clas).trim()) || 'Sin clasificación';
      porClasif.set(k, (porClasif.get(k) ?? 0) + 1);
    }));
    const clasifRows = [...porClasif.entries()]
      .sort((a, b) => cmpText(a[0], b[0]))
      .map(([k, n]) => `<tr><td>${esc(k)}</td><td style="text-align:right;font-weight:700">${n}</td></tr>`)
      .join('');
    // Listado AGRUPADO por empresa: nombre de la máquina, serial/placa y encargado.
    const listRows = empresas.map((e) => `
      <tr><td colspan="5" style="background:#eef2f7;font-weight:800;color:#1E3A5F">🏢 ${esc(e.company)}${companyRif[e.company] ? ` · RIF ${esc(companyRif[e.company])}` : ''} — ${e.count}</td></tr>
      ${e.items.map((m, i) => `<tr>
        <td style="width:26px;text-align:right;color:#888">${i + 1}</td>
        <td>${esc(m.code)}</td>
        <td>${esc(m.modelo || '—')}</td>
        <td>${esc(m.serial || m.plate || '—')}</td>
        <td>${esc(m.encargado || '—')}</td>
      </tr>`).join('')}
    `).join('');
    const body = `
      <div class="summary">
        <div><span class="k">Total de equipos</span><b>${total}</b></div>
        <div><span class="k">Tipos</span><b>${sel.length}</b></div>
        <div><span class="k">Empresas</span><b>${empresas.length}</b></div>
      </div>
      <h2>Cantidad por tipo de equipo</h2>
      <table><thead><tr><th style="text-align:left">Tipo de equipo</th><th style="text-align:right">Cantidad</th></tr></thead>
      <tbody>${tipoRows || '<tr><td colspan="2" style="text-align:center">Sin datos</td></tr>'}</tbody>
      <tfoot><tr><td style="text-align:right">TOTAL</td><td style="text-align:right;font-weight:800">${total}</td></tr></tfoot></table>
      <h2 style="margin-top:16px">Cantidad por clasificación</h2>
      <table><thead><tr><th style="text-align:left">Clasificación</th><th style="text-align:right">Cantidad</th></tr></thead>
      <tbody>${clasifRows || '<tr><td colspan="2" style="text-align:center">Sin datos</td></tr>'}</tbody>
      <tfoot><tr><td style="text-align:right">TOTAL</td><td style="text-align:right;font-weight:800">${total}</td></tr></tfoot></table>
      <h2 style="margin-top:16px">Listado por empresa</h2>
      <table><thead><tr><th style="text-align:right">#</th><th style="text-align:left">Máquina</th><th style="text-align:left">Marca/Modelo</th><th style="text-align:left">Serial / Placa</th><th style="text-align:left">Encargado</th></tr></thead>
      <tbody>${listRows || '<tr><td colspan="5" style="text-align:center">Sin coincidencias</td></tr>'}</tbody></table>`;
    await exportPdf(pdfShell('CANTIDAD POR TIPO DE EQUIPO', `${sel.length} tipo(s) · ${estadoLbl}`, body), 'Reportes - Cantidad por tipo');
  };

  // Abrir automáticamente un reporte al llegar con parámetros (p. ej. desde
  // "Ver reporte" en Control de maquinaria → reporte de rondas de ese día).
  // Carga la lista de empresas para el selector del reporte por jornada.
  useEffect(() => {
    supabase.from('companies').select('name, rif, hidden, food_only').order('name').then(({ data }) => {
      const visibles = (data ?? []).filter((c: any) => !c.hidden && !c.food_only && c.name);
      setCompanyList(visibles.map((c: any) => c.name));
      const rif: Record<string, string> = {};
      visibles.forEach((c: any) => { if (c.rif) rif[c.name] = c.rif; });
      setCompanyRif(rif);
    });
  }, []);

  // Encargados por empresa (para el picker de "Agrupar por → Encargado" del Informe por
  // jornada). Se lee una vez el catálogo (solo encargado + empresa) y se agrupa; así al
  // marcar una empresa salen SOLO sus responsables.
  useEffect(() => {
    (async () => {
      const rows = await selectAllRows('machinery', 'encargado, company:company_id(name)');
      const map: Record<string, Set<string>> = {};
      ((rows ?? []) as any[]).forEach((m) => {
        const enc = String(m.encargado ?? '').trim();
        if (!enc) return;
        const co = m.company?.name ?? 'Sin empresa';
        (map[co] ||= new Set<string>()).add(enc);
      });
      const out: Record<string, string[]> = {};
      Object.entries(map).forEach(([co, s]) => { out[co] = Array.from(s).sort((a, b) => cmpText(a, b)); });
      setEncByCompany(out);
    })().catch(() => {});
  }, []);

  // Encargados que se muestran en el picker: los de la(s) empresa(s) marcada(s); si no hay
  // ninguna marcada (= Todas), salen todos los encargados.
  const encargadosScoped = useMemo(() => {
    const set = new Set<string>();
    const cos = repCompanies.length ? new Set(repCompanies) : null;
    Object.entries(encByCompany).forEach(([company, encs]) => {
      if (cos && !cos.has(company)) return;
      encs.forEach((e) => set.add(e));
    });
    return Array.from(set).sort((a, b) => cmpText(a, b));
  }, [encByCompany, repCompanies]);
  // Si cambia la empresa marcada, quita los encargados seleccionados que ya no están en
  // el alcance (evita filtrar por un responsable que no pertenece a la empresa elegida).
  useEffect(() => {
    setRepEncargados((prev) => {
      const next = prev.filter((e) => encargadosScoped.includes(e));
      return next.length === prev.length ? prev : next;
    });
  }, [encargadosScoped]);

  // Lista de CLASIFICACIONES para el filtro del reporte de maquinaria. Se carga DIFERIDO
  // (solo al entrar a ese reporte), no al abrir el módulo: paginar TODAS las máquinas al
  // abrir hacía lento el arranque de Reportes.
  useEffect(() => {
    if (mode !== 'fleet' || typeList.length > 0) return;
    selectAllRows('machinery', 'clasificacion').then((rows) => {
      const set = new Set<string>();
      (rows ?? []).forEach((m: any) => { const t = canonTipo(m.clasificacion); if (t) set.add(t); });
      setTypeList(Array.from(set).sort((a, b) => cmpText(a, b)));
    });
  }, [mode, typeList.length]);

  // Camiones E/S EN LÍNEA: mientras la vista previa esté abierta, refresca la lista de
  // camiones al instante si cambian las máquinas (nueva, editada o eliminada).
  useEffect(() => {
    if (!camPreview) return;
    let timer: any;
    const refresh = async () => {
      const companies = await buildTruckCompanies();
      const escompanies = await buildTruckCompanies(ESCOMBRO_RE);
      setCamData((prev) => (prev ? { ...prev, companies, escompanies } : prev));
    };
    const ch = supabase.channel(`rt-camiones-es-${rtId.current}`);
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
          { v: 'fleet', label: '🚜 Maquinaria' },
          { v: 'deploy', label: '🚜 Despliegue' },
          { v: 'conteo', label: '📊 Conteo equipos' },
          { v: 'camiones', label: '🚛 Camiones E/S' },
          { v: 'inspectores', label: '👷 Inspectores' },
        ] as const).map((t) => {
          const active = mode === t.v;
          return (
            <TouchableOpacity
              key={t.v}
              onPress={() => {
                setMode(t.v);
                // Jornada arranca en HOY (fecha del día) por defecto; el usuario amplía el
                // rango con los botones de abajo. Maquinaria (fleet) sí arranca en la semana base.
                if (t.v === 'rounds') { setFrom(isoDaysAgo(0)); setTo(isoDaysAgo(0)); }
                if (t.v === 'fleet') { setFrom(FLEET_HOURS_START); setTo(isoDaysAgo(0)); }
                // Despliegue arranca desde la semana base hasta HOY (editable).
                if (t.v === 'deploy') { setFrom(FLEET_HOURS_START); setTo(isoDaysAgo(0)); }
                // Inspectores (jornadas de inspección): reporte de UN día; arranca en HOY.
                if (t.v === 'inspectores') { setFrom(isoDaysAgo(0)); }
              }}
              style={{
                flexGrow: 1,
                flexBasis: '30%',
                minWidth: 110,
                paddingVertical: spacing.md,
                borderRadius: radius.md,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: active ? colors.brand : colors.border,
                backgroundColor: active ? colors.brand : colors.surfaceAlt,
              }}
            >
              <Text style={{ color: active ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{t.label}</Text>
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
        ) : mode === 'inspeccion' ? (
          <View>
            <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.xs }}>
              Reporte DIARIO de inspección: máquina, serial/placa, sector, edificio, inspector y horas (día/noche/total).
              Agrupado por inspector; las que no tienen inspector salen como “⚠️ FALTA INSPECTOR” con su encargado.
              No incluye equipos de CVM / Gobernación / FANB.
            </Text>
            <Text style={styles.lbl}>Día</Text>
            <DateField value={from} onChange={setFrom} />
          </View>
        ) : mode === 'inspectores' ? (
          <View>
            <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.xs }}>
              Reporte de INSPECTORES (jornadas de inspección): agrupado por inspector, con sus máquinas,
              horas de día/noche/total, desglose por sector y las ubicaciones cuando una máquina cambió de sitio.
              La jornada de día es de un inspector y la de noche de otro. Al final, líneas para firmar.
            </Text>
            <Text style={styles.lbl}>Día</Text>
            <DateField value={from} onChange={setFrom} />
            <Text style={[styles.lbl, { marginTop: spacing.sm }]}>Turno</Text>
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              {([
                { v: 'day', label: '☀️ Día' },
                { v: 'night', label: '🌙 Noche' },
                { v: 'both', label: '☀️🌙 Ambos' },
              ] as const).map((s) => {
                const on = inspShift === s.v;
                return (
                  <TouchableOpacity
                    key={s.v}
                    onPress={() => setInspShift(s.v)}
                    style={{
                      flex: 1,
                      paddingVertical: spacing.sm,
                      borderRadius: radius.md,
                      alignItems: 'center',
                      borderWidth: 1,
                      borderColor: on ? colors.brand : colors.border,
                      backgroundColor: on ? colors.brand : colors.surfaceAlt,
                    }}
                  >
                    <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{s.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.lbl, { marginTop: spacing.sm }]}>Agrupar por</Text>
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              {([
                { v: 'inspector', label: '👷 Inspector' },
                { v: 'encargado', label: '🧑‍🔧 Encargado' },
              ] as const).map((g) => {
                const on = inspGroupBy === g.v;
                return (
                  <TouchableOpacity
                    key={g.v}
                    onPress={() => setInspGroupBy(g.v)}
                    style={{
                      flex: 1,
                      paddingVertical: spacing.sm,
                      borderRadius: radius.md,
                      alignItems: 'center',
                      borderWidth: 1,
                      borderColor: on ? colors.brand : colors.border,
                      backgroundColor: on ? colors.brand : colors.surfaceAlt,
                    }}
                  >
                    <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{g.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Inspectores del turno elegido (checks, dinámico según día/turno/empresa) */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm }}>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Inspectores (marca uno o varios)</Text>
              {inspSelected.length > 0 ? (
                <TouchableOpacity onPress={() => setInspSelected([])}>
                  <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>Limpiar</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {inspLoadingList ? (
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>Buscando inspectores…</Text>
            ) : inspAvailable.length === 0 ? (
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>
                Sin jornadas de inspección para esta fecha/turno/empresa.
              </Text>
            ) : (
              <View style={{ marginTop: spacing.xs }}>
                <TouchableOpacity
                  onPress={() => setInspSelected([])}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs }}
                >
                  <View style={{ width: 22, height: 22, borderRadius: radius.sm, borderWidth: 2, borderColor: inspSelected.length === 0 ? colors.brand : colors.border, backgroundColor: inspSelected.length === 0 ? colors.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                    {inspSelected.length === 0 ? <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 13 }}>✓</Text> : null}
                  </View>
                  <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800' }}>👷 Todos</Text>
                </TouchableOpacity>
                {inspAvailable.map((n) => {
                  const checked = inspSelected.includes(n);
                  return (
                    <TouchableOpacity
                      key={n}
                      onPress={() => setInspSelected((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n]))}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs }}
                    >
                      <View style={{ width: 22, height: 22, borderRadius: radius.sm, borderWidth: 2, borderColor: checked ? colors.brand : colors.border, backgroundColor: checked ? colors.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                        {checked ? <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 13 }}>✓</Text> : null}
                      </View>
                      <Text style={{ color: colors.text, fontSize: 14, flex: 1 }}>{n}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
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
        {/* AGRUPAR POR — solo en el Informe por jornada. Cambia cómo se PARTE el PDF,
            no qué máquinas entran: el filtro de empresas de aquí abajo se sigue
            aplicando igual. La plata (fletes, abonos, "Totales por empresa") sale
            SIEMPRE por empresa, porque un flete se le cobra a la empresa y no a la
            persona que cuida la máquina. Pedido del cliente (21-ago-2026): «que el
            reporte funcione como viene funcionando, pero que se pueda agrupar por
            encargado». */}
        {mode === 'rounds' ? (
          <>
            <Text style={[styles.lbl, { marginTop: spacing.sm }]}>Agrupar por</Text>
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              {([{ v: 'empresa', label: '🏢 Empresa' }, { v: 'encargado', label: '🧑‍🔧 Encargado' }] as const).map((g) => {
                const on = roundsGroupBy === g.v;
                return (
                  <TouchableOpacity
                    key={g.v}
                    onPress={() => setRoundsGroupBy(g.v)}
                    activeOpacity={0.85}
                    style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt }}
                  >
                    <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{g.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
              No cambia los números ni saca máquinas: solo si el informe viene partido por empresa o por responsable. Los fletes, los abonos y el saldo por pagar salen siempre por empresa.
            </Text>
          </>
        ) : null}
        {/* Filtro por empresa (multi-selección con checks) — aplica a TODOS los reportes. */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm }}>
          <Text style={{ color: colors.muted, fontSize: 12 }}>Empresas (marca una o varias)</Text>
          {repCompanies.length > 0 ? (
            <TouchableOpacity onPress={() => setRepCompanies([])}>
              <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>Limpiar</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <View style={{ marginTop: spacing.xs }}>
          <TouchableOpacity
            onPress={() => setRepCompanies([])}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs }}
          >
            <View style={{ width: 22, height: 22, borderRadius: radius.sm, borderWidth: 2, borderColor: repCompanies.length === 0 ? colors.brand : colors.border, backgroundColor: repCompanies.length === 0 ? colors.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              {repCompanies.length === 0 ? <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 13 }}>✓</Text> : null}
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
                <View style={{ width: 22, height: 22, borderRadius: radius.sm, borderWidth: 2, borderColor: checked ? colors.brand : colors.border, backgroundColor: checked ? colors.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {checked ? <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 13 }}>✓</Text> : null}
                </View>
                <Text style={{ color: colors.text, fontSize: 14, flex: 1 }}>{c}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* AGRUPAR POR ENCARGADO → lista de encargados de la(s) empresa(s) marcada(s).
            Al elegir uno o varios, el informe sale SOLO con esos responsables (agrupado
            por encargado). Vacío = todos los encargados de la(s) empresa(s). */}
        {mode === 'rounds' && roundsGroupBy === 'encargado' ? (
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm }}>
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                Encargados{repCompanies.length ? ` de ${repCompanies.length === 1 ? repCompanies[0] : `${repCompanies.length} empresas`}` : ' (todas las empresas)'}
              </Text>
              {repEncargados.length > 0 ? (
                <TouchableOpacity onPress={() => setRepEncargados([])}>
                  <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>Limpiar ({repEncargados.length})</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {encargadosScoped.length === 0 ? (
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>
                {Object.keys(encByCompany).length === 0 ? 'Cargando encargados…' : 'No hay encargados para esta empresa.'}
              </Text>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
                {encargadosScoped.map((e) => {
                  const on = repEncargados.includes(e);
                  return (
                    <TouchableOpacity
                      key={e}
                      onPress={() => setRepEncargados((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]))}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}
                    >
                      <Text style={{ color: on ? colors.brandContrast : colors.muted, fontSize: 13, fontWeight: '800' }}>{on ? '☑' : '☐'}</Text>
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontSize: 13, fontWeight: '700' }}>👤 {e}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </>
        ) : null}

        {/* Filtro por TIPO de maquinaria (checks) — solo en Maquinaria/Vehículo */}
        {mode === 'fleet' && typeList.length > 0 ? (
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm }}>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Clasificación (marca una o varias)</Text>
              {fleetTypes.length > 0 ? (
                <TouchableOpacity onPress={() => setFleetTypes([])}>
                  <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>Limpiar ({fleetTypes.length})</Text>
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
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}
                  >
                    <Text style={{ color: on ? colors.brandContrast : colors.muted, fontSize: 13, fontWeight: '800' }}>{on ? '☑' : '☐'}</Text>
                    <Text style={{ color: on ? colors.brandContrast : colors.text, fontSize: 13, fontWeight: '700' }}>{t}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        ) : null}
        </>
        )}
        {/* Informe por jornada: switch CONTENIDO — Completo (con precios) / Solo horas
            (todos los datos sin precio). Solo afecta el PDF impreso. */}
        {mode === 'rounds' ? (
          <View style={{ marginBottom: spacing.sm }}>
            <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.xs, textTransform: 'uppercase', letterSpacing: 0.3 }}>Contenido del reporte</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {[{ v: false, label: '📋 Completo', desc: 'con precios y montos' }, { v: true, label: '🕒 Solo horas', desc: 'todos los datos, sin precios' }].map((o) => {
                const on = jornadaSoloHoras === o.v;
                return (
                  <TouchableOpacity key={String(o.v)} onPress={() => setJornadaSoloHoras(o.v)} style={{ flex: 1, borderWidth: 1.5, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                    <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 13 }}>{o.label}</Text>
                    <Text style={{ color: on ? colors.brandContrast : colors.muted, fontSize: 10, marginTop: 1 }}>{o.desc}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
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
              : mode === 'deploy'
              ? generateDeploy()
              : mode === 'conteo'
              ? generateConteo()
              : mode === 'inspeccion'
              ? generateInspeccion(from)
              : mode === 'inspectores'
              ? (async () => { setLoading(true); try { await generateInspectorReport({ date: from, shift: inspShift, companies: repCompanies, inspectors: inspSelected, groupBy: inspGroupBy }); } finally { setLoading(false); } })()
              : generateCamiones()
          }
          disabled={loading}
        >
          <Text style={{ color: colors.brandContrast, fontWeight: '700' }}>
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
              : mode === 'inspeccion'
              ? '🔍 Generar INSPECCIÓN DE EQUIPOS (PDF)'
              : mode === 'inspectores'
              ? '👷 Generar REPORTE DE INSPECTORES (PDF)'
              : '🚛 Ver camiones Entradas/Salidas del mes'}
          </Text>
        </TouchableOpacity>
      </Card>

      {loading ? <Loading /> : null}

      {/* Vista previa del CONTEO de equipos */}
      <Modal visible={conteoPreview} animationType="slide" onRequestClose={() => setConteoPreview(false)}>
        <Screen>
          <TouchableOpacity onPress={() => setConteoPreview(false)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm }}>
            <Text style={{ color: colors.brandText, fontSize: 20, fontWeight: '800' }}>←</Text>
            <Text style={{ color: colors.brandText, fontWeight: '700' }}>Volver</Text>
          </TouchableOpacity>
          <SectionTitle>📊 Conteo de equipos</SectionTitle>
          {conteo ? (
            <>
              {/* Switch: agrega al PDF el desglose por inspector y el detalle equipo→inspector.
                  No hace falta regenerar el conteo — los inspectores ya vienen cargados. */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.xs }}>
                <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700', flex: 1 }}>
                  {conteoConInspector ? '👷 Con inspector asignado (☀️ día · 🌙 noche)' : '📊 Solo el conteo (sin inspector)'}
                </Text>
                <Switch value={conteoConInspector} onValueChange={setConteoConInspector} />
              </View>
              {/* Botón de descarga ARRIBA (a la mano, sin bajar hasta el final). */}
              <TouchableOpacity style={[styles.btn, { backgroundColor: colors.accent, marginBottom: spacing.sm }]} onPress={downloadConteoPdf}>
                <Text style={{ color: colors.accentContrast, fontWeight: '700' }}>⬇️ Descargar PDF{conteoConInspector ? ' · con inspector' : ''}</Text>
              </TouchableOpacity>
              {/* Reporte Diario de Operaciones (máquinas reales por a cargo de + ubicaciones). */}
              {/* Switch: solo ubicaciones (por defecto) o CON PERSONAL (operadores por máquina + coordinadores/inspectores por zona). */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.xs }}>
                <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700', flex: 1 }}>
                  {tacConPersonal ? '👷 Con personal (operadores, coordinadores, inspectores)' : '📍 Solo ubicaciones'}
                </Text>
                <Switch value={tacConPersonal} onValueChange={setTacConPersonal} />
              </View>
              <TouchableOpacity style={[styles.btn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.brand, marginBottom: spacing.sm }]} onPress={() => downloadTacticalPdf(tacConPersonal)}>
                <Text style={{ color: colors.brandText, fontWeight: '800' }}>📍 Ubicaciones tácticas{tacConPersonal ? ' · con personal' : ''}</Text>
              </TouchableOpacity>
              {/* Versión SIMULADA/ficticia: todas las máquinas OPERATIVAS y repartidas al azar Este/Oeste (para presentaciones). */}
              <TouchableOpacity style={[styles.btn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.warning, marginBottom: spacing.sm }]} onPress={() => downloadTacticalPdf(tacConPersonal, true)}>
                <Text style={{ color: colors.warning, fontWeight: '800' }}>🎭 Ubicaciones tácticas (SIMULADO){tacConPersonal ? ' · con personal' : ''}</Text>
              </TouchableOpacity>
              {/* Zona 100% real por GPS, igual que el Mapa: sin reparto 50/50 para las máquinas sin GPS. */}
              <TouchableOpacity style={[styles.btn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.brand, marginBottom: spacing.sm }]} onPress={downloadConteoZonaMapaPdf}>
                <Text style={{ color: colors.brandText, fontWeight: '800' }}>🗺️ Zona real por GPS (igual al Mapa)</Text>
              </TouchableOpacity>
              {/* "👥 Personal por departamento" se movió a Nómina · Personal (pedido del cliente). */}
              {/* Estado de la flota (toca una tarjeta para ver el detalle de sus máquinas). */}
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
                {[
                  { k: 'Activos (conteo)', v: conteo.activos, c: colors.success, d: 'activo' as const },
                  { k: 'Inactivos (excl.)', v: conteo.inactivos, c: colors.danger, d: 'inactivo' as const },
                  { k: 'Stand by (excl.)', v: conteo.standby, c: colors.warning, d: 'standby' as const },
                  { k: 'Total flota', v: conteo.flota, c: colors.text, d: 'flota' as const },
                ].map((s) => (
                  <TouchableOpacity key={s.k} activeOpacity={0.7} onPress={() => setConteoDetail(s.d)} style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                    <Text style={{ color: s.c, fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] as any }}>{s.v}</Text>
                    <Text style={{ color: colors.muted, fontSize: 10, textAlign: 'center' }}>{s.k}</Text>
                    <Text style={{ color: colors.brandText, fontSize: 9, fontWeight: '700', marginTop: 1 }}>ver detalle ›</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Buscador CON CHECKS por tipo de equipo: tilda uno o varios tipos y ve el
                  reporte correspondiente (total + cantidad por empresa) con su PDF. */}
              <Card>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, marginBottom: 2 }}>🔎 Buscar por tipo de equipo</Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
                  Busca (ej. “volqueta toronto”) y TILDA los tipos para ver el total y la cantidad por empresa.
                </Text>
                {/* Alcance por ESTADO: todas / solo activas / solo inactivas. */}
                <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.xs }}>
                  {([['todas', 'Todas'], ['activas', '🟢 Solo activas'], ['inactivas', '🔴 Solo inactivas']] as const).map(([k, label]) => {
                    const on = tipoEstado === k;
                    return (
                      <TouchableOpacity key={k} onPress={() => setTipoEstado(k)} style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1.5, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt }}>
                        <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TextInput
                  value={tipoQ}
                  onChangeText={setTipoQ}
                  placeholder="Ej. volqueta toronto…"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="characters"
                  style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text }}
                />
                {/* Tildar TODAS (las que muestra el buscador ahora) o limpiar la selección. */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xs, flexWrap: 'wrap' }}>
                  <TouchableOpacity onPress={() => setTiposSel(new Set(tipoOpciones.map((o) => o.key)))} disabled={tipoOpciones.length === 0}>
                    <Text style={{ color: tipoOpciones.length === 0 ? colors.muted : colors.brandText, fontWeight: '700', fontSize: 12 }}>✓ Seleccionar todas ({tipoOpciones.length})</Text>
                  </TouchableOpacity>
                  {tiposSel.size > 0 ? (
                    <TouchableOpacity onPress={() => setTiposSel(new Set())}>
                      <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 12 }}>✕ Limpiar selección ({tiposSel.size})</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                <ScrollView style={{ maxHeight: 220, marginTop: spacing.xs }} nestedScrollEnabled>
                  {tipoOpciones.length === 0 ? (
                    <Text style={{ color: colors.muted, fontSize: 13, paddingVertical: spacing.sm }}>Sin coincidencias.</Text>
                  ) : (
                    tipoOpciones.map((o) => {
                      const on = tiposSel.has(o.key);
                      return (
                        <TouchableOpacity key={o.key} onPress={() => toggleTipo(o.key)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                          <View style={{ width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                            {on ? <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 13 }}>✓</Text> : null}
                          </View>
                          <Text style={{ color: colors.text, fontSize: 13, flex: 1 }} numberOfLines={1}>{o.name}</Text>
                          <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '700' }}>{o.count}</Text>
                        </TouchableOpacity>
                      );
                    })
                  )}
                </ScrollView>
                {tipoResultado ? (
                  <View style={{ marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
                      <Text style={{ color: colors.brandText, fontSize: 40, fontWeight: '800', fontVariant: ['tabular-nums'] as any }}>{tipoResultado.total}</Text>
                      <Text style={{ color: colors.muted, fontSize: 13 }}>equipo(s) · {tipoResultado.empresas.length} empresa(s)</Text>
                    </View>
                    {/* Botón ARRIBA (antes del listado) para no tener que bajar toda la lista. */}
                    <TouchableOpacity style={[styles.btn, { backgroundColor: colors.brand, marginTop: spacing.sm, marginBottom: spacing.xs }]} onPress={downloadTipoCountPdf}>
                      <Text style={{ color: colors.brandContrast, fontWeight: '700', fontSize: 13 }}>⬇️ PDF de este conteo</Text>
                    </TouchableOpacity>
                    <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: spacing.xs, marginBottom: 2 }}>Listado por empresa</Text>
                    {tipoResultado.empresas.map((e) => (
                      <View key={e.company} style={{ marginBottom: spacing.xs }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                          <Text style={{ color: colors.brandText, fontSize: 12.5, fontWeight: '800', flex: 1 }} numberOfLines={1}>🏢 {e.company}</Text>
                          <Text style={{ color: colors.brandText, fontSize: 12.5, fontWeight: '800' }}>{e.count}</Text>
                        </View>
                        {e.items.map((m, i) => (
                          <View key={`${m.code}-${m.serial ?? m.plate ?? i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 5, paddingHorizontal: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                            <Text style={{ color: colors.muted, fontSize: 11, width: 20 }}>{i + 1}.</Text>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12.5, fontWeight: '700' }}>{m.code}</Text>
                              {m.modelo ? <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11 }}>🏷️ {m.modelo}</Text> : null}
                              <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11 }}>
                                🔖 {m.serial || m.plate || 'Sin serial/placa'}{m.encargado ? `  ·  👤 ${m.encargado}` : ''}
                              </Text>
                            </View>
                            <Text style={{ color: m.estado === 'activo' ? colors.success : m.estado === 'inactivo' ? colors.danger : colors.warning, fontSize: 10, fontWeight: '800' }}>{m.estado === 'activo' ? 'ACTIVO' : m.estado === 'inactivo' ? 'INACTIVO' : 'STAND BY'}</Text>
                          </View>
                        ))}
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>Tilda al menos un tipo para ver el reporte.</Text>
                )}
              </Card>

              {/* Filtro por EMPRESA (multi-selección). Cliente 17-ago-2026: el conteo de
                  Reportes solo filtraba por zona; ahora se pueden marcar las empresas que
                  se quieran. La lista sale de las MÁQUINAS DEL PROPIO CONTEO (no de la
                  tabla `companies`), así no salen empresas con 0 equipos y sí sale
                  "Sin empresa" si la hay. Ninguna marcada = todas. */}
              {(() => {
                const cnt = new Map<string, number>();
                conteo.activeRows.forEach((r) => cnt.set(r.company, (cnt.get(r.company) ?? 0) + 1));
                const empresas = [...cnt.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => cmpText(a.name, b.name));
                if (empresas.length <= 1) return null; // una sola empresa: el filtro no aporta
                return (
                  <Card>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 14, flex: 1 }}>🏢 Filtrar por empresa</Text>
                      {conteoEmpresas.size > 0 ? (
                        <TouchableOpacity onPress={() => setConteoEmpresas(new Set())}>
                          <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 12 }}>✕ Limpiar ({conteoEmpresas.size})</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                      {empresas.map((e) => {
                        const on = conteoEmpresas.has(e.name);
                        return (
                          <TouchableOpacity key={e.name} onPress={() => toggleConteoEmpresa(e.name)}
                            style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}>
                            <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 12 }}>{on ? '✓ ' : ''}{e.name} · {e.count}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <Text style={{ color: colors.muted, fontSize: 11, marginTop: 6 }}>
                      {conteoEmpresas.size === 0
                        ? 'Ninguna marcada = TODAS las empresas. Toca las que quieras para dejar solo esas.'
                        : `Mostrando ${conteoEmpresas.size} empresa(s). Las tablas de abajo y el PDF salen solo con esas.`}
                    </Text>
                  </Card>
                );
              })()}

              {/* Filtro por ZONA GEOGRÁFICA (sector del mapa, según GPS). Cada chip muestra
                  cuántas máquinas hay ubicadas en esa zona; "Sin zona" = sin ubicación GPS.
                  Al elegir una, las tablas de abajo se recalculan solo con esa zona. */}
              {(() => {
                const chips: { key: string; label: string; count: number }[] = [
                  { key: '__all__', label: 'Todas', count: conteo.total },
                  ...conteo.zonaCounts.map((z) => ({ key: z.name, label: z.name, count: z.count })),
                ];
                return (
                  <Card>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 14, flex: 1 }}>🗺️ Filtrar por zona (ubicación en el mapa)</Text>
                      <TouchableOpacity onPress={() => setConteoMap(true)} style={{ backgroundColor: colors.brand, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
                        <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>🗺️ Ver en mapa</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                      {chips.map((z) => {
                        const on = conteoZona === z.key;
                        return (
                          <TouchableOpacity key={z.key} onPress={() => setConteoZona(z.key)}
                            style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}>
                            <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 12 }}>{z.label} · {z.count}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <Text style={{ color: colors.muted, fontSize: 11, marginTop: 6 }}>
                      {conteoZona !== '__all__'
                        ? `Mostrando solo ${conteoZona}.`
                        : `Total ${conteo.total} equipos activos · TODOS ubicados (${conteo.ubicadosGps} por GPS; el resto repartido 50/50 en Este/Oeste, sin tocar el mapa). Para la zona 100% real (sin reparto), usa el botón "🗺️ Zona real por GPS (igual al Mapa)" arriba.`}
                    </Text>
                  </Card>
                );
              })()}

              {/* A DISPOSICIÓN DE: los entes (Gobernación, FANB, CVM…), cuántas máquinas y en
                  qué sector (Este / Oeste) las que están ubicadas. Cuenta TODAS las transferidas. */}
              {conteo.dispoDetail.length ? (
                <Card>
                  <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 15, marginBottom: 2 }}>🏛️ A disposición de</Text>
                  <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>Máquinas a disposición de cada ente y en qué sector (Este / Oeste) las ubicadas.</Text>
                  {conteo.dispoDetail.map((d) => {
                    const parts = [d.este ? `${d.este} en Este` : '', d.oeste ? `${d.oeste} en Oeste` : ''].filter(Boolean).join(' · ');
                    return (
                      <View key={d.name} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 5, borderTopWidth: 1, borderTopColor: colors.border }}>
                        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800', flex: 1 }}>{d.name}{parts ? <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 12 }}> · {parts}</Text> : null}</Text>
                        <Text style={{ color: colors.brandText, fontSize: 15, fontWeight: '900' }}>{d.total}</Text>
                      </View>
                    );
                  })}
                </Card>
              ) : null}

              {/* Desglose "por tipo y zona" (solo en la vista de TODAS): para cada tipo, cuántas
                  hay en cada zona. Ej.: JUMBO (21): 9 en Este · Caraballeda, 4 en Oeste · Aeropuerto… */}
              {conteoZona === '__all__' ? (() => {
                const m = new Map<string, { total: number; sec: Map<string, number> }>();
                conteo.activeRows.forEach((r) => {
                  if (r.zona === 'Sin zona') return; // solo ubicadas
                  if (!m.has(r.tipo)) m.set(r.tipo, { total: 0, sec: new Map() });
                  const e = m.get(r.tipo)!; e.total += 1; e.sec.set(r.zona, (e.sec.get(r.zona) ?? 0) + 1);
                });
                const rows = [...m.entries()].sort((a, b) => cmpText(a[0], b[0]));
                if (!rows.length) return null;
                return (
                  <Card>
                    <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 15, marginBottom: 4 }}>Por tipo y zona <Text style={{ color: colors.muted, fontSize: 11 }}>(Este / Oeste)</Text></Text>
                    {rows.map(([tipo, e]) => {
                      const parts = [...e.sec.entries()].sort((a, b) => (a[0] === 'Sin zona' ? 1 : b[0] === 'Sin zona' ? -1 : cmpText(a[0], b[0]))).map(([s, n]) => `${n} en ${s}`).join(' · ');
                      return (
                        <View key={tipo} style={{ paddingVertical: 5, borderTopWidth: 1, borderTopColor: colors.border }}>
                          <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>{tipo} <Text style={{ color: colors.muted, fontWeight: '700' }}>({e.total})</Text></Text>
                          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 1 }}>{parts}</Text>
                        </View>
                      );
                    })}
                  </Card>
                );
              })() : null}

              {/* Máquinas SIN ubicación (no marcan GPS), desglosadas por tipo de equipo. */}
              {conteoZona === '__all__' ? (() => {
                const m = new Map<string, number>();
                conteo.activeRows.forEach((r) => { if (r.zona === 'Sin zona') m.set(r.tipo, (m.get(r.tipo) ?? 0) + 1); });
                const rows = [...m.entries()].sort((a, b) => cmpText(a[0], b[0]));
                const sinUbic = conteo.total - conteo.ubicadosGps;
                if (!sinUbic) return null;
                return (
                  <Card>
                    <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 15, marginBottom: 2 }}>📍 Sin ubicación en el mapa ({sinUbic})</Text>
                    <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>Máquinas activas que aún no marcan GPS, por tipo de equipo.</Text>
                    {rows.map(([tipo, n]) => (
                      <View key={tipo} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4, borderTopWidth: 1, borderTopColor: colors.border }}>
                        <Text style={{ color: colors.text, fontSize: 13, flex: 1 }}>{tipo}</Text>
                        <Text style={{ color: colors.warning, fontSize: 14, fontWeight: '800' }}>{n}</Text>
                      </View>
                    ))}
                  </Card>
                );
              })() : null}

              {/* Tablas del conteo (recalculadas según la zona elegida). */}
              {(() => {
                // Filtro por ZONA y por EMPRESA. `rowsZona` es el embudo del que salen TODAS las
    // tablas del conteo (byClas, byTipo, totales, desglose por inspector), así que
    // filtrar acá deja todo consistente de una sola vez. Sin empresas marcadas = todas.
    const rowsZona = conteo.activeRows
      .filter((r) => conteoZona === '__all__' || r.zona === conteoZona)
      .filter((r) => empresaEnConteo(r.company));
                const aggregate = (key: 'clas' | 'tipo'): ConteoRow[] => {
                  const m = new Map<string, ConteoRow>();
                  rowsZona.forEach((r) => { const k = r[key]; const a = m.get(k) ?? { name: k, count: 0, conHoras: 0, sinHoras: 0 }; a.count += 1; if (r.tieneHoras) a.conHoras += 1; else a.sinHoras += 1; m.set(k, a); });
                  return [...m.values()].sort((a, b) => cmpText(a.name, b.name));
                };
                const byClas = aggregate('clas');
                const byTipo = aggregate('tipo');
                const totalCnt = rowsZona.length;
                const colFor = colors.brandText;
                const tableCard = (title: string, rows: ConteoRow[]) => (
                  <Card>
                    <View style={{ flexDirection: 'row', marginBottom: 4 }}>
                      <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 15, flex: 1 }}>{title}</Text>
                      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700', width: 70, textAlign: 'right' }}>CANTIDAD</Text>
                    </View>
                    {rows.map((r) => (
                      <View key={r.name} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 5, borderTopWidth: 1, borderTopColor: colors.border }}>
                        <Text style={{ color: colors.text, fontSize: 13, flex: 1 }}>{r.name}</Text>
                        <Text style={{ color: colFor, fontSize: 14, fontWeight: '800', width: 70, textAlign: 'right', fontVariant: ['tabular-nums'] as any }}>{r.count}</Text>
                      </View>
                    ))}
                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderTopWidth: 2, borderTopColor: colors.border }}>
                      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800', flex: 1 }}>TOTAL</Text>
                      <Text style={{ color: colFor, fontSize: 15, fontWeight: '900', width: 70, textAlign: 'right', fontVariant: ['tabular-nums'] as any }}>{totalCnt}</Text>
                    </View>
                  </Card>
                );
                return (
                  <>
                    {tableCard('Por clasificación', byClas)}
                    {tableCard('Por tipo de equipo', byTipo)}
                  </>
                );
              })()}
              <View style={{ height: spacing.xl }} />
            </>
          ) : null}
        </Screen>

        {/* Detalle de un estado al tocar una tarjeta KPI. */}
        <Modal visible={conteoDetail !== null} animationType="slide" transparent onRequestClose={() => setConteoDetail(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
            <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '85%', padding: spacing.lg }}>
              {(() => {
                if (!conteo || conteoDetail === null) return null;
                const titulo = conteoDetail === 'activo' ? 'Equipos activos' : conteoDetail === 'inactivo' ? 'Equipos inactivos' : conteoDetail === 'standby' ? 'Equipos en stand by' : 'Total flota';
                const items = conteoDetail === 'flota' ? conteo.machinesAll : conteo.machinesAll.filter((m) => m.estado === conteoDetail);
                const badge = (e: MachineDetail['estado']) => e === 'activo' ? { t: 'ACTIVO', c: colors.success } : e === 'inactivo' ? { t: 'INACTIVO', c: colors.danger } : { t: 'STAND BY', c: colors.warning };
                return (
                  <>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
                      <Text style={{ color: colors.text, fontWeight: '900', fontSize: 17 }}>{titulo} ({items.length})</Text>
                      <TouchableOpacity onPress={() => setConteoDetail(null)} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}>
                        <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
                      </TouchableOpacity>
                    </View>
                    {/* Imprimir / descargar ESTA lista. */}
                    <TouchableOpacity onPress={() => downloadDetailPdf(conteoDetail)} style={{ backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', marginBottom: spacing.sm }}>
                      <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>⬇️ Imprimir esta lista (PDF)</Text>
                    </TouchableOpacity>
                    <ScrollView>
                      {items.length === 0 ? (
                        <Text style={{ color: colors.muted, fontSize: 13, paddingVertical: spacing.md }}>No hay equipos en este estado.</Text>
                      ) : items.map((m, i) => {
                        const b = badge(m.estado);
                        return (
                          <View key={`${m.code}-${m.serial ?? i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 7, borderTopWidth: 1, borderTopColor: colors.border }}>
                            <Text style={{ color: colors.muted, fontSize: 12, width: 26, textAlign: 'right' }}>{i + 1}</Text>
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{m.code}</Text>
                              {m.modelo ? <Text style={{ color: colors.muted, fontSize: 11 }}>🏷️ {m.modelo}</Text> : null}
                              <Text style={{ color: colors.muted, fontSize: 11 }}>🏢 {m.company}{m.serial ? ` · Serial ${m.serial}` : ''} · {m.tipo}</Text>
                              {m.encargado ? <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '700' }}>👤 Encargado: {m.encargado}</Text> : null}
                            </View>
                            {conteoDetail === 'flota' ? (
                              <View style={{ backgroundColor: b.c + '22', borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 }}>
                                <Text style={{ color: b.c, fontSize: 9, fontWeight: '900' }}>{b.t}</Text>
                              </View>
                            ) : null}
                          </View>
                        );
                      })}
                      <View style={{ height: spacing.xl }} />
                    </ScrollView>
                  </>
                );
              })()}
            </View>
          </View>
        </Modal>

        {/* Mapa por sectores: calles + zonas + puntos, y abajo las leyendas/detalle. */}
        <Modal visible={conteoMap} animationType="slide" onRequestClose={() => setConteoMap(false)}>
          <Screen>
            <TouchableOpacity onPress={() => setConteoMap(false)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm }}>
              <Text style={{ color: colors.brandText, fontSize: 20, fontWeight: '800' }}>←</Text>
              <Text style={{ color: colors.brandText, fontWeight: '700' }}>Volver al conteo</Text>
            </TouchableOpacity>
            <SectionTitle>Mapa por sectores</SectionTitle>
            {conteo ? (() => {
              // El mapa muestra SOLO los ubicados por GPS. Sus leyendas se agrupan en Este / Oeste.
              const zoneColor: Record<string, string> = { Este: '#1E88E5', Oeste: '#E5731E' };
              const macroOfPin = (p: MapPin): 'Este' | 'Oeste' | null => { const sec = sectorOf(p.lat, p.lng); return sec == null ? null : sec.startsWith('Oeste') ? 'Oeste' : 'Este'; };
              const macroCounts = new Map<string, number>();
              const tz = new Map<string, { total: number; sec: Map<string, number> }>();
              conteo.mapPins.forEach((p) => {
                const mm = macroOfPin(p); if (!mm) return;
                const tk = p.tipo || 'Sin tipo';
                macroCounts.set(mm, (macroCounts.get(mm) ?? 0) + 1);
                if (!tz.has(tk)) tz.set(tk, { total: 0, sec: new Map() });
                const e = tz.get(tk)!; e.total += 1; e.sec.set(mm, (e.sec.get(mm) ?? 0) + 1);
              });
              const zonaRows = [...macroCounts.entries()].sort((a, b) => cmpText(a[0], b[0]));
              const tzRows = [...tz.entries()].sort((a, b) => cmpText(a[0], b[0]));
              return (
                <>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
                    {conteo.mapPins.length} equipos ubicados por GPS · zonas y puntos sobre el mapa de calles.
                  </Text>
                  <VenezuelaMap pins={conteo.mapPins} zones={new Set(SUBSECTORS.map((_, i) => i))} streets height={360} />

                  {/* Leyenda: Este / Oeste con su color y conteo (solo GPS). */}
                  <Card>
                    <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 15, marginBottom: 4 }}>Zonas ({conteo.ubicadosGps} ubicados por GPS)</Text>
                    {zonaRows.map(([name, count]) => (
                      <View key={name} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4, borderTopWidth: 1, borderTopColor: colors.border }}>
                        <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: zoneColor[name] ?? colors.muted, marginRight: spacing.sm }} />
                        <Text style={{ color: colors.text, fontSize: 13, flex: 1 }}>{name}</Text>
                        <Text style={{ color: colors.brandText, fontSize: 14, fontWeight: '800' }}>{count}</Text>
                      </View>
                    ))}
                  </Card>

                  {/* Leyenda: a disposición de (Gobernación/FANB/CVM…), cuántas y en qué sector. */}
                  {conteo.dispoDetail.length ? (
                    <Card>
                      <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 15, marginBottom: 4 }}>🏛️ A disposición de</Text>
                      {conteo.dispoDetail.map((d) => {
                        const parts = [d.este ? `${d.este} en Este` : '', d.oeste ? `${d.oeste} en Oeste` : ''].filter(Boolean).join(' · ');
                        return (
                          <View key={d.name} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4, borderTopWidth: 1, borderTopColor: colors.border }}>
                            <Text style={{ color: colors.text, fontSize: 13, flex: 1 }}>{d.name}{parts ? <Text style={{ color: colors.muted, fontSize: 12 }}> · {parts}</Text> : null}</Text>
                            <Text style={{ color: colors.brandText, fontSize: 14, fontWeight: '800' }}>{d.total}</Text>
                          </View>
                        );
                      })}
                    </Card>
                  ) : null}

                  {/* Leyenda: por tipo y zona. */}
                  <Card>
                    <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 15, marginBottom: 4 }}>Por tipo y zona</Text>
                    {tzRows.map(([tipo, e]) => {
                      const parts = [...e.sec.entries()].sort((a, b) => cmpText(a[0], b[0])).map(([s, n]) => `${n} en ${s}`).join(' · ');
                      return (
                        <View key={tipo} style={{ paddingVertical: 5, borderTopWidth: 1, borderTopColor: colors.border }}>
                          <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>{tipo} <Text style={{ color: colors.muted, fontWeight: '700' }}>({e.total})</Text></Text>
                          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 1 }}>{parts}</Text>
                        </View>
                      );
                    })}
                  </Card>
                  <View style={{ height: spacing.xl }} />
                </>
              );
            })() : null}
          </Screen>
        </Modal>
      </Modal>

      <Modal visible={preview} animationType="slide" onRequestClose={() => setPreview(false)}>
        <Screen>
          <TouchableOpacity onPress={() => setPreview(false)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm }}>
            <Text style={{ color: colors.brandText, fontSize: 20, fontWeight: '800' }}>←</Text>
            <Text style={{ color: colors.brandText, fontWeight: '700' }}>Volver</Text>
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
                      <View style={{ width: 28, height: Math.max(4, (r.liters / maxDay) * 120), backgroundColor: colors.brand, borderRadius: 4 }} />
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
                    <View style={{ height: 8, width: `${(r.liters / maxAsset) * 100}%`, backgroundColor: colors.brand, borderRadius: radius.pill }} />
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
            <TouchableOpacity style={[styles.btn, { backgroundColor: colors.accent }]} onPress={downloadPdf}>
              <Text style={{ color: colors.accentContrast, fontWeight: '700' }}>⬇️ Descargar PDF</Text>
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
              <TouchableOpacity style={[styles.btn, { backgroundColor: colors.brand }]} onPress={() => setSelectedDay(null)}>
                <Text style={{ color: colors.brandContrast, fontWeight: '700' }}>Volver</Text>
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
            {roundsCompany ? <Text style={{ color: colors.brandText, fontWeight: '700', marginTop: 2 }}>🏢 {roundsCompany}</Text> : null}
            <Text style={{ color: colors.text, fontWeight: '800', marginTop: 2 }}>
              {roundGroups.reduce((s, g) => s + g.machines.length, 0)} máquina(s) · {nH(roundGroups.reduce((s, g) => s + g.totalH, 0))} · {usd(roundGroups.reduce((s, g) => s + g.totalUSD + g.viajesUSD, 0))}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>Solo equipos que trabajaron</Text>
            {(() => {
              const fact = roundGroups.reduce((s, g) => s + g.totalUSD + g.viajesUSD, 0);
              const abon = roundGroups.reduce((s, g) => s + (Number(g.abonado) || 0), 0);
              const saldo = Math.max(0, fact - abon);
              return abon > 0 ? (
                <Text style={{ fontSize: 13, marginTop: 4, fontWeight: '800', color: colors.text }}>
                  💰 Abonado <Text style={{ color: colors.success }}>{usd(abon)}</Text> · Saldo pendiente <Text style={{ color: colors.brandText }}>{usd(saldo)}</Text>
                </Text>
              ) : null;
            })()}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.xs }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success }} />
              <Text style={{ color: colors.success, fontSize: 11, fontWeight: '700' }}>En vivo · se actualiza solo al agregar o editar jornadas</Text>
            </View>
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
                  style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}
                >
                  <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Contenido del PDF: Completo (con precios) / Solo horas (sin precios). */}
          <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.xs, textTransform: 'uppercase', letterSpacing: 0.3 }}>Contenido del PDF</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
            {[{ v: false, label: '📋 Completo', desc: 'con precios y montos' }, { v: true, label: '🕒 Solo horas', desc: 'todos los datos, sin precios' }].map((o) => {
              const on = jornadaSoloHoras === o.v;
              return (
                <TouchableOpacity key={String(o.v)} onPress={() => setJornadaSoloHoras(o.v)} style={{ flex: 1, borderWidth: 1.5, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                  <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 13 }}>{o.label}</Text>
                  <Text style={{ color: on ? colors.brandContrast : colors.muted, fontSize: 10, marginTop: 1 }}>{o.desc}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity style={[styles.btn, { backgroundColor: colors.accent, marginBottom: spacing.sm }]} onPress={downloadRoundsPdf}>
            <Text style={{ color: colors.accentContrast, fontWeight: '700' }}>⬇️ Descargar PDF{jornadaSoloHoras ? ' (solo horas)' : ''}</Text>
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
            const genFletes = roundGroups.reduce((s, g) => s + g.viajesUSD, 0);
            const genEquipos = roundGroups.reduce((s, g) => s + g.machines.length, 0);
            const ph = (a: number, w: number) => (w > 0 ? usd(a / w) : '—');
            const clas = [...clasAgg.entries()].sort((a, b) => (a[0] === 'Sin clasificación' ? 1 : b[0] === 'Sin clasificación' ? -1 : cmpText(a[0], b[0])));
            const hdr = (a: string, b: string, c: string, d: string, e: string) => (
              <View style={{ flexDirection: 'row', backgroundColor: colors.brand, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 5, marginBottom: 2 }}>
                <Text style={{ flex: 2.4, fontSize: 11, color: colors.brandContrast, fontWeight: '800' }}>{a}</Text>
                <Text style={{ flex: 1, fontSize: 11, color: colors.brandContrast, fontWeight: '800', textAlign: 'right' }}>{b}</Text>
                <Text style={{ flex: 1.2, fontSize: 11, color: colors.brandContrast, fontWeight: '800', textAlign: 'right' }}>{c}</Text>
                <Text style={{ flex: 1.4, fontSize: 11, color: colors.brandContrast, fontWeight: '800', textAlign: 'right' }}>{d}</Text>
                <Text style={{ flex: 1.6, fontSize: 11, color: colors.brandContrast, fontWeight: '800', textAlign: 'right' }}>{e}</Text>
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
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 15, marginBottom: spacing.xs }}>📋 Reporte general</Text>
                <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 4 }}>Total por clasificación</Text>
                {hdr('CLASIFICACIÓN', 'CANT.', 'HORAS', '$/HORA', 'TOTAL')}
                {clas.map(([c, a]) => (
                  <React.Fragment key={c}>{row(c, String(a.count), nH(a.worked), ph(a.amount, a.worked), usd(a.amount))}</React.Fragment>
                ))}
                {row('TOTAL', String(genEquipos), nH(genWorked), ph(genAmount, genWorked), usd(genAmount), true)}

                <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: spacing.sm, marginBottom: 4 }}>Totales por empresa (equipos + fletes)</Text>
                {hdr('EMPRESA', 'EQUIP.', 'FLETES $', 'EQUIPOS $', 'TOTAL')}
                {roundGroups.map((g) => (
                  <React.Fragment key={g.company}>{row(g.company, String(g.machines.length), g.viajesUSD > 0 ? usd(g.viajesUSD) : '—', usd(g.totalUSD), usd(g.totalUSD + g.viajesUSD))}</React.Fragment>
                ))}
                {row('TOTAL', String(genEquipos), genFletes > 0 ? usd(genFletes) : '—', usd(genAmount), usd(genAmount + genFletes), true)}
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: 6 }}>El "Total" por empresa incluye los fletes/viajes del rango. La tabla por clasificación es solo equipos.</Text>
              </Card>
            );
          })() : null}

          {roundGroups.length === 0 ? (
            <EmptyState title="Sin datos" subtitle="No hay rondas en el rango seleccionado." />
          ) : (
            /* La vista previa se parte igual que el PDF, para que lo que se ve en
               pantalla sea lo que sale impreso. El RIF solo cuando el título es una
               empresa: al lado del nombre de una persona sería un dato falso. */
            (roundsGroupBy === 'encargado' ? roundGroupsEnc : roundGroups).map((g) => (
              <View key={g.company} style={{ marginBottom: spacing.sm }}>
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 15, marginBottom: 4, textTransform: 'uppercase' }}>
                  {roundsGroupBy === 'encargado' ? '👤' : '🏢'} {g.company}{roundsGroupBy === 'empresa' && companyRif[g.company] ? ` · RIF ${companyRif[g.company]}` : ''} ({g.machines.length})
                </Text>
                {/* Las que NO trabajaron, separadas por estado (igual que en el PDF): el
                    detalle por turno (día/noche) y su motivo salen al imprimir. */}
                {g.averias.length + g.paradas.length + g.espera.length > 0 ? (
                  <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>
                    {[
                      g.averias.length ? `🔴 ${g.averias.length} averiada(s)` : '',
                      g.paradas.length ? `🟡 ${g.paradas.length} parada(s)` : '',
                      g.espera.length ? `⏳ ${g.espera.length} esperando instrucciones` : '',
                    ].filter(Boolean).join('  ·  ')}
                  </Text>
                ) : null}
                {g.machines.map((m, i) => (
                  <Card key={i}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>{m.machine}{m.serial ? <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '400' }}>  ·  {m.serial}</Text> : null}</Text>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>Clasificación: {m.clasificacion}</Text>
                      </View>
                      <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 1 }}>
                        <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '700' }}>{m.tipo}</Text>
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
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginTop: 2 }}>
                      <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 13 }}>TOTAL POR PAGAR</Text>
                      <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 13 }}>{usd(g.totalUSD + g.viajesUSD)}</Text>
                    </View>
                  </View>
                ) : null}
                {/* Abonado y saldo (sincronizado con Control de Pagos), si hay abonos en el rango. */}
                {Number(g.abonado) > 0 ? (() => {
                  const totalPagar = g.totalUSD + g.viajesUSD;
                  const abonado = Number(g.abonado) || 0;
                  const saldo = Math.max(0, totalPagar - abonado);
                  return (
                    <View style={{ marginTop: 2 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: 3 }}>
                        <Text style={{ color: colors.success, fontWeight: '700', fontSize: 12 }}>Abonado</Text>
                        <Text style={{ color: colors.success, fontWeight: '700', fontSize: 12 }}>− {usd(abonado)}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.danger, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>SALDO POR PAGAR</Text>
                        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>{usd(saldo)}</Text>
                      </View>
                    </View>
                  );
                })() : null}
              </View>
            ))
          )}

          {/* Estado de la flota de maquinaria */}
          {roundGroups.length > 0 ? (
            <Card style={{ marginTop: spacing.md }}>
              <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 15, marginBottom: spacing.xs }}>Estado de la flota de maquinaria</Text>
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
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTopWidth: 2, borderTopColor: colors.brand }}>
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

      {/* Vista previa: Maquinaria/Vehículo — SOLO 3 bloques operativos/numéricos (sin $,
          eso vive en el reporte de Jornada). Depurado 08-ago-2026 a pedido del cliente. */}
      <Modal visible={fleetPreview} animationType="slide" onRequestClose={() => setFleetPreview(false)}>
        <Screen>
          <TouchableOpacity
            onPress={() => setFleetPreview(false)}
            activeOpacity={0.7}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}
          >
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>← Volver</Text>
          </TouchableOpacity>
          <SectionTitle>Maquinaria</SectionTitle>
          <ReportHeader title="REPORTE DE MAQUINARIA" colors={colors} />
          <Text style={{ color: colors.muted, fontSize: 13 }}>Del {from} al {to}</Text>

          <TouchableOpacity style={[styles.btn, { backgroundColor: colors.accent, marginTop: spacing.sm }]} onPress={downloadFleetPdf}>
            <Text style={{ color: colors.accentContrast, fontWeight: '700' }}>⬇️ Descargar PDF</Text>
          </TouchableOpacity>

          {fleetItems.length === 0 ? (
            <Card><Text style={{ color: colors.muted }}>Ninguna máquina en la flota disponible (todas están retiradas o no hay máquinas).</Text></Card>
          ) : (
            // Agrupado POR EMPRESA: cada empresa es un bloque con su título arriba (no columna).
            Array.from(
              fleetItems.reduce((m, it) => { (m.get(it.company) ?? m.set(it.company, []).get(it.company))!.push(it); return m; }, new Map<string, FleetItem[]>())
            )
              .sort((a, b) => cmpText(a[0], b[0]))
              .map(([company, machines]) => (
                <Card key={company}>
                  <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 15, marginBottom: 2 }}>🏢 {company}</Text>
                  <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.xs }}>{machines.length} máquina(s) en flota disponible (sin retiradas).</Text>
                  {machines
                    .slice()
                    .sort((a, b) => cmpText(a.name, b.name))
                    .map((it) => (
                      <View key={it.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{it.name}</Text>
                          {(it.marca !== '—' || it.modelo !== '—') ? (
                            <Text style={{ color: colors.muted, fontSize: 11 }}>🏷️ {[it.marca, it.modelo].filter((x) => x && x !== '—').join(' ')}</Text>
                          ) : null}
                          <Text style={{ color: colors.muted, fontSize: 11 }}>
                            🚗 {it.plate || '—'} · 🔢 {it.serial || '—'}
                          </Text>
                          <Text style={{ color: colors.muted, fontSize: 11 }}>🗂️ {it.tipo}</Text>
                        </View>
                        <TouchableOpacity onPress={() => { setFleetPreview(false); navigation?.navigate?.('MachineTraceability', { machineId: it.id }); }} style={{ borderWidth: 1, borderColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                          <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '700' }}>Ver detalle</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                </Card>
              ))
          )}

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
                      style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.brand, borderRadius: radius.md }}
                    >
                      <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 13 }}>⬇️ PDF</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </Card>

              <TouchableOpacity style={[styles.genBtn, { marginTop: 0, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }]} onPress={() => downloadCamionesPdf()}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>⬇️ Descargar todo el mes (todas las semanas)</Text>
              </TouchableOpacity>

              {/* 🧱 Transporte de escombros: mismos volteos, hoja con check Día/Noche por día */}
              <Card style={{ borderColor: colors.brand, borderWidth: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>🧱 Transporte de escombros (turnos Día/Noche)</Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2, marginBottom: spacing.xs }}>
                  {camData.escompanies.reduce((s, c) => s + c.items.length, 0)} equipo(s) de volteo · marca ☐ Día / ☐ Noche por día a mano.
                </Text>
                {camData.weeks.map((w) => (
                  <View key={w.n} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>Semana {w.n}</Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>del {fmtDMY(w.from)} al {fmtDMY(w.to)}</Text>
                    </View>
                    <TouchableOpacity onPress={() => downloadEscombrosPdf(w.n)} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.brand, borderRadius: radius.md }}>
                      <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 13 }}>⬇️ PDF</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                <TouchableOpacity style={{ marginTop: spacing.sm, paddingVertical: spacing.sm, alignItems: 'center', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }} onPress={() => downloadEscombrosPdf()}>
                  <Text style={{ color: colors.text, fontWeight: '800' }}>⬇️ Todo el mes (escombros)</Text>
                </TouchableOpacity>
              </Card>

              {/* Camiones por empresa */}
              {camData.companies.map((co) => (
                <Card key={co.company}>
                  <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 14, marginBottom: spacing.xs }}>🏢 {co.company} — {co.items.length} camión(es)</Text>
                  {co.items.map((t) => (
                    <View key={t.code} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontSize: 13 }}>{t.code}</Text>
                        {t.tipo ? <Text style={{ color: colors.muted, fontSize: 11 }}>🏷️ {t.tipo}</Text> : null}
                      </View>
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
  genBtn: { backgroundColor: colors.brand, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.md },
  btn: { flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center' },
  th: { color: colors.text, fontWeight: '700', fontSize: 11, padding: 6, textAlign: 'center' },
  td: { fontSize: 12, paddingVertical: 8, paddingHorizontal: 6 },
});
