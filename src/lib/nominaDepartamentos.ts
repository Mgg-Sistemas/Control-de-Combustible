import { cmpText, norm } from './text';
import { normalizeDept } from './personal';

/**
 * DEPARTAMENTO de un renglón de nómina: de dónde sale, cómo se unifica y en qué
 * orden se lista.
 *
 * ── El problema que resuelve ────────────────────────────────────────────────
 * El mismo departamento está escrito de tres formas distintas según de dónde se
 * lea, y si se mezclan sin unificar el Excel sale partido en secciones que son
 * el mismo departamento con otro nombre:
 *
 *   · El TABULADOR (`staff_cargo_tariffs.departamento`) lo guarda POR CARGO y con
 *     las palabras que usa la empresa en su nómina de siempre: ALIMENTACION,
 *     ADMINISTRACION, DIRECTIVO/GERENCIA.
 *   · La FICHA del empleado (`employees.department`) lo guarda POR PERSONA y ya
 *     está unificado por supabase/nomina_departamentos.sql a los nombres
 *     canónicos de los reportes: COCINA, ADMINISTRATIVO, DIRECCIÓN Y COORDINACIÓN.
 *   · Y hay gente sin ninguno de los dos, a quien solo se le puede DEDUCIR el
 *     departamento por su cargo.
 *
 * "ALIMENTACION" y "COCINA" son el mismo departamento. Si salen como dos
 * secciones, el Excel está mal: quien lo revisa cuenta dos veces el mismo
 * renglón de gasto y los subtotales no cuadran con nada.
 *
 * ── Cómo lo resuelve: separar el GRUPO de la ETIQUETA ───────────────────────
 *   1) GRUPO (lo que agrupa): a cada quien se le calcula su departamento
 *      CANÓNICO con `normalizeDept` —el mismo criterio del reporte de personal—,
 *      mirando primero lo que diga el tabulador para su cargo, luego su ficha, y
 *      si no hay nada, deduciéndolo del cargo. Dos escrituras distintas del
 *      mismo departamento caen en el mismo grupo.
 *
 *   2) ETIQUETA (lo que se lee): el nombre que se MUESTRA de cada grupo es el
 *      del tabulador, si alguno de los cargos de ese grupo lo trae. Manda el
 *      vocabulario de la empresa, no el del sistema: si el tabulador dice
 *      ALIMENTACION, la sección se llama ALIMENTACION aunque por dentro el grupo
 *      sea COCINA. Con varias escrituras en el mismo grupo gana la más usada, y
 *      a empate la primera alfabéticamente, para que el Excel de hoy y el de
 *      mañana salgan con el mismo título.
 *
 * Separar grupo de etiqueta es justo lo que permite que el usuario renombre un
 * departamento en el tabulador y el Excel le haga caso, sin que ese renombre
 * parta la sección en dos.
 */

/** Etiqueta de quien no tiene departamento por ningún lado. Va siempre de último. */
export const SIN_DEPARTAMENTO = 'SIN DEPARTAMENTO';

/**
 * ORDEN de las secciones del Excel, del reporte y del filtro: la jerarquía de la
 * empresa, NO el alfabeto. Sale así porque la nómina se revisa de arriba hacia
 * abajo empezando por la gerencia, que es como la lee quien la aprueba.
 *
 * Se compara contra el departamento canónico Y contra la etiqueta, ambos
 * normalizados (minúscula, sin tildes), así que atrapa las dos escrituras:
 * `direcc|gerenc|directiv` cubre tanto "DIRECCIÓN Y COORDINACIÓN" como
 * "DIRECTIVO/GERENCIA".
 *
 * ⚠️ PARA CAMBIAR EL ORDEN se edita SOLO esta lista: mover una línea mueve la
 *    sección en el Excel, en el filtro y en el reporte a la vez. Lo que no esté
 *    aquí se ordena alfabético detrás, y SIN DEPARTAMENTO cierra siempre.
 */
const ORDEN: RegExp[] = [
  /direcc|gerenc|directiv/,       // 1. DIRECTIVO / GERENCIA
  /administ|adminit/,             // 2. ADMINISTRACIÓN
  /sistema|informatic|tecnolog/,  // 3. SISTEMAS
  /cocin|aliment|comedor/,        // 4. ALIMENTACIÓN / COCINA
  /almacen|deposito|inventario/,  // 5. ALMACÉN
  /manten|mecanic|taller/,        // 6. MANTENIMIENTO
  /inspec|patio/,                 // 7. INSPECCIÓN Y PATIO
  /maquin|operac/,                // 8. OPERACIONES DE MAQUINARIA
  /servicio|general|seguridad/,   // 9. SERVICIOS GENERALES
];

/** Lo único que hace falta del tabulador: qué departamento tiene cada cargo. */
export type TarifaCargo = { cargo?: string | null; departamento?: string | null };

/** Departamentos ya unificados, listos para agrupar y para ordenar. */
export type MapaDepartamentos = {
  /** Departamento que se MUESTRA para un cargo (y su ficha, si la hay). */
  de: (cargo?: string | null, deptFicha?: string | null) => string;
  /** Los departamentos que reciba, puestos en el orden de `ORDEN`. */
  orden: (deps: Iterable<string>) => string[];
};

/** Texto listo para comparar: minúscula, sin tildes, sin espacios sobrantes. */
const limpio = (v?: string | null) => norm(v ?? '').trim();

/** El departamento tal como se escribe: sin espacios sobrantes y en MAYÚSCULA. */
const comoSeEscribe = (v?: string | null) => String(v ?? '').trim().toUpperCase();

/** Puesto de un departamento en `ORDEN`; lo que no está va detrás. */
function puesto(canon: string, etiqueta: string): number {
  const a = limpio(canon), b = limpio(etiqueta);
  const i = ORDEN.findIndex((re) => re.test(a) || re.test(b));
  return i < 0 ? ORDEN.length : i;
}

/**
 * Arma el mapa de departamentos a partir del TABULADOR.
 *
 * Se construye una vez por pantalla y luego se consulta por cargo, en vez de
 * resolver cada renglón por su cuenta: la etiqueta de un grupo depende de TODOS
 * los cargos de ese grupo, así que hay que haberlos visto todos antes de poder
 * nombrar a ninguno. Resolver renglón por renglón daría un nombre distinto según
 * el orden en que llegaran las filas.
 */
export function mapaDepartamentos(tarifas: TarifaCargo[]): MapaDepartamentos {
  // cargo normalizado → departamento que el tabulador le asigna.
  const porCargo = new Map<string, string>();
  // grupo canónico → cuántas veces el tabulador usa cada escritura.
  const votos = new Map<string, Map<string, number>>();

  for (const t of tarifas) {
    const cargo = limpio(t.cargo);
    const dep = comoSeEscribe(t.departamento);
    if (!cargo || !dep) continue;
    porCargo.set(cargo, dep);
    // El grupo se calcula con el departamento escrito, no con el cargo: el cargo
    // es el último recurso y aquí ya hay algo mejor.
    const canon = normalizeDept(dep, t.cargo);
    const m = votos.get(canon) ?? new Map<string, number>();
    m.set(dep, (m.get(dep) ?? 0) + 1);
    votos.set(canon, m);
  }

  // grupo canónico → etiqueta ganadora (la más usada; a empate, la alfabética).
  const etiqueta = new Map<string, string>();
  votos.forEach((m, canon) => {
    const mejor = [...m.entries()].sort((a, b) => b[1] - a[1] || cmpText(a[0], b[0]))[0];
    if (mejor) etiqueta.set(canon, mejor[0]);
  });

  const de = (cargo?: string | null, deptFicha?: string | null): string => {
    // Tabulador primero, ficha después: el tabulador es lo que el usuario cura a
    // propósito para la nómina; la ficha es un dato de RRHH que puede estar viejo.
    const crudo = porCargo.get(limpio(cargo)) ?? comoSeEscribe(deptFicha);
    const canon = normalizeDept(crudo || null, cargo);
    return etiqueta.get(canon) ?? canon;
  };

  const orden = (deps: Iterable<string>): string[] =>
    [...new Set(deps)].sort((a, b) => {
      // SIN DEPARTAMENTO cierra siempre, esté o no en ORDEN: es el cajón de lo
      // que falta por clasificar, y va al final para que salte a la vista.
      const sa = a === SIN_DEPARTAMENTO ? 1 : 0, sb = b === SIN_DEPARTAMENTO ? 1 : 0;
      if (sa !== sb) return sa - sb;
      const pa = puesto(normalizeDept(a, null), a), pb = puesto(normalizeDept(b, null), b);
      return pa !== pb ? pa - pb : cmpText(a, b);
    });

  return { de, orden };
}
