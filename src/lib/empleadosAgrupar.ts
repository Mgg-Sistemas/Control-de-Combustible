/**
 * AGRUPAR LA LISTA DE EMPLEADOS POR CARGO (17-sep-2026).
 *
 * Pedido del cliente: además de filtrar por cargo, poder VER la plantilla agrupada
 * por cargo — cuántos operadores, cuántos obreros, y quiénes son.
 *
 * ⭐ El orden de los grupos es el MISMO del resumen del 📊 Reporte: primero los
 *    cargos con más gente y, a igualdad, alfabético. Si esta pantalla ordenara de
 *    otra forma, el papel que se entrega y la pantalla de la que salió contarían lo
 *    mismo en distinto orden, y eso obliga a comparar renglón por renglón.
 *
 * ⚠️ NO filtra ni saca a nadie: reparte exactamente la lista que recibe. La suma de
 *    los grupos siempre es el total de arriba — si algún día no cuadra, es un bug.
 *
 * Sin React ni Supabase, para poder probarla de verdad (scripts/test-nomina-grupos.mjs).
 */

export type GrupoCargo<T> = { cargo: string; empleados: T[] };

export function agruparPorCargo<T>(
  lista: readonly T[],
  cargoDe: (e: T) => string,
  cmp: (a: string, b: string) => number,
): GrupoCargo<T>[] {
  const map = new Map<string, T[]>();
  lista.forEach((e) => {
    const k = cargoDe(e);
    const g = map.get(k);
    if (g) g.push(e); else map.set(k, [e]);
  });
  return Array.from(map.entries())
    .map(([cargo, empleados]) => ({ cargo, empleados }))
    .sort((a, b) => b.empleados.length - a.empleados.length || cmp(a.cargo, b.cargo));
}
