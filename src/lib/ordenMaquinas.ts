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

import { cmpText } from './text';

/** Cómo se organiza la lista. 'maquina' = A→Z por código (como siempre). */
export type OrdenMaquinas = 'maquina' | 'encargado';

/** Etiqueta del grupo cuando la máquina no tiene encargado cargado. Va SIEMPRE
 *  de última: es una lista de pendientes por corregir, no un encargado más. */
export const SIN_ENCARGADO = 'SIN ENCARGADO';

/** Lo mínimo que necesita una máquina para ordenarse. */
export type MaquinaOrden = { id: string; code?: string | null; encargado?: string | null };

/** Un grupo de la lista: el título que se pinta arriba y sus máquinas. */
export type GrupoMaquinas<M> = { key: string; label: string; items: M[] };

/** Nombre del encargado en MAYÚSCULAS y sin espacios de más; `SIN ENCARGADO` si
 *  no tiene. Se normaliza para que "bruno", "Bruno" y "BRUNO " sean el MISMO
 *  grupo — si no, el mismo encargado saldría partido en tres renglones. */
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
      const ea = encargadoDe(a), eb = encargadoDe(b);
      if (ea !== eb) {
        // "SIN ENCARGADO" siempre al final, sin importar el alfabeto.
        if (ea === SIN_ENCARGADO) return 1;
        if (eb === SIN_ENCARGADO) return -1;
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
 */
export function agruparMaquinas<M extends MaquinaOrden>(lista: M[], orden: OrdenMaquinas): GrupoMaquinas<M>[] {
  if (orden !== 'encargado') return lista.length ? [{ key: '__todas__', label: '', items: lista.slice() }] : [];
  const grupos: GrupoMaquinas<M>[] = [];
  let actual: GrupoMaquinas<M> | null = null;
  lista.forEach((m) => {
    const label = encargadoDe(m);
    if (!actual || actual.label !== label) {
      actual = { key: label, label, items: [] };
      grupos.push(actual);
    }
    actual.items.push(m);
  });
  return grupos;
}
