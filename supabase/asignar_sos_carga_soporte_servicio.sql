-- ============================================================================
-- Asignar al inspector "SOS LA GUAIRA" toda la maquinaria de clasificación
-- MANEJO DE CARGA, SOPORTE y SERVICIO que hoy NO tenga un inspector REAL
-- (sin fila, o cubierta solo por el cajón "MAQUINAS FALTANTES").
--
-- - NO pisa a ningún inspector humano ya asignado (solo toca filas del cajón
--   faltantes o turnos sin fila).
-- - Cubre ambos turnos (día y noche).
-- - Idempotente: se puede correr varias veces sin duplicar.
--
-- La clasificación vive en machinery.clasificacion (texto libre, p. ej.
-- "Manejo de cargas"); se compara con ILIKE para tolerar mayúsculas/plurales.
-- ============================================================================

-- ── 0) DIAGNÓSTICO: confirma a QUIÉN se va a asignar y CUÁNTAS máquinas aplican.
--    Revisa que salga UN perfil correcto para "SOS LA GUAIRA". Si el nombre real
--    difiere, ajusta el ILIKE en el bloque de abajo antes de ejecutar.
select id, full_name, role from public.profiles where full_name ilike '%sos%guaira%' order by full_name;

select count(*) as maquinas_de_esas_clasificaciones
from public.machinery
where active = true
  and (clasificacion ilike '%manejo%carga%' or clasificacion ilike '%soporte%servicio%');  -- MANEJO DE CARGA (24) + SOPORTE Y SERVICIO (49) = 73

-- ── EJECUCIÓN ────────────────────────────────────────────────────────────────
do $$
declare
  sos_id   uuid;
  sos_name text;
  n_upd    int;
  n_ins    int;
begin
  -- 1) Resolver al inspector "SOS LA GUAIRA".
  select id, full_name into sos_id, sos_name
  from public.profiles
  where full_name ilike '%sos%guaira%'
  order by full_name
  limit 1;

  if sos_id is null then
    raise exception 'No se encontró un perfil de inspector con nombre tipo "SOS LA GUAIRA". Ajusta el filtro de nombre (ILIKE) y vuelve a correr.';
  end if;

  -- 2) Reasignar a SOS las filas que hoy están en el cajón "MAQUINAS FALTANTES"
  --    (placeholder del sistema), para las 3 clasificaciones. NO toca inspectores
  --    humanos (se filtra por nombre "faltantes" o por los UUID conocidos del cajón).
  update public.machine_inspectors mi
  set inspector_id = sos_id, inspector_name = sos_name, active = true, assigned_at = now()
  from public.machinery mch
  where mi.machinery_id = mch.id
    and mch.active = true
    and (mch.clasificacion ilike '%manejo%carga%' or mch.clasificacion ilike '%soporte%servicio%')
    and (
      mi.inspector_name ilike '%faltant%'
      or mi.inspector_id in ('00000000-0000-0000-0000-00000000fa1a'::uuid,
                             '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b'::uuid)
    );
  get diagnostics n_upd = row_count;

  -- 3) Insertar a SOS en los turnos (día/noche) que no tengan NINGUNA fila.
  insert into public.machine_inspectors (machinery_id, inspector_id, inspector_name, shift, active, assigned_at)
  select mch.id, sos_id, sos_name, shifts.sh, true, now()
  from public.machinery mch
  cross join (values ('day'), ('night')) as shifts(sh)
  where mch.active = true
    and (mch.clasificacion ilike '%manejo%carga%' or mch.clasificacion ilike '%soporte%servicio%')
    and not exists (
      select 1 from public.machine_inspectors mi
      where mi.machinery_id = mch.id and mi.shift = shifts.sh
    )
  on conflict (machinery_id, shift) do nothing;
  get diagnostics n_ins = row_count;

  raise notice 'Inspector SOS = % (%). Reasignadas desde faltantes: %. Insertadas nuevas: %.', sos_name, sos_id, n_upd, n_ins;
end $$;

-- ── 4) VERIFICACIÓN: máquinas de esas clasificaciones ahora en manos de SOS.
select mi.shift as turno, count(*) as maquinas_sos
from public.machine_inspectors mi
join public.machinery mch on mch.id = mi.machinery_id
where mi.active = true
  and mi.inspector_name ilike '%sos%guaira%'
  and (mch.clasificacion ilike '%manejo%carga%' or mch.clasificacion ilike '%soporte%servicio%')
group by mi.shift
order by mi.shift;
