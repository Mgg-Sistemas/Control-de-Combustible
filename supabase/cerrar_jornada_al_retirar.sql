-- ============================================================================
-- ARREGLO DE RAÍZ (19-ago-2026): al marcar una máquina como RETIRADA
-- (operational: true -> false) se le CIERRA la jornada del día
-- automáticamente (jornada_start_at = null en todas sus rondas abiertas).
--
-- POR QUÉ: el auto-cierre (auto_close_jornadas) le banca 12h FIJAS de día a las
-- máquinas con inspector SOS, pero SOLO procesa rondas con jornada_start_at NO
-- nulo. Si una máquina se retira con la jornada abierta, a las 7pm el auto-cierre
-- le mete 12h fantasma y esa retirada aparece "trabajando 12h" en Informe,
-- Control, Jornada y reporte por empresa (caso RETROEXCAVADORA 92543.0). Al
-- cerrarle la jornada en el momento del retiro, el auto-cierre YA NO la toca.
--
-- QUÉ SÍ conserva: las horas YA bancadas (trabajo real finalizado antes del
-- retiro) NO se tocan — solo se cierra la jornada abierta para que no se infle.
-- QUÉ NO hace: no borra horas históricas ni reactiva nada; si luego la vuelven a
-- poner Operativa, arranca limpio con su próxima jornada.
--
-- Sincroniza las 4 vistas porque todas leen machine_rounds (misma fuente).
-- Idempotente.
-- ============================================================================

create or replace function public.close_jornada_on_retiro() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Solo al TRANSICIONAR de operativa (o null) a retirada.
  if new.operational = false and coalesce(old.operational, true) = true then
    update public.machine_rounds
      set jornada_start_at = null
      where machinery_id = new.id
        and jornada_start_at is not null;
  end if;
  return new;
end $$;

drop trigger if exists trg_close_jornada_on_retiro on public.machinery;
create trigger trg_close_jornada_on_retiro
  after update of operational on public.machinery
  for each row execute function public.close_jornada_on_retiro();

-- ── LIMPIEZA DE LA DATA YA INFLADA (retiradas con 12h fantasma ya bancadas) ──
-- La retro (y el camión volteo 022) ya recibieron las 12h ANTES de este trigger,
-- así que hay que limpiarlas a mano una vez. Pone en 0 las horas del día y cierra
-- la jornada, en los días en disputa (17, 18 y hoy). Ajustar identidad/fechas si
-- aplica a otras retiradas.
update public.machine_rounds r
set day_hours = 0, night_hours = 0, jornada_start_at = null
from public.machinery m
where m.id = r.machinery_id
  and m.operational = false
  and r.round_date >= '2026-08-17'
  and (
    m.serial = '92543.0'                                   -- RETROEXCAVADORA CAT 310E
    or (m.code = 'CAMION VOLTEO TORONTO' and m.plate = 'NUMERO 022')
  );

-- ── VERIFICACIÓN (correr después) ───────────────────────────────────────────
-- Debe dar 0 filas: ninguna retirada debería quedar con horas > 0 en esas fechas.
-- select m.code, m.serial, r.round_date, r.day_hours, r.night_hours
-- from public.machine_rounds r
-- join public.machinery m on m.id = r.machinery_id
-- where m.operational = false and r.round_date >= '2026-08-17'
--   and (coalesce(r.day_hours,0) > 0 or coalesce(r.night_hours,0) > 0)
-- order by m.code;
