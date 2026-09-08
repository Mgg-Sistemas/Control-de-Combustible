-- ============================================================================
-- VARIOS CONTACTOS DE EMERGENCIA POR TRABAJADOR (08-sep-2026)
--
-- Pedido del cliente: «necesito que las personas puedan tener más de un contacto
-- de emergencia». La ficha tenía UNO solo, en tres columnas planas:
-- emergency_contact_name / _phone / _relation.
--
-- Esta columna guarda la LISTA COMPLETA. Las tres columnas viejas NO se tocan y
-- se siguen escribiendo con el contacto nº 1, porque las leen la vista/RPC de
-- nómina (fix_rls_anon_nomina.sql:199-217, schema.sql:2380-2386) y el PDF de la
-- ficha. Así nada de lo que ya existe deja de funcionar.
--
-- NO HACE FALTA MIGRAR DATOS: la app reconstruye el contacto nº 1 al LEER, desde
-- las columnas viejas, cuando la lista viene vacía. Los ~200 empleados actuales
-- quedan con su contacto de siempre sin tocar una sola fila.
--
-- Forma de cada elemento: {"nombre": "...", "telefono": "...", "parentesco": "..."}
--
-- Idempotente y sin riesgo: un `add column if not exists` con valor por defecto.
-- Sin correrlo la app guarda igual (reintenta sin la columna) y se conserva solo
-- el primer contacto, exactamente como antes.
-- ============================================================================
alter table public.employees
  add column if not exists emergency_contacts jsonb not null default '[]'::jsonb;

comment on column public.employees.emergency_contacts is
  'Contactos de emergencia del trabajador, en orden: [{"nombre","telefono","parentesco"}]. El nº 1 se espeja en emergency_contact_name/_phone/_relation para los reportes que leen esas columnas.';

-- ¿Quedó? Debe devolver 1 fila: emergency_contacts | jsonb.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'employees' and column_name = 'emergency_contacts';
