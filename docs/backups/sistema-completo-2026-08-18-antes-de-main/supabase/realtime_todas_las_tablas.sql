-- ============================================================================
-- Activar Realtime para TODAS las tablas que la app ahora escucha en vivo
-- ----------------------------------------------------------------------------
-- Hoy se agregó useRealtimeRefresh/realtimeFrom a ~24 pantallas que antes no
-- se refrescaban solas. Una suscripción en el código NO sirve de nada si la
-- tabla no está en la publicación `supabase_realtime` de Postgres — sin esto,
-- Supabase no emite ningún evento y la pantalla se queda "muda" en silencio
-- (sin error visible). Este script agrega TODAS las tablas usadas, de una vez,
-- para no ir descubriéndolas una por una a medida que alguien reporte que "no
-- se actualiza sola". Idempotente: si una tabla ya está publicada, no hace nada.
--
-- NO toca datos, NO borra nada — solo activa un flag de replicación. Aun así,
-- ejecútalo desde el SQL Editor de Supabase con calma, uno de los pasos que
-- avisamos siempre para cambios en la base de datos.
--
-- (Nota: `tank_levels` e `inventory_levels` son VISTAS derivadas, no se pueden
-- agregar a la publicación — sus tablas base sí están abajo: stock_movements,
-- tanks, inventory_movements, inventory_items).
-- ============================================================================
do $$
declare
  t text;
  tablas text[] := array[
    'aliados','app_roles','attendance','audit_log','authorizations','bom_versions',
    'companies','employees','feature_toggles','food_company_meals','food_distributions',
    'hose_services','inventory_items','inventory_movements','inventory_requirements',
    'inventory_transfers','machine_guards','machine_inspections','machine_inspectors',
    'machine_rounds','machinery','machinery_repairs','maintenance_requests',
    'manufacturing_orders','module_permissions','notification_reads','notifications',
    'operator_assignments','payroll_items','payroll_periods','production_routes',
    'profiles','purchase_orders','purchase_requests','staff_cargo_tariffs',
    'staff_pay_items','staff_pay_payments','staff_pay_periods','staff_payments',
    'stock_movements','supervisor_visits','suppliers','tanks','truck_attendance',
    'truck_yard_logs','uniform_deliveries','vehicles','wo_time_logs','work_centers',
    'work_orders'
  ];
begin
  foreach t in array tablas loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;  -- ya estaba publicada
      when undefined_table then null;   -- la tabla no existe en este proyecto (no rompe el resto)
      when others then null;
    end;
  end loop;
end $$;

-- Verificación (lista las que quedaron activas):
-- select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1;
