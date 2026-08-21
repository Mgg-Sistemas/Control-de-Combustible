-- ============================================================================
-- EL PERMISO DE LA PERSONA LE GANA AL ROL — en la BASE DE DATOS.
--
-- 👉 CÓMO SE CORRE: copiar ESTE ARCHIVO COMPLETO, pegarlo en Supabase → SQL
--    Editor y darle RUN. Termina mostrando una tabla de verificación.
--
-- ⚠️ Editar este .sql NO lo aplica. Hay que correrlo a mano.
-- ✅ Es IDEMPOTENTE. NO toca ni una fila de datos: solo cambia reglas de acceso.
-- 🛟 Antes de cambiar nada GUARDA las políticas actuales en una tabla de
--    respaldo, para poder devolverlas tal cual (ver "DESHACER" al final).
--
-- QUÉ RESUELVE
-- ---------------------------------------------------------------------------
-- Pedido del cliente (21-ago-2026): «si yo le quito los permisos a alguien, no
-- importa el rol, se los pueda quitar y ya».
--
-- Hoy la regla de escritura del Catálogo es `is_staff()`, o sea el ROL:
--     admin · supervisor (inspector) · operador  → pueden escribir
--     analista · conductor · cocina · etc.       → no pueden
-- El nivel del módulo NO se mira en ningún lado. Por eso, poner a un INSPECTOR
-- o a un OPERADOR en "Lectura" en el Catálogo NO le quita nada: la base lo deja
-- registrar y modificar máquinas igual, porque su rol es staff. (En los demás
-- roles parecía funcionar, pero era el rol bloqueándolos, no el permiso.)
--
-- LA REGLA NUEVA
-- ---------------------------------------------------------------------------
--   1) Admin                         → siempre puede. Un admin no se limita con
--                                      un permiso: se le cambia el ROL. Así nadie
--                                      se deja fuera del sistema por accidente.
--   2) ¿Tiene fila en module_permissions para ese módulo?
--        SÍ  → MANDA ESA FILA, sin importar el rol.
--              'escritura' / 'full' → puede.   'lectura' / 'none' → NO puede.
--        NO  → se conserva el criterio de siempre (`is_staff()`).
--
-- O sea: quitarle el permiso a UNA persona ahora la bloquea de verdad, y a quien
-- nunca se le tocó el permiso no le cambia nada. No se le abre la puerta a nadie
-- que hoy no la tenga.
--
-- LO QUE NO SE TOCA
-- ---------------------------------------------------------------------------
--  · `machinery_anon_update`: el operador ANÓNIMO que escanea el QR sigue igual.
--    Es una política aparte y las políticas se suman (OR), así que el inspector
--    SOS y las jornadas automáticas NO se ven afectados.
--  · `is_staff()`, `is_admin()` y `can_write_module()` quedan como están: otras
--    tablas las usan y no se les cambia el significado.
--  · Los datos: ni un insert, ni un update, ni un delete.
-- ============================================================================


-- ── 1) RESPALDO DE LAS POLÍTICAS ACTUALES ───────────────────────────────────
-- Antes de tocar nada. Si algo sale mal, en "DESHACER" está cómo devolverlas.
create table if not exists public.rls_backup_20260821 (
  guardado_en timestamptz not null default now(),
  tabla       text,
  politica    text,
  cmd         text,
  expr_using  text,
  expr_check  text
);

insert into public.rls_backup_20260821 (tabla, politica, cmd, expr_using, expr_check)
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('machinery', 'vehicles')
  and not exists (
    select 1 from public.rls_backup_20260821 b
     where b.tabla = pg_policies.tablename and b.politica = pg_policies.policyname
  );


-- ── 2) LA REGLA ─────────────────────────────────────────────────────────────
-- Se llama distinto a `can_write_module` a propósito: esa función significa otra
-- cosa ("sin fila = puede", sin mirar el rol) y la usan Fabricación y Cuentas.
-- Cambiarla les movería el piso a esos módulos.
create or replace function public.permiso_manda_sobre_rol(mod text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare lvl text;
begin
  -- Los anónimos (QR) nunca entran por acá: tienen su propia política.
  if public.is_anon() then return false; end if;
  -- Un admin no se limita con un permiso; se le cambia el rol.
  if public.is_admin() then return true; end if;

  select mp.level into lvl
    from public.module_permissions mp
   where mp.user_id = auth.uid() and mp.module = mod
   limit 1;

  -- CON fila explícita: manda la fila, sin importar el rol. ⭐ Esto es lo nuevo.
  if lvl is not null then return lvl in ('escritura', 'full'); end if;

  -- SIN fila: exactamente como antes. A quien no se le tocó el permiso no le
  -- cambia nada, y no se le abre la puerta a ningún rol que hoy no la tenga.
  return public.is_staff();
end;
$$;

comment on function public.permiso_manda_sobre_rol(text) is
  'Escritura por módulo donde el permiso de la persona LE GANA al rol. Con fila en module_permissions manda la fila; sin fila, is_staff(). Admin siempre puede.';


-- ── 3) APLICARLA AL CATÁLOGO (maquinaria y vehículos) ───────────────────────
-- Son las dos tablas del módulo 'equipos'. `tanks` queda como está: es del
-- módulo 'tanques' y no es lo que se pidió.
drop policy if exists machinery_write on public.machinery;
create policy machinery_write on public.machinery for all to authenticated
  using (public.permiso_manda_sobre_rol('equipos'))
  with check (public.permiso_manda_sobre_rol('equipos'));

drop policy if exists vehicles_write on public.vehicles;
create policy vehicles_write on public.vehicles for all to authenticated
  using (public.permiso_manda_sobre_rol('equipos'))
  with check (public.permiso_manda_sobre_rol('equipos'));


-- ── 4) VERIFICACIÓN ─────────────────────────────────────────────────────────
-- Última instrucción del archivo: el resultado que queda en pantalla.
-- Los 5 primeros renglones tienen que decir ✅.
select chequeo, valor, case when ok then '✅' else '❌ REVISAR' end as estado
from (
  select 1 as n, 'La regla nueva existe' as chequeo,
         coalesce((select 'sí' from pg_proc
                    where proname = 'permiso_manda_sobre_rol'
                      and pronamespace = 'public'::regnamespace limit 1), 'NO') as valor,
         exists (select 1 from pg_proc where proname = 'permiso_manda_sobre_rol'
                  and pronamespace = 'public'::regnamespace) as ok
  union all
  select 2, 'Maquinaria ya NO escribe solo por el rol',
         coalesce((select qual from pg_policies
                    where schemaname = 'public' and tablename = 'machinery'
                      and policyname = 'machinery_write'), '—'),
         coalesce((select qual from pg_policies
                    where schemaname = 'public' and tablename = 'machinery'
                      and policyname = 'machinery_write'), '') like '%permiso_manda_sobre_rol%'
  union all
  select 3, 'Vehículos ya NO escriben solo por el rol',
         coalesce((select qual from pg_policies
                    where schemaname = 'public' and tablename = 'vehicles'
                      and policyname = 'vehicles_write'), '—'),
         coalesce((select qual from pg_policies
                    where schemaname = 'public' and tablename = 'vehicles'
                      and policyname = 'vehicles_write'), '') like '%permiso_manda_sobre_rol%'
  union all
  -- El QR del operador anónimo TIENE que seguir ahí. Si esto dice ❌, las
  -- jornadas por QR dejarían de guardarse: hay que deshacer y avisar.
  select 4, '⭐ El QR anónimo sigue intacto (jornadas del inspector)',
         coalesce((select 'sí' from pg_policies
                    where schemaname = 'public' and tablename = 'machinery'
                      and policyname = 'machinery_anon_update' limit 1), 'NO'),
         exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'machinery'
                    and policyname = 'machinery_anon_update')
  union all
  select 5, 'Respaldo de las políticas viejas guardado',
         (select count(*) from public.rls_backup_20260821)::text,
         (select count(*) from public.rls_backup_20260821) > 0
  union all
  -- CONTROL: este script NO toca datos. Mismo número antes y después.
  select 6, 'Máquinas en la base (este script NO las toca)',
         (select count(*) from public.machinery)::text, true
  union all
  select 7, 'Personas con permiso EXPLÍCITO en el Catálogo (a estas les manda su permiso)',
         (select count(*) from public.module_permissions where module = 'equipos')::text, true
  union all
  select 8, '  · de esas, cuántas quedan SIN poder escribir',
         (select count(*) from public.module_permissions
           where module = 'equipos' and level in ('lectura', 'none'))::text, true
) t order by n;


-- ============================================================================
-- DESHACER (solo si hay que revertir). Descomentar y correr aparte.
-- Devuelve las dos políticas al criterio viejo (solo el rol).
-- ============================================================================
-- drop policy if exists machinery_write on public.machinery;
-- create policy machinery_write on public.machinery for all to authenticated
--   using (public.is_staff()) with check (public.is_staff());
-- drop policy if exists vehicles_write on public.vehicles;
-- create policy vehicles_write on public.vehicles for all to authenticated
--   using (public.is_staff()) with check (public.is_staff());
-- -- El texto exacto de las políticas originales quedó en:
-- -- select * from public.rls_backup_20260821;
