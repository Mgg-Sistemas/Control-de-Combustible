-- ══════════════════════════════════════════════════════════════════════════
-- MÓDULO DE GEODESTA · Fase 0 (cimientos)   —   aplicado en Supabase (ago-2026)
-- ══════════════════════════════════════════════════════════════════════════
-- Topografía ligada a obras/edificios. Coordenadas de trabajo: UTM SIRGAS-REGVEN
-- 19N (EPSG:2202); geom en 4326 para el mapa web. Acceso por módulo 'geodesta'
-- (module_permissions por usuario o app_role), como el resto del sistema.
--
-- Migraciones aplicadas (en este orden):
--   1) geodesta_enable_postgis   → create extension postgis (schema extensions)
--   2) geodesta_schema_fase0     → funciones de acceso + 4 tablas + RLS + triggers
--   3) (data) rol 'Geodesta' (app_role) + tablas a la publicación realtime
--
-- Este archivo documenta el estado; el detalle vive en las migraciones de Supabase.

-- PostGIS
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

-- Nivel efectivo del usuario en el módulo geodesta (perm. por usuario o de su rol).
create or replace function public.geodesta_level()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select mp.level::text from public.module_permissions mp
       where mp.user_id = auth.uid() and mp.module = 'geodesta' limit 1),
    (select nullif(ar.modules->>'geodesta','none')
       from public.profiles p join public.app_roles ar on ar.id = p.app_role_id
       where p.id = auth.uid() limit 1),
    'none');
$$;

create or replace function public.has_geodesta_access(min_level text default 'lectura')
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or (case public.geodesta_level()
            when 'full' then 3 when 'escritura' then 2 when 'lectura' then 1 else 0 end)
         >= (case min_level when 'full' then 3 when 'escritura' then 2 else 1 end);
$$;

-- Tablas: geodesta_projects, geodesta_points, geodesta_surfaces, geodesta_inspections
--   RLS por has_geodesta_access(): SELECT=lectura, INSERT/UPDATE=escritura, DELETE=full.
--   Triggers geodesta_set_geom() rellenan geom(4326) desde lat/lon en points e inspections.
--   (Definición completa en la migración geodesta_schema_fase0.)

-- Rol dinámico "Geodesta" (app_role) — sembrado:
--   modules = {"geodesta":"full","mapa":"lectura","reportes":"lectura","supervision":"lectura"}
