-- ============================================================================
-- FIX: condicion de carrera en validacion de stock (despachos y traslados)
-- ============================================================================
-- PROBLEMA
--   Las funciones trigger public.mv_dispatch() y public.mv_transfer()
--   (definidas en supabase/schema.sql) validan "stock disponible" leyendo
--   la vista public.tank_levels (SUM agregado sobre stock_movements) y
--   comparando contra los litros solicitados, ANTES de insertar el nuevo
--   movimiento. Esa lectura es un SELECT normal (MVCC, snapshot de la
--   transaccion), sin ningun bloqueo sobre el tanque.
--
--   Si dos despachos (o traslados) concurrentes sobre el MISMO tanque
--   corren en transacciones distintas, ambas transacciones pueden leer el
--   mismo valor de "available" (ninguna ve los INSERT del otro porque aun
--   no hizo commit), pasar la validacion "disponible >= solicitado" y
--   luego insertar sus movimientos: el resultado es que el tanque termina
--   en negativo aunque cada validacion individual haya sido "correcta".
--
-- FIX
--   Se agrega, DENTRO de la misma transaccion y ANTES de leer/validar el
--   stock disponible, un bloqueo pesimista sobre la fila del tanque:
--
--       perform 1 from public.tanks where id = <tank_id> for update;
--
--   `SELECT ... FOR UPDATE` toma un lock exclusivo de fila sobre
--   public.tanks. Como AMBAS transacciones concurrentes pasan por esta
--   misma linea (misma funcion trigger, mismo tanque), la segunda queda
--   BLOQUEADA esperando hasta que la primera termine (COMMIT o ROLLBACK).
--   Recien entonces la segunda transaccion hace su SELECT sobre
--   tank_levels, y para ese momento ya ve (read committed) los movimientos
--   que la primera transaccion confirmo -- por lo tanto valida contra el
--   stock real y actualizado, no contra uno "stale". Se usa PERFORM (no
--   SELECT ... INTO) porque en PL/pgSQL un SELECT cuyo resultado se
--   descarta debe expresarse con PERFORM.
--
--   NO se modifica ninguna regla de negocio: los mensajes de error, los
--   montos, el orden de las validaciones "insuficiente" y la logica de
--   INSERT/UPDATE/DELETE quedan exactamente iguales a como estan hoy en
--   supabase/schema.sql. El UNICO cambio funcional es la adicion del
--   `for update` justo antes de leer tank_levels.
--
-- ALCANCE DE ESTE ARCHIVO
--   Este script reemplaza por completo (CREATE OR REPLACE FUNCTION) las
--   funciones trigger:
--     - public.mv_dispatch()  (dispatches -> descuenta de tank_id)
--     - public.mv_transfer()  (transfers  -> descuenta de from_tank_id)
--
--   NO se toca public.mv_intake() (los ingresos no descuentan stock, no
--   hay condicion de carrera que corregir alli) ni ninguna otra funcion,
--   trigger, tabla o politica RLS del esquema.
--
-- IDEMPOTENCIA
--   El script es idempotente: usa `create or replace function` (se puede
--   ejecutar las veces que sea necesario sin efectos secundarios) y
--   `create index if not exists` para el indice nuevo. Los triggers que
--   apuntan a estas funciones (trg_mv_dispatch, trg_mv_transfer) NO se
--   tocan porque ya existen y ya apuntan a estas funciones por nombre;
--   `create or replace function` actualiza el cuerpo sin necesidad de
--   recrear el trigger.
--
-- COMO APLICAR
--   Ejecutar este archivo completo contra la base (psql, Supabase SQL
--   editor, o migracion). Es seguro re-ejecutarlo.
--
-- RECOMENDACION IMPORTANTE — PROBAR ANTES DE PRODUCCION
--   Este cambio toca la integridad de datos de combustible en produccion.
--   Antes de confiar en el, se recomienda fuertemente probarlo en un
--   entorno de staging/pruebas simulando DOS despachos (o traslados)
--   concurrentes contra el mismo tanque con stock justo al limite (por
--   ejemplo, 10 litros disponibles y dos despachos de 8 litros cada uno
--   lanzados en paralelo desde dos conexiones/transacciones distintas) y
--   confirmar que:
--     1. Solo uno de los dos despachos se confirma exitosamente.
--     2. El segundo recibe el error "Stock insuficiente en el tanque"
--        (no un tanque en negativo).
--     3. select * from public.tank_levels where id = '<tank_id>' nunca
--        muestra current_l negativo tras la prueba.
--   No asumir que el fix es correcto solo por revisar el SQL: verificarlo
--   con una prueba de concurrencia real (dos sesiones psql simultaneas, o
--   un script que dispare ambos INSERT en paralelo) antes de aplicarlo a
--   produccion.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Indice sugerido: acelera los DELETE por (source_table, source_id) que
-- hacen mv_intake/mv_dispatch/mv_transfer en cada UPDATE/DELETE del
-- origen (fuel_intakes/dispatches/transfers). No existia en schema.sql
-- (solo existe idx_stock_movements_tank sobre tank_id).
-- ----------------------------------------------------------------------------
create index if not exists idx_stock_movements_source
  on public.stock_movements(source_table, source_id);

-- ----------------------------------------------------------------------------
-- mv_dispatch(): despachos de combustible (dispatches -> tank_id)
-- Misma logica que en schema.sql; unico cambio: "for update" antes de leer
-- tank_levels, dentro del bloque "if NEW.tank_id is not null".
-- ----------------------------------------------------------------------------
create or replace function public.mv_dispatch() returns trigger
language plpgsql security definer set search_path = public as $$
declare available numeric;
begin
  if (TG_OP in ('UPDATE','DELETE')) then
    delete from stock_movements where source_table='dispatches' and source_id = OLD.id;
  end if;
  if (TG_OP in ('INSERT','UPDATE')) then
    -- Solo descuenta stock si el surtido viene de un TANQUE. Si tank_id es null, es
    -- carga DIRECTA de bomba: solo se registran los litros, no se toca ningún tanque.
    if NEW.tank_id is not null then
      -- FIX RACE CONDITION: bloquea la fila del tanque ANTES de leer el stock
      -- disponible. Un segundo despacho concurrente sobre el mismo tanque
      -- queda esperando aqui hasta que este termine (commit/rollback), en
      -- vez de leer un stock "stale" y validar contra un valor desactualizado.
      perform 1 from public.tanks where id = NEW.tank_id for update;
      select current_l into available from tank_levels where id = NEW.tank_id;
      if coalesce(available,0) < NEW.liters then
        raise exception 'Stock insuficiente en el tanque (disponible %, solicitado %)', available, NEW.liters;
      end if;
      insert into stock_movements(tank_id, movement, liters, source_table, source_id)
      values (NEW.tank_id, 'consumo', -NEW.liters, 'dispatches', NEW.id);
    end if;
  end if;
  if (TG_OP = 'DELETE') then return OLD; end if;
  return NEW;
end $$;

-- ----------------------------------------------------------------------------
-- mv_transfer(): traslados entre tanques (transfers -> from_tank_id / to_tank_id)
-- Misma logica que en schema.sql; unico cambio: "for update" antes de leer
-- tank_levels del tanque ORIGEN (from_tank_id), que es el unico que se
-- valida contra stock insuficiente.
-- ----------------------------------------------------------------------------
create or replace function public.mv_transfer() returns trigger
language plpgsql security definer set search_path = public as $$
declare available numeric;
begin
  if (TG_OP in ('UPDATE','DELETE')) then
    delete from stock_movements where source_table='transfers' and source_id = OLD.id;
  end if;
  if (TG_OP in ('INSERT','UPDATE')) then
    -- FIX RACE CONDITION: bloquea la fila del tanque ORIGEN ANTES de leer el
    -- stock disponible. Un segundo traslado (o despacho) concurrente sobre
    -- el mismo tanque origen queda esperando aqui hasta que este termine
    -- (commit/rollback), en vez de leer un stock "stale".
    perform 1 from public.tanks where id = NEW.from_tank_id for update;
    select current_l into available from tank_levels where id = NEW.from_tank_id;
    if coalesce(available,0) < NEW.liters then
      raise exception 'Stock insuficiente en el tanque origen (disponible %, solicitado %)', available, NEW.liters;
    end if;
    insert into stock_movements(tank_id, movement, liters, source_table, source_id)
    values (NEW.from_tank_id, 'traslado_salida', -NEW.liters, 'transfers', NEW.id),
           (NEW.to_tank_id,   'traslado_entrada', NEW.liters, 'transfers', NEW.id);
  end if;
  if (TG_OP = 'DELETE') then return OLD; end if;
  return NEW;
end $$;

-- ============================================================================
-- Fin del fix. Los triggers trg_mv_dispatch y trg_mv_transfer (definidos en
-- schema.sql) siguen apuntando a estas funciones por nombre y no requieren
-- ningun cambio.
-- ============================================================================
