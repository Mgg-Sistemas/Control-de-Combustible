// Recibo de COBRO / PAGO de una cuenta (Compras → Por cobrar / Por pagar).
// Documento imprimible con el membrete de la empresa, los datos de la cuenta
// (contraparte, concepto, factura, montos) y el historial de abonos. Por cobrar =
// "RECIBO DE COBRO" (lo que nos deben); por pagar = "RECIBO DE PAGO".
import { pdfDocument } from './pdf';

export type ReciboAbono = { fecha: string; monto: number; metodo?: string | null; referencia?: string | null };
export type ReciboCuentaData = {
  tipo: 'por_pagar' | 'por_cobrar';
  numero: string;              // Nº de recibo (documento de la cuenta o su id corto)
  fecha: string;               // fecha del recibo, ya formateada dd/mm/aaaa
  contraparte: string;         // empresa que debe (cobrar) o proveedor (pagar)
  concepto: string;
  documento?: string | null;   // Nº factura / control de la cuenta
  moneda: string;              // 'USD' | 'VES'
  monto: number;               // monto original
  abonado: number;
  saldo: number;
  situacionLabel: string;      // ✅ Pagada / 🔴 Vencida / ...
  fechaEmision?: string | null;
  fechaVencimiento?: string | null;
  nota?: string | null;
  abonos: ReciboAbono[];
};

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const simbolo = (moneda: string) => (moneda === 'VES' ? 'Bs' : '$');

// ── Monto en letras (español) ────────────────────────────────────────────────
const U = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE'];
const D = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const C = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];
function seccion(n: number): string {
  let t = '';
  const c = Math.floor(n / 100), r = n % 100;
  if (c) t += (n === 100 ? 'CIEN' : C[c]) + ' ';
  if (r <= 20) t += U[r];
  else if (r < 30) t += 'VEINTI' + U[r - 20];
  else { const d = Math.floor(r / 10), u = r % 10; t += D[d] + (u ? ' Y ' + U[u] : ''); }
  return t.trim();
}
function enLetras(num: number): string {
  num = Math.floor(Math.abs(num));
  if (num === 0) return 'CERO';
  let out = '';
  const millones = Math.floor(num / 1000000);
  const miles = Math.floor((num % 1000000) / 1000);
  const resto = num % 1000;
  if (millones) out += (millones === 1 ? 'UN MILLON' : seccion(millones) + ' MILLONES') + ' ';
  if (miles) out += (miles === 1 ? 'MIL' : seccion(miles) + ' MIL') + ' ';
  if (resto) out += seccion(resto);
  return out.trim();
}
/** "DOSCIENTOS ... CON 17/100 DÓLARES" a partir de un número. */
function montoEnLetras(n: number, moneda: string): string {
  const entero = Math.floor(Math.abs(n));
  const cent = Math.round((Math.abs(n) - entero) * 100);
  const unidad = moneda === 'VES' ? 'BOLÍVARES' : 'DÓLARES';
  return `${enLetras(entero)} CON ${String(cent).padStart(2, '0')}/100 ${unidad}`;
}

const RC_CSS = `
  .rc-tit{text-align:center;font-size:20px;font-weight:800;color:#16324F;letter-spacing:1px;margin:6px 0 2px}
  .rc-sub{text-align:center;color:#6B7280;font-size:12px;margin-bottom:14px}
  .rc-grid{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:12px}
  .rc-box{flex:1 1 220px;border:1px solid #c9d2dc;border-radius:8px;padding:10px 12px}
  .rc-box .k{color:#6B7280;font-size:10px;font-weight:800;letter-spacing:.4px;text-transform:uppercase}
  .rc-box .v{font-size:14px;font-weight:800;color:#16324F;margin-top:2px}
  .rc-concepto{border:1px solid #c9d2dc;border-radius:8px;padding:10px 12px;margin-bottom:12px}
  .rc-concepto .k{color:#6B7280;font-size:10px;font-weight:800;letter-spacing:.4px;text-transform:uppercase}
  .rc-concepto .v{font-size:13px;margin-top:3px}
  table.rc{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:6px}
  table.rc th,table.rc td{border:1px solid #c9d2dc;padding:7px 10px}
  table.rc th{background:#16324F;color:#fff;text-align:left;font-size:11px}
  table.rc td.r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  table.rc tr.saldo td{font-weight:800;font-size:14px;background:#EFF4FB;color:#16324F}
  .rc-letras{border:1px dashed #9aa9bb;border-radius:8px;padding:8px 12px;margin:8px 0 14px;font-size:12px}
  .rc-letras b{color:#16324F}
  .rc-abonos{margin-top:8px;font-size:12px}
  .rc-abonos .k{color:#6B7280;font-weight:800;font-size:11px;text-transform:uppercase;letter-spacing:.3px}
  .rc-firmas{display:flex;gap:40px;margin-top:44px}
  .rc-firmas .f{flex:1;text-align:center}
  .rc-firmas .line{border-top:1px solid #1a1a1a;padding-top:6px;font-weight:800;font-size:12px;color:#16324F}
  .rc-firmas .cap{font-size:11px;color:#555;margin-top:2px}
  .rc-nota{margin-top:12px;font-size:11px;color:#444}
`;

export function reciboCuentaHtml(d: ReciboCuentaData): string {
  const esCobro = d.tipo === 'por_cobrar';
  const titulo = esCobro ? 'RECIBO DE COBRO' : 'RECIBO DE PAGO';
  const parteLabel = esCobro ? 'Cliente / quien debe' : 'Proveedor / a quien se paga';
  const s = simbolo(d.moneda);

  const abonosHtml = d.abonos.length
    ? `<div class="rc-abonos"><div class="k">Abonos registrados</div>
        <table class="rc"><thead><tr><th>Fecha</th><th>Método</th><th>Referencia</th><th style="text-align:right">Monto</th></tr></thead>
        <tbody>${d.abonos.map((a) => `<tr><td>${esc(a.fecha)}</td><td>${esc(a.metodo || '—')}</td><td>${esc(a.referencia || '—')}</td><td class="r">${s}${money(a.monto)}</td></tr>`).join('')}</tbody></table>
      </div>`
    : '';

  // El monto que "protagoniza" el recibo: si aún hay saldo, es el saldo por cobrar/pagar;
  // si ya está saldada, es el total cobrado/pagado.
  const montoClave = d.saldo > 0 ? d.saldo : d.monto;

  const body = `
    <div class="rc-tit">${titulo}</div>
    <div class="rc-sub">Nº ${esc(d.numero)} · ${esc(d.fecha)} · ${esc(d.situacionLabel)}</div>

    <div class="rc-grid">
      <div class="rc-box"><div class="k">${esc(parteLabel)}</div><div class="v">${esc(d.contraparte)}</div></div>
      <div class="rc-box"><div class="k">Nº factura / control</div><div class="v">${esc(d.documento || '—')}</div></div>
    </div>

    <div class="rc-concepto"><div class="k">Concepto</div><div class="v">${esc(d.concepto)}</div></div>

    <table class="rc">
      <thead><tr><th>Detalle</th><th style="text-align:right;width:140px">Monto (${esc(d.moneda)})</th></tr></thead>
      <tbody>
        <tr><td>Monto original</td><td class="r">${s}${money(d.monto)}</td></tr>
        <tr><td>Abonado</td><td class="r">${s}${money(d.abonado)}</td></tr>
        <tr class="saldo"><td>${d.saldo > 0 ? (esCobro ? 'SALDO POR COBRAR' : 'SALDO POR PAGAR') : (esCobro ? 'TOTAL COBRADO' : 'TOTAL PAGADO')}</td><td class="r">${s}${money(montoClave)}</td></tr>
      </tbody>
    </table>

    <div class="rc-letras">Son: <b>${esc(montoEnLetras(montoClave, d.moneda))}</b></div>

    <div class="rc-grid">
      <div class="rc-box"><div class="k">Fecha de emisión</div><div class="v">${esc(d.fechaEmision || '—')}</div></div>
      <div class="rc-box"><div class="k">Fecha de vencimiento</div><div class="v">${esc(d.fechaVencimiento || '—')}</div></div>
    </div>

    ${abonosHtml}
    ${d.nota ? `<div class="rc-nota"><b>Nota:</b> ${esc(d.nota)}</div>` : ''}

    <div class="rc-firmas">
      <div class="f"><div class="line">${esCobro ? 'Recibí conforme (cliente)' : 'Recibí conforme (proveedor)'}</div><div class="cap">Nombre, C.I. y firma</div></div>
      <div class="f"><div class="line">Por SOS La Guaira</div><div class="cap">Firma y sello</div></div>
    </div>
  `;

  return pdfDocument({
    title: titulo,
    subtitle: `${esc(d.contraparte)} · ${esc(d.fecha)}`,
    extraCss: RC_CSS,
    body,
  });
}
