-- ============================================================================
-- VIAJES DE CAMIONES — registrar un camión QUE NO ESTÁ EN EL CATÁLOGO.
--
-- 👉 CÓMO SE CORRE: copiar ESTE ARCHIVO COMPLETO, pegarlo en Supabase → SQL
--    Editor y darle RUN una sola vez. Termina mostrando una tabla de verificación.
--
-- ⚠️ Editar este .sql NO lo aplica. Hay que correrlo a mano.
-- ✅ IDEMPOTENTE: se puede volver a correr sin duplicar nada.
-- ✅ NO BORRA NI CAMBIA NI UN VIAJE YA REGISTRADO. Solo afloja una restricción y
--    agrega dos columnas nuevas, ambas con valor por defecto.
-- ✅ NO TOCA `machinery` NI EL CATÁLOGO. Ese es justamente el punto.
--
-- QUÉ RESUELVE
-- ---------------------------------------------------------------------------
-- Pedido del cliente (21-ago-2026): «que a los listeros se les coloque una opción
-- que no afecte el catálogo, con la cual un camión que no está en la lista o que
-- no ven, lo puedan añadir para que salga solo para ese registro sin que afecte
-- el catálogo ni nada en el sistema, y que el que puede ver la información
-- completa de ese módulo le salga esa información».
--
-- Hoy eso es IMPOSIBLE a nivel de base de datos:
--
--     machinery_id uuid NOT NULL references public.machinery(id)
--
-- O sea que para anotar un viaje hay que apuntar sí o sí a una fila del catálogo.
-- Un camión prestado, alquilado o recién llegado que todavía no está cargado
-- NO SE PUEDE ANOTAR, y el listero se queda sin registrar el viaje (o peor: se lo
-- anota al camión equivocado, que es lo que pasa en la práctica).
--
-- POR QUÉ NO SE CREA LA MÁQUINA EN EL CATÁLOGO Y YA
-- ---------------------------------------------------------------------------
-- Porque el cliente lo prohibió expresamente, y con razón: el catálogo alimenta
-- Control de Maquinaria, Mantenimiento, jornadas, reportes y pagos. Un camión
-- metido a las apuras por un listero en el campo aparecería en todos esos sitios
-- como una máquina más de la flota, sin encargado, sin empresa y sin precio, y
-- ensuciaría los reportes de todo el mundo. El dato se queda AQUÍ y solo aquí.
--
-- CÓMO QUEDA
-- ---------------------------------------------------------------------------
-- `machinery_id` pasa a ser NULLABLE. Un viaje puede ser de dos clases y el
-- CHECK de más abajo obliga a que sea una o la otra, nunca a medias:
--
--   · DEL CATÁLOGO   → `fuera_catalogo = false` y `machinery_id` apunta a la fila.
--   · FUERA DE CATÁLOGO → `fuera_catalogo = true` y `machinery_id` es NULL. El
--     camión vive solo como TEXTO en `machine_code` (que ya existía como
--     snapshot) más lo que el listero escriba en `camion_ref`.
-- ============================================================================


-- ── 1) EL id DEL CATÁLOGO DEJA DE SER OBLIGATORIO ───────────────────────────
-- `drop not null` es idempotente: si ya está nullable, no hace nada ni falla.
alter table public.camion_viajes alter column machinery_id drop not null;


-- ── 2) LAS DOS COLUMNAS NUEVAS ──────────────────────────────────────────────
-- Bandera EXPLÍCITA en vez de deducirla de `machinery_id is null`. Si algún día
-- se borra una máquina del catálogo con `on delete cascade`... el viaje se va con
-- ella; pero si esa regla cambiara a `set null`, un viaje del catálogo quedaría
-- indistinguible de uno de fuera. La bandera dice la verdad pase lo que pase.
alter table public.camion_viajes
  add column if not exists fuera_catalogo boolean not null default false;

-- Lo que el listero escribe para identificarlo: placa, empresa, "el rojo de
-- Pérez"… Texto libre a propósito: es una nota de campo, no un dato maestro.
alter table public.camion_viajes
  add column if not exists camion_ref text;

comment on column public.camion_viajes.fuera_catalogo is
  'true = camión que NO está en el catálogo, anotado a mano por el listero SOLO para este registro. No existe en machinery y no debe crearse allá.';
comment on column public.camion_viajes.camion_ref is
  'Referencia libre del camión fuera de catálogo (placa, empresa, seña). Nota de campo, no dato maestro.';


-- ── 3) QUE NO SE PUEDA QUEDAR A MEDIAS ──────────────────────────────────────
-- Sin esto podría entrar un viaje `fuera_catalogo = true` CON machinery_id (o al
-- revés) y los reportes contarían el mismo camión dos veces, una por cada vía.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cv_fuera_catalogo_coherente') then
    alter table public.camion_viajes add constraint cv_fuera_catalogo_coherente check (
      (fuera_catalogo = false and machinery_id is not null)
      or
      (fuera_catalogo = true  and machinery_id is null and btrim(coalesce(machine_code, '')) <> '')
    );
  end if;
end $$;


-- ── 4) ÍNDICE PARA EL PANEL ─────────────────────────────────────────────────
-- Parcial: solo indexa los de fuera de catálogo, que son los pocos. Sirve para
-- que quien ve la información completa pueda listarlos sin recorrer toda la tabla.
create index if not exists idx_cv_fuera_catalogo
  on public.camion_viajes(registered_at desc) where fuera_catalogo;


-- ── 5) VERIFICACIÓN ─────────────────────────────────────────────────────────
-- Los 6 primeros renglones tienen que decir ✅.
select chequeo, valor, case when ok then '✅' else '❌ REVISAR' end as estado
from (
  select 1 as n, 'machinery_id ya NO es obligatorio' as chequeo,
         (select case when is_nullable = 'YES' then 'nullable' else 'todavía NOT NULL' end
            from information_schema.columns
           where table_schema='public' and table_name='camion_viajes' and column_name='machinery_id') as valor,
         (select is_nullable = 'YES' from information_schema.columns
           where table_schema='public' and table_name='camion_viajes' and column_name='machinery_id') as ok
  union all
  select 2, 'La bandera fuera_catalogo existe',
         coalesce((select data_type from information_schema.columns
                    where table_schema='public' and table_name='camion_viajes' and column_name='fuera_catalogo'), 'no existe'),
         exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='camion_viajes' and column_name='fuera_catalogo')
  union all
  select 3, 'La referencia libre camion_ref existe',
         coalesce((select data_type from information_schema.columns
                    where table_schema='public' and table_name='camion_viajes' and column_name='camion_ref'), 'no existe'),
         exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='camion_viajes' and column_name='camion_ref')
  union all
  select 4, '⭐ El CHECK que impide dejarlo a medias',
         (select count(*)::text from pg_constraint where conname = 'cv_fuera_catalogo_coherente'),
         (select count(*) from pg_constraint where conname = 'cv_fuera_catalogo_coherente') = 1
  union all
  select 5, 'Índice de los fuera de catálogo',
         (select count(*)::text from pg_indexes where schemaname='public' and indexname='idx_cv_fuera_catalogo'),
         (select count(*) from pg_indexes where schemaname='public' and indexname='idx_cv_fuera_catalogo') = 1
  union all
  select 6, '⭐ Los viajes de antes quedaron TODOS como del catálogo',
         (select count(*)::text from public.camion_viajes where fuera_catalogo = false),
         (select count(*) from public.camion_viajes where fuera_catalogo = true) = 0
  union all
  -- CONTROL: nada se borró. Este número tiene que ser el mismo de antes de correr.
  select 7, '⭐ Viajes en total (este script NO los toca)',
         (select count(*)::text from public.camion_viajes), true
  union all
  select 8, '⭐ Máquinas del CATÁLOGO (este script NO las toca)',
         (select count(*)::text from public.machinery), true
) t order by n;


-- ============================================================================
-- DESHACER (solo si hay que revertir). Descomentar y correr aparte.
-- ⚠️ El `alter column ... set not null` FALLA si ya hay viajes fuera de catálogo:
--    primero habría que decidir qué hacer con ellos (borrarlos pierde trabajo del
--    listero). Por eso la primera línea va comentada aparte.
-- ============================================================================
-- alter table public.camion_viajes drop constraint if exists cv_fuera_catalogo_coherente;
-- drop index if exists public.idx_cv_fuera_catalogo;
-- alter table public.camion_viajes drop column if exists camion_ref;
-- alter table public.camion_viajes drop column if exists fuera_catalogo;
-- -- delete from public.camion_viajes where machinery_id is null;   -- ⚠️ PIERDE VIAJES
-- -- alter table public.camion_viajes alter column machinery_id set not null;
