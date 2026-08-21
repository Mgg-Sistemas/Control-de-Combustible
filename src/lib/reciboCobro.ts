import { HoseService } from '../types/database';
import { pdfDocument, exportPdf } from './pdf';
import { fmtUsd } from './bcv';
import { fichaTecnicaHtml, FICHA_CSS, MaquinaFicha } from './machineServiceReport';

/**
 * RECIBO DE COBRO de UNA manguera (PDF), Módulo de Fabricación (MRP).
 * Documenta el monto a cobrarle a la empresa/encargado por una manguera:
 * costo + margen de venta. Función PURA: no consulta Supabase, recibe los
 * datos ya resueltos por la pantalla que la invoca.
 *
 * FICHA DE LA MÁQUINA (20-ago-2026, pedido del cliente): si la manguera está
 * enlazada a una máquina de la flota, el recibo lleva DEBAJO del monto la misma
 * ficha con foto que sale en Servicio de maquinaria, para que quien recibe el
 * cobro vea de una vez a qué equipo se le hizo el trabajo. La ficha se embebe
 * SIN corte de página: un recibo de una manguera no puede volverse de dos hojas.
 * Las mangueras EXTERNAS (y las que no se pudieron cargar) salen igual que antes.
 *
 * Blindado por `scripts/test-recibo-cobro.mjs` (`npm run test:recibo-cobro`).
 */

const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dmy = (iso: string) => { const [y, m, d] = (iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : (iso || '—'); };

/** Monto a cobrar = costo × (1 + margen%/100), redondeado a 2 decimales. */
export function montoACobrar(costUsd: number, marginPct: number): number {
  const cost = Number(costUsd) || 0;
  const margin = Number(marginPct) || 0;
  return Math.round(cost * (1 + margin / 100) * 100) / 100;
}

export type ReciboCobroOpts = {
  hose: HoseService;
  companyName: string;
  encargadoName: string;
  /** Máquina a la que se le hizo el cambio de manguera (código + serial), o el
   *  cliente externo si es externa. Sale en el recibo para identificar el equipo. */
  machineLabel?: string;
  /** Ficha de la máquina de la flota, si la manguera está enlazada a una y se
   *  pudo cargar. Si viene, el recibo la imprime debajo del monto a cobrar. */
  maquina?: MaquinaFicha | null;
};

/** El documento completo. PURA — devuelve el HTML, no imprime nada. */
export function buildReciboCobroHtml(opts: ReciboCobroOpts): string {
  const { hose: h, companyName, encargadoName, machineLabel, maquina } = opts;

  const costo = Number(h.cost_usd) || 0;
  const margen = Number(h.sale_margin_pct) || 0;
  const monto = montoACobrar(costo, margen);

  const filas: [string, string][] = [
    ['Código de la fabricación', esc(h.code)],
    ['Máquina (cambio de manguera)', esc(machineLabel || '—')],
    ['Fecha del servicio', dmy(h.service_date)],
    ['Descripción del trabajo', esc(h.description ?? '—')],
    ['Empresa (a cobrar)', esc(companyName || '—')],
    ['Encargado', esc(encargadoName || '—')],
    ['Costo (US$)', fmtUsd(costo)],
    ['Margen de cobro (%)', `${margen}%`],
  ];

  const tabla = `<table class="det"><tbody>${filas
    .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</tbody></table>`;

  const totalBox = `
    <div class="total">
      <div class="total-k">MONTO A COBRAR</div>
      <div class="total-v">${fmtUsd(monto)}</div>
    </div>`;

  // La ficha va DESPUÉS del monto y sin corte de página.
  const ficha = maquina
    ? fichaTecnicaHtml(maquina, { corte: false, titulo: '🚜 MÁQUINA A LA QUE SE LE HIZO EL TRABAJO' })
    : '';

  const extraCss = `
    table.det{width:100%;border-collapse:collapse;margin-top:12px;font-size:12px}
    table.det th,table.det td{border:1px solid #c9d2dc;padding:7px 10px;text-align:left;vertical-align:top}
    table.det th{background:#16324F;color:#fff;width:40%}
    .total{margin-top:18px;background:#16324F;color:#fff;border-radius:8px;padding:14px 18px;
      display:flex;justify-content:space-between;align-items:center;page-break-inside:avoid}
    .total-k{font-size:13px;font-weight:800;letter-spacing:.5px;opacity:.9}
    .total-v{font-size:24px;font-weight:900}` + FICHA_CSS;

  const body = `<div>${tabla}${totalBox}${ficha}</div>`;

  return pdfDocument({
    title: 'Recibo de Cobro',
    subtitle: `${esc(h.code)} · ${dmy(h.service_date)} · ${esc(companyName || '—')}`,
    body,
    extraCss,
  });
}

/**
 * Genera y exporta el PDF del RECIBO DE COBRO de una manguera.
 * @param opts.hose registro de la manguera (costo, margen, código, etc.).
 * @param opts.companyName nombre de la empresa a la que se le cobra.
 * @param opts.encargadoName nombre del encargado a quien se le cobra.
 * @param opts.maquina ficha de la máquina de la flota (opcional).
 * @returns true si el usuario confirmó (imprimió/guardó), false si canceló.
 */
export async function generateReciboCobro(opts: ReciboCobroOpts): Promise<boolean> {
  return await exportPdf(buildReciboCobroHtml(opts), `Recibo de cobro - manguera ${opts.hose.code}`);
}
