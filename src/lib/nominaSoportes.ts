// 📎 SOPORTES DEL PAGO DE CADA PERSONA (19-oct-2026, a pedido: «en el pago para
// un período poder subirle una o varias imágenes… una imagen de factura o algo
// así a cada persona, sin dañar ni nada»).
//
// ⭐ NO TOCA LOS MONTOS: los soportes viven en su tabla (`staff_pay_item_docs`,
//    SQL corrido y verificado el 19-oct) y solo cuelgan del pago de la persona
//    (`staff_pay_items.id`, con borrado en cascada: si la sacan del período,
//    sus soportes se van con ella). Recalcular el período hace UPDATE sobre los
//    items — el id no cambia — así que los soportes sobreviven el recálculo.
//
// ⭐ SE PUEDE SUBIR CON EL PERÍODO PAGADO, a propósito: la factura o el
//    comprobante llegan DESPUÉS de pagar; el candado del período congela los
//    montos, no la evidencia. Borrar sí es más serio (es evidencia): la
//    pantalla lo deja solo a quien tiene nómina en full, con confirmación.
//
// Los archivos van al bucket de siempre (carpeta nomina-soportes/<item>/, vía
// src/lib/photo.ts). Lo vigila scripts/test-nomina-soportes.mjs.
import { supabase } from './supabase';

export type SoportePago = {
  id: string;
  itemId: string;
  periodId: string;
  url: string;
  kind: 'image' | 'pdf';
  name: string | null;
  creadoAt: string | null;
  por: string | null;
};

function isMissingTable(msg: string, code?: string): boolean {
  return code === '42P01' || /does not exist|relation .* not found/i.test(msg);
}

const aSoporte = (r: any): SoportePago => ({
  id: r.id as string,
  itemId: r.item_id as string,
  periodId: r.period_id as string,
  url: String(r.url ?? ''),
  kind: r.kind === 'pdf' ? 'pdf' : 'image',
  name: (r.name ?? null) as string | null,
  creadoAt: (r.created_at ?? null) as string | null,
  por: (r.created_by_nombre ?? null) as string | null,
});

/** Todos los soportes de un período, de un viaje a la base (la pantalla los
 *  agrupa por persona con `agruparSoportes`). */
export async function listarSoportesPeriodo(periodId: string): Promise<{ soportes: SoportePago[]; missing: boolean; error?: string }> {
  const { data, error } = await supabase.from('staff_pay_item_docs')
    .select('id, item_id, period_id, url, kind, name, created_at, created_by_nombre')
    .eq('period_id', periodId).order('created_at', { ascending: true });
  if (error) return { soportes: [], missing: isMissingTable(error.message, (error as any).code), error: error.message };
  return { soportes: (data ?? []).map(aSoporte), missing: false };
}

/** El mapa persona → sus soportes, en el orden en que se subieron. PURA. */
export function agruparSoportes(soportes: readonly SoportePago[] | null | undefined): Map<string, SoportePago[]> {
  const m = new Map<string, SoportePago[]>();
  for (const s of soportes ?? []) {
    const l = m.get(s.itemId) ?? [];
    l.push(s);
    m.set(s.itemId, l);
  }
  return m;
}

/** «factura.jpg · 19/10 · por MARÍA» — la línea de cada soporte. PURA. */
export function etiquetaSoporte(s: Pick<SoportePago, 'kind' | 'name' | 'creadoAt' | 'por'>): string {
  const base = String(s.name ?? '').trim() || (s.kind === 'pdf' ? 'PDF' : 'imagen');
  const f = s.creadoAt ? String(s.creadoAt).slice(0, 10).split('-').reverse().slice(0, 2).join('/') : '';
  return [base, f, s.por ? `por ${s.por}` : ''].filter(Boolean).join(' · ');
}

/** Guarda la fila del soporte (el archivo ya subió al bucket). El `.select('id')`
 *  delata a la RLS si rechaza sin error (regla de la casa: 0 filas = no se guardó). */
export async function agregarSoporte(d: {
  itemId: string; periodId: string; url: string; kind: 'image' | 'pdf';
  name?: string | null; uid: string | null; userName: string | null;
}): Promise<{ error?: string }> {
  if (!d.url) return { error: 'No llegó la dirección del archivo.' };
  const { data, error } = await supabase.from('staff_pay_item_docs').insert({
    item_id: d.itemId, period_id: d.periodId, url: d.url, kind: d.kind,
    name: d.name ?? null, created_by: d.uid, created_by_nombre: d.userName,
  }).select('id');
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: 'No se guardó el soporte (¿permiso?).' };
  return {};
}

/** Borra UN soporte. La pantalla confirma antes y lo deja solo a nómina full:
 *  es evidencia de un pago, no un borrador. */
export async function borrarSoporte(id: string): Promise<{ error?: string }> {
  const { data, error } = await supabase.from('staff_pay_item_docs').delete().eq('id', id).select('id');
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: 'No se borró: ese soporte ya no existe o falta permiso.' };
  return {};
}
