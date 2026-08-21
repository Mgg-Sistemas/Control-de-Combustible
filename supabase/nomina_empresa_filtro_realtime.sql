-- ============================================================================
-- EMPRESA FILTRO NÓMINA — que la lista se refresque SOLA en todos los equipos.
--
-- 👉 CÓMO SE CORRE: copiar ESTE ARCHIVO COMPLETO, pegarlo en Supabase → SQL
--    Editor y darle RUN una sola vez. Termina mostrando una tabla de verificación.
--
-- ⚠️ Editar este .sql NO lo aplica. Hay que correrlo a mano.
-- ✅ IDEMPOTENTE: se puede volver a correr sin duplicar nada.
-- ✅ NO crea, borra ni modifica NI UNA FILA. Solo suscribe la tabla a realtime.
--
-- QUÉ RESUELVE
-- ---------------------------------------------------------------------------
-- Reporte del cliente (21-ago-2026): «ni me muestra el nombre de la empresa que
-- creé». Al crear una empresa desde el campo "🏢 Empresa filtro nómina" de la
-- ficha del empleado, el chip del filtro salía rotulado "Empresa" en vez del
-- nombre recién escrito, y solo se arreglaba recargando la app completa.
--
-- Eran DOS fallas y esta es la SEGUNDA:
--   1) La pantalla releía solo `employees` al guardar, nunca `payroll_companies`.
--      Ya está corregido EN LA APP (`EmpleadosScreen.tsx`, `onSaved`), así que el
--      síntoma se arregla aunque este SQL no se corra.
--   2) `payroll_companies` NUNCA se agregó a la publicación `supabase_realtime`,
--      a diferencia de TODOS los demás catálogos que se editan al vuelo
--      (`companies`, `hose_empresas`, `encargados`). Sin eso la BD no avisa a los
--      demás equipos: si una persona crea una empresa en su computadora, las
--      otras no la ven hasta recargar. Eso es lo que arregla este archivo.
--
-- O sea: correrlo es RECOMENDADO, no urgente. Sin él la app ya funciona bien
-- para quien crea la empresa; con él, también para los demás al instante.
-- ============================================================================


-- ── 1) SUSCRIBIR LA TABLA A REALTIME ────────────────────────────────────────
-- Dentro de un `do` porque `alter publication ... add table` REVIENTA si la
-- tabla ya está publicada (no existe un "add table if not exists").
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'payroll_companies'
  ) then
    execute 'alter publication supabase_realtime add table public.payroll_companies';
  end if;
end $$;


-- ── 2) VERIFICACIÓN ─────────────────────────────────────────────────────────
-- Los 3 renglones tienen que decir ✅.
select chequeo, valor, case when ok then '✅' else '❌ REVISAR' end as estado
from (
  select 1 as n, 'La tabla de empresas de nómina existe' as chequeo,
         coalesce(to_regclass('public.payroll_companies')::text, 'no existe') as valor,
         to_regclass('public.payroll_companies') is not null as ok
  union all
  select 2, '⭐ Está suscrita a realtime (se refresca sola)',
         (select count(*)::text from pg_publication_tables
           where pubname='supabase_realtime' and schemaname='public' and tablename='payroll_companies'),
         (select count(*) from pg_publication_tables
           where pubname='supabase_realtime' and schemaname='public' and tablename='payroll_companies') = 1
  union all
  -- CONTROL: este script NO toca datos. El número tiene que ser el mismo de antes.
  select 3, '⭐ Empresas de nómina (este script NO las toca)',
         (select count(*)::text from public.payroll_companies), true
) t order by n;


-- ============================================================================
-- DESHACER (solo si hay que revertir). Descomentar y correr aparte.
-- Volvería al comportamiento de antes: la lista no se refresca sola entre equipos.
-- ============================================================================
-- alter publication supabase_realtime drop table public.payroll_companies;
