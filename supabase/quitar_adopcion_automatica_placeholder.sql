-- ============================================================================
-- QUITAR LA ADOPCIÓN AUTOMÁTICA DE MÁQUINAS SIN INSPECTOR
--
-- Pedido del cliente (17-ago-2026): que `assign-missing-to-placeholder` deje de
-- existir / de correr.
--
-- QUÉ HACE HOY ESE CRON: cada 15 min busca toda máquina `active=true` y
-- `en_espera=false` que no tenga inspector asignado y se la asigna al usuario
-- virtual "MAQUINAS FALTANTES". A partir de ahí, OTROS CUATRO crons le generan
-- jornadas automáticas (hasta 12h día + 6h noche) que suman a horómetro,
-- alertas de mantenimiento y PAGOS.
--
-- ⚠️ LA CADENA COMPLETA DEL CAJÓN "MAQUINAS FALTANTES" SON 5 CRONS:
--     1) assign-missing-to-placeholder   (*/15)      ← la puerta de entrada
--     2) auto-start-placeholder-day      (5 11 * * *)
--     3) auto-start-placeholder-night    (5 23 * * *)
--     4) auto-full-shift-placeholder     (15 4 * * *)
--     5) auto-close-placeholder-night    (*/10)
--   Quitar SOLO el (1) evita que entren máquinas NUEVAS, pero las que YA están
--   en el cajón siguen recibiendo jornadas automáticas de los otros cuatro.
--
-- ⚠️ NO TOCA AL INSPECTOR SOS LA GUAIRA. El cron `sos-reassert-shift-start` y
--   sus máquinas quedan intactos — esas deben seguir iniciando y apagándose
--   solas (instrucción expresa del cliente).
--
-- Correr en Supabase → SQL Editor, BLOQUE POR BLOQUE (el editor solo muestra el
-- resultado de la última consulta).
-- ============================================================================
set time zone 'America/Caracas';

-- ── PASO 1 · PREVIA (solo lectura) ──────────────────────────────────────────
-- ¿Cuántas máquinas están hoy en el cajón "MAQUINAS FALTANTES"? Estas son las
-- que dejarían de recibir jornadas automáticas si además quitas los otros 4.
select count(*) as maquinas_en_el_cajon
from public.machine_inspectors
where upper(coalesce(inspector_name, '')) like '%FALTANTES%';

-- ── PASO 2 · PREVIA (solo lectura) ──────────────────────────────────────────
-- Cuántas jornadas AUTOMÁTICAS generó ese cajón en los últimos 7 días. Es el
-- volumen de horas que dejarías de generar. Míralo ANTES de decidir.
select r.round_date,
       count(*)                       as jornadas,
       sum(coalesce(r.day_hours,0))   as horas_dia,
       sum(coalesce(r.night_hours,0)) as horas_noche
from public.machine_rounds r
join public.machine_inspectors mi on mi.machinery_id = r.machinery_id
where upper(coalesce(mi.inspector_name,'')) like '%FALTANTES%'
  and r.round_date >= (current_date - 7)
group by r.round_date
order by r.round_date desc;

-- ── PASO 3 · RESPALDO de la programación actual (solo lectura) ──────────────
-- COPIA ESTE RESULTADO Y GUÁRDALO. Es lo que necesitas para volver atrás.
select jobname, schedule, command from cron.job order by jobname;

-- ============================================================================
-- A PARTIR DE AQUÍ SÍ SE CAMBIA. Elige UNA de las dos opciones.
-- ============================================================================

-- ── OPCIÓN A · Solo cerrar la puerta (conservador, RECOMENDADO) ─────────────
-- No entran máquinas NUEVAS al cajón. Las que ya están siguen igual, así que
-- NO se te caen horas ya en curso ni pagos del mes. Reversible en 1 línea.
--
-- do $$ begin perform cron.unschedule('assign-missing-to-placeholder'); exception when others then null; end $$;

-- ── OPCIÓN B · Apagar TODA la cadena del cajón ──────────────────────────────
-- Ninguna máquina sin inspector genera jornadas automáticas nunca más. Las
-- horas de esas máquinas dejarán de aparecer en reportes y pagos desde hoy.
-- ⚠️ Esto SÍ cambia los números del mes. Mira antes el resultado del PASO 2.
--
-- do $$ begin perform cron.unschedule('assign-missing-to-placeholder'); exception when others then null; end $$;
-- do $$ begin perform cron.unschedule('auto-start-placeholder-day');    exception when others then null; end $$;
-- do $$ begin perform cron.unschedule('auto-start-placeholder-night');  exception when others then null; end $$;
-- do $$ begin perform cron.unschedule('auto-full-shift-placeholder');   exception when others then null; end $$;
-- do $$ begin perform cron.unschedule('auto-close-placeholder-night');  exception when others then null; end $$;

-- ── PASO 4 · VERIFICACIÓN (correr después de aplicar) ───────────────────────
-- Debe faltar el/los que quitaste, y DEBEN SEGUIR estando `auto-close-jornadas`
-- y `sos-reassert-shift-start`.
-- select jobname, schedule, active from cron.job order by jobname;

-- ============================================================================
-- CÓMO VOLVER ATRÁS (si te arrepientes)
-- ============================================================================
-- select cron.schedule('assign-missing-to-placeholder', '*/15 * * * *', $$select public.assign_missing_to_placeholder();$$);
-- select cron.schedule('auto-start-placeholder-day',    '5 11 * * *',   $$select public.auto_start_placeholder_day();$$);
-- select cron.schedule('auto-start-placeholder-night',  '5 23 * * *',   $$select public.auto_start_placeholder_night();$$);
-- select cron.schedule('auto-full-shift-placeholder',   '15 4 * * *',   $$select public.auto_full_shift_placeholder();$$);
-- select cron.schedule('auto-close-placeholder-night',  '*/10 * * * *', $$select public.auto_close_placeholder_night();$$);
--
-- (Verifica los nombres de función exactos contra el PASO 3 antes de reponer.)
