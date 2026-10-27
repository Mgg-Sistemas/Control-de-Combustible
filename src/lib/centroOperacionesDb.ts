// 🏭 CENTRO DE OPERACIONES — LA CAPA DE DATOS (23-oct-2026).
//
// ⭐ ES EL ÚNICO ARCHIVO DEL MÓDULO QUE HABLA CON SUPABASE. Las pantallas no
//    importan `supabase`: piden y guardan por acá. Las cuentas viven en
//    `centroOperaciones.ts` (puro); acá solo se lee y se escribe.
//
// ⭐ SOLO SE ESCRIBE EN TABLAS `cop_*` (y nunca un `rpc`). De afuera se LEE, para
//    sugerir, y nada más: `machinery`, `companies`, `viaje_frentes` y
//    `ubicaciones_obra`. Lo que se recibe se congela como texto en las tablas del
//    módulo: «que pueda RECIBIR información pero no ENVIARLA».
//    `scripts/test-centro-operaciones-datos.mjs` lo vigila sobre este texto.
//    Del lector del Reporte General solo se importa su TIPO: el texto se lee en la
//    pantalla y acá llega ya leído.
//
// ⭐ TODA ESCRITURA TERMINA EN `.select('id')`: la RLS rechaza un update o un
//    delete SIN error y con 0 filas. 0 filas = no se guardó, y se dice.
//    Quién puede qué (RLS ya en la base): leer pide el módulo ≠ none; anotar o
//    editar renglones pide 'escritura' o 'full'; sitios, flota, listas, ajustes y
//    borrar renglones piden 'full'.
//
// ⭐ EL SELLO (`created_*`, `updated_*`) LO PONE LA BASE: nunca se manda. Las
//    traducciones objeto → fila ni siquiera lo conocen.
//
// ⭐ EL ESTADO DE INSPECCIÓN de las unidades vinculadas (mesa de maquinaria, 26-oct-2026) se
//    lee SOLO por la librería compartida `machineLiveStatus.ts` (la regla única del sistema,
//    que este archivo NO copia: ni nombra sus tablas ni define piezas del clasificador), y
//    solo desde acá. Solo se LEE. `cargarEstadoInspeccion` entrega lo que dice inspección y la
//    librería pura (`estadoDelSitio`) decide qué manda.
import { supabase, selectAllRows } from './supabase';
import type {
  EstadoUnidad, FilaReporteDia, ItemLista, MotivoGuardia, Movimiento, PatioDelDia, ReporteGeneralGuardado, Sitio, Unidad,
} from './centroOperaciones';
import { conTope, esRenglonDePatio, fechaValida, fraseHechoInspeccion } from './centroOperaciones';
import type { ReporteGeneral } from './centroOperacionesReporteGeneral';
import type { EstadoConteo, NovedadInspeccion } from './machineLiveStatus';
import {
  ESTADO_CONTEO_INFO, MARGEN_HORA_FUTURA_MS, estadoConteoDe, fetchAveriaCat, fetchInspByShift, fetchJornadaCat, fetchNovedadesInspeccion, makeLiveStatusOf,
} from './machineLiveStatus';
import { cmpText, norm } from './text';

/** El aviso de cuando la base no guardó nada (0 filas o rechazo de permisos). */
export const NO_SE_GUARDO = 'No se guardó: no tienes permiso o se perdió la conexión.';
/** El aviso de cuando un BORRADO no borró nada (0 filas o rechazo de permisos). */
export const NO_SE_BORRO = 'No se borró: no tienes permiso o el renglón ya no existe (actualiza la lista).';

// ═══════════════════════════ Traducciones fila ↔ objeto ═══════════════════════════
//
// Cada tabla se describe UNA vez: [campo del objeto, columna de la base, clase].
//   · 'texto'    → columna obligatoria: se guarda tal cual.
//   · 'opcional' → texto, hora o uuid que puede faltar: en blanco = null (la base
//                  no acepta «» como hora ni como uuid).
//   · 'numero'   → cifra o null; nunca NaN. Postgres puede devolver un numeric
//                  como texto («14.00»): se convierte.
//   · 'bool'     → sí/no.
// Del objeto a la fila viaja SOLO lo que vino (Partial): editar el estado no
// borra la observación.

type Clase = 'texto' | 'opcional' | 'numero' | 'bool';
type Campo = readonly [campo: string, columna: string, clase: Clase];

const CAMPOS_MOVIMIENTO: readonly Campo[] = [
  ['id', 'id', 'opcional'],
  ['sitioId', 'sitio_id', 'opcional'],
  ['fecha', 'fecha', 'texto'],
  ['hora', 'hora', 'opcional'],
  ['tipo', 'tipo', 'texto'],
  ['unidadId', 'unidad_id', 'opcional'],
  ['unidadTexto', 'unidad_texto', 'texto'],
  ['placa', 'placa', 'opcional'],
  ['transportista', 'transportista', 'opcional'],
  ['transportistaId', 'transportista_lista_id', 'opcional'],
  ['origen', 'origen', 'opcional'],
  ['origenId', 'origen_lista_id', 'opcional'],
  ['destino', 'destino', 'opcional'],
  ['destinoId', 'destino_lista_id', 'opcional'],
  ['material', 'material', 'opcional'],
  ['materialId', 'material_lista_id', 'opcional'],
  ['capacidadM3', 'capacidad_m3', 'numero'],
  ['viajes', 'viajes', 'numero'],
  ['toneladas', 'toneladas', 'numero'],
  ['m3', 'm3', 'numero'],
  ['estado', 'estado', 'texto'],
  ['observacion', 'observacion', 'opcional'],
  // Parte diario (24-oct-2026). En blanco = null: los checks de la base no aceptan «».
  ['chofer', 'chofer', 'opcional'],
  ['km', 'km', 'numero'],
  ['vehiculo', 'vehiculo', 'opcional'],
  ['cantidad', 'cantidad', 'numero'],
  ['unidadIngresada', 'unidad_ingresada', 'opcional'],
  ['disponibleDesde', 'disponible_desde', 'opcional'],
];

const CAMPOS_SITIO: readonly Campo[] = [
  ['id', 'id', 'opcional'],
  ['nombre', 'nombre', 'texto'],
  ['nota', 'nota', 'opcional'],
  ['activo', 'activo', 'bool'],
  ['ubicacionId', 'ubicacion_id', 'opcional'],
  ['lat', 'lat', 'numero'],
  ['lng', 'lng', 'numero'],
];

const CAMPOS_UNIDAD: readonly Campo[] = [
  ['id', 'id', 'opcional'],
  ['sitioId', 'sitio_id', 'opcional'],
  ['origen', 'origen', 'texto'],
  ['machineryId', 'machinery_id', 'opcional'],
  ['codigo', 'codigo', 'texto'],
  ['descripcion', 'descripcion', 'opcional'],
  ['placa', 'placa', 'opcional'],
  ['serial', 'serial', 'opcional'],
  ['marca', 'marca', 'opcional'],
  ['modelo', 'modelo', 'opcional'],
  ['dueno', 'dueno', 'opcional'],
  ['capacidadM3', 'capacidad_m3', 'numero'],
  ['activo', 'activo', 'bool'],
  ['nota', 'nota', 'opcional'],
  // Parte diario. `estado_at` NO está acá: lo pone un trigger y solo se LEE (como el sello).
  ['estado', 'estado', 'opcional'],
  ['estadoNota', 'estado_nota', 'opcional'],
  ['chofer', 'chofer', 'opcional'],
];

const CAMPOS_LISTA: readonly Campo[] = [
  ['id', 'id', 'opcional'],
  ['sitioId', 'sitio_id', 'opcional'],
  ['clase', 'clase', 'texto'],
  ['nombre', 'nombre', 'texto'],
  ['activo', 'activo', 'bool'],
  // Parte diario: GPS y km (destinos), factor t/m³ y días hasta disponible (materiales).
  ['lat', 'lat', 'numero'],
  ['lng', 'lng', 'numero'],
  ['km', 'km', 'numero'],
  ['factorTM3', 'factor_t_m3', 'numero'],
  ['diasDisponible', 'dias_disponible', 'numero'],
];

/** Las marcas que el sitio le puede poner a una unidad (`cop_unidades.estado`). */
const ESTADOS_UNIDAD: readonly string[] = ['disponible', 'averiada'];

/** Lo que el sello de la base le dice al renglón (solo se LEE). */
const COLUMNAS_SELLO_MOVIMIENTO = 'created_by_nombre, created_at, updated_by_nombre, updated_at';

const columnasDe = (campos: readonly Campo[]): string => campos.map(([, col]) => col).join(', ');
const COLS_MOVIMIENTO = `${columnasDe(CAMPOS_MOVIMIENTO)}, ${COLUMNAS_SELLO_MOVIMIENTO}`;
const COLS_SITIO = columnasDe(CAMPOS_SITIO);
/** `estado_at` se pide para mostrarlo, pero no está en CAMPOS_UNIDAD: nunca viaja de vuelta. */
const COLS_UNIDAD = `${columnasDe(CAMPOS_UNIDAD)}, estado_at`;
const COLS_LISTA = columnasDe(CAMPOS_LISTA);

/** Una cifra de verdad o null: nunca NaN ni Infinity. Acepta el numeric como texto. */
const aNumero = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/** Texto opcional: null si falta o está en blanco; si no, tal cual se escribió. */
const opcional = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s.trim() ? s : null;
};

const haciaLaBase = (clase: Clase, v: unknown): unknown => {
  switch (clase) {
    case 'texto': return v === null ? null : String(v);
    case 'opcional': return opcional(v);
    case 'numero': return aNumero(v);
    case 'bool': return Boolean(v);
  }
};

const desdeLaBase = (clase: Clase, v: unknown): unknown => {
  switch (clase) {
    case 'texto': return v === null || v === undefined ? '' : String(v);
    case 'opcional': return v === null || v === undefined ? null : String(v);
    case 'numero': return aNumero(v);
    case 'bool': return v !== false;
  }
};

/** Objeto → fila, SOLO con lo que vino (lo `undefined` no viaja). */
function aFila(campos: readonly Campo[], obj: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const fila: Record<string, unknown> = {};
  if (!obj) return fila;
  for (const [campo, columna, clase] of campos) {
    if (obj[campo] === undefined) continue;
    fila[columna] = haciaLaBase(clase, obj[campo]);
  }
  return fila;
}

/** Fila → objeto, con todos los campos (lo que falte sale vacío, nunca undefined). */
function deFila(campos: readonly Campo[], r: any): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [campo, columna, clase] of campos) obj[campo] = desdeLaBase(clase, r?.[columna]);
  return obj;
}

/** Una fila de `cop_movimientos` → `Movimiento`, con el sello para mostrarlo. */
export function filaAMovimiento(r: any): Movimiento {
  return {
    ...(deFila(CAMPOS_MOVIMIENTO, r) as Omit<Movimiento, 'creadoPor' | 'creadoAt' | 'editadoPor' | 'editadoAt'>),
    creadoPor: opcional(r?.created_by_nombre),
    creadoAt: opcional(r?.created_at),
    editadoPor: opcional(r?.updated_by_nombre),
    editadoAt: opcional(r?.updated_at),
  };
}

/** `Movimiento` (o parte) → fila de `cop_movimientos`. Sin sello: lo pone la base.
 *  Lleva el `id` si vino (para la ida y vuelta); las funciones de guardar lo
 *  sacan del cuerpo y lo usan solo para saber CUÁL renglón editar. */
export function movimientoAFila(m: Partial<Movimiento>): Record<string, unknown> {
  return aFila(CAMPOS_MOVIMIENTO, m as Record<string, unknown>);
}

export const filaASitio = (r: any): Sitio => deFila(CAMPOS_SITIO, r) as Sitio;
export const sitioAFila = (s: Partial<Sitio>): Record<string, unknown> => aFila(CAMPOS_SITIO, s as Record<string, unknown>);
/** Una fila de `cop_unidades` → `Unidad`. ⭐ Sin estado es «SIN MARCA» (null), NUNCA
 *  «disponible»: en una vinculada manda inspección (26-oct-2026; antes se inventaba un
 *  'disponible' que tapaba las averías de inspección). Un valor que no es una marca conocida
 *  tampoco se inventa: null. `estadoAt` se lee aparte porque nunca se manda. */
export const filaAUnidad = (r: any): Unidad => {
  const estado = opcional(r?.estado)?.trim() ?? null;
  return {
    ...(deFila(CAMPOS_UNIDAD, r) as Omit<Unidad, 'estado' | 'estadoAt'>),
    estado: estado !== null && ESTADOS_UNIDAD.includes(estado) ? (estado as EstadoUnidad) : null,
    estadoAt: opcional(r?.estado_at),
  };
};
export const unidadAFila = (u: Partial<Unidad>): Record<string, unknown> => aFila(CAMPOS_UNIDAD, u as Record<string, unknown>);
export const filaAItemLista = (r: any): ItemLista => deFila(CAMPOS_LISTA, r) as ItemLista;
export const itemListaAFila = (i: Partial<ItemLista>): Record<string, unknown> => aFila(CAMPOS_LISTA, i as Record<string, unknown>);

// ═══════════════════════════ Errores en español ═══════════════════════════

type Respuesta = { data: any; error: any };

const esDuplicado = (e: any): boolean => String(e?.code ?? '') === '23505' || /duplicate key/i.test(String(e?.message ?? ''));
const esSinConexion = (msg: string): boolean => /failed to fetch|network|fetch failed|timeout|timed out/i.test(msg);

/** El error de la base, dicho en español. `prefijo` = «No se guardó el sitio»… */
function errorEnEspanol(e: any, prefijo: string, duplicado?: string): Error {
  const code = String(e?.code ?? '');
  const msg = String(e?.message ?? e ?? '');
  // Un insert que la RLS no deja pasar SÍ trae error (42501), a diferencia del
  // update/delete que vuelve con 0 filas: los dos se dicen igual.
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) return new Error(NO_SE_GUARDO);
  if (esDuplicado(e)) return new Error(duplicado ?? `${prefijo}: ya existe uno igual.`);
  if (code === '23514' || /check constraint/i.test(msg)) {
    return new Error(`${prefijo}: hay un dato que no cuadra (una cifra negativa, o viajes vacíos sin estar «por confirmar»).`);
  }
  if (code === '23502' || /null value in column/i.test(msg)) return new Error(`${prefijo}: falta un dato obligatorio.`);
  if (code === '23503' || /foreign key/i.test(msg)) return new Error(`${prefijo}: el sitio, la unidad o el nombre de la lista elegido ya no existe.`);
  if (esSinConexion(msg)) return new Error(`${prefijo}: se perdió la conexión.`);
  return new Error(`${prefijo}: ${msg}`);
}

/** Una lectura que falló, dicha en español. `que` = «los sitios», «los registros»… */
function errorDeLectura(e: any, que: string): Error {
  const msg = String(e?.message ?? e ?? '');
  return new Error(`No se pudieron cargar ${que}: ${esSinConexion(msg) ? 'se perdió la conexión.' : msg}`);
}

/** Espera una escritura que terminó en `.select('id')`: error → en español;
 *  0 filas (la RLS rechazó callada) → `NO_SE_GUARDO`. */
async function escribir(consulta: PromiseLike<Respuesta>, prefijo: string, duplicado?: string): Promise<{ id: string }[]> {
  const { data, error } = await consulta;
  if (error) throw errorEnEspanol(error, prefijo, duplicado);
  const filas = Array.isArray(data) ? data : [];
  if (filas.length === 0) throw new Error(NO_SE_GUARDO);
  return filas as { id: string }[];
}

/** Nuevo (sin id) → insert; con id → update de ESE renglón. Devuelve el id. */
async function guardarFila(
  id: string | null | undefined,
  filaConId: Record<string, unknown>,
  prefijo: string,
  insertar: (fila: Record<string, unknown>) => PromiseLike<Respuesta>,
  actualizar: (fila: Record<string, unknown>, id: string) => PromiseLike<Respuesta>,
  duplicado?: string,
): Promise<string> {
  const { id: _fuera, ...fila } = filaConId;
  const cual = opcional(id);
  if (cual && Object.keys(fila).length === 0) throw new Error(`${prefijo}: no hay ningún dato que cambiar.`);
  const filas = await escribir(cual ? actualizar(fila, cual) : insertar(fila), prefijo, duplicado);
  return String(filas[0].id);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El id del sitio va DENTRO del texto de un `.or(…)`: si no es un uuid, no entra
 *  (una coma o un paréntesis cambiarían el filtro). */
function sitioParaFiltro(sitioId: string, que: string): string {
  const id = String(sitioId ?? '').trim();
  if (!UUID.test(id)) throw new Error(`No se pudieron cargar ${que}: el sitio elegido no es válido.`);
  return id;
}

// ═══════════════════════════ Sitios ═══════════════════════════

/** Todos los sitios (también los inactivos: la pantalla decide qué muestra), A→Z. */
export async function cargarSitios(): Promise<Sitio[]> {
  let filas: any[];
  try {
    filas = await selectAllRows('cop_sitios', COLS_SITIO);
  } catch (e) {
    throw errorDeLectura(e, 'los sitios');
  }
  return filas.map(filaASitio).sort((a, b) => cmpText(a.nombre, b.nombre));
}

/** Crea (sin id) o edita un sitio. Desactivar = `activo: false`; nunca se borra. */
export async function guardarSitio(s: Partial<Sitio>): Promise<string> {
  return guardarFila(
    s.id, sitioAFila(s), 'No se guardó el sitio',
    (fila) => supabase.from('cop_sitios').insert(fila).select('id'),
    (fila, id) => supabase.from('cop_sitios').update(fila).eq('id', id).select('id'),
    'Ya existe un sitio activo con ese nombre.',
  );
}

// ═══════════════════════════ Flota (unidades) ═══════════════════════════

/** La flota del sitio (activas e inactivas), A→Z natural por código. */
export async function cargarUnidades(sitioId: string): Promise<Unidad[]> {
  let filas: any[];
  try {
    filas = await selectAllRows('cop_unidades', COLS_UNIDAD, (q: any) => q.eq('sitio_id', sitioId));
  } catch (e) {
    throw errorDeLectura(e, 'las unidades');
  }
  return filas.map(filaAUnidad).sort((a, b) => cmpText(a.codigo, b.codigo));
}

/**
 * Crea (sin id) o edita una unidad. Dar de baja = `activo: false`; nunca se borra.
 *  · ⭐ Al CREAR una unidad del sitio (sin vínculo al catálogo) manda `estado: 'disponible'`
 *    si no trae marca: la base exige que una unidad sin vínculo tenga estado (D6). Una
 *    vinculada nace SIN marca (manda inspección).
 *  · ⭐ Al EDITAR rechaza `machineryId` y `origen` (D8): vincular o desvincular no existe
 *    todavía; para cambiarlo, se da de baja y se da de alta. Reactivar manda lo que dice
 *    `cambioAlReactivar` (la marca a null en una vinculada).
 *  · La marca de todos los días NO va por acá: `guardarMarcaUnidad`, `guardarNotaMarca` y
 *    `soltarMarcaUnidad` (una sola puerta por intención).
 */
export async function guardarUnidad(u: Partial<Unidad>): Promise<string> {
  const prefijo = 'No se guardó la unidad';
  if (opcional(u?.id) && (u.machineryId !== undefined || u.origen !== undefined)) {
    throw new Error(`${prefijo}: el vínculo con el catálogo no se cambia al editar (da de baja la unidad y créala de nuevo).`);
  }
  const fila = unidadAFila(u);
  if (!opcional(u?.id) && !opcional(u?.machineryId) && fila.estado == null) fila.estado = 'disponible';
  return guardarFila(
    u.id, fila, prefijo,
    (fila) => supabase.from('cop_unidades').insert(fila).select('id'),
    (fila, id) => supabase.from('cop_unidades').update(fila).eq('id', id).select('id'),
    'Esa máquina del catálogo ya está en la flota activa de este sitio.',
  );
}

// ═══════════════════════════ Listas de apoyo ═══════════════════════════

/** Los nombres del sitio MÁS los generales (sitio null = para todos), A→Z. */
export async function cargarListas(sitioId: string): Promise<ItemLista[]> {
  const id = sitioParaFiltro(sitioId, 'las listas');
  let filas: any[];
  try {
    filas = await selectAllRows('cop_listas', COLS_LISTA, (q: any) => q.or(`sitio_id.eq.${id},sitio_id.is.null`));
  } catch (e) {
    throw errorDeLectura(e, 'las listas');
  }
  return filas.map(filaAItemLista).sort((a, b) => cmpText(a.nombre, b.nombre) || cmpText(a.clase, b.clase));
}

/** Crea (sin id) o edita un nombre de lista. Desactivar = `activo: false`. */
export async function guardarItemLista(i: Partial<ItemLista>): Promise<string> {
  return guardarFila(
    i.id, itemListaAFila(i), 'No se guardó el nombre de la lista',
    (fila) => supabase.from('cop_listas').insert(fila).select('id'),
    (fila, id) => supabase.from('cop_listas').update(fila).eq('id', id).select('id'),
    'Ese nombre ya está en la lista.',
  );
}

// ═══════════════════════════ Ajustes (textos fijos, logos) ═══════════════════════════

/**
 * Los ajustes como { clave: valor }. Con sitio: los GENERALES y encima los del
 * sitio (lo del sitio manda). Con null: solo los generales.
 */
export async function cargarAjustes(sitioId: string | null): Promise<Record<string, unknown>> {
  const id = opcional(sitioId) ? sitioParaFiltro(String(sitioId), 'los ajustes') : null;
  let filas: any[];
  try {
    filas = await selectAllRows('cop_ajustes', 'id, sitio_id, clave, valor',
      (q: any) => (id ? q.or(`sitio_id.eq.${id},sitio_id.is.null`) : q.is('sitio_id', null)));
  } catch (e) {
    throw errorDeLectura(e, 'los ajustes');
  }
  const ajustes: Record<string, unknown> = {};
  for (const r of filas) if (r.sitio_id == null) ajustes[String(r.clave)] = r.valor;
  for (const r of filas) if (r.sitio_id != null) ajustes[String(r.clave)] = r.valor;
  return ajustes;
}

/**
 * Guarda un ajuste del sitio (o general, con null). Hay UNO por (sitio, clave):
 * si ya existe se actualiza; si no, se crea. No se usa `upsert` porque el único
 * de la base es sobre una EXPRESIÓN (el sitio null cuenta como «general») y
 * `on_conflict` no puede nombrarla.
 */
export async function guardarAjuste(sitioId: string | null, clave: string, valor: unknown): Promise<void> {
  const sitio = opcional(sitioId);
  const c = String(clave ?? '').trim();
  const prefijo = 'No se guardó el ajuste';
  if (!c) throw new Error(`${prefijo}: falta su clave.`);
  const v = valor === undefined ? null : valor;

  const buscar = async (): Promise<string | null> => {
    const consulta = supabase.from('cop_ajustes').select('id').eq('clave', c);
    const { data, error } = await (sitio ? consulta.eq('sitio_id', sitio) : consulta.is('sitio_id', null)).limit(1);
    if (error) throw errorEnEspanol(error, prefijo);
    return data?.[0]?.id ? String(data[0].id) : null;
  };
  const actualizar = (id: string) =>
    escribir(supabase.from('cop_ajustes').update({ valor: v }).eq('id', id).select('id'), prefijo);

  const existente = await buscar();
  if (existente) { await actualizar(existente); return; }

  const { data, error } = await supabase.from('cop_ajustes').insert({ sitio_id: sitio, clave: c, valor: v }).select('id');
  if (error && esDuplicado(error)) {
    // Otro equipo lo creó en el mismo instante: el único lo rechazó acá, así que
    // se actualiza el que quedó.
    const otro = await buscar();
    if (otro) { await actualizar(otro); return; }
  }
  if (error) throw errorEnEspanol(error, prefijo);
  if (!Array.isArray(data) || data.length === 0) throw new Error(NO_SE_GUARDO);
}

// ═══════════════════════════ Movimientos (los renglones) ═══════════════════════════

/**
 * Los renglones del sitio con FECHA DE JORNADA entre `desde` y `hasta` (ambas
 * incluidas). Ordenados por fecha, hora y momento de carga; `selectAllRows`
 * agrega el `id` al final, así la paginación no salta ni repite renglones.
 */
export async function cargarMovimientos(sitioId: string, desde: string, hasta: string): Promise<Movimiento[]> {
  let filas: any[];
  try {
    filas = await selectAllRows('cop_movimientos', COLS_MOVIMIENTO, (q: any) => q
      .eq('sitio_id', sitioId)
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha', { ascending: true })
      .order('hora', { ascending: true })
      .order('created_at', { ascending: true }));
  } catch (e) {
    throw errorDeLectura(e, 'los registros');
  }
  return filas.map(filaAMovimiento);
}

/** Anota (sin id) o edita un renglón. Lo que no se pasa no se toca. */
export async function guardarMovimiento(m: Partial<Movimiento>): Promise<string> {
  return guardarFila(
    m.id, movimientoAFila(m), 'No se guardó el renglón',
    (fila) => supabase.from('cop_movimientos').insert(fila).select('id'),
    (fila, id) => supabase.from('cop_movimientos').update(fila).eq('id', id).select('id'),
  );
}

/**
 * Borra un renglón (la RLS pide 'full'; sin él vuelve con 0 filas y se avisa). Con 0
 * filas o sin permiso el aviso es PROPIO del borrado (`NO_SE_BORRO`), no «No se
 * guardó…»: para quien tiene Full, 0 filas casi siempre es que el renglón ya no existe
 * (otro equipo lo borró, o la lista estaba vieja).
 */
export async function borrarMovimiento(id: string): Promise<void> {
  try {
    await escribir(supabase.from('cop_movimientos').delete().eq('id', id).select('id'), 'No se borró el renglón');
  } catch (e: any) {
    if (e?.message === NO_SE_GUARDO) throw new Error(NO_SE_BORRO);
    throw e;
  }
}

/**
 * Las salidas del sitio que siguen «esperando pesaje», de CUALQUIER fecha (📅 Parte
 * diario, acero: las toneladas llegan días después en la nota de entrega). Solo esas
 * filas: no se trae todo el historial del sitio para encontrarlas. Quien pinta filtra
 * el material con la librería.
 */
export async function cargarSalidasEsperandoPesaje(sitioId: string): Promise<Movimiento[]> {
  let filas: any[];
  try {
    filas = await selectAllRows('cop_movimientos', COLS_MOVIMIENTO, (q: any) => q
      .eq('sitio_id', sitioId)
      .eq('tipo', 'salida')
      .eq('estado', 'esperando_pesaje')
      .order('fecha', { ascending: true })
      .order('created_at', { ascending: true }));
  } catch (e) {
    throw errorDeLectura(e, 'las salidas pendientes de pesaje');
  }
  return filas.map(filaAMovimiento);
}

/**
 * Las PIEZAS de antes del período (📄 Reporte completo, PD5a): las producciones y ventas del
 * sitio con `cantidad` y fecha de jornada ANTERIOR a `antesDe`. Es lo único de la historia
 * que el saldo de bloques necesita (lo producido y lo vendido en piezas): no se baja todo el
 * historial del sitio, y el período no se pide dos veces. Quien pinta filtra el material con
 * la librería (`entradaInventario`), como hace la pantalla con la historia completa.
 */
async function cargarPiezasAnteriores(sitioId: string, antesDe: string): Promise<Movimiento[]> {
  let filas: any[];
  try {
    filas = await selectAllRows('cop_movimientos', COLS_MOVIMIENTO, (q: any) => q
      .eq('sitio_id', sitioId)
      .lt('fecha', antesDe)
      .in('tipo', ['produccion', 'salida'])
      .not('cantidad', 'is', null)
      .order('fecha', { ascending: true })
      .order('created_at', { ascending: true }));
  } catch (e) {
    throw errorDeLectura(e, 'la historia de los bloques');
  }
  return filas.map(filaAMovimiento);
}

/** Lo que el 📄 Reporte completo necesita del sitio en un período (ver `cargarDatosReporteCompleto`). */
export type DatosReporteCompleto = {
  /** Los Reportes Generales de las jornadas del período. */
  reportes: ReporteGeneralGuardado[];
  /** Los renglones con fecha de jornada en el período (todos los tipos). */
  movimientos: Movimiento[];
  /** Las producciones y ventas CON PIEZAS anteriores al período (el saldo de bloques). */
  anteriores: Movimiento[];
  /** La flota del sitio (activas e inactivas): el estado es el de AHORA. */
  unidades: Unidad[];
  /** Las listas del sitio y las generales (patios, materiales…). */
  listas: ItemLista[];
};

/**
 * ⭐ Todo lo que el 📄 Reporte completo necesita del sitio entre `desde` y `hasta` (fechas
 * de JORNADA, ambas incluidas), con las lecturas de SIEMPRE —`cargarReportesGenerales`,
 * `cargarMovimientos`, `cargarUnidades` y `cargarListas`, una vez cada una y a la vez—
 * más las piezas de antes del período para el saldo de bloques (`cargarPiezasAnteriores`:
 * el período no se lee dos veces). Solo LEE. Un período que no se entiende se dice antes
 * de ir a la base; si una lectura falla, su error (en español) dice cuál.
 */
export async function cargarDatosReporteCompleto(sitioId: string, desde: string, hasta: string): Promise<DatosReporteCompleto> {
  if (!fechaValida(desde) || !fechaValida(hasta) || desde > hasta) {
    throw new Error('No se pudo armar el Reporte completo: el período no es válido (revisa las fechas desde y hasta).');
  }
  const [reportes, movimientos, anteriores, unidades, listas] = await Promise.all([
    cargarReportesGenerales(sitioId, desde, hasta),
    cargarMovimientos(sitioId, desde, hasta),
    cargarPiezasAnteriores(sitioId, desde),
    cargarUnidades(sitioId),
    cargarListas(sitioId),
  ]);
  return { reportes, movimientos, anteriores, unidades, listas };
}

/** Ids por consulta al vincular: la lista viaja en la dirección (URL) y no puede ser eterna. */
const LOTE_VINCULAR = 100;

/**
 * Vincula uno o varios renglones a una unidad de la flota. Solo cambia
 * `unidad_id`: el texto congelado (`unidad_texto`) sigue mandando en los papeles.
 * Devuelve cuántos renglones quedaron vinculados (pueden ser menos de los pedidos:
 * quien llama lo compara). Va en lotes de 100: si un lote falla DESPUÉS de que otro
 * entró, el aviso dice cuántos quedaron («Se vincularon X de N; …»), no un «No se
 * guardó» a secas. Volver a vincular da el mismo resultado.
 */
export async function vincularUnidad(ids: string[], unidadId: string): Promise<number> {
  const unicos: string[] = [];
  for (const x of ids ?? []) {
    const id = opcional(x);
    if (id && !unicos.includes(id)) unicos.push(id);
  }
  if (unicos.length === 0) return 0;
  const unidad = opcional(unidadId);
  if (!unidad) throw new Error('No se guardó el vínculo: elige la unidad.');
  let vinculados = 0;
  for (let i = 0; i < unicos.length; i += LOTE_VINCULAR) {
    const lote = unicos.slice(i, i + LOTE_VINCULAR);
    const { data, error } = await supabase.from('cop_movimientos').update({ unidad_id: unidad }).in('id', lote).select('id');
    if (error) {
      const motivo = errorEnEspanol(error, 'No se guardó el vínculo');
      if (vinculados === 0) throw motivo;
      const porQue = motivo.message.replace(/^No se guardó( el vínculo)?:\s*/, '');
      throw new Error(`Se vincularon ${vinculados} de ${unicos.length} renglones; el resto no se guardó: ${porQue}`);
    }
    vinculados += Array.isArray(data) ? data.length : 0;
  }
  if (vinculados === 0) throw new Error(NO_SE_GUARDO);
  return vinculados;
}

// ═══════════════════════════ Lo que se RECIBE del sistema ═══════════════════════════

export type MaquinaSugerida = {
  id: string;
  codigo: string;
  placa: string | null;
  serial: string | null;
  marca: string | null;
  modelo: string | null;
  empresa: string | null;
  descripcion: string | null;
};

export type SugerenciasSistema = {
  maquinas: MaquinaSugerida[];
  frentes: string[];
  obras: { id: string; nombre: string }[];
};

/** Texto limpio: sin espacios a los lados y con los dobles colapsados. */
const limpio = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * Lo que el sistema ofrece para SUGERIR (solo lectura): el catálogo de máquinas
 * activas con su empresa, los frentes activos de Viajes y las obras activas.
 * Cada lectura tiene su red: si una falla (permisos, conexión), esa parte sale
 * vacía y el resto sigue. Nada de esto se escribe afuera: al elegirlo, se copia
 * como texto en las tablas del módulo.
 *
 * Con `{ maquinas: false }` no se baja el catálogo de máquinas ni las empresas (sale
 * `maquinas: []`): ✍️ Cargar solo usa los frentes y las obras, y entra muchas veces.
 */
export async function sugerenciasDelSistema(op: { maquinas?: boolean } = {}): Promise<SugerenciasSistema> {
  const conMaquinas = op?.maquinas !== false;
  const [maquinasCrudas, empresas, frentesCrudos, obrasCrudas] = await Promise.all([
    conMaquinas
      ? selectAllRows('machinery', 'id, code, plate, serial, marca, modelo, description, company_id', (q: any) => q.eq('active', true))
        .catch(() => [] as any[])
      : Promise.resolve([] as any[]),
    conMaquinas ? selectAllRows('companies', 'id, name').catch(() => [] as any[]) : Promise.resolve([] as any[]),
    selectAllRows('viaje_frentes', 'id, nombre, activo').catch(() => [] as any[]),
    selectAllRows('ubicaciones_obra', 'id, nombre, active').catch(() => [] as any[]),
  ]);

  const nombreEmpresa = new Map<string, string>();
  for (const c of empresas) if (c?.id != null && limpio(c.name)) nombreEmpresa.set(String(c.id), limpio(c.name));

  const maquinas: MaquinaSugerida[] = maquinasCrudas
    .map((m: any) => ({
      id: String(m.id),
      codigo: limpio(m.code),
      placa: limpio(m.plate) || null,
      serial: limpio(m.serial) || null,
      marca: limpio(m.marca) || null,
      modelo: limpio(m.modelo) || null,
      empresa: (m.company_id != null && nombreEmpresa.get(String(m.company_id))) || null,
      descripcion: limpio(m.description) || null,
    }))
    .sort((a, b) => cmpText(a.codigo, b.codigo));

  // Un mismo frente escrito distinto («Frente Sur» y « frente sur ») sale una vez,
  // con la primera forma.
  const vistos = new Set<string>();
  const frentes: string[] = [];
  for (const f of frentesCrudos) {
    const nombre = limpio(f?.nombre);
    if (!nombre || f?.activo === false || vistos.has(norm(nombre))) continue;
    vistos.add(norm(nombre));
    frentes.push(nombre);
  }
  frentes.sort(cmpText);

  const obras = obrasCrudas
    .filter((o: any) => o?.active !== false && limpio(o?.nombre))
    .map((o: any) => ({ id: String(o.id), nombre: limpio(o.nombre) }))
    .sort((a, b) => cmpText(a.nombre, b.nombre));

  return { maquinas, frentes, obras };
}

// ═══════════════════════════ 📅 Parte diario (24-oct-2026) ═══════════════════════════
//
// Quién puede qué (RLS ya en la base, verificada el 24-oct-2026):
//   · `cop_reportes_generales`: leer con el módulo ≠ none; pegar/reemplazar con
//     'escritura' o 'full'; borrar solo 'full'.
//   · Las filas de patio son renglones de `cop_movimientos` (anotar/editar con
//     'escritura' o 'full'; borrar solo 'full').
//   · ⚠️ El estado de una unidad es un update de `cop_unidades`, y esa tabla solo la
//     edita 'full': con 'escritura' vuelve con 0 filas y se avisa `NO_SE_GUARDO`.

// ——— Reporte General (uno por sitio y jornada) ———

const COLS_REPORTE_GENERAL = 'id, sitio_id, fecha, hora_corte, viajes_total, toneladas_total, empresas, frentes, avisos, '
  + 'texto_original, created_by_nombre, created_at, updated_by_nombre, updated_at';

/** Las filas de empresas o frentes (jsonb) limpias: sin nombre se descarta; las cifras,
 *  número o 0 (nunca NaN); y solo viajan nombre, viajes y toneladas. */
function filasReporte(v: unknown): FilaReporteDia[] {
  if (!Array.isArray(v)) return [];
  const filas: FilaReporteDia[] = [];
  for (const x of v) {
    if (!x || typeof x !== 'object') continue;
    const nombre = limpio((x as any).nombre);
    if (!nombre) continue;
    filas.push({ nombre, viajes: aNumero((x as any).viajes) ?? 0, toneladas: aNumero((x as any).toneladas) ?? 0 });
  }
  return filas;
}

/** Los avisos (jsonb): solo los textos. */
const avisosDe = (v: unknown): string[] => (Array.isArray(v) ? v.filter((a): a is string => typeof a === 'string') : []);

/** «19:00:00» (como lo devuelve Postgres) → «19:00», igual que el lector. */
function horaCorta(v: unknown): string | null {
  const h = opcional(v);
  const m = h ? /^(\d{2}):(\d{2})/.exec(h.trim()) : null;
  return m ? `${m[1]}:${m[2]}` : h;
}

/** Una fila de `cop_reportes_generales` → `ReporteGeneralGuardado` (con el sello, para mostrarlo). */
export function filaAReporteGeneral(r: any): ReporteGeneralGuardado {
  return {
    id: String(r?.id ?? ''),
    sitioId: String(r?.sitio_id ?? ''),
    fecha: String(r?.fecha ?? ''),
    horaCorte: horaCorta(r?.hora_corte),
    viajesTotal: aNumero(r?.viajes_total),
    toneladasTotal: aNumero(r?.toneladas_total),
    empresas: filasReporte(r?.empresas),
    frentes: filasReporte(r?.frentes),
    avisos: avisosDe(r?.avisos),
    textoOriginal: r?.texto_original == null ? '' : String(r.texto_original),
    creadoPor: opcional(r?.created_by_nombre),
    creadoAt: opcional(r?.created_at),
    editadoPor: opcional(r?.updated_by_nombre),
    editadoAt: opcional(r?.updated_at),
  };
}

/** Lo leído por `leerReporteGeneral` → fila de `cop_reportes_generales`. La `fecha` es la
 *  JORNADA (R28: un corte a las 07:00 o antes es de la jornada anterior). Sin sello. */
export function reporteGeneralAFila(sitioId: string, r: ReporteGeneral, texto: string): Record<string, unknown> {
  return {
    sitio_id: sitioId,
    fecha: opcional(r?.jornada),
    hora_corte: opcional(r?.horaCorte),
    viajes_total: aNumero(r?.viajesTotal),
    toneladas_total: aNumero(r?.toneladasTotal),
    empresas: filasReporte(r?.empresas),
    frentes: filasReporte(r?.frentes),
    avisos: avisosDe(r?.avisos),
    texto_original: texto == null ? '' : String(texto),
  };
}

/** Los Reportes Generales del sitio con JORNADA entre `desde` y `hasta` (incluidas), por fecha. */
export async function cargarReportesGenerales(sitioId: string, desde: string, hasta: string): Promise<ReporteGeneralGuardado[]> {
  let filas: any[];
  try {
    filas = await selectAllRows('cop_reportes_generales', COLS_REPORTE_GENERAL, (q: any) => q
      .eq('sitio_id', sitioId)
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha', { ascending: true }));
  } catch (e) {
    throw errorDeLectura(e, 'los reportes generales');
  }
  return filas.map(filaAReporteGeneral).sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
}

/**
 * Guarda el Reporte General leído en la jornada `r.jornada` del sitio. Hay UNO por sitio y
 * jornada: si ya hay uno ese día se REEMPLAZA (update de ese id; quien llama confirma
 * antes); si no, se crea. Devuelve su id. Como en `guardarAjuste`, si otro equipo lo
 * creó en el mismo instante (el único rechaza el insert), se reemplaza el que quedó.
 */
export async function guardarReporteGeneral(sitioId: string, r: ReporteGeneral, texto: string): Promise<string> {
  const prefijo = 'No se guardó el Reporte General';
  const sitio = opcional(sitioId)?.trim();
  if (!sitio) throw new Error(`${prefijo}: elige el sitio.`);
  const fecha = opcional(r?.jornada);
  if (!fecha) throw new Error(`${prefijo}: no se encontró la fecha de corte (revisa el texto pegado).`);
  const fila = reporteGeneralAFila(sitio, r, texto);
  // Al reemplazar, el sitio y la jornada no cambian: son los que dicen CUÁL es.
  const { sitio_id: _sitio, fecha: _fecha, ...cambios } = fila;

  const buscar = async (): Promise<string | null> => {
    const { data, error } = await supabase.from('cop_reportes_generales').select('id').eq('sitio_id', sitio).eq('fecha', fecha).limit(1);
    if (error) throw errorEnEspanol(error, prefijo);
    return data?.[0]?.id ? String(data[0].id) : null;
  };
  const reemplazar = async (id: string): Promise<string> => {
    const filas = await escribir(supabase.from('cop_reportes_generales').update(cambios).eq('id', id).select('id'), prefijo);
    return String(filas[0].id);
  };

  const existente = await buscar();
  if (existente) return reemplazar(existente);

  const { data, error } = await supabase.from('cop_reportes_generales').insert(fila).select('id');
  if (error && esDuplicado(error)) {
    const otro = await buscar();
    if (otro) return reemplazar(otro);
  }
  if (error) throw errorEnEspanol(error, prefijo);
  if (!Array.isArray(data) || data.length === 0) throw new Error(NO_SE_GUARDO);
  return String(data[0].id);
}

/** Borra un Reporte General (la RLS pide 'full'; sin él vuelve con 0 filas → `NO_SE_BORRO`). */
export async function borrarReporteGeneral(id: string): Promise<void> {
  const cual = opcional(id)?.trim();
  if (!cual) throw new Error('No se borró el Reporte General: no se sabe cuál.');
  try {
    await escribir(supabase.from('cop_reportes_generales').delete().eq('id', cual).select('id'), 'No se borró el Reporte General');
  } catch (e: any) {
    if (e?.message === NO_SE_GUARDO) throw new Error(NO_SE_BORRO);
    throw e;
  }
}

// ——— Maquinaria: la marca del sitio y lo que dice inspección (mesa de maquinaria, 26-oct-2026) ———
//
// UNA PUERTA POR INTENCIÓN (la marca vive SOLO en `cop_unidades`; nada sale del módulo):
//   · `guardarMarcaUnidad`  → una marca NUEVA (✅/🔧): manda `estado` y su nota; la base la
//                             sella con la hora de ahora aunque repita el valor.
//   · `guardarNotaMarca`    → solo la nota de la marca vigente: no sella ni revive una marca
//                             que quedó atrás.
//   · `soltarMarcaUnidad`   → «↩️ Que mande inspección»: la marca a null (en una unidad del
//                             sitio la base lo rechaza: siempre tiene estado).
// ⚠️ La RLS de `cop_unidades` pide 'full' para editar: sin él vuelve con 0 filas → NO_SE_GUARDO.
// Qué puerta corresponde al tocar una pastilla lo decide `modoAlTocar` (la librería pura).

/** El texto de los errores de lectura del estado de inspección (como el de la librería). */
const NO_SE_PUDO_LEER_INSPECCION = 'No se pudo leer el estado de inspección';

/** Un error al leer inspección, en español amable y SIN perder el original (va en `cause`). */
function errorDeInspeccion(e: any): Error {
  let msg = String(e?.message ?? e ?? '').trim();
  // La librería ya lo dice con este mismo comienzo: se le quita para no repetirlo.
  if (msg.startsWith(NO_SE_PUDO_LEER_INSPECCION)) msg = msg.slice(NO_SE_PUDO_LEER_INSPECCION.length).replace(/^[\s:.]+/, '').trim();
  const detalle = !msg ? '.' : esSinConexion(msg) ? ': se perdió la conexión.' : `: ${msg}`;
  return Object.assign(new Error(`${NO_SE_PUDO_LEER_INSPECCION}${detalle}`), { cause: e });
}

/** La unidad a la que se le escribe la marca (o el error, sin ir a la base). */
function unidadParaMarca(id: string, prefijo: string): string {
  const cual = opcional(id)?.trim();
  if (!cual) throw new Error(`${prefijo}: no se sabe cuál unidad.`);
  return cual;
}

/** La nota de una marca: sin espacios a los lados; en blanco = null. */
const notaDeMarca = (nota: string | null | undefined): string | null => String(nota ?? '').trim() || null;

/** El código del aviso de `guardarMarcaUnidad` cuando inspección registró algo después de que
 *  se leyó la pantalla (D2). La pantalla lo reconoce con `esCambioDeInspeccion`. */
const CAMBIO_DE_INSPECCION = 'cambio_de_inspeccion';

/** ¿El error es el aviso de D2 (inspección registró algo nuevo antes de guardar la marca)? Trae
 *  el hecho (`novedad`); la marca NO se guardó y la nota escrita sigue en la pantalla. */
export function esCambioDeInspeccion(e: unknown): e is Error & { codigo: 'cambio_de_inspeccion'; novedad: NovedadInspeccion } {
  return !!e && typeof e === 'object' && (e as { codigo?: unknown }).codigo === CAMBIO_DE_INSPECCION;
}

// De dónde sale la hora de referencia de la guardia (B1): lo define la librería base (la pantalla
// lo calcula sin hablar con la base de datos) y acá solo cambia el texto del aviso.
export type { MotivoGuardia } from './centroOperaciones';

/** Cuánto espera la guardia a la base antes de guardar igual (R2: un cuelgue no es un fallo). */
export const TOPE_GUARDIA_MS = 8000;

/**
 * ⭐ Pone una marca NUEVA del sitio (✅ disponible / 🔧 averiada) con su nota. Manda SOLO
 * `estado` y `estado_nota`; `estado_at` lo sella la base con la hora de AHORA (también si repite
 * el valor: re-marcar después de un hecho vale desde ahora).
 *
 * ⭐ GUARDIA (D2), en las vinculadas: con `guardia` ({ machineryId, leidaAt } = hasta cuándo ella
 *    YA VIO lo de inspección: la lectura de la pantalla, su marca anterior o el último aviso;
 *    `motivo` dice cuál, B1) primero pregunta si inspección registró algún hecho de ESA máquina
 *    después de `leidaAt`. Si lo hubo NO guarda y lanza el aviso (`esCambioDeInspeccion`, con
 *    el hecho en `novedad`): «Inspección registró una jornada a las 09:00 a. m., después de que
 *    abriste la pantalla…». Si esa pregunta falla (sin señal) o no responde en `topeMs` (R2),
 *    guarda igual: la marca es del módulo y la pantalla la mostrará «sin verificar» hasta la
 *    próxima lectura.
 */
export async function guardarMarcaUnidad(
  id: string,
  marca: { estado: EstadoUnidad; nota: string | null },
  guardia?: { machineryId: string; leidaAt: string; motivo?: MotivoGuardia; topeMs?: number },
): Promise<void> {
  const prefijo = 'No se guardó el estado de la unidad';
  const cual = unidadParaMarca(id, prefijo);
  const estado = marca?.estado;
  if (!estado || !ESTADOS_UNIDAD.includes(estado)) throw new Error(`${prefijo}: elige «Disponible» o «Averiada».`);
  const maquina = opcional(guardia?.machineryId)?.trim();
  const leidaAt = opcional(guardia?.leidaAt)?.trim();
  if (maquina && leidaAt) {
    let hecho: NovedadInspeccion | null = null;
    try {
      const topeMs = typeof guardia?.topeMs === 'number' && guardia.topeMs >= 0 ? guardia.topeMs : TOPE_GUARDIA_MS;
      hecho = (await conTope(fetchNovedadesInspeccion([maquina], leidaAt), topeMs, `${NO_SE_PUDO_LEER_INSPECCION}: no respondió a tiempo.`))[maquina] ?? null;
    } catch {
      hecho = null; // sin señal o sin respuesta: se guarda igual (D2 / R2).
    }
    if (hecho) {
      const frase = fraseHechoInspeccion(hecho, Date.now());
      const Frase = `${frase.charAt(0).toUpperCase()}${frase.slice(1)}`;
      const cola = 'tu marca no se guardó. Revisa lo nuevo y vuelve a marcar (la nota no se pierde).';
      const texto = guardia?.motivo === 'visto' ? `${Frase}: otro hecho más, después del que ya viste; ${cola}`
        : guardia?.motivo === 'marca' ? `${Frase}, después de tu marca anterior: ${cola}`
          : `${Frase}, después de que abriste la pantalla: ${cola}`;
      throw Object.assign(new Error(texto), { codigo: CAMBIO_DE_INSPECCION, novedad: hecho });
    }
  }
  await escribir(supabase.from('cop_unidades').update({ estado, estado_nota: notaDeMarca(marca?.nota) }).eq('id', cual).select('id'), prefijo);
}

/** Cambia SOLO la nota de la marca vigente: manda solo `estado_nota` (no sella ni revive una
 *  marca que quedó atrás; para eso, `guardarMarcaUnidad`). */
export async function guardarNotaMarca(id: string, nota: string | null): Promise<void> {
  const prefijo = 'No se guardó la nota';
  const cual = unidadParaMarca(id, prefijo);
  await escribir(supabase.from('cop_unidades').update({ estado_nota: notaDeMarca(nota) }).eq('id', cual).select('id'), prefijo);
}

/** «↩️ Que mande inspección»: suelta la marca del sitio (estado y nota a null; la base deja la
 *  hora en null). En una unidad del sitio (sin vínculo) la base lo rechaza: siempre tiene estado. */
export async function soltarMarcaUnidad(id: string): Promise<void> {
  const prefijo = 'No se soltó la marca';
  const cual = unidadParaMarca(id, prefijo);
  try {
    await escribir(supabase.from('cop_unidades').update({ estado: null, estado_nota: null }).eq('id', cual).select('id'), prefijo);
  } catch (e: any) {
    if (/hay un dato que no cuadra/.test(String(e?.message ?? ''))) {
      throw new Error(`${prefijo}: una unidad del sitio (sin vínculo al catálogo) siempre tiene su estado; elige ✅ o 🔧.`);
    }
    throw e;
  }
}

/** Lo que dice inspección de UNA máquina vinculada (lo arma `cargarEstadoInspeccion`). */
export type InspeccionMaquina = {
  /** false = ya no está en el catálogo del sistema (inactiva, borrada o sin permiso de verla). */
  encontrada: boolean;
  /** El estado del sistema (los 6 cubos del Catálogo, `estadoConteoDe`); null si no se encontró. */
  estado: EstadoConteo | null;
  /** Su rótulo y su ícono exactos (`ESTADO_CONTEO_INFO`). */
  etiqueta: string | null;
  icono: string | null;
  /** El motivo de la avería o parada vigente (si la hay). */
  motivo: string | null;
  /** Desde cuándo rige esa avería o parada (ms). */
  desdeMs: number | null;
  /** La pista en vivo, sin horas: trabajando ahora o ya trabajó hoy (solo si está operativa). */
  enVivo: 'trabajando' | 'trabajo_hoy' | null;
  /** El hecho de inspección MÁS RECIENTE posterior a SU marca (solo si tiene marca; A2). */
  novedad: NovedadInspeccion | null;
  /** Cuándo la oficina la devolvió a servicio desde el Catálogo (`reactivated_at`, ms). Una hora
   *  futura (más allá del margen de la lib) se aplaza: null (A1). */
  reactivadaMs: number | null;
};

/** Lo leído de inspección: cuándo (`leidaAt`, ISO, para la guardia de `guardarMarcaUnidad`) y
 *  qué dice de cada máquina pedida (por `machineryId`). */
export type EstadoInspeccion = { leidaAt: string; porMaquina: Record<string, InspeccionMaquina> };

/** Máquinas por consulta: los ids viajan en la dirección (URL). */
const LOTE_INSPECCION = 100;
/** Máquinas por consulta de HECHOS: cada una lleva su ventana en el filtro (más largo), así que
 *  el lote es más chico para que la dirección no pase de unos 8 KB (A2). */
const LOTE_NOVEDADES = 50;

/**
 * ⭐ LO QUE DICE INSPECCIÓN de las unidades VINCULADAS del sitio (solo lectura; mesa de
 * maquinaria §6.2). Sin vinculadas NO consulta nada. Lee SIEMPRE filtrado por esas máquinas
 * (en lotes de 100), nunca la flota entera: así nunca se acerca al tope de filas que, en la
 * lectura completa, corta en silencio las averías más viejas.
 *   · la ficha de cada máquina (activa, operativa, en espera, transferida, devuelta a servicio);
 *   · averías y jornadas, ESTRICTAS (si una falla, falla todo: nunca se muestra «Operativa»
 *     por una lectura a medias) y el inspector por turno;
 *   · el estado con LA regla del sistema, sin copiarla: `makeLiveStatusOf` + `estadoConteoDe`;
 *   · para las que tienen marca, el hecho más reciente posterior a SU marca (A2: una ventana
 *     por máquina, `fetchNovedadesInspeccion`), aplazando los de hora futura (A1).
 * Entrega los hechos por separado (`novedad` y `reactivadaMs`): qué manda lo decide la librería
 * pura (`estadoDelSitio`, `ultimoHecho`). TODO O NADA: si algo falla, lanza «No se pudo leer el
 * estado de inspección…» (con el error original en `cause`).
 */
export async function cargarEstadoInspeccion(
  vinculadas: { machineryId: string; estadoAt: string | null; conMarca: boolean }[],
): Promise<EstadoInspeccion> {
  const ahora = new Date();
  // La hora de la lectura se toma ANTES de leer: un hecho que llegue mientras se lee lo verá
  // la guardia (del lado prudente).
  const leidaAt = ahora.toISOString();
  const ids: string[] = [];
  // La ventana de hechos de CADA máquina con marca: desde SU marca (la más vieja si la misma
  // máquina está dos veces en el sitio, con marcas distintas).
  const desdePorId: Record<string, string> = {};
  for (const v of vinculadas ?? []) {
    const id = opcional(v?.machineryId)?.trim();
    if (!id) continue;
    if (!ids.includes(id)) ids.push(id);
    const t = v?.conMarca && v.estadoAt ? Date.parse(v.estadoAt) : NaN;
    if (Number.isFinite(t) && (!desdePorId[id] || t < Date.parse(desdePorId[id]))) desdePorId[id] = new Date(t).toISOString();
  }
  const porMaquina: Record<string, InspeccionMaquina> = {};
  if (ids.length === 0) return { leidaAt, porMaquina };

  try {
    const fichas = new Map<string, any>();
    const averiaCat: Awaited<ReturnType<typeof fetchAveriaCat>> = {};
    const jornadaCat: Awaited<ReturnType<typeof fetchJornadaCat>> = {};
    for (let i = 0; i < ids.length; i += LOTE_INSPECCION) {
      const lote = ids.slice(i, i + LOTE_INSPECCION);
      const [maquinas, averias, jornadas] = await Promise.all([
        supabase.from('machinery').select('id, active, operational, en_espera, transferida, reactivated_at').in('id', lote),
        fetchAveriaCat({ ids: lote, estricto: true }),
        fetchJornadaCat(ahora, { ids: lote, estricto: true }),
      ]);
      if (maquinas.error) throw maquinas.error;
      for (const m of (maquinas.data ?? []) as any[]) if (m?.id != null) fichas.set(String(m.id), m);
      Object.assign(averiaCat, averias);
      Object.assign(jornadaCat, jornadas);
    }
    const inspByShift = await fetchInspByShift();
    const idsConMarca = ids.filter((id) => !!desdePorId[id]);
    const novedades: Record<string, NovedadInspeccion> = {};
    for (let i = 0; i < idsConMarca.length; i += LOTE_NOVEDADES) {
      Object.assign(novedades, await fetchNovedadesInspeccion(idsConMarca.slice(i, i + LOTE_NOVEDADES), desdePorId));
    }
    // Una devolución a servicio con hora futura (reloj adelantado) se aplaza, como los hechos (A1).
    const topeFuturo = ahora.getTime() + MARGEN_HORA_FUTURA_MS;

    const retiredIds = new Set<string>([...fichas.values()].filter((m) => m.operational === false).map((m) => String(m.id)));
    const statusOf = makeLiveStatusOf({ jornadaCat, averiaCat, inspByShift, retiredIds, nowTick: ahora.getTime() });
    for (const id of ids) {
      const m = fichas.get(id);
      const devueltaRaw = m?.reactivated_at ? Date.parse(String(m.reactivated_at)) : NaN;
      const devueltaMs = devueltaRaw <= topeFuturo ? devueltaRaw : NaN;
      const novedad = novedades[id] ?? null;
      if (!m || m.active === false) {
        porMaquina[id] = {
          encontrada: false, estado: null, etiqueta: null, icono: null, motivo: null, desdeMs: null, enVivo: null,
          novedad, reactivadaMs: Number.isFinite(devueltaMs) ? devueltaMs : null,
        };
        continue;
      }
      const vivo = statusOf(id);
      const estado = estadoConteoDe(m, vivo.estado);
      const conAveria = estado === 'averiada' || estado === 'parada';
      porMaquina[id] = {
        encontrada: true,
        estado,
        etiqueta: ESTADO_CONTEO_INFO[estado].label,
        icono: ESTADO_CONTEO_INFO[estado].icon,
        motivo: conAveria ? vivo.motivo : null,
        desdeMs: conAveria ? vivo.desdeMs : null,
        enVivo: estado === 'operativa' && (vivo.estado === 'trabajando' || vivo.estado === 'trabajo_hoy') ? vivo.estado : null,
        novedad,
        reactivadaMs: Number.isFinite(devueltaMs) ? devueltaMs : null,
      };
    }
  } catch (e) {
    throw errorDeInspeccion(e);
  }
  return { leidaAt, porMaquina };
}

// ——— Entrada por patio: una fila por patio y día ———

/**
 * Guarda los viajes que entraron por cada patio en la jornada `fecha`. Una FILA DE PATIO
 * es una entrada de ese sitio y día que cumple LA regla de la librería
 * (`esRenglonDePatio`, lote 5 A1): pelada, sin unidad (ni escrita), placa, transportista,
 * origen, material, toneladas, m³, hora, capacidad ni observación; su destino es el patio
 * (`viajes` = n). Por cada patio pedido:
 *   · si ya tiene su fila ese día (mismo id de lista o, sin él, el mismo nombre sin
 *     mayúsculas ni espacios) → se REEMPLAZAN sus viajes (también en 0: nada se borra);
 *   · si no la tiene → se crea, salvo que sean 0 (no hace falta un renglón para decir nada);
 *   · si tenía DOS o más (dos equipos a la vez) → la primera queda con lo escrito y las
 *     otras se PONEN EN 0 (un update, que Escritura puede: nunca un delete en este camino).
 * ⭐ Las demás entradas del día NO se tocan nunca: las de ✍️ Carga libre hacia un patio
 *    (una pesada con su unidad y sus toneladas, una con nota…) siguen como estaban, y las de
 *    un destino que no se pidió también. Para dejar un patio en cero, se manda con 0.
 * Todo se revisa ANTES de ir a la base: un patio sin nombre, repetido o con viajes que no
 * son un entero ≥ 0 no escribe nada. Si un patio falla después de otros que sí entraron,
 * el aviso dice cuántos y cuáles se guardaron (lote 5 A5), no «no se guardaron».
 */
export async function guardarPatiosDelDia(sitioId: string, fecha: string, patios: PatioDelDia[]): Promise<void> {
  const prefijo = 'No se guardaron los patios';
  const sitio = opcional(sitioId)?.trim();
  if (!sitio) throw new Error(`${prefijo}: elige el sitio.`);
  if (!fechaValida(fecha)) throw new Error(`${prefijo}: la fecha de la jornada no es válida.`);

  const pedidos: { patio: string; listaId: string | null; viajes: number }[] = [];
  for (const p of patios ?? []) {
    const patio = limpio(p?.patio);
    if (!patio) throw new Error(`${prefijo}: hay un patio sin nombre.`);
    const viajes = p?.viajes;
    if (typeof viajes !== 'number' || !Number.isInteger(viajes) || viajes < 0) {
      throw new Error(`${prefijo}: los viajes de «${patio}» tienen que ser un número entero (0 o más).`);
    }
    const listaId = opcional(p?.patioListaId)?.trim() || null;
    // Repetido = el MISMO ítem de la lista, o el mismo nombre si a alguno le falta el id.
    // Dos ítems distintos con el mismo nombre (uno general y otro del sitio) son dos patios
    // (revisión final A#5): cada uno va a su fila, que se busca por su id de lista.
    const repetido = (x: { patio: string; listaId: string | null }): boolean =>
      listaId !== null && x.listaId !== null ? x.listaId === listaId : norm(x.patio) === norm(patio);
    if (pedidos.some(repetido)) {
      throw new Error(`${prefijo}: «${patio}» está repetido.`);
    }
    pedidos.push({ patio, listaId, viajes });
  }
  if (pedidos.length === 0) return;

  // La base acerca (entradas del día sin transportista, origen, unidad ni placa) y la regla
  // de la librería DECIDE en JS: así hay una sola (y un «unidad_texto» con espacios no se
  // escapa, como pasaría con un `.eq('unidad_texto', '')`).
  const { data, error } = await supabase.from('cop_movimientos').select(COLS_MOVIMIENTO)
    .eq('sitio_id', sitio).eq('fecha', fecha).eq('tipo', 'entrada')
    .is('transportista', null).is('origen', null).is('unidad_id', null).is('placa', null)
    .order('created_at', { ascending: true });
  if (error) throw errorEnEspanol(error, prefijo);
  const existentes = (Array.isArray(data) ? data : []).map(filaAMovimiento).filter(esRenglonDePatio).map((m) => ({
    id: String(m.id), destino: limpio(m.destino), listaId: opcional(m.destinoId),
    /** Un repetido que ya quedó en 0 (y confirmado) no se vuelve a escribir. */
    enCero: m.viajes === 0 && m.estado === 'confirmado',
  }));

  // ── Lote 5 A5: un patio que falla después de otros que sí entraron se dice así ──
  /** «a», «a y b», «a, b y c». */
  const enumerar = (xs: string[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);
  /** El motivo sin el prefijo («No se guardaron los patios: », «No se guardó: »). */
  const motivoDe = (e: any): string => {
    const msg = String(e?.message ?? e ?? '').trim() || NO_SE_GUARDO;
    for (const cabeza of [`${prefijo}: `, 'No se guardó: ']) if (msg.startsWith(cabeza)) return msg.slice(cabeza.length);
    return msg;
  };
  const hechos: string[] = [];
  /** El error de un patio a medio camino: si ninguno entró antes, el de la base tal cual. */
  const aMedias = (e: any, i: number, aMedio: string | null): Error => {
    const faltan = pedidos.slice(aMedio ? i + 1 : i).map((x) => `«${x.patio}»`);
    if (!hechos.length && !aMedio) return e instanceof Error ? e : new Error(motivoDe(e));
    const partes: string[] = [];
    if (hechos.length) {
      partes.push(`Se ${hechos.length === 1 ? 'guardó' : 'guardaron'} ${hechos.length} de ${pedidos.length} patios (${enumerar(hechos.map((h) => `«${h}»`))})`);
    }
    if (aMedio) partes.push(`«${aMedio}» se guardó, pero le quedó un renglón repetido ese día que no se pudo poner en 0`);
    if (faltan.length) partes.push(`${enumerar(faltan)} no`);
    return new Error(`${partes.join('; ')}: ${motivoDe(e)}`);
  };

  const usadas = new Set<string>();
  for (let i = 0; i < pedidos.length; i++) {
    const p = pedidos[i];
    const libres = existentes.filter((r) => !usadas.has(r.id));
    const porId = p.listaId ? libres.filter((r) => r.listaId === p.listaId) : [];
    // Por nombre, solo si no es OTRO ítem de la lista con el mismo nombre.
    const porNombre = libres.filter((r) => !porId.includes(r) && norm(r.destino) === norm(p.patio)
      && !(r.listaId && p.listaId && r.listaId !== p.listaId));
    const suyas = [...porId, ...porNombre];
    for (const r of suyas) usadas.add(r.id);
    try {
      if (suyas.length > 0) {
        await escribir(supabase.from('cop_movimientos')
          .update({ destino: p.patio, destino_lista_id: p.listaId, viajes: p.viajes, estado: 'confirmado' })
          .eq('id', suyas[0].id).select('id'), prefijo);
      } else if (p.viajes > 0) {
        await escribir(supabase.from('cop_movimientos').insert({
          sitio_id: sitio, fecha, tipo: 'entrada', unidad_texto: '',
          destino: p.patio, destino_lista_id: p.listaId, viajes: p.viajes, estado: 'confirmado',
        }).select('id'), prefijo);
      }
    } catch (e) {
      throw aMedias(e, i, null);
    }
    // ⭐ Los repetidos del patio, a 0 (no se borran): el total queda igual a lo escrito.
    const ids = suyas.slice(1).filter((r) => !r.enCero).map((r) => r.id);
    if (ids.length > 0) {
      try {
        const puestas = await escribir(supabase.from('cop_movimientos')
          .update({ viajes: 0, estado: 'confirmado' })
          .in('id', ids).select('id'), prefijo);
        if (puestas.length < ids.length) throw new Error('puede que otro equipo lo haya cambiado: vuelve a guardar.');
      } catch (e) {
        throw aMedias(e, i, p.patio);
      }
    }
    hechos.push(p.patio);
  }
}
