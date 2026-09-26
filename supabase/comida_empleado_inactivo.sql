-- ============================================================================
-- 🚫 UN EMPLEADO DESHABILITADO NO RECIBE COMIDA (26-sep-2026)
--
-- 👉 CÓMO SE CORRE: copiar ESTE ARCHIVO COMPLETO, pegarlo en Supabase → SQL
--    Editor y darle RUN una sola vez. Es idempotente.
--
-- PEDIDO DEL CLIENTE, TEXTUAL
-- ---------------------------------------------------------------------------
--   «cuando se marque en nomina un empleado como deshabilitado o inactivo, no
--    permitas que desde comidas o distribucion pueda recibir comidas. Que al
--    escanear el carnet salga un msj que diga EMPLEADO INACTIVO»
--
-- ⭐ POR QUÉ EL CANDADO VA EN LA BASE Y NO SOLO EN LA PANTALLA
-- ---------------------------------------------------------------------------
-- La comida se registra desde DOS sitios distintos: el mostrador de 🍽️ Cocina
-- (`saveFoodDistribution`) y el editor de 🍲 Comidas, que puede agregar una
-- entrega en cualquier día (`agregarEntregaPersona`). Si la regla viviera solo
-- en la pantalla, habría que acordarse de repetirla en los dos —y en el tercero
-- que alguien escriba mañana—. Acá se escribe UNA vez y vale para todos.
--
-- ⚠️ QUÉ ESTADOS TRANCAN, Y CUÁL NO
-- ---------------------------------------------------------------------------
-- Nómina ofrece cuatro: Activo, Inactivo, Suspendido y Otro.
--   · 'inactivo' y 'suspendido' TRANCAN: son las dos maneras de decir
--     «deshabilitado», que es lo que se pidió.
--   · 'otro' NO tranca. En Nómina es un grupo APARTE, con su propia pastilla y
--     su propio conteo; trancarlo sería dejar sin comer a gente que la empresa
--     nunca marcó como salida.
--
-- ⚠️ NO TOCA NI UNA FILA VIEJA. Solo revisa lo que se registra DE AHORA EN
--    ADELANTE. Lo que ya se sirvió se sirvió: los reportes y los cobros lo
--    siguen mostrando igual, porque cambiar el pasado descuadraría cuentas ya
--    cobradas.
--
-- 📊 CUÁNTA GENTE AFECTA (medido en esta base el 26-sep-2026)
-- ---------------------------------------------------------------------------
--   · 178 empleados activos · 136 inactivos · 42 en «Otro».
--   · De los INACTIVOS, 65 personas comieron en los últimos 30 días (515
--     comidas), algunas HOY MISMO. A partir de correr esto, esas 65 personas
--     dejan de poder retirar comida.
--   ⚠️ Si alguna de ellas sí trabaja, lo que hay que arreglar es su estado en
--     Nómina — no este candado.
-- ============================================================================


-- ── 1) LA REGLA ─────────────────────────────────────────────────────────────
create or replace function public.food_bloquea_empleado_inactivo()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  st     text;
  quien  text;
begin
  -- Un CONTACTO de cocina no es de nómina: no tiene estado que revisar.
  if new.employee_id is null then
    return new;
  end if;

  select lower(btrim(coalesce(e.status, ''))),
         btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, ''))
    into st, quien
    from public.employees e
   where e.id = new.employee_id;

  -- Si el empleado no existe, esto no es asunto de este trigger: la llave
  -- foránea es la que tiene que quejarse, y con su propio mensaje.
  if st is null then
    return new;
  end if;

  if st = 'inactivo' then
    raise exception 'EMPLEADO INACTIVO: % esta marcado como inactivo en Nomina y no puede recibir comida', coalesce(nullif(quien, ''), 'esta persona')
      using hint = 'Si es un error, corrige su estado en Nomina - Empleados.';
  elsif st = 'suspendido' then
    raise exception 'EMPLEADO SUSPENDIDO: % esta suspendido en Nomina y no puede recibir comida', coalesce(nullif(quien, ''), 'esta persona')
      using hint = 'Si es un error, corrige su estado en Nomina - Empleados.';
  end if;

  return new;
end;
$fn$;

comment on function public.food_bloquea_empleado_inactivo() is
  'Tranca la entrega de comida a un empleado marcado inactivo o suspendido en Nomina. No revisa filas viejas.';


-- ── 2) EL DISPARADOR ────────────────────────────────────────────────────────
-- ⚠️ Solo en el INSERT y cuando se le CAMBIA la persona a una entrega. Un
--    UPDATE cualquiera (corregir la nota, la hora, el plato) de una entrega
--    vieja NO se tranca: si no, editar una comida servida hace dos meses sería
--    imposible apenas la persona se dé de baja.
drop trigger if exists trg_food_empleado_inactivo on public.food_distributions;
create trigger trg_food_empleado_inactivo
  before insert or update of employee_id on public.food_distributions
  for each row execute function public.food_bloquea_empleado_inactivo();


-- ── 3) VERIFICACIÓN (del 1 al 3 tienen que decir ✅) ───────────────────────
select chequeo, valor, case when ok then '✅' else '❌ REVISAR' end as estado
from (
  select 1 as n, 'La regla existe' as chequeo,
         coalesce((select 'si' from pg_proc where proname = 'food_bloquea_empleado_inactivo'
                    and pronamespace = 'public'::regnamespace limit 1), 'no') as valor,
         exists (select 1 from pg_proc where proname = 'food_bloquea_empleado_inactivo'
                  and pronamespace = 'public'::regnamespace) as ok
  union all
  select 2, 'El disparador está puesto',
         coalesce((select 'si' from pg_trigger where tgname = 'trg_food_empleado_inactivo' limit 1), 'no'),
         exists (select 1 from pg_trigger where tgname = 'trg_food_empleado_inactivo')
  union all
  -- ⭐ EL CONTROL QUE IMPORTA: no se tocó ni una entrega ya registrada.
  select 3, '⭐ Entregas ya registradas (este script NO borra ninguna)',
         (select count(*)::text from public.food_distributions),
         true
  union all
  select 4, 'Empleados que quedan trancados (inactivos + suspendidos)',
         (select count(*)::text from public.employees
           where lower(btrim(coalesce(status, ''))) in ('inactivo', 'suspendido')),
         true
  union all
  select 5, '⚠️ De esos, cuántos comieron en los últimos 30 días',
         (select count(distinct e.id)::text from public.employees e
           where lower(btrim(coalesce(e.status, ''))) in ('inactivo', 'suspendido')
             and exists (select 1 from public.food_distributions d
                          where d.employee_id = e.id
                            and d.distribution_date >= current_date - 30)),
         true
) t
order by n;


-- ============================================================================
-- DESHACER (solo si hay que revertir):
--   drop trigger if exists trg_food_empleado_inactivo on public.food_distributions;
--   drop function if exists public.food_bloquea_empleado_inactivo();
--   -- No hay nada más que deshacer: este script nunca modificó datos.
-- ============================================================================
