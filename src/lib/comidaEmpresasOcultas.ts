// 🙈 EMPRESAS OCULTAS SOLO EN COCINA (03-nov-2026, a pedido: «ocultar solo para ese
// módulo, sin que dañe los demás, las empresas que ya no necesito, y que aparezcan
// cuando las necesite»).
//
// Vive en su propia tabla (`comida_empresas_ocultas`): NO toca `companies.hidden`,
// que esconde la empresa en TODO el sistema (maquinaria, nómina, compras…).
//
// ⭐ Ocultar solo quita la empresa de donde se ELIGE una empresa para una entrega
//    nueva (QR por empresa, alta en el editor de días, alta de un contacto). Los
//    reportes, el cobro, las facturas y el histórico la siguen mostrando: lo que se
//    le entregó no se pierde. Mostrarla otra vez es el mismo interruptor.
//
// PURA: sin Supabase ni React.

export type FilaEmpresaOculta = {
  company_id: string;
  oculta: boolean;
  updated_at?: string | null;
  updated_by_nombre?: string | null;
};

/** Los ids ocultos hoy (la última fila de cada empresa manda: es una por empresa). */
export function idsOcultas(filas: readonly FilaEmpresaOculta[] | null | undefined): Set<string> {
  const s = new Set<string>();
  for (const f of filas ?? []) {
    if (!f?.company_id) continue;
    if (f.oculta) s.add(String(f.company_id)); else s.delete(String(f.company_id));
  }
  return s;
}

/**
 * Las empresas que se OFRECEN para elegir en cocina. `conservar` = ids que deben
 * seguir aunque estén ocultos (p. ej. la que ya está elegida en un formulario):
 * esconder lo que alguien ya eligió le cambiaría la elección sin avisar.
 */
export function visiblesEnCocina<T extends { id: string }>(
  empresas: readonly T[] | null | undefined,
  ocultas: ReadonlySet<string> | null | undefined,
  conservar: readonly (string | null | undefined)[] = [],
): T[] {
  const keep = new Set(conservar.filter(Boolean).map(String));
  return (empresas ?? []).filter((e) => !ocultas?.has(String(e.id)) || keep.has(String(e.id)));
}

/** Cuántas de la lista están ocultas (para el botón «👁️ Ver ocultas (N)»). */
export function cuantasOcultas(empresas: readonly { id: string }[] | null | undefined, ocultas: ReadonlySet<string> | null | undefined): number {
  return (empresas ?? []).filter((e) => ocultas?.has(String(e.id))).length;
}

/** ¿La tabla aún no existe? (falta correr el SQL): la pantalla sigue como si nada estuviera oculto. */
export function esTablaFaltante(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? '');
  const msg = String(error.message ?? '');
  return code === '42P01' || code === 'PGRST205' || /does not exist|could not find the table|schema cache/i.test(msg);
}
