-- ============================================================================
-- Fix del Kiosco de planta (Fase 4, PlantaKioskScreen.tsx):
--
-- La alerta de mantenimiento preventivo del taller
-- (`check_work_center_horometro_alerta()`, creada en
-- supabase/fabricacion_calidad_oee.sql) solo notifica a `target_role: 'admin'`.
-- El patrón que dice replicar en su propio comentario es el de
-- supabase/horometro_alertas.sql (`check_horometro_alerta()`), que notifica
-- TANTO a 'admin' COMO a 'supervisor' con un doble insert. Este archivo
-- reemplaza esa función (CREATE OR REPLACE, misma firma y mismo trigger, que
-- no hace falta recrear) para agregar el segundo insert a 'supervisor',
-- copiando el patrón exacto de horometro_alertas.sql.
--
-- 100% ADITIVO / idempotente: no crea tablas nuevas, no toca datos, solo
-- reemplaza el cuerpo de una función ya existente. El trigger
-- `trg_check_work_center_horometro_alerta` (creado en fabricacion_calidad_oee.sql)
-- sigue apuntando a esta función por nombre, así que no hace falta tocarlo.
-- Seguro de correr más de una vez.
-- ============================================================================
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

  -- Mismo doble-insert (admin + supervisor) que check_horometro_alerta() en
  -- supabase/horometro_alertas.sql.
  insert into public.notifications (type, title, body, target_role, entity_type, entity_id, meta)
  values
    ('mantenimiento_taller_alerta',
     'Centro de trabajo próximo a mantenimiento preventivo',
     concat_ws(' · ', NEW.name, 'Horas acumuladas: ' || round(v_horas, 1) || ' h'),
     'admin', 'work_center', NEW.id::text,
     jsonb_build_object('horas', round(v_horas, 1), 'code', NEW.code)),
    ('mantenimiento_taller_alerta',
     'Centro de trabajo próximo a mantenimiento preventivo',
     concat_ws(' · ', NEW.name, 'Horas acumuladas: ' || round(v_horas, 1) || ' h'),
     'supervisor', 'work_center', NEW.id::text,
     jsonb_build_object('horas', round(v_horas, 1), 'code', NEW.code));

  return NEW;
end $$;
