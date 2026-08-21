-- ============================================================================
-- SERVICIO DE MAQUINARIA — TIPOS DE INTERVENCIÓN ADMINISTRABLES.
--
-- QUÉ RESUELVE
-- ---------------------------------------------------------------------------
-- Hasta hoy, «2. TIPO DE INTERVENCIÓN» del formulario de Servicio eran CUATRO
-- opciones escritas a mano en el código (`src/lib/machineService.ts`):
-- Mecánica, Electricidad, Mangueras / Hidráulica y Servicio. Para agregar
-- «Soldadura» o «Aire acondicionado» había que tocar el programa y volver a
-- publicar la app.
--
-- Pedido del cliente (20-ago-2026): «para ese reporte, el tipo de intervención,
-- dame una opción para crear, borrar o modificar los tipos de intervenciones».
--
-- Esta tabla es ese catálogo. La pantalla 🧾 Servicios lo administra desde el
-- botón «⚙️ Tipos de intervención» (solo quien tiene permiso de escritura en el
-- módulo).
--
-- CÓMO SE GUARDA EN LOS SERVICIOS (importante)
-- ---------------------------------------------------------------------------
-- `machinery_service_orders.intervenciones` es un arreglo de TEXTO con las
-- CLAVES (`{mecanica,mangueras}`), NO hay llave foránea contra esta tabla y NO
-- se le pone a propósito: así agregar, renombrar o desactivar un tipo nunca
-- puede romper ni bloquear un servicio ya guardado.
--
-- ⚠️ BORRAR = DESACTIVAR. NUNCA `delete` FÍSICO.
-- ---------------------------------------------------------------------------
-- Por eso mismo, «borrar» un tipo en la app pone `active = false` y nada más.
-- Si se borrara la fila de verdad, los servicios viejos que guardaron esa clave
-- se quedarían SIN NOMBRE: en la tarjeta y en el PDF saldría la clave cruda
-- («soldadura» en vez de «Soldadura»), porque el nombre vive únicamente aquí.
-- Desactivado, el tipo desaparece del formulario (ya nadie lo puede marcar) pero
-- su nombre sigue disponible para los registros históricos. Esa es la razón de
-- que NO haya política de DELETE más abajo.
--
-- ⚠️ HAY QUE CORRERLO A MANO
-- ---------------------------------------------------------------------------
-- Editar este .sql NO lo aplica. Abrir Supabase → SQL Editor, pegar el archivo
-- completo, ejecutarlo, y después correr el bloque 6 (VERIFICACIÓN).
-- Es idempotente: se puede volver a correr sin romper nada y sin duplicar los
-- cuatro tipos de siempre.
--
-- MIENTRAS NO SE CORRA: la app sigue funcionando igual. La pantalla consulta
-- esta tabla dentro de un try/catch y, si no existe, cae sin ruido a los cuatro
-- tipos de siempre (`INTERVENCIONES_POR_DEFECTO`). Lo único que no se puede
-- hacer es agregar tipos nuevos: el modal lo dice con todas sus letras.
-- ============================================================================


-- ── 1) LA TABLA ─────────────────────────────────────────────────────────────
create table if not exists public.service_intervention_types (
  id         uuid primary key default gen_random_uuid(),

  -- La clave que se guarda dentro de `machinery_service_orders.intervenciones`.
  -- Minúsculas, sin espacios ni acentos (la app la genera desde el nombre).
  -- ÚNICA: dos tipos con la misma clave serían el mismo tipo.
  key        text not null unique,

  -- El nombre que ve la gente. Este SÍ se puede cambiar cuando se quiera: los
  -- servicios viejos guardan la clave, así que renombrar no los toca.
  label      text not null,

  -- Orden en que salen las casillas del formulario. Menor = primero.
  sort_order int not null default 100,

  -- false = «borrado» (desactivado): no sale más en el formulario, pero su
  -- nombre sigue sirviendo para los servicios que ya lo usaron. Ver la
  -- advertencia del encabezado.
  active     boolean not null default true,

  created_at timestamptz not null default now()
);

-- Por si la tabla ya existía de una corrida previa incompleta.
alter table public.service_intervention_types add column if not exists sort_order int not null default 100;
alter table public.service_intervention_types add column if not exists active boolean not null default true;
alter table public.service_intervention_types add column if not exists created_at timestamptz not null default now();


-- ── 2) ÍNDICE DEL LISTADO ───────────────────────────────────────────────────
create index if not exists service_intervention_types_orden_idx
  on public.service_intervention_types (sort_order, label);


-- ── 3) LOS CUATRO DE SIEMPRE ────────────────────────────────────────────────
-- Exactamente los que tenía el formulario en papel. `on conflict (key) do
-- nothing`: si ya están (o alguien los renombró), NO se pisan.
insert into public.service_intervention_types (key, label, sort_order) values
  ('mecanica',     'Mecánica',              10),
  ('electricidad', 'Electricidad',          20),
  ('mangueras',    'Mangueras / Hidráulica', 30),
  ('servicio',     'Servicio',              40)
on conflict (key) do nothing;


-- ── 4) RLS Y PERMISOS ───────────────────────────────────────────────────────
-- Mismo criterio que `hose_services.sql` y `servicio_maquinaria_tabla_propia.sql`:
-- a nivel de base de datos cualquier usuario AUTENTICADO lee y escribe; el
-- control real de quién puede administrar el catálogo es el permiso de módulo
-- de Servicio de maquinaria en la app (`src/lib/permissions.ts`), que es el que
-- decide si el botón «⚙️ Tipos de intervención» aparece siquiera.
--
-- SIN política de DELETE a propósito: acá no se borra, se desactiva (ver el
-- encabezado). Aunque alguien intentara un `delete` desde afuera, la RLS lo para.
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


-- ── 5) AUDITORÍA ────────────────────────────────────────────────────────────
-- Mismo trigger genérico que el resto de las tablas (ver `audit.sql`): deja
-- constancia de quién creó, renombró o desactivó un tipo. Envuelto en el mismo
-- `if` que usa `inspections.sql` para no fallar si todavía no se corrió
-- `audit.sql` en este proyecto.
do $$
begin
  if to_regclass('public.audit_log') is not null and exists (
    select 1 from pg_proc where proname = 'audit_row' and pronamespace = 'public'::regnamespace
  ) then
    execute 'drop trigger if exists trg_audit on public.service_intervention_types';
    execute 'create trigger trg_audit after insert or update or delete on public.service_intervention_types for each row execute function public.audit_row()';
  end if;
end $$;


-- ============================================================================
-- 6) VERIFICACIÓN — correr DESPUÉS de aplicar el script.
-- ============================================================================

-- 6.1 · Las columnas quedaron como se esperan.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'service_intervention_types'
order by ordinal_position;

-- 6.2 · Los cuatro de siempre están (deben salir 4 filas, todas active = true).
select key, label, sort_order, active
from public.service_intervention_types
order by sort_order, label;

-- 6.3 · La clave es única (el índice `..._key_key` del unique debe aparecer).
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'service_intervention_types'
order by indexname;

-- 6.4 · RLS activo y las tres políticas (select/insert/update, NINGUNA de delete).
select relrowsecurity as rls_activo
from pg_class where oid = 'public.service_intervention_types'::regclass;

select policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'service_intervention_types'
order by policyname;

-- 6.5 · El trigger de auditoría quedó (1 fila si ya se corrió `audit.sql`).
select tgname from pg_trigger
where tgrelid = 'public.service_intervention_types'::regclass and not tgisinternal;

-- 6.6 · CONTROL: los servicios ya guardados NO se tocaron. Este listado muestra
--       qué claves usan de verdad los servicios y si el catálogo las conoce.
--       Cualquier clave con `en_catalogo = false` seguirá mostrándose cruda:
--       agrégala al catálogo con su nombre bonito si quieres verla completa.
select k.clave,
       count(*) as servicios,
       exists (select 1 from public.service_intervention_types t where t.key = k.clave) as en_catalogo
from public.machinery_service_orders o
cross join lateral unnest(coalesce(o.intervenciones, '{}')) as k(clave)
group by k.clave
order by servicios desc;


-- ============================================================================
-- 7) DESHACER (rollback manual) — descomentar y correr SOLO si hay que revertir.
--    Borra el catálogo. NO toca `machinery_service_orders`: los servicios
--    guardados conservan sus claves y la app vuelve sola a los cuatro tipos de
--    siempre (los que no estén entre esos cuatro se verán con la clave cruda).
-- ============================================================================
-- drop table if exists public.service_intervention_types cascade;
