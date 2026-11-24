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
  /** Cuándo se asignó (19-oct-2026): decide cuál es EL MÁS RECIENTE si quedaron varios. */
  creadoAt?: string | null;
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
    // ⭐ CON VARIOS FRENTES EN LA MISMA JORNADA (17-nov-2026):
    //    Si las asignaciones traen su marca de hora `creadoAt`, podemos saber
    //    con exactitud en qué frente estaba trabajando el camión a la hora del
    //    viaje (el último frente asignado hasta esa hora; si el viaje fue antes
    //    del primero, el primero del día). Así, pasar por varios frentes en un
    //    mismo día NO deja los viajes en «Sin frente». Solo queda ambiguo si
    //    falta la hora en alguna asignación.
    if (asigs.length > 1) {
      const tViaje = Date.parse(campos.fechaISO(r));
      const todasConHora = Number.isFinite(tViaje) && asigs.every((a) => !!a.creadoAt && Number.isFinite(Date.parse(a.creadoAt)));
      if (!todasConHora) { ambiguos++; return r; }
      const ordenadas = [...asigs].sort((a, b) => Date.parse(a.creadoAt!) - Date.parse(b.creadoAt!));
      let elegida = ordenadas[0];
      for (const a of ordenadas) {
        if (Date.parse(a.creadoAt!) <= tViaje) elegida = a;
      }
      completados++;
      return campos.poner(r, elegida);
    }
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

/**
 * Resuelve las asignaciones para un conjunto de jornadas con soporte de ARRASTRE
 * CONTINUO (frente pegajoso) e INTRA-JORNADA (múltiples frentes en un mismo día).
 *
 * Para cada jornada pedida y cada camión/máquina:
 * 1. Si en esa jornada exacta hay asignaciones registradas, se toman todas (con sus timestamps `creadoAt`).
 * 2. Si no hay asignación en esa jornada, se busca la última asignación histórica (< jornada).
 *    Si tiene un frente válido (no es la marca de "sin frente"), se arrastra a esa jornada.
 *    Si la última marca previa fue "sin frente", se respeta y no se le asigna frente.
 */
export function resolverAsignacionesArrastrables(
  asignacionesHistoricas: AsignacionDia[],
  jornadas: string[],
): AsignacionDia[] {
  if (!asignacionesHistoricas || asignacionesHistoricas.length === 0 || !jornadas || jornadas.length === 0) {
    return asignacionesHistoricas ?? [];
  }
  const jornadasUnicas = [...new Set(jornadas.map((j) => String(j ?? '').slice(0, 10)).filter(Boolean))];
  const salida: AsignacionDia[] = [];

  // Agrupar asignaciones históricas por camión/máquina
  const porCamion = new Map<string, AsignacionDia[]>();
  for (const a of asignacionesHistoricas) {
    if (!a || !a.machineryId) continue;
    const l = porCamion.get(a.machineryId) ?? [];
    l.push(a);
    porCamion.set(a.machineryId, l);
  }

  const orden = (a: AsignacionDia) => `${String(a.jornada ?? '').slice(0, 10)}|${String(a.creadoAt ?? '')}`;

  for (const j of jornadasUnicas) {
    for (const [mid, hist] of porCamion.entries()) {
      // 1. Asignaciones exactas de esta jornada
      const deHoy = hist.filter((a) => String(a.jornada ?? '').slice(0, 10) === j);
      if (deHoy.length > 0) {
        for (const a of deHoy) {
          if (a.frenteId) salida.push(a);
        }
        continue;
      }

      // 2. Si no hay en esta jornada, buscar la última previa (< j)
      const previas = hist.filter((a) => {
        const aj = String(a.jornada ?? '').slice(0, 10);
        return aj && aj < j;
      });
      if (previas.length === 0) continue;

      let ultimaPrevia = previas[0];
      for (const a of previas) {
        if (orden(a) >= orden(ultimaPrevia)) ultimaPrevia = a;
      }

      // Si la última asignación tiene frente válido (no es marca 'sin frente'), se arrastra
      if (ultimaPrevia && ultimaPrevia.frenteId) {
        salida.push({
          jornada: j,
          machineryId: mid,
          frenteId: ultimaPrevia.frenteId,
          frenteNombre: ultimaPrevia.frenteNombre,
          creadoAt: ultimaPrevia.creadoAt ?? null,
        });
      }
    }
  }

  return salida;
}

/**
 * Combina asignaciones de viajes (`FRENTES_VIAJES`) con asignaciones vigentes de
 * maquinaria (`FRENTES_MAQUINARIA`) para las jornadas pedidas, con ARRASTRE CONTINUO
 * (frente pegajoso) tanto en camiones como en maquinaria.
 * Si un equipo ya tiene asignación en viajes para esa jornada, manda viajes;
 * si no tiene en viajes, toma el frente vigente de maquinaria en esa jornada.
 */
export function combinarAsignacionesConRespaldoMaquinaria(
  asigsViajes: AsignacionDia[],
  asigsMaq: AsignacionDia[],
  jornadas: string[],
): AsignacionDia[] {
  const viajesResueltos = resolverAsignacionesArrastrables(asigsViajes ?? [], jornadas);
  const salida: AsignacionDia[] = [...viajesResueltos];
  if (!asigsMaq || asigsMaq.length === 0 || !jornadas || jornadas.length === 0) return salida;

  const tieneEnViajes = new Set(
    salida.filter((a) => a && a.jornada && a.machineryId && a.frenteId)
      .map((a) => claveAsignacion(a.jornada, a.machineryId)),
  );
  const maqResueltas = resolverAsignacionesArrastrables(asigsMaq, jornadas);
  for (const a of maqResueltas) {
    if (!a.frenteId) continue;
    if (tieneEnViajes.has(claveAsignacion(a.jornada, a.machineryId))) continue;
    salida.push(a);
  }
  return salida;
}

export type FrenteCatalogoMin = {
  id: string;
  nombre: string;
  activo?: boolean;
};

export type FrenteResuelto = {
  frenteId: string | null;
  frenteNombre: string | null;
};

const normFrente = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

function resolverFrenteEnCatalogo(
  a: Pick<AsignacionDia, 'frenteId' | 'frenteNombre'>,
  frentesCatalogo: FrenteCatalogoMin[],
): FrenteResuelto {
  const porId = a.frenteId ? frentesCatalogo.find((x) => x.id === a.frenteId) : undefined;
  if (porId) return { frenteId: porId.id, frenteNombre: porId.nombre };
  const nombreBuscado = normFrente(a.frenteNombre);
  if (nombreBuscado) {
    const porNombre = frentesCatalogo.find((x) => normFrente(x.nombre) === nombreBuscado);
    if (porNombre) return { frenteId: porNombre.id, frenteNombre: porNombre.nombre };
  }
  return { frenteId: null, frenteNombre: null };
}

export type AsignacionCamionMin = Pick<AsignacionDia, 'machineryId' | 'frenteId' | 'frenteNombre' | 'creadoAt'>;

/**
 * Resuelve el frente planificado por la oficina para un camión hoy, sin adivinar
 * cuando hay múltiples asignaciones sin marca horaria `creadoAt`.
 */
export function resolverFrenteOficina(
  asignacionesCamion: AsignacionCamionMin[],
  frentesCatalogo: FrenteCatalogoMin[],
): FrenteResuelto {
  const l = asignacionesCamion ?? [];
  if (l.length === 0) return { frenteId: null, frenteNombre: null };
  if (l.length === 1) return resolverFrenteEnCatalogo(l[0], frentesCatalogo);
  const conHora = l.filter((a) => !!a.creadoAt && Number.isFinite(Date.parse(a.creadoAt)));
  if (conHora.length === l.length) {
    const masReciente = [...conHora].sort((a, b) => Date.parse(b.creadoAt!) - Date.parse(a.creadoAt!))[0];
    return resolverFrenteEnCatalogo(masReciente, frentesCatalogo);
  }
  return { frenteId: null, frenteNombre: null };
}

/**
 * Determina el frente que se debe congelar al registrar un viaje en la pantalla
 * del listero:
 * 1. Si el listero eligió explícitamente un frente para este viaje, MANDA SIEMPRE
 *    (incluso si el catálogo aún no terminó de cargar o si la oficina tiene otro).
 * 2. Si el listero dejó la opción automática ("Según oficina"), usa la asignación
 *    del día para el camión (`resolverFrenteOficina`).
 */
export function resolverFrenteParaViaje(params: {
  frenteElegidoId?: string | null;
  frenteElegidoNombre?: string | null;
  machineryId: string | null;
  asignacionesCamion: AsignacionCamionMin[];
  frentesCatalogo: FrenteCatalogoMin[];
}): FrenteResuelto {
  const idElegido = String(params.frenteElegidoId ?? '').trim();
  if (idElegido) {
    const enCat = params.frentesCatalogo.find((x) => x.id === idElegido);
    if (enCat) return { frenteId: enCat.id, frenteNombre: enCat.nombre };
    const nombreFallback = String(params.frenteElegidoNombre ?? '').trim();
    if (nombreFallback) {
      const porNombre = params.frentesCatalogo.find((x) => normFrente(x.nombre) === normFrente(nombreFallback));
      if (porNombre) return { frenteId: porNombre.id, frenteNombre: porNombre.nombre };
      return { frenteId: idElegido, frenteNombre: nombreFallback };
    }
    return { frenteId: idElegido, frenteNombre: null };
  }
  if (!params.machineryId) return { frenteId: null, frenteNombre: null };
  return resolverFrenteOficina(params.asignacionesCamion, params.frentesCatalogo);
}

/**
 * Calcula qué frente debe mostrar el formulario del listero y su origen.
 * Si el listero ya eligió manualmente un frente para este camión, un refresco
 * Realtime de las asignaciones de oficina NUNCA pisa su selección.
 */
export function preseleccionarFrenteListero(params: {
  seleccionManual?: { frenteId: string; frenteNombre: string } | null;
  machineryId: string | null;
  asignacionesCamion: AsignacionCamionMin[];
  frentesCatalogo: FrenteCatalogoMin[];
}): {
  frenteId: string | null;
  frenteNombre: string | null;
  origen: 'listero' | 'oficina' | 'ninguno';
  oficinaFrenteId: string | null;
  oficinaFrenteNombre: string | null;
  ambiguoOficina: boolean;
} {
  const oficina = params.machineryId
    ? resolverFrenteOficina(params.asignacionesCamion, params.frentesCatalogo)
    : { frenteId: null, frenteNombre: null };
  const ambiguoOficina = !!params.machineryId && !oficina.frenteId && (params.asignacionesCamion?.length ?? 0) > 1;

  if (params.seleccionManual?.frenteId) {
    const resuelto = resolverFrenteParaViaje({
      frenteElegidoId: params.seleccionManual.frenteId,
      frenteElegidoNombre: params.seleccionManual.frenteNombre,
      machineryId: params.machineryId,
      asignacionesCamion: params.asignacionesCamion,
      frentesCatalogo: params.frentesCatalogo,
    });
    return {
      frenteId: resuelto.frenteId,
      frenteNombre: resuelto.frenteNombre,
      origen: 'listero',
      oficinaFrenteId: oficina.frenteId,
      oficinaFrenteNombre: oficina.frenteNombre,
      ambiguoOficina,
    };
  }

  return {
    frenteId: oficina.frenteId,
    frenteNombre: oficina.frenteNombre,
    origen: oficina.frenteId ? 'oficina' : 'ninguno',
    oficinaFrenteId: oficina.frenteId,
    oficinaFrenteNombre: oficina.frenteNombre,
    ambiguoOficina,
  };
}

export type AsignacionConOrigen = AsignacionDia & {
  /** `true` si el camión registró al menos un viaje en ese frente esa jornada. */
  desdeViajes?: boolean;
  /** `true` si la fila proviene únicamente de viajes registrados (no de `viaje_frente_asignaciones`). */
  soloViajes?: boolean;
};

/**
 * Une las asignaciones planificadas por la oficina (`viaje_frente_asignaciones`)
 * con los frentes reales en los que cada camión registró viajes (`camion_viajes`),
 * deduplicando por `(jornada, machineryId, frenteId)`.
 *
 * Así el Tablero de Frentes, la Hoja PDF y el Historial de 45 días reflejan
 * automáticamente todos los frentes donde trabajó cada camión (incluso si cambió
 * de frente a mitad del día o si la oficina no planificó ese día), sin borrar ni
 * pisar ninguna asignación previa.
 */
export function unirAsignacionesConViajes(
  asignacionesOficina: AsignacionDia[],
  asignacionesDeViajes: AsignacionDia[],
): AsignacionConOrigen[] {
  const porClave = new Map<string, AsignacionConOrigen>();
  const clave = (a: AsignacionDia) =>
    `${String(a.jornada ?? '').slice(0, 10)}|${String(a.machineryId ?? '')}|${String(a.frenteId ?? '')}`;

  for (const a of asignacionesOficina ?? []) {
    if (!a || !a.jornada || !a.machineryId || !a.frenteId) continue;
    const k = clave(a);
    if (!porClave.has(k)) {
      porClave.set(k, { ...a, jornada: String(a.jornada).slice(0, 10), desdeViajes: false, soloViajes: false });
    }
  }

  for (const v of asignacionesDeViajes ?? []) {
    if (!v || !v.jornada || !v.machineryId || !v.frenteId) continue;
    const k = clave(v);
    const existente = porClave.get(k);
    if (existente) {
      existente.desdeViajes = true;
    } else {
      porClave.set(k, { ...v, jornada: String(v.jornada).slice(0, 10), desdeViajes: true, soloViajes: true });
    }
  }

  return Array.from(porClave.values());
}

/**
 * Combina la asignación vigente de maquinaria (`FRENTES_MAQUINARIA`) con los viajes
 * reales de los camiones en `camion_viajes` para la jornada:
 *  - Maquinaria pesada (`!esCamion(id)`): conserva su frente único de oficina.
 *  - Camiones (`esCamion(id)`): si tuvieron viajes reales ese día en uno o VARIOS
 *    frentes, mandan todos esos frentes reales (pudiendo repetirse el camión en
 *    varios frentes); si no viajaron ese día, conservan su asignación de oficina.
 *  - Mapea el nombre del frente al `id` del catálogo local (`frentesCatalogo`) cuando
 *    coincide, para que las listas de pantalla y los filtros funcionen sin duplicar UUIDs.
 */
export function combinarMaquinariaConViajesCamiones(
  asigsOficinaVigentes: AsignacionDia[],
  asigsViajes: AsignacionDia[],
  frentesCatalogo: readonly { id: string; nombre: string }[],
  esCamion: (machineryId: string) => boolean,
): AsignacionConOrigen[] {
  const normNom = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const idPorNombre = new Map<string, { id: string; nombre: string }>();
  for (const f of frentesCatalogo ?? []) {
    const k = normNom(f?.nombre);
    if (k && f?.id && !idPorNombre.has(k)) idPorNombre.set(k, { id: f.id, nombre: f.nombre });
  }

  const camionesConViajes = new Set<string>();
  const viajesResueltos: AsignacionDia[] = [];
  for (const v of asigsViajes ?? []) {
    if (!v || !v.machineryId) continue;
    const match = idPorNombre.get(normNom(v.frenteNombre));
    const fid = match?.id || v.frenteId;
    const fnom = match?.nombre || v.frenteNombre;
    if (!fid) continue;
    camionesConViajes.add(v.machineryId);
    viajesResueltos.push({ ...v, frenteId: fid, frenteNombre: fnom });
  }

  // Para camiones que SÍ registraron viajes ese día, mandan sus frentes reales de viaje
  // (no la asignación pegajosa anterior). Los demás equipos conservan su asignación de oficina.
  const ofiFiltrada = (asigsOficinaVigentes ?? []).filter(
    (a) => !(esCamion(a.machineryId) && camionesConViajes.has(a.machineryId)),
  );
  return unirAsignacionesConViajes(ofiFiltrada, viajesResueltos);
}
