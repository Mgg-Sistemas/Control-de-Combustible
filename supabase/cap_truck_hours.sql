-- ============================================================================
-- BLINDAJE DE HORAS — VOLQUETA / TORONTO — ACTUALIZADO 2026-08-04:
--   El tope de horas SOLO aplica mientras el turno siga en manos del usuario
--   virtual "MAQUINAS FALTANTES" (sin inspector humano asignado a ese turno):
--     • turno DÍA   (dueño = MAQUINAS FALTANTES) -> tope day_hours   = 12
--     • turno NOCHE (dueño = MAQUINAS FALTANTES) -> tope night_hours = 12  (antes 6 — ver
--       supabase/maquinas_faltantes.sql, ahora genera jornada 12x12 = 24h para camiones sin dueño)
--
--   En cuanto un supervisor/inspector REAL tiene ese turno asignado, el camión
--   trabaja NORMAL: SIN tope, con sus horas reales (igual que cualquier otra
--   máquina). Confirmado por el cliente 04/08/2026: "el que sí va a ser
--   afectado es el usuario de máquinas sin asignar", los supervisores reales
--   siguen su flujo de siempre.
--
--   Trabajar MENOS del tope sí se permite siempre (el tope solo impide PASARSE).
--   Aplica a máquinas cuyo code contiene 'volqueta' o 'toronto'
--   (p.ej. "CAMION VOLTEO TORONTO", "CHUTO CON VOLQUETA").
-- ============================================================================

create or replace function public.cap_truck_hours() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  es_tt boolean;
  ph_id uuid := '00000000-0000-0000-0000-00000000fa1a';
  day_es_virtual boolean;
  night_es_virtual boolean;
begin
  select lower(coalesce(code, '')) ~ 'volqueta|toronto' into es_tt
  from public.machinery where id = new.machinery_id;

  if coalesce(es_tt, false) then
    select exists(
      select 1 from public.machine_inspectors mi
      where mi.machinery_id = new.machinery_id and mi.shift = 'day' and mi.inspector_id = ph_id
    ) into day_es_virtual;
    select exists(
      select 1 from public.machine_inspectors mi
      where mi.machinery_id = new.machinery_id and mi.shift = 'night' and mi.inspector_id = ph_id
    ) into night_es_virtual;

    if coalesce(day_es_virtual, false) and coalesce(new.day_hours, 0) > 12 then
      new.day_hours := 12;
    end if;
    if coalesce(night_es_virtual, false) and coalesce(new.night_hours, 0) > 12 then
      new.night_hours := 12;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_cap_truck_hours on public.machine_rounds;
create trigger trg_cap_truck_hours
  before insert or update on public.machine_rounds
  for each row execute function public.cap_truck_hours();

-- NOTA: a diferencia de la versión anterior, esta actualización NO corrige (no
-- baja) datos ya existentes — solo topa escrituras nuevas, y solo si el turno
-- sigue en manos del virtual. Los datos históricos de camiones con supervisor
-- real quedan intactos (respaldo previo en supabase/backup_antes_12x12_camiones.sql).
