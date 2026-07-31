// Registro de EVENTOS de la app en la bitácora de Auditoría (login, escaneo de
// QR, inicio/fin de jornada, parada). Estos eventos NO escriben en una tabla de
// negocio, así que los triggers no los ven: los mandamos con la función
// audit_event(...) de la BD (SECURITY DEFINER). Nunca lanza: si falla, no rompe
// el flujo del usuario (la auditoría es secundaria).
import { supabase } from './supabase';
import { deviceLabel } from './device';

export type AuditAction = 'LOGIN' | 'LOGOUT' | 'SCAN' | 'CHECK' | 'JORNADA_INICIO' | 'JORNADA_FIN' | 'PARADA';

export async function logAudit(
  action: AuditAction,
  tableName: string,
  rowId: string | null,
  detail?: string | null
): Promise<void> {
  try {
    await supabase.rpc('audit_event', {
      p_action: action,
      p_table_name: tableName,
      p_row_id: rowId,
      p_detail: detail ?? null,
      p_device: deviceLabel(), // 📱 teléfono / 💻 PC — para saber desde dónde se hizo
    });
  } catch {
    // Silencioso a propósito: no debe interrumpir la acción del usuario.
  }
}
