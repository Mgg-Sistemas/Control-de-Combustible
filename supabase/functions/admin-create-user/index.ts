// Edge Function: crear usuarios (solo administradores).
// Valida que quien llama sea admin (con su JWT) y usa la service_role key
// del entorno para crear el usuario y asignarle el rol. La service key NUNCA
// vive en la app cliente.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

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
    const caller = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: who } = await caller.auth.getUser();
    if (!who?.user) return json({ error: 'No autenticado' }, 401);
    const { data: prof } = await caller
      .from('profiles')
      .select('role')
      .eq('id', who.user.id)
      .single();
    if (prof?.role !== 'admin') {
      return json({ error: 'Solo un administrador puede crear usuarios' }, 403);
    }

    // 2) Datos de entrada
    const { first_name, last_name, password, role, cedula } = await req.json();
    if (!first_name?.trim() || !last_name?.trim() || !password) {
      return json({ error: 'Nombre, apellido y contraseña son obligatorios' }, 400);
    }
    if (String(password).length < 6) {
      return json({ error: 'La contraseña debe tener al menos 6 caracteres' }, 400);
    }
    const allowed = ['admin', 'supervisor', 'operador', 'conductor'];
    const finalRole = allowed.includes(role) ? role : 'conductor';
    const fullName = `${first_name.trim()} ${last_name.trim()}`;
    const email = `${slug(first_name)}.${slug(last_name)}@combustible.app`;

    // 3) Crear el usuario con la service key (auto-confirmado)
    const admin = createClient(url, service);
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, first_name: first_name.trim(), last_name: last_name.trim() },
    });
    if (error) {
      const dup = error.message.toLowerCase().includes('already');
      return json(
        { error: dup ? 'Ya existe un usuario con ese nombre y apellido' : error.message },
        400
      );
    }

    // 4) Asignar rol y nombre en el perfil
    await admin
      .from('profiles')
      .update({ role: finalRole, full_name: fullName, cedula: (cedula ?? '').toString().trim() || null })
      .eq('id', created.user.id);

    return json({ ok: true, id: created.user.id, email, role: finalRole });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
