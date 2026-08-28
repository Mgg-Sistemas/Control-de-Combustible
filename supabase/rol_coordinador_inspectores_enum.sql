-- ============================================================================
-- ROL «COORDINADOR DE INSPECTORES» · REGISTRARLO EN EL ENUM  —  27-ago-2026
--
-- POR QUÉ EXISTE ESTE ARCHIVO
-- ---------------------------------------------------------------------------
-- El 7-ago-2026 (commit 04cafb88) se agregó el rol `coordinador_inspectores` al
-- código —`src/lib/permissions.ts`, `src/types/database.ts`, el ruteo y la
-- pantalla de Usuarios— pero NUNCA se agregó al enum `public.user_role` en
-- ningún .sql versionado. Es la MISMA deriva que ya ocurrió con
-- 'coordinador_patio' en julio (ver `fix_user_role_enum_drift.sql`).
--
-- Si el valor falta en la base, cualquier intento de ponerle ese rol a alguien
-- falla con «invalid input value for enum user_role», y como el UPDATE que hace
-- la Edge Function `admin-create-user` se tragaba el error, el usuario quedaba
-- con el 'conductor' que le pone el trigger `handle_new_user` — y abría en la
-- pantalla de Surtir ⛽ como si fuera chofer. Ese es el bug que reportó el
-- cliente el 27-ago-2026.
--
-- ⚠️ ES MUY PROBABLE QUE EN PRODUCCIÓN YA ESTÉ. El cliente dice que EDITANDO al
--    usuario sí puede ponerle el rol, y ese camino escribe directo en `profiles`:
--    si el valor no existiera, esa edición también fallaría. O sea: esto
--    seguramente ya se agregó a mano y lo único que falta es dejarlo versionado.
--    El BLOQUE 1 te lo dice sin cambiar nada.
--
-- ⚠️ HAY QUE CORRERLO A MANO. Editar este .sql NO lo aplica.
-- ⚠️ CÓRRELO POR BLOQUES, no todo de un golpe: `alter type ... add value` y el
--    uso posterior del valor no se llevan bien dentro de una misma transacción.
--
-- No borra nada, no toca datos, no modifica ninguna tabla. Solo puede AGREGAR un
-- valor a un tipo, y agregar un valor a un enum no afecta a ninguna fila que ya
-- exista.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 1 · DIAGNÓSTICO   ✅ SOLO LEE, no cambia nada
-- ════════════════════════════════════════════════════════════════════════════
-- Corre esto PRIMERO.
--   · Si `ya_esta` sale true  → no hace falta nada más. Cierra el archivo.
--   · Si sale false           → sigue al bloque 2.
select
  exists (
    select 1 from pg_enum
    where enumtypid = 'public.user_role'::regtype
      and enumlabel = 'coordinador_inspectores'
  )                                                                as ya_esta,
  (select string_agg(enumlabel, ', ' order by enumsortorder)
     from pg_enum where enumtypid = 'public.user_role'::regtype)   as roles_que_existen_hoy,
  (select count(*) from public.profiles
    where role::text = 'coordinador_inspectores')                  as personas_con_ese_rol;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 2 · AGREGAR EL VALOR   ⚠️ MODIFICA UN TIPO (no toca datos)
-- ════════════════════════════════════════════════════════════════════════════
-- Idempotente y a prueba de fallos, igual que `fix_user_role_enum_drift.sql`:
-- si ya está, o si el tipo no se llama así, no hace nada y no revienta.
do $$ begin
  alter type public.user_role add value if not exists 'coordinador_inspectores';
exception when others then null; end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 3 · VERIFICACIÓN   ✅ SOLO LEE
-- ════════════════════════════════════════════════════════════════════════════
-- Corre esto DESPUÉS. `quedo_registrado` TIENE que dar true.
select
  exists (
    select 1 from pg_enum
    where enumtypid = 'public.user_role'::regtype
      and enumlabel = 'coordinador_inspectores'
  )                                                                as quedo_registrado,
  (select string_agg(enumlabel, ', ' order by enumsortorder)
     from pg_enum where enumtypid = 'public.user_role'::regtype)   as roles_ahora;


-- ════════════════════════════════════════════════════════════════════════════
-- LO QUE ESTE ARCHIVO **NO** ARREGLA
-- ════════════════════════════════════════════════════════════════════════════
-- El bug del rol tenía dos mitades y esta es solo una. La otra vive en la Edge
-- Function `supabase/functions/admin-create-user/index.ts`, cuya lista blanca
-- `allowed` degradaba a 'conductor' cualquier rol que no reconociera. Ya está
-- corregida en el repositorio, pero **la Edge Function no se publica con el CI**:
--
--     supabase functions deploy admin-create-user
--
-- Mientras no se despliegue, el arreglo del lado de la app
-- (`src/screens/UsersScreen.tsx`, que ahora reenvía el rol después de crear)
-- es el que sostiene el comportamiento correcto.
