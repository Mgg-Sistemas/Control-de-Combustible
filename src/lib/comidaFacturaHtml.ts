// 📄 El papel de UNA factura de comida con su estado de pago (03-nov-2026).
// Dice sin vueltas: a quién, de qué días, cuántas comidas, cuánto, si se pagó,
// cuánto, cómo, cuándo y quién lo registró. Lo anulado sale tachado, no se esconde.
// PURA: devuelve HTML; el que llama lo pasa por pdfDocument/exportPdf.
import {
  ESTADO_FACTURA, FacturaComida, PagoComida, dmy, estadoFactura, numeroFactura, pagosDe, periodoTexto, textoPago, usd,
} from './comidaFacturas';

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const CSS_FACTURA_COMIDA = `
  .sello{border:3px solid;border-radius:10px;padding:10px 14px;margin:6px 0 12px;font-size:20px;font-weight:900;text-align:center}
  .datos{width:100%;border-collapse:collapse;font-size:12px;margin:0 0 10px}
  .datos td{padding:5px 8px;border:1px solid #ccc}
  .datos td.k{background:#F1F5F9;font-weight:800;width:32%}
  table.t{width:100%;border-collapse:collapse;font-size:11px;margin:4px 0 12px}
  table.t th,table.t td{border:1px solid #ccc;padding:4px 7px;text-align:left}
  table.t th{background:#1E3A5F;color:#fff}
  td.r,th.r{text-align:right} td.b{font-weight:800}
  tr.anulado td{color:#888;text-decoration:line-through}
  h3{font-size:13px;color:#1E3A5F;margin:14px 0 4px}
  p.n{font-size:10.5px;color:#555;margin:2px 0}`;

export function tituloFacturaComida(f: FacturaComida): string {
  return `Factura de comidas ${numeroFactura(f.numero)}`;
}

export function cuerpoFacturaComida(f: FacturaComida, todosLosPagos: readonly PagoComida[]): string {
  const e = estadoFactura(f, todosLosPagos);
  const ui = ESTADO_FACTURA[e.estado];
  const conAnulados = pagosDe(f.id, todosLosPagos, true);
  const ultimo = e.pagos[e.pagos.length - 1];
  const sello = e.estado === 'pagada'
    ? `${ui.icon} PAGADA COMPLETA${ultimo ? ` · ${dmy(ultimo.fecha_pago)}` : ''}`
    : e.estado === 'parcial'
      ? `${ui.icon} PAGADA EN PARTE · FALTAN ${usd(e.falta)}`
      : e.estado === 'anulada'
        ? `${ui.icon} FACTURA ANULADA`
        : `${ui.icon} FALTA POR PAGAR: ${usd(e.falta)}`;
  const det = (f.detalle ?? []).map((d) =>
    `<tr><td>${esc(d.etiqueta || d.plato || d.categoria)}</td><td class="r">${d.cantidad}</td><td class="r">${d.precio == null ? '—' : usd(d.precio)}</td><td class="r b">${usd(d.monto)}</td></tr>`).join('');
  const pagos = conAnulados.map((p) =>
    `<tr${p.anulado_at ? ' class="anulado"' : ''}><td>${dmy(p.fecha_pago)}</td><td>${esc(textoPago(p))}</td><td>${esc(p.created_by_nombre || '—')}</td><td>${p.comprobante_url ? `<a href="${esc(p.comprobante_url)}">ver foto</a>` : '—'}</td></tr>`
    + (p.anulado_at ? `<tr><td colspan="4"><p class="n">🚫 Pago anulado por ${esc(p.anulado_por_nombre || '—')}: ${esc(p.anulado_motivo || '')}</p></td></tr>` : '')).join('');
  return `
    <div class="sello" style="color:${ui.color};border-color:${ui.color}">${esc(sello)}</div>
    <table class="datos"><tbody>
      <tr><td class="k">A quién se le cobra</td><td><b>${esc(f.cuenta_nombre)}</b></td></tr>
      <tr><td class="k">Comidas de</td><td>${esc(periodoTexto(f.desde, f.hasta))}</td></tr>
      <tr><td class="k">Cantidad de comidas</td><td>${f.comidas}</td></tr>
      <tr><td class="k">Total de la factura</td><td><b>${usd(f.monto_usd)}</b></td></tr>
      <tr><td class="k">Pagado</td><td><b>${usd(e.pagado)}</b></td></tr>
      <tr><td class="k">Falta por pagar</td><td><b>${usd(e.falta)}</b></td></tr>
      <tr><td class="k">Factura hecha por</td><td>${esc(f.created_by_nombre || '—')} · ${dmy(f.created_at)}</td></tr>
      ${f.nota ? `<tr><td class="k">Nota</td><td>${esc(f.nota)}</td></tr>` : ''}
      ${f.anulada_at ? `<tr><td class="k">Anulada</td><td>${esc(f.anulada_por_nombre || '—')} · ${dmy(f.anulada_at)} · ${esc(f.anulada_motivo || '')}</td></tr>` : ''}
    </tbody></table>
    <h3>Detalle de lo entregado</h3>
    <table class="t"><thead><tr><th>Comida</th><th class="r">Cantidad</th><th class="r">Precio</th><th class="r">Monto</th></tr></thead>
    <tbody>${det || '<tr><td colspan="4">—</td></tr>'}</tbody>
    <tfoot><tr><td class="b">TOTAL</td><td class="r b">${f.comidas}</td><td></td><td class="r b">${usd(f.monto_usd)}</td></tr></tfoot></table>
    <h3>Pagos</h3>
    <table class="t"><thead><tr><th>Fecha</th><th>Cuánto y cómo</th><th>Lo registró</th><th>Comprobante</th></tr></thead>
    <tbody>${pagos || '<tr><td colspan="4">Todavía no se ha registrado ningún pago.</td></tr>'}</tbody></table>`;
}
