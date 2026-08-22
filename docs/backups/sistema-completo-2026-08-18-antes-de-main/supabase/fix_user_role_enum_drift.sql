-- Corrige deriva de esquema: el valor 'coordinador_patio' del enum public.user_role
-- se usa en el código (src/types/database.ts, supabase/functions/admin-create-user)
-- pero nunca quedó registrado en schema.sql con un "alter type ... add value".
-- Es probable que se haya agregado manualmente en producción. Este archivo lo
-- deja versionado de forma idempotente (no falla si el tipo no existe con ese
-- nombre exacto o si el valor ya fue agregado antes).
do $$ begin
  alter type public.user_role add value if not exists 'coordinador_patio';
exception when others then null; end $$;
