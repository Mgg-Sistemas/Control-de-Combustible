-- Da acceso al módulo "Asistencia de camiones" al usuario ARTURO YAGUE.
-- (El admin también puede hacerlo desde Usuarios → matriz de permisos.)
-- Requiere haber corrido antes supabase/truck_attendance.sql.

insert into public.module_permissions (user_id, module, level)
select id, 'asistencia_camiones', 'full'
from public.profiles
where upper(btrim(full_name)) = 'ARTURO YAGUE'
on conflict (user_id, module) do update set level = excluded.level;

-- Verificar:
select p.full_name, mp.module, mp.level
from public.module_permissions mp
join public.profiles p on p.id = mp.user_id
where mp.module = 'asistencia_camiones';
