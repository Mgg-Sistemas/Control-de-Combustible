-- ============================================================================
-- VIAJES DE CAMIONES — QUE BORRAR UN CAMIÓN O UN USUARIO NO SE LLEVE LOS VIAJES
--
-- 👉 CÓMO SE CORRE: copiar ESTE ARCHIVO COMPLETO, pegarlo en Supabase → SQL
--    Editor y darle RUN una sola vez. Termina mostrando una tabla de verificación.
--
-- ⚠️ Editar este .sql NO lo aplica. Hay que correrlo a mano.
-- ✅ IDEMPOTENTE: si las claves ya están en RESTRICT, no toca nada.
-- ✅ NO BORRA NI CAMBIA NI UN VIAJE. Cero insert, cero update, cero delete sobre
--    datos: solo cambia la REGLA DE BORRADO de dos claves foráneas.
--
-- ⚠️⚠️ LEE ESTO ANTES DE CORRERLO — CAMBIA DOS COSAS QUE HOY FUNCIONAN:
--   1. Borrar del catálogo un camión QUE TENGA VIAJES dejará de ser posible. En
--      Equipos → 🗑️ Eliminar saldrá en rojo «No se puede eliminar: tiene
--      movimientos o registros asociados». Ya pasa hoy con los camiones que
--      tienen despachos, así que no es un comportamiento nuevo.
--   2. Borrar el USUARIO de un listero que tenga viajes dejará de ser posible.
--      Si necesitas dar de baja a alguien, desactívalo en vez de borrarlo.
--   Si alguna de las dos te estorba, NO lo corras y dímelo: hay una variante
--   que permite borrar al listero conservando sus viajes con el nombre.
--
-- QUÉ RESUELVE
-- ---------------------------------------------------------------------------
-- `viajes_camiones.sql:13` y `:15` declararon las dos claves con ON DELETE
-- CASCADE, así que hoy:
--   · borrar un camión del catálogo se lleva TODOS sus viajes, sin aviso;
--   · borrar el usuario de un listero también (la Edge Function
--     `admin-manage-user` borra de `auth.users`, que cascadea a `profiles` y de
--     ahí a `camion_viajes`).
-- La bitácora del listero es trabajo de campo que nadie puede reconstruir, y
-- encima es la base de un pago. No puede depender de que nadie toque un botón.
--
-- POR QUÉ RESTRICT Y NO `SET NULL`
-- ---------------------------------------------------------------------------
-- Porque desde `viajes_camion_fuera_catalogo.sql` existe el CHECK
-- `cv_fuera_catalogo_coherente`, que exige `machinery_id IS NOT NULL` cuando
-- `fuera_catalogo = false`. Con `set null`, al borrar el camión la fila quedaría
-- `fuera_catalogo=false` + `machinery_id=null` → viola el CHECK (23514) y el
-- borrado aborta IGUAL, pero con un mensaje que no entiende nadie.
-- Con RESTRICT el error es 23503, que la app YA traduce a un mensaje claro
-- (`src/components/RecordForm.tsx`). Mismo criterio que `dispatches.machinery_id`
-- y `haul_order_items.machinery_id`, que ya son restrictivas en este esquema.
-- ============================================================================


-- ── 1) LAS DOS CLAVES FORÁNEAS ──────────────────────────────────────────────
-- El nombre de la constraint NO se escribe a mano: se busca por columna, porque
-- las claves se crearon con `references` en línea y el nombre lo puso Postgres.
-- `not valid` + `validate` aparte: la validación toma un candado más suave que
-- el ADD normal, y las filas ya cumplen (la clave existe desde el primer día).
do $$
declare
  r       record;
  destino text;
  nuevo   text;
begin
  for r in
    select att.attname     as col,
           con.conname     as nombre,
           con.confdeltype as regla_actual
      from pg_constraint con
      join pg_attribute  att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
     where con.conrelid = 'public.camion_viajes'::regclass
       and con.contype  = 'f'
       and array_length(con.conkey, 1) = 1
       and att.attname in ('machinery_id', 'listero_id')
  loop
    if r.regla_actual = 'r' then
      raise notice 'La clave de % ya está en RESTRICT — no se toca.', r.col;
      continue;
    end if;
    destino := case r.col when 'machinery_id' then 'public.machinery(id)'
                          else 'public.profiles(id)' end;
    nuevo   := 'camion_viajes_' || r.col || '_fkey';
    execute format('alter table public.camion_viajes drop constraint %I', r.nombre);
    execute format(
      'alter table public.camion_viajes add constraint %I foreign key (%I) references %s on delete restrict not valid',
      nuevo, r.col, destino);
    execute format('alter table public.camion_viajes validate constraint %I', nuevo);
    raise notice 'La clave de % pasó a ON DELETE RESTRICT.', r.col;
  end loop;
end $$;

comment on constraint camion_viajes_machinery_id_fkey on public.camion_viajes is
  'RESTRICT a propósito: borrar un camión del catálogo NO debe llevarse su bitácora de viajes, que es la base de un pago. Si de verdad hay que borrar el camión, primero se decide qué hacer con los viajes.';
comment on constraint camion_viajes_listero_id_fkey on public.camion_viajes is
  'RESTRICT a propósito: borrar el usuario de un listero NO debe llevarse los viajes que registró. Para dar de baja a alguien, desactivarlo, no borrarlo.';


-- ── 2) VERIFICACIÓN ─────────────────────────────────────────────────────────
-- Los 6 renglones tienen que decir ✅.
with fks as (
  select att.attname as col, con.confdeltype::text as del, con.convalidated as valido
    from pg_constraint con
    join pg_attribute  att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
   where con.conrelid = 'public.camion_viajes'::regclass
     and con.contype = 'f' and array_length(con.conkey, 1) = 1
)
select chequeo, valor, case when ok then '✅' else '❌ REVISAR' end as estado
from (
  select 1 as n, '⭐ Borrar un CAMIÓN ya no se lleva sus viajes' as chequeo,
         coalesce((select del from fks where col = 'machinery_id'), 'sin clave') as valor,
         coalesce((select del from fks where col = 'machinery_id'), 'x') = 'r' as ok
  union all
  select 2, '⭐ Borrar un LISTERO ya no se lleva sus viajes',
         coalesce((select del from fks where col = 'listero_id'), 'sin clave'),
         coalesce((select del from fks where col = 'listero_id'), 'x') = 'r'
  union all
  select 3, 'Las dos claves quedaron VALIDADAS',
         (select count(*)::text from fks where valido and col in ('machinery_id','listero_id')),
         (select count(*) from fks where valido and col in ('machinery_id','listero_id')) = 2
  union all
  select 4, 'El CHECK de fuera de catálogo sigue en pie',
         (select count(*)::text from pg_constraint where conname = 'cv_fuera_catalogo_coherente'),
         (select count(*) from pg_constraint where conname = 'cv_fuera_catalogo_coherente') = 1
  union all
  -- CONTROL: nada se borró. Tiene que ser el mismo número de antes de correr.
  select 5, '⭐ Viajes en total (este script NO los toca)',
         (select count(*)::text from public.camion_viajes), true
  union all
  select 6, 'Viajes apuntando a un camión que ya no existe (debe ser 0)',
         (select count(*)::text from public.camion_viajes v
           where v.machinery_id is not null
             and not exists (select 1 from public.machinery m where m.id = v.machinery_id)),
         (select count(*) from public.camion_viajes v
           where v.machinery_id is not null
             and not exists (select 1 from public.machinery m where m.id = v.machinery_id)) = 0
) t order by n;


-- ============================================================================
-- DESHACER (solo si hay que revertir). Descomentar y correr aparte.
-- ⚠️ VOLVER A CASCADE REPONE EL RIESGO DE PERDER VIAJES.
-- ============================================================================
-- alter table public.camion_viajes drop constraint camion_viajes_machinery_id_fkey;
-- alter table public.camion_viajes add constraint camion_viajes_machinery_id_fkey
--   foreign key (machinery_id) references public.machinery(id) on delete cascade;
-- alter table public.camion_viajes drop constraint camion_viajes_listero_id_fkey;
-- alter table public.camion_viajes add constraint camion_viajes_listero_id_fkey
--   foreign key (listero_id) references public.profiles(id) on delete cascade;
