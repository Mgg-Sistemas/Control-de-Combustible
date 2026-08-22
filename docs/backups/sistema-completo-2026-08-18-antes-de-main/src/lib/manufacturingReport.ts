import { pdfDocument, exportPdf } from './pdf';
import { fmtUsd } from './bcv';

/**
 * Reporte "OEE y Costeo — Fabricación" (PDF), Fase 5 del Módulo de
 * Fabricación (MRP): resumen de Disponibilidad/Rendimiento/Calidad/OEE por
 * centro de trabajo + costeo estimado vs. real de las órdenes de fabricación
 * del período. Función PURA: no consulta Supabase, recibe los datos ya
 * calculados/filtrados por ManufacturingReportsScreen (mismo patrón que
 * `generateHoseServiceReport` en `hoseServiceReport.ts`).
 */

const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Resumen OEE de un centro de trabajo (o del agregado general) para el período
 *  filtrado. Los % ya vienen calculados (null = sin datos suficientes). */
export interface OeeSummaryRow {
  label: string; // "Código · Nombre" del centro de trabajo, o "Todos los centros"
  en_proceso_seconds: number;
  pausada_seconds: number;
  qty_completed: number;
  qty_planned: number;
  qty_scrap: number;
  availability: number | null; // %
  performance: number | null; // %
  quality: number | null; // %
  oee: number | null; // %
}

/** Renglón de costeo (una orden de fabricación) del período filtrado. */
export interface CostRow {
  code: string;
  product: string;
  qty_produced: number;
  estimated_cost: number;
  real_cost: number;
}

const pctTxt = (n: number | null): string => (n == null ? '—' : `${(Math.round(n * 10) / 10).toLocaleString('es-VE')}%`);
const oeeBand = (n: number | null): string => (n == null ? '⚪' : n >= 85 ? '🟢' : n >= 60 ? '🟡' : '🔴');

/**
 * Genera y exporta el PDF del reporte de OEE + costeo de Fabricación.
 * @param opts.periodLabel etiqueta del período filtrado (p. ej. "Del 01/07 al 31/07/2026").
 * @param opts.workCenterLabel etiqueta del centro de trabajo filtrado, o "Todos los centros".
 * @param opts.overall agregado OEE del período (de TODOS los centros en vista, sumado — no promedio de %).
 * @param opts.byWorkCenter desglose por centro de trabajo; vacío si la vista ya está filtrada a uno solo.
 * @param opts.costRows órdenes de fabricación del período con su costeo estimado/real.
 * @returns true si el usuario confirmó (imprimió/guardó), false si canceló.
 */
export async function generateManufacturingReport(opts: {
  periodLabel: string;
  workCenterLabel: string;
  overall: OeeSummaryRow;
  byWorkCenter: OeeSummaryRow[];
  costRows: CostRow[];
}): Promise<boolean> {
  const { periodLabel, workCenterLabel, overall, byWorkCenter, costRows } = opts;

  // ── Panel OEE (agregado) ────────────────────────────────────────────────
  const oeeCard = `
    <div class="oeeBox">
      <div class="oeeBand">${oeeBand(overall.oee)}</div>
      <div class="oeeNum">${pctTxt(overall.oee)}</div>
      <div class="oeeLbl">OEE — ${esc(workCenterLabel)}</div>
      <table class="est">
        <thead><tr><th>Disponibilidad</th><th>Rendimiento</th><th>Calidad</th></tr></thead>
        <tbody><tr>
          <td>${pctTxt(overall.availability)}</td><td>${pctTxt(overall.performance)}</td><td>${pctTxt(overall.quality)}</td>
        </tr></tbody>
      </table>
    </div>
  `;

  // ── Desglose por centro de trabajo (solo si la vista no filtró a uno solo) ─
  const wcFilas = byWorkCenter.map((r) => `<tr>
    <td>${esc(r.label)}</td>
    <td>${pctTxt(r.availability)}</td>
    <td>${pctTxt(r.performance)}</td>
    <td>${pctTxt(r.quality)}</td>
    <td>${oeeBand(r.oee)} ${pctTxt(r.oee)}</td>
  </tr>`).join('');
  const wcTable = byWorkCenter.length
    ? `<table class="hs">
        <thead><tr><th>Centro de trabajo</th><th>Disponibilidad</th><th>Rendimiento</th><th>Calidad</th><th>OEE</th></tr></thead>
        <tbody>${wcFilas}</tbody>
      </table>`
    : '';

  // ── Costeo por orden ─────────────────────────────────────────────────────
  const costFilas = costRows.map((r) => {
    const variance = (Number(r.real_cost) || 0) - (Number(r.estimated_cost) || 0);
    return `<tr>
      <td>${esc(r.code)}</td>
      <td>${esc(r.product)}</td>
      <td>${(Number(r.qty_produced) || 0).toLocaleString('es-VE')}</td>
      <td>${fmtUsd(r.estimated_cost)}</td>
      <td>${fmtUsd(r.real_cost)}</td>
      <td class="${variance > 0 ? 'over' : 'under'}">${variance > 0 ? '+' : ''}${fmtUsd(variance)}</td>
    </tr>`;
  }).join('');
  const costTable = `
    <table class="hs">
      <thead><tr><th>Orden</th><th>Producto</th><th>Producido</th><th>Costo estimado</th><th>Costo real</th><th>Variación</th></tr></thead>
      <tbody>${costFilas || '<tr><td colspan="6">Sin órdenes en el período.</td></tr>'}</tbody>
    </table>
  `;

  const extraCss = `
    .oeeBox{text-align:center;margin:0 0 16px;padding:14px;border:1px solid #ccc;border-radius:10px}
    .oeeBand{font-size:30px;line-height:1}
    .oeeNum{font-size:36px;font-weight:800;color:#1E3A5F}
    .oeeLbl{font-size:12px;color:#6B7280;margin-bottom:8px}
    table.est{width:100%;border-collapse:collapse;margin:8px 0 0;font-size:11px}
    table.est th,table.est td{border:1px solid #ccc;padding:5px 7px;text-align:center}
    table.est th{background:#1E3A5F;color:#fff}
    table.hs{width:100%;border-collapse:collapse;margin:14px 0 4px;font-size:10px}
    table.hs th,table.hs td{border:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top}
    table.hs th{background:#1E3A5F;color:#fff}
    h3.sec{color:#1E3A5F;font-size:13px;margin:16px 0 4px}
    td.over{color:#B91C1C;font-weight:700}
    td.under{color:#15803D;font-weight:700}
  `;

  const html = pdfDocument({
    title: 'Reporte de Fabricación — OEE y Costeo',
    subtitle: [periodLabel, `Centro: ${workCenterLabel}`].filter(Boolean).join(' · '),
    body: oeeCard + wcTable + '<h3 class="sec">Costeo por orden</h3>' + costTable,
    extraCss,
  });

  return await exportPdf(html, 'Reporte - OEE y costeo - Fabricación');
}
