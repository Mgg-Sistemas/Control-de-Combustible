// Edge Function: editar / eliminar usuarios (solo administradores).
// Valida que quien llama sea admin (con su JWT) y usa la service_role key
// del entorno para actualizar la contraseña/nombre o eliminar al usuario.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization') ?? '';

    // 1) Validar que quien llama es admin (usando su propio token)
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: who } = await caller.auth.getUser();
    if (!who?.user) return json({ error: 'No autenticado' }, 401);
    const { data: prof } = await caller.from('profiles').select('role').eq('id', who.user.id).single();
    if (prof?.role !== 'admin') {
      return json({ error: 'Solo un administrador puede gestionar usuarios' }, 403);
    }

    // 2) Datos de entrada
    const { action, id, full_name, password } = await req.json();
    if (!id) return json({ error: 'Falta el id del usuario' }, 400);

    const admin = createClient(url, service);

    if (action === 'delete') {
      if (id === who.user.id) return json({ error: 'No puedes eliminar tu propio usuario' }, 400);
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === 'update') {
      if (password) {
        if (String(password).length < 6) {
          return json({ error: 'La contraseña debe tener al menos 6 caracteres' }, 400);
        }
        const { error } = await admin.auth.admin.updateUserById(id, { password });
        if (error) return json({ error: error.message }, 400);
      }
      if (typeof full_name === 'string' && full_name.trim()) {
        await admin.auth.admin.updateUserById(id, { user_metadata: { full_name: full_name.trim() } });
        await admin.from('profiles').update({ full_name: full_name.trim() }).eq('id', id);
      }
      return json({ ok: true });
    }

    return json({ error: 'Acción no válida' }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
