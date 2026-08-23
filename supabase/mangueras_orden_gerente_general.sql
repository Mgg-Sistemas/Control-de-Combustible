-- ============================================================================
-- MANGUERAS · aprobación "bajo orden del Gerente General" (ALMACENISTA) — 2026-08-23
--
-- Pedido del cliente: el/la ALMACENISTA (Diana de la Rans) puede aprobar el pago de
-- mangueras SOLO marcando un check "Autorizado bajo orden del Gerente General". Ese
-- check solo le aparece a ella (rol app 'ALMACENISTA'); sin marcarlo NO puede aprobar.
-- Al aprobar así, el PDF de autorización lo indica junto a la firma del Gerente General.
--
-- Aquí solo se agrega la columna que GUARDA esa marca por manguera. El gate (solo
-- almacenista, obligatorio para aprobar) y el texto del PDF van en la app.
-- Idempotente.
-- ============================================================================

alter table public.hose_services
  add column if not exists orden_gg boolean not null default false;

-- ── VERIFICACIÓN ────────────────────────────────────────────────────────────
select 'hose_services.orden_gg' as col,
       exists (select 1 from information_schema.columns
               where table_schema='public' and table_name='hose_services' and column_name='orden_gg') as ok;
