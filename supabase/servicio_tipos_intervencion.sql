-- ============================================================================
-- SERVICIO DE MAQUINARIA — TIPOS DE INTERVENCIÓN ADMINISTRABLES.
--
-- 👉 CÓMO SE CORRE: copiar ESTE ARCHIVO COMPLETO, pegarlo en Supabase → SQL
--    Editor y darle RUN una sola vez. Es UN SOLO BLOQUE: crea, siembra, permisos,
--    auditoría y termina mostrando UNA tabla de verificación. No hay que correr
--    nada aparte ni en ningún orden especial.
--
-- ⚠️ Editar este .sql NO lo aplica. Hay que correrlo a mano.
-- ✅ Es IDEMPOTENTE: se puede volver a correr sin duplicar nada y sin tocar un
--    solo servicio ya guardado.
--
-- QUÉ RESUELVE
-- ---------------------------------------------------------------------------
-- «2. TIPO DE INTERVENCIÓN» del formulario de Servicio eran CUATRO opciones
-- escritas a mano en el código: Mecánica, Electricidad, Mangueras / Hidráulica y
-- Servicio. Para agregar «Soldadura» había que tocar el programa y republicar.
-- Pedido del cliente (20-ago-2026): «dame una opción para crear, borrar o
-- modificar los tipos de intervenciones». Esta tabla es ese catálogo; se
-- administra desde 🧾 Servicios → «⚙️ Tipos de intervención».
--
-- CÓMO SE GUARDA EN LOS SERVICIOS
-- ---------------------------------------------------------------------------
-- `machinery_service_orders.intervenciones` es un arreglo de TEXTO con las CLAVES
-- (`{mecanica,mangueras}`). NO hay llave foránea contra esta tabla y NO se le pone
-- a propósito: así agregar, renombrar o desactivar un tipo nunca puede romper ni
-- bloquear un servicio ya guardado.
--
-- ⚠️ BORRAR = DESACTIVAR. NUNCA `delete` FÍSICO.
-- ---------------------------------------------------------------------------
-- «Borrar» un tipo en la app pone `active = false` y nada más. Si se borrara la
-- fila de verdad, los servicios viejos que guardaron esa clave se quedarían SIN
-- NOMBRE: en la tarjeta y en el PDF saldría la clave cruda («soldadura» en vez de
-- «Soldadura»), porque el nombre vive únicamente aquí. Por eso NO hay política de
-- DELETE más abajo.
--
-- MIENTRAS NO SE CORRA: la app sigue funcionando igual. La pantalla consulta esta
-- tabla dentro de un try/catch y, si no existe, cae sin ruido a los cuatro tipos
-- de siempre. Lo único que no se puede es agregar tipos nuevos.
-- ============================================================================

-- ── 1) LA TABLA ─────────────────────────────────────────────────────────────
create table if not exists public.service_intervention_types (
  id         uuid primary key default gen_random_uuid(),
  -- La clave que se guarda dentro de `machinery_service_orders.intervenciones`.
  -- Minúsculas, sin espacios ni acentos (la app la genera desde el nombre).
  key        text not null unique,
  -- El nombre que ve la gente. Este SÍ se puede cambiar cuando se quiera: los
  -- servicios viejos guardan la clave, así que renombrar no los toca.
  label      text not null,
  -- Orden de las casillas en el formulario. Menor = primero.
  sort_order int not null default 100,
  -- false = «borrado» (desactivado). Ver la advertencia del encabezado.
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Por si la tabla quedó a medias de una corrida anterior.
alter table public.service_intervention_types add column if not exists sort_order int not null default 100;
alter table public.service_intervention_types add column if not exists active boolean not null default true;
alter table public.service_intervention_types add column if not exists created_at timestamptz not null default now();

create index if not exists service_intervention_types_orden_idx
  on public.service_intervention_types (sort_order, label);


-- ── 2) LOS CUATRO DE SIEMPRE ────────────────────────────────────────────────
-- `on conflict do nothing`: si ya están (o alguien los renombró), NO se pisan.
insert into public.service_intervention_types (key, label, sort_order) values
  ('mecanica',     'Mecánica',               10),
  ('electricidad', 'Electricidad',           20),
  ('mangueras',    'Mangueras / Hidráulica', 30),
  ('servicio',     'Servicio',               40)
on conflict (key) do nothing;


-- ── 3) RLS Y PERMISOS ───────────────────────────────────────────────────────
-- Mismo criterio que `hose_services.sql` y `servicio_maquinaria_tabla_propia.sql`:
-- a nivel de base cualquier usuario AUTENTICADO lee y escribe; quién puede
-- administrar el catálogo lo decide el permiso de módulo en la app, que es el que
-- hace aparecer (o no) el botón «⚙️ Tipos de intervención».
--
-- SIN política de DELETE a propósito: acá no se borra, se desactiva.
alter table public.service_intervention_types enable row level security;

drop policy if exists service_intervention_types_select on public.service_intervention_types;
create policy service_intervention_types_select on public.service_intervention_types
  for select to authenticated using (true);

drop policy if exists service_intervention_types_insert on public.service_intervention_types;
create policy service_intervention_types_insert on public.service_intervention_types
  for insert to authenticated with check (true);

drop policy if exists service_intervention_types_update on public.service_intervention_types;
create policy service_intervention_types_update on public.service_intervention_types
  for update to authenticated using (true) with check (true);

grant select, insert, update on public.service_intervention_types to authenticated;


-- ── 4) AUDITORÍA ────────────────────────────────────────────────────────────
-- Mismo trigger genérico que el resto de las tablas (ver `audit.sql`): deja
-- constancia de quién creó, renombró o desactivó un tipo. Dentro de un `if` para
-- no fallar si todavía no se corrió `audit.sql`.
do $$
begin
  if to_regclass('public.audit_log') is not null and exists (
    select 1 from pg_proc where proname = 'audit_row' and pronamespace = 'public'::regnamespace
  ) then
    execute 'drop trigger if exists trg_audit on public.service_intervention_types';
    execute 'create trigger trg_audit after insert or update or delete on public.service_intervention_types for each row execute function public.audit_row()';
  end if;
end $$;


-- ── 5) VERIFICACIÓN ─────────────────────────────────────────────────────────
-- Última instrucción del archivo: el resultado que queda en pantalla al terminar.
-- Todo tiene que decir ✅. Si algo dice ❌, NO se aplicó bien.
select chequeo, valor,
       case when ok then '✅' else '❌ REVISAR' end as estado
from (
  select 1 as n, 'Tabla creada' as chequeo,
         coalesce(to_regclass('public.service_intervention_types')::text, 'no existe') as valor,
         to_regclass('public.service_intervention_types') is not null as ok
  union all
  select 2, 'Tipos en el catálogo (mínimo 4)',
         (select count(*) from public.service_intervention_types)::text,
         (select count(*) from public.service_intervention_types) >= 4
  union all
  select 3, 'Los 4 de siempre están',
         (select count(*) from public.service_intervention_types
           where key in ('mecanica','electricidad','mangueras','servicio'))::text,
         (select count(*) from public.service_intervention_types
           where key in ('mecanica','electricidad','mangueras','servicio')) = 4
  union all
  select 4, 'RLS activo',
         (select relrowsecurity from pg_class where oid = 'public.service_intervention_types'::regclass)::text,
         (select relrowsecurity from pg_class where oid = 'public.service_intervention_types'::regclass)
  union all
  select 5, 'Políticas select/insert/update (deben ser 3)',
         (select count(*) from pg_policies
           where schemaname = 'public' and tablename = 'service_intervention_types')::text,
         (select count(*) from pg_policies
           where schemaname = 'public' and tablename = 'service_intervention_types') = 3
  union all
  select 6, 'SIN política de DELETE (debe ser 0)',
         (select count(*) from pg_policies
           where schemaname = 'public' and tablename = 'service_intervention_types' and cmd = 'DELETE')::text,
         (select count(*) from pg_policies
           where schemaname = 'public' and tablename = 'service_intervention_types' and cmd = 'DELETE') = 0
  union all
  select 7, 'Trigger de auditoría',
         (select count(*) from pg_trigger
           where tgrelid = 'public.service_intervention_types'::regclass and not tgisinternal)::text,
         (select count(*) from pg_trigger
           where tgrelid = 'public.service_intervention_types'::regclass and not tgisinternal) >= 1
  union all
  -- CONTROL: los servicios ya guardados NO se tocaron. Este número tiene que ser
  -- el mismo antes y después de correr el script.
  select 8, 'Servicios guardados (este script NO los toca)',
         (select count(*) from public.machinery_service_orders)::text,
         true
) t
order by n;


-- ============================================================================
-- DESHACER (solo si hay que revertir). Descomentar y correr aparte.
-- Borra el catálogo. NO toca `machinery_service_orders`: los servicios guardados
-- conservan sus claves y la app vuelve sola a los cuatro tipos de siempre.
-- ============================================================================
-- drop table if exists public.service_intervention_types cascade;
