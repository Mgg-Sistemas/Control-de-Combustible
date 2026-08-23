-- ============================================================================
-- MANGUERAS · nuevo estatus de pago 'modificada_aprobada'
--
-- Pedido del cliente: poder EDITAR una manguera UNA VEZ APROBADA y que su estatus
-- quede como "MODIFICADA Y APROBADA" (sigue aprobada; solo deja constancia de que
-- se editó después de la aprobación).
--
-- Solo hay que AMPLIAR el CHECK de payment_status. NO hace falta tocar los triggers
-- de cuenta por pagar/cobrar (fabricacion_mangueras_cuenta_por_pagar.sql /
-- mangueras_cuenta_por_cobrar.sql): su rama `else` ya CONSERVA el estado y el
-- settled_by/at actuales cuando payment_status no es exactamente 'pagado'. Como a
-- 'modificada_aprobada' solo se llega EDITANDO una manguera que YA estaba pagada
-- (su cuenta ya está 'pagada'), el reflejo contable se mantiene saldado y solo se
-- re-sincroniza el monto/concepto si cambiaron.
--
-- Idempotente: seguro de correr más de una vez.
-- ============================================================================

-- El CHECK es inline en la tabla, así que su nombre lo generó Postgres. Se elimina
-- CUALQUIER check que aplique sobre payment_status (por nombre convencional y, por si
-- acaso, cualquier otro que mencione la columna) y se recrea uno con nombre estable.
do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'hose_services'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%payment_status%'
  loop
    execute format('alter table public.hose_services drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.hose_services
  add constraint hose_services_payment_status_check
  check (payment_status in ('pendiente', 'en_proceso_autorizacion', 'pagado', 'modificada_aprobada'));

-- ── VERIFICACIÓN (correr después) ───────────────────────────────────────────
-- Debe listar el nuevo check con los 4 valores permitidos.
select con.conname, pg_get_constraintdef(con.oid) as definicion
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and rel.relname = 'hose_services'
  and con.contype = 'c'
  and pg_get_constraintdef(con.oid) ilike '%payment_status%';
