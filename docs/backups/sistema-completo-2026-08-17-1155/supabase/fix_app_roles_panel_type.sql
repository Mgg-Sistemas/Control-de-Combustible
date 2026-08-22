-- FIX: crear un rol fallaba con "column app_roles.panel_type does not exist".
-- La app inserta panel_type al crear el rol, pero esa columna nunca se agregó en
-- producción. Esto la agrega (idempotente). Correr una sola vez en Supabase.
alter table public.app_roles
  add column if not exists panel_type text not null default 'modulos';
