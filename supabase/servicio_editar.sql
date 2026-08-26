-- ============================================================================
-- SERVICIO DE MAQUINARIA — EDITAR UN SERVICIO YA REGISTRADO, DEJANDO RASTRO
--
-- QUÉ PIDIÓ EL CLIENTE (26-ago-2026, textual)
-- ---------------------------------------------------------------------------
--   «para el modulo de servicios de maquinaria en el submodulo de servicios,
--    necesito la opcion de editar un servicio ya existente y que quede el
--    registro de quien fue el ultimo que lo edito, y que fue lo que cambio»
--
-- Son tres cosas, y cada una tiene su bloque acá:
--   1. Poder EDITAR   → NO hace falta SQL. Las políticas del módulo ya son
--                       `for all` (ver `servicio_rls_fix.sql:53-62`), así que el
--                       UPDATE ya está permitido a quien pueda escribir. Lo que
--                       faltaba era el botón y la función en la app.
--   2. QUIÉN lo editó → `updated_by` + `updated_at` en la orden (BLOQUE 2).
--   3. QUÉ cambió     → una bitácora propia del módulo (BLOQUE 3).
--
-- POR QUÉ UNA BITÁCORA PROPIA Y NO SOLO `audit_log`
-- ---------------------------------------------------------------------------
-- El proyecto ya tiene auditoría general (`public.audit_log` + el trigger
-- `public.audit_row()`), y en el BLOQUE 4 se le engancha también a estas tablas
-- — eso NO se pierde. Pero `audit_log` solo lo puede LEER quien tenga
-- `can_audit` o sea `admin` (`supabase/audit.sql:26-27`), y el encargado del
-- taller —que es justamente quien necesita ver «esto lo cambió Fulano»— casi
-- nunca lo es. Si el detalle viviera solo allá, la pantalla de Servicios se
-- vería vacía para el usuario que la usa todos los días.
--
-- Por eso el detalle vive en `machinery_service_edits`, con las MISMAS reglas de
-- lectura que el resto del módulo, y `audit_log` queda como la copia para el
-- administrador. Dos registros del mismo hecho, cada uno para su público.
--
-- ⚠️ HAY QUE CORRERLO A MANO
-- ---------------------------------------------------------------------------
-- Editar este .sql NO lo aplica. Abrir Supabase → SQL Editor, pegar el archivo
-- completo, ejecutarlo, y DESPUÉS correr el BLOQUE 5 (VERIFICACIÓN) para
-- confirmar que quedó. Es idempotente: se puede volver a correr sin romper nada.
--
-- ⚠️ MIENTRAS NO SE CORRA, ¿QUÉ PASA?
-- ---------------------------------------------------------------------------
-- La app está hecha para aguantarlo: el botón ✏️ Editar guarda igual y el
-- servicio queda bien. Lo que NO va a quedar es el rastro (ni «editado por», ni
-- la lista de cambios), y la pantalla lo dice con todas sus letras en vez de
-- fingir que lo guardó. Ver `editarServicio` en `src/lib/machineService.ts`.
--
-- NO TOCA NADA DE OTROS MÓDULOS. Cero ALTER sobre `machinery`, cero sobre
-- `maintenance_requests`, cero sobre Inspecciones. Solo las dos tablas propias
-- de Servicio y una tabla nueva.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 1 · DIAGNÓSTICO   ✅ SOLO LEE, no cambia nada
-- ════════════════════════════════════════════════════════════════════════════
-- Corre esto ANTES. En una base donde todavía no se aplicó nada, las tres
-- primeras columnas dan `false`.
select
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'machinery_service_orders'
             and column_name = 'updated_at')                            as col_updated_at_existe,
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'machinery_service_orders'
             and column_name = 'updated_by')                            as col_updated_by_existe,
  to_regclass('public.machinery_service_edits') is not null             as existe_bitacora,
  exists (select 1 from pg_trigger
           where tgname = 'trg_audit'
             and tgrelid = 'public.machinery_service_orders'::regclass) as tiene_trigger_auditoria,
  (select count(*) from public.machinery_service_orders)                as servicios_guardados;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 2 · QUIÉN LO EDITÓ DE ÚLTIMO   ⚠️ ESCRIBE (2 columnas nuevas)
-- ════════════════════════════════════════════════════════════════════════════
-- Dos columnas NULAS y SIN default: en Postgres moderno eso es instantáneo y no
-- reescribe la tabla. Los servicios que ya existen quedan con las dos en NULL,
-- que es lo correcto: nadie los ha editado todavía. La pantalla distingue NULL
-- («sin editar») de «editado», no muestra una fecha inventada.
--
-- Mismos nombres que usa el resto de la casa para esto (`camionViajes.ts:258`,
-- `guard_inspector_meta`, `obrasPublicas.ts:661`): `updated_by` + `updated_at`.
-- No se inventa una convención nueva.
alter table public.machinery_service_orders
  add column if not exists updated_at timestamptz;
alter table public.machinery_service_orders
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;

comment on column public.machinery_service_orders.updated_at is
  'Cuándo se editó por última vez. NULL = nunca se ha editado desde que se registró.';
comment on column public.machinery_service_orders.updated_by is
  'Quién lo editó de último. ON DELETE SET NULL: si se borra el perfil, el servicio sobrevive.';

-- Índice PARCIAL: la enorme mayoría de las filas tiene updated_by NULL (nunca
-- editadas) y el índice ni las mira. Sirve para «qué ha editado Fulano».
create index if not exists idx_mso_updated_by
  on public.machinery_service_orders(updated_by)
  where updated_by is not null;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 3 · QUÉ CAMBIÓ — LA BITÁCORA DEL MÓDULO   ⚠️ ESCRIBE (tabla nueva)
-- ════════════════════════════════════════════════════════════════════════════
-- Una fila por EDICIÓN (no por campo). El detalle campo por campo va adentro de
-- `changes`, como un arreglo JSON.
create table if not exists public.machinery_service_edits (
  id uuid primary key default gen_random_uuid(),

  -- El servicio que se editó. ON DELETE CASCADE: si se borra el servicio, su
  -- bitácora se va con él (no tiene sentido sin la orden). El rastro del borrado
  -- en sí queda en `audit_log`, gracias al BLOQUE 4.
  service_order_id uuid not null
    references public.machinery_service_orders(id) on delete cascade,

  edited_by uuid references public.profiles(id) on delete set null,

  -- ⭐ EL NOMBRE SE GUARDA COPIADO, no se resuelve por JOIN cada vez.
  --    Es lo mismo que hace `audit_log.user_name`: si mañana se borra el perfil
  --    del empleado, la bitácora tiene que seguir diciendo QUIÉN fue. Un JOIN
  --    contra `profiles` devolvería NULL y el registro perdería su razón de ser.
  edited_by_name text,

  edited_at timestamptz not null default now(),

  -- ⭐ FORMATO DE `changes` — arreglo de objetos, uno por campo cambiado:
  --      [{"campo":"service_date",
  --        "etiqueta":"Fecha del servicio",
  --        "de":"20/08/2026",
  --        "a":"21/08/2026"}, ...]
  --
  --    LA ETIQUETA SE GUARDA JUNTO AL DATO A PROPÓSITO. Si dentro de un año se
  --    le cambia el nombre visible a un campo, la bitácora vieja tiene que
  --    seguir contando la historia CON LAS PALABRAS DE ENTONCES, no con las de
  --    hoy. Es un registro histórico, no una vista.
  --
  --    `de` y `a` son texto YA FORMATEADO para leer, no el valor crudo: la
  --    pantalla los pinta tal cual, sin tener que saber de tipos ni de fechas.
  changes jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now()
);

comment on table public.machinery_service_edits is
  'Bitácora de ediciones de un servicio de maquinaria: quién, cuándo y qué campos cambió. Solo se agrega.';

-- El listado natural: «las ediciones de ESTE servicio, la más reciente arriba».
create index if not exists idx_mse_orden
  on public.machinery_service_edits(service_order_id, edited_at desc);
create index if not exists idx_mse_autor
  on public.machinery_service_edits(edited_by);


-- ── RLS de la bitácora ──────────────────────────────────────────────────────
-- MISMO criterio que las dos tablas del módulo después de `servicio_rls_fix.sql`:
-- leer, cualquiera autenticado; escribir, quien pueda escribir el módulo.
-- NO se usa `is_staff()` a secas: el encargado del taller suele ser 'analista'
-- con permiso de módulo, y con `is_staff()` el INSERT le sería rechazado — que es
-- exactamente el bug que `servicio_rls_fix.sql` vino a cerrar el 19-ago-2026.
alter table public.machinery_service_edits enable row level security;

drop policy if exists mse_select on public.machinery_service_edits;
create policy mse_select on public.machinery_service_edits
  for select to authenticated using (true);

drop policy if exists mse_insert on public.machinery_service_edits;
create policy mse_insert on public.machinery_service_edits
  for insert to authenticated
  with check ((select public.is_staff()) or (select public.can_write_module('servicio')));

-- ⚠️ A PROPÓSITO NO HAY POLÍTICA DE UPDATE NI DE DELETE.
--    Una bitácora que se puede editar o borrar no sirve de nada: el que hizo el
--    cambio que quiere esconder es justo el que tendría permiso de esconderlo.
--    Solo se agrega. Ni siquiera se otorgan los privilegios de tabla.
grant select, insert on public.machinery_service_edits to authenticated;
revoke update, delete on public.machinery_service_edits from authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 4 · AUDITORÍA GENERAL   ⚠️ ESCRIBE (2 triggers)
-- ════════════════════════════════════════════════════════════════════════════
-- Le engancha a las dos tablas del módulo el MISMO trigger que ya llevan 40+
-- tablas del sistema (`public.audit_row()`, ver `supabase/audit.sql` y
-- `supabase/auditoria_quien_y_cambios.sql`). Con esto el administrador ve las
-- ediciones —y también los BORRADOS, que la bitácora del BLOQUE 3 no puede
-- registrar porque se va en cascada— desde la pantalla de Auditoría de siempre.
--
-- ¿Y el volumen? Sin problema. El que hubo que apagar el 09-ago-2026 fue el de
-- `machine_rounds`, que los crons escriben cada 10 minutos por ~173 máquinas.
-- Acá son unos pocos servicios al día, escritos a mano por una persona. Es el
-- mismo perfil que `machinery` (catálogo), cuyo trigger se reencendió el
-- 18-ago-2026 sin consecuencias.
--
-- ⚠️ VA DE LA MANO CON LA PANTALLA. `scripts/test-auditoria-labels.mjs` FALLA si
--    una tabla con `trg_audit` no está en el mapa `MODULES` de
--    `src/screens/AuditScreen.tsx`. Las dos ya se agregaron ahí en el mismo
--    cambio que trae este archivo — si algún día se quita una, hay que quitarla
--    también allá, o al revés.
do $$
declare t text;
begin
  foreach t in array array['machinery_service_orders', 'machinery_service_parts'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists trg_audit on public.%I;', t);
      execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.audit_row();', t);
    end if;
  end loop;
end $$;

-- Si algún día molesta:  alter table public.machinery_service_orders disable trigger trg_audit;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 5 · VERIFICACIÓN   ✅ SOLO LEE
-- ════════════════════════════════════════════════════════════════════════════
-- Corre esto DESPUÉS. Tiene que dar TODO en verde:
--   columnas_nuevas = 2 · existe_bitacora = true · indices_bitacora = 2
--   politicas_bitacora = 2 · rls_bitacora = true · triggers_auditoria = 2
--   bitacora_es_solo_agregar = true
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'machinery_service_orders'
      and column_name in ('updated_at', 'updated_by'))                    as columnas_nuevas,
  to_regclass('public.machinery_service_edits') is not null               as existe_bitacora,
  (select count(*) from pg_indexes
    where schemaname = 'public'
      and indexname in ('idx_mse_orden', 'idx_mse_autor'))                as indices_bitacora,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'machinery_service_edits') as politicas_bitacora,
  (select relrowsecurity from pg_class
    where oid = 'public.machinery_service_edits'::regclass)               as rls_bitacora,
  (select count(*) from pg_trigger
    where tgname = 'trg_audit'
      and tgrelid in ('public.machinery_service_orders'::regclass,
                      'public.machinery_service_parts'::regclass))        as triggers_auditoria,
  -- ningún privilegio de UPDATE/DELETE sobre la bitácora para el usuario común
  not exists (select 1 from information_schema.role_table_grants
               where table_schema = 'public' and table_name = 'machinery_service_edits'
                 and grantee = 'authenticated'
                 and privilege_type in ('UPDATE', 'DELETE'))              as bitacora_es_solo_agregar;


-- ════════════════════════════════════════════════════════════════════════════
-- CÓMO DESHACERLO (solo si hiciera falta)
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ El `drop table` BORRA LA BITÁCORA. Si ya se editaron servicios, ese
--    historial NO se recupera. Sacar respaldo antes.
--
-- drop trigger if exists trg_audit on public.machinery_service_parts;
-- drop trigger if exists trg_audit on public.machinery_service_orders;
-- drop table if exists public.machinery_service_edits;
-- alter table public.machinery_service_orders drop column if exists updated_by;
-- alter table public.machinery_service_orders drop column if exists updated_at;
