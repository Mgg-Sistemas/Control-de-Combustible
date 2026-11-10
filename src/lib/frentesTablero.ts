// ⛏️ TABLERO DE FRENTES (10-nov-2026, a pedido: «mejorar o hacer más fácil la vista de la
// asignación de frentes de trabajo»). La MISMA pantalla sirve a 🚛 Viajes (camiones: frente
// del DÍA, un camión puede estar en varios) y a 📊 Reportes (máquinas: frente PEGAJOSO, uno
// por máquina). Esta librería solo ORDENA lo que ya se leyó para pintarlo como tablero:
//   · arriba «⚠️ Sin frente» (los que no tienen ninguno ese día),
//   · una caja por frente con sus equipos (un camión con 2 frentes sale en las 2),
//   · buscador, filtro por empresa y «solo sin frente».
// Y calcula QUÉ hay que escribir al MOVER, con las mismas funciones de guardado de siempre
// (asignar / quitar / «sin frente desde»): nada cambia en cómo se guarda ni en los reportes.
// Es pura (sin React ni Supabase); la prueba es scripts/test-frentes-tablero.mjs.

export type EquipoTablero = {
  id: string; code: string; plate?: string | null; serial?: string | null; companyName?: string | null; marca?: string | null; modelo?: string | null;
  /** Estado del equipo (máquinas: el VIVO del Catálogo; camiones: Operativa/En espera/Retirada). */
  estado?: string | null;
  /** Categoría: la clasificación de la ficha (Excavadora, Volteo, Retro…). */
  clasificacion?: string | null;
};
export type AsignacionTablero = { machineryId: string; frenteId: string; frenteNombre: string; jornada?: string };
export type FrenteTablero = { id: string; nombre: string; activo: boolean };
export type FiltrosTablero = {
  query?: string; empresa?: string | null; soloSinFrente?: boolean;
  /** Filtrar por estado y por categoría (10-nov-2026, a pedido). null = todos. */
  estado?: string | null; categoria?: string | null;
  /** 🔎 Buscar FRENTE por su nombre: solo salen las cajas que coinciden. */
  frenteQuery?: string;
};

export type CajaFrente = { frenteId: string; nombre: string; activo: boolean; color: string; equipos: EquipoTablero[] };
export type Tablero = { sinFrente: EquipoTablero[]; cajas: CajaFrente[]; totalEquipos: number; conFrente: number; empresas: string[]; estados: string[]; categorias: string[] };

/** Cómo se llama lo que no trae estado o categoría (para poder filtrarlo igual). */
export const SIN_DATO = 'Sin dato';
const valorDe = (v: unknown) => String(v ?? '').trim() || SIN_DATO;

/** Colores fijos por posición: cada frente se reconoce de un vistazo (y en modo oscuro también). */
export const COLORES_FRENTES = ['#2563EB', '#16A34A', '#D97706', '#9333EA', '#DC2626', '#0891B2', '#DB2777', '#65A30D', '#7C3AED', '#EA580C', '#0D9488', '#4F46E5'];

const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const cmp = (a: string, b: string) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });

/** Lo que coincide con el buscador: código, placa, serial, empresa, marca o modelo (como el de siempre). */
export function coincide(e: EquipoTablero, query: string | undefined): boolean {
  const q = norm(query);
  if (!q) return true;
  return [e.code, e.plate, e.serial, e.companyName, e.marca, e.modelo].some((v) => norm(v).includes(q));
}

export function armarTablero(equipos: EquipoTablero[], asignaciones: AsignacionTablero[], frentes: FrenteTablero[], f: FiltrosTablero = {}): Tablero {
  const lista = equipos ?? [];
  const ids = new Set(lista.map((e) => e.id));
  // Solo lo de ESTA lista (igual que hoy: viajes no ve lo de Reportes ni al revés).
  const asigs = (asignaciones ?? []).filter((a) => a && ids.has(a.machineryId) && a.frenteId);
  const conAlgo = new Set(asigs.map((a) => a.machineryId));
  const empresa = norm(f.empresa);
  const estado = norm(f.estado);
  const categoria = norm(f.categoria);
  const pasa = (e: EquipoTablero) => coincide(e, f.query)
    && (!empresa || norm(e.companyName) === empresa)
    && (!estado || norm(valorDe(e.estado)) === estado)
    && (!categoria || norm(valorDe(e.clasificacion)) === categoria);
  const porCodigo = (a: EquipoTablero, b: EquipoTablero) => cmp(a.code ?? '', b.code ?? '');

  const sinFrente = lista.filter((e) => !conAlgo.has(e.id) && pasa(e)).sort(porCodigo);

  // Las cajas: los frentes ACTIVOS (en su orden A→Z) más los que tengan algo asignado aunque
  // estén desactivados (lo asignado nunca desaparece de la vista).
  const conAsignacion = new Set(asigs.map((a) => a.frenteId));
  const base = (frentes ?? []).filter((x) => x.activo || conAsignacion.has(x.id)).slice().sort((a, b) => cmp(a.nombre, b.nombre));
  // Un frente que llega en la asignación pero ya no está en el catálogo (borrado): igual se muestra.
  for (const a of asigs) if (!base.some((x) => x.id === a.frenteId)) base.push({ id: a.frenteId, nombre: a.frenteNombre || 'Frente', activo: false });
  const porId = new Map(lista.map((e) => [e.id, e]));
  // El color se fija por la posición en la lista COMPLETA: buscar un frente no le cambia el color.
  const fq = norm(f.frenteQuery);
  const cajas: CajaFrente[] = f.soloSinFrente ? [] : base.map((fr, i) => {
    const vistos = new Set<string>();
    const eq: EquipoTablero[] = [];
    for (const a of asigs) {
      if (a.frenteId !== fr.id || vistos.has(a.machineryId)) continue;
      vistos.add(a.machineryId);
      const e = porId.get(a.machineryId);
      if (e && pasa(e)) eq.push(e);
    }
    return { frenteId: fr.id, nombre: fr.nombre, activo: fr.activo, color: COLORES_FRENTES[i % COLORES_FRENTES.length], equipos: eq.sort(porCodigo) };
  }).filter((c) => !fq || norm(c.nombre).includes(fq));

  const empresas = [...new Set(lista.map((e) => String(e.companyName ?? '').trim()).filter(Boolean))].sort(cmp);
  // Estados y categorías que de verdad hay en la lista («Sin dato» al final, si hay).
  const valores = (k: 'estado' | 'clasificacion') => {
    const s = [...new Set(lista.map((e) => valorDe(e[k])))].filter((v) => v !== SIN_DATO).sort(cmp);
    return lista.some((e) => valorDe(e[k]) === SIN_DATO) ? [...s, SIN_DATO] : s;
  };
  return { sinFrente, cajas, totalEquipos: lista.length, conFrente: conAlgo.size, empresas, estados: valores('estado'), categorias: valores('clasificacion') };
}

/** Lo que hay que escribir para MOVER unos equipos (lo hace la pantalla con las funciones de siempre). */
export type PlanMover = {
  /** Asignar estos equipos al destino (los que no lo tienen ya). */
  asignar: string[];
  /** Quitar estas asignaciones (camiones: los OTROS frentes del día, si no es «además»). */
  quitar: { machineryId: string; frenteId: string }[];
  /** Máquinas: marcar «sin frente desde ese día» (frente pegajoso). */
  sinFrenteDesde: string[];
  /** Ya estaban exactamente así: no se toca nada. */
  sinCambio: string[];
};

/**
 * Qué pasa al mover `ids` a `destino` (null = quitarles el frente).
 *  · MÁQUINAS (pegajoso, uno por máquina): asignar = reasignar; quitar = «sin frente desde».
 *  · CAMIONES (del día): «mover» = poner el destino y QUITAR los otros frentes de ese día;
 *    con `ademas` se AGREGA el destino y se conservan los otros (un camión en varios frentes).
 */
export function planMover(ids: string[], destino: string | null, asignaciones: AsignacionTablero[], esMaq: boolean, ademas = false): PlanMover {
  const plan: PlanMover = { asignar: [], quitar: [], sinFrenteDesde: [], sinCambio: [] };
  const unicos = [...new Set((ids ?? []).filter(Boolean))];
  for (const id of unicos) {
    const actuales = [...new Set((asignaciones ?? []).filter((a) => a.machineryId === id && a.frenteId).map((a) => a.frenteId))];
    if (destino === null) {
      if (!actuales.length) { plan.sinCambio.push(id); continue; }
      if (esMaq) plan.sinFrenteDesde.push(id);
      else for (const fr of actuales) plan.quitar.push({ machineryId: id, frenteId: fr });
      continue;
    }
    const yaLoTiene = actuales.includes(destino);
    const otros = actuales.filter((fr) => fr !== destino);
    if (esMaq) {
      if (yaLoTiene && otros.length === 0) plan.sinCambio.push(id); else plan.asignar.push(id);
      continue;
    }
    if (!yaLoTiene) plan.asignar.push(id);
    if (!ademas) for (const fr of otros) plan.quitar.push({ machineryId: id, frenteId: fr });
    if (yaLoTiene && (ademas || otros.length === 0)) plan.sinCambio.push(id);
  }
  return plan;
}

/** Los frentes a los que se puede mover, filtrados por el buscador del panel (por nombre). */
export function frentesQueCoinciden<T extends { nombre: string }>(frentes: T[], q: string | undefined): T[] {
  const n = norm(q);
  return n ? frentes.filter((f) => norm(f.nombre).includes(n)) : frentes;
}

/** Cómo se lee el equipo en una ficha: «A12BC3 · ABC-123». */
export const etiquetaEquipo = (e: EquipoTablero): string => `${e.code}${e.plate ? ` · ${e.plate}` : e.serial ? ` · ${e.serial}` : ''}`;
