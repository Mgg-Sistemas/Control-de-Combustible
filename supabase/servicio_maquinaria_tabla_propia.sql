-- ============================================================================
-- SERVICIO DE MAQUINARIA — TABLA PROPIA (desacople de Inspecciones).
--
-- POR QUÉ EXISTE ESTE ARCHIVO
-- ---------------------------------------------------------------------------
-- Hoy el taller (`src/screens/MantenimientoMaquinariaScreen.tsx`) NO tiene tabla
-- propia de estado: escribe en las MISMAS filas de `maintenance_requests` y en
-- las MISMAS banderas `machinery.operational` / `machinery.en_espera` que el
-- módulo de Inspecciones usa como FUENTE DE VERDAD. Resultado: cuando el taller
-- marca algo como "realizado" o "envía a reparación", cierra tickets de los
-- inspectores y cambia el estado de la máquina a espaldas de Inspecciones. Eso
-- contamina el panel de Inspecciones y descuadra los reportes por turno.
--
-- Este script crea `public.servicio_registros`, el estado PROPIO de Servicio,
-- para que el flujo quede en UN SOLO SENTIDO:
--
--   Inspecciones  ──(solo lectura)──▶  Servicio de Maquinaria
--                 ◀──── NADA ─────
--
--   • Servicio LEE las averías que reportan los inspectores
--     (`maintenance_requests`) para saber qué hay que atender.
--   • Servicio NO escribe de vuelta: ni a `maintenance_requests`, ni a
--     `machinery`, ni a nada de Inspecciones.
--   • Quien tenga permiso puede AGREGAR y EDITAR averías dentro de Servicio
--     (una falla lleva a otra: el taller descubre cosas que el inspector no vio).
--   • Marcar "realizado" deja SOLO UN REGISTRO aquí (estado + qué se hizo +
--     quién y cuándo). NO cierra el ticket del inspector y NO toca el estado
--     operativo de la máquina.
--   • Se elimina el flujo "enviar a reparación" (era justamente el que ponía
--     `machinery.operational = false` y pisaba a Inspecciones).
--
-- QUÉ **NO** HACE ESTE SCRIPT (a propósito)
-- ---------------------------------------------------------------------------
--   • NO altera ninguna tabla existente. Cero ALTER sobre `maintenance_requests`
--     y cero ALTER sobre `machinery`. Solo CREATE de lo nuevo.
--   • NO migra ni borra datos históricos. Lo viejo queda como está.
--
-- ⚠️ HAY QUE CORRERLO A MANO
-- ---------------------------------------------------------------------------
-- Editar este .sql NO lo aplica. Abrir Supabase → SQL Editor, pegar el archivo
-- completo, ejecutarlo, y DESPUÉS correr el bloque 6 (VERIFICACIÓN) para
-- confirmar que la tabla, los índices, las políticas y el realtime quedaron.
-- Es idempotente: se puede volver a correr sin romper nada.
-- ============================================================================


-- ── 1) TABLA PROPIA DE SERVICIO ─────────────────────────────────────────────
-- Un registro = una avería/trabajo que Servicio gestiona. Puede haber nacido
-- de un ticket de inspector (origen = 'inspector', espejo de solo lectura del
-- ticket) o haberla creado el taller (origen = 'taller').
create table if not exists public.servicio_registros (
  id                uuid primary key default gen_random_uuid(),

  -- máquina del catálogo a la que pertenece el trabajo
  machinery_id      uuid not null references public.machinery(id) on delete cascade,

  -- de dónde salió el registro:
  --   'taller'    → la creó alguien dentro de Servicio
  --   'inspector' → espejo de una avería reportada en Inspecciones
  origen            text not null default 'taller'
                    check (origen in ('taller', 'inspector')),

  -- el ticket de Inspecciones que originó este registro, si aplica.
  -- ON DELETE SET NULL: si el ticket se borra allá, el trabajo de taller
  -- sobrevive (queda huérfano pero NO se pierde el historial de Servicio).
  -- Ojo: esta FK es SOLO trazabilidad; Servicio nunca escribe en esa tabla.
  source_request_id uuid references public.maintenance_requests(id) on delete set null,

  -- qué está fallando (obligatorio; en los espejos se copia del ticket)
  descripcion       text not null,

  -- observaciones libres del taller (se pueden editar cuantas veces haga falta)
  notas             text,

  -- estado PROPIO de Servicio. No tiene nada que ver con el `status` del
  -- ticket del inspector ni con `machinery.operational`.
  estado            text not null default 'pendiente'
                    check (estado in ('pendiente', 'realizado')),

  -- qué se le hizo a la máquina (se llena al marcar 'realizado')
  work_done         text,

  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  resolved_by       uuid references public.profiles(id) on delete set null,
  resolved_at       timestamptz
);

-- Columnas añadidas después (por si la tabla ya existía de una corrida previa).
alter table public.servicio_registros add column if not exists updated_at timestamptz not null default now();


-- ── 2) ÍNDICES ──────────────────────────────────────────────────────────────
create index if not exists servicio_registros_machine_idx  on public.servicio_registros (machinery_id);
create index if not exists servicio_registros_estado_idx   on public.servicio_registros (estado);
-- listado del panel: pendientes primero, más recientes arriba
create index if not exists servicio_registros_created_idx  on public.servicio_registros (created_at desc);

-- Un ticket de inspector se espeja UNA SOLA VEZ (evita duplicados si el panel
-- reintenta la importación). No aplica a los registros creados en el taller,
-- que tienen source_request_id NULL y pueden repetirse libremente.
create unique index if not exists servicio_registros_source_uk
  on public.servicio_registros (source_request_id)
  where source_request_id is not null;


-- ── 3) RLS ──────────────────────────────────────────────────────────────────
-- Mismo patrón que el resto de módulos aislados del proyecto
-- (ver `lavado_maquinaria.sql` y `op_external_machines.sql`):
-- lectura/escritura para usuarios autenticados, y el permiso fino de "quién
-- puede agregar/editar" lo resuelve la app por rol, no la base de datos.
alter table public.servicio_registros enable row level security;

drop policy if exists servicio_registros_rw on public.servicio_registros;
create policy servicio_registros_rw on public.servicio_registros
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.servicio_registros to authenticated;


-- ── 4) REALTIME ─────────────────────────────────────────────────────────────
-- Igual que en `op_realtime.sql`: una tabla NO emite eventos si no está en la
-- publicación `supabase_realtime`. Sin esto el panel de Servicio no se
-- refrescaría solo. Idempotente: no falla si ya estaba publicada.
do $$
begin
  if exists (
       select 1 from information_schema.tables
       where table_schema = 'public' and table_name = 'servicio_registros'
     )
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'servicio_registros'
     )
  then
    execute 'alter publication supabase_realtime add table public.servicio_registros';
  end if;
end $$;


-- ── 5) NOTA PARA LA APP (no se ejecuta, es contrato) ────────────────────────
-- Con esta tabla en pie, la pantalla de Servicio debe:
--   • LEER `maintenance_requests` (averías de inspectores) → solo SELECT.
--   • INSERT/UPDATE únicamente sobre `servicio_registros`.
--   • Al "marcar realizado": UPDATE de esta tabla poniendo
--     estado = 'realizado', work_done, resolved_by, resolved_at.
--     NO tocar `maintenance_requests.status` ni `machinery.operational`
--     ni `machinery.en_espera`.
--   • Eliminar el botón/flujo "enviar a reparación".


-- ============================================================================
-- 6) VERIFICACIÓN — correr DESPUÉS de aplicar el script.
-- ============================================================================

-- 6.1 · Las columnas quedaron como se esperan.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'servicio_registros'
order by ordinal_position;

-- 6.2 · Los CHECK de `origen` y `estado` existen.
select con.conname, pg_get_constraintdef(con.oid) as definicion
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace ns on ns.oid = rel.relnamespace
where ns.nspname = 'public' and rel.relname = 'servicio_registros' and con.contype = 'c';

-- 6.3 · Los índices quedaron creados (machinery_id, estado, created_at, único de source).
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'servicio_registros'
order by indexname;

-- 6.4 · RLS activo y la política de lectura/escritura autenticada.
select relrowsecurity as rls_activo
from pg_class where oid = 'public.servicio_registros'::regclass;

select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'servicio_registros';

-- 6.5 · La tabla está publicada en realtime (debe devolver 1 fila).
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename = 'servicio_registros';

-- 6.6 · Conteo inicial por estado y origen (recién creada: 0 filas).
select origen, estado, count(*) as total
from public.servicio_registros
group by origen, estado
order by origen, estado;

-- 6.7 · CONTROL DEL DESACOPLE: nada de esto debió cambiar.
--       Los tickets de inspectores siguen intactos (Servicio no los cierra).
select status, count(*) as tickets
from public.maintenance_requests
group by status
order by status;

--       Y el estado operativo de las máquinas sigue igual (Servicio no lo pisa).
select operational, count(*) as maquinas
from public.machinery
where active
group by operational
order by operational;


-- ============================================================================
-- 7) DESHACER (rollback manual) — descomentar y correr SOLO si hay que revertir.
--    Borra la tabla nueva y sus datos. NO toca `maintenance_requests` ni
--    `machinery` porque este script nunca los modificó.
-- ============================================================================
-- do $$
-- begin
--   begin
--     execute 'alter publication supabase_realtime drop table public.servicio_registros';
--   exception when others then null;
--   end;
-- end $$;
--
-- drop table if exists public.servicio_registros cascade;
