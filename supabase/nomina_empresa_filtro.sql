-- ============================================================================
-- EMPRESA FILTRO NÓMINA — lista de empresas PROPIA de Nómina.
--
-- 👉 CÓMO SE CORRE: copiar ESTE ARCHIVO COMPLETO, pegarlo en Supabase → SQL
--    Editor y darle RUN una sola vez. Termina mostrando una tabla de verificación.
--
-- ⚠️ Editar este .sql NO lo aplica. Hay que correrlo a mano.
-- ✅ IDEMPOTENTE: se puede volver a correr sin duplicar nada.
-- ✅ NO TOCA `companies` NI `machinery` NI NADA DEL CATÁLOGO. Solo crea una
--    tabla nueva y una columna nueva en `employees`.
--
-- QUÉ RESUELVE
-- ---------------------------------------------------------------------------
-- Pedido del cliente (21-ago-2026): «que esa información de empresa no afecte
-- más nada, que sea algo apartado, que solo sea para nómina, y que la de nómina
-- pueda crear una nueva empresa que solo se refleje en nómina […] que no afecte
-- catálogo ni maquinaria ni nada».
--
-- El campo "Empresa" del empleado apunta a `public.companies`, que es el catálogo
-- COMPARTIDO con maquinaria, reportes, compras, acarreo, inventario y comidas.
-- Crear una empresa desde Nómina la metía en todos esos selectores.
--
-- POR QUÉ UNA TABLA APARTE Y NO UNA BANDERA
-- ---------------------------------------------------------------------------
-- El sistema ya tiene banderas de ese tipo (`hidden`, `food_only`) y NO alcanzan:
-- se midió el 21-ago-2026 y solo 7 archivos respetan el filtro `generalCompanies`
-- mientras que más de 20 leen `companies` en crudo. Una bandera nueva se
-- terminaría filtrando a Control de Maquinaria, Dashboard, Reportes, Compras,
-- Inventario y Acarreo. Una TABLA APARTE no puede filtrarse: el resto del
-- sistema ni sabe que existe.
--
-- QUÉ NO CAMBIA (opción B, elegida por el cliente)
-- ---------------------------------------------------------------------------
-- La columna vieja `employees.company_id` SE QUEDA IGUAL y se sigue usando en:
--   · los PERÍODOS de nómina (arman la lista de gente por empresa),
--   · la pantalla de COMIDAS,
--   · el carnet y la constancia.
-- O sea que un empleado pasa a tener DOS empresas: la de siempre y la de filtro.
-- Es a propósito y es el precio de no tocar nada más. Si algún día se quiere una
-- sola, hay que migrar también períodos, comidas y el carnet (opción A).
-- ============================================================================


-- ── 1) LA TABLA (solo Nómina la conoce) ─────────────────────────────────────
create table if not exists public.payroll_companies (
  id         uuid primary key default gen_random_uuid(),
  -- Nombre que se ve en el filtro. Único para no terminar con "Transporte X" dos
  -- veces y la gente repartida entre las dos.
  name       text not null unique,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid
);

comment on table public.payroll_companies is
  'Empresas SOLO para el filtro de Nómina (Empleados). NO es el catálogo general: no la lee maquinaria, ni reportes, ni compras, ni comidas. Ver companies para eso.';


-- ── 2) LA COLUMNA EN EL EMPLEADO ────────────────────────────────────────────
-- `on delete set null`: borrar una empresa de nómina NUNCA borra ni bloquea a un
-- empleado; simplemente se queda sin filtro.
alter table public.employees
  add column if not exists payroll_company_id uuid references public.payroll_companies(id) on delete set null;

comment on column public.employees.payroll_company_id is
  'Empresa FILTRO NÓMINA. Referencial: solo agrupa/filtra en Empleados. La empresa real del empleado sigue en company_id.';

create index if not exists idx_employees_payroll_company on public.employees(payroll_company_id);


-- ── 3) PERMISOS ─────────────────────────────────────────────────────────────
-- Mismo criterio que el resto de catálogos: cualquier autenticado lee y escribe;
-- quién ve Nómina lo decide el permiso de módulo en la app.
-- SIN política de DELETE: una empresa no se borra, se DESACTIVA (`active=false`).
-- Si se borrara de verdad, los empleados que la tenían quedarían sin filtro y no
-- habría forma de saber a cuál pertenecían.
alter table public.payroll_companies enable row level security;

drop policy if exists payroll_companies_select on public.payroll_companies;
create policy payroll_companies_select on public.payroll_companies
  for select to authenticated using (true);

drop policy if exists payroll_companies_insert on public.payroll_companies;
create policy payroll_companies_insert on public.payroll_companies
  for insert to authenticated with check (true);

drop policy if exists payroll_companies_update on public.payroll_companies;
create policy payroll_companies_update on public.payroll_companies
  for update to authenticated using (true) with check (true);

grant select, insert, update on public.payroll_companies to authenticated;


-- ── 4) AUDITORÍA ────────────────────────────────────────────────────────────
-- Mismo trigger genérico del resto de tablas: deja constancia de quién creó o
-- renombró una empresa de nómina. Dentro de un `if` para no fallar si todavía no
-- se corrió `audit.sql`.
do $$
begin
  if to_regclass('public.audit_log') is not null and exists (
    select 1 from pg_proc where proname = 'audit_row' and pronamespace = 'public'::regnamespace
  ) then
    execute 'drop trigger if exists trg_audit on public.payroll_companies';
    execute 'create trigger trg_audit after insert or update or delete on public.payroll_companies for each row execute function public.audit_row()';
  end if;
end $$;


-- ── 5) ARRANQUE: copiar lo que YA hay, para que el filtro no nazca vacío ────
-- Se crean las empresas de nómina con los MISMOS nombres que ya tienen los
-- empleados en su `company_id`, y se les asigna. Así el filtro funciona desde el
-- primer día con los mismos grupos de siempre (SOS LA GUAIRA, GOLDEN TOUCH…).
-- A partir de ahí las dos listas viven separadas: renombrar o crear en Nómina NO
-- toca `companies`, y al revés tampoco.
insert into public.payroll_companies (name)
select distinct btrim(c.name)
  from public.employees e
  join public.companies c on c.id = e.company_id
 where btrim(coalesce(c.name, '')) <> ''
on conflict (name) do nothing;

-- Y la del EMPLEADOR, para quien no tiene contratista. En la pantalla, un
-- empleado sin `company_id` se muestra hoy como "SOS LA GUAIRA" (es el patrón).
-- Si no se crea acá, esa gente quedaría en un grupo "sin empresa de filtro"
-- SEPARADO de los que sí apuntan a una empresa llamada "SOS LA GUAIRA", y
-- saldrían DOS chips con el mismo nombre partiendo a la plantilla en dos.
insert into public.payroll_companies (name) values ('SOS LA GUAIRA')
on conflict (name) do nothing;

-- Solo a quien todavía NO tiene empresa de nómina: si ya se le puso una a mano,
-- no se le pisa.
update public.employees e
   set payroll_company_id = pc.id
  from public.companies c
  join public.payroll_companies pc on pc.name = btrim(c.name)
 where e.company_id = c.id
   and e.payroll_company_id is null;

-- Los que no tienen contratista → SOS LA GUAIRA, igual que se ven hoy.
update public.employees e
   set payroll_company_id = (select id from public.payroll_companies where name = 'SOS LA GUAIRA')
 where e.company_id is null
   and e.payroll_company_id is null;


-- ── 6) VERIFICACIÓN ─────────────────────────────────────────────────────────
-- Última instrucción del archivo: el resultado que queda en pantalla.
-- Los 6 primeros renglones tienen que decir ✅.
select chequeo, valor, case when ok then '✅' else '❌ REVISAR' end as estado
from (
  select 1 as n, 'La tabla de empresas de nómina existe' as chequeo,
         coalesce(to_regclass('public.payroll_companies')::text, 'no existe') as valor,
         to_regclass('public.payroll_companies') is not null as ok
  union all
  select 2, 'La columna del empleado existe',
         coalesce((select data_type from information_schema.columns
                    where table_schema='public' and table_name='employees'
                      and column_name='payroll_company_id'), 'no existe'),
         exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='employees'
                    and column_name='payroll_company_id')
  union all
  select 3, 'Empresas de nómina creadas',
         (select count(*) from public.payroll_companies)::text,
         (select count(*) from public.payroll_companies) > 0
  union all
  select 4, 'Empleados ya agrupados en el filtro',
         (select count(*) from public.employees where payroll_company_id is not null)::text,
         (select count(*) from public.employees where payroll_company_id is not null) > 0
  union all
  -- ⭐ EL QUE IMPORTA: el catálogo general NO se tocó. Este número tiene que ser
  -- el mismo de antes de correr el script.
  select 5, '⭐ Empresas del CATÁLOGO GENERAL (este script NO las toca)',
         (select count(*) from public.companies)::text, true
  union all
  select 6, '⭐ La empresa REAL del empleado sigue intacta',
         (select count(*) from public.employees where company_id is not null)::text,
         true
  union all
  select 7, 'Empleados en total (este script NO los borra)',
         (select count(*) from public.employees)::text, true
  union all
  select 8, 'Sin empresa de filtro todavía (se les pone a mano en Empleados)',
         (select count(*) from public.employees where payroll_company_id is null)::text, true
) t order by n;


-- Cómo quedó repartida la gente en el filtro nuevo.
select coalesce(pc.name, '— sin empresa de filtro —') as empresa_filtro_nomina,
       count(*) as empleados
  from public.employees e
  left join public.payroll_companies pc on pc.id = e.payroll_company_id
 group by pc.name
 order by count(*) desc;


-- ============================================================================
-- DESHACER (solo si hay que revertir). Descomentar y correr aparte.
-- NO toca `companies` ni `employees.company_id`: el sistema queda como estaba.
-- ============================================================================
-- alter table public.employees drop column if exists payroll_company_id;
-- drop table if exists public.payroll_companies cascade;
