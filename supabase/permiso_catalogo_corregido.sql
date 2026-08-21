-- ============================================================================
-- CORRECCIÓN URGENTE + CIERRE DEL HUECO — permisos del Catálogo.
--
-- 👉 CÓMO SE CORRE: copiar ESTE ARCHIVO COMPLETO, pegarlo en Supabase → SQL
--    Editor y darle RUN. Termina mostrando una tabla de verificación.
--
-- ⚠️ CORRE ESTE ARCHIVO CUANTO ANTES. El anterior (`permiso_le_gana_al_rol.sql`)
--    dejó gente bloqueada de más — abajo se explica exactamente a quién.
--
-- ✅ Idempotente. 🛟 Respalda antes de tocar. NO borra ni modifica datos de
--    maquinaria: solo reglas de acceso y filas de permisos.
--
--
-- ❌ QUÉ SE HIZO MAL EN EL ARCHIVO ANTERIOR
-- ---------------------------------------------------------------------------
-- Se cerró la tabla `machinery` COMPLETA contra el permiso del módulo 'equipos'.
-- Pero esa tabla NO la escribe solo el Catálogo. También le escriben:
--
--   · Control de Maquinaria  → operativa / retirada / esperando, precio por hora
--   · Mantenimiento          → horómetro base, horómetro pendiente
--   · Jornadas (QR y app)    → entry_at / exit_at / last_horometro
--   · Fotos y Ubicación      → foto de la máquina, latitud / longitud
--   · Coordinador QR         → marcar la máquina lista
--
-- O sea que a las 43 personas que quedaron en "Lectura" de Catálogo se les
-- bloqueó TAMBIÉN todo eso, aunque su permiso en esos otros módulos estuviera
-- bien. Un inspector en "Lectura" de Catálogo no podía cerrar una jornada desde
-- la app, y Control de Maquinaria no podía cambiar estados.
--
--
-- ✅ CÓMO QUEDA AHORA (lo que de verdad se pidió)
-- ---------------------------------------------------------------------------
-- El permiso de 'equipos' manda sobre EL CATÁLOGO, no sobre toda la tabla:
--
--   · CREAR una máquina (insert)   → solo con escritura en 'equipos'.
--   · BORRAR una máquina (delete)  → solo con escritura en 'equipos'.
--   · CAMBIAR DATOS DE FICHA       → solo con escritura en 'equipos'. Son las
--     columnas de identidad y administración: código, marca, modelo, serial,
--     placa, empresa, clasificación, encargado, precio, fotos, QR bloqueado…
--     Lo bloquea un trigger, porque RLS es por FILA y esto es por COLUMNA.
--   · OPERAR la máquina            → sigue como siempre (el rol y el permiso del
--     módulo que corresponda): jornadas, estado, horómetro, ubicación.
--
-- Así "no te deja registrar máquinas" se cumple de verdad, y nadie pierde el
-- trabajo del día por un permiso de otro módulo.
--
--
-- 🕳️ Y SE TAPA EL HUECO
-- ---------------------------------------------------------------------------
-- La regla es: CON fila de permiso manda la fila; SIN fila manda el rol. Por eso
-- quien no tenía fila y era inspector u operador todavía podía registrar
-- máquinas. Acá se le crea fila de "lectura" a TODO EL QUE NO TENGA, menos:
--   · los ADMIN (siempre pueden, y así queda alguien que pueda arreglar todo);
--   · DORIANNE, que queda en 'escritura'.
-- A quien ya tenía fila NO se le toca: lo que decidiste se respeta.
-- ============================================================================


-- ── 1) RESPALDO ─────────────────────────────────────────────────────────────
create table if not exists public.permisos_backup_20260821 as
  select *, now() as guardado_en from public.module_permissions where false;

insert into public.permisos_backup_20260821
  select mp.*, now() from public.module_permissions mp where mp.module = 'equipos';


-- ── 2) LAS COLUMNAS QUE SON "CATÁLOGO" ──────────────────────────────────────
-- Identidad y administración de la máquina. Todo lo que NO está acá es
-- operación (estado, jornada, horómetro, ubicación) y no lo gobierna 'equipos'.
-- Se comparan por JSON y no columna por columna a propósito: si mañana se
-- renombra o se quita una de estas columnas, `new.loquesea` reventaría el
-- trigger y con él TODAS las actualizaciones de maquinaria (jornadas incluidas).
-- Con `to_jsonb` una columna que no existe simplemente no se compara.
create or replace function public.machinery_guard_catalogo()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  -- COLUMNAS DE CATÁLOGO: identidad y administración de la máquina.
  -- Todo lo que NO esté acá es OPERACIÓN (estado, jornada, horómetro, ubicación,
  -- referencia, operador, meta de viajes) y lo gobierna su propio módulo.
  cols constant text[] := array[
    'code','description','machinery_type','marca','modelo','tipo','clasificacion',
    'serial','plate','identifier','company_id','active','price_per_hour',
    'initial_cost','useful_value','expected_lph','daily_consumption_l',
    'grupo','encargado','zona','con_tapa','tapa_doble',
    'oil_type','oil_capacity_l','oil_notes',
    'photo_url','photo_serial_url','qr_blocked'
  ];
  jn jsonb := to_jsonb(new);
  jo jsonb := to_jsonb(old);
  c  text;
begin
  -- El operador anónimo del QR ya tiene su propio guardián (machinery_guard_anon).
  if public.is_anon() then return new; end if;
  -- Quien puede escribir en el Catálogo, puede cambiar lo que sea.
  if public.permiso_manda_sobre_rol('equipos') then return new; end if;

  foreach c in array cols loop
    if (jn ->> c) is distinct from (jo ->> c) then
      raise exception 'Sin permiso de escritura en el Catálogo: no puedes cambiar "%" de esta máquina.', c
        using hint = 'Pídele a un administrador el permiso de escritura en el módulo Catálogo (equipos).';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_machinery_guard_catalogo on public.machinery;
create trigger trg_machinery_guard_catalogo
  before update on public.machinery
  for each row execute function public.machinery_guard_catalogo();


-- ── 3) LAS POLÍTICAS, PARTIDAS POR OPERACIÓN ────────────────────────────────
-- La de antes era una sola `for all` y por eso arrastró todo.
drop policy if exists machinery_write on public.machinery;

-- CREAR y BORRAR una máquina es un acto de CATÁLOGO: permiso de 'equipos'.
drop policy if exists machinery_insert on public.machinery;
create policy machinery_insert on public.machinery for insert to authenticated
  with check (public.permiso_manda_sobre_rol('equipos'));

drop policy if exists machinery_delete on public.machinery;
create policy machinery_delete on public.machinery for delete to authenticated
  using (public.permiso_manda_sobre_rol('equipos'));

-- OPERAR (jornadas, estado, horómetro, ubicación, fotos): como siempre. Las
-- columnas de ficha las cuida el trigger de arriba, no esta política.
drop policy if exists machinery_update on public.machinery;
create policy machinery_update on public.machinery for update to authenticated
  using (public.is_staff() or public.permiso_manda_sobre_rol('equipos'))
  with check (public.is_staff() or public.permiso_manda_sobre_rol('equipos'));

-- VEHÍCULOS: no hay otro módulo que les escriba, así que se quedan estrictos.
drop policy if exists vehicles_write on public.vehicles;
create policy vehicles_write on public.vehicles for all to authenticated
  using (public.permiso_manda_sobre_rol('equipos'))
  with check (public.permiso_manda_sobre_rol('equipos'));


-- ── 4) TAPAR EL HUECO: fila de permiso para TODO EL QUE NO TENGA ────────────
-- Sin fila mandaba el rol; con fila manda la fila. Se le crea "lectura" a quien
-- no tenga, MENOS a los admin y a Dorianne. A quien ya tiene fila no se le toca.
do $$
declare n_doris int;
begin
  select count(*) into n_doris from public.profiles where full_name ilike '%dorianne%';
  if n_doris <> 1 then
    raise exception 'Se esperaba UNA persona que coincida con "DORIANNE" y se encontraron %. Revisa el nombre en Usuarios y vuelve a correr.', n_doris;
  end if;
end $$;

insert into public.module_permissions (user_id, module, level)
select p.id, 'equipos', 'lectura'
  from public.profiles p
 where p.role <> 'admin'
   and p.full_name not ilike '%dorianne%'
   and not exists (
     select 1 from public.module_permissions mp
      where mp.user_id = p.id and mp.module = 'equipos'
   )
on conflict (user_id, module) do nothing;

-- Y Dorianne con escritura, exista o no su fila.
insert into public.module_permissions (user_id, module, level)
select p.id, 'equipos', 'escritura' from public.profiles p where p.full_name ilike '%dorianne%'
on conflict (user_id, module) do update set level = 'escritura';


-- ── 5) VERIFICACIÓN ─────────────────────────────────────────────────────────
-- Los 6 primeros renglones tienen que decir ✅.
select chequeo, valor, case when ok then '✅' else '❌ REVISAR' end as estado
from (
  select 1 as n, '⭐ Crear máquinas exige permiso de Catálogo' as chequeo,
         coalesce((select with_check from pg_policies where schemaname='public'
                    and tablename='machinery' and policyname='machinery_insert'), '—') as valor,
         coalesce((select with_check from pg_policies where schemaname='public'
                    and tablename='machinery' and policyname='machinery_insert'), '') like '%permiso_manda_sobre_rol%' as ok
  union all
  select 2, '⭐ Operar la máquina VOLVIÓ a funcionar (jornadas, estado, horómetro)',
         coalesce((select qual from pg_policies where schemaname='public'
                    and tablename='machinery' and policyname='machinery_update'), '—'),
         coalesce((select qual from pg_policies where schemaname='public'
                    and tablename='machinery' and policyname='machinery_update'), '') like '%is_staff%'
  union all
  select 3, 'La ficha (código, serial, empresa, precio…) la cuida el trigger',
         coalesce((select 'sí' from pg_trigger where tgname='trg_machinery_guard_catalogo' limit 1), 'NO'),
         exists (select 1 from pg_trigger where tgname='trg_machinery_guard_catalogo')
  union all
  select 4, 'El QR anónimo sigue intacto (jornadas del inspector)',
         coalesce((select 'sí' from pg_policies where schemaname='public'
                    and tablename='machinery' and policyname='machinery_anon_update' limit 1), 'NO'),
         exists (select 1 from pg_policies where schemaname='public'
                  and tablename='machinery' and policyname='machinery_anon_update')
  union all
  select 5, '🕳️ Hueco tapado: personas SIN fila de permiso (debe ser 0)',
         (select count(*) from public.profiles p
           where p.role <> 'admin'
             and not exists (select 1 from public.module_permissions mp
                              where mp.user_id = p.id and mp.module = 'equipos'))::text,
         (select count(*) from public.profiles p
           where p.role <> 'admin'
             and not exists (select 1 from public.module_permissions mp
                              where mp.user_id = p.id and mp.module = 'equipos')) = 0
  union all
  select 6, 'Dorianne quedó con escritura',
         coalesce((select mp.level from public.module_permissions mp
                    join public.profiles p on p.id = mp.user_id
                   where p.full_name ilike '%dorianne%' and mp.module = 'equipos' limit 1), 'SIN FILA'),
         coalesce((select mp.level from public.module_permissions mp
                    join public.profiles p on p.id = mp.user_id
                   where p.full_name ilike '%dorianne%' and mp.module = 'equipos' limit 1), '') = 'escritura'
  union all
  select 7, 'Quiénes pueden registrar máquinas: admin + los de escritura/full',
         ((select count(*) from public.profiles where role = 'admin')
          + (select count(*) from public.module_permissions mp
              join public.profiles p on p.id = mp.user_id
             where mp.module = 'equipos' and mp.level in ('escritura','full') and p.role <> 'admin'))::text,
         true
  union all
  select 8, 'Máquinas en la base (este script NO las toca)',
         (select count(*) from public.machinery)::text, true
) t order by n;


-- ¿QUIÉNES pueden registrar máquinas? Revisa que sea la lista que quieres.
-- Se muestra el rol REAL: el PERSONALIZADO si lo tiene, y si no el base — igual
-- que la pantalla de Usuarios. Mirar solo `profiles.role` engañaba: a los
-- supervisores externos de Obras Públicas los etiquetaba "conductor", que es su
-- rol base, y parecían gente sin relación con las máquinas.
select coalesce(p.full_name, '(sin nombre)')                   as persona,
       coalesce(ar.name, p.role::text)                         as rol_real,
       case when ar.id is not null then 'personalizado' else 'rol base' end as tipo_de_rol,
       coalesce(mp.level, '— sin fila —')                      as permiso_catalogo,
       case when p.role = 'admin' then 'admin: siempre puede' else 'por su permiso' end as motivo
  from public.profiles p
  left join public.app_roles ar on ar.id = p.app_role_id
  left join public.module_permissions mp on mp.user_id = p.id and mp.module = 'equipos'
 where p.role = 'admin' or mp.level in ('escritura', 'full')
 order by (p.role = 'admin') desc, coalesce(ar.name, p.role::text), p.full_name;


-- ============================================================================
-- DESHACER (solo si hay que revertir). Descomentar y correr aparte.
-- ============================================================================
-- drop trigger if exists trg_machinery_guard_catalogo on public.machinery;
-- drop policy if exists machinery_insert on public.machinery;
-- drop policy if exists machinery_update on public.machinery;
-- drop policy if exists machinery_delete on public.machinery;
-- create policy machinery_write on public.machinery for all to authenticated
--   using (public.is_staff()) with check (public.is_staff());
-- -- Los permisos que había antes quedaron en:
-- -- select * from public.permisos_backup_20260821;
