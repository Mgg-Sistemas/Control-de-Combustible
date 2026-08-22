-- ============================================================================
-- Módulo de Fabricación (MRP) — Fase 5: Candado real de Calidad, horas
-- acumuladas por Centro de Trabajo + alerta preventiva de mantenimiento del
-- taller, y vista de OEE (Efectividad Total de Equipos).
--
-- Este archivo es 100% ADITIVO:
--   - No modifica, ni borra, ni renombra ninguna tabla/columna existente.
--   - Todo lo nuevo son: 1 trigger sobre work_orders (ya existente, sin
--     cambiar su forma), 2 columnas nullable-con-default sobre work_centers
--     (ya existente), 1 función + 2 triggers nuevos, 1 vista nueva
--     (wo_oee, sin tabla nueva detrás — mismo espíritu que tank_levels /
--     inventory_levels), y 1 columna + 1 relajación de NOT NULL + 1 check
--     constraint sobre maintenance_requests (ya existente y ya poblada).
--
-- ⚠️  AVISO IMPORTANTE — RESPALDO ANTES DE CORRER EN PRODUCCIÓN ⚠️
--   La sección 3 de este archivo ALTERA la tabla `maintenance_requests`, que
--   ya existe y ya tiene datos: relaja `machinery_id` de NOT NULL a nullable
--   y agrega un CHECK constraint nuevo. Relajar un NOT NULL nunca borra ni
--   modifica datos (es lógicamente seguro: toda fila que hoy cumple
--   "machinery_id IS NOT NULL" sigue cumpliendo el nuevo CHECK sin problema),
--   pero por política del equipo, cualquier ALTER sobre una tabla productiva
--   con datos reales debe ir precedido de un respaldo. Antes de correr este
--   archivo en producción: exportar/backup de `public.maintenance_requests`
--   (ej. `pg_dump -t public.maintenance_requests` o un `select * into` /
--   snapshot desde Supabase Studio) igual que se hizo para maquinaria (ver
--   supabase/backup-maquinaria-2026-07-11.json como referencia del criterio).
--
-- Idempotente: usa `add column if not exists`, `create or replace` en
-- funciones/vistas, un DO guardado para el CHECK constraint (Postgres no
-- soporta `add constraint if not exists`), y `drop trigger if exists` antes
-- de recrear triggers. Seguro de correr más de una vez.
--
-- Convenciones seguidas (ver fabricacion_ordenes.sql, fabricacion_maestros.sql
-- y horometro_alertas.sql, que es el patrón exacto que se replica para la
-- alerta de horas acumuladas del centro de trabajo):
--   - RLS: no se crean tablas nuevas en este archivo, así que no hace falta
--     política nueva; work_orders/work_centers/maintenance_requests ya tienen
--     la suya y siguen intactas. La vista wo_oee no lleva RLS propia: al
--     igual que tank_levels/inventory_levels, corre con los privilegios del
--     usuario que consulta y hereda la RLS de work_orders/work_centers.
--   - Notificaciones: mismo shape de `public.notifications` (columnas type,
--     title, body, target_role, entity_type, entity_id, meta — confirmado en
--     supabase/notifications.sql) y mismo mecanismo de dedup diario por
--     (type, entity_id, fecha) que usa `check_horometro_alerta()` en
--     supabase/horometro_alertas.sql.
-- ============================================================================

-- ============================================================================
-- 1) CANDADO REAL DE CALIDAD sobre work_orders.
--    Hoy el bloqueo de "Completar" solo vive en la app (WorkOrdersScreen /
--    PlantaKioskScreen no dejan tocar el botón), pero nada impedía un UPDATE
--    directo a la tabla. Este trigger lo blinda a nivel de base de datos:
--    rechaza cualquier UPDATE que deje status='completada' en una WO que es
--    checkpoint de calidad (is_quality_checkpoint = true) mientras su
--    resultado de calidad SIGUE pendiente.
--
--    Vía de escape (la única, y es la legítima): si el mismo UPDATE también
--    trae qc_result cambiando a 'aprobado' o 'rechazado' en el mismo
--    statement, entonces NEW.qc_result YA NO es 'pendiente' en el momento en
--    que corre el trigger (BEFORE UPDATE ve los valores finales de esa fila
--    para ese statement) — así que el chequeo de abajo lo deja pasar sin
--    necesitar ningún caso especial. Esto es exactamente "aprobar primero,
--    luego completar" (que la app ya hace en dos pasos separados) colapsado
--    en un único UPDATE, y es la única forma de evadir el candado: no hay
--    bypass por rol ni ninguna otra excepción.
-- ============================================================================
create or replace function public.check_wo_quality_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.status = 'completada'
     and NEW.is_quality_checkpoint = true
     and NEW.qc_result = 'pendiente' then
    raise exception 'No se puede completar: este paso requiere aprobación de calidad primero.';
  end if;
  return NEW;
end $$;

drop trigger if exists trg_check_wo_quality_gate on public.work_orders;
create trigger trg_check_wo_quality_gate
  before update on public.work_orders
  for each row
  when (NEW.status = 'completada')
  execute function public.check_wo_quality_gate();

-- ============================================================================
-- 2) HORAS ACUMULADAS POR CENTRO DE TRABAJO + ALERTA PREVENTIVA DE
--    MANTENIMIENTO DEL TALLER (mismo concepto que machinery.horometro_base /
--    machinery.last_horometro en supabase/horometro_alertas.sql, pero para
--    work_centers: aquí no hay un horómetro físico que leer, así que las
--    horas se derivan de wo_time_logs en vez de venir de un sensor/reporte).
-- ============================================================================

-- "Marca cero" desde donde se cuentan horas para la próxima alerta.
alter table public.work_centers
  add column if not exists horometro_base numeric(12,2) not null default 0;
comment on column public.work_centers.horometro_base is
  'Marca "cero" de horas acumuladas del centro de trabajo, para la próxima alerta de mantenimiento preventivo del taller. Mismo concepto que machinery.horometro_base.';

-- Horas acumuladas reales, recalculadas por recalc_work_center_hours().
alter table public.work_centers
  add column if not exists accumulated_hours numeric(12,2) not null default 0;
comment on column public.work_centers.accumulated_hours is
  'Horas acumuladas reales del centro de trabajo, sumadas de los períodos inicio→fin en wo_time_logs. Recalculada automáticamente (ver recalc_work_center_hours / trg_wo_time_logs_recalc_wc). Horas desde el último mantenimiento = accumulated_hours - horometro_base.';

-- ----------------------------------------------------------------------------
-- 2.a) Recalcula accumulated_hours de UN centro de trabajo, sumando la
--      duración de los períodos 'inicio'→'fin' (o 'inicio'→ahora si la WO
--      sigue abierta) en wo_time_logs, para todas las WOs de ese centro.
--      Simple a propósito (es una alerta preventiva, no nómina): no separa
--      pausas dentro del período inicio→fin, solo mide el tramo completo.
-- ----------------------------------------------------------------------------
create or replace function public.recalc_work_center_hours(wc_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_seconds numeric := 0;
  v_open_at       timestamptz;
  v_current_wo    uuid;
  r               record;
begin
  for r in
    select tl.wo_id, tl.event, tl.created_at
      from public.wo_time_logs tl
      join public.work_orders wo on wo.id = tl.wo_id
     where wo.work_center_id = wc_id
       and tl.event in ('inicio', 'fin')
     order by tl.wo_id, tl.created_at, tl.id
  loop
    if v_current_wo is distinct from r.wo_id then
      -- Cambia de WO: si la WO anterior quedó con un 'inicio' sin 'fin'
      -- (sigue en proceso), cuenta su tramo abierto hasta ahora antes de
      -- perder el cursor.
      if v_open_at is not null then
        v_total_seconds := v_total_seconds + extract(epoch from (now() - v_open_at));
      end if;
      v_current_wo := r.wo_id;
      v_open_at := null;
    end if;

    if r.event = 'inicio' then
      v_open_at := r.created_at;
    elsif r.event = 'fin' and v_open_at is not null then
      v_total_seconds := v_total_seconds + extract(epoch from (r.created_at - v_open_at));
      v_open_at := null;
    end if;
  end loop;

  -- Última WO recorrida: si quedó abierta (inicio sin fin), cuenta hasta ahora.
  if v_open_at is not null then
    v_total_seconds := v_total_seconds + extract(epoch from (now() - v_open_at));
  end if;

  update public.work_centers
     set accumulated_hours = round(v_total_seconds / 3600.0, 2)
   where id = wc_id;
end $$;

-- ----------------------------------------------------------------------------
-- 2.b) Cada evento relevante de wo_time_logs (inicio/fin/pausa/reanudacion)
--      dispara el recálculo del centro de trabajo de la WO correspondiente.
-- ----------------------------------------------------------------------------
create or replace function public.trg_wo_time_logs_recalc_wc_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_wc uuid;
begin
  if NEW.event not in ('inicio', 'fin', 'pausa', 'reanudacion') then
    return NEW;
  end if;

  select work_center_id into v_wc from public.work_orders where id = NEW.wo_id;
  if v_wc is not null then
    perform public.recalc_work_center_hours(v_wc);
  end if;

  return NEW;
end $$;

drop trigger if exists trg_wo_time_logs_recalc_wc on public.wo_time_logs;
create trigger trg_wo_time_logs_recalc_wc
  after insert on public.wo_time_logs
  for each row execute function public.trg_wo_time_logs_recalc_wc_fn();

-- ----------------------------------------------------------------------------
-- 2.c) Alerta preventiva: cuando accumulated_hours - horometro_base cruza un
--      umbral fijo (250 h, mismo orden de magnitud que el nivel "ALTA" de
--      check_horometro_alerta() en supabase/horometro_alertas.sql — aquí se
--      usa un solo nivel a propósito para mantenerlo simple), inserta UNA
--      notificación dirigida a 'admin'. Dedup diario por (type, entity_id,
--      fecha), copiado literal del mecanismo de horometro_alertas.sql: si ya
--      se avisó de este centro de trabajo hoy, no duplica.
-- ----------------------------------------------------------------------------
create or replace function public.check_work_center_horometro_alerta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_horas  numeric;
  v_exists boolean;
begin
  v_horas := NEW.accumulated_hours - coalesce(NEW.horometro_base, 0);
  if v_horas is null or v_horas < 250 then
    return NEW;
  end if;

  -- Dedup diario: si YA se avisó de este centro de trabajo hoy, no duplica.
  select exists(
    select 1 from public.notifications
     where type = 'mantenimiento_taller_alerta'
       and entity_id = NEW.id::text
       and created_at::date = (now() at time zone 'America/Caracas')::date
  ) into v_exists;
  if v_exists then return NEW; end if;

  insert into public.notifications (type, title, body, target_role, entity_type, entity_id, meta)
  values (
    'mantenimiento_taller_alerta',
    'Centro de trabajo próximo a mantenimiento preventivo',
    concat_ws(' · ', NEW.name, 'Horas acumuladas: ' || round(v_horas, 1) || ' h'),
    'admin', 'work_center', NEW.id::text,
    jsonb_build_object('horas', round(v_horas, 1), 'code', NEW.code)
  );

  return NEW;
end $$;

drop trigger if exists trg_check_work_center_horometro_alerta on public.work_centers;
create trigger trg_check_work_center_horometro_alerta
  after update of accumulated_hours, horometro_base on public.work_centers
  for each row
  when (NEW.accumulated_hours is distinct from OLD.accumulated_hours
        or NEW.horometro_base is distinct from OLD.horometro_base)
  execute function public.check_work_center_horometro_alerta();

-- ============================================================================
-- 3) MANTENIMIENTO DEL TALLER, reutilizando `maintenance_requests` (SIN tabla
--    nueva). Ver aviso de respaldo al inicio del archivo: esta sección altera
--    una tabla EXISTENTE y ya poblada.
--
--    Hoy `machinery_id` es NOT NULL (confirmado en supabase/schema.sql, tabla
--    maintenance_requests: `machinery_id uuid not null references
--    public.machinery(id) on delete cascade`). Se relaja a nullable para
--    poder registrar mantenimientos de un CENTRO DE TRABAJO (work_center_id)
--    en vez de una máquina, y se agrega un CHECK para que toda fila siga
--    apuntando a algo (máquina O centro de trabajo, nunca ninguno de los dos).
-- ============================================================================
alter table public.maintenance_requests
  add column if not exists work_center_id uuid references public.work_centers(id) on delete set null;

create index if not exists idx_maint_work_center on public.maintenance_requests(work_center_id);

-- Relaja NOT NULL: operación lógicamente segura, no borra ni toca datos (toda
-- fila existente ya tiene machinery_id no nulo, así que sigue exactamente
-- igual). Solo permite que FUTURAS filas puedan traer machinery_id en NULL
-- cuando el mantenimiento es de un centro de trabajo.
alter table public.maintenance_requests
  alter column machinery_id drop not null;

-- CHECK constraint: toda fila debe apuntar a máquina o a centro de trabajo.
-- Postgres no soporta `add constraint if not exists`, así que se guarda con
-- un DO que revisa pg_constraint antes de agregarlo (idempotente).
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'maintenance_requests_target_chk'
       and conrelid = 'public.maintenance_requests'::regclass
  ) then
    alter table public.maintenance_requests
      add constraint maintenance_requests_target_chk
      check (machinery_id is not null or work_center_id is not null);
  end if;
end $$;

-- ============================================================================
-- 4) VISTA DE OEE (Overall Equipment Effectiveness / Efectividad Total de
--    Equipos), por WO (consultable por centro de trabajo y por rango de
--    fecha filtrando sobre created_at/started_at). Vista derivada, sin tabla
--    nueva, sin duplicar datos — mismo espíritu que tank_levels /
--    inventory_levels.
--
--    A propósito NO calcula el % final de OEE (Disponibilidad × Rendimiento
--    × Calidad): solo expone los insumos crudos para que la APP calcule esos
--    porcentajes del lado del cliente, con la fórmula/redondeo que decida:
--      - en_proceso_seconds: tiempo total en estado "corriendo" (tramos que
--        arrancan con 'inicio' o 'reanudacion') dentro de la vida de la WO.
--      - pausada_seconds: tiempo total en estado "pausada"/detenida (tramos
--        que arrancan con 'pausa'), incluye paradas por falla registradas
--        como pausa.
--      - fallas_count: cantidad de eventos 'falla' registrados en la WO.
--      - qty_planned / qty_completed / qty_scrap: ya vienen de work_orders.
-- ============================================================================
create or replace view public.wo_oee as
with events as (
  select
    tl.wo_id,
    tl.event,
    tl.created_at,
    lead(tl.created_at) over (partition by tl.wo_id order by tl.created_at, tl.id) as next_at
  from public.wo_time_logs tl
  where tl.event in ('inicio', 'pausa', 'reanudacion', 'fin')
),
durations as (
  select
    wo_id,
    case when event in ('inicio', 'reanudacion')
         then extract(epoch from (coalesce(next_at, now()) - created_at))
         else 0
    end as en_proceso_seconds,
    case when event = 'pausa'
         then extract(epoch from (coalesce(next_at, now()) - created_at))
         else 0
    end as pausada_seconds
  from events
),
agg as (
  select
    wo_id,
    sum(en_proceso_seconds) as en_proceso_seconds,
    sum(pausada_seconds)    as pausada_seconds
  from durations
  group by wo_id
),
fallas as (
  select wo_id, count(*) as fallas_count
    from public.wo_time_logs
   where event = 'falla'
   group by wo_id
)
select
  wo.id                 as wo_id,
  wo.mo_id,
  wo.wo_no,
  wo.name               as wo_name,
  wo.work_center_id,
  wc.code               as work_center_code,
  wc.name               as work_center_name,
  wo.status,
  wo.qty_planned,
  wo.qty_completed,
  wo.qty_scrap,
  wo.started_at,
  wo.ended_at,
  wo.created_at,
  coalesce(agg.en_proceso_seconds, 0)::numeric(14,2) as en_proceso_seconds,
  coalesce(agg.pausada_seconds, 0)::numeric(14,2)    as pausada_seconds,
  coalesce(fallas.fallas_count, 0)                   as fallas_count
from public.work_orders wo
left join public.work_centers wc on wc.id = wo.work_center_id
left join agg    on agg.wo_id = wo.id
left join fallas on fallas.wo_id = wo.id;
