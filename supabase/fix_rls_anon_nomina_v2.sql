-- ============================================================================
-- FIX RLS v2: cierre del resto de policies de nómina con `using(true)`
-- ============================================================================
-- Follow-up explícito dejado en `fix_rls_anon_nomina.sql`, sección
-- "FUERA DE ALCANCE de este fix" (líneas ~293-302 de ese archivo):
--   staff_pay_periods (spp_all), staff_pay_payments (spp2_all),
--   staff_cargo_tariffs (sct_all), staff_pay_config (spc_all),
--   payroll_periods (pp_read), payroll_items (pi_read) — todas usaban
--   `using(true)` para lectura (y en varios casos también para
--   insert/update/delete, por ser `for all`), igual que las tablas ya
--   corregidas en el fix original (`staff_pay_items`, `staff_payments`,
--   `company_payments`, `payrolls`). Ese fix las dejó fuera solo para no
--   ampliar el alcance del cambio puntual, no porque tuvieran uso anónimo.
--
-- El patrón correcto sigue siendo el mismo que ya está en producción para
-- `price_tariffs_read` / `cpt_read` (schema.sql) y que el fix original ya
-- aplicó a `cp_select`, `pr_read`, `spi_all`, `sp_all`:
--   using (not public.is_anon())   [ + with check (...) en las `for all` ]
--
-- ----------------------------------------------------------------------------
-- EVIDENCIA DE AUSENCIA DE USO ANÓNIMO (revisada en src/, tabla por tabla) ---
-- ----------------------------------------------------------------------------
-- Definiciones originales verificadas en supabase/schema.sql:
--   línea 1451: create policy pp_read on public.payroll_periods for select to authenticated using (true);
--   línea 1455: create policy pi_read on public.payroll_items for select to authenticated using (true);
--   línea 1770: create policy spc_all on public.staff_pay_config for all to authenticated using (true) with check (true);
--   línea 1772: create policy spp_all on public.staff_pay_periods for all to authenticated using (true) with check (true);
--   línea 1776: create policy spp2_all on public.staff_pay_payments for all to authenticated using (true) with check (true);
--   línea 1793: create policy sct_all on public.staff_cargo_tariffs for all to authenticated using (true) with check (true);
--
-- payroll_periods / payroll_items: usadas SOLO desde src/screens/NominaScreen.tsx
--   (`.from('payroll_periods')` y `.from('payroll_items')`, líneas 37, 84, 94,
--   106, 108, 125, 133, 135, 153, 160, 169, 181). `NominaScreen` está
--   registrada como `Stack.Screen name="Nomina"` dentro de `MoreStack`
--   (src/navigation/index.tsx línea 176), que solo se monta cuando `showApp`
--   es verdadero (`showApp = !configured || (!!session && !isAnon)`,
--   navigation/index.tsx línea 462) — ninguna rama de QR (`qrMachineId`,
--   `qrEmployeeId`, `qrComidaId`, `qrAliadoId`) renderiza `MoreStack`.
--   Sin uso anónimo.
--
-- staff_pay_periods / staff_pay_payments: usadas SOLO desde
--   src/screens/PagoPersonalScreen.tsx (`.from('staff_pay_periods')` /
--   `.from('staff_pay_payments')`, líneas 111, 202, 215, 249, 263, 381, 391,
--   402, 414). `PagoPersonalScreen` está registrada como
--   `Stack.Screen name="PagoPersonal"` dentro de `MoreStack` (navigation/
--   index.tsx línea 177) — mismo gating por `showApp`/`loggedInReal` que
--   arriba. Sin uso anónimo.
--
-- staff_cargo_tariffs: usada SOLO desde src/components/TabuladorCargos.tsx
--   (`.from('staff_cargo_tariffs')`, líneas 25, 98, 165, 179), componente que
--   a su vez SOLO se monta como modal dentro de `PagoPersonalScreen.tsx`
--   (línea 647: `<TabuladorCargos visible={tabOpen} ... />`), es decir,
--   dentro del mismo `MoreStack` autenticado. Sin uso anónimo.
--
-- staff_pay_config: sin ninguna referencia en src/ a la fecha de este fix
--   (`grep -r "staff_pay_config" src/` no devuelve resultados) — la tabla
--   todavía no tiene consumidor en la app (está siendo creada en paralelo,
--   ver supabase/staff_pay_config.sql). Por no tener consumidor alguno,
--   mucho menos tiene uso anónimo. Se incluye aquí la policy igualmente
--   (según lo pedido) asumiendo que la tabla existirá; si `staff_pay_config`
--   aún no existe en la base al momento de ejecutar este archivo, el
--   `drop policy if exists` es un no-op seguro y el `create policy` fallará
--   con "relation does not exist" — en ese caso, ejecutar este bloque de
--   nuevo después de aplicar supabase/staff_pay_config.sql.
--
-- Conclusión: las 6 tablas se restringen a `not public.is_anon()` sin
-- ningún cambio de código en TypeScript (a diferencia de `employees` en el
-- fix original, que sí requería el RPC `employee_public_lookup`).
-- ============================================================================

-- --- payroll_periods ---------------------------------------------------------
drop policy if exists pp_read on public.payroll_periods;
create policy pp_read on public.payroll_periods
  for select to authenticated using (not public.is_anon());

-- --- payroll_items ------------------------------------------------------------
drop policy if exists pi_read on public.payroll_items;
create policy pi_read on public.payroll_items
  for select to authenticated using (not public.is_anon());

-- --- staff_pay_periods ---------------------------------------------------------
drop policy if exists spp_all on public.staff_pay_periods;
create policy spp_all on public.staff_pay_periods
  for all to authenticated
  using (not public.is_anon()) with check (not public.is_anon());

-- --- staff_pay_payments ---------------------------------------------------------
drop policy if exists spp2_all on public.staff_pay_payments;
create policy spp2_all on public.staff_pay_payments
  for all to authenticated
  using (not public.is_anon()) with check (not public.is_anon());

-- --- staff_cargo_tariffs ---------------------------------------------------------
drop policy if exists sct_all on public.staff_cargo_tariffs;
create policy sct_all on public.staff_cargo_tariffs
  for all to authenticated
  using (not public.is_anon()) with check (not public.is_anon());

-- --- staff_pay_config ------------------------------------------------------
-- OJO: esta tabla puede estar siendo creada en paralelo en
-- supabase/staff_pay_config.sql. Si aún no existe al ejecutar este bloque,
-- el DROP es un no-op y el CREATE fallará; volver a correr este bloque
-- (o todo el archivo) después de aplicar ese script.
drop policy if exists spc_all on public.staff_pay_config;
create policy spc_all on public.staff_pay_config
  for all to authenticated
  using (not public.is_anon()) with check (not public.is_anon());


-- ============================================================================
-- VERIFICACIÓN (ejecutar en STAGING, con una sesión anónima real —
-- `supabase.auth.signInAnonymously()` desde un cliente de prueba, no desde
-- el SQL editor con rol de servicio):
-- ============================================================================
-- Debe devolver 0 filas / fallar para la sesión anónima:
--   select * from public.payroll_periods limit 1;
--   select * from public.payroll_items limit 1;
--   select * from public.staff_pay_periods limit 1;
--   select * from public.staff_pay_payments limit 1;
--   select * from public.staff_cargo_tariffs limit 1;
--   select * from public.staff_pay_config limit 1;
--
-- Con sesión REAL (login normal, no anónima) todo debe seguir funcionando
-- exactamente igual que antes (Nómina, Pago a personal, Tabulador de cargos
-- son módulos solo para usuarios logueados, dentro de "Más").
-- ============================================================================
