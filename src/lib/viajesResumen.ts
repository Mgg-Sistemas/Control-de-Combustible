// VIAJES DE CAMIONES — resumen GLOBALIZADO por camión, agrupado por EMPRESA o
// por LISTERO (quien registró los viajes).
//
// Pedido del cliente (20-ago-2026): el reporte de viajes no siempre debe salir
// desglosado viaje por viaje. Hace falta poder pedir "camión X → N viajes", con
// varios camiones a la vez, y que al filtrar por empresa salgan TODOS sus
// camiones, el número global de viajes de la empresa y su desglose.
//
// Pedido del cliente (22-ago-2026): además de por empresa, poder sacar el mismo
// reporte agrupado POR LISTERO — cuántos viajes registró cada quien y de qué
// camiones. Es la misma cuenta partida por otro eje, no un reporte nuevo: mismo
// tipo de retorno, mismo HTML, mismos totales. Igual criterio que el `groupBy`
// de `porEmpresaReport.ts` y `machineHoursReport.ts`.
//
// ⚠️ AGRUPAR NO FILTRA. Cambiar el eje no saca ni agrega un solo viaje: el
//    `total` general es idéntico en los dos modos. Es la propiedad que hace que
//    dos reportes del mismo día siempre cuadren entre sí, y está amarrada por
//    test.
//
// Vive aparte (sin imports) para que sea una función PURA testeable: la pantalla
// `ViajesCamionesScreen` solo le pasa las filas ya filtradas y el catálogo de
// camiones. Ver `scripts/test-viajes-resumen.mjs`.

/** Por cuál de los dos ejes se parte el resumen. */
export type EjeResumen = 'empresa' | 'listero';

/** Clave de los camiones sin empresa asignada: van todos a una sola cubeta. */
export const SIN_EMPRESA = '__sin_empresa__';

/**
 * Cubeta de los viajes sin listero identificado.
 *
 * `listero_id` queda NULL cuando se borra el usuario del listero (los viajes se
 * conservan, ver fix_borrar_usuario_conserva_viajes.sql). Esos viajes caen aquí en
 * vez de perderse — el total general tiene que cuadrar SIEMPRE con la cantidad de
 * filas recibidas. El nombre sigue disponible en `listero_name`.
 */
export const SIN_LISTERO = '__sin_listero__';

/** Clave de los camiones que el listero anotó a mano por no estar en el catálogo. */
export const FUERA_CATALOGO = '__fuera_catalogo__';

/**
 * Lo mínimo que el resumen necesita de un viaje.
 *
 * `listeroId`/`listeroName` son opcionales para no obligar a los llamadores que
 * solo agrupan por empresa (y a los tests viejos) a inventar datos que no usan.
 */
export type ViajeMin = {
  machineryId: string | null;
  machineCode: string;
  fueraCatalogo?: boolean;
  listeroId?: string | null;
  listeroName?: string | null;
  /**
   * ☀️ día (7am–7pm) o 🌙 noche (7pm–7am).
   *
   * Lo calcula QUIEN LLAMA, no este archivo: acá no hay imports a propósito
   * (ver la nota de arriba), y deducir el turno necesita la zona horaria de
   * Caracas. La pantalla lo saca con `turnoDeViaje` de src/lib/viajesTurno.ts.
   * Si no viene, los contadores de día/noche quedan en 0 y el total general
   * sigue cuadrando igual.
   */
  turno?: 'day' | 'night' | null;
};

/**
 * Clave con la que se cuenta un camión dentro de su empresa.
 *
 * ⚠️ Los camiones FUERA DE CATÁLOGO no tienen id, así que si se agruparan por
 * `machineryId` caerían TODOS en la misma cubeta (`null`) y "VOLTEO 88" y
 * "VOLTEO 99" saldrían sumados como si fueran un solo camión. Se agrupan por su
 * código escrito, normalizado, que es lo único que los distingue.
 */
export function claveCamion(v: ViajeMin): string {
  if (v.machineryId) return v.machineryId;
  return FUERA_CATALOGO + ':' + String(v.machineCode ?? '').trim().toUpperCase();
}

/** Lo mínimo que necesita del camión (sale de `machinery`). */
export type CamionMin = { companyId: string | null; companyName: string; plate: string | null; serial: string | null };

/** `dia + noche` puede ser MENOR que `viajes`: los viajes sin turno conocido
 *  (los viejos, de antes de que se guardara) no se le inventan a ninguno de
 *  los dos. `viajes` es el que manda y el que tiene que cuadrar. */
export type CamionResumen = { code: string; placa: string; viajes: number; dia: number; noche: number };
/**
 * Un GRUPO del resumen. Se llama `EmpresaResumen` por historia: cuando se
 * agrupa por listero, cada uno de estos es un LISTERO y no una empresa. El
 * nombre NO se cambia a propósito — renombrarlo obligaría a tocar la pantalla,
 * el HTML del PDF y el test sin ganar nada. Es justo lo que hace barato el
 * `groupBy`: la FORMA del resultado no cambia, solo por dónde se parte.
 */
export type EmpresaResumen = { key: string; name: string; total: number; dia: number; noche: number; camiones: CamionResumen[] };

export type ResumenViajes = {
  empresas: EmpresaResumen[];
  total: number;
  /** Desglose del total general por turno. Ver la nota de `CamionResumen`. */
  dia: number;
  noche: number;
  totalCamiones: number;
  /** Por cuál eje quedó partido esto. Lo usa el PDF para rotular sin adivinar. */
  groupBy: EjeResumen;
};

/** Compara textos como el resto de la app (sin distinguir mayúsculas ni acentos). */
const cmp = (a: string, b: string) =>
  a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true });

/**
 * Con qué texto se rotula un grupo cuando sus filas no lo escriben todas igual.
 *
 * Hace falta sobre todo para el listero: `listero_name` es una FOTO del nombre
 * al momento de registrar el viaje, no un join vivo con el perfil. Si a alguien
 * le corrigen el nombre (una tilde, un apellido que faltaba), un MISMO
 * `listeroId` trae dos textos distintos dentro del mismo rango.
 *
 * Se elige la variante MÁS USADA para que el título no dependa de qué fila
 * llegó primero, y el desempate es alfabético para que dos corridas del mismo
 * reporte salgan idénticas. Mismo criterio que `agruparMaquinas` en
 * `ordenMaquinas.ts`, por distinta causa: allá el texto es libre, acá es una
 * foto vieja.
 *
 * ⚠️ Ojo con la diferencia de fondo: acá NO se normaliza nada. La clave del
 *    grupo es el uuid del listero, que es exacto por construcción; normalizar
 *    nombres solo podría empeorarlo.
 */
function etiquetaGrupo(nombres: Map<string, number>, siVacio: string): string {
  let mejor = '';
  let veces = -1;
  for (const [nom, n] of nombres) {
    if (n > veces || (n === veces && cmp(nom, mejor) < 0)) { mejor = nom; veces = n; }
  }
  return mejor || siVacio;
}

/**
 * Agrupa viajes → (empresa | listero) → camión, contando cuántos hizo cada uno.
 *
 * · `groupBy: 'empresa'` (por defecto) → como siempre: cada empresa con sus
 *   camiones. `groupBy: 'listero'` → cada listero con los camiones que ÉL
 *   registró. El desglose interno es por camión en los dos casos, porque es lo
 *   que se quiere leer: «Pedro registró 40 viajes: 12 del volteo A, 28 del B».
 * · Los grupos salen de MAYOR a menor cantidad de viajes (desempate alfabético).
 * · Dentro de cada grupo, los camiones igual: de más viajes a menos.
 * · La placa es la del camión; si no tiene, su serial; si tampoco, '—'.
 * · Un viaje de un camión que ya no está en el catálogo NO se pierde: cae en
 *   "Sin empresa" con su código, para que el total general siempre cuadre con la
 *   cantidad de filas recibidas. Agrupando por listero eso no aplica: el listero
 *   está en la propia fila del viaje y no se busca en ningún catálogo, así que
 *   ningún viaje puede quedar huérfano.
 */
export function resumirViajes(
  rows: ViajeMin[],
  camionPorId: (id: string) => CamionMin | undefined,
  groupBy: EjeResumen = 'empresa'
): ResumenViajes {
  const porListero = groupBy === 'listero';
  const emp = new Map<string, { key: string; nombres: Map<string, number>; total: number; dia: number; noche: number; camiones: Map<string, CamionResumen> }>();
  let totalDia = 0, totalNoche = 0;

  for (const r of rows) {
    // Un camión fuera de catálogo no se busca: no está y nunca va a estar.
    const t = r.machineryId ? camionPorId(r.machineryId) : undefined;

    // El ÚNICO punto donde los dos modos se separan. De acá para abajo el
    // código es idéntico, y por eso los totales de los dos no pueden diferir.
    const key = porListero
      ? (String(r.listeroId ?? '').trim() || SIN_LISTERO)
      : (t?.companyId ?? SIN_EMPRESA);
    const name = porListero
      ? (String(r.listeroName ?? '').replace(/\s+/g, ' ').trim() || 'Sin listero')
      : (t?.companyName || 'Sin empresa');

    // Ni 'day' ni 'night' (viaje viejo, sin turno guardado): no se le regala a
    // ninguno de los dos lados. Mejor que el desglose no sume al total a que
    // aparezcan viajes de día que nadie hizo.
    const esDia = r.turno === 'day';
    const esNoche = r.turno === 'night';
    if (esDia) totalDia += 1;
    if (esNoche) totalNoche += 1;

    const g = emp.get(key) ?? { key, nombres: new Map<string, number>(), total: 0, dia: 0, noche: 0, camiones: new Map<string, CamionResumen>() };
    g.total += 1;
    if (esDia) g.dia += 1;
    if (esNoche) g.noche += 1;
    g.nombres.set(name, (g.nombres.get(name) ?? 0) + 1);

    const ck = claveCamion(r);
    const cam = g.camiones.get(ck) ?? {
      code: r.machineCode,
      // Los de fuera de catálogo no tienen placa en el sistema (no hay ficha que
      // consultar): se marcan para que quien lee el reporte sepa que ese camión
      // lo anotó un listero a mano y no está en la flota.
      placa: r.machineryId ? (t?.plate || t?.serial || '—') : 'FUERA DE CATÁLOGO',
      viajes: 0,
      dia: 0,
      noche: 0,
    };
    cam.viajes += 1;
    if (esDia) cam.dia += 1;
    if (esNoche) cam.noche += 1;
    g.camiones.set(ck, cam);
    emp.set(key, g);
  }

  const empresas: EmpresaResumen[] = Array.from(emp.values())
    .map((g) => ({
      key: g.key,
      name: etiquetaGrupo(g.nombres, porListero ? 'Sin listero' : 'Sin empresa'),
      total: g.total,
      dia: g.dia,
      noche: g.noche,
      camiones: Array.from(g.camiones.values()).sort((a, b) => b.viajes - a.viajes || cmp(a.code, b.code)),
    }))
    .sort((a, b) => b.total - a.total || cmp(a.name, b.name));

  return {
    empresas,
    total: rows.length,
    dia: totalDia,
    noche: totalNoche,
    // ⚠️ Camiones DISTINTOS, no la suma de los grupos. Agrupando por empresa da
    //    igual (un camión pertenece a una sola empresa), pero agrupando por
    //    listero un mismo camión aparece bajo cada listero que lo registró: si
    //    se sumaran los grupos, un camión trabajado por 3 listeros contaría
    //    como 3 camiones y el encabezado del reporte mentiría.
    totalCamiones: new Set(rows.map(claveCamion)).size,
    groupBy,
  };
}
