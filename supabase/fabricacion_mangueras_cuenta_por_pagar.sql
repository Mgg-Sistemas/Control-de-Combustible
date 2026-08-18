-- ============================================================================
-- FABRICACIÓN (Mangueras) → CUENTA POR PAGAR automática.
--
-- Pedido del cliente: "la creación de cada manguera automáticamente crea una
-- cuenta por pagar, asócialo".
--
-- Decisiones (confirmadas con el cliente):
--   1) El PROVEEDOR de la manguera pasa a ser un proveedor REAL del catálogo
--      `suppliers` (antes era texto libre). Es lo que exige una cuenta
--      'por_pagar' (supplier_id obligatorio). En la app se elige de la lista
--      (con opción de crear uno nuevo) y es obligatorio.
--   2) La cuenta queda SINCRONIZADA con la manguera: si cambia el costo se
--      actualiza el monto; si la manguera se marca PAGADA, la cuenta se salda.
--   3) CONVIVE con el flujo de pago propio de mangueras (Chelia aprueba):
--      la cuenta es el reflejo contable en el módulo Cuentas. Un solo dato,
--      dos vistas.
--
-- Idempotente: seguro de correr más de una vez. Requiere que ya existan las
-- tablas de `supabase/cuentas_por_pagar_y_cobrar.sql` y `hose_services`.
-- ============================================================================


-- ── 1) hose_services: proveedor REAL (suppliers) ────────────────────────────
-- machinery_id ya era opcional; ahora se agrega supplier_id (el proveedor al
-- que se le paga la confección). ON DELETE SET NULL: borrar un proveedor no
-- borra la manguera (además `cuentas` ya bloquea con RESTRICT borrar un
-- proveedor con deudas vivas).
alter table public.hose_services
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;
create index if not exists idx_hose_services_supplier on public.hose_services(supplier_id);


-- ── 2) cuentas: enlace de ORIGEN a la manguera (1 cuenta por manguera) ──────
-- Igual patrón que `order_id` (enlace suave a compras). ON DELETE SET NULL: si
-- algún día se borra la manguera, la deuda no desaparece. El índice único
-- PARCIAL garantiza una sola cuenta por manguera (permite varias filas con
-- hose_service_id NULL: las cuentas normales del módulo).
alter table public.cuentas
  add column if not exists hose_service_id uuid references public.hose_services(id) on delete set null;
create unique index if not exists cuentas_hose_service_uniq
  on public.cuentas(hose_service_id) where hose_service_id is not null;


-- ── 3) BEFORE: espejar el nombre del proveedor en `provider` (texto) ────────
-- La lista, la búsqueda y el reporte PDF leen `hose_services.provider` (texto).
-- Para no tener que reescribir esas vistas, se mantiene `provider` = nombre del
-- proveedor elegido. Las filas viejas (con provider en texto y sin supplier_id)
-- se quedan como están. SECURITY DEFINER para poder leer `suppliers`.
create or replace function public.hose_mirror_provider()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.supplier_id is not null then
    select name into new.provider from public.suppliers where id = new.supplier_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_hose_mirror_provider on public.hose_services;
create trigger trg_hose_mirror_provider
  before insert or update on public.hose_services
  for each row execute function public.hose_mirror_provider();


-- ── 4) AFTER: crear / sincronizar / saldar la CUENTA POR PAGAR asociada ─────
-- Una sola cuenta 'por_pagar' por manguera, al proveedor (supplier_id), por el
-- costo (cost_usd). Se crea al insertar y se re-sincroniza en cada UPDATE.
-- SECURITY DEFINER: la cuenta se genera aunque el usuario que registra la
-- manguera no tenga permiso del módulo 'cuentas' (es un reflejo automático).
create or replace function public.hose_sync_cuenta()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_concepto text;
begin
  -- Sin proveedor real o sin costo no hay cuenta (supplier_id es obligatorio en
  -- 'por_pagar'). Si luego se completan, un UPDATE la crea.
  if new.supplier_id is null or coalesce(new.cost_usd, 0) <= 0 then
    return new;
  end if;

  v_concepto := 'Fabricación de manguera ' || coalesce(new.code, '') ||
                case when coalesce(new.description, '') <> '' then ' · ' || new.description else '' end;

  insert into public.cuentas (
    tipo, supplier_id, company_id, concepto, documento, monto, moneda,
    fecha_emision, estado, nota, created_by, hose_service_id, settled_by, settled_at
  ) values (
    'por_pagar', new.supplier_id, null, v_concepto, new.code, new.cost_usd, 'USD',
    new.service_date,
    case when new.payment_status = 'pagado' then 'pagada' else 'pendiente' end,
    'Generada automáticamente desde Fabricación (manguera ' || coalesce(new.code, '') ||
      '). El monto se sincroniza con la manguera.',
    new.created_by, new.id,
    case when new.payment_status = 'pagado' then new.approved_by else null end,
    case when new.payment_status = 'pagado' then new.approved_at  else null end
  )
  on conflict (hose_service_id) where hose_service_id is not null
  do update set
    supplier_id   = excluded.supplier_id,
    concepto      = excluded.concepto,
    documento     = excluded.documento,
    monto         = excluded.monto,
    fecha_emision = excluded.fecha_emision,
    -- Se salda cuando la manguera queda PAGADA. No se reabre una cuenta que ya
    -- fue anulada a mano en el módulo Cuentas; si no está pagada ni anulada, se
    -- respeta su estado actual (p. ej. abonos parciales cargados aparte).
    estado = case
               when new.payment_status = 'pagado' then 'pagada'
               when cuentas.estado = 'anulada'    then 'anulada'
               else cuentas.estado
             end,
    settled_by = case when new.payment_status = 'pagado' then new.approved_by else cuentas.settled_by end,
    settled_at = case when new.payment_status = 'pagado' then new.approved_at  else cuentas.settled_at end,
    updated_at = now();

  return new;
end $$;

drop trigger if exists trg_hose_sync_cuenta on public.hose_services;
create trigger trg_hose_sync_cuenta
  after insert or update on public.hose_services
  for each row execute function public.hose_sync_cuenta();


-- ── 5) VERIFICACIÓN (correr después) ────────────────────────────────────────
-- 5.1 · Las columnas nuevas existen.
select 'hose_services.supplier_id' as col,
       exists (select 1 from information_schema.columns
               where table_schema='public' and table_name='hose_services' and column_name='supplier_id') as ok
union all
select 'cuentas.hose_service_id',
       exists (select 1 from information_schema.columns
               where table_schema='public' and table_name='cuentas' and column_name='hose_service_id');

-- 5.2 · Los triggers quedaron creados (deben aparecer los dos).
select tgname from pg_trigger
where tgrelid = 'public.hose_services'::regclass and not tgisinternal
order by tgname;

-- 5.3 · Cuentas por pagar generadas desde mangueras (tras registrar alguna).
select c.documento as manguera, s.name as proveedor, c.monto, c.estado, c.created_at
from public.cuentas c
join public.suppliers s on s.id = c.supplier_id
where c.hose_service_id is not null
order by c.created_at desc;
