// Control de asistencia por carnet: marca ENTRADA/SALIDA de un empleado.
// La lógica vive aquí (una sola fuente) y la usan la pantalla y el reporte.
import { supabase } from './supabase';
import { caracasParts } from './jornada';
import { Attendance } from '../types/database';

export type MarkResult =
  | { ok: true; kind: 'entrada' | 'salida'; ts: string; workDate: string }
  | { ok: false; error: string };

/** Marca la asistencia del empleado DECIDIENDO sola si es entrada o salida:
 *  si su última marca de HOY fue "entrada" → registra SALIDA; en cualquier otro
 *  caso (sin marcas o última "salida") → registra ENTRADA. Guarda fecha+hora Caracas. */
export async function markAttendance(employeeId: string, recordedBy: string | null): Promise<MarkResult> {
  if (!employeeId) return { ok: false, error: 'Sin empleado.' };
  const now = new Date();
  const { iso } = caracasParts(now);

  // Última marca de HOY (para alternar entrada/salida).
  const { data: last, error: eLast } = await supabase
    .from('attendance')
    .select('kind')
    .eq('employee_id', employeeId)
    .eq('work_date', iso)
    .order('ts', { ascending: false })
    .limit(1);
  if (eLast) return { ok: false, error: eLast.message };

  const lastKind = (last && (last[0] as any)?.kind) ?? null;
  const kind: 'entrada' | 'salida' = lastKind === 'entrada' ? 'salida' : 'entrada';

  const { error } = await supabase.from('attendance').insert({
    employee_id: employeeId, ts: now.toISOString(), work_date: iso, kind, recorded_by: recordedBy,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, kind, ts: now.toISOString(), workDate: iso };
}

/** ¿Cuál sería la PRÓXIMA marca según la última de hoy? (para el botón inteligente). */
export function nextKind(lastKindToday: 'entrada' | 'salida' | null): 'entrada' | 'salida' {
  return lastKindToday === 'entrada' ? 'salida' : 'entrada';
}

export type Pair = { in: string; out: string | null; minutes: number };

/** Empareja marcas ORDENADAS por hora en pares entrada→salida.
 *  Una entrada sin salida queda "abierta" (out=null, minutes=0). Marcas de salida
 *  sueltas (sin entrada previa) se ignoran para el cálculo de horas. */
export function pairMarks(marks: Pick<Attendance, 'kind' | 'ts'>[]): { pairs: Pair[]; totalMinutes: number; open: boolean } {
  const ordered = [...marks].sort((a, b) => a.ts.localeCompare(b.ts));
  const pairs: Pair[] = [];
  let openIn: string | null = null;
  for (const m of ordered) {
    if (m.kind === 'entrada') {
      if (openIn == null) openIn = m.ts;         // abre un par
      // dos entradas seguidas: se conserva la primera (no se pierde tiempo).
    } else { // salida
      if (openIn != null) {
        const mins = Math.max(0, Math.round((new Date(m.ts).getTime() - new Date(openIn).getTime()) / 60000));
        pairs.push({ in: openIn, out: m.ts, minutes: mins });
        openIn = null;
      }
    }
  }
  let open = false;
  if (openIn != null) { pairs.push({ in: openIn, out: null, minutes: 0 }); open = true; }
  const totalMinutes = pairs.reduce((s, p) => s + p.minutes, 0);
  return { pairs, totalMinutes, open };
}

/** minutos → "8h 05m" (o "0m"). */
export function fmtDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h ? `${h}h ${String(mm).padStart(2, '0')}m` : `${mm}m`;
}

/** Hora "HH:MM" (Caracas) de un instante ISO. */
export function fmtHora(ts: string): string {
  return new Date(ts).toLocaleTimeString('es-VE', { timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit', hour12: true });
}
