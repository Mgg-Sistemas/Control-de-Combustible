-- ============================================================================
-- NÓMINA — Unificar y normalizar el DEPARTAMENTO de los empleados.
-- Deja los departamentos IGUAL que en los reportes (misma lógica que
-- src/lib/personal.ts). Idempotente: se puede correr las veces que haga falta.
--
--   1) Unifica variantes de un mismo departamento escrito distinto
--      (administrativo/adminitrativo, OPERACIONES DE MAQUINAS/MAQUINARIAS, …).
--   2) Rellena los empleados SIN departamento infiriéndolo del CARGO
--      (p. ej. un encargado de cocina sin departamento → COCINA).
--
-- Usa ~* (regex sin distinguir mayúsculas). Los nombres en la nómina están sin
-- acentos, por eso los patrones también van sin acentos.
-- ============================================================================

-- ── 1) UNIFICACIÓN por nombre de departamento (solo filas CON departamento) ──
update public.employees set department = 'ADMINISTRATIVO'
  where btrim(coalesce(department,'')) <> '' and department ~* 'administ|adminit';
update public.employees set department = 'OPERACIONES DE MAQUINARIA'
  where btrim(coalesce(department,'')) <> '' and department ~* 'maquin|operac';
update public.employees set department = 'COCINA'
  where btrim(coalesce(department,'')) <> '' and department ~* 'cocin|aliment|comedor';
update public.employees set department = 'ALMACÉN'
  where btrim(coalesce(department,'')) <> '' and department ~* 'almacen|deposito|inventario';
update public.employees set department = 'INSPECCIÓN Y PATIO'
  where btrim(coalesce(department,'')) <> '' and department ~* 'inspec|patio|listero|trafico|controlador';
update public.employees set department = 'MANTENIMIENTO'
  where btrim(coalesce(department,'')) <> '' and department ~* 'manten|mecanic|soldad|electric|lubric';
update public.employees set department = 'SERVICIOS GENERALES'
  where btrim(coalesce(department,'')) <> '' and department ~* 'servicio|general|aseo|limpie|seguridad|vigilan';
update public.employees set department = 'DIRECCIÓN Y COORDINACIÓN'
  where btrim(coalesce(department,'')) <> '' and department ~* 'direcc|coordinac|gerenc';

-- ── 2) INFERENCIA del departamento por CARGO (solo filas SIN departamento) ──
-- Orden: dominio antes que liderazgo, para que "coordinador de cocina" caiga en
-- COCINA (no en dirección). Cada bloque solo toca a los que aún están vacíos.
update public.employees set department = 'COCINA'
  where btrim(coalesce(department,'')) = '' and cargo ~* 'cocin|lavaplato|aliment|comedor|chef';
update public.employees set department = 'ALMACÉN'
  where btrim(coalesce(department,'')) = '' and cargo ~* 'almacen|deposito';
update public.employees set department = 'INSPECCIÓN Y PATIO'
  where btrim(coalesce(department,'')) = '' and cargo ~* 'inspec|patio|listero|trafico|controlador';
update public.employees set department = 'MANTENIMIENTO'
  where btrim(coalesce(department,'')) = '' and cargo ~* 'mecanic|manten|soldad|electric|lubric';
update public.employees set department = 'OPERACIONES DE MAQUINARIA'
  where btrim(coalesce(department,'')) = '' and cargo ~* 'operador|maquinist|maquinaria|excavad|retro|payloader|cisterna|pitman|volqueta|camion|chofer|conductor';
update public.employees set department = 'SERVICIOS GENERALES'
  where btrim(coalesce(department,'')) = '' and cargo ~* 'todero|obrero|caletero|aseo|limpie|motorizad|seguridad|vigilan|servicio';
update public.employees set department = 'ADMINISTRATIVO'
  where btrim(coalesce(department,'')) = '' and cargo ~* 'analista|contab|nomina|rrhh|recursos humanos|oficina|secretari|cajero|cobranza|administ|adminit';
update public.employees set department = 'DIRECCIÓN Y COORDINACIÓN'
  where btrim(coalesce(department,'')) = '' and cargo ~* 'director|gerent|jefe|coordinador|supervisor';

-- ── Verificación: cómo quedó el reparto por departamento ──
-- select coalesce(nullif(btrim(department),''),'SIN DEPARTAMENTO') as departamento,
--        count(*) as cantidad
-- from public.employees
-- where status = 'activo'
-- group by 1 order by 1;
