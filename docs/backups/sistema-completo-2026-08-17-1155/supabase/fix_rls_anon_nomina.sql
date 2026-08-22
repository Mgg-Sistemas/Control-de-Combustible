-- ============================================================================
-- FIX RLS: sesión anónima (QR sin login) puede leer nómina / datos bancarios
-- ============================================================================
-- Hallazgo (docs/plan-mejoras.html, sección "03 Backend · seguridad · datos"):
-- varias policies de RLS usan `using(true)` (o `for all ... using(true)`), lo
-- que en Supabase también le da acceso a la SESIÓN ANÓNIMA del flujo de QR
-- (rol Postgres `authenticated`, pero con el claim `is_anonymous = true` en el
-- JWT — ver `public.is_anon()` en schema.sql ~línea 1241). Esa sesión se abre
-- SIN login cada vez que un operador escanea el QR de una máquina o de un
-- carnet (`supabase.auth.signInAnonymously()` en MachineQuickScreen.tsx,
-- EmployeeCardScreen.tsx, FoodCompanyScreen.tsx).
--
-- Tablas/columnas sensibles expuestas HOY a esa sesión anónima:
--   • public.employees        → policy `employees_read` = `using(true)` (sin
--     siquiera `to authenticated`, o sea PUBLIC). Expone TODA la fila,
--     incluyendo: base_salary, salary_currency, bank_name, bank_account,
--     bank_holder, bank_cedula, precio_hora/dia/noche/semana/quincena/mes,
--     notes (notas internas de RRHH).
--   • public.staff_pay_items  → policy `spi_all` = `for all using(true)
--     with check(true)`. Expone precio_hora/dia/semana, bonos, deducciones,
--     devengado, total (montos de nómina por persona y período).
--   • public.staff_payments   → policy `sp_all` = `for all using(true)
--     with check(true)`. Expone monto, precio_unit, metodo, banco, cuenta
--     (pagos reales hechos a cada trabajador, con datos bancarios en texto).
--   • public.company_payments → policy `cp_select` = `using(true)`. Expone
--     amount, detail (montos pagados por empresa, con desglose de horas/
--     precio en el jsonb).
--   • public.payrolls         → policy `pr_read` = `using(true)`. IMPORTANTE:
--     la auditoría (plan-mejoras.html línea 187) afirma que `payrolls` "ya"
--     usa `using (not public.is_anon())` como patrón correcto a copiar. Al
--     revisar schema.sql (línea 906) eso es INEXACTO: solo `pr_insert` y
--     `pr_delete` usan `not is_anon()`; la policy de LECTURA `pr_read` sigue
--     en `using(true)` y por tanto tiene el mismo problema (expone
--     company_name + amount de nómina por empresa a la sesión anónima).
--     Se corrige aquí también, ya que es el mismo módulo y el mismo patrón.
--
-- El patrón CORRECTO que sí existe hoy en el schema (y que se usa de
-- referencia real en este archivo) es el de `price_tariffs_read` / `cpt_read`
-- (schema.sql líneas 497 y 514):
--   create policy price_tariffs_read on public.price_tariffs
--     for select to authenticated using (not public.is_anon());
--
-- ----------------------------------------------------------------------------
-- EVIDENCIA DE USO ANÓNIMO LEGÍTIMO (revisado en src/, línea por línea) ------
-- ----------------------------------------------------------------------------
-- staff_pay_items / staff_payments / company_payments / payrolls / y las
-- tablas hermanas de nómina (staff_pay_periods, staff_pay_payments,
-- staff_cargo_tariffs, payroll_periods, payroll_items, staff_pay_config):
-- SIN NINGÚN uso anónimo legítimo. Todas se leen/escriben solo desde
-- pantallas registradas como `Stack.Screen` dentro del stack autenticado
-- (ControlPagosScreen.tsx, PagoPersonalScreen.tsx, PagoPorPersona.tsx,
-- NominaScreen.tsx, TabuladorCargos.tsx), que en src/navigation/index.tsx
-- solo se montan cuando `showApp = !configured || (!!session && !isAnon)`
-- es verdadero, es decir, con sesión real (no anónima). Restringir su
-- lectura a `not public.is_anon()` es 100% seguro, no requiere cambios de
-- código.
--
-- employees: SÍ hay uso anónimo legítimo, en tres archivos:
--   1) src/lib/jornada.ts:75 — startJornada()
--        supabase.from('employees').select('cargo, company_id').eq('cedula', ci).limit(1)
--      Verifica que la cédula esté en nómina y con qué empresa. NO necesita
--      sueldo ni datos bancarios.
--   2) src/screens/MachineQuickScreen.tsx — vista de OPERADOR anónima
--      (navigation/index.tsx línea ~504, rama `qrMachineId && !loggedInReal && qrOperator`):
--        línea 180: .select('first_name, last_name, cargo, cedula').eq('cedula', ci)
--        línea 347: .select('first_name, last_name, cargo, cedula').eq('id', id)
--        línea 375: .select('id, first_name, last_name, cargo, cedula, company_id, company:company_id(name)').eq('id', id)
--      Autocompleta nombre/cargo al escribir la cédula o escanear el carnet,
--      y valida que el operador sea de la misma empresa que la máquina.
--   3) src/screens/EmployeeCardScreen.tsx:55-59 — "Ficha del trabajador",
--      se abre SIN login al escanear el QR de un carnet (navigation/index.tsx
--      línea ~493-496, rama `qrEmployeeId` sin `loggedInCocina` ni `wantLogin`):
--        supabase.from('employees').select('*, company:company_id(name)').eq('id', employeeId)
--      *** Esta es la fuga MÁS GRAVE: hace `select('*')` bajo sesión anónima,
--      o sea que HOY CUALQUIERA que escanee (o adivine/comparta) el QR de un
--      carnet recibe en la respuesta JSON base_salary, bank_account,
--      bank_holder, bank_cedula, precio_hora/dia/noche/semana, notes, etc.,
--      aunque la pantalla no los pinte en la UI. Peor aún: el botón
--      "Ficha completa (PDF)" de esa misma pantalla (siempre visible, sin
--      gating por sesión) genera un PDF con una sección "🏦 Datos bancarios"
--      (ver src/lib/ficha.ts:73-75: bank_name, bank_account, bank_holder,
--      bank_cedula) — es decir, HOY un escaneo anónimo del carnet puede
--      descargar un PDF con la cuenta bancaria del trabajador. Esto es
--      exactamente el tipo de fuga que esta auditoría busca cerrar, y es más
--      amplio que lo descrito originalmente (no es solo jornada.ts).
--      Los campos que SÍ pinta esa pantalla (y que por tanto sí necesita
--      poder leer de forma anónima) son: id, ficha_number, first_name,
--      last_name, cedula, cargo, department, grupo, photo_url, birth_date,
--      gender, blood_type, nationality, marital_status, phone, email,
--      address, city, state, emergency_contact_name/phone/relation,
--      hire_date, status, company_id/company_name, y (para el PDF)
--      talla_camisa/pantalon/zapatos. `notes` SÍ se pinta hoy (si no está
--      vacío) pero es texto libre de RRHH (podría llevar comentarios
--      internos/disciplinarios) — se EXCLUYE a propósito de la función
--      pública nueva; es una decisión de este fix, revísala y agrégala de
--      vuelta si el negocio la necesita en el carnet público.
--
--   Otros archivos que leen `employees` (CocinaScreen.tsx, FoodCompanyScreen.tsx,
--   ControlMaquinariaScreen.tsx, TabuladorCargos.tsx, PagoPersonalScreen.tsx,
--   NominaScreen.tsx, SupervisorScreen.tsx, AsistenciaScreen.tsx,
--   EmpleadosScreen.tsx, UniformesScreen.tsx) SOLO se montan con sesión real
--   (`loggedInReal`/`showApp`), igual que las pantallas de nómina — no se ven
--   afectados por restringir `employees_read`.
--   (FoodCompanyScreen.tsx sí tiene una llamada a `signInAnonymously()` en su
--   useEffect, pero en la práctica es código muerto: `navigation/index.tsx`
--   solo la monta cuando `loggedInReal` ya es true, así que `getSession()`
--   siempre encuentra sesión y nunca dispara el signInAnonymously.)
--
-- ----------------------------------------------------------------------------
-- DISEÑO DEL FIX ---------------------------------------------------------
-- ----------------------------------------------------------------------------
-- 1) staff_pay_items / staff_payments / company_payments / payrolls: se
--    cambia la policy de lectura a `using (not public.is_anon())`, copiando
--    el patrón real y correcto de `price_tariffs_read`/`cpt_read`. Puro SQL,
--    NO requiere tocar código de la app.
--
-- 2) employees: se restringe `employees_read` a `not public.is_anon()` y se
--    crea una función `security definer` — `public.employee_public_lookup` —
--    que el rol `anon`/`authenticated` (incluida la sesión anónima) puede
--    ejecutar vía RPC, y que devuelve SOLO las columnas no sensibles que las
--    3 pantallas de arriba necesitan. Esto SÍ requiere cambiar código
--    TypeScript (ver checklist al final) para que esas 3 pantallas usen
--    `.rpc('employee_public_lookup', {...})` en vez de `.from('employees')`.
--    *** NO EJECUTAR el DROP/CREATE de `employees_read` en producción hasta
--    que ese cambio de código esté desplegado, o se rompe el flujo de
--    operadores en campo (QR de máquina) y el carnet público. ***
--
-- ============================================================================


-- ============================================================================
-- PARTE 1 — Nómina de personal y pagos por empresa: sin uso anónimo legítimo.
-- Solo SQL, no requiere cambios de código.
-- ============================================================================

-- --- company_payments -------------------------------------------------------
drop policy if exists cp_select on public.company_payments;
create policy cp_select on public.company_payments
  for select to authenticated using (not public.is_anon());
-- cp_write ya estaba correcta (using (not public.is_anon())) — no se toca.

-- --- payrolls ----------------------------------------------------------------
-- Corrige la policy de LECTURA, que (a diferencia de lo que decía la
-- auditoría) seguía en `using(true)`. pr_insert / pr_delete ya estaban bien.
drop policy if exists pr_read on public.payrolls;
create policy pr_read on public.payrolls
  for select to authenticated using (not public.is_anon());

-- --- staff_pay_items (precio_hora/dia/noche/semana, bonos, deducciones) -----
drop policy if exists spi_all on public.staff_pay_items;
create policy spi_all on public.staff_pay_items
  for all to authenticated
  using (not public.is_anon()) with check (not public.is_anon());

-- --- staff_payments (pagos reales por persona: monto, banco, cuenta) -------
drop policy if exists sp_all on public.staff_payments;
create policy sp_all on public.staff_payments
  for all to authenticated
  using (not public.is_anon()) with check (not public.is_anon());


-- ============================================================================
-- PARTE 2 — employees: SÍ hay uso anónimo legítimo (jornada.ts,
-- MachineQuickScreen.tsx, EmployeeCardScreen.tsx). Requiere RPC + cambio de
-- código en el mismo despliegue (ver checklist al final).
-- ============================================================================

-- Función de solo-lectura para la sesión anónima (y cualquier autenticado):
-- devuelve el subconjunto de columnas de `employees` que NO es sensible
-- (sin sueldo, sin datos bancarios, sin precios de pago a personal, sin
-- notas internas). security definer para poder leer la tabla real aunque
-- `employees_read` quede restringida a `not is_anon()`.
create or replace function public.employee_public_lookup(
  p_id uuid default null,
  p_cedula text default null
)
returns table (
  id uuid,
  company_id uuid,
  company_name text,
  ficha_number text,
  first_name text,
  last_name text,
  cedula text,
  cargo text,
  department text,
  grupo text,
  photo_url text,
  birth_date date,
  gender text,
  blood_type text,
  nationality text,
  marital_status text,
  phone text,
  email text,
  address text,
  city text,
  state text,
  emergency_contact_name text,
  emergency_contact_phone text,
  emergency_contact_relation text,
  hire_date date,
  status text,
  talla_camisa text,
  talla_pantalon text,
  talla_zapatos text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id, e.company_id, c.name as company_name, e.ficha_number, e.first_name, e.last_name,
    e.cedula, e.cargo, e.department, e.grupo, e.photo_url, e.birth_date, e.gender, e.blood_type,
    e.nationality, e.marital_status, e.phone, e.email, e.address, e.city, e.state,
    e.emergency_contact_name, e.emergency_contact_phone, e.emergency_contact_relation,
    e.hire_date, e.status, e.talla_camisa, e.talla_pantalon, e.talla_zapatos
  from public.employees e
  left join public.companies c on c.id = e.company_id
  where (p_id is not null and e.id = p_id)
     or (p_cedula is not null and btrim(p_cedula) <> '' and e.cedula = btrim(p_cedula))
  limit 1
$$;

-- La sesión anónima usa el rol `authenticated` (con is_anonymous=true en el
-- JWT); se otorga ejecución también a `anon` por si en algún punto se llama
-- sin JWT en absoluto (defensivo, no debería ocurrir en este flujo).
grant execute on function public.employee_public_lookup(uuid, text) to anon, authenticated;

-- Ahora sí, restringir la lectura directa de la tabla a sesiones NO anónimas.
-- *** SOLO ejecutar esta línea después de desplegar el cambio de código de
-- la PARTE 3 (checklist). Si se ejecuta antes, se rompe: el autocompletado
-- de cédula en el inicio de jornada, la puerta de identificación del QR de
-- máquina, y la ficha pública del carnet. ***
drop policy if exists employees_read on public.employees;
create policy employees_read on public.employees
  for select to authenticated using (not public.is_anon());
-- employees_write ya estaba correcta (using (not public.is_anon())) — no se toca.


-- ============================================================================
-- PARTE 3 — CHECKLIST de cambios de código TypeScript (obligatorios, en el
-- MISMO cambio/PR que la restricción de `employees_read`, no por separado):
-- ============================================================================
--
--  [ ] src/lib/jornada.ts:75
--        ANTES: supabase.from('employees').select('cargo, company_id').eq('cedula', ci).limit(1)
--        DESPUÉS: supabase.rpc('employee_public_lookup', { p_cedula: ci })
--                 (tomar cargo/company_id de data?.[0])
--
--  [ ] src/screens/MachineQuickScreen.tsx
--        línea ~180 (autocompletar por cédula):
--          .from('employees').select('first_name, last_name, cargo, cedula').eq('cedula', ci).limit(1)
--          → .rpc('employee_public_lookup', { p_cedula: ci })
--        línea ~347 (onCarnetScanned, por id):
--          .from('employees').select('first_name, last_name, cargo, cedula').eq('id', id).maybeSingle()
--          → .rpc('employee_public_lookup', { p_id: id }) (tomar data?.[0])
--        línea ~375 (onGateCarnet, por id, con nombre de empresa):
--          .from('employees').select('id, first_name, last_name, cargo, cedula, company_id, company:company_id(name)').eq('id', id).maybeSingle()
--          → .rpc('employee_public_lookup', { p_id: id }) y usar el campo
--            plano `company_name` en vez de `company?.name`.
--
--  [ ] src/screens/EmployeeCardScreen.tsx:50-59
--        Es la MISMA pantalla para el uso autenticado (módulo Empleados,
--        necesita TODOS los campos incl. sueldo/banco para editar) y el uso
--        anónimo (QR del carnet, solo lectura pública). Hay que ramificar:
--          const { data: s } = await supabase.auth.getSession();
--          const anon = !s.session || s.session.user?.is_anonymous;
--          if (!s.session) { try { await supabase.auth.signInAnonymously(); } catch {} }
--          const { data } = anon
--            ? await supabase.rpc('employee_public_lookup', { p_id: employeeId }).then(r => ({ data: r.data?.[0] ?? null }))
--            : await supabase.from('employees').select('*, company:company_id(name)').eq('id', employeeId).maybeSingle();
--        Nota: cuando venga del RPC, `data.company_name` reemplaza a
--        `data.company?.name` — revisar el mapeo de `companyName` unas
--        líneas más abajo (línea ~60) para que use el campo correcto según
--        la rama. Además, mientras sea anónimo, los campos financieros
--        (base_salary, bank_*, precio_*) NO estarán en `emp`, así que la
--        sección "🏦 Datos bancarios" del PDF (src/lib/ficha.ts:73-75)
--        saldrá vacía para escaneos anónimos — ESE ES EL COMPORTAMIENTO
--        DESEADO (ahí es donde estaba la fuga).
--
--  [ ] Probar los 3 flujos en un entorno de STAGING antes de producción:
--        1. Escanear QR de máquina → "Operadores" → escribir cédula → debe
--           autocompletar nombre/cargo igual que antes.
--        2. Escanear QR de máquina → "Operadores" → escanear carnet → debe
--           identificar al operador y bloquear por empresa igual que antes.
--        3. Escanear QR de un carnet de empleado (sin login) → debe abrir la
--           ficha con foto/nombre/cargo/contacto igual que antes, y el PDF
--           "Ficha completa" YA NO debe traer sueldo ni datos bancarios.
--
-- ============================================================================
-- FUERA DE ALCANCE de este fix (mismo problema, no mencionado en el pedido
-- original; NO se toca aquí, se deja anotado para un follow-up):
--   staff_pay_periods (spp_all), staff_pay_payments (spp2_all),
--   staff_cargo_tariffs (sct_all), staff_pay_config (spc_all),
--   payroll_periods (pp_read), payroll_items (pi_read) — todas usan
--   `using(true)` para SELECT igual que las de arriba. No se encontró
--   ningún uso anónimo de estas tablas en src/ (mismas pantallas admin), así
--   que el mismo cambio (`not public.is_anon()`) sería igual de seguro, pero
--   se deja fuera para no ampliar el alcance de este cambio puntual.
-- ============================================================================


-- ============================================================================
-- VERIFICACIÓN (ejecutar en STAGING, no en producción, antes y después del
-- fix). Requiere poder generar un JWT anónimo real de Supabase (por ejemplo
-- con `supabase.auth.signInAnonymously()` desde un cliente de prueba, o
-- probando desde la app apuntando a staging) — estas queries de ejemplo
-- asumen que ya estás autenticado como esa sesión anónima al correrlas
-- (p. ej. desde el SQL editor de Supabase no vale, porque ahí usas tu rol de
-- servicio; hay que probarlo desde el cliente/anon key real).
-- ============================================================================

-- 1) Debe fallar / devolver 0 filas para la sesión anónima (antes del fix
--    devolvía todas las columnas, incluido sueldo y banco):
--    select base_salary, bank_account from public.employees limit 1;

-- 2) Debe seguir funcionando igual para la sesión anónima (reemplazo del
--    autocompletado de cédula / carnet):
--    select * from public.employee_public_lookup(p_cedula => '12345678');
--    select * from public.employee_public_lookup(p_id => '<uuid-de-un-empleado>');

-- 3) Debe fallar / devolver 0 filas para la sesión anónima:
--    select * from public.staff_pay_items limit 1;
--    select * from public.staff_payments limit 1;
--    select * from public.company_payments limit 1;
--    select * from public.payrolls limit 1;

-- 4) Con sesión REAL (login normal, no anónima) todo lo anterior debe seguir
--    funcionando exactamente igual que antes del fix (los módulos de Nómina,
--    Control de pagos y Pago a personal son solo para usuarios logueados).
