// ============================================================================
// ORDEN DE LA LISTA DE MÁQUINAS — por máquina o por encargado.
//
// POR QUÉ EXISTE
// ---------------------------------------------------------------------------
// La vista "Check máquina" listaba las máquinas solo por CÓDIGO (A→Z). Para
// asignarle a un inspector todas las máquinas de un mismo encargado había que
// buscarlas una por una: el encargado salía escrito en cada tarjeta, pero
// desperdigado por toda la lista. Pedido del cliente (21-ago-2026): «quiero
// poder organizar por encargado, que me salgan todos pero que se vean las
// máquinas organizadas por nombre del encargado, que pueda elegir entre una u
// otra».
//
// Acá vive solo la lógica de ordenar y agrupar. `scripts/test-orden-maquinas.mjs`
// la amarra.
// ============================================================================

import { cmpText, norm } from './text';

/** Cómo se organiza la lista. 'maquina' = A→Z por código (como siempre). */
export type OrdenMaquinas = 'maquina' | 'encargado';

/** Etiqueta del grupo cuando la máquina no tiene encargado cargado. Va SIEMPRE
 *  de última: es una lista de pendientes por corregir, no un encargado más. */
export const SIN_ENCARGADO = 'SIN ENCARGADO';

/** Clave interna del cubo "sin encargado". No es un nombre: es un centinela, para
 *  que un encargado que de verdad se llamara "Sin Encargado" no cayera ahí. */
export const SIN_ENCARGADO_KEY = '__sin_encargado__';

/** Lo mínimo que necesita una fila para ordenarse.
 *
 *  `id` es opcional a propósito: esto también agrupa FILAS DE REPORTE (una
 *  máquina ya sumada por rango de fechas), que no siempre cargan el id. */
export type MaquinaOrden = { id?: string; code?: string | null; encargado?: string | null };

/** Un grupo de la lista: el título que se pinta arriba y sus máquinas. */
export type GrupoMaquinas<M> = { key: string; label: string; items: M[] };

/**
 * CLAVE CANÓNICA del encargado — la que decide si dos filas son la MISMA persona.
 *
 * ⚠️ ESTA ES LA ÚNICA VERDAD, y no siempre lo fue. Hasta el 21-ago-2026 acá se
 * agrupaba por `encargadoDe()` (MAYÚSCULAS, pero CON tildes) mientras que Control
 * de Maquinaria, el resumen de Inspecciones y el reporte de inspectores agrupaban
 * con `norm()` (SIN tildes). Resultado: "JOSÉ PÉREZ" y "JOSE PEREZ" salían como
 * DOS encargados en el Check de máquinas y como UNO en los otros tres módulos, y
 * los totales de dos reportes del mismo día no cuadraban.
 *
 * `norm()` baja a minúscula, quita tildes y protege la ñ (que no es una tilde:
 * "PEÑA" y "PENA" son apellidos distintos).
 *
 * Para MOSTRAR el nombre no se usa esta clave sino `encargadoDe()`, y el título
 * de cada grupo es la grafía más usada (ver `agruparMaquinas`).
 */
export function claveEncargado(m: MaquinaOrden): string {
  const raw = String(m.encargado ?? '').replace(/\s+/g, ' ').trim();
  return raw ? norm(raw) : SIN_ENCARGADO_KEY;
}

/** Nombre del encargado en MAYÚSCULAS y sin espacios de más, PARA MOSTRAR;
 *  `SIN ENCARGADO` si no tiene. Para decidir si dos filas son la misma persona
 *  NO se usa esto sino `claveEncargado()`. */
export function encargadoDe(m: MaquinaOrden): string {
  const raw = String(m.encargado ?? '').replace(/\s+/g, ' ').trim();
  return raw ? raw.toUpperCase() : SIN_ENCARGADO;
}

/**
 * Ordena la lista completa según el criterio elegido.
 *
 *  · 'maquina'   → A→Z por código, exactamente como salía antes.
 *  · 'encargado' → A→Z por encargado y, dentro de cada uno, A→Z por código.
 *                  Las que no tienen encargado quedan de últimas.
 *
 * SIEMPRE devuelve TODAS las máquinas que entraron: cambiar el orden no puede
 * esconder ninguna («que me salgan todos»).
 */
export function ordenarMaquinas<M extends MaquinaOrden>(lista: M[], orden: OrdenMaquinas): M[] {
  const out = lista.slice();
  if (orden === 'encargado') {
    out.sort((a, b) => {
      // Se compara por CLAVE, no por nombre visible: así dos grafías del mismo
      // encargado quedan pegadas y el desempate por código sí se aplica entre
      // ellas (antes, comparando el nombre con tildes, quedaban en orden
      // arbitrario y `agruparMaquinas` las partía en dos grupos seguidos).
      const ea = claveEncargado(a), eb = claveEncargado(b);
      if (ea !== eb) {
        // "SIN ENCARGADO" siempre al final, sin importar el alfabeto.
        if (ea === SIN_ENCARGADO_KEY) return 1;
        if (eb === SIN_ENCARGADO_KEY) return -1;
        return cmpText(ea, eb);
      }
      return cmpText(a.code, b.code);
    });
  } else {
    out.sort((a, b) => cmpText(a.code, b.code));
  }
  return out;
}

/**
 * Parte una lista YA ORDENADA en los grupos que se pintan en pantalla.
 *
 *  · 'maquina'   → UN solo grupo, sin título (la lista se ve igual que siempre).
 *  · 'encargado' → un grupo por encargado, con su nombre de título.
 *
 * Se agrupa sobre la lista ya ordenada y recortada, así los títulos siempre
 * cuadran con lo que se está viendo.
 *
 * EL TÍTULO ES LA GRAFÍA MÁS USADA del grupo. Si nueve máquinas dicen
 * "CARLOS NUÑEZ" y una dice "C. NUÑEZ", el grupo se llama "CARLOS NUÑEZ" —
 * no la primera que apareció, que sería un título al azar. Si empatan, gana la
 * alfabéticamente menor, para que el reporte de hoy y el de mañana digan lo
 * mismo con los mismos datos. (Mismo criterio que ya usaban Control de
 * Maquinaria y el reporte de inspectores.)
 */
export function agruparMaquinas<M extends MaquinaOrden>(lista: M[], orden: OrdenMaquinas): GrupoMaquinas<M>[] {
  if (orden !== 'encargado') return lista.length ? [{ key: '__todas__', label: '', items: lista.slice() }] : [];
  const grupos: GrupoMaquinas<M>[] = [];
  const variantes = new Map<string, Map<string, number>>();
  let actual: GrupoMaquinas<M> | null = null;
  lista.forEach((m) => {
    const key = claveEncargado(m);
    if (!actual || actual.key !== key) {
      actual = { key, label: '', items: [] };
      grupos.push(actual);
    }
    actual.items.push(m);
    if (!variantes.has(key)) variantes.set(key, new Map());
    const cuenta = variantes.get(key)!;
    const visible = encargadoDe(m);
    cuenta.set(visible, (cuenta.get(visible) ?? 0) + 1);
  });
  grupos.forEach((g) => {
    let mejor = '';
    let mejorN = -1;
    (variantes.get(g.key) ?? new Map<string, number>()).forEach((n, visible) => {
      if (mejorN < 0) { mejor = visible; mejorN = n; return; }
      // El desempate termina en una comparación CRUDA a propósito: `cmpText`
      // ignora las tildes, y acá las variantes que compiten se diferencian
      // justamente en eso ("JOSÉ PÉREZ" vs "JOSE PEREZ"). Sin este último
      // criterio el título dependería del orden en que llegaron las filas, o
      // sea que el mismo reporte podía salir con un título distinto cada vez.
      const c = cmpText(visible, mejor) || (visible < mejor ? -1 : visible > mejor ? 1 : 0);
      if (n > mejorN || (n === mejorN && c < 0)) { mejor = visible; mejorN = n; }
    });
    g.label = mejor || SIN_ENCARGADO;
  });
  return grupos;
}
