// CONTROL DE HORÓMETROS — lo que toca la red (02-oct-2026).
// Las reglas viven en `pagoHorometro.ts` (puro); acá solo se habla con la base.
//
// ⭐ TABLA PROPIA: `horometro_precios`. No se lee ni se escribe NADA de Control de
//    jornadas (`machine_rounds`, `control_closures`, `machinery_precio_historial`):
//    los dos controles conviven sin tocarse.
// ⭐ El módulo tiene que funcionar ANTES de que exista la tabla (el código se
//    publica y el SQL se corre aparte): sin tabla, `missing: true` y la pantalla
//    muestra las horas con el aviso de que falta crear los precios.
// ⭐ Las escrituras piden `.select('id')`: un rechazo por permisos vuelve sin
//    error y con 0 filas, y hay que decirlo en vez de dar por guardado.
import { supabase, selectAllRows } from './supabase';
import { AjusteHorometro, MaquinaPago, PrecioHorometro, validarAjusteHorometro, validarPrecioHorometro } from './pagoHorometro';

const limpio = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const faltaTabla = (msg: string, code?: string) =>
  code === '42P01' || code === 'PGRST205' || /horometro_(precios|ajustes).*(does not exist|not find)|schema cache/i.test(msg);

export const SIN_PERMISO_PRECIO_HOROMETRO =
  'No se guardó: hace falta permiso de escritura en Control de maquinaria (y la analista no cambia precios).';

export async function cargarPreciosHorometro(): Promise<{ precios: PrecioHorometro[]; missing: boolean; error?: string }> {
  try {
    const rows = await selectAllRows(
      'horometro_precios',
      'id, machinery_id, precio_hora, desde, hasta, nota, created_at, created_by_nombre, anulada_at, anulada_motivo',
    );
    return { precios: rows as PrecioHorometro[], missing: false };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    return { precios: [], missing: faltaTabla(msg, e?.code), error: msg };
  }
}

/** La ficha de las máquinas, más el precio de Control de jornadas SOLO como
 *  referencia (para sugerir «jornada ÷ 12»; nunca se usa para calcular acá). */
export type MaquinaConReferencia = MaquinaPago & { precioJornada: number | null };

export async function cargarMaquinasPagoHorometro(): Promise<MaquinaConReferencia[]> {
  const rows = await selectAllRows('machinery', 'id, code, marca, modelo, plate, serial, clasificacion, price_per_hour, company:company_id(name)');
  return (rows as any[]).map((m) => {
    const pj = Number(m.price_per_hour);
    return {
      id: String(m.id), code: limpio(m.code) || '—',
      // Igual que los demás reportes de maquinaria: placa, o serial si no tiene.
      placa: limpio(m.plate) || limpio(m.serial),
      empresa: limpio(m.company?.name) || 'Sin empresa',
      clasificacion: limpio(m.clasificacion) || 'Sin clasificación',
      marca: limpio(m.marca), modelo: limpio(m.modelo),
      precioJornada: Number.isFinite(pj) && pj > 0 ? pj : null,
    };
  });
}

/** Pone un precio por hora a una o varias máquinas, desde una fecha (y hasta
 *  otra, si se blinda). No pisa nada: agrega una fila y la regla de
 *  `precioHoraEn` decide cuál manda cada día. */
export async function crearPrecioHorometro(p: {
  machineryIds: string[]; precioHora: number; desde: string; hasta?: string | null; nota?: string | null;
}): Promise<{ error?: string; guardadas: number }> {
  const ids = Array.from(new Set((p.machineryIds ?? []).filter(Boolean)));
  if (!ids.length) return { error: 'Elige al menos una máquina.', guardadas: 0 };
  const malo = validarPrecioHorometro({ precio: p.precioHora, desde: p.desde, hasta: p.hasta });
  if (malo) return { error: malo, guardadas: 0 };
  const filas = ids.map((machinery_id) => ({
    machinery_id, precio_hora: p.precioHora, desde: p.desde, hasta: p.hasta || null, nota: limpio(p.nota) || null,
  }));
  const { data, error } = await supabase.from('horometro_precios').insert(filas).select('id');
  if (error) return { error: faltaTabla(error.message, (error as any).code) ? 'Falta crear la tabla de precios de horómetro en la base.' : error.message, guardadas: 0 };
  if (!data || data.length === 0) return { error: SIN_PERMISO_PRECIO_HOROMETRO, guardadas: 0 };
  return { guardadas: data.length };
}

/** Un precio no se borra: se ANULA con su motivo (queda en el historial). */
export async function anularPrecioHorometro(id: string, motivo: string): Promise<{ error?: string }> {
  const m = limpio(motivo);
  if (!m) return { error: 'Escribe por qué se anula ese precio.' };
  const { data, error } = await supabase.from('horometro_precios')
    .update({ anulada_at: new Date().toISOString(), anulada_motivo: m })
    .eq('id', id).is('anulada_at', null).select('id');
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: SIN_PERMISO_PRECIO_HOROMETRO };
  return {};
}

// ── 🧾 AJUSTES «SOLO PARA CONTROL DE HORÓMETROS» ────────────────────────────
// Tabla propia `horometro_ajustes`. NO toca `lecturas_horometro_trabajo`: lo que
// cargó el inspector queda intacto y este módulo usa el ajuste en su lugar.
// Solo se INSERTA (el más nuevo manda) y se ANULA; nunca se edita ni se borra.

export const SIN_PERMISO_AJUSTE_HOROMETRO =
  'No se guardó: hace falta permiso de escritura en Control de maquinaria (y la analista no ajusta horómetros).';

export async function cargarAjustesHorometro(desde: string, hasta: string): Promise<{ ajustes: AjusteHorometro[]; missing: boolean; error?: string }> {
  try {
    const rows = await selectAllRows(
      'horometro_ajustes',
      'id, machinery_id, round_date, shift, inicial, final, motivo, created_at, created_by_nombre, anulada_at, anulada_motivo',
      (q: any) => q.gte('round_date', desde).lte('round_date', hasta),
    );
    return { ajustes: rows as AjusteHorometro[], missing: false };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    return { ajustes: [], missing: faltaTabla(msg, e?.code), error: msg };
  }
}

/** Guarda un ajuste para una máquina, día y turno. No pisa nada: agrega una fila
 *  y el más nuevo es el que manda (ver `lecturasEfectivas`). */
export async function guardarAjusteHorometro(a: {
  machineryId: string; roundDate: string; shift: 'day' | 'night'; inicial: number; final: number; motivo: string;
}): Promise<{ error?: string }> {
  const malo = validarAjusteHorometro({ inicial: a.inicial, final: a.final, motivo: a.motivo });
  if (malo) return { error: malo };
  const { data, error } = await supabase.from('horometro_ajustes')
    .insert({ machinery_id: a.machineryId, round_date: a.roundDate, shift: a.shift, inicial: a.inicial, final: a.final, motivo: limpio(a.motivo) })
    .select('id');
  if (error) return { error: faltaTabla(error.message, (error as any).code) ? 'Falta crear la tabla de ajustes de horómetro en la base.' : error.message };
  if (!data || data.length === 0) return { error: SIN_PERMISO_AJUSTE_HOROMETRO };
  return {};
}

/** Quita el ajuste de una máquina, día y turno: vuelve a mandar lo que cargó el
 *  inspector. Anula TODOS los activos de esa clave. `sinAjuste` = no había ninguno. */
export async function anularAjustesHorometro(
  machineryId: string, roundDate: string, shift: 'day' | 'night', motivo: string,
): Promise<{ error?: string; sinAjuste?: boolean }> {
  const m = limpio(motivo);
  if (!m) return { error: 'Escribe por qué se quita el ajuste.' };
  const { data, error } = await supabase.from('horometro_ajustes')
    .update({ anulada_at: new Date().toISOString(), anulada_motivo: m })
    .eq('machinery_id', machineryId).eq('round_date', roundDate).eq('shift', shift).is('anulada_at', null)
    .select('id');
  if (error) return { error: faltaTabla(error.message, (error as any).code) ? undefined : error.message, sinAjuste: true };
  if (!data || data.length === 0) return { sinAjuste: true };
  return {};
}
