// 🏭 CENTRO DE OPERACIONES — 📋 REPORTE DE LA FLOTA (11-nov-2026).
//
// Pedido: «poder sacar el reporte de las maquinarias que tengo, así como el reporte del catálogo
// que puedo seleccionar por categoría, por empresa, por maquinaria; un reporte al que le puedo
// colocar y quitar logos, colocar y quitar columnas».
//
//   · SOLO LEE: la flota del sitio, lo que dice inspección de las vinculadas y, de esas, su
//     categoría y empresa en el Catálogo. No escribe nada.
//   · El ESTADO de cada máquina sale de LA regla del bloque 🚜 (`estadoDelSitio`): la marca del
//     sitio si manda, si no lo que dice inspección; así el papel y la pantalla dicen lo mismo.
//   · Filtros por estado, categoría, empresa y máquina; columnas que se ponen y se quitan; los
//     logos y el membrete los pone la pestaña (los mismos de los demás papeles del sitio).
//
// Pura (sin pantalla ni base): se prueba en scripts/test-centro-operaciones-flota-reporte.mjs.
import type { EstadoUnidad, Unidad } from './centroOperaciones';
import { estadoDelSitio } from './centroOperacionesMaquinariaBloques';
import { escaparHtml } from './centroOperacionesPapel';

/** El estado de una fila: una de las 6 marcas (disponible = operativa) o «sin dato». */
export type EstadoFlota = EstadoUnidad | 'sin_dato';
export const ESTADOS_FLOTA: readonly EstadoFlota[] = ['disponible', 'averiada', 'parada', 'espera', 'retirada', 'transferida', 'sin_dato'];
export const ETIQUETA_ESTADO_FLOTA: Record<EstadoFlota, string> = {
  disponible: '✅ Operativa', averiada: '🔧 Averiada', parada: '🟡 Parada', espera: '⏳ En espera',
  retirada: '⬛ Retirada', transferida: '🔁 Transferida', sin_dato: '❔ Sin dato',
};

/** Lo que el Catálogo sabe de una vinculada (solo lectura). */
export type InfoCatalogo = { clasificacion: string | null; empresa: string | null };

export type FilaFlota = {
  id: string;
  codigo: string;
  descripcion: string;
  placa: string;
  serial: string;
  marcaModelo: string;
  categoria: string;
  empresa: string;
  origen: 'Catálogo' | 'Propia';
  estado: EstadoFlota;
  /** De dónde sale el estado: «marcado en el sitio» o «según inspección». */
  fuente: string;
  desde: string;
  chofer: string;
  capacidad: string;
  nota: string;
};

const limpia = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const SIN_CATEGORIA = 'Sin categoría';
const SIN_EMPRESA = 'Sin empresa';

/** Lo que dice inspección (los 6 cubos) → la misma clave de las marcas. */
const deConteo = (e: string | null | undefined): EstadoFlota =>
  e === 'operativa' ? 'disponible' : e === 'averiada' || e === 'parada' || e === 'espera' || e === 'retirada' || e === 'transferida' ? e : 'sin_dato';

function fechaCorta(iso: string | null | undefined): string {
  const t = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(t)) return '';
  const d = new Date(t - 4 * 3600 * 1000); // hora de Caracas
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

/**
 * ⭐ Las filas del reporte: las unidades ACTIVAS del sitio con su estado (LA regla del bloque 🚜),
 * su categoría y su empresa (las vinculadas, del Catálogo; las propias, su descripción y su dueño).
 */
export function filasDeFlota(unidades: Unidad[], inspeccion: any, catalogo: Record<string, InfoCatalogo>, ahoraMs: number): FilaFlota[] {
  return (unidades ?? [])
    .filter((u) => u && u.activo !== false)
    .map((u): FilaFlota => {
      const e = estadoDelSitio(u, inspeccion ?? null, ahoraMs);
      const cat = u.machineryId ? catalogo?.[u.machineryId] ?? null : null;
      let estado: EstadoFlota;
      let fuente: string;
      if (e.encendida) { estado = e.encendida; fuente = u.machineryId ? 'marcado en el sitio' : 'solo del sitio'; }
      else if (e.inspeccion?.encontrada && e.inspeccion.estado) { estado = deConteo(e.inspeccion.estado); fuente = 'según inspección'; }
      else { estado = 'sin_dato'; fuente = u.machineryId ? 'no se pudo leer inspección' : ''; }
      const desde = e.encendida ? fechaCorta(u.estadoAt) : (e.inspeccion?.desdeMs ? fechaCorta(new Date(e.inspeccion.desdeMs).toISOString()) : '');
      return {
        id: u.id,
        codigo: limpia(u.codigo),
        descripcion: limpia(u.descripcion),
        placa: limpia(u.placa),
        serial: limpia(u.serial),
        marcaModelo: [limpia(u.marca), limpia(u.modelo)].filter(Boolean).join(' '),
        categoria: limpia(cat?.clasificacion) || limpia(u.descripcion) || SIN_CATEGORIA,
        empresa: limpia(cat?.empresa) || limpia(u.dueno) || SIN_EMPRESA,
        origen: u.machineryId ? 'Catálogo' : 'Propia',
        estado,
        fuente,
        desde,
        chofer: limpia(u.chofer),
        capacidad: u.capacidadM3 != null && Number.isFinite(Number(u.capacidadM3)) ? `${String(u.capacidadM3).replace('.', ',')} m³` : '',
        nota: limpia(e.encendida ? u.estadoNota : '') || limpia(u.nota),
      };
    })
    .sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
}

/** Las categorías y empresas que hay (para las pastillas), A→Z. */
export function opcionesDeFlota(filas: FilaFlota[]): { categorias: string[]; empresas: string[] } {
  const az = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  return { categorias: az(filas.map((f) => f.categoria)), empresas: az(filas.map((f) => f.empresa)) };
}

export type FiltrosFlota = { estados?: EstadoFlota[]; categorias?: string[]; empresas?: string[]; ids?: string[] | null };

/** Vacío = todos (en cada filtro). `ids` = las máquinas elegidas a mano (null = todas). */
export function filtrarFlota(filas: FilaFlota[], f: FiltrosFlota): FilaFlota[] {
  const est = new Set(f.estados ?? []);
  const cat = new Set(f.categorias ?? []);
  const emp = new Set(f.empresas ?? []);
  const ids = f.ids ? new Set(f.ids) : null;
  return filas.filter((x) => (!est.size || est.has(x.estado)) && (!cat.size || cat.has(x.categoria)) && (!emp.size || emp.has(x.empresa)) && (!ids || ids.has(x.id)));
}

/** Cuántas hay en cada estado (para las tarjetas y los cubos). */
export function conteoFlota(filas: FilaFlota[]): Record<EstadoFlota, number> {
  const c = Object.fromEntries(ESTADOS_FLOTA.map((e) => [e, 0])) as Record<EstadoFlota, number>;
  for (const f of filas) c[f.estado]++;
  return c;
}

/** Las columnas que se ponen y se quitan (en orden). `porDefecto`: las que nacen puestas. */
export const COLUMNAS_FLOTA: { key: keyof FilaFlota | 'n'; label: string; porDefecto: boolean }[] = [
  { key: 'n', label: '#', porDefecto: true },
  { key: 'codigo', label: 'Código', porDefecto: true },
  { key: 'descripcion', label: 'Descripción', porDefecto: true },
  { key: 'placa', label: 'Placa', porDefecto: true },
  { key: 'serial', label: 'Serial', porDefecto: false },
  { key: 'marcaModelo', label: 'Marca / modelo', porDefecto: true },
  { key: 'categoria', label: 'Categoría', porDefecto: true },
  { key: 'empresa', label: 'Empresa', porDefecto: true },
  { key: 'origen', label: 'Propia / Catálogo', porDefecto: false },
  { key: 'estado', label: 'Estado', porDefecto: true },
  { key: 'desde', label: 'Desde', porDefecto: true },
  { key: 'fuente', label: 'De dónde sale el estado', porDefecto: false },
  { key: 'chofer', label: 'Chofer / operador', porDefecto: false },
  { key: 'capacidad', label: 'Capacidad', porDefecto: false },
  { key: 'nota', label: 'Observación', porDefecto: false },
];
export const columnasPorDefecto = (): string[] => COLUMNAS_FLOTA.filter((c) => c.porDefecto).map((c) => c.key);

const COLOR_ESTADO: Record<EstadoFlota, string> = {
  disponible: '#15803D', averiada: '#B91C1C', parada: '#B45309', espera: '#B45309', retirada: '#4B5563', transferida: '#0D9488', sin_dato: '#6B7280',
};

/** El cuerpo del papel: las tarjetas por estado (solo las que tienen algo) y la tabla. */
export function cuerpoFlota(filas: FilaFlota[], columnas: string[]): string {
  const cols = COLUMNAS_FLOTA.filter((c) => columnas.includes(c.key));
  const c = conteoFlota(filas);
  const tarjetas = ESTADOS_FLOTA.filter((e) => c[e] > 0)
    .map((e) => `<div class="fl-card" style="border-top:3px solid ${COLOR_ESTADO[e]}"><span>${escaparHtml(ETIQUETA_ESTADO_FLOTA[e])}</span><b>${c[e]}</b></div>`)
    .concat([`<div class="fl-card"><span>Total</span><b>${filas.length}</b></div>`]).join('');
  const celda = (f: FilaFlota, k: string, i: number) => {
    if (k === 'n') return String(i + 1);
    if (k === 'estado') return `<b style="color:${COLOR_ESTADO[f.estado]}">${escaparHtml(ETIQUETA_ESTADO_FLOTA[f.estado])}</b>`;
    return escaparHtml((f as any)[k] ?? '');
  };
  const tabla = filas.length
    ? `<table class="fl-tabla"><thead><tr>${cols.map((x) => `<th>${escaparHtml(x.label)}</th>`).join('')}</tr></thead><tbody>${
      filas.map((f, i) => `<tr>${cols.map((x) => `<td>${celda(f, x.key, i)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    : '<p>No hay máquinas con esos filtros.</p>';
  return `<div class="fl-cards">${tarjetas}</div>${tabla}`;
}

export const CSS_FLOTA = `
.fl-cards{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 12px}
.fl-card{flex:1 1 110px;border:1px solid #CBD5E1;border-radius:6px;padding:6px 8px;text-align:center}
.fl-card span{display:block;font-size:9pt;color:#475569}
.fl-card b{display:block;font-size:15pt}
.fl-tabla{width:100%;border-collapse:collapse;font-size:9pt}
.fl-tabla th{background:#1E3A5F;color:#fff;padding:6px 5px;text-align:left;font-size:8.5pt;text-transform:uppercase}
.fl-tabla td{border-bottom:1px solid #E2E8F0;padding:5px}
.fl-tabla tr{page-break-inside:avoid}
`;

/** El nombre del archivo: sitio, fecha y los filtros (no se anuncian en el papel, van aquí). */
export function nombreArchivoFlota(sitio: string, hoyIso: string, f: FiltrosFlota): string {
  const partes = ['Flota', sitio, hoyIso];
  if (f.estados?.length) partes.push(f.estados.map((e) => ETIQUETA_ESTADO_FLOTA[e].replace(/^\S+\s/, '')).join('-'));
  if (f.categorias?.length) partes.push(f.categorias.join('-'));
  if (f.empresas?.length) partes.push(f.empresas.join('-'));
  if (f.ids?.length) partes.push(`${f.ids.length} maquinas`);
  return partes.join(' - ').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 150);
}
