-- ============================================================================
-- FIX (auditoría Inspecciones, 08/08/2026): assign_missing_to_placeholder()
-- — el cron cada 15 min que garantiza que TODA máquina tenga inspector (real
-- o el placeholder) — filtraba `mch.operational = true`, además de
-- `active = true` y `en_espera = false`. La regla de negocio confirmada dice
-- que una máquina operational=false (averiada/parqueada) pero active=true y
-- en_espera=false SIGUE viva/visible en todos lados — solo active=false o
-- en_espera=true la ocultan.
--
-- Con el filtro `operational = true` puesto, una máquina averiada que se
-- queda SIN NINGUNA fila en machine_inspectors para un turno (por ejemplo se
-- le quitó el inspector, o nunca la tuvo) queda huérfana ese turno de forma
-- PERMANENTE: este cron nunca la vuelve a tocar mientras siga
-- operational=false, porque el WHERE la excluye de raíz. Resultado
-- reproducido con datos reales: JUMBO 320 (id 0fda39e7-e7b1-4e1a-9c56-
-- 0dd280e729de), active=true, en_espera=false, operational=false, con
-- inspector en turno noche pero CERO filas en turno día — ningún inspector la
-- ve en su lista de turno día (el filtro `machine_inspectors.inspector_id =
-- auth.uid()` no encuentra nada), mientras el coordinador podía seguir
-- viéndola por otro camino. Mismo síntoma de "el inspector ve algo distinto
-- que el coordinador" que ya pasó hoy con otra máquina.
--
-- QUÉ CAMBIA: se quita `and mch.operational = true` de
-- assign_missing_to_placeholder() (queda solo `active = true and
-- en_espera = false`) — esta función SOLO asigna un dueño (real o
-- placeholder) a cada turno, no hace que la máquina "trabaje".
--
-- QUÉ NO CAMBIA (a propósito): auto_start_placeholder_day(),
-- auto_start_placeholder_night() y sos_reassert_shift_start() SIGUEN
-- exigiendo `operational = true` — estas 3 SÍ ponen la máquina a "trabajar en
-- vivo" (fuerzan jornada_start_at cada mañana/noche). Relajarlas también
-- pondría a acumular horas automáticamente a cualquier máquina averiada con
-- inspector placeholder/SOS — justo lo contrario de lo que el cliente pidió
-- hoy mismo para la retroexcavadora y las otras 3 máquinas de SOS marcadas
-- PARADA ("déjala inactiva", "esas están paradas e inactivas"): visibles sí,
-- trabajando no. auto_full_shift_placeholder() (horas fijas 12/6 o 12/12)
-- tampoco se toca por la misma razón.
--
-- Idempotente.
-- ============================================================================

create or replace function public.assign_missing_to_placeholder() returns void
language plpgsql security definer set search_path = public as $$
declare
  ph_id uuid := '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b';
begin
  insert into public.machine_inspectors (machinery_id, inspector_id, inspector_name, shift, active, assigned_at)
  select mch.id, ph_id, 'inspector sos la guaira', shifts.sh, true, now()
  from public.machinery mch
  cross join (values ('day'), ('night')) as shifts(sh)
  where mch.active = true
    and mch.en_espera = false
    and not exists (
      select 1 from public.machine_inspectors mi
      where mi.machinery_id = mch.id and mi.shift = shifts.sh
    )
  on conflict (machinery_id, shift) do nothing;
end $$;

-- Corrida inmediata: cubre YA cualquier turno huérfano (como JUMBO 320, turno
-- día) sin esperar al próximo tick del cron (cada 15 min).
select public.assign_missing_to_placeholder();

-- ── VERIFICACIÓN (correr después) ───────────────────────────────────────────
-- Debe dar 0 filas: ninguna máquina active=true/en_espera=false debería
-- quedar sin inspector (real o placeholder) en algún turno.
-- select mch.code, mch.plate, shifts.sh as turno_sin_inspector
-- from public.machinery mch
-- cross join (values ('day'), ('night')) as shifts(sh)
-- where mch.active = true and mch.en_espera = false
--   and not exists (
--     select 1 from public.machine_inspectors mi
--     where mi.machinery_id = mch.id and mi.shift = shifts.sh
--   )
-- order by mch.code, shifts.sh;
