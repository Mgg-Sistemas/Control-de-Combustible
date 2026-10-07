// ⚖️ REPORTE DE TARAS POR CAMIÓN (06-oct-2026).
//
// Pedido del cliente (WhatsApp, 06-oct-2026), textual:
//   «habrá posibilidad de generar un reporte de los camiones que se vaya
//    cargando el peso de la tara? ejemplo hasta ahora tenemos un total de 40
//    camiones que ya cargamos la tara — nosotros tenemos uno así pero con
//    metros cúbicos, pero ya los m3 no los usamos»
//   «y que me aparezca algo donde yo pueda quitar el nombre de las empresas,
//    porque eso es un reporte que nos piden pero no pueden aparecer los
//    nombres de las empresas por ningún lado si no el de jhenzen nada más»
//
// ⭐ ESTE ARCHIVO NO TOCA LA BASE NI LA PANTALLA: arma las filas, el resumen y
//    el cuerpo HTML. El membrete (logos) lo pone `pdfDocument` en la pantalla.
//    Probado solo en `scripts/test-reporte-taras.mjs`.
//
// ⚠️ «POR NINGÚN LADO» ES LITERAL: con `empresa: false` el nombre de la
//    empresa no puede colarse ni en la tabla, ni en el resumen, ni en el
//    nombre del archivo. La prueba lo verifica buscando el nombre en el HTML.

import { kgTexto, tonTexto, type UnidadPeso } from './viajesPeso';

export type CamionParaTara = {
  id: string;
  code: string;
  plate: string | null;
  serial: string | null;
  marca: string | null;
  modelo: string | null;
  companyName: string | null;
};

export type TaraParaReporte = {
  pesoTaraKg: number | null;
  updatedAt: string;
  updatedByNombre: string | null;
  exentoRomana: boolean;
};

/** Qué camiones salen: solo los que ya tienen tara (el «van 40») o toda la flota. */
export type AlcanceTaras = 'conTara' | 'todos';

export type OpcionesReporteTaras = {
  alcance: AlcanceTaras;
  unidad: UnidadPeso;
  /** 🏢 Columna «Empresa». Apagada, el nombre no sale en NINGUNA parte. */
  empresa: boolean;
  marcaModelo: boolean;
  /** 👤 Quién cargó la tara y cuándo. */
  cargadaPor: boolean;
};

export const OPCIONES_TARAS_POR_DEFECTO: OpcionesReporteTaras = {
  alcance: 'conTara',
  unidad: 'kg',
  empresa: true,
  marcaModelo: true,
  cargadaPor: true,
};

export type EstadoTara = 'conTara' | 'sinTara' | 'exento';

export type FilaTara = {
  camion: CamionParaTara;
  estado: EstadoTara;
  taraKg: number | null;
  cargadaPor: string | null;
  cargadaEl: string | null;
};

export type ResumenTaras = {
  flota: number;
  conTara: number;
  sinTara: number;
  exentos: number;
  mayorKg: number | null;
  menorKg: number | null;
  promedioKg: number | null;
};

const cmp = (a: string, b: string) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });

/**
 * La situación de cada camión. Un exento CON tara guardada cuenta como
 * exento: no pasa por romana, su tara está «en espera» (ver `setExentoRomana`).
 */
export function filasDeTaras(
  camiones: CamionParaTara[],
  taras: Map<string, TaraParaReporte>,
  alcance: AlcanceTaras = 'conTara',
): FilaTara[] {
  const filas = camiones.map((c): FilaTara => {
    const t = taras.get(c.id);
    const exento = t?.exentoRomana === true;
    const kg = t?.pesoTaraKg != null && isFinite(t.pesoTaraKg) && t.pesoTaraKg > 0 ? t.pesoTaraKg : null;
    const estado: EstadoTara = exento ? 'exento' : kg != null ? 'conTara' : 'sinTara';
    return {
      camion: c,
      estado,
      taraKg: kg,
      cargadaPor: kg != null ? (t?.updatedByNombre ?? null) : null,
      cargadaEl: kg != null ? (t?.updatedAt || null) : null,
    };
  });
  const elegidas = alcance === 'conTara' ? filas.filter((f) => f.estado === 'conTara') : filas;
  // Primero las que tienen tara; dentro, por código y luego placa (el código
  // se repite en casi toda la flota: «Camion Volteo Toronto»).
  const orden: Record<EstadoTara, number> = { conTara: 0, sinTara: 1, exento: 2 };
  return elegidas.sort((a, b) =>
    orden[a.estado] - orden[b.estado]
    || cmp(a.camion.code, b.camion.code)
    || cmp(a.camion.plate ?? a.camion.serial ?? '', b.camion.plate ?? b.camion.serial ?? ''));
}

/** El resumen se calcula SIEMPRE sobre la flota entera: «40 de 63» necesita el 63. */
export function resumenTaras(camiones: CamionParaTara[], taras: Map<string, TaraParaReporte>): ResumenTaras {
  const todas = filasDeTaras(camiones, taras, 'todos');
  const pesos = todas.filter((f) => f.estado === 'conTara').map((f) => f.taraKg as number);
  return {
    flota: todas.length,
    conTara: pesos.length,
    sinTara: todas.filter((f) => f.estado === 'sinTara').length,
    exentos: todas.filter((f) => f.estado === 'exento').length,
    mayorKg: pesos.length ? Math.max(...pesos) : null,
    menorKg: pesos.length ? Math.min(...pesos) : null,
    promedioKg: pesos.length ? pesos.reduce((s, x) => s + x, 0) / pesos.length : null,
  };
}

export function esc(t: unknown): string {
  return String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** El peso en la unidad del reporte (toneladas con DOS decimales, como el
 *  resto de los reportes de control; el ticket es el único con tres). */
export function pesoTexto(kg: number | null, unidad: UnidadPeso): string {
  if (kg == null) return '—';
  return unidad === 't' ? tonTexto(kg, 2) : kgTexto(kg);
}

/** «06/10/2026» en hora de Caracas (UTC−4 fijo, sin horario de verano). */
export function fechaCaracas(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!isFinite(ms)) return '';
  const d = new Date(ms - 4 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

const ESTADO_TEXTO: Record<EstadoTara, string> = {
  conTara: 'Con tara',
  sinTara: 'Sin tara',
  exento: 'No pasa por romana',
};

export const CSS_REPORTE_TARAS = `
  .kpis{display:flex;gap:10px;margin:4px 0 14px}
  .kpi{flex:1;border:1px solid #D4DCE5;border-top:3px solid #1E3A5F;border-radius:4px;padding:10px 6px;text-align:center;background:#FAFBFD}
  .kpi .v{font-size:19px;font-weight:800;color:#1E3A5F;line-height:1.1}
  .kpi .t{margin-top:5px;font-size:8.5px;font-weight:700;color:#68757F;letter-spacing:.3px}
  table.taras{width:100%;border-collapse:collapse;font-size:10px}
  table.taras th{background:#1E3A5F;color:#fff;text-align:left;padding:6px 7px;font-size:8.5px;letter-spacing:.3px}
  table.taras td{padding:5px 7px;border:1px solid #DDE4EC}
  table.taras tbody tr:nth-child(even) td{background:#F5F8FC}
  table.taras td.n,table.taras th.n{text-align:center}
  table.taras td.r,table.taras th.r{text-align:right}
  table.taras td.sin{color:#9A3412;font-weight:700}
  .nota-t{margin-top:10px;font-size:9.5px;color:#6B7280;text-transform:none}
`;

/** El cuerpo del PDF (sin membrete). */
export function cuerpoReporteTaras(
  camiones: CamionParaTara[],
  taras: Map<string, TaraParaReporte>,
  op: OpcionesReporteTaras,
): string {
  const r = resumenTaras(camiones, taras);
  const filas = filasDeTaras(camiones, taras, op.alcance);
  const verEstado = op.alcance === 'todos';

  const kpis: [string, string][] = [
    [`${r.conTara} de ${r.flota}`, 'CAMIONES CON TARA CARGADA'],
    [String(r.sinTara), 'SIN TARA'],
    ...(r.exentos > 0 ? [[String(r.exentos), 'NO PASAN POR ROMANA'] as [string, string]] : []),
    [pesoTexto(r.promedioKg, op.unidad), 'TARA PROMEDIO'],
    [pesoTexto(r.mayorKg, op.unidad), 'TARA MAYOR'],
    [pesoTexto(r.menorKg, op.unidad), 'TARA MENOR'],
  ];

  const cab = [
    '<th class="n">N°</th>',
    '<th>Equipo</th>',
    '<th>Placa / serial</th>',
    op.marcaModelo ? '<th>Marca / modelo</th>' : '',
    op.empresa ? '<th>Empresa</th>' : '',
    `<th class="r">Tara (${op.unidad === 't' ? 'Ton' : 'Kg'})</th>`,
    verEstado ? '<th>Estado</th>' : '',
    op.cargadaPor ? '<th>Cargada por</th>' : '',
  ].join('');

  const cuerpo = filas.map((f, i) => {
    const c = f.camion;
    const ident = [c.plate ? `Placa ${c.plate}` : '', c.serial ? `Serial ${c.serial}` : ''].filter(Boolean).join(' · ') || '—';
    const mm = [c.marca, c.modelo].filter(Boolean).join(' ') || '—';
    const quien = f.estado === 'conTara'
      ? [f.cargadaPor, fechaCaracas(f.cargadaEl)].filter(Boolean).join(' · ') || '—'
      : '—';
    return `<tr>
      <td class="n">${i + 1}</td>
      <td>${esc(c.code)}</td>
      <td>${esc(ident)}</td>
      ${op.marcaModelo ? `<td>${esc(mm)}</td>` : ''}
      ${op.empresa ? `<td>${esc(c.companyName || 'Sin empresa')}</td>` : ''}
      <td class="r${f.taraKg == null ? ' sin' : ''}">${esc(f.taraKg == null ? '—' : pesoTexto(f.taraKg, op.unidad))}</td>
      ${verEstado ? `<td${f.estado === 'conTara' ? '' : ' class="sin"'}>${ESTADO_TEXTO[f.estado]}</td>` : ''}
      ${op.cargadaPor ? `<td>${esc(quien)}</td>` : ''}
    </tr>`;
  }).join('');

  const vacio = filas.length === 0
    ? `<tr><td colspan="8" class="n">Todavía no hay camiones con tara cargada.</td></tr>`
    : '';

  return `
    <div class="kpis">${kpis.map(([v, t]) => `<div class="kpi"><div class="v">${esc(v)}</div><div class="t">${esc(t)}</div></div>`).join('')}</div>
    <table class="taras"><thead><tr>${cab}</tr></thead><tbody>${cuerpo}${vacio}</tbody></table>
    <div class="nota-t">La tara es el peso del camión vacío medido en romana. Cada viaje registrado conserva la tara que tenía ese día.</div>
  `;
}

export function subtituloReporteTaras(r: ResumenTaras, alcance: AlcanceTaras): string {
  return alcance === 'conTara'
    ? `${r.conTara} camión(es) con tara cargada de ${r.flota} en la flota`
    : `Flota completa: ${r.flota} camión(es)`;
}

/** Nombre del archivo: dice el alcance; NUNCA lleva empresa. */
export function nombreArchivoTaras(alcance: AlcanceTaras, hoyISO: string): string {
  const [a, m, d] = hoyISO.split('-');
  return `Reporte de taras${alcance === 'todos' ? ' (flota completa)' : ''} ${d}-${m}-${a}`;
}
