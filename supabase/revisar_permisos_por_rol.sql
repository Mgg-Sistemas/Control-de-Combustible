-- ============================================================================
-- REVISAR PERMISOS — CON EL ROL DE VERDAD (el personalizado, no el base).
--
-- 👉 CÓMO SE CORRE: copiar ESTE ARCHIVO COMPLETO, pegarlo en Supabase → SQL
--    Editor y darle RUN. Devuelve TRES tablas.
--
-- ✅ ES DE PURA LECTURA. No hace insert, update, delete ni alter. No cambia una
--    sola fila ni un solo permiso. Se puede correr cuando sea.
--
-- POR QUÉ EXISTE
-- ---------------------------------------------------------------------------
-- 1) La lista que imprimía `permiso_catalogo_corregido.sql` mostraba solo
--    `profiles.role` (el rol BASE). A quien tiene un ROL PERSONALIZADO lo
--    etiquetaba con su rol base y confundía: tres supervisores externos de Obras
--    Públicas salían como "conductor". Acá se muestra el rol REAL — el
--    personalizado si lo tiene, y si no el base, igual que la pantalla de
--    Usuarios.
--
-- 2) Desde el 21-ago-2026 el PERMISO de la persona LE GANA AL ROL, también para
--    BAJAR. Antes se tomaba el mayor de los dos. Eso significa que si alguien
--    tiene una fila de permiso MÁS BAJA que lo que le da su rol personalizado,
--    ahora PIERDE ese acceso. El bloque 3 lista exactamente a quién le pasa eso,
--    en TODOS los módulos, para revisarlo antes de que alguien se queje.
-- ============================================================================


-- ── 1) QUIÉN PUEDE REGISTRAR MÁQUINAS (con el rol de verdad) ────────────────
select
  coalesce(p.full_name, '(sin nombre)')                   as persona,
  coalesce(ar.name, p.role::text)                         as rol_real,
  case when ar.id is not null then 'personalizado' else 'rol base' end as tipo_de_rol,
  coalesce(mp.level, '— sin fila —')                      as permiso_catalogo,
  case when p.role = 'admin' then 'admin: siempre puede' else 'por su permiso' end as motivo
from public.profiles p
left join public.app_roles ar on ar.id = p.app_role_id
left join public.module_permissions mp on mp.user_id = p.id and mp.module = 'equipos'
where p.role = 'admin' or mp.level in ('escritura', 'full')
order by (p.role = 'admin') desc, coalesce(ar.name, p.role::text), p.full_name;


-- ── 2) CUÁNTA GENTE HAY POR ROL REAL, Y CÓMO ESTÁ EN EL CATÁLOGO ────────────
-- Para ver de un vistazo si algún rol entero quedó con permiso de escritura.
select
  coalesce(ar.name, p.role::text)                          as rol_real,
  count(*)                                                 as personas,
  count(*) filter (where mp.level in ('escritura','full'))  as pueden_escribir,
  count(*) filter (where mp.level in ('lectura','none'))    as solo_lectura,
  count(*) filter (where mp.level is null)                  as sin_fila
from public.profiles p
left join public.app_roles ar on ar.id = p.app_role_id
left join public.module_permissions mp on mp.user_id = p.id and mp.module = 'equipos'
group by coalesce(ar.name, p.role::text)
order by count(*) desc;


-- ── 3) ⚠️ A QUIÉN LE BAJÓ EL ACCESO LA REGLA NUEVA ─────────────────────────
-- Personas con ROL PERSONALIZADO cuya fila de permiso es MÁS BAJA que lo que su
-- rol les daba. ANTES del 21-ago-2026 mandaba el mayor (o sea, el del rol) y
-- ahora manda la fila: estas son las que perdieron acceso.
--
-- Si alguna no debía perderlo, se arregla en Usuarios → ✏️ Edición masiva
-- subiéndole el permiso, o borrando su fila para que vuelva a mandar el rol.
-- Los ADMIN no salen acá: siempre tienen full control.
--
-- Si esta tabla sale VACÍA, el cambio no le quitó el acceso a nadie.
with niveles(nivel, peso) as (
  values ('none', 0), ('lectura', 1), ('escritura', 2), ('full', 3)
)
select
  coalesce(p.full_name, '(sin nombre)')  as persona,
  ar.name                                as rol_personalizado,
  mod.key                                as modulo,
  mod.value                              as le_daba_el_rol,
  mp.level                               as tiene_de_permiso,
  '⚠️ perdió acceso'                     as ojo
from public.profiles p
join public.app_roles ar on ar.id = p.app_role_id
join lateral jsonb_each_text(coalesce(ar.modules, '{}'::jsonb)) as mod(key, value) on true
join public.module_permissions mp on mp.user_id = p.id and mp.module = mod.key
join niveles nr on nr.nivel = mod.value
join niveles np on np.nivel = mp.level
where p.role <> 'admin'
  and np.peso < nr.peso          -- el permiso da MENOS que el rol → ahora pierde
order by p.full_name, mod.key;
