-- ============================================================================
-- 🛒 MÓDULO DE COMPRAS: DATOS FINANCIEROS DE PROVEEDORES Y BUCLE DE COTIZACIÓN
--
-- 1) Datos Financieros de Proveedores en `suppliers`:
--    Banco, número de cuenta (20 dígitos), tipo, titular, documento titular,
--    Pago Móvil (banco, teléfono, cédula/RIF) y Binance Pay / Billetera.
--
-- 2) Bucle de Retroalimentación Técnica en `inventory_requirements`:
--    Aclaratoria técnica solicitada por Compras al solicitante (motivo, fecha,
--    quién la solicitó) y la respuesta técnica con su fecha.
--
-- 3) Empresa Pagadora en `inventory_requirements`:
--    Asignación explícita (Construcciones Liscioni / Golden Touch) antes del
--    envío a Tesorería / Módulo de Pagos.
--
-- Idempotente: se puede correr en Supabase SQL Editor sin riesgo.
-- ============================================================================

-- ── 1) Datos Financieros y Métodos de Pago en `suppliers` ──────────────────
alter table public.suppliers
  add column if not exists bank_name text,
  add column if not exists account_number text,
  add column if not exists account_type text,
  add column if not exists account_holder text,
  add column if not exists account_id_doc text,
  add column if not exists pago_movil_phone text,
  add column if not exists pago_movil_id text,
  add column if not exists pago_movil_bank text,
  add column if not exists binance_id text,
  add column if not exists payment_notes text;

-- Si existe la tabla contactos, sincronizamos las columnas para el espejo
do $$
begin
  if to_regclass('public.contactos') is not null then
    alter table public.contactos
      add column if not exists bank_name text,
      add column if not exists account_number text,
      add column if not exists account_type text,
      add column if not exists account_holder text,
      add column if not exists account_id_doc text,
      add column if not exists pago_movil_phone text,
      add column if not exists pago_movil_id text,
      add column if not exists pago_movil_bank text,
      add column if not exists binance_id text,
      add column if not exists payment_notes text;
  end if;
end $$;

-- ── 2) Aclaratorias Técnicas y Empresa Pagadora en `inventory_requirements` ──
alter table public.inventory_requirements
  add column if not exists aclaratoria_motivo text,
  add column if not exists aclaratoria_solicitada_por text,
  add column if not exists aclaratoria_fecha_solicitud timestamptz,
  add column if not exists aclaratoria_respuesta text,
  add column if not exists aclaratoria_fecha_respuesta timestamptz,
  add column if not exists empresa_pagadora_id uuid references public.companies(id) on delete set null,
  add column if not exists empresa_pagadora_nombre text;

-- Índice para filtrar rápido requerimientos en aclaratoria
create index if not exists idx_invreq_empresa_pagadora
  on public.inventory_requirements(empresa_pagadora_id);
