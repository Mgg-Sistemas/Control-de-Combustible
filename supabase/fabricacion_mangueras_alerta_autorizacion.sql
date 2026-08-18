-- ============================================================================
-- ALERTA de MANGUERA "PENDIENTE POR AUTORIZACIÓN" — igual que Requerimientos.
--
-- Pedido del cliente: al enviar una manguera a autorización de pago, que genere
-- la alerta (campana) como la que ya existe cuando se crea un requerimiento de
-- compra (supabase/notifications.sql → trg_notify_new_purchase).
--
-- Mecanismo idéntico: un trigger inserta una fila en `public.notifications`
-- (target_role 'admin') cuando `hose_services.payment_status` PASA a
-- 'en_proceso_autorizacion'. Solo dispara en la TRANSICIÓN (no cada UPDATE).
-- Idempotente: seguro de correr más de una vez.
-- ============================================================================

create or replace function public.notify_hose_authorization()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_maquina text;
  v_prov    text;
begin
  -- Solo cuando ENTRA a "pendiente por autorización" (no en cada guardado).
  if NEW.payment_status is distinct from 'en_proceso_autorizacion' then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and OLD.payment_status = 'en_proceso_autorizacion' then
    return NEW; -- ya estaba en ese estado: no volver a avisar
  end if;

  -- Máquina (de la flota) o cliente externo, para el cuerpo del aviso.
  if NEW.is_external then
    v_maquina := coalesce(nullif(btrim(NEW.external_client), ''), 'Externa');
  else
    select code into v_maquina from public.machinery where id = NEW.machinery_id;
  end if;
  select name into v_prov from public.suppliers where id = NEW.supplier_id;

  insert into public.notifications (type, title, body, target_role, entity_type, entity_id, created_by, meta)
  values (
    'manguera_autorizacion',
    'Manguera pendiente por autorización de pago',
    concat_ws(' · ',
      'Fabricación ' || coalesce(NEW.code, ''),
      case when v_maquina is not null then 'Máquina: ' || v_maquina end,
      'Costo: US$ ' || to_char(coalesce(NEW.cost_usd, 0), 'FM999999990.00'),
      case when coalesce(v_prov, NEW.provider) is not null then 'Proveedor: ' || coalesce(v_prov, NEW.provider) end
    ),
    'admin',
    'hose_service',
    NEW.id::text,
    NEW.created_by,
    jsonb_build_object('code', NEW.code, 'cost_usd', NEW.cost_usd, 'payment_status', NEW.payment_status)
  );
  return NEW;
end $$;

drop trigger if exists trg_notify_hose_authorization on public.hose_services;
create trigger trg_notify_hose_authorization
  after insert or update of payment_status on public.hose_services
  for each row execute function public.notify_hose_authorization();

-- Verificación: el trigger quedó creado.
select tgname from pg_trigger
where tgrelid = 'public.hose_services'::regclass and tgname = 'trg_notify_hose_authorization';
