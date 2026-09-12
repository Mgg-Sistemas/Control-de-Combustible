-- ============================================================================
-- ✅ CORRIDO Y VERIFICADO el 07-sep-2026 (pg_trigger: 42 trg_audit encendidos;
--    machine_rounds sigue apagado a propósito, con trg_audit_humano activo).
--    Queda la válvula del día siguiente, al final del archivo.
-- ============================================================================
-- REENCENDER LA AUDITORÍA EN LAS TABLAS QUE TOCAN PERSONAS (07-sep-2026)
--
-- HALLAZGO (consultando pg_trigger en producción el 07-sep-2026): desde el
-- 09-ago-2026 —el día de la caída por los crons de jornadas— `trg_audit` quedó
-- APAGADO (tgenabled = 'D') en 32 de las 42 tablas auditadas, no solo en
-- machine_rounds. La bitácora lo confirma: la última fila de supervisor_visits,
-- maintenance_requests, inventory_items, inventory_movements, control_closures,
-- truck_yard_logs, attendance, module_permissions, food_* y vehicles es del
-- 09-ago; employees y profiles solo tienen SCAN/LOGIN/LOGOUT (eventos de la app)
-- desde entonces. Es decir: hoy NO deja rastro nada de Nómina, Inventario,
-- Compras, Combustible (salvo despachos), Inspecciones (rondas), Averías,
-- Cocina, Aliados, Empresas, Pagos, Asistencia ni permisos de Usuarios.
--
-- Solo siguen grabando: machinery, dispatches, camion_viajes, machine_inspectors,
-- machine_operators, machinery_service_orders/parts, payroll_companies,
-- service_intervention_types y machine_rounds por trg_audit_humano.
--
-- LO QUE TUMBÓ EL SISTEMA fueron los CRONS sobre machine_rounds (15–20 mil filas
-- de bitácora al día). Las tablas de abajo las escriben PERSONAS desde la app:
-- antes del 09-ago sumaban entre todas ~600–800 filas/día (supervisor_visits ~170,
-- maintenance_requests ~100, truck_yard_logs ~65, inventory_items ~50,
-- control_closures ~50, attendance ~30, el resto menos de 10). Un 4 % de aquello.
--
-- machine_rounds NO se toca: sigue con trg_audit apagado y trg_audit_humano activo.
-- REVERSIBLE: cambia `enable` por `disable` y queda como estaba.
-- ============================================================================
-- MEDIDO ANTES DE CORRERLO (bitácora del 01 al 09-ago): esas 32 tablas hacían entre
-- 440 y 830 filas/día (1.500 el 08-ago, día de un script masivo de averías); los crons
-- de jornadas, de 350 a 9.000. La bitácora pesa 52 MB de una base de 146 MB: esto
-- agrega ~0,4 MB/día. La función audit_row() por fila hace un to_jsonb, una lectura
-- por clave primaria y el diff del UPDATE: milisegundos.
--
-- El lock_timeout es para no trancar a nadie: `enable trigger` toma un bloqueo
-- brevísimo por tabla, pero si una transacción larga la tiene tomada, sin esto el
-- comando se queda en cola y detrás de él se encolan las escrituras de la app.
-- Con el tope, falla limpio a los 5 s y se vuelve a intentar. Es un solo bloque:
-- o se encienden las 32 o ninguna.
do $$
declare t text;
begin
  perform set_config('lock_timeout', '5s', true);
  foreach t in array array[
    'aliados','app_roles','attendance','authorizations','companies','company_payments',
    'company_price_tariffs','control_closures','employees','fletes','food_company_meals',
    'food_distributions','fuel_intakes','inventory_items','inventory_movements',
    'inventory_transfers','machine_inspections','machinery_repairs','maintenance_requests',
    'module_permissions','operator_assignments','price_tariffs','profiles','purchase_orders',
    'purchase_requests','staff_pay_payments','supervisor_visits','tanks','transfers',
    'truck_yard_logs','uniform_deliveries','vehicles'
  ] loop
    if to_regclass('public.'||t) is not null then
      execute format('alter table public.%I enable trigger trg_audit;', t);
    end if;
  end loop;
end $$;

-- ¿Quedó? Debe devolver 0 filas: ningún trg_audit apagado fuera de machine_rounds.
select c.relname as tabla, t.tgname, t.tgenabled
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and not t.tgisinternal and t.tgname = 'trg_audit'
  and t.tgenabled = 'D' and c.relname <> 'machine_rounds';

-- Al día siguiente, la válvula de seguridad: cuántas filas de bitácora entraron
-- por tabla en 24 h. Si alguna sube a MILES, es que un cron la escribe: apágala con
--   alter table public.<tabla> disable trigger trg_audit;
-- select table_name, count(*) as filas from public.audit_log
-- where at > now() - interval '1 day' group by 1 order by 2 desc;
