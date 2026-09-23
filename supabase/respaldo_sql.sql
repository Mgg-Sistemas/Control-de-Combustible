-- ============================================================================
-- RESPALDO: LA LISTA DE TABLAS DEJA DE ENVEJECER (23-sep-2026)
--
-- 👉 CÓMO SE CORRE: copiar ESTE ARCHIVO COMPLETO, pegarlo en Supabase → SQL
--    Editor y darle RUN una sola vez. Es idempotente y no toca ni un dato.
--
-- POR QUÉ EXISTE
-- ---------------------------------------------------------------------------
-- El respaldo de Ajustes llevaba una lista de 45 tablas ESCRITA A MANO en el
-- código. Cada módulo nuevo agregaba tablas y nadie se acordaba de anotarlas ahí.
-- Al revisarlo contra la base real, el resultado fue este:
--
--   ⚠️ DE 107 TABLAS CON DATOS, EL RESPALDO SOLO SE LLEVABA 32.
--      Quedaban fuera, entre otras: machinery_locations (7.105 filas),
--      camion_viajes (4.448), tique_emisiones (1.066), edificios,
--      machinery_service_orders y _parts, cuentas, suppliers, direct_purchases,
--      purchase_orders, lm_washes, bcv_rates, machine_operators…
--
--      Un respaldo que dice «todos los datos» y se deja 75 tablas es peor que no
--      tener respaldo: nadie lo revisa hasta el día que hace falta restaurarlo.
--
-- QUÉ HACE ESTE ARCHIVO
--   Crea `public.tablas_para_respaldo()`: devuelve las tablas que hay que
--   respaldar, LEÍDAS DE LA BASE en el momento. Así el respaldo se entera solo de
--   cada módulo nuevo y la lista no se puede volver a quedar vieja.
--
-- QUÉ DEJA FUERA, A PROPÓSITO
--   · `audit_log` — 115 mil filas y 181 MB de BITÁCORA, no de datos del negocio.
--     Meterla haría un archivo que el navegador no puede ni armar.
--   · `backup_*` y `bkp_*` — respaldos manuales viejos guardados dentro de la
--     propia base. Respaldarlos es respaldar un respaldo.
--   · Las vistas: no tienen datos propios, se recalculan solas.
-- ============================================================================

create or replace function public.tablas_para_respaldo()
returns table (tabla text, filas bigint)
language sql
stable
security definer
set search_path = public
as $fn$
  select c.relname::text as tabla,
         coalesce(s.n_live_tup, 0)::bigint as filas
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_stat_user_tables s on s.relid = c.oid
   where n.nspname = 'public'
     and c.relkind = 'r'                      -- solo tablas de verdad, no vistas
     and c.relname <> 'audit_log'
     and c.relname !~* '^(backup|bkp)[_-]'
   order by c.relname;
$fn$;

comment on function public.tablas_para_respaldo() is
  'Las tablas que el respaldo de Ajustes tiene que llevarse. Se leen de la base para que la lista no envejezca.';

-- Cualquiera autenticado puede PREGUNTAR la lista; lo que se lleve de cada tabla
-- lo sigue decidiendo el RLS de esa tabla. Saber que una tabla existe no es un
-- dato sensible; sus filas sí, y esas no pasan por aquí.
revoke all on function public.tablas_para_respaldo() from public;
grant execute on function public.tablas_para_respaldo() to authenticated;


-- ── VERIFICACIÓN ────────────────────────────────────────────────────────────
select chequeo, valor, case when ok then '✅' else '❌ REVISAR' end as estado
from (
  select 1 as n, 'La función existe' as chequeo,
         coalesce((select proname from pg_proc
                    where proname = 'tablas_para_respaldo'
                      and pronamespace = 'public'::regnamespace), 'no existe') as valor,
         exists (select 1 from pg_proc where proname = 'tablas_para_respaldo'
                  and pronamespace = 'public'::regnamespace) as ok
  union all
  select 2, 'Tablas que se va a llevar el respaldo',
         (select count(*)::text from public.tablas_para_respaldo()),
         (select count(*) from public.tablas_para_respaldo()) > 0
  union all
  select 3, 'De ellas, con datos hoy',
         (select count(*)::text from public.tablas_para_respaldo() where filas > 0), true
  union all
  select 4, 'Filas que se va a llevar (aprox.)',
         (select coalesce(sum(filas), 0)::text from public.tablas_para_respaldo()), true
  union all
  -- ⭐ El control: la bitácora NO entra (es lo que hacía inviable el archivo).
  select 5, '⭐ «audit_log» queda fuera (tiene que ser 0)',
         (select count(*)::text from public.tablas_para_respaldo() where tabla = 'audit_log'),
         (select count(*) from public.tablas_para_respaldo() where tabla = 'audit_log') = 0
  union all
  select 6, '⭐ Los respaldos viejos «backup_*» quedan fuera (tiene que ser 0)',
         (select count(*)::text from public.tablas_para_respaldo() where tabla ~* '^(backup|bkp)[_-]'),
         (select count(*) from public.tablas_para_respaldo() where tabla ~* '^(backup|bkp)[_-]') = 0
) t
order by n;


-- ============================================================================
-- DESHACER (solo si hay que revertir):
--   drop function if exists public.tablas_para_respaldo();
--   -- El respaldo vuelve a su lista fija de 45 tablas (y a dejarse 75 fuera).
-- ============================================================================
