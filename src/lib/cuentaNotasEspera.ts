// 📝 NOTAS DE «POR QUÉ NO SE HA PAGADO» (04-nov-2026, a pedido: «en Por Pagar,
// que cualquiera le pueda colocar una nota, sobre todo a las que están
// esperando pago, para justificar por qué no han pagado todavía, y que esté
// visible»). Cada nota es una fila de `cuenta_notas_espera`: la base pone el
// autor y la hora, y una nota nunca se edita ni se borra — se ANULA.
//
// ⭐ SIN IMPORTS, a propósito: se prueba sola (scripts/test-cuenta-notas-espera.mjs).

export const TABLA_NOTAS_ESPERA = 'cuenta_notas_espera';
export const LARGO_MAX_NOTA_ESPERA = 1000;

export type NotaEspera = {
  id: string;
  cuenta_id: string;
  texto: string;
  created_by: string | null;
  autor_nombre: string | null;
  created_at: string;
  anulada_at: string | null;
  anulada_por_nombre: string | null;
};

/** Las notas de cada cuenta, de la más nueva a la más vieja. */
export function notasPorCuenta(notas: readonly NotaEspera[] | null | undefined): Map<string, NotaEspera[]> {
  const m = new Map<string, NotaEspera[]>();
  for (const n of notas ?? []) {
    if (!n?.cuenta_id) continue;
    const l = m.get(n.cuenta_id) ?? [];
    l.push(n);
    m.set(n.cuenta_id, l);
  }
  m.forEach((l) => l.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))));
  return m;
}

/** La que se muestra en la tarjeta: la más nueva que no esté anulada. */
export function ultimaNotaActiva(notas: readonly NotaEspera[] | null | undefined): NotaEspera | null {
  return (notas ?? []).find((n) => !n.anulada_at) ?? null;
}

/** null = se puede guardar; si no, el porqué en palabras simples. */
export function validarNotaEspera(texto: string): string | null {
  const t = String(texto ?? '').trim();
  if (!t) return 'Escribe la nota antes de guardar.';
  if (t.length > LARGO_MAX_NOTA_ESPERA) return `La nota es muy larga (máximo ${LARGO_MAX_NOTA_ESPERA} letras).`;
  return null;
}

/** «04/11/2026 9:15 am», en hora de Caracas. */
export function cuandoNotaEspera(iso: string | null | undefined): string {
  const t = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(t)) return '';
  const d = new Date(t - 4 * 3600 * 1000); // Caracas = UTC−4, sin horario de verano
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  let h = d.getUTCHours();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${dd}/${mm}/${d.getUTCFullYear()} ${h}:${String(d.getUTCMinutes()).padStart(2, '0')} ${ampm}`;
}

/** Si la tabla aún no existe en la base, la pantalla no se cae: solo no muestra notas. */
export function esTablaNotasFaltante(msg: unknown): boolean {
  const m = String(msg ?? '');
  return /cuenta_notas_espera/i.test(m) && /does not exist|schema cache|not find|no existe/i.test(m);
}
