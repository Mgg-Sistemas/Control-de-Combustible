-- ============================================================================
-- MANGUERAS · TODOS los encargados generan cuenta por cobrar — 2026-08-23
--
-- Cambio de regla del cliente: antes el encargado CHELI (GT) con `cobrar=false` NO
-- generaba cuenta por cobrar. AHORA SÍ: toda manguera con empresa + encargado + costo
-- genera su cuenta por cobrar, sin importar el flag `cobrar` del encargado.
--
-- Solo re-crea `hose_sync_cuenta_cobrar` quitando la condición del flag `cobrar`.
-- El resto igual (empresa/encargado/costo siguen siendo obligatorios para poder
-- emitir una cuenta por cobrar). Idempotente. Backfill al final dispara el trigger
-- sobre las mangueras existentes para crear las cuentas que faltaban (CHELI).
-- ============================================================================

create or replace function public.hose_sync_cuenta_cobrar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_empresa  text;
  v_monto    numeric(14,2);
  v_concepto text;
begin
  select he.name into v_empresa from public.hose_empresas he where he.id = new.hose_empresa_id;

  -- Ya NO se mira encargado.cobrar: todos generan cuenta por cobrar. Solo se exige
  -- empresa + encargado + costo (sin eso no hay a quién/ cuánto cobrar).
  if new.hose_empresa_id is null
     or new.encargado_id is null
     or coalesce(new.cost_usd, 0) <= 0
     or coalesce(trim(v_empresa), '') = '' then
    update public.cuentas
       set estado = 'anulada', updated_at = now()
     where hose_service_id = new.id and tipo = 'por_cobrar' and estado <> 'anulada';
    return new;
  end if;

  v_monto := round(new.cost_usd * (1 + coalesce(new.sale_margin_pct, 0) / 100.0), 2);

  v_concepto := 'Cobro de manguera ' || coalesce(new.code, '') ||
                case when coalesce(new.description, '') <> '' then ' · ' || new.description else '' end ||
                ' (costo ' || to_char(new.cost_usd, 'FM999999990.00') ||
                ' + ' || to_char(coalesce(new.sale_margin_pct, 0), 'FM990.00') || '% margen)';

  insert into public.cuentas (
    tipo, supplier_id, company_id, contraparte, concepto, documento, monto, moneda,
    fecha_emision, estado, nota, created_by, hose_service_id
  ) values (
    'por_cobrar', null, null, v_empresa, v_concepto, new.code, v_monto, 'USD',
    new.service_date, 'pendiente',
    'Generada automáticamente desde Fabricación (manguera ' || coalesce(new.code, '') ||
      '). Empresa de mangueras "' || v_empresa || '". Monto = costo + margen.',
    new.created_by, new.id
  )
  on conflict (hose_service_id, tipo) where hose_service_id is not null
  do update set
    company_id    = null,
    contraparte   = excluded.contraparte,
    concepto      = excluded.concepto,
    documento     = excluded.documento,
    monto         = excluded.monto,
    fecha_emision = excluded.fecha_emision,
    estado = case when cuentas.estado = 'pagada' then 'pagada' else 'pendiente' end,
    updated_at = now();

  return new;
end $$;

-- El trigger ya existe (trg_hose_sync_cuenta_cobrar); CREATE OR REPLACE de la función
-- basta. Por si acaso, se re-asegura:
drop trigger if exists trg_hose_sync_cuenta_cobrar on public.hose_services;
create trigger trg_hose_sync_cuenta_cobrar
  after insert or update on public.hose_services
  for each row execute function public.hose_sync_cuenta_cobrar();

-- ── BACKFILL: crear las cuentas por cobrar que faltaban (encargados CHELI) ───
-- Un no-op que dispara el trigger sobre las mangueras que tienen empresa+encargado+costo
-- y todavía no tienen cuenta por cobrar viva.
update public.hose_services h
   set sale_margin_pct = h.sale_margin_pct   -- no-op: solo dispara el trigger (no hay updated_at)
 where h.hose_empresa_id is not null
   and h.encargado_id is not null
   and coalesce(h.cost_usd, 0) > 0
   and not exists (
     select 1 from public.cuentas c
     where c.hose_service_id = h.id and c.tipo = 'por_cobrar' and c.estado <> 'anulada'
   );

-- ── VERIFICACIÓN ────────────────────────────────────────────────────────────
select c.documento as manguera, c.contraparte as empresa, c.monto, c.estado
from public.cuentas c
where c.hose_service_id is not null and c.tipo = 'por_cobrar'
order by c.created_at desc;
