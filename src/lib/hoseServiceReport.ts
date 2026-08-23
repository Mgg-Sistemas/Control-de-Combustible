import { HoseService } from '../types/database';
import { pdfDocument, exportPdf } from './pdf';
import { fmtUsd, fmtBs, bsFromUsd } from './bcv';
import { FIRMA_DATA_URI } from './firmaData';

/**
 * Reporte "Confección y Pago — Mangueras Hidráulicas" (PDF), Fase 1 del
 * Módulo de Fabricación (MRP): control y confección de mangueras hidráulicas
 * del taller. Función PURA: no consulta Supabase, recibe los datos ya
 * cargados/filtrados por la pantalla que la invoca.
 */

const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dmy = (iso: string) => { const [y, m, d] = (iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : (iso || '—'); };

const INSTALL_LABEL: Record<HoseService['install_status'], string> = {
  en_proceso: 'En proceso',
  instalada: 'Instalada',
};
const PAYMENT_LABEL: Record<HoseService['payment_status'], string> = {
  pendiente: 'Pendiente',
  en_proceso_autorizacion: 'En autorización',
  pagado: 'Pagado',
  modificada_aprobada: 'Modificada y aprobada',
};

/**
 * Genera y exporta el PDF del reporte de confección y pago de mangueras.
 * @param opts.rows registros de mangueras ya filtrados (se respeta el orden recibido).
 * @param opts.machineryMap código/serial/placa de cada máquina, por `machinery_id`.
 * @param opts.profilesMap nombre de usuario, por `id` (para "Registrado por" / "Aprobado por").
 * @param opts.bcvRate tasa BCV del día, si se quiere mostrar el equivalente en bolívares.
 * @param opts.machineFilterLabel etiqueta de la máquina filtrada, si la pantalla filtró por una sola.
 * @returns true si el usuario confirmó (imprimió/guardó), false si canceló.
 */
export async function generateHoseServiceReport(opts: {
  rows: HoseService[];
  machineryMap: Record<string, { code: string; serial: string | null; plate: string | null; tipo?: string | null }>;
  profilesMap: Record<string, string>;
  bcvRate?: number | null;
  machineFilterLabel?: string;
}): Promise<boolean> {
  const { rows, machineryMap, profilesMap, bcvRate, machineFilterLabel } = opts;

  const machineTxt = (machinery_id: string | null): string => {
    if (!machinery_id) return '—';
    const m = machineryMap[machinery_id];
    if (!m) return '—';
    const marcaModelo = m.tipo && String(m.tipo).trim() ? ` · Marca-Modelo ${esc(m.tipo)}` : '';
    return `${esc(m.code ?? '—')} · Serial ${esc(m.serial ?? '—')} · Placa ${esc(m.plate ?? '—')}${marcaModelo}`;
  };

  const costTxt = (usd: number): string => {
    const base = fmtUsd(usd);
    return bcvRate ? `${base} (${fmtBs(bsFromUsd(usd, bcvRate))})` : base;
  };

  // ── Resumen ──────────────────────────────────────────────────────────────
  const total = rows.reduce((acc, r) => acc + (Number(r.cost_usd) || 0), 0);
  const totalTxt = bcvRate ? `${fmtUsd(total)} (${fmtBs(bsFromUsd(total, bcvRate))})` : fmtUsd(total);

  const pendientes = rows.filter((r) => r.payment_status === 'pendiente').length;
  const enAutorizacion = rows.filter((r) => r.payment_status === 'en_proceso_autorizacion').length;
  const pagadas = rows.filter((r) => r.payment_status === 'pagado').length;
  const enProceso = rows.filter((r) => r.install_status === 'en_proceso').length;
  const instaladas = rows.filter((r) => r.install_status === 'instalada').length;

  const resumen = `
    <p class="sum">
      <b>Total invertido:</b> ${totalTxt}
    </p>
    <table class="est">
      <thead><tr><th>Pendientes</th><th>En autorización</th><th>Pagadas</th><th>En proceso</th><th>Instaladas</th></tr></thead>
      <tbody><tr>
        <td>${pendientes}</td><td>${enAutorizacion}</td><td>${pagadas}</td><td>${enProceso}</td><td>${instaladas}</td>
      </tr></tbody>
    </table>
  `;

  // ── Detalle ──────────────────────────────────────────────────────────────
  const filas = rows.map((r) => {
    const registradoPor = r.created_by ? (profilesMap[r.created_by] ?? '—') : '—';
    const aprobadoPor = (r.payment_status === 'pagado' || r.payment_status === 'modificada_aprobada') && r.approved_by ? (profilesMap[r.approved_by] ?? '—') : '—';
    return `<tr>
      <td>${esc(r.code)}</td>
      <td>${r.is_external ? `🏭 ${esc(r.external_client ?? '—')} · Externa` : machineTxt(r.machinery_id)}</td>
      <td>${dmy(r.service_date)}</td>
      <td>${esc(r.description ?? '—')}</td>
      <td>${costTxt(Number(r.cost_usd) || 0)}</td>
      <td>${esc(r.provider ?? '—')}</td>
      <td>${esc(INSTALL_LABEL[r.install_status] ?? r.install_status)}</td>
      <td>${esc(PAYMENT_LABEL[r.payment_status] ?? r.payment_status)}</td>
      <td>${esc(registradoPor)}</td>
      <td>${esc(aprobadoPor)}</td>
    </tr>`;
  }).join('');

  const tabla = `
    <table class="hs">
      <thead><tr>
        <th>Código</th><th>Máquina</th><th>Fecha</th><th>Descripción</th><th>Costo</th>
        <th>Proveedor</th><th>Estado instalación</th><th>Estado de pago</th>
        <th>Registrado por</th><th>Aprobado por</th>
      </tr></thead>
      <tbody>${filas || '<tr><td colspan="10">Sin registros para este reporte.</td></tr>'}</tbody>
    </table>
  `;

  const extraCss = `
    p.sum{margin:0 0 8px;font-size:12px;color:#333}
    table.est{width:100%;border-collapse:collapse;margin:0 0 14px;font-size:11px}
    table.est th,table.est td{border:1px solid #ccc;padding:5px 7px;text-align:center}
    table.est th{background:#1E3A5F;color:#fff}
    table.hs{width:100%;border-collapse:collapse;margin:4px 0;font-size:10px}
    table.hs th,table.hs td{border:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top}
    table.hs th{background:#1E3A5F;color:#fff}
  `;

  const partesSubtitulo = [
    machineFilterLabel ? `Máquina: ${esc(machineFilterLabel)}` : null,
    `${rows.length} registro(s)`,
    bcvRate ? `Tasa BCV: Bs ${bcvRate.toFixed(2)}/US$` : null,
  ].filter(Boolean);

  const html = pdfDocument({
    title: 'Reporte de Confección y Pago — Fabricación',
    subtitle: partesSubtitulo.join(' · '),
    body: resumen + tabla,
    extraCss,
  });

  return await exportPdf(html, 'Reporte - Confección y pago - Fabricación');
}

// ── Autorización de UNA manguera (PDF con firma), igual que el requerimiento ──
const INSTALL_LBL: Record<HoseService['install_status'], string> = {
  en_proceso: 'En proceso', instalada: 'Instalada',
};
const PAYMENT_LBL: Record<HoseService['payment_status'], string> = {
  pendiente: 'Pendiente por pagar',
  en_proceso_autorizacion: 'Pendiente por autorización',
  pagado: 'Pagado / Autorizado',
  modificada_aprobada: 'Modificada y aprobada',
};

/**
 * PDF de AUTORIZACIÓN de UNA manguera — para pasárselo al Director General (Jesús
 * Lozada) a autorizar el pago, mismo formato/firma que el requerimiento de compra.
 * Si ya está PAGADA (autorizada) sale la firma escaneada del Director General; si
 * aún está pendiente, sale la línea para firmar a mano.
 * @returns true si el usuario confirmó (imprimió/guardó), false si canceló.
 */
export async function generateHoseAuthorization(opts: {
  hose: HoseService;
  machineLabel: string;   // código de la máquina (o cliente externo)
  bcvRate?: number | null;
}): Promise<boolean> {
  const { hose: h, machineLabel, bcvRate } = opts;
  const autorizada = h.payment_status === 'pagado' || h.payment_status === 'modificada_aprobada';
  const costoTxt = `${fmtUsd(h.cost_usd)}${bcvRate ? ` (${fmtBs(bsFromUsd(h.cost_usd, bcvRate))})` : ''}`;

  const filas: [string, string][] = [
    ['Código de la fabricación', esc(h.code)],
    [h.is_external ? 'Máquina / empresa externa' : 'Máquina', esc(machineLabel || '—')],
    ['Descripción del trabajo', esc(h.description ?? '—')],
    ['Fecha', dmy(h.service_date)],
    ['Costo', costoTxt],
    ['Proveedor (a quién se le paga)', esc(h.provider ?? '—')],
    ['Estado de instalación', esc(INSTALL_LBL[h.install_status] ?? h.install_status)],
    ['Estado de pago', esc(PAYMENT_LBL[h.payment_status] ?? h.payment_status)],
  ];
  const tabla = `<table class="det"><tbody>${filas
    .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</tbody></table>`;

  // "Autorizado bajo orden del Gerente General": lo marca el ALMACENISTA al aprobar
  // (solo puede aprobar con ese check). Sale sobre la firma del Gerente General.
  const ordenGGnote = h.orden_gg
    ? `<div class="ordengg">Autorizado bajo orden del Gerente General</div>`
    : '';
  // Bloque de firma: autorizada → firma escaneada del Gerente General; si no, línea a mano.
  const firmaBlock = autorizada
    ? `${ordenGGnote}<img src="${FIRMA_DATA_URI}"/><div class="line">Autorizado por el Gerente General</div><div class="firmante">JESÚS LOZADA</div>`
    : `${ordenGGnote}<div class="line">Autoriza — Gerente General (Jesús Lozada)</div>`;

  const extraCss = `
    table.det{width:100%;border-collapse:collapse;margin-top:12px;font-size:12px}
    table.det th,table.det td{border:1px solid #c9d2dc;padding:7px 10px;text-align:left;vertical-align:top}
    table.det th{background:#16324F;color:#fff;width:38%}
    .authbody{display:flex;flex-direction:column;min-height:20cm}
    .push{flex:1 1 auto;min-height:24px}
    .firma{text-align:center;page-break-inside:avoid}
    .firma img{height:auto;max-height:110px;max-width:260px;display:block;margin:0 auto 2px}
    .firma .line{width:300px;margin:0 auto;border-top:1px solid #1a1a1a;padding-top:6px;font-weight:800;color:#16324F}
    .firma .firmante{margin-top:2px;font-size:12px;font-weight:700;color:#333;letter-spacing:.3px}
    .firma .ordengg{margin-bottom:8px;font-weight:800;color:#16324F;font-size:12.5px}`;

  const body = `
    <div class="authbody">
      <div>${tabla}</div>
      <div class="push"></div>
      <div class="firma">${firmaBlock}</div>
    </div>`;

  const html = pdfDocument({
    title: 'Autorización de Fabricación de Manguera',
    subtitle: `${esc(h.code)} · ${dmy(h.service_date)} · Estado: ${esc(PAYMENT_LBL[h.payment_status] ?? h.payment_status)}`,
    body,
    extraCss,
  });
  return await exportPdf(html, `Autorización de manguera ${h.code}`);
}
