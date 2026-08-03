-- ============================================================================
-- RECONSTRUCCIÓN INFERIDA (NO es un dump real de producción) de la tabla
-- public.truck_yard_logs — Entrada/Salida de camiones al patio.
-- ----------------------------------------------------------------------------
-- POR QUÉ EXISTE ESTE ARCHIVO
-- La tabla `truck_yard_logs` se usa en el código (src/lib/truckYard.ts,
-- src/screens/PatioScreen.tsx, src/screens/SupervisionScreen.tsx,
-- src/components/TruckYardCalendar.tsx, src/screens/AuditScreen.tsx,
-- supabase/audit.sql, supabase/fix_realtime_publication.sql) pero NUNCA tuvo
-- un CREATE TABLE versionado en el repo: todo indica que se creó a mano en el
-- SQL Editor de Supabase (producción) en algún momento y esa migración nunca
-- se guardó como archivo. Esto es deuda técnica: si alguien intenta instalar
-- el esquema desde cero (base nueva / entorno de pruebas) a partir de
-- supabase/schema.sql, esta tabla NO se crearía.
--
-- Las columnas de abajo NO salen de `information_schema` ni de un dump real:
-- se INFIRIERON leyendo cada `.select()/.insert()/.update()/.eq()/.order()`
-- contra 'truck_yard_logs' en el código, más la interfaz TypeScript
-- `TruckYardLog` en src/types/database.ts (ver detalle de cada columna abajo,
-- justo antes del CREATE TABLE). Es razonablemente fiel a lo que usa la app,
-- pero la tabla real en producción podría tener columnas adicionales que el
-- código actual no usa (y que este archivo, por lo tanto, no puede conocer).
--
-- IDEMPOTENCIA / QUÉ HACER CON ESTE ARCHIVO
-- - Usa `create table if not exists`: si la tabla ya existe en producción
--   (que es el caso esperado), este archivo NO la toca ni la pisa — el
--   CREATE TABLE completo se ignora en silencio. No agrega columnas nuevas
--   a una tabla ya existente ni corre ALTER TABLE de ningún tipo.
-- - Los bloques de RLS usan `drop policy if exists` + `create policy`, y el
--   de la publicación de Realtime usa `do $$ ... exception ... $$` (mismo
--   patrón que supabase/fix_realtime_publication.sql), así que también son
--   seguros de re-ejecutar.
-- - ANTES de ejecutar este archivo contra producción: compará esta
--   definición contra la estructura real en Supabase Studio (Table Editor →
--   truck_yard_logs → columnas). Lo más probable es que NO haga falta
--   ejecutar el CREATE TABLE (la tabla ya existe) — el valor real de este
--   archivo es dejar la definición documentada y versionada en el repo, no
--   modificar producción. Los bloques de RLS/Realtime sí pueden ser útiles
--   de correr si notás que faltan (por ejemplo si RLS no estaba activo).
--
-- COLUMNAS INFERIDAS Y SU ORIGEN:
--   id              -> src/types/database.ts (TruckYardLog.id: string) → uuid
--   machinery_id    -> insert en src/lib/truckYard.ts y src/screens/PatioScreen.tsx
--                      (`machinery_id: machineryId`); select anidado
--                      `machine:machinery_id(company:company_id(name))` en
--                      SupervisionScreen.tsx implica FK real a public.machinery(id)
--                      (PostgREST necesita el FK para resolver el embed). Nullable
--                      según TruckYardLog.machinery_id: string | null.
--   machine_code    -> insert en truckYard.ts/PatioScreen.tsx (`machine_code`) y
--                      select en SupervisionScreen.tsx. TruckYardLog.machine_code:
--                      string | null.
--   direction       -> insert/select en todos los archivos; valores literales
--                      'entrada' | 'salida' (src/lib/truckYard.ts,
--                      PatioScreen.tsx, TruckYardCalendar.tsx). Se modela como
--                      check constraint en vez de tipo enum de Postgres porque
--                      no hay un tipo `direction`/similar ya definido en
--                      schema.sql para reusar.
--   logged_by       -> insert en truckYard.ts/PatioScreen.tsx (`logged_by: uid`,
--                      el id de auth/profiles del usuario logueado). Se asume FK a
--                      public.profiles(id), igual que operator_assignments.created_by
--                      en schema.sql (línea ~972).
--   logged_by_name  -> insert en truckYard.ts/PatioScreen.tsx (`logged_by_name`,
--                      nombre ya resuelto en cliente, se guarda desnormalizado).
--   note            -> SOLO aparece en TruckYardLog (src/types/database.ts); no se
--                      encontró ningún `.insert()/.update()` que lo escriba en el
--                      código actual. Se incluye por fidelidad al tipo TS, pero es
--                      la columna con MÁS incertidumbre de esta reconstrucción.
--   created_at      -> select/order/gte/lte en SupervisionScreen.tsx y
--                      TruckYardCalendar.tsx (rango de fecha + orden cronológico).
--
-- AMBIGÜEDADES QUE NO SE PUDIERON RESOLVER CON CERTEZA (ver también el reporte
-- de la tarea que generó este archivo):
--   - No se sabe si `direction` es un `text` con check, o un tipo enum de
--     Postgres ya creado en producción con otro nombre.
--   - No se sabe si `logged_by` referencia realmente public.profiles(id) o
--     auth.users(id) directo (ambos son uuid y compatibles con el código).
--   - No se sabe si `machinery_id`/`logged_by` tienen `on delete cascade`,
--     `on delete set null` u otra política en la tabla real.
--   - No se encontró un `.update()` sobre esta tabla en el código: no se sabe
--     si existe un `updated_at` u otras columnas de auditoría en producción.
-- ============================================================================

create table if not exists public.truck_yard_logs (
  id             uuid primary key default gen_random_uuid(),
  machinery_id   uuid references public.machinery(id) on delete set null,
  machine_code   text,
  direction      text not null check (direction in ('entrada', 'salida')),
  logged_by      uuid references public.profiles(id) on delete set null,
  logged_by_name text,
  note           text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_truck_yard_logs_created_at on public.truck_yard_logs(created_at);
create index if not exists idx_truck_yard_logs_machinery on public.truck_yard_logs(machinery_id);

-- RLS: mismo patrón simple usado en tablas parecidas de bitácora/registro
-- (machine_rounds, operator_assignments en schema.sql) — cualquier usuario
-- autenticado puede leer y escribir; no hay restricción por rol porque el
-- patio lo opera cualquier rol con acceso a PatioScreen/SupervisionScreen.
alter table public.truck_yard_logs enable row level security;

drop policy if exists tyl_select on public.truck_yard_logs;
create policy tyl_select on public.truck_yard_logs
  for select to authenticated using (true);

drop policy if exists tyl_insert on public.truck_yard_logs;
create policy tyl_insert on public.truck_yard_logs
  for insert to authenticated with check (true);

drop policy if exists tyl_update on public.truck_yard_logs;
create policy tyl_update on public.truck_yard_logs
  for update to authenticated using (true) with check (true);

-- Realtime: SupervisionScreen.tsx se suscribe a esta tabla vía useRealtimeRefresh
-- (ver supabase/fix_realtime_publication.sql, que ya cubre este ALTER). Se repite
-- aquí, envuelto en su propio bloque con EXCEPTION, para que este archivo sea
-- autocontenido y no falle si la tabla o la publicación ya existen / ya la incluyen.
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.truck_yard_logs';
  exception when duplicate_object then null; when others then null;
  end;
end $$;
