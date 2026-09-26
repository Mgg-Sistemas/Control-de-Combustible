// FOTOS ADICIONALES DEL HORÓMETRO, CON HISTÓRICO (26-sep-2026).
//
// Pedido del cliente: «para los inspectores, poder subir una foto del horómetro
// desde la galería y que pueda subir más de una foto, que se guarde el
// histórico de quién subió y cuándo subió».
//
// Cada fila de `horometro_fotos` es UNA foto: máquina + jornada + turno + URL
// del bucket + QUIÉN (uuid y nombre CONGELADO) + CUÁNDO (created_at). Las fotos
// inicial/final de la lectura siguen en `lecturas_horometro_trabajo` tal cual;
// estas son las ADICIONALES — se pueden subir cuantas hagan falta.
//
// ⚠️ EL HISTÓRICO NO SE TOCA: la tabla no tiene UPDATE ni DELETE para nadie
//    desde la app (ni siquiera el privilegio). Una foto mal subida se tapa
//    subiendo la buena; las dos quedan, con su quién y su cuándo.

import { supabase, selectAllRows } from './supabase';

export type FotoHorometroExtra = {
  id: string;
  machineryId: string;
  roundDate: string; // 'YYYY-MM-DD'
  shift: 'day' | 'night';
  url: string;
  subidaPor: string | null;
  /** Nombre CONGELADO al subir: sobrevive a que la cuenta se borre. */
  subidaPorNombre: string | null;
  subidaAt: string; // ISO
};

const COLS = 'id, machinery_id, round_date, shift, url, subida_por, subida_por_nombre, created_at';

const aFoto = (r: any): FotoHorometroExtra => ({
  id: r.id as string,
  machineryId: r.machinery_id as string,
  roundDate: String(r.round_date ?? '').slice(0, 10),
  shift: r.shift === 'night' ? 'night' : 'day',
  url: String(r.url ?? ''),
  subidaPor: (r.subida_por ?? null) as string | null,
  subidaPorNombre: (r.subida_por_nombre ?? null) as string | null,
  subidaAt: String(r.created_at ?? ''),
});

/** Guarda UNA foto en el histórico. La URL ya viene subida al bucket. */
export async function agregarFotoHorometro(p: {
  machineryId: string;
  roundDate: string;
  shift: 'day' | 'night';
  url: string;
  userId: string | null;
  userName: string | null;
}): Promise<{ error?: string }> {
  if (!p.machineryId || !p.url) return { error: 'Falta la máquina o la foto.' };
  const { data, error } = await supabase.from('horometro_fotos').insert({
    machinery_id: p.machineryId,
    round_date: p.roundDate,
    shift: p.shift,
    url: p.url,
    subida_por: p.userId,
    subida_por_nombre: p.userName,
  }).select('id');
  if (error) return { error: error.message };
  // Un rechazo por permisos vuelve sin error y con 0 filas: hay que decirlo,
  // no dar por guardada una foto que no quedó en el histórico.
  if (!data || data.length === 0) return { error: 'No se guardó el registro de la foto (permisos). Avisa al administrador.' };
  return {};
}

/** Las fotos de UNA máquina en UNA jornada (ambos turnos) — para que el
 *  inspector vea en el momento qué subió, quién y a qué hora. Más vieja
 *  primero: el orden en que se subieron ES el histórico. */
export async function listarFotosHorometroDia(
  machineryId: string, roundDate: string,
): Promise<{ fotos: FotoHorometroExtra[]; error?: string }> {
  const { data, error } = await supabase.from('horometro_fotos').select(COLS)
    .eq('machinery_id', machineryId).eq('round_date', roundDate)
    .order('created_at', { ascending: true });
  if (error) return { fotos: [], error: error.message };
  return { fotos: ((data ?? []) as any[]).map(aFoto) };
}

/** Todas las fotos adicionales de un rango de jornadas — para la galería del
 *  reporte de horómetros (que ya organiza por maquinaria). */
export async function cargarFotosHorometroRango(
  desdeISO: string, hastaISO: string,
): Promise<FotoHorometroExtra[]> {
  const data = await selectAllRows('horometro_fotos', COLS,
    (q: any) => q.gte('round_date', desdeISO).lte('round_date', hastaISO));
  return (data as any[]).map(aFoto);
}
