-- ============================================================================
-- INFORME TÉCNICO Y DE COSTOS DE MANTENIMIENTO Y REPARACIÓN (22-sep-2026)
--
-- 👉 CÓMO SE CORRE: copiar ESTE ARCHIVO COMPLETO, pegarlo en Supabase → SQL
--    Editor y darle RUN una sola vez. Es idempotente: se puede repetir sin
--    duplicar nada y sin tocar un solo servicio ya guardado.
--
-- ⚠️ Editar este .sql NO lo aplica. Hay que correrlo a mano.
--
-- QUÉ RESUELVE
-- ---------------------------------------------------------------------------
-- El cliente arma A MANO, en Word, un «Informe Técnico y de Costos» por máquina
-- para entregárselo al dueño del equipo: la ficha del equipo, la lista
-- cronológica de intervenciones con su mano de obra y sus repuestos, los totales
-- consolidados y las firmas. Todo ese historial YA está en el sistema
-- (`machinery_service_orders` + `machinery_service_parts`) menos UNA cosa: EL
-- DINERO. El módulo de Servicio nació a propósito sin costos.
--
-- Este script agrega esos costos y la cabecera editorial del informe (a quién va
-- dirigido, quién lo elabora, conclusiones y recomendaciones), que es lo único
-- que no se puede deducir de los datos que ya hay.
--
-- ⚠️ LOS COSTOS SON OPCIONALES. Quedan NULL en todo lo ya cargado y en todo lo
--    que se registre sin llenarlos. Un servicio sin costo NO es un error: sale
--    en el informe con su renglón en blanco y no ensucia los totales. El taller
--    sigue pudiendo registrar un trabajo sin saber cuánto costó.
-- ============================================================================


-- ── 1) EL DINERO EN LO QUE YA EXISTE ────────────────────────────────────────
-- Columnas NULAS y SIN default: en Postgres moderno eso es instantáneo y no
-- reescribe la tabla, así que es seguro con datos y con gente usando el sistema.

-- «Mano de obra» de la intervención completa (una sola cifra por hoja, como en
-- el documento del cliente: el informe no desglosa horas-hombre).
alter table public.machinery_service_orders
  add column if not exists labor_cost numeric(14,2);

-- Costo UNITARIO del repuesto. El total del renglón es cantidad × costo, y lo
-- calcula quien imprime: guardar el total además del unitario abre la puerta a
-- que los dos números terminen contradiciéndose.
alter table public.machinery_service_parts
  add column if not exists unit_cost numeric(14,2);

comment on column public.machinery_service_orders.labor_cost is
  'Mano de obra de esta intervención, en $. NULL = no se registró.';
comment on column public.machinery_service_parts.unit_cost is
  'Costo UNITARIO del repuesto, en $. El total del renglón es cantidad x unit_cost.';


-- ── 2) LA CABECERA EDITORIAL DEL INFORME ────────────────────────────────────
-- Una fila = un informe emitido. Se guarda para poder REIMPRIMIRLO igual y para
-- no volver a escribir a mano las conclusiones cada vez.
--
-- El HISTORIAL de intervenciones NO se copia acá: se vuelve a leer de las
-- órdenes al imprimir. Congelarlo haría que corregir un costo mal cargado no se
-- reflejara nunca en el informe.
create table if not exists public.machinery_tech_reports (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null,                 -- IT-2026-001 (lo pone el trigger)
  machinery_id        uuid not null references public.machinery(id) on delete cascade,
  report_date         date not null default current_date,

  -- Rango que abarca el informe. NULL = «todo lo que haya».
  desde               date,
  hasta               date,

  -- Los seis datos de la rejilla de cabecera del documento.
  dirigido_a          text,
  elaborado_por       text,
  empresa_propietaria text,
  encargado_sitio     text,
  ubicacion           text,
  estado_informe      text,

  -- «2. Antecedentes y estado operativo general». Se propone redactado solo y
  -- el usuario lo corrige; por eso se guarda el TEXTO FINAL, no sus ingredientes.
  antecedentes        text,

  -- «6. Conclusiones técnicas y recomendaciones».
  estado_operatividad text,
  proximo_pm          text,
  recomendaciones     text[] not null default '{}',

  -- «7. Firmas de conformidad y validación».
  firma1_nombre       text, firma1_cargo text, firma1_empresa text,
  firma2_nombre       text, firma2_cargo text, firma2_empresa text,

  -- ¿Sale la sección «5. Registro fotográfico»? Cuando una intervención no tiene
  -- fotos cargadas se imprimen los recuadros vacíos para pegarlas, igual que en
  -- el Word que arma hoy la oficina.
  con_fotos           boolean not null default true,

  notes               text,
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz
);

create index if not exists mtr_machinery_idx on public.machinery_tech_reports (machinery_id);
create index if not exists mtr_fecha_idx     on public.machinery_tech_reports (report_date desc);
create unique index if not exists mtr_code_key on public.machinery_tech_reports (code);


-- ── 3) CORRELATIVO IT-AAAA-### ──────────────────────────────────────────────
-- Por AÑO, no global: es como se numeran los documentos que salen de la oficina.
-- El `advisory lock` evita que dos personas emitiendo a la vez saquen el mismo
-- número (el índice único lo atraparía, pero con un error feo en la cara).
create or replace function public.assign_tech_report_code()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare n int; anio text;
begin
  if new.code is null or new.code = '' then
    anio := to_char(coalesce(new.report_date, current_date), 'YYYY');
    perform pg_advisory_xact_lock(hashtext('machinery_tech_reports_code_' || anio));
    select coalesce(max((regexp_replace(code, '^IT-[0-9]{4}-', '', 'g'))::int), 0) + 1
      into n
      from public.machinery_tech_reports
     where code ~ ('^IT-' || anio || '-[0-9]+$');
    new.code := 'IT-' || anio || '-' || lpad(n::text, 3, '0');
  end if;
  return new;
end $fn$;

drop trigger if exists trg_assign_tech_report_code on public.machinery_tech_reports;
create trigger trg_assign_tech_report_code
  before insert on public.machinery_tech_reports
  for each row execute function public.assign_tech_report_code();


-- ── 4) RLS ──────────────────────────────────────────────────────────────────
-- Mismo criterio que `machinery_service_orders`/`machinery_service_parts`, que
-- son las tablas que este informe lee: LEE cualquiera autenticado, ESCRIBE el
-- staff. `(select public.is_staff())` envuelto en un select a propósito: así
-- Postgres evalúa la función una vez por consulta y no una vez por fila.
alter table public.machinery_tech_reports enable row level security;

drop policy if exists mtr_select on public.machinery_tech_reports;
create policy mtr_select on public.machinery_tech_reports
  for select to authenticated using (true);

drop policy if exists mtr_write on public.machinery_tech_reports;
create policy mtr_write on public.machinery_tech_reports
  for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

grant select, insert, update, delete on public.machinery_tech_reports to authenticated;


-- ── 5) REALTIME ─────────────────────────────────────────────────────────────
do $blk$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname='supabase_realtime' and schemaname='public'
                    and tablename='machinery_tech_reports') then
    alter publication supabase_realtime add table public.machinery_tech_reports;
  end if;
exception when others then null;
end $blk$;


-- ── 6) AUDITORÍA ────────────────────────────────────────────────────────────
-- Dentro de un `if` para no fallar si todavía no se corrió `audit.sql`.
do $blk$
begin
  if to_regclass('public.audit_log') is not null and exists (
    select 1 from pg_proc where proname = 'audit_row' and pronamespace = 'public'::regnamespace
  ) then
    execute 'drop trigger if exists trg_audit on public.machinery_tech_reports';
    execute 'create trigger trg_audit after insert or update or delete on public.machinery_tech_reports for each row execute function public.audit_row()';
  end if;
end $blk$;


-- ── 7) VERIFICACIÓN ─────────────────────────────────────────────────────────
-- Última instrucción del archivo: lo que queda en pantalla al terminar.
-- Todo tiene que decir ✅.
select chequeo, valor, case when ok then '✅' else '❌ REVISAR' end as estado
from (
  select 1 as n, 'Mano de obra en los servicios' as chequeo,
         coalesce((select data_type from information_schema.columns
                    where table_schema='public' and table_name='machinery_service_orders'
                      and column_name='labor_cost'), 'no existe') as valor,
         exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='machinery_service_orders'
                    and column_name='labor_cost') as ok
  union all
  select 2, 'Costo unitario en los repuestos',
         coalesce((select data_type from information_schema.columns
                    where table_schema='public' and table_name='machinery_service_parts'
                      and column_name='unit_cost'), 'no existe'),
         exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='machinery_service_parts'
                    and column_name='unit_cost')
  union all
  select 3, 'Tabla de informes',
         coalesce(to_regclass('public.machinery_tech_reports')::text, 'no existe'),
         to_regclass('public.machinery_tech_reports') is not null
  union all
  select 4, 'Trigger del correlativo IT-AAAA-###',
         (select count(*) from pg_trigger
           where tgrelid = 'public.machinery_tech_reports'::regclass
             and tgname = 'trg_assign_tech_report_code')::text,
         (select count(*) from pg_trigger
           where tgrelid = 'public.machinery_tech_reports'::regclass
             and tgname = 'trg_assign_tech_report_code') = 1
  union all
  select 5, 'RLS activo',
         (select relrowsecurity from pg_class
           where oid = 'public.machinery_tech_reports'::regclass)::text,
         (select relrowsecurity from pg_class
           where oid = 'public.machinery_tech_reports'::regclass)
  union all
  -- CONTROL: este script NO toca ni un servicio ya guardado. Este número tiene
  -- que ser el mismo antes y después de correrlo.
  select 6, 'Servicios guardados (este script NO los toca)',
         (select count(*) from public.machinery_service_orders)::text,
         true
) t
order by n;


-- ============================================================================
-- DESHACER (solo si hay que revertir). Descomentar y correr aparte.
-- ⚠️ Borrar `labor_cost`/`unit_cost` PIERDE los costos cargados. La tabla de
--    informes se puede botar sin tocar el historial de servicios.
-- ============================================================================
-- drop table if exists public.machinery_tech_reports cascade;
-- alter table public.machinery_service_orders drop column if exists labor_cost;
-- alter table public.machinery_service_parts  drop column if exists unit_cost;
