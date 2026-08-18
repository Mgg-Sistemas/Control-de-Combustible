-- ============================================================================
-- ROL LISTERO — que Eduardo Ugueto, Ely Echarry y Arcy Flames entren DIRECTO a
-- "Viajes de camiones" y no vean nada más (18-ago-2026)
--
-- QUÉ HACE: crea (o ajusta) un rol cuyo ÚNICO módulo es `viajes_camiones` con
-- nivel ESCRITURA, y se lo asigna a esos tres. Con eso la app les abre directo
-- la pantalla de registro de viajes, sin pestañas ni menú "Más".
--
-- POR QUÉ "ÚNICO": `src/navigation/index.tsx` → `esRolViajes()` solo manda a la
-- pantalla directa si TODOS los módulos activos del rol son `viajes_camiones`.
-- Si el rol trae otro módulo, el usuario vuelve a la navegación normal.
--
-- ⚠️ OJO CON LOS PERMISOS POR USUARIO. El nivel efectivo es el MAYOR entre el rol
--    y `module_permissions` (permisos extra que un admin le dio a esa persona).
--    Pero `esRolViajes()` mira SOLO los módulos del ROL. Si alguno de los tres
--    tiene permisos extra de otros módulos, va a entrar directo a Viajes y esos
--    módulos le quedan inalcanzables — tiene el permiso pero no el menú para
--    llegar. Por eso el bloque 1 los muestra y el bloque 4 los limpia.
--
-- ⚠️ ESTO CAMBIA QUÉ VE LA GENTE. Correr los bloques EN ORDEN y LEER el 1 antes
--    de tocar nada: si un nombre no coincide o alguien tiene más cosas de las
--    esperadas, PARAR y avisar.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 1 · QUIÉNES SON Y QUÉ TIENEN HOY   (solo lectura, no cambia nada)
-- ════════════════════════════════════════════════════════════════════════════
-- Debe devolver TRES filas. Si sale otra cantidad, o un nombre que no esperabas,
-- NO SIGAS: hay homónimos o el nombre está escrito distinto.
select
  p.id,
  p.full_name,
  p.cedula,
  p.username,
  p.role                                            as rol_base,
  r.name                                            as rol_asignado,
  r.modules                                         as modulos_del_rol,
  (select coalesce(jsonb_object_agg(mp.module, mp.level), '{}'::jsonb)
     from public.module_permissions mp
    where mp.user_id = p.id and mp.level <> 'none')  as permisos_extra_del_usuario
from public.profiles p
left join public.app_roles r on r.id = p.app_role_id
where p.full_name ilike '%ugueto%'
   or p.full_name ilike '%echarry%'
   or p.full_name ilike '%arcy%'
order by p.full_name;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 2 · RESPALDO   ⚠️ ESCRIBE (crea una tabla de respaldo, no toca nada más)
-- ════════════════════════════════════════════════════════════════════════════
-- Guarda cómo estaban ANTES, por si hay que volver atrás. Es una tabla nueva:
-- no modifica ni un permiso.
create table if not exists public.respaldo_listeros_2026_08_18 as
select
  p.id, p.full_name, p.role, p.app_role_id,
  (select coalesce(jsonb_object_agg(mp.module, mp.level), '{}'::jsonb)
     from public.module_permissions mp where mp.user_id = p.id) as permisos_extra,
  now() as respaldado_at
from public.profiles p
where p.full_name ilike '%ugueto%'
   or p.full_name ilike '%echarry%'
   or p.full_name ilike '%arcy%';

select count(*) as personas_respaldadas from public.respaldo_listeros_2026_08_18;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 3 · EL ROL   ⚠️ ESCRIBE (crea o ajusta el rol "Listero")
-- ════════════════════════════════════════════════════════════════════════════
-- Un solo módulo, nivel escritura. ESCRITURA y no lectura: con lectura la
-- pantalla les muestra "Solo lectura. Pídele a un administrador el nivel
-- Escritura para poder registrar viajes" y no pueden registrar nada
-- (ver ViajesCamionesScreen.tsx, rama `if (!canWrite)`).
--
-- NO se pone 'full': eso les dejaría ver la lista de TODOS los listeros y
-- borrar viajes ajenos. Para registrar los suyos no hace falta.
insert into public.app_roles (name, modules)
values ('Listero', '{"viajes_camiones":"escritura"}'::jsonb)
on conflict (name) do update
  set modules = '{"viajes_camiones":"escritura"}'::jsonb;

select id, name, modules from public.app_roles where name = 'Listero';


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 4 · ASIGNARLO A LOS TRES   ⚠️ ESCRIBE (cambia qué ve esta gente)
-- ════════════════════════════════════════════════════════════════════════════
-- Correr SOLO si el bloque 1 devolvió exactamente las tres personas correctas.
--
-- `role = 'conductor'` es el rol BASE NEUTRO que el sistema le pone a cualquiera
-- con rol personalizado (ver el comentario "rol base neutro (conductor)" en
-- UsersScreen.tsx). No los convierte en choferes: con `app_role_id` puesto, la
-- app entra por el rol personalizado, no por el base.
update public.profiles p
   set app_role_id = (select id from public.app_roles where name = 'Listero'),
       role        = 'conductor'
 where (p.full_name ilike '%ugueto%'
     or p.full_name ilike '%echarry%'
     or p.full_name ilike '%arcy%')
   and p.role <> 'admin';   -- red de seguridad: nunca degradar a un administrador

-- Limpia los permisos EXTRA por usuario de otros módulos. Sin esto tendrían
-- acceso a cosas que no pueden alcanzar (entran directo a Viajes y ahí se
-- quedan), y además `esRolViajes()` seguiría mandándolos directo igual — o sea,
-- permisos fantasma que nadie puede usar.
delete from public.module_permissions mp
 using public.profiles p
 where mp.user_id = p.id
   and mp.module <> 'viajes_camiones'
   and (p.full_name ilike '%ugueto%'
     or p.full_name ilike '%echarry%'
     or p.full_name ilike '%arcy%')
   and p.role <> 'admin';


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 5 · COMPROBAR   (solo lectura)
-- ════════════════════════════════════════════════════════════════════════════
-- Lo que se espera en las TRES filas:
--   · rol_asignado          = 'Listero'
--   · modulos_del_rol       = {"viajes_camiones": "escritura"}
--   · permisos_extra        = {} (vacío)
--   · entra_directo         = true   ← lo que de verdad importa
select
  p.full_name,
  r.name                                            as rol_asignado,
  r.modules                                         as modulos_del_rol,
  (select coalesce(jsonb_object_agg(mp.module, mp.level), '{}'::jsonb)
     from public.module_permissions mp
    where mp.user_id = p.id and mp.level <> 'none')  as permisos_extra,
  -- Réplica exacta de `esRolViajes()`: todos los módulos activos del rol son
  -- `viajes_camiones`, y hay al menos uno.
  (r.modules is not null
   and exists (select 1 from jsonb_each_text(r.modules) x(k, v) where v <> 'none')
   and not exists (select 1 from jsonb_each_text(r.modules) x(k, v)
                    where v <> 'none' and k <> 'viajes_camiones'))  as entra_directo
from public.profiles p
left join public.app_roles r on r.id = p.app_role_id
where p.full_name ilike '%ugueto%'
   or p.full_name ilike '%echarry%'
   or p.full_name ilike '%arcy%'
order by p.full_name;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 6 · DESHACER   (solo si hace falta)
-- ════════════════════════════════════════════════════════════════════════════
-- Devuelve a los tres su rol y su rol base anteriores. Los permisos extra
-- borrados NO se restauran automáticamente: están en la columna
-- `permisos_extra` del respaldo, para volver a ponerlos a mano si hacía falta.
--
-- update public.profiles p
--    set app_role_id = b.app_role_id, role = b.role
--   from public.respaldo_listeros_2026_08_18 b
--  where b.id = p.id;
--
-- select id, full_name, permisos_extra from public.respaldo_listeros_2026_08_18;
