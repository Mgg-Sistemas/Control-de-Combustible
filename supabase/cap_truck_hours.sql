-- ============================================================================
-- BLINDAJE DE HORAS — VOLQUETA / TORONTO
--   Estos camiones trabajan COMO MÁXIMO: 12h de DÍA + 6h de NOCHE (= 18h/día).
--   Un trigger topa (cap) las horas en CADA escritura a machine_rounds, sin
--   importar el origen (auto-cierre, flujo de patio o finalización manual):
--     • day_hours   -> máximo 12
--     • night_hours -> máximo 6
--   Trabajar MENOS sí se permite (el tope solo impide PASARSE); eso queda como
--   un cierre manual con el valor real.
--
--   Aplica a máquinas cuyo code contiene 'volqueta' o 'toronto'
--   (p.ej. "CAMION VOLTEO TORONTO", "CHUTO CON VOLQUETA").
--   NOTA: los "volteo" que NO son toronto no entran aquí (no se pidieron).
-- ============================================================================

create or replace function public.cap_truck_hours() returns trigger
language plpgsql security definer set search_path = public as $$
declare es_tt boolean;
begin
  select lower(coalesce(code, '')) ~ 'volqueta|toronto' into es_tt
  from public.machinery where id = new.machinery_id;

  if coalesce(es_tt, false) then
    if coalesce(new.day_hours, 0)   > 12 then new.day_hours   := 12; end if;
    if coalesce(new.night_hours, 0) >  6 then new.night_hours :=  6; end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_cap_truck_hours on public.machine_rounds;
create trigger trg_cap_truck_hours
  before insert or update on public.machine_rounds
  for each row execute function public.cap_truck_hours();

-- ----------------------------------------------------------------------------
-- CORRECCIÓN de datos existentes: baja a 12/6 las volqueta/toronto que quedaron
-- por encima (p.ej. las de ayer en 24h -> 18h). Nunca sube, solo topa.
-- ----------------------------------------------------------------------------
update public.machine_rounds mr
   set day_hours   = least(coalesce(mr.day_hours,   0), 12),
       night_hours = least(coalesce(mr.night_hours, 0),  6)
  from public.machinery mch
 where mch.id = mr.machinery_id
   and lower(coalesce(mch.code, '')) ~ 'volqueta|toronto'
   and (coalesce(mr.day_hours, 0) > 12 or coalesce(mr.night_hours, 0) > 6);
