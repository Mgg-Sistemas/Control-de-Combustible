-- ============================================================================
-- NOTIFICACIONES IN-APP (campana) — se le reflejan SOLO al rol correspondiente.
-- Eventos que hoy notifican a los ADMIN:
--   · Inventario: se monta un REQUERIMIENTO (inventory_requirements).
--   · Compras: se crea una SOLICITUD de compra (purchase_requests).
--   · Control: se guarda un CIERRE de control (control_closures).
-- El texto se arma en la BD con triggers (dispara venga de donde venga el insert).
-- Idempotente: se puede correr las veces que haga falta.
-- ============================================================================

-- ── Tablas ──────────────────────────────────────────────────────────────────
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  type        text not null,                 -- 'requerimiento' | 'compra' | 'cierre_control' | ...
  title       text not null,                 -- encabezado corto
  body        text,                          -- detalle (empresa, código, quién, etc.)
  target_role text,                          -- audiencia por rol: 'admin' (todos los de ese rol lo ven)
  recipient_id uuid references auth.users(id) on delete cascade,  -- destinatario específico (opcional)
  entity_type text,                          -- a qué apunta (para "ir a…"): 'inventory_requirement', etc.
  entity_id   text,
  created_by  uuid references auth.users(id) on delete set null,  -- quién lo originó
  meta        jsonb not null default '{}'::jsonb
);
create index if not exists notifications_created_idx on public.notifications (created_at desc);
create index if not exists notifications_target_idx  on public.notifications (target_role);

-- Estado "leído" POR USUARIO (una notificación por rol la ven varios admins;
-- que uno la lea no la marca leída para los demás).
create table if not exists public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (notification_id, user_id)
);

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.notifications      enable row level security;
alter table public.notification_reads enable row level security;

-- Cada quien ve las notificaciones de SU rol o las dirigidas a él. Los admin ven todo.
drop policy if exists notif_select on public.notifications;
create policy notif_select on public.notifications for select to authenticated
  using (
    public.is_admin()
    or recipient_id = auth.uid()
    or (target_role is not null and target_role = public.current_role()::text)
  );

-- El insert lo hacen los triggers (SECURITY DEFINER). Se permite igual a staff por si
-- en el futuro se crean notificaciones desde el cliente.
drop policy if exists notif_insert on public.notifications;
create policy notif_insert on public.notifications for insert to authenticated
  with check (public.is_staff());

drop policy if exists notif_admin_all on public.notifications;
create policy notif_admin_all on public.notifications for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Cada usuario gestiona SOLO sus propias marcas de leído.
drop policy if exists notif_reads_all on public.notification_reads;
create policy notif_reads_all on public.notification_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Triggers que crean las notificaciones ───────────────────────────────────

-- Inventario: nuevo requerimiento → avisar a los admin.
create or replace function public.notify_new_requirement()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (type, title, body, target_role, entity_type, entity_id, created_by, meta)
  values (
    'requerimiento',
    'Nuevo requerimiento de inventario',
    concat_ws(' · ',
      nullif(NEW.code, ''),
      nullif(NEW.title, ''),
      case when NEW.requested_by_name is not null then 'Solicita: ' || NEW.requested_by_name end
    ),
    'admin',
    'inventory_requirement',
    NEW.id::text,
    NEW.requested_by,
    jsonb_build_object('code', NEW.code, 'status', NEW.status)
  );
  return NEW;
end $$;
drop trigger if exists trg_notify_new_requirement on public.inventory_requirements;
create trigger trg_notify_new_requirement
  after insert on public.inventory_requirements
  for each row execute function public.notify_new_requirement();

-- Compras: nueva solicitud de compra → avisar a los admin.
create or replace function public.notify_new_purchase()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_company text; v_by text;
begin
  select name      into v_company from public.companies where id = NEW.company_id;
  select full_name into v_by      from public.profiles  where id = NEW.requested_by;
  insert into public.notifications (type, title, body, target_role, entity_type, entity_id, created_by, meta)
  values (
    'compra',
    'Nueva solicitud de compra',
    concat_ws(' · ',
      case when v_company is not null then 'Empresa: ' || v_company end,
      nullif(NEW.category, ''),
      nullif(NEW.needed_for, ''),
      case when v_by is not null then 'Solicita: ' || v_by end
    ),
    'admin',
    'purchase_request',
    NEW.id::text,
    NEW.requested_by,
    jsonb_build_object('category', NEW.category, 'status', NEW.status)
  );
  return NEW;
end $$;
drop trigger if exists trg_notify_new_purchase on public.purchase_requests;
create trigger trg_notify_new_purchase
  after insert on public.purchase_requests
  for each row execute function public.notify_new_purchase();

-- Control: cierre guardado → avisar a los admin.
create or replace function public.notify_control_closure()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_from text; v_to text; v_n text; v_range text;
begin
  v_from := NEW.detail->>'dateFrom';
  v_to   := NEW.detail->>'dateTo';
  v_n    := NEW.detail->>'totalMachines';
  v_range := case when v_from is not null and v_to is not null and v_from <> v_to
                  then 'del ' || v_from || ' al ' || v_to
                  else 'del ' || coalesce(v_to, NEW.closure_date::text) end;
  insert into public.notifications (type, title, body, target_role, entity_type, entity_id, created_by, meta)
  values (
    'cierre_control',
    'Cierre de control guardado',
    concat_ws(' · ', v_range, case when v_n is not null then v_n || ' máquina(s)' end),
    'admin',
    'control_closure',
    NEW.id::text,
    NEW.closed_by,
    jsonb_build_object('dateFrom', v_from, 'dateTo', v_to)
  );
  return NEW;
end $$;
drop trigger if exists trg_notify_control_closure on public.control_closures;
create trigger trg_notify_control_closure
  after insert on public.control_closures
  for each row execute function public.notify_control_closure();

-- ── Realtime: que la campana se actualice sola ──────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['notifications', 'notification_reads'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; when others then null;
    end;
  end loop;
end $$;
