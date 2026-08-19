-- ============================================================================
-- SERVICIO DE MAQUINARIA — por qué no deja guardar, y cómo se arregla
--
-- Síntoma (19-ago-2026): en 🧾 Servicios se llena el formulario, se toca
-- 💾 Guardar y no pasa nada. El registro no aparece en la lista.
--
-- SOSPECHA PRINCIPAL: la política de escritura de las dos tablas nuevas exige
-- `public.is_staff()`, que es SOLO el rol base admin / supervisor / operador. El
-- encargado del taller normalmente es `analista` con permiso del módulo, así que
-- para Postgres NO es staff y el INSERT se rechaza. Es EXACTAMENTE el mismo caso
-- que ya pasó con Inspecciones — ver `supabase/inspections_rls_fix.sql`.
--
-- El permiso que sí usa la app para este módulo es `can_write_module('servicio')`
-- (`MantenimientoMaquinariaScreen.tsx`: moduleLevel('servicio') ≥ escritura).
--
-- CÓMO USARLO: corre el BLOQUE 1 primero y mándame lo que dice. Solo si confirma
-- que el problema es el permiso, corre el BLOQUE 2.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 1 · DIAGNÓSTICO   ✅ SOLO LEE, no cambia nada
-- ════════════════════════════════════════════════════════════════════════════
-- Ojo: córrelo con el MISMO usuario que no puede guardar (desde la app / con su
-- sesión). Desde el editor SQL de Supabase se corre como dueño de la base y
-- `auth.uid()` viene vacío, así que las tres últimas columnas saldrán en null —
-- eso NO significa que esté bien, solo que ahí no se puede medir.
select
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename in ('machinery_service_orders','machinery_service_parts'))  as politicas,
  (select string_agg(policyname || ' → ' || coalesce(with_check, qual, '—'), E'\n')
     from pg_policies
    where schemaname = 'public' and tablename = 'machinery_service_orders')     as reglas_ordenes,
  (select count(*) from public.machinery_service_orders)                        as servicios_guardados,
  auth.uid()                                                                    as mi_usuario,
  public.current_role()                                                         as mi_rol_base,
  public.is_staff()                                                             as soy_staff,
  public.can_write_module('servicio')                                           as puedo_escribir_servicio;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 2 · EL ARREGLO   ⚠️ ESTO SÍ ESCRIBE (reemplaza 2 políticas)
-- ════════════════════════════════════════════════════════════════════════════
-- No hace falta respaldo: no toca NI UN dato, solo la regla de quién puede
-- escribir. Es la misma frase que ya lleva Inspecciones desde el 01-ago-2026.
--
-- Sigue siendo restrictivo: `can_write_module` devuelve false para los anónimos y
-- para quien tenga el módulo 'servicio' en solo lectura. Lo que se abre es el
-- caso legítimo que hoy está cerrado: el encargado del taller.

drop policy if exists mso_write on public.machinery_service_orders;
create policy mso_write on public.machinery_service_orders
  for all to authenticated
  using       ((select public.is_staff()) or (select public.can_write_module('servicio')))
  with check  ((select public.is_staff()) or (select public.can_write_module('servicio')));

drop policy if exists msp_write on public.machinery_service_parts;
create policy msp_write on public.machinery_service_parts
  for all to authenticated
  using       ((select public.is_staff()) or (select public.can_write_module('servicio')))
  with check  ((select public.is_staff()) or (select public.can_write_module('servicio')));


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 3 · VERIFICACIÓN   ✅ SOLO LEE
-- ════════════════════════════════════════════════════════════════════════════
-- Las dos reglas de escritura tienen que nombrar `can_write_module`.
select
  tablename,
  policyname,
  (coalesce(with_check, '') like '%can_write_module%') as ya_mira_el_modulo
from pg_policies
where schemaname = 'public'
  and tablename in ('machinery_service_orders','machinery_service_parts')
  and policyname in ('mso_write','msp_write')
order by tablename;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 4 · DESHACER   (solo si hiciera falta volver atrás)
-- ════════════════════════════════════════════════════════════════════════════
-- drop policy if exists mso_write on public.machinery_service_orders;
-- create policy mso_write on public.machinery_service_orders
--   for all to authenticated
--   using ((select public.is_staff())) with check ((select public.is_staff()));
-- drop policy if exists msp_write on public.machinery_service_parts;
-- create policy msp_write on public.machinery_service_parts
--   for all to authenticated
--   using ((select public.is_staff())) with check ((select public.is_staff()));
