/*
 * LOS TRES FILTROS DE LA LISTA COMPLETA DE VIAJES: listero, empresa y camión.
 *
 * Por qué esto vive acá y no dentro de la pantalla: el número que sale entre
 * paréntesis en cada chip —«ELY ECHARRY (171)»— es un número que la jefa LEE y
 * CREE. Si ese número se cuenta sobre un conjunto de viajes distinto al que
 * termina en la lista de abajo (y en el PDF), la pantalla se contradice sola y
 * nadie sabe cuál de los dos números es el bueno.
 *
 * REGLA DE CONTEO (la de cualquier buscador con facetas):
 *   El contador de un eje se cuenta sobre los viajes que YA PASAN LOS OTROS DOS
 *   filtros, pero NO el suyo propio.
 *
 * · No el suyo propio, porque si no, al marcar un listero todos los demás
 *   listeros pasarían a (0) y no habría cómo comparar ni cómo agregar un segundo.
 * · Sí los otros dos, porque un contador que ignora los filtros activos MIENTE:
 *   con ELY marcado, «FERRECONSTRUCCIONES (71)» hace creer que abajo van a salir
 *   71 viajes cuando saldrán los que hizo ELY en esa empresa, que son menos.
 *
 * Y una regla más, aburrida pero imprescindible:
 *   UNA OPCIÓN MARCADA NUNCA DESAPARECE, aunque su cuenta caiga a 0.
 * Si desapareciera, quedaría un filtro activo INVISIBLE: la lista sale vacía
 * («Sin viajes en el rango seleccionado») y quien mira no tiene ni cómo saber
 * qué lo está tapando, ni dónde desmarcarlo. Pasa solo con cambiar de día
 * teniendo un listero marcado.
 *
 * Por eso lo marcado se guarda en un Map id→etiqueta y no en un Set: la
 * etiqueta hace falta para poder DIBUJAR el chip de algo que ya no aparece en
 * ningún viaje del rango, que es justo cuando más falta hace verlo.
 */

/** Los tres ejes por los que se puede filtrar la lista. */
export type EjeFiltro = 'listero' | 'empresa' | 'camion';
export const EJES_FILTRO: readonly EjeFiltro[] = ['listero', 'empresa', 'camion'] as const;

/** Lo marcado en un eje: id → etiqueta. Vacío = «todos». */
export type MarcadosEje = ReadonlyMap<string, string>;
export type SeleccionFiltros = Record<EjeFiltro, MarcadosEje>;

/** La clave de un viaje en cada eje (id del listero, de la empresa del camión,
 *  del camión). Las calcula la pantalla, que es la que tiene el catálogo. */
export type ClavesViaje = Record<EjeFiltro, string>;

export type OpcionFiltro = { id: string; label: string; count: number };

/**
 * ¿Este viaje pasa los filtros? Con `excepto` se ignora un eje — que es
 * justamente lo que hace falta para contar las facetas de ese eje.
 */
export function pasaFiltros(claves: ClavesViaje, sel: SeleccionFiltros, excepto?: EjeFiltro): boolean {
  return EJES_FILTRO.every(
    (eje) => eje === excepto || sel[eje].size === 0 || sel[eje].has(claves[eje])
  );
}

/**
 * Opciones de un eje, ya contadas y ordenadas.
 *
 * @param rows      los viajes del rango de fechas (antes de los tres filtros)
 * @param eje       el eje cuyas opciones se arman
 * @param clavesDe  claves del viaje en los tres ejes
 * @param opcionDe  id + etiqueta que le toca a ese viaje EN ESTE EJE
 * @param sel       lo marcado en los tres ejes
 * @param cmp       comparador de etiquetas (el mismo que usa el resto de la app)
 */
export function opcionesDeEje<R>(
  rows: readonly R[],
  eje: EjeFiltro,
  clavesDe: (r: R) => ClavesViaje,
  opcionDe: (r: R) => { id: string; label: string },
  sel: SeleccionFiltros,
  cmp: (a: string, b: string) => number,
): OpcionFiltro[] {
  const m = new Map<string, OpcionFiltro>();
  // Primero, TODO lo marcado — aunque no aparezca en un solo viaje del rango.
  // Entra en 0 y solo sube contando; sin esto, un filtro puesto ayer se vuelve
  // invisible al cambiar de día y tapa la lista sin dar la cara.
  sel[eje].forEach((label, id) => m.set(id, { id, label, count: 0 }));
  // Después, lo que hay en el rango (su etiqueta manda: es la más fresca).
  rows.forEach((r) => {
    const o = opcionDe(r);
    const e = m.get(o.id);
    if (e) e.label = o.label; else m.set(o.id, { id: o.id, label: o.label, count: 0 });
  });
  // Y recién ahora se cuenta, sobre los que pasan los OTROS dos filtros.
  rows.forEach((r) => {
    if (!pasaFiltros(clavesDe(r), sel, eje)) return;
    const e = m.get(opcionDe(r).id);
    if (e) e.count += 1;
  });
  // Se muestran las que tienen viajes y, pase lo que pase, las marcadas.
  return Array.from(m.values())
    .filter((o) => o.count > 0 || sel[eje].has(o.id))
    .sort((a, b) => cmp(a.label, b.label));
}

/**
 * Etiquetas de los filtros marcados que NO le corresponden a NINGÚN viaje del
 * rango — típicamente los que quedaron puestos de otro día. Es la explicación
 * concreta de una lista vacía: sin esto solo se ve «Sin viajes en el rango».
 *
 * Ojo con lo que NO reporta: una COMBINACIÓN imposible (un listero y un camión
 * que sí existen en el rango, pero nunca juntos) no cae acá, porque ninguno de
 * los dos sobra por sí solo. Para ese caso el mensaje correcto es que la
 * combinación no dio nada, no señalar a uno de los dos.
 */
export function marcadosFueraDelRango<R>(
  rows: readonly R[],
  clavesDe: (r: R) => ClavesViaje,
  sel: SeleccionFiltros,
): string[] {
  const presentes: Record<EjeFiltro, Set<string>> = { listero: new Set(), empresa: new Set(), camion: new Set() };
  rows.forEach((r) => {
    const c = clavesDe(r);
    EJES_FILTRO.forEach((eje) => presentes[eje].add(c[eje]));
  });
  const fuera: string[] = [];
  EJES_FILTRO.forEach((eje) => {
    sel[eje].forEach((label, id) => { if (!presentes[eje].has(id)) fuera.push(label); });
  });
  return fuera;
}

/**
 * Cómo se NOMBRA el rango de fechas en pantalla y en el encabezado del PDF.
 *
 * ⚠️ En «días específicos» NO se puede decir «del 5 al 22»: los días marcados
 * no tienen por qué ser consecutivos. Marcando el 5 y el 22, ese texto hace
 * leer el reporte como 18 jornadas cuando trae 2 — y quien lo recibe concluye
 * que la flota trabajó una miseria. Se dicen los días, uno por uno.
 *
 * @param porDias  true si el modo es «días específicos»
 * @param desde    primera jornada del rango (AAAA-MM-DD)
 * @param hasta    última jornada del rango (AAAA-MM-DD)
 * @param dias     los días marcados (solo importa si `porDias`)
 * @param dmy      cómo se escribe una fecha para el usuario (DD/MM/AAAA)
 */
export function etiquetaRangoViajes(
  porDias: boolean,
  desde: string,
  hasta: string,
  dias: Iterable<string>,
  dmy: (iso: string) => string,
): string {
  if (!porDias) return desde === hasta ? dmy(desde) : `${dmy(desde)} al ${dmy(hasta)}`;
  const d = Array.from(dias).sort();
  if (d.length === 0) return 'sin días marcados';
  if (d.length === 1) return dmy(d[0]);
  // Con muchos días la lista completa no cabe en un subtítulo; se dice cuántas
  // jornadas son y entre qué extremos, pero NUNCA «del X al Y».
  if (d.length <= 8) return `${d.length} jornadas sueltas: ${d.map(dmy).join(', ')}`;
  return `${d.length} jornadas sueltas entre ${dmy(d[0])} y ${dmy(d[d.length - 1])}`;
}
