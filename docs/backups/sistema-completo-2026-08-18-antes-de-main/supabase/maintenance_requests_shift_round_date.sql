-- ============================================================================
-- maintenance_requests: fija `shift` y `round_date` en el momento de creación,
-- calculados en el SERVIDOR con la misma regla de negocio que usa el resto del
-- sistema (día 7am–19h Caracas / noche 19h–7am, y el "día de negocio" del turno
-- noche pertenece al día en que arrancó — igual que caracasBusinessToday() en
-- src/lib/caracasDay.ts y machine_work_segments.round_date/shift).
--
-- Por qué: hoy la clasificación día/noche de una avería o parada se re-infiere
-- SIEMPRE a partir de `created_at` en el cliente (SupervisorScreen.tsx,
-- InspectionsSummary.tsx), cada uno con su propia copia de la lógica. Con esto,
-- el valor queda fijado en la fila al insertar y cualquier consulta (reporte,
-- cron, SQL directo) puede leerlo en vez de re-derivarlo.
--
-- Aditivo, idempotente. Correr una sola vez en Supabase → SQL Editor.
-- No cambia el comportamiento de la UI (que sigue re-derivando por compatibilidad
-- con filas viejas); solo agrega la fuente de verdad en la base de datos.
-- ============================================================================

alter table public.maintenance_requests add column if not exists shift text;
alter table public.maintenance_requests add column if not exists round_date date;

do $$
begin
  begin
    alter table public.maintenance_requests
      add constraint maintenance_requests_shift_check check (shift in ('day','night'));
  exception when duplicate_object then null;
  end;
end $$;

create index if not exists idx_maint_round_date on public.maintenance_requests(round_date);

-- Calcula shift/round_date de un timestamptz según hora Caracas (UTC-4 fijo, sin
-- horario de verano), con el mismo criterio que caracasBusinessToday() del cliente:
-- turno día 7am–19h → round_date = fecha calendario Caracas; turno noche
-- (19h–7am, cruza medianoche) → round_date = fecha en que arrancó el turno
-- (la fecha calendario Caracas si son >=19h, o la fecha calendario Caracas menos
-- 1 día si son <7h, porque esa madrugada todavía pertenece a la noche de ayer).
create or replace function public.maintenance_request_shift_round_date(p_created_at timestamptz)
returns table (shift text, round_date date)
language sql
immutable
as $$
  select
    case when h >= 7 and h < 19 then 'day' else 'night' end,
    case when h >= 7 then d else d - 1 end
  from (
    select
      extract(hour from (p_created_at at time zone 'America/Caracas'))::int as h,
      (p_created_at at time zone 'America/Caracas')::date as d
  ) x;
$$;

create or replace function public.maintenance_requests_set_shift_round_date()
returns trigger
language plpgsql
as $$
begin
  if new.shift is null or new.round_date is null then
    select shift, round_date into new.shift, new.round_date
    from public.maintenance_request_shift_round_date(new.created_at);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_maintenance_requests_shift_round_date on public.maintenance_requests;
create trigger trg_maintenance_requests_shift_round_date
  before insert on public.maintenance_requests
  for each row execute function public.maintenance_requests_set_shift_round_date();

-- Backfill de filas existentes (no pisa nada si ya tienen shift/round_date).
-- Nota: no se llama a maintenance_request_shift_round_date(mr.created_at) dentro
-- del FROM de un UPDATE (Postgres no permite esa referencia lateral implícita ahí,
-- error 42P10) — se calcula inline en una subconsulta y se hace join por id.
update public.maintenance_requests mr
set
  shift = case when calc.h >= 7 and calc.h < 19 then 'day' else 'night' end,
  round_date = case when calc.h >= 7 then calc.d else calc.d - 1 end
from (
  select id,
    extract(hour from (created_at at time zone 'America/Caracas'))::int as h,
    (created_at at time zone 'America/Caracas')::date as d
  from public.maintenance_requests
) calc
where mr.id = calc.id and (mr.shift is null or mr.round_date is null);
