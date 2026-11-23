// RESPONSABLES DE CAMIONES — lógica PURA del módulo Viajes de camiones.
//
// Pedido del cliente (23-nov-2026): poder crear responsables PROPIOS del módulo
// y asignarles uno o N camiones, además del "encargado" que ya existe en el
// catálogo de maquinaria. Este archivo NO importa React ni Supabase: es la
// parte que se prueba en scripts/test-*.mjs y la que comparten la pantalla de
// configuración, la lista de camiones y TODOS los reportes del módulo.
//
// DOS CONCEPTOS QUE NO SE MEZCLAN:
//  · Asignación VIGENTE (tabla camion_responsable_asignaciones, con desde/hasta):
//    responde "¿a quién le trabaja este camión HOY?". La usan las vistas por
//    camión (lista, metas, taras) y se consulta en una fecha cualquiera para
//    congelar el nombre al registrar un viaje.
//  · Responsable CONGELADO (columnas responsable_id/responsable_nombre en
//    camion_viajes): responde "¿a quién le trabajaba este camión CUANDO se
//    registró este viaje?". La usan todos los reportes por viaje. Cambiar la
//    asignación NUNCA reescribe un viaje ya registrado.
//
// Un camión tiene UN responsable vigente a la vez. Reasignar cierra la fila
// anterior (hasta) y abre otra: nada se borra, el historial queda intacto.

/** Clave estable de la cubeta de viajes sin responsable (viejos, fuera de catálogo). */
export const SIN_RESPONSABLE = '__sin_responsable__';
export const ETIQUETA_SIN_RESPONSABLE = 'Sin responsable';
/** Nombre del SQL aditivo que hay que correr en Supabase (NUNCA va al git). */
export const SQL_RESPONSABLES = 'sql-camion-responsables-2026-11-23.sql';

export type ResponsableCamion = {
  id: string;
  name: string;
  phone?: string | null;
  cedula?: string | null;
  note?: string | null;
  active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  created_by?: string | null;
};

/** Una fila de vigencia. `hasta === null` = sigue vigente. */
export type AsignacionResponsable = {
  id: string;
  responsable_id: string;
  machinery_id: string;
  desde: string;
  hasta: string | null;
  assigned_by?: string | null;
  created_at?: string | null;
};

/**
 * Fila mínima que cualquier reporte sabe traer de `camion_viajes`.
 *
 * Se aceptan las dos formas del nombre de campo a propósito: la lectura de
 * Supabase da `snake_case`, pero las filas ya mapeadas de la pantalla (y de los
 * reportes que reutilizan `ViajeMin`) dan `camelCase`. Si solo se leyera una, el
 * mismo viaje caería en «Sin responsable» en un reporte y no en otro.
 */
export type ViajeConResponsable = {
  responsable_id?: string | null;
  responsable_nombre?: string | null;
  responsableId?: string | null;
  responsableNombre?: string | null;
  [otra: string]: unknown;
};

const texto = (v: unknown): string => (typeof v === 'string' ? v : '').trim();

/** Quitar acentos y espacios dobles: mismo criterio que otras listas propias. */
export function normalizarNombreResponsable(v: unknown): string {
  return texto(v)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/\s+/g, ' ')
    .trim();
}

export function nombreValidoResponsable(v: unknown): boolean {
  return normalizarNombreResponsable(v).length >= 2;
}

/** Clave del eje "responsable" para un viaje. Nunca devuelve null. */
export function claveResponsableDeViaje(v: ViajeConResponsable | null | undefined): string {
  const id = texto(v?.responsable_id ?? v?.responsableId);
  if (id) return id;
  const nombre = texto(v?.responsable_nombre ?? v?.responsableNombre);
  // Viajes viejos y camiones fuera de catálogo: cubeta explícita, no "".
  return nombre ? `nombre:${normalizarNombreResponsable(nombre)}` : SIN_RESPONSABLE;
}

/** Nombre legible del eje, para el PDF y los encabezados. */
export function nombreResponsableDeViaje(
  v: ViajeConResponsable | null | undefined,
  catalogo: Record<string, string> = {}
): string {
  const clave = claveResponsableDeViaje(v);
  if (clave === SIN_RESPONSABLE) return ETIQUETA_SIN_RESPONSABLE;
  if (catalogo[clave]) return catalogo[clave];
  const nombre = texto(v?.responsable_nombre ?? v?.responsableNombre);
  return nombre || ETIQUETA_SIN_RESPONSABLE;
}

/** Catálogo id → nombre, con la cubeta "Sin responsable" siempre incluida. */
export function mapaNombresResponsables(lista: ResponsableCamion[] | null | undefined): Record<string, string> {
  const out: Record<string, string> = { [SIN_RESPONSABLE]: ETIQUETA_SIN_RESPONSABLE };
  (lista ?? []).forEach((r) => {
    if (r && r.id) out[r.id] = texto(r.name) || ETIQUETA_SIN_RESPONSABLE;
  });
  return out;
}

const fechaMs = (iso: string | null | undefined): number => {
  if (!iso) return Number.NaN;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Number.NaN;
};

/**
 * Asignación vigente de un camión EN UNA FECHA concreta (o ahora, si no se da).
 * Sirve tanto para el panel "Le trabaja a" como para congelar al registrar.
 * Si hay solapes por datos viejos, gana la de `desde` más reciente.
 */
export function asignacionResponsableEnFecha(
  asignaciones: AsignacionResponsable[] | null | undefined,
  machineryId: string | null | undefined,
  fechaISO?: string | null
): AsignacionResponsable | null {
  if (!machineryId) return null;
  const fecha = fechaISO ? fechaMs(fechaISO) : Date.now();
  let mejor: AsignacionResponsable | null = null;
  let mejorDesde = -Infinity;
  (asignaciones ?? []).forEach((a) => {
    if (!a || a.machinery_id !== machineryId || !a.responsable_id) return;
    const desde = fechaMs(a.desde);
    const hasta = a.hasta ? fechaMs(a.hasta) : Infinity;
    if (!Number.isFinite(desde) || Number.isNaN(hasta)) return;
    if (desde > fecha || fecha >= hasta) return;
    if (desde >= mejorDesde) {
      mejor = a;
      mejorDesde = desde;
    }
  });
  return mejor;
}

/**
 * Datos a CONGELAR en un viaje al registrar. Usa la fecha REAL del viaje, no
 * `now()`: un viaje de la cola offline sincronizado horas después debe llevar
 * a quien correspondía cuando ocurrió, no al responsable de ahora.
 */
export function responsableCongeladoParaViaje(
  asignaciones: AsignacionResponsable[] | null | undefined,
  responsables: ResponsableCamion[] | null | undefined,
  machineryId: string | null | undefined,
  registeredAtISO: string
): { id: string | null; nombre: string | null } {
  const a = asignacionResponsableEnFecha(asignaciones, machineryId, registeredAtISO);
  if (!a) return { id: null, nombre: null };
  const r = (responsables ?? []).find((x) => x && x.id === a.responsable_id);
  return { id: a.responsable_id, nombre: texto(r?.name) || null };
}

/** Mapa machineryId → responsableId vigente (para pintar la lista de camiones). */
export function responsableVigentePorCamion(
  asignaciones: AsignacionResponsable[] | null | undefined,
  fechaISO?: string | null
): Record<string, string> {
  const out: Record<string, string> = {};
  (asignaciones ?? []).forEach((a) => {
    if (!a || !a.machinery_id) return;
    const actual = asignacionResponsableEnFecha(asignaciones, a.machinery_id, fechaISO);
    if (actual) out[a.machinery_id] = actual.responsable_id;
  });
  return out;
}

/** Cuántos camiones le trabajan a cada responsable (solo vigentes). */
export function conteoCamionesPorResponsable(
  asignaciones: AsignacionResponsable[] | null | undefined,
  fechaISO?: string | null
): Record<string, number> {
  const out: Record<string, number> = {};
  Object.values(responsableVigentePorCamion(asignaciones, fechaISO)).forEach((id) => {
    out[id] = (out[id] ?? 0) + 1;
  });
  return out;
}

/**
 * Plan de reasignación PURA: cierra las vigencias anteriores de esos camiones
 * y abre una nueva para el responsable elegido. No devuelve borrados: el
 * historial nunca se toca. `conflictos` se usa para pedir confirmación en la UI.
 */
export function planAsignarCamiones(
  asignaciones: AsignacionResponsable[] | null | undefined,
  responsableId: string,
  machineryIds: string[] | null | undefined,
  fechaISO: string,
  assignedBy?: string | null
): { cerrar: string[]; abrir: Omit<AsignacionResponsable, 'id'>[]; conflictos: AsignacionResponsable[] } {
  const ids = Array.from(new Set((machineryIds ?? []).map(texto).filter(Boolean)));
  if (!responsableId || ids.length === 0) return { cerrar: [], abrir: [], conflictos: [] };
  const cerrar: string[] = [];
  const abrir: Omit<AsignacionResponsable, 'id'>[] = [];
  const conflictos: AsignacionResponsable[] = [];
  ids.forEach((machineryId) => {
    const anterior = asignacionResponsableEnFecha(asignaciones, machineryId, fechaISO);
    if (anterior) {
      cerrar.push(anterior.id);
      if (anterior.responsable_id !== responsableId) conflictos.push(anterior);
    }
    abrir.push({
      responsable_id: responsableId,
      machinery_id: machineryId,
      desde: fechaISO,
      hasta: null,
      assigned_by: assignedBy ?? null,
      created_at: fechaISO,
    });
  });
  return { cerrar, abrir, conflictos };
}

/** Plan para QUITAR un camión: solo cierra la vigencia; conserva el historial. */
export function planQuitarCamion(
  asignaciones: AsignacionResponsable[] | null | undefined,
  responsableId: string,
  machineryId: string,
  fechaISO: string
): { cerrar: string[] } {
  const actual = asignacionResponsableEnFecha(asignaciones, machineryId, fechaISO);
  if (!actual || actual.responsable_id !== responsableId) return { cerrar: [] };
  return { cerrar: [actual.id] };
}

// ── FILTRO COMPARTIDO DE REPORTES ───────────────────────────────────────────
// Misma semántica que el resto del módulo: O dentro del eje (varios
// responsables = unión), Y entre ejes (el filtro de responsable se combina con
// empresa/listero/obra...). Vacío = todos. La cubeta "Sin responsable" es una
// opción más, para incluir o excluir viajes anteriores a esta funcionalidad.

export function pasaFiltroResponsables(
  seleccion: string[] | null | undefined,
  clave: string
): boolean {
  return !seleccion || seleccion.length === 0 || seleccion.includes(clave);
}

export type OpcionResponsableFiltro = { clave: string; nombre: string; total: number; marcada: boolean };

/**
 * Opciones del filtro con contadores tipo faceta:
 *  · el UNIVERSO sale de `viajesDelRango` (no pierdes opciones al marcar otra);
 *  · el CONTADOR sale de `viajesBase`, que ya pasó los OTROS filtros pero no
 *    este (la regla documentada en `viajesFiltros.ts`).
 */
export function opcionesFiltroResponsables(
  viajesDelRango: ViajeConResponsable[] | null | undefined,
  viajesBase: ViajeConResponsable[] | null | undefined,
  nombres: Record<string, string>,
  seleccion: string[] | null | undefined
): OpcionResponsableFiltro[] {
  const universe = new Set<string>();
  (viajesDelRango ?? []).forEach((v) => universe.add(claveResponsableDeViaje(v)));
  const conteo: Record<string, number> = {};
  (viajesBase ?? []).forEach((v) => {
    const c = claveResponsableDeViaje(v);
    conteo[c] = (conteo[c] ?? 0) + 1;
  });
  const marcados = new Set(seleccion ?? []);
  return Array.from(universe)
    .map((clave) => ({
      clave,
      nombre: nombres[clave] || nombreResponsableDeViaje({ responsable_nombre: clave.startsWith('nombre:') ? clave.slice(7) : null }, nombres),
      total: conteo[clave] ?? 0,
      marcada: marcados.has(clave),
    }))
    .sort((a, b) => {
      if (a.clave === SIN_RESPONSABLE) return 1;
      if (b.clave === SIN_RESPONSABLE) return -1;
      return a.nombre.localeCompare(b.nombre, 'es');
    });
}

/** Texto para el encabezado/PDF cuando el filtro está activo. */
export function etiquetaFiltroResponsables(
  seleccion: string[] | null | undefined,
  nombres: Record<string, string>
): string {
  if (!seleccion || seleccion.length === 0) return '';
  const nombresSel = seleccion.map((c) => nombres[c] || (c === SIN_RESPONSABLE ? ETIQUETA_SIN_RESPONSABLE : c));
  return `Responsable: ${nombresSel.join(', ')}`;
}

/** Sufijo corto para el nombre del archivo exportado. */
export function sufijoArchivoResponsables(seleccion: string[] | null | undefined): string {
  if (!seleccion || seleccion.length === 0) return '';
  if (seleccion.length === 1) return seleccion[0] === SIN_RESPONSABLE ? '-sin-responsable' : `-resp-${normalizarNombreResponsable(seleccion[0]).replace(/[^a-z0-9]+/g, '-')}`;
  return `-resp-${seleccion.length}`;
}

/** Alternar un responsable en una selección sin mutar el original. */
export function alternarResponsable(seleccion: string[] | null | undefined, clave: string): string[] {
  const actual = seleccion ?? [];
  return actual.includes(clave) ? actual.filter((c) => c !== clave) : [...actual, clave];
}
