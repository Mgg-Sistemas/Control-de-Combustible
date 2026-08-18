-- ============================================================================
-- SERVICIO DE MAQUINARIA — registro de reparaciones y ficha técnica (18-ago-2026)
--
-- QUÉ ES: el encargado del taller necesita dejar constancia de lo que se le hizo
-- a cada máquina — internamente (equipo de la empresa) o externamente (una persona
-- o taller de afuera) — y poder sacarlo en PDF: la ficha técnica de la máquina en
-- la primera página y todas sus reparaciones a partir de la segunda.
--
-- Sigue el formulario en papel del cliente («Ficha técnica Jumbo con martillo
-- 0488», Golden Touch 1127 C.A.): datos generales, tipo de intervención,
-- descripción del problema, acciones realizadas, repuestos utilizados y firmas.
--
-- ⚠️ ESTE MÓDULO NO LLEVA DINERO. Sin costos, sin pagos, sin autorizaciones —
--    decisión explícita del cliente. Si alguien propone «ya que estamos,
--    agreguemos el costo», la respuesta es no.
--
-- ⚠️ NO MODIFICA NI UN SOLO REGISTRO EXISTENTE. Todo es aditivo: dos tablas
--    nuevas y tres columnas nuevas. Ni un `update`, ni un `delete`, ni un
--    `alter` sobre una columna que ya tenga datos. Las horas de jornada, los
--    cuadres de nómina y los reportes ya emitidos quedan exactamente igual.
--
-- LA FRONTERA (por qué esto no toca `machinery` ni `maintenance_requests`):
--   Los módulos de Servicio y Mantenimiento quedan semi-independientes — leen
--   todo, escriben solo en lo suyo. Registrar un servicio NO pone la máquina
--   operativa ni cierra la avería: eso lo sigue haciendo quien de verdad ve la
--   máquina (el coordinador por QR, el supervisor desde el teléfono, Control de
--   Maquinaria). Ver `docs/superpowers/specs/2026-08-18-servicio-maquinaria-design.md`.
--
--   La ÚNICA excepción es `machinery.horometro_base`, que el cliente pidió
--   conservar («lo de los horómetros que sí funcione»). No se toca acá.
--
-- Correr los bloques EN ORDEN, uno por uno.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 1 · CÓMO ESTÁ AHORA  (solo lectura, no cambia nada)
-- ════════════════════════════════════════════════════════════════════════════
-- Antes de crear nada, confirmar que no existe ya. Lo esperado en la primera
-- corrida: las dos tablas en `false` y las tres columnas en `false`.
select
  to_regclass('public.machinery_service_orders') is not null            as tabla_ordenes_existe,
  to_regclass('public.machinery_service_parts')  is not null            as tabla_repuestos_existe,
  exists (select 1 from information_schema.columns
           where table_schema='public' and table_name='machinery'
             and column_name='oil_type')                                as col_oil_type_existe,
  exists (select 1 from information_schema.columns
           where table_schema='public' and table_name='machinery'
             and column_name='oil_capacity_l')                          as col_oil_capacity_existe,
  exists (select 1 from information_schema.columns
           where table_schema='public' and table_name='machinery'
             and column_name='oil_notes')                               as col_oil_notes_existe,
  (select count(*) from public.machinery where active)                  as maquinas_activas;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 2 · LA ORDEN DE SERVICIO   ⚠️ ESTO SÍ ESCRIBE (crea una tabla nueva)
-- ════════════════════════════════════════════════════════════════════════════
-- Un renglón por trabajo hecho. Idempotente: se puede correr más de una vez.
create table if not exists public.machinery_service_orders (
  id uuid primary key default gen_random_uuid(),

  machinery_id uuid not null references public.machinery(id) on delete cascade,

  -- EL ENLACE OPCIONAL a la avería que este trabajo atiende.
  -- Es lo único que une el módulo con los avisos, y va en UNA SOLA DIRECCIÓN:
  -- apuntar a una avería NO la modifica. La avería sigue su propio camino y la
  -- cierra quien ve la máquina en campo. En la pantalla se muestran las dos
  -- verdades juntas ("atendida en taller" / "el sistema la ve pendiente") para
  -- que nunca parezca una contradicción.
  -- `on delete set null`: si borran la avería, el registro del trabajo sobrevive.
  maintenance_request_id uuid references public.maintenance_requests(id) on delete set null,

  service_date date not null default current_date,     -- «1. Fecha»

  -- Interno = lo hizo el equipo de la empresa. Externo = una persona o taller de afuera.
  origen text not null default 'interno' check (origen in ('interno','externo')),
  technician text,          -- «Operador / Técnico» (se exige cuando origen='interno')
  provider   text,          -- persona o taller externo (se exige cuando origen='externo')

  -- «2. Tipo de intervención». Es ARREGLO, no texto: un mismo trabajo puede ser
  -- mecánico e hidráulico a la vez, y el formulario en papel deja marcar varias.
  -- Valores usados por la app: 'mecanica' | 'electricidad' | 'mangueras' | 'servicio'.
  -- Sin `check`: si mañana aparece otro tipo, se agrega en la app sin migración.
  intervenciones text[] not null default '{}',

  problem   text,           -- «3. Descripción del problema»
  work_done text,           -- «4. Acciones realizadas»
  photos    text[] not null default '{}',   -- «Foto referencia (opcional)»
  notes     text,

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Índices. Postgres NO indexa solo las claves foráneas, y sin esto tanto los
-- JOIN como el `on delete cascade` de la máquina hacen barrido completo.
create index if not exists idx_mso_machinery on public.machinery_service_orders(machinery_id);
create index if not exists idx_mso_date      on public.machinery_service_orders(service_date desc);
create index if not exists idx_mso_request   on public.machinery_service_orders(maintenance_request_id);
create index if not exists idx_mso_creador   on public.machinery_service_orders(created_by);


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 3 · LOS REPUESTOS   ⚠️ ESTO SÍ ESCRIBE (crea una tabla nueva)
-- ════════════════════════════════════════════════════════════════════════════
-- «5. Repuestos utilizados» — un renglón por repuesto, tal cual la tabla del papel.
create table if not exists public.machinery_service_parts (
  id uuid primary key default gen_random_uuid(),

  -- Borrar la orden se lleva sus repuestos: no tienen sentido sueltos.
  service_order_id uuid not null
    references public.machinery_service_orders(id) on delete cascade,

  quantity    numeric(12,2),        -- «Cantidad»
  description text not null,        -- «Descripción del repuesto / insumo»

  -- «Estado». La app ofrece Nuevo / Usado / Reparado / Reacondicionado, pero
  -- SIN `check` a propósito: si el cliente necesita otro, lo escribe y ya — no
  -- hace falta una migración para agregar una palabra.
  estado      text,

  -- Conserva el orden en que se cargaron los renglones. Sin esto, Postgres los
  -- devuelve en cualquier orden y la lista se ve distinta cada vez que se abre.
  position    int not null default 0
);

create index if not exists idx_msp_orden on public.machinery_service_parts(service_order_id);


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 4 · LUBRICACIÓN EN LA FICHA   ⚠️ ESTO SÍ ESCRIBE (3 columnas nuevas)
-- ════════════════════════════════════════════════════════════════════════════
-- El documento del cliente pide un bloque de lubricación que hoy no existe.
-- Son columnas NULAS y SIN default: en Postgres moderno eso es instantáneo y no
-- reescribe la tabla, así que es seguro aunque `machinery` tenga datos y gente
-- usando el sistema en este momento.
alter table public.machinery add column if not exists oil_type       text;           -- tipo de aceite recomendado (motor)
alter table public.machinery add column if not exists oil_capacity_l numeric(10,2);  -- cantidad requerida, en litros
alter table public.machinery add column if not exists oil_notes      text;           -- nota libre (p. ej. si se mide en galones)

comment on column public.machinery.oil_type       is 'Tipo de aceite recomendado del motor (ficha técnica).';
comment on column public.machinery.oil_capacity_l is 'Cantidad de aceite requerida por el motor, en litros (ficha técnica).';
comment on column public.machinery.oil_notes      is 'Nota libre de lubricación, para lo que no entra en litros.';


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 5 · PERMISOS (RLS)   ⚠️ ESTO SÍ ESCRIBE (políticas)
-- ════════════════════════════════════════════════════════════════════════════
-- Mismo criterio que el resto del sistema (dispatches, tanks, vehicles,
-- machinery, machine_services): LEE cualquiera autenticado, ESCRIBE el staff.
--
-- `(select public.is_staff())` va envuelto en un select a propósito: así Postgres
-- evalúa la función UNA vez por consulta en lugar de una vez por fila.
alter table public.machinery_service_orders enable row level security;
alter table public.machinery_service_parts  enable row level security;

drop policy if exists mso_select on public.machinery_service_orders;
create policy mso_select on public.machinery_service_orders
  for select to authenticated using (true);

drop policy if exists mso_write on public.machinery_service_orders;
create policy mso_write on public.machinery_service_orders
  for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

drop policy if exists msp_select on public.machinery_service_parts;
create policy msp_select on public.machinery_service_parts
  for select to authenticated using (true);

drop policy if exists msp_write on public.machinery_service_parts;
create policy msp_write on public.machinery_service_parts
  for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 6 · TIEMPO REAL   ⚠️ ESTO SÍ ESCRIBE (publicación)
-- ════════════════════════════════════════════════════════════════════════════
-- Para que si dos personas están en la pantalla, la lista se refresque sola.
-- El `if not exists` evita el error si ya estuviera publicada.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname='supabase_realtime' and schemaname='public'
                    and tablename='machinery_service_orders') then
    alter publication supabase_realtime add table public.machinery_service_orders;
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname='supabase_realtime' and schemaname='public'
                    and tablename='machinery_service_parts') then
    alter publication supabase_realtime add table public.machinery_service_parts;
  end if;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 7 · COMPROBAR QUE QUEDÓ TODO  (solo lectura)
-- ════════════════════════════════════════════════════════════════════════════
-- Lo que se espera: TODO en `true`, `indices` en 5, `politicas` en 4,
-- y `registros_*` en 0 (recién creadas, nadie ha cargado nada todavía).
select
  to_regclass('public.machinery_service_orders') is not null   as tabla_ordenes,
  to_regclass('public.machinery_service_parts')  is not null   as tabla_repuestos,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='machinery'
      and column_name in ('oil_type','oil_capacity_l','oil_notes')) = 3 as columnas_lubricacion,
  (select count(*) from pg_indexes
    where schemaname='public'
      and indexname in ('idx_mso_machinery','idx_mso_date','idx_mso_request',
                        'idx_mso_creador','idx_msp_orden'))            as indices,
  (select count(*) from pg_policies
    where schemaname='public'
      and tablename in ('machinery_service_orders','machinery_service_parts')) as politicas,
  (select relrowsecurity from pg_class
    where oid='public.machinery_service_orders'::regclass)             as rls_ordenes,
  (select relrowsecurity from pg_class
    where oid='public.machinery_service_parts'::regclass)              as rls_repuestos,
  (select count(*) from public.machinery_service_orders)               as registros_ordenes,
  (select count(*) from public.machinery_service_parts)                as registros_repuestos;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 8 · DESHACER  (solo si hace falta, y solo ANTES de cargar datos)
-- ════════════════════════════════════════════════════════════════════════════
-- Deja todo exactamente como estaba. No toca ningún registro existente: las
-- tablas son nuevas y las columnas están vacías. Si ya se cargaron servicios,
-- esto los BORRA — por eso está comentado.
--
-- drop table if exists public.machinery_service_parts;
-- drop table if exists public.machinery_service_orders;
-- alter table public.machinery drop column if exists oil_type;
-- alter table public.machinery drop column if exists oil_capacity_l;
-- alter table public.machinery drop column if exists oil_notes;
