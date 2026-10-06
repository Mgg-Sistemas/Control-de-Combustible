// 🔒 CIERRES DEL PAGO DE VIAJES — «ya se pagó» (06-oct-2026).
//
// Pedido del cliente (05-oct-2026): «¿cómo yo decido o cómo defino que ya
// pagaron viajes?, ¿desde dónde hago eso en el pago por viajes?». No existía:
// el rango se consultaba y ya. Esto es el calco de los cierres del Control de
// horómetros (decisión anotada en memoria: si piden cierres, calcar esos).
//
// ⭐ EL CIERRE ES LA CONSTANCIA, CON SU FOTO. Al marcar un rango como PAGADO se
//    guarda la FOTO del pago de ese momento (total, por empresa y por camión,
//    con los NOMBRES congelados). El papel del histórico sale de la foto: si
//    mañana renombran una empresa o corrigen un viaje, la constancia de lo que
//    se pagó NO cambia.
// ⭐ NO CONGELA LOS DATOS VIVOS: los viajes y tarifas siguen iguales; la
//    pantalla avisa que el rango ya está pagado, no tranca nada.
// ⭐ UN CIERRE NO SE EDITA NI SE BORRA: se REABRE anulándolo con motivo, y
//    queda en el histórico. Dos cierres activos no se pisan.
//
// ⭐ SOLO IMPORTA TIPOS (mismo criterio que pagoViajesReporte.ts): la prueba
//    lo carga solo, sin resolver módulos (scripts/test-pago-viajes-cierres.mjs).
import type { LineaViaje } from './pagoViajes';

const dia = (v: unknown): string => String(v ?? '').slice(0, 10);
const esFecha = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const limpio = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const redondear = (n: number) => Math.round(n * 100) / 100;
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Sin Intl con idioma: el papel sale igual en cualquier teléfono. */
export function usdCierre(n: number): string {
  const v = Number(n || 0);
  const neg = v < 0;
  const [entero, dec] = Math.abs(v).toFixed(2).split('.');
  return `${neg ? '-' : ''}$${entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`;
}
const dmy = (iso: string) => {
  const [y, m, d] = dia(iso).split('-');
  return y && m && d ? `${d}/${m}/${y}` : String(iso ?? '');
};

// ── LA FOTO ─────────────────────────────────────────────────────────────────

export type FotoCierrePago = {
  total: { viajes: number; pagados: number; noFacturados: number; pendientes: number; monto: number };
  /** Una por empresa, con el NOMBRE congelado (el papel viejo no cambia). */
  empresas: { nombre: string; viajes: number; pagados: number; noFacturados: number; pendientes: number; monto: number }[];
  /** Un renglón por camión con viajes PAGADOS. */
  camiones: { code: string; placa: string; empresa: string; pagados: number; monto: number }[];
};

/** Fila de `viaje_pago_cierres`. */
export type CierrePagoViajes = {
  id: string;
  desde: string;
  hasta: string;
  total_monto: number | string;
  viajes: number;
  pagados: number;
  detalle: FotoCierrePago | null;
  nota?: string | null;
  created_at?: string | null;
  created_by_nombre?: string | null;
  anulada_at?: string | null;
  anulada_por?: string | null;
  anulada_motivo?: string | null;
};

/**
 * La foto del pago del rango, armada de LAS MISMAS líneas de la tarjeta
 * (calcularPagoViajes): el cierre no recalcula un centavo. SIEMPRE del pago
 * COMPLETO del rango — nunca de las líneas filtradas del PDF: una constancia
 * de pago parcial que se lea como total es el error más caro posible.
 */
export function armarFotoCierrePago(
  lineas: readonly LineaViaje[] | null | undefined,
  nombresEmpresa: Map<string, string> | null | undefined,
): FotoCierrePago {
  const total = { viajes: 0, pagados: 0, noFacturados: 0, pendientes: 0, monto: 0 };
  const porEmpresa = new Map<string, FotoCierrePago['empresas'][number]>();
  const porCamion = new Map<string, FotoCierrePago['camiones'][number]>();
  (lineas ?? []).forEach((l) => {
    if (!l?.viaje) return;
    const empresaId = limpio(l.viaje.company_id);
    const nombre = empresaId ? (nombresEmpresa?.get(empresaId) || 'Empresa') : 'Sin empresa (fuera del catálogo)';
    const e = porEmpresa.get(nombre) ?? { nombre, viajes: 0, pagados: 0, noFacturados: 0, pendientes: 0, monto: 0 };
    total.viajes += 1; e.viajes += 1;
    if (l.monto > 0) {
      total.pagados += 1; e.pagados += 1;
      total.monto = redondear(total.monto + l.monto); e.monto = redondear(e.monto + l.monto);
      const idCamion = limpio(l.viaje.machinery_id) || `code:${limpio(l.viaje.machine_code) || '—'}`;
      const c = porCamion.get(`${idCamion}|${nombre}`) ?? {
        code: limpio(l.viaje.machine_code) || '—', placa: limpio(l.viaje.placa_snap), empresa: nombre, pagados: 0, monto: 0,
      };
      c.pagados += 1; c.monto = redondear(c.monto + l.monto);
      if (!c.placa && l.viaje.placa_snap) c.placa = limpio(l.viaje.placa_snap);
      porCamion.set(`${idCamion}|${nombre}`, c);
    } else if (l.motivoSinPago === 'no_facturo') { total.noFacturados += 1; e.noFacturados += 1; }
    else { total.pendientes += 1; e.pendientes += 1; }
    porEmpresa.set(nombre, e);
  });
  const cmp = (a: string, b: string) => a.localeCompare(b, 'es', { numeric: true });
  return {
    total,
    empresas: Array.from(porEmpresa.values()).sort((a, b) => cmp(a.nombre, b.nombre)),
    camiones: Array.from(porCamion.values()).sort((a, b) => cmp(a.code, b.code) || cmp(a.placa, b.placa)),
  };
}

// ── LAS REGLAS ──────────────────────────────────────────────────────────────

/** Cierres ACTIVOS que tocan el rango (los reabiertos no cuentan). */
export function cierresPagoSolapados(cierres: readonly CierrePagoViajes[] | null | undefined, desde: string, hasta: string): CierrePagoViajes[] {
  const a = dia(desde), b = dia(hasta);
  return (cierres ?? []).filter((c) => !!c && !c.anulada_at && dia(c.desde) <= b && a <= dia(c.hasta));
}

/** El cierre activo que CONTIENE el rango entero (= «este rango ya está pagado»). */
export function cierrePagoDelRango(cierres: readonly CierrePagoViajes[] | null | undefined, desde: string, hasta: string): CierrePagoViajes | null {
  const a = dia(desde), b = dia(hasta);
  if (!esFecha(a) || !esFecha(b)) return null;
  for (const c of cierres ?? []) {
    if (!c || c.anulada_at) continue;
    if (dia(c.desde) <= a && b <= dia(c.hasta)) return c;
  }
  return null;
}

/** Revisa un cierre ANTES de guardarlo. Devuelve el motivo del rechazo o null. */
export function validarCierrePago(
  c: { desde: string; hasta: string; foto: FotoCierrePago },
  cierres: readonly CierrePagoViajes[] | null | undefined,
): string | null {
  const a = dia(c.desde), b = dia(c.hasta);
  if (!esFecha(a) || !esFecha(b) || b < a) return 'El rango no es válido.';
  // 92 días ≈ un trimestre: más que eso no es un pago, es un histórico entero
  // (mismo tope que los cierres de horómetros).
  const dias = (Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000 + 1;
  if (dias >= 92) return 'Un pago no puede cubrir más de 92 días: márcalo por partes.';
  const pisa = cierresPagoSolapados(cierres, a, b);
  if (pisa.length) return `Ese rango ya tiene días marcados como pagados (del ${dmy(pisa[0].desde)} al ${dmy(pisa[0].hasta)}). Ajusta las fechas o reabre ese pago.`;
  if (!(c.foto?.total?.pagados > 0) || !(c.foto?.total?.monto > 0)) return 'No hay nada que marcar: en ese rango no hay ni un viaje pagado.';
  return null;
}

/** La frase de la confirmación, con lo que de verdad se va a dejar constancia. */
export function textoConfirmarCierrePago(desde: string, hasta: string, foto: FotoCierrePago): string {
  const t = foto.total;
  const partes = [
    `Vas a dejar constancia de que el pago del ${dmy(desde)} al ${dmy(hasta)} YA SE PAGÓ:`,
    `${t.pagados} viaje(s) · ${usdCierre(t.monto)} · ${foto.empresas.length} empresa(s).`,
  ];
  if (t.pendientes > 0) partes.push(`⚠️ OJO: quedan ${t.pendientes} viaje(s) SIN PAGAR en ese rango (sin zona, sin tarifa…): la constancia los deja anotados como pendientes.`);
  partes.push('Se guarda la FOTO de este momento. No borra ni cambia ningún viaje; se puede reabrir con motivo.');
  return partes.join('\n');
}

// ── EL PAPEL DEL HISTÓRICO (sale de la FOTO, nunca de los datos vivos) ──────

export const CSS_CIERRE_PAGO = `
  table{width:100%;border-collapse:collapse;font-size:11px;margin:4px 0 12px}
  th,td{border:1px solid #ccc;padding:4px 7px;text-align:left}
  th{background:#1E3A5F;color:#fff}
  td.r,th.r{text-align:right}
  tfoot td{background:#1E3A5F;color:#fff;font-weight:800}
  h3{font-size:13px;color:#1E3A5F;margin:14px 0 2px}
  .sello{border:1px solid #2F855A;color:#2F855A;border-radius:6px;padding:7px 10px;font-weight:800;margin:0 0 10px;font-size:12px}
  .nota{font-size:10px;color:#666;margin:2px 0 10px}`;

export function cuerpoCierrePago(c: CierrePagoViajes): string {
  const f = c.detalle;
  const partes: string[] = [];
  partes.push(`<div class="sello">✔️ PAGADO · del ${dmy(c.desde)} al ${dmy(c.hasta)} · ${usdCierre(Number(c.total_monto) || 0)}${c.created_by_nombre ? ` · constancia de ${esc(c.created_by_nombre)}` : ''}${c.created_at ? ` · ${dmy(c.created_at)}` : ''}</div>`);
  if (c.anulada_at) partes.push(`<div class="nota">↺ REABIERTO el ${dmy(c.anulada_at)}${c.anulada_motivo ? ` · motivo: ${esc(c.anulada_motivo)}` : ''}. Esta constancia quedó sin efecto.</div>`);
  if (c.nota) partes.push(`<div class="nota">Nota: ${esc(c.nota)}</div>`);
  if (!f) return partes.join('\n') + '<p class="nota">Este cierre no guardó detalle.</p>';
  partes.push(`<h3>Por empresa</h3>
    <table><thead><tr><th>Empresa</th><th class="r">Viajes</th><th class="r">Pagados</th><th class="r">No facturó</th><th class="r">Sin pagar</th><th class="r">Monto</th></tr></thead>
    <tbody>${f.empresas.map((e) => `<tr><td>${esc(e.nombre)}</td><td class="r">${e.viajes}</td><td class="r">${e.pagados}</td><td class="r">${e.noFacturados || '—'}</td><td class="r">${e.pendientes || '—'}</td><td class="r">${usdCierre(e.monto)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td>TOTAL PAGADO</td><td class="r">${f.total.viajes}</td><td class="r">${f.total.pagados}</td><td class="r">${f.total.noFacturados}</td><td class="r">${f.total.pendientes}</td><td class="r">${usdCierre(f.total.monto)}</td></tr></tfoot></table>`);
  partes.push(`<h3>Por camión (solo viajes pagados)</h3>
    <table><thead><tr><th>Camión</th><th>Placa</th><th>Empresa</th><th class="r">Viajes</th><th class="r">Monto</th></tr></thead>
    <tbody>${f.camiones.map((x) => `<tr><td>${esc(x.code)}</td><td>${esc(x.placa || '—')}</td><td>${esc(x.empresa)}</td><td class="r">${x.pagados}</td><td class="r">${usdCierre(x.monto)}</td></tr>`).join('') || '<tr><td colspan="5">Sin camiones</td></tr>'}</tbody></table>`);
  return partes.join('\n');
}
