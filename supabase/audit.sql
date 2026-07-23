-- ============================================================================
-- AUDITORÍA / BITÁCORA: quién hace qué (crear / modificar / eliminar) y cuándo.
-- Visible SOLO para quien tenga la bandera profiles.can_audit = true.
-- ============================================================================

-- 1) Bandera de acceso a la auditoría (por ahora, solo Angelica).
alter table public.profiles add column if not exists can_audit boolean not null default false;
update public.profiles set can_audit = true where btrim(cedula) = '27514385';

-- 2) Tabla de bitácora.
create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  user_id    uuid,
  user_name  text,
  action     text not null,          -- INSERT | UPDATE | DELETE
  table_name text not null,
  row_id     text
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);
create index if not exists audit_log_user_idx on public.audit_log (user_id);

alter table public.audit_log enable row level security;
-- Solo quien tiene can_audit puede LEER la bitácora.
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.can_audit));
-- Nadie inserta directo desde el cliente: solo lo escribe el trigger (security definer).

-- 3) Función genérica de trigger: registra quién, qué acción, en qué tabla y fila.
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare uname text; rid text;
begin
  select full_name into uname from public.profiles where id = auth.uid();
  rid := coalesce(to_jsonb(NEW)->>'id', to_jsonb(OLD)->>'id');
  insert into public.audit_log(user_id, user_name, action, table_name, row_id)
  values (auth.uid(), uname, TG_OP, TG_TABLE_NAME, rid);
  return case when TG_OP = 'DELETE' then OLD else NEW end;
end $$;

-- 4) Adjuntar el trigger a las tablas de NEGOCIO (las que existan).
do $$
declare t text;
begin
  foreach t in array array[
    'machinery','dispatches','fuel_intakes','transfers','maintenance_requests',
    'machinery_repairs','machine_rounds','inventory_items','inventory_movements',
    'inventory_transfers','companies','profiles','employees','aliados',
    'company_payments','truck_yard_logs','app_roles','control_closures','tanks',
    'authorizations','price_tariffs','company_price_tariffs','supervisor_visits',
    'food_distributions','food_company_meals','attendance','uniform_deliveries',
    'operator_assignments','module_permissions','purchase_orders','purchase_requests',
    'staff_pay_payments','vehicles','fletes'
  ] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists trg_audit on public.%I;', t);
      execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.audit_row();', t);
    end if;
  end loop;
end $$;
