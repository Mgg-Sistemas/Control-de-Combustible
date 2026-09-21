// INTERRUPTOR DE LA AUTOMATIZACIÓN DEL «INSPECTOR SOS» (21-sep-2026).
//
// Pedido del cliente: «un check al inspector sos el cual solo veremos los
// administradores para poder activar o desactivar la automatización».
//
// ⭐ «Inspector SOS LA GUAIRA» NO ES UNA PERSONA: es el usuario de sistema
//    (`PLACEHOLDER_INSPECTOR_ID`, el viejo «MÁQUINAS FALTANTES») al que se le asignan
//    solas las máquinas sin inspector de verdad. Su «automatización» son procesos de
//    la base (pg_cron) que, sin que nadie toque nada, les INICIAN la jornada a las 7am
//    y a las 7pm, se la reabren cada 10 minutos y les LLENAN el turno completo.
//
// QUÉ APAGA (opción (a), elegida por el cliente): solo esos procesos que arrancan
// jornadas o llenan horas — `auto_start_placeholder_day/night`,
// `auto_full_shift_placeholder`, `sos_reassert_shift_start`, y las 12 h de las 7:05 pm
// (`auto_iniciar_dia_12h`) para las máquinas cuyo inspector de día es el SOS.
//
// QUÉ **NO** APAGA, a propósito:
//   · Los procesos que CIERRAN jornadas: si se apagara con jornadas abiertas, quedarían
//     colgadas sumando horas para siempre.
//   · La asignación automática de máquinas sin inspector al SOS.
//   · La regla de pantalla «siempre trabajando» (`inspectorSiempreActivo`): sus máquinas
//     siguen sin salir como paradas ni averiadas. El cliente lo pidió así.
//
// ⚠️ EL INTERRUPTOR VIVE EN LA BASE, NO EN EL TELÉFONO: es una sola fila
//    (`sos_automatizacion_config`) que leen los crons. Y LA BASE ES LA QUE MANDA:
//    esconder el botón no protege nada; las políticas solo dejan leerla y cambiarla a
//    un admin (probado suplantando a un admin y a un analista).
import { supabase } from './supabase';

export type EstadoSosAuto = {
  activa: boolean;
  /** Última vez que alguien lo cambió, y quién. null = nunca se ha tocado. */
  cambiadoAt: string | null;
  cambiadoPor: string | null;
};

/** ¿El error es «esa tabla no existe»? Mismo criterio que el resto del sistema. */
function faltaLaTabla(e: any): boolean {
  const msg = String(e?.message ?? e).toLowerCase();
  const code = String(e?.code ?? '').toLowerCase();
  return code === '42p01' || code === 'pgrst205' || msg.includes('does not exist') || msg.includes('schema cache');
}

/**
 * Lee el interruptor. `null` = no se puede ver: o no eres admin (la base devuelve 0
 * filas, sin error) o falta correr el SQL. En los dos casos la tarjeta no se muestra.
 * Un fallo de red LANZA: no se puede pintar «encendida» sin saberlo.
 */
export async function leerSosAutomatizacion(): Promise<EstadoSosAuto | null> {
  const { data, error } = await supabase
    .from('sos_automatizacion_config')
    .select('activa, updated_at, updated_by_nombre')
    .limit(1);
  if (error) {
    if (faltaLaTabla(error)) return null;
    throw new Error(error.message);
  }
  const f = (data as any[] | null)?.[0];
  if (!f) return null;
  return { activa: f.activa !== false, cambiadoAt: f.updated_by_nombre ? f.updated_at ?? null : null, cambiadoPor: f.updated_by_nombre ?? null };
}

/**
 * Enciende o apaga. Pide las filas de vuelta: con RLS, un «no eres admin» llega como
 * 0 filas y SIN error, y sin contarlas la pantalla diría «✅ apagada» sin haber apagado nada.
 */
export async function cambiarSosAutomatizacion(
  activa: boolean,
  quien: { id?: string | null; nombre?: string | null },
): Promise<{ error?: string }> {
  const { data, error } = await supabase
    .from('sos_automatizacion_config')
    .update({ activa, updated_at: new Date().toISOString(), updated_by: quien.id || null, updated_by_nombre: (quien.nombre ?? '').trim() || null })
    .eq('id', true)
    .select('activa');
  if (error) return { error: error.message };
  if (!data?.length) return { error: 'No se cambió: solo un administrador puede encender o apagar la automatización del Inspector SOS.' };
  return {};
}
