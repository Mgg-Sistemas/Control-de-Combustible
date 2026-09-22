// PAGO DE VIAJES · EL PDF CON OPCIONES (21-sep-2026).
//
// Pedido del cliente: «que los pagos de viajes, el pdf, lo pueda sacar por ubicación y
// obra, también que yo pueda seleccionar la obra y que me salga solo esa obra, que
// también lo pueda sacar por la empresa o empresas que seleccione, además que para ese
// pdf pueda ocultarle o que le salgan esas opciones» (las pastillas del Conteo de
// equipos: marca, modelo, serial/placa, encargado, metros cúbicos, nombre de empresas,
// listado por equipo, cantidad por tipo, cantidad por clasificación, alcance).
//
// ⭐ ESTE ARCHIVO NO CALCULA PLATA. Recibe las líneas que ya salieron de
//    `calcularPagoViajes` (pagoViajes.ts) con su monto puesto, y solo las FILTRA, las
//    AGRUPA y las PINTA. Así el PDF no puede dar un centavo distinto a la tarjeta: son
//    las mismas líneas. Dos maneras de calcular el mismo pago es como se termina
//    discutiendo una factura.
//
// ⭐ FILTRAR ≠ OCULTAR. Los filtros (empresas, obras) cambian QUÉ viajes entran y por
//    tanto el total. Las pastillas 🚫 solo esconden columnas o cuadros: el total no se
//    mueve. El cuadro de «Alcance» escribe siempre los filtros, para que un papel
//    filtrado no se lea como el pago completo.
//
// ⚠️ LO NUEVO ENTRA APAGADO (regla de la casa). `OPCIONES_PAGO_COMO_ANTES` deja el papel
//    igual al que salía hasta hoy: quien ya lo usa no se encuentra con otra hoja de un
//    día para otro. Marca, modelo, placa, encargado, m³, los cuadros por tipo y por
//    zona y el alcance se ENCIENDEN a pedido.
import type { LineaViaje, MotivoSinPago, PagoViajesGrupo } from './pagoViajes';

const limpio = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const redondear = (n: number) => Math.round(n * 100) / 100;

// ── LAS PASTILLAS ───────────────────────────────────────────────────────────

export type OpcionesPagoViajes = {
  sinMarca: boolean;
  sinModelo: boolean;
  sinPlaca: boolean;
  sinEncargado: boolean;
  /** Sin los m³: el de cada viaje del camión y el total del renglón. */
  sinCubicaje: boolean;
  /** Sin el NOMBRE de las empresas: salen como «Empresa 1», «Empresa 2»… */
  sinEmpresas: boolean;
  /** Sin el listado camión por camión (queda solo el resumen). */
  sinListado: boolean;
  /** Sin el cuadro de cantidad por tipo de equipo. */
  sinTipos: boolean;
  /** Sin el cuadro de cantidad por zona de pago (este / oeste). */
  sinZonas: boolean;
  /** Sin el cuadro de alcance del final (qué filtros se aplicaron). */
  sinAlcance: boolean;
};

/** Todo a la vista. */
export const OPCIONES_PAGO_COMPLETO: OpcionesPagoViajes = {
  sinMarca: false, sinModelo: false, sinPlaca: false, sinEncargado: false, sinCubicaje: false,
  sinEmpresas: false, sinListado: false, sinTipos: false, sinZonas: false, sinAlcance: false,
};

/** El papel de siempre: lo que salía antes de que existieran las pastillas. */
export const OPCIONES_PAGO_COMO_ANTES: OpcionesPagoViajes = {
  sinMarca: true, sinModelo: true, sinPlaca: true, sinEncargado: true, sinCubicaje: true,
  sinEmpresas: false, sinListado: false, sinTipos: true, sinZonas: true, sinAlcance: true,
};

/** Mismo orden y mismos rótulos que las pastillas del Conteo de equipos: el cliente las
 *  pidió mostrando esa pantalla. «Por clasificación» acá es «por zona», que es la
 *  clasificación con la que se paga un viaje. */
export const PASTILLAS_PAGO: { key: keyof OpcionesPagoViajes; chip: string; largo: string; archivo: string }[] = [
  { key: 'sinMarca', chip: '🚫 Marca', largo: 'marca', archivo: 'sin marca' },
  { key: 'sinModelo', chip: '🚫 Modelo', largo: 'modelo', archivo: 'sin modelo' },
  { key: 'sinPlaca', chip: '🚫 Serial / Placa', largo: 'serial/placa', archivo: 'sin placa' },
  { key: 'sinEncargado', chip: '🚫 Encargado', largo: 'encargado', archivo: 'sin encargado' },
  { key: 'sinCubicaje', chip: '🚫 Metros cúbicos', largo: 'metros cúbicos', archivo: 'sin m3' },
  { key: 'sinEmpresas', chip: '🚫 Nombre de empresas', largo: 'nombres de empresas', archivo: 'sin empresas' },
  { key: 'sinListado', chip: '🚫 Listado por equipo', largo: 'listado por equipo', archivo: 'solo resumen' },
  { key: 'sinTipos', chip: '🚫 Cantidad por tipo', largo: 'cantidad por tipo de equipo', archivo: 'sin tipos' },
  { key: 'sinZonas', chip: '🚫 Cantidad por zona', largo: 'cantidad por zona de pago', archivo: 'sin zonas' },
  { key: 'sinAlcance', chip: '🚫 Alcance del informe', largo: 'cuadro de alcance', archivo: 'sin alcance' },
];

export function alternarPago(o: OpcionesPagoViajes, key: keyof OpcionesPagoViajes): OpcionesPagoViajes {
  return { ...o, [key]: !o[key] };
}

/** Lo que quedó oculto, en criollo, para decirlo en pantalla ANTES de descargar. */
export function ocultosPagoEnPalabras(o: OpcionesPagoViajes): string {
  const l = PASTILLAS_PAGO.filter((p) => o[p.key]).map((p) => p.largo);
  return l.length === 0 ? 'Sale completo.' : `No sale: ${l.join(', ')}.`;
}

// ── LOS FILTROS ─────────────────────────────────────────────────────────────

export const SIN_OBRA = 'Sin obra';
export const CLAVE_SIN_EMPRESA = '(sin empresa)';

/** Una lista VACÍA quiere decir «todas»: es lo que espera quien no toca nada. */
export type FiltroPagoViajes = { empresas: string[]; obras: string[] };
export const FILTRO_PAGO_TODO: FiltroPagoViajes = { empresas: [], obras: [] };

export type EjePago = 'empresa' | 'obra';

/** La obra (CDT / ubicación) de un viaje: el nombre CONGELADO en el viaje. Se usa el
 *  nombre y no un id porque es lo que el viaje guardó ese día: si después renombran el
 *  CDT, el viaje ya pagado sigue diciendo dónde se marcó. */
export const obraDeLinea = (l: LineaViaje): string => limpio(l.viaje?.ubicacion_nombre) || SIN_OBRA;
export const empresaDeLinea = (l: LineaViaje): string => limpio(l.viaje?.company_id) || CLAVE_SIN_EMPRESA;

const pasa = (lista: string[] | null | undefined, clave: string) => !lista || lista.length === 0 || lista.includes(clave);

/** Todas las líneas de todos los grupos, en una sola lista. */
export function lineasDeGrupos(grupos: Iterable<PagoViajesGrupo> | null | undefined): LineaViaje[] {
  const out: LineaViaje[] = [];
  for (const g of grupos ?? []) out.push(...(g?.lineas ?? []));
  return out;
}

export function filtrarLineasPago(lineas: LineaViaje[] | null | undefined, f: FiltroPagoViajes): LineaViaje[] {
  return (lineas ?? []).filter((l) => pasa(f.empresas, empresaDeLinea(l)) && pasa(f.obras, obraDeLinea(l)));
}

/** El filtro, acotado a lo que de verdad hay: una obra marcada que ya no está en el
 *  rango seguiría filtrando sin verse y sin poder desmarcarse. */
export function acotarFiltroPago(f: FiltroPagoViajes, hay: { empresas: string[]; obras: string[] }): FiltroPagoViajes {
  const e = new Set(hay.empresas);
  const o = new Set(hay.obras);
  return { empresas: f.empresas.filter((k) => e.has(k)), obras: f.obras.filter((k) => o.has(k)) };
}

/** Las obras que EXISTEN en las líneas, con sus viajes, para ofrecerlas. «Sin obra» al final. */
export function obrasDisponibles(lineas: LineaViaje[] | null | undefined): { id: string; name: string; viajes: number }[] {
  const m = new Map<string, number>();
  (lineas ?? []).forEach((l) => m.set(obraDeLinea(l), (m.get(obraDeLinea(l)) ?? 0) + 1));
  return Array.from(m, ([id, viajes]) => ({ id, name: id, viajes }))
    .sort((a, b) => Number(a.id === SIN_OBRA) - Number(b.id === SIN_OBRA) || a.name.localeCompare(b.name, 'es', { numeric: true }));
}

export function empresasDisponibles(
  lineas: LineaViaje[] | null | undefined,
  nombres: Map<string, string> | null | undefined,
): { id: string; name: string; viajes: number }[] {
  const m = new Map<string, number>();
  (lineas ?? []).forEach((l) => m.set(empresaDeLinea(l), (m.get(empresaDeLinea(l)) ?? 0) + 1));
  return Array.from(m, ([id, viajes]) => ({ id, viajes, name: id === CLAVE_SIN_EMPRESA ? 'Sin empresa (fuera del catálogo)' : nombres?.get(id) || 'Empresa' }))
    .sort((a, b) => Number(a.id === CLAVE_SIN_EMPRESA) - Number(b.id === CLAVE_SIN_EMPRESA) || a.name.localeCompare(b.name, 'es'));
}

// ── AGRUPAR ─────────────────────────────────────────────────────────────────

export type TotalPago = { viajes: number; pagados: number; noFacturados: number; pendientes: number; monto: number };

export function totalDeLineas(lineas: LineaViaje[] | null | undefined): TotalPago {
  const t: TotalPago = { viajes: 0, pagados: 0, noFacturados: 0, pendientes: 0, monto: 0 };
  (lineas ?? []).forEach((l) => {
    t.viajes += 1;
    // Misma regla que `calcularPagoViajes`: pagado = monto > 0; si no, «no facturó» o pendiente.
    if (l.monto > 0) t.pagados += 1;
    else if (l.motivoSinPago === 'no_facturo') t.noFacturados += 1;
    else t.pendientes += 1;
    t.monto += l.monto;
  });
  t.monto = redondear(t.monto);
  return t;
}

export type BloquePago = { clave: string; nombre: string; lineas: LineaViaje[]; total: TotalPago };

/**
 * Los bloques del papel: uno por empresa o uno por obra.
 *
 * ⚠️ CADA LÍNEA VA A UN SOLO BLOQUE, así que la suma de los bloques es siempre el total
 *    del papel, agrupe como agrupe. La prueba lo fija: cambiar el eje no puede mover un
 *    centavo.
 */
export function bloquesPago(
  lineas: LineaViaje[] | null | undefined,
  eje: EjePago,
  nombresEmpresa: Map<string, string> | null | undefined,
  o?: Pick<OpcionesPagoViajes, 'sinEmpresas'> | null,
): BloquePago[] {
  const m = new Map<string, LineaViaje[]>();
  (lineas ?? []).forEach((l) => {
    const k = eje === 'obra' ? obraDeLinea(l) : empresaDeLinea(l);
    const lista = m.get(k) ?? [];
    lista.push(l);
    m.set(k, lista);
  });
  const nombreReal = (k: string) => (eje === 'obra' ? k : k === CLAVE_SIN_EMPRESA ? 'Sin empresa (fuera del catálogo)' : nombresEmpresa?.get(k) || 'Empresa');
  const ultimo = eje === 'obra' ? SIN_OBRA : CLAVE_SIN_EMPRESA;
  const bloques = Array.from(m, ([clave, ls]) => ({ clave, nombre: nombreReal(clave), lineas: ls, total: totalDeLineas(ls) }))
    .sort((a, b) => Number(a.clave === ultimo) - Number(b.clave === ultimo) || a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
  // «Sin nombre de empresas»: se numeran DESPUÉS de ordenar por su nombre real, así el
  // mismo papel con y sin nombres lleva las empresas en el mismo orden y se pueden cruzar.
  if (eje === 'empresa' && o?.sinEmpresas) bloques.forEach((b, i) => { b.nombre = `Empresa ${i + 1}`; });
  return bloques;
}

export type ConteoPago = { clave: string; viajes: number; pagados: number; monto: number };

function contarPor(lineas: LineaViaje[] | null | undefined, claveDe: (l: LineaViaje) => string): ConteoPago[] {
  const m = new Map<string, ConteoPago>();
  (lineas ?? []).forEach((l) => {
    const k = claveDe(l);
    const c = m.get(k) ?? { clave: k, viajes: 0, pagados: 0, monto: 0 };
    c.viajes += 1;
    if (l.monto > 0) c.pagados += 1;
    c.monto = redondear(c.monto + l.monto);
    m.set(k, c);
  });
  return Array.from(m.values()).sort((a, b) => a.clave.localeCompare(b.clave, 'es', { numeric: true }));
}

/** Cantidad por TIPO de equipo (el código de texto del camión: «CAMION VOLTEO TORONTO»…). */
export const conteoPorTipo = (lineas: LineaViaje[] | null | undefined) => contarPor(lineas, (l) => limpio(l.viaje?.machine_code) || 'Sin tipo');
/** Cantidad por ZONA de pago. Un viaje sin zona válida sale como «Sin zona»: no se esconde. */
export const conteoPorZona = (lineas: LineaViaje[] | null | undefined) => contarPor(lineas, (l) => (l.zona === 'este' ? 'Este' : l.zona === 'oeste' ? 'Oeste' : 'Sin zona'));

// ── EL LISTADO POR EQUIPO ───────────────────────────────────────────────────

/** Lo que el catálogo sabe de cada camión y que el viaje no guarda. */
export type FichaCamionPago = { marca?: string | null; modelo?: string | null; placa?: string | null; serial?: string | null; encargado?: string | null };

export type RenglonEquipo = {
  code: string;
  /** La empresa a la que pertenece el camión: la que el VIAJE congeló al registrarse
   *  (22-sep-2026, pedido del cliente). Por obra, sin esto no se sabía de quién era cada
   *  camión; y en un bloque de empresa la repite a propósito, porque la hoja se recorta. */
  empresa: string;
  marca: string; modelo: string; placa: string; encargado: string;
  zona: string; viajes: number; precio: number; monto: number;
  /** m³ de UN viaje de ese camión (0 = no está medido) y del renglón entero. */
  m3PorViaje: number; m3: number;
};

/**
 * Los viajes PAGADOS de un bloque, por camión, zona y tarifa.
 *
 * Agrupa por MÁQUINA y no por código: dos camiones con el mismo código son dos
 * renglones (misma regla que `itemsViajePagados`, que es de donde sale esto).
 */
export function renglonesPorEquipo(
  lineas: LineaViaje[] | null | undefined,
  fichas: Map<string, FichaCamionPago> | null | undefined,
  m3PorViaje: Map<string, number> | null | undefined,
  nombresEmpresa?: Map<string, string> | null,
): RenglonEquipo[] {
  const m = new Map<string, RenglonEquipo>();
  (lineas ?? []).forEach((l) => {
    if (!(l.monto > 0) || !l.zona) return;
    const id = limpio(l.viaje?.machinery_id);
    const code = limpio(l.viaje?.machine_code) || '—';
    const empresaId = empresaDeLinea(l);
    // La empresa va en la clave: un camión que cambió de empresa a mitad del rango son
    // dos renglones, no uno con la empresa del primer viaje.
    const k = `${id || `code:${code}`}|${empresaId}|${l.zona}|${l.precio}`;
    let r = m.get(k);
    if (!r) {
      const f = (id && fichas?.get(id)) || {};
      const porViaje = Number((id && m3PorViaje?.get(id)) || 0) || 0;
      r = {
        code,
        empresa: empresaId === CLAVE_SIN_EMPRESA ? 'Sin empresa' : nombresEmpresa?.get(empresaId) || 'Empresa',
        marca: limpio(f.marca), modelo: limpio(f.modelo),
        // La placa que el VIAJE congeló manda sobre la del catálogo: es la que llevaba ese día.
        placa: limpio(l.viaje?.placa_snap) || limpio(f.placa) || limpio(f.serial),
        encargado: limpio(f.encargado),
        zona: l.zona === 'oeste' ? 'Oeste' : 'Este', viajes: 0, precio: l.precio, monto: 0, m3PorViaje: porViaje, m3: 0,
      };
      m.set(k, r);
    }
    r.viajes += 1;
    r.monto = redondear(r.monto + l.monto);
    r.m3 = redondear(r.m3PorViaje * r.viajes);
  });
  return Array.from(m.values()).sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true }) || a.placa.localeCompare(b.placa, 'es') || a.empresa.localeCompare(b.empresa, 'es') || a.precio - b.precio);
}

export type ColumnaEquipo = 'code' | 'empresa' | 'marcaModelo' | 'placa' | 'encargado' | 'zona' | 'viajes' | 'm3' | 'precio' | 'monto';

export function columnasEquipo(o: OpcionesPagoViajes): ColumnaEquipo[] {
  const c: ColumnaEquipo[] = ['code'];
  // La empresa del camión sale siempre (22-sep-2026) y se esconde con la MISMA pastilla que
  // los nombres de empresas: con «Empresa 1, Empresa 2» en los títulos, el nombre real no
  // se puede colar por esta columna.
  if (!o.sinEmpresas) c.push('empresa');
  if (!o.sinMarca || !o.sinModelo) c.push('marcaModelo');
  if (!o.sinPlaca) c.push('placa');
  if (!o.sinEncargado) c.push('encargado');
  c.push('zona', 'viajes');
  if (!o.sinCubicaje) c.push('m3');
  c.push('precio', 'monto');
  return c;
}

export function tituloMarcaModeloPago(o: OpcionesPagoViajes): string {
  return !o.sinMarca && !o.sinModelo ? 'Marca / Modelo' : !o.sinMarca ? 'Marca' : 'Modelo';
}
export function marcaModeloPago(r: { marca: string; modelo: string }, o: OpcionesPagoViajes): string {
  return [o.sinMarca ? '' : r.marca, o.sinModelo ? '' : r.modelo].filter(Boolean).join(' ') || '—';
}

// ── ALCANCE, NOMBRE DE ARCHIVO Y PAPEL VACÍO ────────────────────────────────

export function alcancePagoEnPalabras(
  f: FiltroPagoViajes, eje: EjePago, o: OpcionesPagoViajes,
  nombresEmpresa: Map<string, string> | null | undefined,
): string[] {
  const nombreE = (k: string) => (k === CLAVE_SIN_EMPRESA ? 'Sin empresa' : nombresEmpresa?.get(k) || 'Empresa');
  const l: string[] = [`Agrupado por ${eje === 'obra' ? 'obra / ubicación' : 'empresa'}.`];
  // Con los nombres ocultos, el alcance tampoco los puede soltar.
  l.push(f.empresas.length === 0 ? 'Empresas: todas.'
    : o.sinEmpresas ? `Empresas: solo ${f.empresas.length} elegida(s).`
      : `Empresas: solo ${f.empresas.map(nombreE).join(', ')}.`);
  l.push(f.obras.length === 0 ? 'Obras: todas.' : `Obras: solo ${f.obras.join(', ')}.`);
  if (f.empresas.length || f.obras.length) l.push('⚠️ Este papel está FILTRADO: su total no es el pago completo del rango.');
  return l;
}

export function sufijoArchivoPago(f: FiltroPagoViajes, eje: EjePago, o: OpcionesPagoViajes): string {
  const partes: string[] = [];
  if (eje === 'obra') partes.push('por obra');
  if (f.obras.length === 1) partes.push(f.obras[0]);
  else if (f.obras.length > 1) partes.push(`${f.obras.length} obras`);
  if (f.empresas.length) partes.push(`${f.empresas.length} empresa(s)`);
  PASTILLAS_PAGO.filter((p) => o[p.key] !== OPCIONES_PAGO_COMO_ANTES[p.key]).forEach((p) => partes.push(o[p.key] ? p.archivo : p.archivo.replace(/^sin |^solo /, 'con ')));
  return partes.length ? ` (${partes.join(', ')})`.replace(/[\\/:*?"<>|]/g, ' ') : '';
}

// ── EL PAPEL ────────────────────────────────────────────────────────────────

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const usd = (n: number) => `$${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const m3Texto = (n: number) => (n > 0 ? `${n.toLocaleString('es-VE', { maximumFractionDigits: 2 })} m³` : '—');

export const CSS_PAGO_VIAJES = `
  table{width:100%;border-collapse:collapse;font-size:11px;margin:4px 0 10px}
  th,td{border:1px solid #ccc;padding:4px 7px;text-align:left}
  th{background:#1E3A5F;color:#fff}
  td.r,th.r{text-align:right}td.c{text-align:center}td.b{font-weight:700}
  tfoot td{background:#1E3A5F;color:#fff;font-weight:800}
  h3{font-size:13px;color:#1E3A5F;margin:14px 0 2px}
  p.n{font-size:10px;color:#666;margin:0 0 8px}
  .alc{font-size:10px;color:#444;border:1px solid #ccc;border-radius:4px;padding:6px 9px;margin-top:12px}`;

export type DatosPapelPago = {
  lineas: LineaViaje[];
  eje: EjePago;
  filtro: FiltroPagoViajes;
  opciones: OpcionesPagoViajes;
  nombresEmpresa: Map<string, string>;
  fichas?: Map<string, FichaCamionPago> | null;
  m3PorViaje?: Map<string, number> | null;
  etiquetaMotivo: (m: MotivoSinPago) => string;
  /** Bloque ya armado de «camiones que no entran al pago». Solo va en el papel SIN filtrar. */
  htmlFueraDelPago?: string;
};

export function cuerpoPagoViajes(d: DatosPapelPago): string {
  const o = d.opciones;
  const bloques = bloquesPago(d.lineas, d.eje, d.nombresEmpresa, o);
  const tot = totalDeLineas(d.lineas);
  const rotulo = d.eje === 'obra' ? 'Obra / ubicación' : 'Empresa';
  const partes: string[] = [];

  partes.push(`<table><thead><tr><th>${rotulo}</th><th class="r">Viajes pagados</th><th class="r">No facturó</th><th class="r">Sin pagar</th><th class="r">Total</th></tr></thead>
    <tbody>${bloques.map((b) => `<tr><td>${esc(b.nombre)}</td><td class="r">${b.total.pagados}</td><td class="r">${b.total.noFacturados || '—'}</td><td class="r">${b.total.pendientes || '—'}</td><td class="r b">${usd(b.total.monto)}</td></tr>`).join('') || '<tr><td colspan="5" class="c">Sin viajes con ese filtro</td></tr>'}</tbody>
    <tfoot><tr><td>TOTAL A PAGAR</td><td class="r">${tot.pagados}</td><td class="r">${tot.noFacturados}</td><td class="r">${tot.pendientes}</td><td class="r">${usd(tot.monto)}</td></tr></tfoot></table>`);

  const cuadroConteo = (titulo: string, col: string, filas: ConteoPago[]) => `<h3>${titulo}</h3>
    <table><thead><tr><th>${col}</th><th class="r">Viajes</th><th class="r">Pagados</th><th class="r">Monto</th></tr></thead>
    <tbody>${filas.map((c) => `<tr><td>${esc(c.clave)}</td><td class="r">${c.viajes}</td><td class="r">${c.pagados}</td><td class="r b">${usd(c.monto)}</td></tr>`).join('')}</tbody></table>`;
  if (!o.sinTipos) partes.push(cuadroConteo('Cantidad por tipo de equipo', 'Tipo', conteoPorTipo(d.lineas)));
  if (!o.sinZonas) partes.push(cuadroConteo('Cantidad por zona de pago', 'Zona', conteoPorZona(d.lineas)));

  if (d.htmlFueraDelPago) partes.push(d.htmlFueraDelPago);

  if (!o.sinListado) {
    const cols = columnasEquipo(o);
    const titulos: Record<ColumnaEquipo, string> = {
      code: 'Camión', empresa: 'Empresa', marcaModelo: tituloMarcaModeloPago(o), placa: 'Serial / Placa', encargado: 'Encargado',
      zona: 'Zona', viajes: 'Viajes', m3: 'm³', precio: 'Tarifa', monto: 'Monto',
    };
    const num = new Set<ColumnaEquipo>(['viajes', 'm3', 'precio', 'monto']);
    bloques.forEach((b) => {
      const rs = renglonesPorEquipo(b.lineas, d.fichas, d.m3PorViaje, d.nombresEmpresa);
      const celda = (r: RenglonEquipo, c: ColumnaEquipo) =>
        c === 'code' ? esc(r.code) : c === 'empresa' ? esc(r.empresa) : c === 'marcaModelo' ? esc(marcaModeloPago(r, o)) : c === 'placa' ? esc(r.placa || '—')
          : c === 'encargado' ? esc(r.encargado || '—') : c === 'zona' ? r.zona : c === 'viajes' ? String(r.viajes)
            : c === 'm3' ? m3Texto(r.m3) : c === 'precio' ? usd(r.precio) : usd(r.monto);
      const motivos = new Map<MotivoSinPago, number>();
      b.lineas.forEach((l) => { if (l.motivoSinPago && l.motivoSinPago !== 'no_facturo') motivos.set(l.motivoSinPago, (motivos.get(l.motivoSinPago) ?? 0) + 1); });
      const porQue = Array.from(motivos.entries()).sort((a, c) => c[1] - a[1]).map(([k, n]) => `${n} ${d.etiquetaMotivo(k).toLowerCase()}`).join(' · ');
      const m3Bloque = redondear(rs.reduce((a, r) => a + r.m3, 0));
      partes.push(`<h3>${esc(b.nombre)} — ${usd(b.total.monto)}${!o.sinCubicaje && m3Bloque > 0 ? ` · ${m3Texto(m3Bloque)}` : ''}</h3>
        <table><thead><tr>${cols.map((c) => `<th${num.has(c) ? ' class="r"' : ''}>${titulos[c]}</th>`).join('')}</tr></thead>
        <tbody>${rs.map((r) => `<tr>${cols.map((c) => `<td${num.has(c) ? ` class="r${c === 'monto' ? ' b' : ''}"` : ''}>${celda(r, c)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="c">Sin viajes pagados</td></tr>`}</tbody></table>
        ${b.total.noFacturados || b.total.pendientes ? `<p class="n">${b.total.noFacturados ? `${b.total.noFacturados} viaje(s) marcados «no facturó». ` : ''}${b.total.pendientes ? `${b.total.pendientes} viaje(s) sin pagar: ${porQue}.` : ''}</p>` : ''}`);
    });
  }

  if (!o.sinAlcance) {
    partes.push(`<div class="alc"><b>Alcance del informe</b><br/>${alcancePagoEnPalabras(d.filtro, d.eje, o, d.nombresEmpresa).map(esc).join('<br/>')}<br/>${esc(ocultosPagoEnPalabras(o))}</div>`);
  }
  return partes.join('\n');
}
