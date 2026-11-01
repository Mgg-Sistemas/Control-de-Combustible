import { exportPdf, nowStamp } from './pdf';
import { LOGO_DATA_URI } from './logoData';

function esc(val: any): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtDate(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

function fmtDateLong(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  const meses = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  const mesIndex = parseInt(m, 10) - 1;
  const mesNombre = meses[mesIndex] || m;
  return `${parseInt(d, 10)} de ${mesNombre}, ${y}`;
}

/**
 * Los tres tipos de operación de un flete (26/10/2026):
 *  · 'pagar'  → se le paga al fletero.
 *  · 'cobrar' → se le cobra al cliente.
 *  · 'exento' → se registra (camión, empresa, viajes y precio de referencia) pero
 *    NO se cobra ni se paga: no suma a ningún total y no tiene estado
 *    pendiente/pagado/cobrado.
 * No hay columna en la base: el tipo es el PRIMER token del metadato de la nota.
 */
export type FleteOperacionTipo = 'pagar' | 'cobrar' | 'exento';

/** Primer token del metadato ↔ tipo: `[POR_PAGAR|…]`, `[POR_COBRAR|…]`, `[EXENTO|…]`. */
const TOKEN_TIPO: Record<string, FleteOperacionTipo> = {
  POR_PAGAR: 'pagar',
  POR_COBRAR: 'cobrar',
  EXENTO: 'exento',
};

/**
 * Decide el tipo por el PRIMER token del metadato (lo que va antes del primer «|»),
 * que es donde siempre lo escribió `formatFleteNote`. Antes se buscaba la palabra en
 * todo el metadato y un CLIENTE o DETALLE que la trajera («CLIENTE:POR_PAGAR C.A.»)
 * cambiaba el tipo. Si el primer token no es un tipo (nota escrita a mano), se busca
 * un token EXACTO en el resto — nunca una subcadena —; sin ninguno, «por pagar», como
 * siempre se leyeron las notas sin etiqueta.
 */
export function tipoDesdeMeta(meta: string): FleteOperacionTipo {
  const tokens = String(meta || '').split('|').map((t) => t.trim().toUpperCase());
  const primero = TOKEN_TIPO[tokens[0]];
  if (primero) return primero;
  for (const t of tokens) {
    if (TOKEN_TIPO[t]) return TOKEN_TIPO[t];
  }
  return 'pagar';
}

export interface ParsedFleteNote {
  operacionTipo: FleteOperacionTipo;
  /** En un exento no aplica: queda fijo en 'pendiente' y la pantalla no lo muestra. */
  operacionEstado: 'pendiente' | 'completado';
  modalidad?: string;
  origen?: string;
  destino?: string;
  conductor?: string;
  cedulaConductor?: string;
  cliente?: string;
  detalle: string;
  viajeIds?: string[];
  tickets?: string[];
}

export function parseFleteNote(raw?: string | null): ParsedFleteNote {
  const str = String(raw || '').trim();
  let operacionTipo: FleteOperacionTipo = 'pagar';
  let operacionEstado: 'pendiente' | 'completado' = 'pendiente';
  let modalidad = 'Día / Jornada';
  let origen = '';
  let destino = '';
  let conductor = '';
  let cedulaConductor = '';
  let cliente = '';
  let detalle = str;
  let viajeIds: string[] = [];
  let tickets: string[] = [];

  const match = str.match(/^\[([^\]]+)\]\s*(.*)$/s);
  if (match) {
    const meta = match[1];
    detalle = match[2];
    operacionTipo = tipoDesdeMeta(meta);
    // Un exento no tiene estado: aunque la nota trajera uno (lo tenía antes de
    // cambiarlo a exento), se queda en 'pendiente' fijo y no se muestra.
    const estado = (valorMeta(meta, 'ESTADO') ?? '').toLowerCase();
    if (operacionTipo !== 'exento' && (estado === 'completado' || estado === 'pagado' || estado === 'cobrado')) {
      operacionEstado = 'completado';
    }
    const mod = valorMeta(meta, 'MOD');
    if (mod) modalidad = mod;
    origen = valorMeta(meta, 'ORIGEN') ?? '';
    destino = valorMeta(meta, 'DEST') ?? '';
    conductor = valorMeta(meta, 'CHOF') ?? '';
    cedulaConductor = valorMeta(meta, 'CI') ?? '';
    cliente = valorMeta(meta, 'CLIENTE') ?? '';
    viajeIds = (valorMeta(meta, 'VIAJES_IDS') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    tickets = (valorMeta(meta, 'TICKETS') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  }
  return { operacionTipo, operacionEstado, modalidad, origen, destino, conductor, cedulaConductor, cliente, detalle, viajeIds, tickets };
}

/**
 * El valor de una clave del metadato (`MOD`, `ORIGEN`, `CI`…) o null si no está.
 * Se lee TOKEN por token (lo que va entre «|»): la clave tiene que ABRIR el token,
 * y el valor es lo que sigue a su primer «:» (puede traer otros «:»). Antes se buscaba
 * la clave en todo el metadato y un origen escrito a mano como «Planta CI: 3» le
 * robaba la cédula al chofer, o uno con «ESTADO:pagado» daba el flete por pagado
 * (27/10/2026). Las notas que escribe `formatFleteNote` se leen igual que antes.
 */
function valorMeta(meta: string, clave: string): string | null {
  for (const token of String(meta || '').split('|')) {
    const i = token.indexOf(':');
    if (i > 0 && token.slice(0, i).trim() === clave) return token.slice(i + 1).trim();
  }
  return null;
}

/**
 * Lo escrito a mano que va DENTRO del metadato (origen, destino, cliente, chofer…)
 * no puede romperlo: «[» y «]» lo cortan y «|» parte un campo en dos — se perderían
 * los VIAJES_IDS y esos viajes se podrían volver a importar (27/10/2026).
 */
export function limpiarCampoNota(s?: string | null, max = 240): string {
  return String(s ?? '')
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/\|/g, '/')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

export function formatFleteNote(opts: {
  operacionTipo: FleteOperacionTipo;
  /** Se ignora en un exento: su nota no lleva ESTADO. */
  operacionEstado: 'pendiente' | 'completado';
  modalidad?: string;
  origen?: string;
  destino?: string;
  conductor?: string;
  cedulaConductor?: string;
  cliente?: string;
  detalle?: string;
  viajeIds?: string[];
  tickets?: string[];
}): string {
  const esExento = opts.operacionTipo === 'exento';
  // El tipo va SIEMPRE de primer token: es lo que lee `tipoDesdeMeta`.
  const parts = [esExento ? 'EXENTO' : opts.operacionTipo === 'cobrar' ? 'POR_COBRAR' : 'POR_PAGAR'];
  if (!esExento) parts.push(`ESTADO:${opts.operacionEstado || 'pendiente'}`);
  const campos: [string, string | undefined][] = [
    ['MOD', opts.modalidad],
    ['ORIGEN', opts.origen],
    ['DEST', opts.destino],
    ['CHOF', opts.conductor],
    ['CI', opts.cedulaConductor],
    ['CLIENTE', opts.cliente],
  ];
  for (const [clave, valor] of campos) {
    const limpio = limpiarCampoNota(valor);
    if (limpio) parts.push(`${clave}:${limpio}`);
  }
  if (opts.viajeIds && opts.viajeIds.length > 0) {
    parts.push(`VIAJES_IDS:${opts.viajeIds.join(',')}`);
  }
  if (opts.tickets && opts.tickets.length > 0) {
    parts.push(`TICKETS:${opts.tickets.join(',')}`);
  }
  const meta = `[${parts.join('|')}]`;
  const text = (opts.detalle || '').trim();
  return text ? `${meta} ${text}` : meta;
}

/**
 * Rehace la nota de un flete cambiando SOLO lo que viene en `cambios` y conservando
 * todo lo demás del metadato: modalidad, origen, destino, chofer, cédula, cliente,
 * viajes y tickets (27/10/2026). Antes, cambiar el estado o editar el flete rehacía la
 * nota con unos pocos campos y borraba el resto sin aviso.
 */
export function rehacerNotaFlete(
  raw: string | null | undefined,
  cambios: Partial<Parameters<typeof formatFleteNote>[0]>,
): string {
  const p = parseFleteNote(raw);
  const meta = String(raw || '').trim().match(/^\[([^\]]+)\]/)?.[1] ?? '';
  const base: Parameters<typeof formatFleteNote>[0] = {
    operacionTipo: p.operacionTipo,
    operacionEstado: p.operacionEstado,
    // La modalidad solo si la nota la traía: el parser pone «Día / Jornada» por defecto.
    modalidad: valorMeta(meta, 'MOD') ?? undefined,
    origen: p.origen,
    destino: p.destino,
    conductor: p.conductor,
    cedulaConductor: p.cedulaConductor,
    cliente: p.cliente,
    detalle: p.detalle,
    viajeIds: p.viajeIds,
    tickets: p.tickets,
  };
  for (const [k, v] of Object.entries(cambios)) {
    if (v !== undefined) (base as any)[k] = v;
  }
  return formatFleteNote(base);
}

export interface TotalesFletes {
  pagar: { fletes: number; viajes: number; usd: number };
  cobrar: { fletes: number; viajes: number; usd: number };
  /** Se cuentan APARTE: `refUsd` es solo el valor de referencia y no entra en ningún saldo. */
  exento: { fletes: number; viajes: number; refUsd: number };
}

/**
 * LA regla de los totales, la misma para la pantalla y el reporte consolidado:
 * un exento NO suma a «por pagar» ni a «por cobrar»; tiene su propio contador.
 * El tipo sale de `operacionTipo` si viene, si no de la nota.
 */
export function totalesFletes(
  fletes: { viajes: any; precio: any; note?: string | null; operacionTipo?: FleteOperacionTipo }[],
): TotalesFletes {
  const t: TotalesFletes = {
    pagar: { fletes: 0, viajes: 0, usd: 0 },
    cobrar: { fletes: 0, viajes: 0, usd: 0 },
    exento: { fletes: 0, viajes: 0, refUsd: 0 },
  };
  for (const f of fletes) {
    const v = Number(f.viajes) || 0;
    const sub = v * (Number(f.precio) || 0);
    const tipo = f.operacionTipo || parseFleteNote(f.note).operacionTipo;
    if (tipo === 'exento') {
      t.exento.fletes += 1;
      t.exento.viajes += v;
      t.exento.refUsd += sub;
    } else {
      const b = tipo === 'cobrar' ? t.cobrar : t.pagar;
      b.fletes += 1;
      b.viajes += v;
      b.usd += sub;
    }
  }
  return t;
}

export interface FleteItemData {
  id: string;
  flete_date: string;
  viajes: number;
  precio: number;
  code?: string;
  machinery_id?: string | null;
  plate?: string | null;
  tipo?: string | null;
  operacionTipo?: FleteOperacionTipo;
  operacionEstado?: 'pendiente' | 'completado';
  modalidad?: string;
  origen?: string;
  destino?: string;
  conductor?: string;
  cedulaConductor?: string;
  cliente?: string;
  note?: string | null;
}

export interface FleteReportOpts {
  companyName: string;
  machineCode?: string;
  machinePlate?: string | null;
  machineTipo?: string | null;
  periodLabel?: string;
  filterTipo?: 'todos' | FleteOperacionTipo;
  fletes: FleteItemData[];
}

/**
 * Genera y descarga el comprobante exacto del formato:
 * "COMPROBANTE DE SERVICIO - ACARREO Y TRANSPORTE DE MATERIAL"
 */
export async function exportarComprobanteFlete(opts: {
  flete: FleteItemData;
  companyName: string;
  machineCode?: string;
  machinePlate?: string | null;
  machineTipo?: string | null;
}): Promise<boolean> {
  const { flete, companyName, machineCode, machinePlate, machineTipo } = opts;
  const viajes = Number(flete.viajes) || 0;
  const precio = Number(flete.precio) || 0;
  const totalUSD = viajes * precio;
  const fechaLarga = fmtDateLong(flete.flete_date);

  const parsed = parseFleteNote(flete.note);
  const operacionTipo = flete.operacionTipo || parsed.operacionTipo;
  const operacionEstado = flete.operacionEstado || parsed.operacionEstado;
  const modalidad = flete.modalidad || parsed.modalidad || 'Día / Jornada';
  const origen = flete.origen || parsed.origen || 'Punto de origen no especificado';
  const destino = flete.destino || parsed.destino || 'Zona de disposición autorizada';
  const conductor = flete.conductor || parsed.conductor || 'Conductor asignado';
  const cedula = flete.cedulaConductor || parsed.cedulaConductor || '—';
  const detalleServicio = parsed.detalle || 'Servicio de Acarreo y Disposición Final';

  const esCobro = operacionTipo === 'cobrar';
  const esExento = operacionTipo === 'exento';
  const esCompletado = operacionEstado === 'completado';
  const montoTxt = `$${totalUSD.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  // Un exento no tiene estado pendiente/completado: el papel dice EXENTO.
  const estadoTxt = esExento ? 'EXENTO' : esCompletado ? 'COMPLETADO' : 'PENDIENTE';
  const estadoColor = esExento ? '#475569' : esCompletado ? '#059669' : '#D97706';

  const equipo = machineCode ? esc(machineCode) : (flete.code ? esc(flete.code) : 'Camión Volteo');
  const placa = machinePlate ? esc(machinePlate) : (flete.plate ? esc(flete.plate) : '—');
  const tipo = machineTipo ? esc(machineTipo) : (flete.tipo ? esc(flete.tipo) : 'Transporte de Carga');

  // Separar origen en título y subtítulo si tiene guión o coma
  const origParts = origen.split(/[-–—,]/).map((s) => s.trim()).filter(Boolean);
  const origTitle = origParts[0] || origen;
  const origSub = origParts.slice(1).join(' - ') || '';

  const destParts = destino.split(/[-–—,]/).map((s) => s.trim()).filter(Boolean);
  const destTitle = destParts[0] || destino;
  const destSub = destParts.slice(1).join(' - ') || (destParts.length === 1 ? 'Zona de Disposición Autorizada' : '');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Comprobante de Servicio - ${equipo} - ${placa}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 18mm 16mm 18mm 16mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1E293B;
      background: #FFFFFF;
      margin: 0;
      padding: 0;
      line-height: 1.35;
    }

    /* Cabecera idéntica al documento */
    .top-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 24px;
      padding-bottom: 12px;
      border-bottom: 2px solid #0F172A;
    }
    .top-left h1 {
      font-size: 26px;
      font-weight: 900;
      letter-spacing: 0.5px;
      color: #0F172A;
      margin: 0 0 4px 0;
      text-transform: uppercase;
    }
    .top-left p {
      font-size: 13.5px;
      font-weight: 700;
      color: #0284C7;
      margin: 0;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .top-right {
      text-align: right;
    }
    .badge-orden {
      display: inline-block;
      background: #334155;
      color: #FFFFFF;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      padding: 4px 10px;
      border-radius: 4px;
      margin-bottom: 5px;
    }
    .meta-line {
      font-size: 11px;
      color: #64748B;
      font-weight: 600;
      margin-top: 2px;
    }
    .meta-line b {
      color: #0F172A;
    }

    /* Secciones con borde vertical azul */
    .section-title {
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      color: #0F172A;
      letter-spacing: 0.5px;
      margin: 22px 0 12px 0;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      column-gap: 28px;
      row-gap: 16px;
    }
    .block-card {
      border-left: 3px solid #0284C7;
      padding-left: 10px;
    }
    .block-card .tag {
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      color: #64748B;
      letter-spacing: 0.4px;
      margin-bottom: 3px;
    }
    .block-card .val-main {
      font-size: 13.5px;
      font-weight: 800;
      color: #0F172A;
    }
    .block-card .val-sub {
      font-size: 11.5px;
      color: #475569;
      margin-top: 1px;
      font-weight: 500;
    }

    /* Tabla de detalle y tarifa */
    table.tarifa-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
      margin-bottom: 24px;
    }
    table.tarifa-table th {
      background: #475569;
      color: #FFFFFF;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 8px 10px;
      text-align: left;
    }
    table.tarifa-table th.right, table.tarifa-table td.right {
      text-align: right;
    }
    table.tarifa-table th.center, table.tarifa-table td.center {
      text-align: center;
    }
    table.tarifa-table td {
      padding: 12px 10px;
      font-size: 12px;
      color: #0F172A;
      border-bottom: 1px solid #E2E8F0;
    }
    .desc-main {
      font-weight: 800;
      font-size: 12.5px;
      color: #0F172A;
    }
    .desc-sub {
      font-size: 10.5px;
      color: #64748B;
      margin-top: 3px;
    }

    /* Bloque final de Total a Pagar */
    .total-container {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 10px;
      padding-top: 14px;
    }
    .total-label-box h2 {
      margin: 0;
      font-size: 14px;
      font-weight: 900;
      color: #0F172A;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
    .total-label-box p {
      margin: 3px 0 0 0;
      font-size: 11px;
      color: #64748B;
      font-weight: 500;
    }
    .total-amount {
      font-size: 26px;
      font-weight: 900;
      color: #0284C7;
      letter-spacing: 0.5px;
    }

    /* Flete exento: no se cobra ni se paga */
    .exento-banner {
      margin-top: 4px;
      padding: 9px 12px;
      border: 2px solid #475569;
      border-radius: 6px;
      background: #F1F5F9;
      color: #0F172A;
      font-size: 12.5px;
      font-weight: 800;
      text-align: center;
      letter-spacing: 0.3px;
    }

    /* Firmas */
    .firmas-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      column-gap: 50px;
      margin-top: 70px;
      text-align: center;
    }
    .firma-box {
      border-top: 1px solid #94A3B8;
      padding-top: 6px;
    }
    .firma-name {
      font-size: 11.5px;
      font-weight: 700;
      color: #0F172A;
    }
    .firma-role {
      font-size: 10px;
      color: #64748B;
      text-transform: uppercase;
      margin-top: 1px;
    }
  </style>
</head>
<body>
  <!-- CABECERA -->
  <div class="top-header">
    <div class="top-left">
      <h1>COMPROBANTE DE SERVICIO</h1>
      <p>ACARREO Y TRANSPORTE DE MATERIAL</p>
    </div>
    <div class="top-right">
      <div class="badge-orden">ORDEN DE ACARREO</div>
      <div class="meta-line">Fecha: <b>${fechaLarga}</b></div>
      <div class="meta-line">Estado: <b style="color: ${estadoColor};">${estadoTxt}</b></div>
    </div>
  </div>
${esExento ? `
  <div class="exento-banner">🚫 SERVICIO EXENTO · NO SE COBRA NI SE PAGA · El monto es solo de referencia</div>
` : ''}
  <!-- SECCIÓN 1: UBICACIÓN Y RUTA DEL SERVICIO -->
  <div class="section-title">UBICACIÓN Y RUTA DEL SERVICIO</div>
  <div class="grid-2">
    <div class="block-card">
      <div class="tag">PUNTO DE ORIGEN / CARGA</div>
      <div class="val-main">${esc(origTitle)}</div>
      ${origSub ? `<div class="val-sub">${esc(origSub)}</div>` : ''}
    </div>
    <div class="block-card">
      <div class="tag">PUNTO DE BOTE / DESTINO</div>
      <div class="val-main">${esc(destTitle)}</div>
      ${destSub ? `<div class="val-sub">${esc(destSub)}</div>` : ''}
    </div>
  </div>

  <!-- SECCIÓN 2: DATOS DE LA UNIDAD Y CONDUCTOR -->
  <div class="section-title">DATOS DE LA UNIDAD Y CONDUCTOR</div>
  <div class="grid-2">
    <div class="block-card">
      <div class="tag">VEHÍCULO DE TRANSPORTE</div>
      <div class="val-main">${esc(equipo)}</div>
      <div class="val-sub">Placa: ${esc(placa)} ${tipo ? `· ${esc(tipo)}` : ''}</div>
    </div>
    <div class="block-card">
      <div class="tag">CONDUCTOR ASIGNADO</div>
      <div class="val-main">${esc(conductor)}</div>
      <div class="val-sub">C.I.: ${esc(cedula)}</div>
    </div>
  </div>

  <!-- SECCIÓN 3: DETALLE DEL SERVICIO Y TARIFA -->
  <div class="section-title">DETALLE DEL SERVICIO Y TARIFA</div>
  <table class="tarifa-table">
    <thead>
      <tr>
        <th style="width: 50%;">DESCRIPCIÓN</th>
        <th class="center" style="width: 12%;">CANT.</th>
        <th style="width: 20%;">MODALIDAD</th>
        <th class="right" style="width: 18%;">${esExento ? 'VALOR REF. ($)' : 'MONTO ($)'}</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>
          <div class="desc-main">${esc(detalleServicio)}</div>
          <div class="desc-sub">Carga en ${esc(origTitle)} y bote en ${esc(destTitle)}</div>
          ${parsed.tickets && parsed.tickets.length > 0 ? `<div class="desc-sub" style="color: #0284C7; font-weight: 700; margin-top: 4px;">🎫 Tickets de romana: ${esc(parsed.tickets.join(', '))}</div>` : ''}
        </td>
        <td class="center" style="font-weight: 700;">${viajes}</td>
        <td>${esc(modalidad)}</td>
        <td class="right" style="font-weight: 700;${esExento ? ' color: #64748B;' : ''}">${montoTxt}</td>
      </tr>
    </tbody>
  </table>

  <!-- TOTAL A PAGAR / COBRAR (o EXENTO: sin cobro ni pago) -->
  ${esExento ? `<div class="total-container">
    <div class="total-label-box">
      <h2>SERVICIO EXENTO</h2>
      <p>No se cobra ni se paga · Valor de referencia: ${montoTxt}</p>
    </div>
    <div class="total-amount" style="color: #475569;">EXENTO</div>
  </div>` : `<div class="total-container">
    <div class="total-label-box">
      <h2>TOTAL A ${esCobro ? 'COBRAR' : 'PAGAR'}</h2>
      <p>Tarifa acordada por la jornada del servicio</p>
    </div>
    <div class="total-amount">
      ${montoTxt}
    </div>
  </div>`}

  <!-- FIRMAS -->
  <div class="firmas-grid">
    <div class="firma-box">
      <div class="firma-name">${esc(conductor)}</div>
      <div class="firma-role">Conductor Asignado</div>
    </div>
    <div class="firma-box">
      <div class="firma-name">Supervisor / Control de Operaciones</div>
      <div class="firma-role">Revisión y Aprobación</div>
    </div>
  </div>
</body>
</html>`;

  return await exportPdf(html, `Comprobante_Servicio_${equipo.replace(/\s+/g, '_')}_${placa.replace(/\s+/g, '_')}`);
}

/**
 * Genera y descarga el PDF para VARIOS FLETES (Relación consolidada por Empresa, por Camión o General, desglosando Cobros y Pagos).
 */
export async function exportarReporteConsolidadoFletes(opts: FleteReportOpts): Promise<boolean> {
  const { companyName, machineCode, machinePlate, periodLabel, fletes } = opts;
  const emitido = nowStamp();

  const equipo = machineCode ? esc(machineCode) : '';
  const placa = machinePlate ? esc(machinePlate) : '';

  // Los exentos NO entran en ningún saldo: se cuentan y se listan APARTE.
  const tot = totalesFletes(fletes);
  const totalViajesPagar = tot.pagar.viajes;
  const totalUSDPagar = tot.pagar.usd;
  const totalViajesCobrar = tot.cobrar.viajes;
  const totalUSDCobrar = tot.cobrar.usd;
  const hayExentos = tot.exento.fletes > 0;
  const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const ordenados = fletes
    .slice()
    .sort((a, b) => String(a.flete_date).localeCompare(String(b.flete_date)));
  const tipoDe = (f: FleteItemData) => f.operacionTipo || parseFleteNote(f.note).operacionTipo;
  const conSaldo = ordenados.filter((f) => tipoDe(f) !== 'exento');
  const exentos = ordenados.filter((f) => tipoDe(f) === 'exento');

  const rows = conSaldo
    .map((f, i) => {
      const v = Number(f.viajes) || 0;
      const p = Number(f.precio) || 0;
      const sub = v * p;

      const parsed = parseFleteNote(f.note);
      const esCobro = tipoDe(f) === 'cobrar';

      const eqRow = f.code || machineCode || 'General';
      const plRow = f.plate || machinePlate || '—';

      const tagTipo = esCobro
        ? `<span style="color: #059669; font-weight: 800; font-size: 10px;">💰 COBRO</span>`
        : `<span style="color: #1E3A8A; font-weight: 800; font-size: 10px;">💸 PAGO</span>`;

      return `<tr>
        <td style="text-align: center; color: #64748B;">${i + 1}</td>
        <td>${fmtDate(f.flete_date)}</td>
        <td>${tagTipo}</td>
        <td>
          <b>${esc(eqRow)}</b>
          ${parsed.tickets && parsed.tickets.length > 0 ? `<div style="font-size: 9.5px; color: #0284C7; font-weight: 600;">Tickets: ${esc(parsed.tickets.join(', '))}</div>` : ''}
        </td>
        <td>${esc(plRow)}</td>
        <td class="num" style="font-weight: 700;">${v}</td>
        <td class="num">$${p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="num" style="font-weight: 800; color: ${esCobro ? '#059669' : '#1E3A8A'};">$${sub.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      </tr>`;
    })
    .join('');

  const rowsExentos = exentos
    .map((f, i) => {
      const v = Number(f.viajes) || 0;
      const p = Number(f.precio) || 0;
      const parsed = parseFleteNote(f.note);
      const eqRow = f.code || machineCode || 'General';
      const plRow = f.plate || machinePlate || '—';
      return `<tr>
        <td style="text-align: center; color: #64748B;">${i + 1}</td>
        <td>${fmtDate(f.flete_date)}</td>
        <td><span style="color: #475569; font-weight: 800; font-size: 10px;">🚫 EXENTO</span></td>
        <td>
          <b>${esc(eqRow)}</b>
          ${parsed.tickets && parsed.tickets.length > 0 ? `<div style="font-size: 9.5px; color: #0284C7; font-weight: 600;">Tickets: ${esc(parsed.tickets.join(', '))}</div>` : ''}
        </td>
        <td>${esc(plRow)}</td>
        <td class="num" style="font-weight: 700;">${v}</td>
        <td class="num" style="color: #64748B;">${usd(p)}</td>
        <td class="num" style="color: #64748B;">${usd(v * p)}</td>
      </tr>`;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Reporte de Fletes - ${esc(companyName)}</title>
  <style>
    @page { size: A4 portrait; margin: 18mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0F172A; background: #fff; margin: 0; padding: 0; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #1E3A8A; padding-bottom: 12px; margin-bottom: 16px; }
    .logo-box img { height: 55px; width: auto; object-fit: contain; }
    .header-text { text-align: right; }
    .header-text h1 { margin: 0; font-size: 19px; font-weight: 800; color: #1E3A8A; letter-spacing: 0.5px; }
    .header-text p { margin: 3px 0 0; font-size: 12px; color: #64748B; font-weight: 600; }

    .summary-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 16px; }
    .summary-card { background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 12px; }
    .sum-title { font-size: 11px; text-transform: uppercase; color: #64748B; font-weight: 700; margin-bottom: 4px; }
    .sum-amt { font-size: 16px; font-weight: 800; }

    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; }
    th { background: #1E3A8A; color: #fff; text-align: left; padding: 9px 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
    td { padding: 9px 10px; border-bottom: 1px solid #E2E8F0; color: #0F172A; }
    .num { text-align: right; }
    .tot-row { background: #F1F5F9; font-weight: 800; font-size: 13px; }
    .exento-title { margin: 6px 0 2px; font-size: 13px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.4px; }
    .exento-sub { margin: 0 0 8px; font-size: 11px; color: #64748B; }
    table.exento th { background: #475569; }

    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; text-align: center; }
    .sign-box { border-top: 1px solid #64748B; padding-top: 8px; }
    .sign-name { font-size: 12px; font-weight: 700; color: #0F172A; }
    .sign-role { font-size: 10px; color: #64748B; text-transform: uppercase; }
    .footer { margin-top: 25px; font-size: 10px; color: #94A3B8; text-align: center; border-top: 1px solid #E2E8F0; padding-top: 8px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo-box">
      ${LOGO_DATA_URI ? `<img src="${LOGO_DATA_URI}" alt="Logo" />` : ''}
    </div>
    <div class="header-text">
      <h1>RELACIÓN DE FLETES Y VIAJES</h1>
      <p>${periodLabel ? `Período: ${esc(periodLabel)}` : 'Resumen Operativo de Viajes'}</p>
    </div>
  </div>

  <div class="summary-grid"${hayExentos ? ' style="grid-template-columns: 1fr 1fr 1fr 1fr;"' : ''}>
    <div class="summary-card">
      <div class="sum-title">Criterio / Entidad:</div>
      <div style="font-weight: 800; font-size: 13px; color: #0F172A;">${esc(companyName)}</div>
      ${equipo ? `<div style="font-size: 11.5px; color: #64748B; margin-top: 2px;">🚜 ${equipo} ${placa ? `· Placa: ${placa}` : ''}</div>` : ''}
    </div>
    <div class="summary-card" style="border-left: 3px solid #1E3A8A;">
      <div class="sum-title">💸 Total por Pagar (Fleteros):</div>
      <div class="sum-amt" style="color: #1E3A8A;">$${totalUSDPagar.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
      <div style="font-size: 11px; color: #64748B;">${totalViajesPagar} viaje(s) por pagar</div>
    </div>
    <div class="summary-card" style="border-left: 3px solid #059669;">
      <div class="sum-title">💰 Total por Cobrar (Clientes):</div>
      <div class="sum-amt" style="color: #059669;">$${totalUSDCobrar.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
      <div style="font-size: 11px; color: #64748B;">${totalViajesCobrar} viaje(s) por cobrar</div>
    </div>
    ${hayExentos ? `<div class="summary-card" style="border-left: 3px solid #475569;">
      <div class="sum-title">🚫 Exentos (sin cobro ni pago):</div>
      <div class="sum-amt" style="color: #475569;">${tot.exento.fletes} flete(s)</div>
      <div style="font-size: 11px; color: #64748B;">${tot.exento.viajes} viaje(s) exento(s) · no suman a ningún total</div>
    </div>` : ''}
  </div>

  ${conSaldo.length > 0 ? `<table>
    <thead>
      <tr>
        <th style="width: 25px; text-align: center;">#</th>
        <th style="width: 80px;">Fecha</th>
        <th style="width: 75px;">Tipo</th>
        <th>Camión / Equipo</th>
        <th style="width: 95px;">Placa</th>
        <th class="num" style="width: 65px;">Viajes</th>
        <th class="num" style="width: 90px;">Tarifa ($)</th>
        <th class="num" style="width: 105px;">Total ($)</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      <tr class="tot-row">
        <td colspan="5" style="text-align: right; text-transform: uppercase;">Totales:</td>
        <td class="num">${totalViajesPagar + totalViajesCobrar}</td>
        <td></td>
        <td class="num" style="font-size: 14px; color: #0F172A;">
          $${(totalUSDPagar + totalUSDCobrar).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </td>
      </tr>
    </tbody>
  </table>` : ''}

  ${hayExentos ? `<div class="exento-title">🚫 Fletes exentos · no se cobran ni se pagan</div>
  <p class="exento-sub">Se listan aparte para control. Su tarifa es solo de referencia: no entran en el total por pagar ni en el total por cobrar.</p>
  <table class="exento">
    <thead>
      <tr>
        <th style="width: 25px; text-align: center;">#</th>
        <th style="width: 80px;">Fecha</th>
        <th style="width: 75px;">Tipo</th>
        <th>Camión / Equipo</th>
        <th style="width: 95px;">Placa</th>
        <th class="num" style="width: 65px;">Viajes</th>
        <th class="num" style="width: 90px;">Tarifa ref. ($)</th>
        <th class="num" style="width: 105px;">Valor ref. ($)</th>
      </tr>
    </thead>
    <tbody>
      ${rowsExentos}
      <tr class="tot-row">
        <td colspan="5" style="text-align: right; text-transform: uppercase;">Total exento (no se suma):</td>
        <td class="num">${tot.exento.viajes}</td>
        <td></td>
        <td class="num" style="color: #475569;">${usd(tot.exento.refUsd)}</td>
      </tr>
    </tbody>
  </table>` : ''}

  <div class="signatures">
    <div class="sign-box">
      <div class="sign-name">Responsable de Transporte / Supervisor</div>
      <div class="sign-role">Conformidad de Viajes Realizados</div>
    </div>
    <div class="sign-box">
      <div class="sign-name">Administración y Finanzas</div>
      <div class="sign-role">Revisión y Aprobación Contable</div>
    </div>
  </div>

  <div class="footer">
    Reporte generado automáticamente · ${emitido} · Sistema de Control de Operaciones
  </div>
</body>
</html>`;

  const safeTitle = (machineCode || companyName || 'Fletes').replace(/\s+/g, '_');
  return await exportPdf(html, `Relacion_Fletes_${safeTitle}_${nowStamp().replace(/[^a-zA-Z0-9]/g, '_')}`);
}
