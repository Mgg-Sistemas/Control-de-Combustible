-- ============================================================================
-- VACIAR la lista de MARCA y MODELO del catálogo (14-ago-2026).
--
-- El desplegable de "Marca" y "Modelo" al crear/editar maquinaria se arma con los
-- valores DISTINCT que hoy tienen las columnas machinery.marca y machinery.modelo
-- (RecordForm: `select(column)` sobre la tabla machinery). Para depurar esa lista
-- y re-ingresarla una a una, se limpian ambas columnas en TODAS las máquinas.
--
-- IMPORTANTE: NO se toca `tipo` (columna histórica = marca+modelo). Los reportes,
-- PDFs, tarjetas y acarreo siguen leyendo `tipo`, así que NADA se rompe: la marca
-- vieja sigue visible en las tarjetas como respaldo (m.marca ?? m.tipo). Cada vez
-- que edites una máquina y guardes marca/modelo, `tipo` se recalcula solo.
--
-- Correr UNA vez en el SQL Editor de Supabase.
-- ============================================================================

-- (Opcional) Ver qué hay antes de vaciar:
--   select distinct marca from public.machinery where btrim(coalesce(marca,'')) <> '' order by 1;
--   select distinct modelo from public.machinery where btrim(coalesce(modelo,'')) <> '' order by 1;

update public.machinery
   set marca  = null,
       modelo = null
 where marca is not null
    or modelo is not null;
