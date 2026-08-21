-- ============================================================================
-- VEHÍCULOS — COLUMNA "ENCARGADO".
--
-- 👉 CÓMO SE CORRE: copiar ESTE ARCHIVO COMPLETO, pegarlo en Supabase → SQL
--    Editor y darle RUN una sola vez. Termina mostrando una tabla de verificación.
--
-- ⚠️ Editar este .sql NO lo aplica. Hay que correrlo a mano.
-- ✅ Es IDEMPOTENTE: se puede volver a correr sin duplicar ni pisar nada.
--
-- QUÉ RESUELVE
-- ---------------------------------------------------------------------------
-- Pedido del cliente (20-ago-2026): «que el campo encargado sea obligatorio
-- cuando se vaya a crear una maquinaria o vehículo».
--
-- La MAQUINARIA ya tenía su columna `encargado` — ahí el cambio es solo de la app
-- y no necesita tocar la base. Los VEHÍCULOS no la tenían: la tabla `vehicles`
-- solo guarda placa, marca, modelo, tipo, capacidad y rendimiento. Esta columna
-- es lo único que falta para poder exigirlo también en los vehículos.
--
-- POR QUÉ NO PUEDE ROMPER NADA
-- ---------------------------------------------------------------------------
--  · Es una columna NUEVA y NULA (sin `not null`, sin `default`): los vehículos
--    que ya existen no se tocan, quedan con el encargado vacío y se van
--    completando a medida que alguien los edite. NINGÚN registro se modifica.
--  · `add column if not exists` — correr esto dos veces no hace nada la segunda.
--  · Lo OBLIGATORIO se exige en la APLICACIÓN, al CREAR, no con un `not null` en
--    la base. Si se pusiera `not null` se trancaría el guardado de los vehículos
--    viejos que no lo tienen, y cualquier proceso que inserte un vehículo sin ese
--    campo empezaría a fallar de golpe.
--
-- MIENTRAS NO SE CORRA: la app sigue funcionando igual. El Catálogo pregunta si la
-- columna existe (una consulta al entrar) y, si no está, NO muestra el campo
-- "Encargado" en el formulario de vehículos ni lo exige. O sea: se puede publicar
-- la app antes o después de correr este SQL, en cualquier orden, sin romper el
-- alta de vehículos. Lo único que no pasa hasta correrlo es que se exija.
-- ============================================================================

alter table public.vehicles add column if not exists encargado text;

comment on column public.vehicles.encargado is
  'Persona responsable del vehículo. Obligatorio AL CREAR (lo valida la app, no la BD: un not null trancaría los vehículos viejos que no lo tienen).';


-- ── VERIFICACIÓN ────────────────────────────────────────────────────────────
-- Última instrucción del archivo: el resultado que queda en pantalla al terminar.
-- Todo tiene que decir ✅.
select chequeo, valor, case when ok then '✅' else '❌ REVISAR' end as estado
from (
  select 1 as n, 'La columna existe' as chequeo,
         coalesce((select data_type from information_schema.columns
                    where table_schema = 'public' and table_name = 'vehicles'
                      and column_name = 'encargado'), 'no existe') as valor,
         exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'vehicles'
                    and column_name = 'encargado') as ok
  union all
  -- Tiene que admitir NULOS: si dijera "NO", los vehículos viejos no se podrían guardar.
  select 2, 'Admite vacío (los vehículos viejos no se trancan)',
         coalesce((select is_nullable from information_schema.columns
                    where table_schema = 'public' and table_name = 'vehicles'
                      and column_name = 'encargado'), '—'),
         coalesce((select is_nullable from information_schema.columns
                    where table_schema = 'public' and table_name = 'vehicles'
                      and column_name = 'encargado'), '') = 'YES'
  union all
  -- CONTROL: este script NO toca datos. El número tiene que ser el mismo antes y después.
  select 3, 'Vehículos en la base (este script NO los toca)',
         (select count(*) from public.vehicles)::text, true
  union all
  select 4, 'Vehículos que todavía no tienen encargado (se completan al editarlos)',
         (select count(*) from public.vehicles where encargado is null or btrim(encargado) = '')::text,
         true
) t order by n;


-- ============================================================================
-- DESHACER (solo si hay que revertir). Descomentar y correr aparte.
-- OJO: borra los encargados ya cargados en los vehículos.
-- ============================================================================
-- alter table public.vehicles drop column if exists encargado;
