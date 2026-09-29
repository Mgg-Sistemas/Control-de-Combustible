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

-- ── 0) LIMPIEZA DEL TEXTO: espacios de sobra y muletillas ────────────────────
-- "DPTO. DE COCINA" → "COCINA". Se hace ANTES de unificar porque las reglas de
-- abajo van ancladas al principio del nombre y la muletilla las despistaría.
-- La muletilla exige un separador detrás, para que "DEPOSITO" no pase por "depto".
update public.employees
   set department = regexp_replace(
         regexp_replace(btrim(department), '\s+', ' ', 'g'),
         '^(departamento|depto|dpto|dep|area|unidad|seccion)\.?\s+(de\s+la\s+|del\s+|de\s+)?', '', 'i')
 where btrim(coalesce(department,'')) <> ''
   and (department <> btrim(department) or department ~ '\s\s'
        or department ~* '^(departamento|depto|dpto|dep|area|unidad|seccion)\.?\s');

-- ── 1) UNIFICACIÓN por nombre de departamento (solo filas CON departamento) ──
-- ⭐ LOS PATRONES VAN ANCLADOS CON `^` A PROPÓSITO (29-sep-2026). Buscando la
--    palabra en cualquier parte del nombre, este bloque se llevaba por delante
--    departamentos que existen de verdad: "SOPORTE Y SERVICIO" (19 fichas)
--    terminaba escrito "SERVICIOS GENERALES" por contener "servicio", y
--    "MANTENIMIENTO PREVENTIVO DE MAQUINARIA" terminaba en OPERACIONES DE
--    MAQUINARIA. Esto ESCRIBE en la ficha: una corrida borraba el nombre
--    original y después no hay cómo saber quién era de cuál.
--    Lo que va DESPUÉS del nombre solo lo precisa ("ALMACEN GENERAL" sigue
--    siendo ALMACÉN); una palabra DELANTE lo hace otro departamento.
-- ⚠️ Mismas reglas que `DEPT_RULES` en src/lib/personal.ts: si se toca una, se
--    toca la otra, o la pantalla y la ficha dejan de decir lo mismo.
update public.employees set department = 'ADMINISTRATIVO'
  where btrim(coalesce(department,'')) <> '' and department ~* '^administ|^adminit';
update public.employees set department = 'OPERACIONES DE MAQUINARIA'
  where btrim(coalesce(department,'')) <> '' and department ~* '^operac|^maquina';
update public.employees set department = 'COCINA'
  where btrim(coalesce(department,'')) <> '' and department ~* '^cocin|^aliment|^comedor';
update public.employees set department = 'ALMACÉN'
  where btrim(coalesce(department,'')) <> '' and department ~* '^almacen|^deposito|^inventario';
update public.employees set department = 'INSPECCIÓN Y PATIO'
  where btrim(coalesce(department,'')) <> '' and department ~* '^inspec|^patio|^listero|^trafico|^controlador';
-- Sin `soldad|electric|lubric`: son oficios, y de departamento valen por sí
-- mismos (ELECTRICIDAD es un departamento del tabulador, no "mantenimiento").
update public.employees set department = 'MANTENIMIENTO'
  where btrim(coalesce(department,'')) <> '' and department ~* '^manten|^mecanic|^taller';
update public.employees set department = 'SERVICIOS GENERALES'
  where btrim(coalesce(department,'')) <> ''
    and department ~* '^servicios? +general|^servicios?$|^aseo|^limpie|^seguridad|^vigilan';
update public.employees set department = 'SISTEMAS'
  where btrim(coalesce(department,'')) <> '' and department ~* '^sistema|^informatic|^tecnolog';
update public.employees set department = 'DIRECCIÓN Y COORDINACIÓN'
  where btrim(coalesce(department,'')) <> '' and department ~* '^direcc|^directiv|^coordinac|^gerenc';

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
update public.employees set department = 'SISTEMAS'
  where btrim(coalesce(department,'')) = '' and cargo ~* 'sistema|informatic|programad|soporte tecnic|desarrollad';
update public.employees set department = 'SERVICIOS GENERALES'
  where btrim(coalesce(department,'')) = '' and cargo ~* 'todero|obrero|caletero|plomer|gasfiter|aseo|limpie|motorizad|seguridad|vigilan|servicio';
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
