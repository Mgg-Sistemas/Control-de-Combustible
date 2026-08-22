// Crea una notificación IN-APP (campana) para los ADMIN desde el cliente. La RLS
// (notif_insert) permite insertar a staff (admin/supervisor/operador); el inspector
// es rol 'supervisor', así que puede. Nunca lanza: si falla (permiso/tabla), no
// interrumpe el flujo del usuario (el aviso es secundario, igual queda en auditoría).
import { supabase } from './supabase';

export async function notifyAdmins(
  type: string,
  title: string,
  body?: string | null,
  meta?: Record<string, any>
): Promise<void> {
  try {
    const { data: s } = await supabase.auth.getSession();
    const createdBy = s.session?.user?.id ?? null;
    await supabase.from('notifications').insert({
      type,
      title,
      body: body ?? null,
      target_role: 'admin',
      created_by: createdBy,
      meta: meta ?? {},
    });
  } catch {
    // Silencioso a propósito.
  }
}
