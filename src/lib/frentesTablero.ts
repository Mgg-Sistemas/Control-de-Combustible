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

export type EquipoTablero = { id: string; code: string; plate?: string | null; serial?: string | null; companyName?: string | null; marca?: string | null; modelo?: string | null };
export type AsignacionTablero = { machineryId: string; frenteId: string; frenteNombre: string; jornada?: string };
export type FrenteTablero = { id: string; nombre: string; activo: boolean };
export type FiltrosTablero = { query?: string; empresa?: string | null; soloSinFrente?: boolean };

export type CajaFrente = { frenteId: string; nombre: string; activo: boolean; color: string; equipos: EquipoTablero[] };
export type Tablero = { sinFrente: EquipoTablero[]; cajas: CajaFrente[]; totalEquipos: number; conFrente: number; empresas: string[] };

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
  const pasa = (e: EquipoTablero) => coincide(e, f.query) && (!empresa || norm(e.companyName) === empresa);
  const porCodigo = (a: EquipoTablero, b: EquipoTablero) => cmp(a.code ?? '', b.code ?? '');

  const sinFrente = lista.filter((e) => !conAlgo.has(e.id) && pasa(e)).sort(porCodigo);

  // Las cajas: los frentes ACTIVOS (en su orden A→Z) más los que tengan algo asignado aunque
  // estén desactivados (lo asignado nunca desaparece de la vista).
  const conAsignacion = new Set(asigs.map((a) => a.frenteId));
  const base = (frentes ?? []).filter((x) => x.activo || conAsignacion.has(x.id)).slice().sort((a, b) => cmp(a.nombre, b.nombre));
  // Un frente que llega en la asignación pero ya no está en el catálogo (borrado): igual se muestra.
  for (const a of asigs) if (!base.some((x) => x.id === a.frenteId)) base.push({ id: a.frenteId, nombre: a.frenteNombre || 'Frente', activo: false });
  const porId = new Map(lista.map((e) => [e.id, e]));
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
  });

  const empresas = [...new Set(lista.map((e) => String(e.companyName ?? '').trim()).filter(Boolean))].sort(cmp);
  return { sinFrente, cajas, totalEquipos: lista.length, conFrente: conAlgo.size, empresas };
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

/** Cómo se lee el equipo en una ficha: «A12BC3 · ABC-123». */
export const etiquetaEquipo = (e: EquipoTablero): string => `${e.code}${e.plate ? ` · ${e.plate}` : e.serial ? ` · ${e.serial}` : ''}`;
