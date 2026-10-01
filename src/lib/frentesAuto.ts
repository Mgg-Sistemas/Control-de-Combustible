// ⛏️ EL FRENTE DEL DÍA SE TOMA SOLO (29-sep-2026).
//
// PEDIDO, textual: «los frentes asignados para un día deben tomarlo
// automáticamente los viajes de ese día, estén registrados o no estén
// registrados; si los frentes se asignan para ciertas máquinas el día xx, todas
// las máquinas que tengan asignados esos frentes lo tomarán automáticamente
// para ese día esos frentes».
//
// EL PROBLEMA QUE RESUELVE: la asignación se hace en la oficina —muchas veces
// DESPUÉS de que el listero ya registró viajes— y hasta ahora el frente solo se
// congelaba al momento de registrar. Resultado: los viajes de la mañana salían
// «sin frente» aunque el camión sí tenía frente ese día, y había que entrar a
// ✏️ Editar uno por uno.
//
// ⭐ CÓMO LO RESUELVE: NO TOCA LA BASE. El frente asignado se completa AL LEER,
//    en memoria. Así funciona igual hacia atrás (viajes ya registrados) y hacia
//    adelante, y si mañana se corrige la asignación, los reportes se corrigen
//    solos sin un UPDATE masivo que nadie podría deshacer.
//
// ⭐ VARIOS FRENTES POR CAMIÓN (30-sep-2026, a pedido: «permite que un camion
//    pueda tener varios frentes»). Un camión puede recoger en dos frentes la
//    misma jornada. Entonces el frente del viaje YA NO SE PUEDE DEDUCIR: un
//    viaje se carga en UN frente, y el sistema no sabe en cuál se cargó ESTE.
//    Se deja vacío a propósito y se cuenta aparte (`ambiguos`) para avisarlo:
//    inventar el origen del material es peor que dejarlo en blanco, porque ese
//    dato termina en el papel de pago.
//
// ⭐ LO CONGELADO MANDA: solo se completa el frente VACÍO. Un viaje que ya trae
//    su frente —porque se registró con él, o porque se lo pusieron a mano en
//    ✏️ Editar— se queda con el suyo. Si no, un camión que cambió de frente a
//    mediodía perdería los viajes de la mañana, y una corrección hecha a mano
//    se borraría sola al recargar la pantalla.
//
// TODO ESTE ARCHIVO ES PURO (ni Supabase ni React ni fechas): recibe el mapa de
// asignaciones y la función que dice a qué jornada pertenece una fecha. Por eso
// `scripts/test-frentes-auto.mjs` lo prueba solo.

/** Una asignación: este camión, esta jornada (7am→7am), este frente. */
export type AsignacionDia = {
  jornada: string;
  machineryId: string;
  frenteId: string;
  frenteNombre: string;
};

/** La clave del mapa: jornada + camión. */
export function claveAsignacion(jornada: string, machineryId: string): string {
  return `${String(jornada ?? '').slice(0, 10)}|${String(machineryId ?? '')}`;
}

/**
 * Indexa las asignaciones para preguntar por jornada + camión sin recorrerlas.
 *
 * ⭐ UN CAMIÓN PUEDE TENER VARIOS FRENTES EL MISMO DÍA (30-sep-2026, a pedido:
 *    «permite que un camion pueda tener varios frentes»). Por eso el mapa
 *    guarda una LISTA y no una sola asignación: un camión que recoge en dos
 *    frentes la misma jornada tiene dos filas, y las dos son verdad.
 *
 * Se descartan las repetidas (mismo camión, misma jornada, mismo frente): la
 * base lo impide con un único, pero dos pantallas asignando a la vez podrían
 * colarla, y duplicada contaría dos veces en la hoja del día.
 */
export function mapaAsignaciones(asignaciones: AsignacionDia[]): Map<string, AsignacionDia[]> {
  const m = new Map<string, AsignacionDia[]>();
  (asignaciones ?? []).forEach((a) => {
    if (!a || !a.jornada || !a.machineryId || !a.frenteId) return;
    const k = claveAsignacion(a.jornada, a.machineryId);
    const lista = m.get(k) ?? [];
    if (lista.some((x) => x.frenteId === a.frenteId)) return;
    lista.push(a);
    m.set(k, lista);
  });
  return m;
}

/**
 * Los frentes que tenía un camión esa jornada, en el orden en que se asignaron.
 * Vacío si no tenía ninguno.
 */
export function frentesDe(
  mapa: Map<string, AsignacionDia[]>, jornada: string, machineryId: string,
): AsignacionDia[] {
  return mapa.get(claveAsignacion(jornada, machineryId)) ?? [];
}

/**
 * Cómo se lee y se escribe el frente en un tipo de fila concreto. Los viajes
 * viajan en DOS formas en este sistema —`CamionViajeRow` (camelCase, la
 * pantalla) y la fila cruda de la base (snake_case, el reporte de pago)— y la
 * regla tiene que ser UNA para que los dos papeles digan lo mismo.
 */
export type CamposFrente<T> = {
  machineryId: (r: T) => string | null | undefined;
  fechaISO: (r: T) => string;
  /** ¿Ya trae frente propio? Si sí, no se le toca. */
  tieneFrente: (r: T) => boolean;
  /** Devuelve una COPIA de la fila con el frente asignado puesto. */
  poner: (r: T, a: AsignacionDia) => T;
};

const vacio = (v: unknown) => String(v ?? '').trim() === '';

/** Los viajes como los usa la pantalla (`CamionViajeRow`). */
export const CAMPOS_VIAJE_ROW: CamposFrente<any> = {
  machineryId: (r) => r.machineryId,
  fechaISO: (r) => r.registeredAt,
  tieneFrente: (r) => !!r.frenteId || !vacio(r.frenteNombre),
  poner: (r, a) => ({ ...r, frenteId: a.frenteId, frenteNombre: a.frenteNombre }),
};

/** La fila cruda de `camion_viajes`, como la lee el reporte de pago. */
export const CAMPOS_VIAJE_PAGO: CamposFrente<any> = {
  machineryId: (r) => r.machinery_id,
  fechaISO: (r) => r.registered_at,
  tieneFrente: (r) => !vacio(r.frente_nombre),
  poner: (r, a) => ({ ...r, frente_nombre: a.frenteNombre }),
};

/**
 * Completa el frente VACÍO de cada viaje con el que su camión tenía asignado
 * esa jornada. Devuelve filas nuevas (no muta las que entran) y cuántas se
 * completaron, para poder decírselo al usuario en la pantalla.
 *
 * @param jornadaDe a qué jornada (7am→7am) pertenece una fecha ISO.
 */
export function completarFrentes<T>(
  filas: T[],
  mapa: Map<string, AsignacionDia[]>,
  jornadaDe: (fechaISO: string) => string,
  campos: CamposFrente<T>,
): { filas: T[]; completados: number; ambiguos: number } {
  if (!filas || filas.length === 0 || mapa.size === 0) return { filas: filas ?? [], completados: 0, ambiguos: 0 };
  let completados = 0, ambiguos = 0;
  const salida = filas.map((r) => {
    if (campos.tieneFrente(r)) return r;
    const mid = campos.machineryId(r);
    if (!mid) return r;                     // camión fuera del catálogo: no hay a qué asignarle
    const asigs = frentesDe(mapa, jornadaDe(campos.fechaISO(r)), mid);
    if (asigs.length === 0) return r;
    // ⭐ CON VARIOS FRENTES NO SE ADIVINA (30-sep-2026). Un viaje se recoge en
    //    UN frente; si el camión tuvo dos esa jornada, el sistema no tiene cómo
    //    saber en cuál se cargó ESTE viaje. Ponerle uno al azar —o el primero—
    //    sería inventar de dónde salió el material, y ese dato se va al papel
    //    de pago. Se deja vacío y se devuelve contado aparte (`ambiguos`), para
    //    quien quiera avisarlo; esos viajes se ven como «sin frente» y se
    //    completan a mano en ✏️ Editar. Al asignar, la pantalla ya advierte que
    //    con varios frentes los viajes dejan de tomarlo solos.
    if (asigs.length > 1) { ambiguos++; return r; }
    completados++;
    return campos.poner(r, asigs[0]);
  });
  return { filas: salida, completados, ambiguos };
}

/**
 * El rango de jornadas que hay que pedirle a la base para un puñado de viajes.
 * `null` cuando no hay ninguno que completar — y entonces la consulta NO se
 * hace: un reporte donde todos los viajes ya traen frente no paga nada por
 * esta función.
 */
export function rangoJornadas(jornadas: string[]): { desde: string; hasta: string } | null {
  const v = (jornadas ?? []).filter((j) => /^\d{4}-\d{2}-\d{2}$/.test(String(j ?? '').slice(0, 10)))
    .map((j) => j.slice(0, 10)).sort();
  if (v.length === 0) return null;
  return { desde: v[0], hasta: v[v.length - 1] };
}
