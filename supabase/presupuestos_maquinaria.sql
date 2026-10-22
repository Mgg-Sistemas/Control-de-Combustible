-- ============================================================================
-- TABLA DE PRESUPUESTOS Y COTIZACIONES DE MAQUINARIA (2026-10-22)
--
-- Almacena presupuestos y cotizaciones de alquiler de maquinaria emitidas
-- por las empresas del grupo (GOLDEN TOUCH, JHENZAEN, etc.) a clientes.
--
-- Idempotente. Correr en Supabase → SQL Editor.
-- ============================================================================

create table if not exists public.machinery_quotes (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null,                                -- PRES-0001
  company_id            uuid references public.companies(id) on delete set null,
  company_name          text not null,
  company_rif           text,
  client_id             uuid references public.contacts(id) on delete set null,
  client_name           text not null,
  client_doc            text,
  client_phone          text,
  client_email          text,
  client_address        text,
  client_contact_person text,
  project_name          text,
  date                  date not null default current_date,
  valid_until           date not null,
  items                 jsonb not null default '[]'::jsonb,
  subtotal              numeric(14,2) not null default 0,
  con_iva               boolean not null default false,
  iva_pct               numeric(6,2) not null default 0,
  iva_monto             numeric(14,2) not null default 0,
  total                 numeric(14,2) not null default 0,
  rate_bs               numeric(14,4) not null default 0,
  total_bs              numeric(16,2) not null default 0,
  conditions            jsonb not null default '{}'::jsonb,
  status                text not null default 'emitido'
                        check (status in ('borrador','emitido','aceptado','rechazado','vencido')),
  status_note           text,
  logos                 jsonb not null default '[]'::jsonb,
  incluir_logos         boolean not null default true,
  created_by            uuid references public.profiles(id) on delete set null,
  created_by_name       text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz
);

create unique index if not exists machinery_quotes_code_key on public.machinery_quotes (code);
create index if not exists machinery_quotes_date_idx on public.machinery_quotes (date);
create index if not exists machinery_quotes_company_idx on public.machinery_quotes (company_id);
create index if not exists machinery_quotes_client_idx on public.machinery_quotes (client_id);
create index if not exists machinery_quotes_status_idx on public.machinery_quotes (status);

-- RLS
alter table public.machinery_quotes enable row level security;

drop policy if exists "machinery_quotes_read" on public.machinery_quotes;
create policy "machinery_quotes_read" on public.machinery_quotes
  for select using (auth.role() = 'authenticated');

drop policy if exists "machinery_quotes_write" on public.machinery_quotes;
create policy "machinery_quotes_write" on public.machinery_quotes
  for all using (auth.role() = 'authenticated');
