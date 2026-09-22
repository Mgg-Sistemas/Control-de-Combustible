-- ============================================================================
-- INFORME TÉCNICO: LOS COSTOS SE MUDAN A SU PROPIA TABLA (22-sep-2026)
--
-- 👉 CÓMO SE CORRE: copiar ESTE ARCHIVO COMPLETO, pegarlo en Supabase → SQL
--    Editor y darle RUN una sola vez. Es idempotente.
--
-- ⚠️ REQUIERE `supabase/informe_tecnico_costos.sql` CORRIDO ANTES (es el que
--    creó `machinery_tech_reports`). Este archivo lo CORRIGE.
--
-- POR QUÉ EXISTE ESTE ARCHIVO
-- ---------------------------------------------------------------------------
-- La primera versión metió el dinero DENTRO del módulo de Servicio:
-- `machinery_service_orders.labor_cost` y `machinery_service_parts.unit_cost`,
-- con sus campos en el formulario de 🧾 Servicios. Pedido del cliente (textual):
--
--     «ese informe con costo que sea independiente en el módulo,
--      que no afecte nada, es un reporte nuevo»
--
-- Tenía razón, y no solo por el formulario. Había un problema de fondo que esa
-- versión arrastraba:
--
--   ⚠️ AL EDITAR UN SERVICIO, SUS REPUESTOS SE BORRAN Y SE VUELVEN A INSERTAR
--      (`editarServicio` → `limpiarRepuestos`). Con el precio guardado en
--      `machinery_service_parts`, CUALQUIER edición del servicio —cambiar una
--      fecha, corregir una falta de ortografía— se llevaba por delante todos los
--      precios cargados, en silencio. El informe del mes siguiente habría salido
--      en cero sin que nadie entendiera por qué.
--
-- Así que el costo vive ahora en una tabla PROPIA del informe, atada a la
-- intervención (que sí es estable) y no a sus renglones (que no lo son).
--
-- QUÉ HACE, EN ORDEN
--   1. Crea `machinery_tech_report_costs` (una hoja de costos por intervención).
--   2. Se trae lo que hubiera cargado en las columnas viejas (por si alguien
--      alcanzó a usarlas antes de este cambio).
--   3. Borra esas columnas SOLO SI QUEDARON VACÍAS. Si tienen algo, las deja y
--      lo dice: este script no bota datos de nadie.
-- ============================================================================


-- ── 1) LA HOJA DE COSTOS DEL INFORME ────────────────────────────────────────
-- Una fila por INTERVENCIÓN. `service_order_id` es la clave primaria: no hay
-- dos hojas de costos para el mismo trabajo, y borrar el trabajo se lleva su
-- hoja (`on delete cascade`).
create table if not exists public.machinery_tech_report_costs (
  service_order_id uuid primary key
                   references public.machinery_service_orders(id) on delete cascade,

  -- «Mano de obra» de la intervención completa: una sola cifra, como en el
  -- documento del cliente (el informe no desglosa horas-hombre).
  labor_cost       numeric(14,2),

  -- El desglose de INSUMOS del informe, con su precio:
  --   [{"description":"Pasador nuevo","qty":1,"unit_cost":45.00}, ...]
  --
  -- ⚠️ ES UNA COPIA CON VIDA PROPIA, no un espejo de `machinery_service_parts`.
  --    La pantalla la PROPONE copiando los repuestos del servicio, pero después
  --    no se vuelve a sincronizar sola: un informe ya emitido no puede cambiar
  --    de monto porque alguien corrigió un renglón del taller tres semanas
  --    después. Y como no depende de las filas de repuestos —que se borran y se
  --    recrean en cada edición del servicio— el precio no se pierde nunca.
  items            jsonb not null default '[]'::jsonb,

  updated_by       uuid references public.profiles(id) on delete set null,
  updated_at       timestamptz not null default now()
);

comment on table public.machinery_tech_report_costs is
  'Costos del Informe Tecnico, por intervencion. APARTE del modulo de Servicio, que no lleva dinero.';


-- ── 2) RLS ──────────────────────────────────────────────────────────────────
-- Mismo criterio que `machinery_tech_reports`: lee cualquiera autenticado,
-- escribe el staff.
alter table public.machinery_tech_report_costs enable row level security;

drop policy if exists mtrc_select on public.machinery_tech_report_costs;
create policy mtrc_select on public.machinery_tech_report_costs
  for select to authenticated using (true);

drop policy if exists mtrc_write on public.machinery_tech_report_costs;
create policy mtrc_write on public.machinery_tech_report_costs
  for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

grant select, insert, update, delete on public.machinery_tech_report_costs to authenticated;


-- ── 3) REALTIME ─────────────────────────────────────────────────────────────
do $blk$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname='supabase_realtime' and schemaname='public'
                    and tablename='machinery_tech_report_costs') then
    alter publication supabase_realtime add table public.machinery_tech_report_costs;
  end if;
exception when others then null;
end $blk$;


-- ── 4) AUDITORÍA ────────────────────────────────────────────────────────────
do $blk$
begin
  if to_regclass('public.audit_log') is not null and exists (
    select 1 from pg_proc where proname = 'audit_row' and pronamespace = 'public'::regnamespace
  ) then
    execute 'drop trigger if exists trg_audit on public.machinery_tech_report_costs';
    execute 'create trigger trg_audit after insert or update or delete on public.machinery_tech_report_costs for each row execute function public.audit_row()';
  end if;
end $blk$;


-- ── 5) RESCATE DE LO QUE HUBIERA EN LAS COLUMNAS VIEJAS ─────────────────────
-- Por si alguien alcanzó a cargar costos entre que se corrió el primer archivo
-- y este. Si no hay nada (lo normal), no hace absolutamente nada.
do $blk$
begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='machinery_service_orders'
                and column_name='labor_cost') then
    execute $q$
      insert into public.machinery_tech_report_costs (service_order_id, labor_cost, items)
      select o.id,
             o.labor_cost,
             coalesce((
               select jsonb_agg(jsonb_build_object(
                        'description', p.description,
                        'qty',         p.quantity,
                        'unit_cost',   p.unit_cost)
                      order by p.position)
                 from public.machinery_service_parts p
                where p.service_order_id = o.id
                  and p.unit_cost is not null
             ), '[]'::jsonb)
        from public.machinery_service_orders o
       where o.labor_cost is not null
          or exists (select 1 from public.machinery_service_parts p
                      where p.service_order_id = o.id and p.unit_cost is not null)
      on conflict (service_order_id) do nothing
    $q$;
  end if;
end $blk$;


-- ── 6) BORRAR LAS COLUMNAS VIEJAS — SOLO SI QUEDARON VACÍAS ─────────────────
-- ⚠️ Este script NO bota datos. Si alguna fila tiene un costo cargado, las
--    columnas se QUEDAN y la verificación de abajo lo dice con todas sus letras.
--    (El paso 5 ya copió esos valores a la tabla nueva, así que no se pierden;
--    simplemente no se borra el original sin que una persona lo decida.)
do $blk$
declare con_datos bigint := 0;
begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='machinery_service_orders'
                and column_name='labor_cost') then
    execute 'select count(*) from public.machinery_service_orders where labor_cost is not null'
      into con_datos;
    if con_datos = 0 then
      execute 'alter table public.machinery_service_orders drop column labor_cost';
    end if;
  end if;

  con_datos := 0;
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='machinery_service_parts'
                and column_name='unit_cost') then
    execute 'select count(*) from public.machinery_service_parts where unit_cost is not null'
      into con_datos;
    if con_datos = 0 then
      execute 'alter table public.machinery_service_parts drop column unit_cost';
    end if;
  end if;
end $blk$;


-- ── 7) VERIFICACIÓN (todo tiene que decir ✅) ──────────────────────────────
select chequeo, valor, case when ok then '✅' else '❌ REVISAR' end as estado
from (
  select 1 as n, 'Tabla de costos del informe' as chequeo,
         coalesce(to_regclass('public.machinery_tech_report_costs')::text, 'no existe') as valor,
         to_regclass('public.machinery_tech_report_costs') is not null as ok
  union all
  select 2, '⭐ El módulo de Servicio quedó SIN dinero (0 columnas de costo)',
         (select count(*)::text from information_schema.columns
           where table_schema='public'
             and ((table_name='machinery_service_orders' and column_name='labor_cost')
               or (table_name='machinery_service_parts'  and column_name='unit_cost'))),
         (select count(*) from information_schema.columns
           where table_schema='public'
             and ((table_name='machinery_service_orders' and column_name='labor_cost')
               or (table_name='machinery_service_parts'  and column_name='unit_cost'))) = 0
  union all
  select 3, 'Hojas de costo rescatadas de la versión anterior',
         (select count(*)::text from public.machinery_tech_report_costs),
         true
  union all
  select 4, 'RLS activo',
         (select relrowsecurity from pg_class
           where oid = 'public.machinery_tech_report_costs'::regclass)::text,
         (select relrowsecurity from pg_class
           where oid = 'public.machinery_tech_report_costs'::regclass)
  union all
  select 5, 'La tabla de informes sigue en pie',
         coalesce(to_regclass('public.machinery_tech_reports')::text, 'no existe'),
         to_regclass('public.machinery_tech_reports') is not null
  union all
  -- CONTROL: este script NO toca ni un servicio ya guardado.
  select 6, 'Servicios guardados (este script NO los toca)',
         (select count(*) from public.machinery_service_orders)::text,
         true
) t
order by n;


-- ============================================================================
-- SI EL CHEQUEO 2 SALE EN ❌
-- ---------------------------------------------------------------------------
-- Significa que alguien alcanzó a cargar costos en las columnas viejas. Ya
-- fueron COPIADOS a `machinery_tech_report_costs` (chequeo 3 lo confirma), así
-- que se pueden borrar a mano cuando lo verifiques:
--
--   alter table public.machinery_service_orders drop column if exists labor_cost;
--   alter table public.machinery_service_parts  drop column if exists unit_cost;
--
-- DESHACER TODO (solo si hay que revertir):
--   drop table if exists public.machinery_tech_report_costs cascade;
-- ============================================================================
