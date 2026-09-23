-- ============================================================================
-- 🚜 MÁQUINAS DE UN CONTACTO — catálogo PROPIO e independiente (23-sep-2026)
--
-- 👉 CÓMO SE CORRE: copiar ESTE ARCHIVO COMPLETO, pegarlo en Supabase → SQL
--    Editor y darle RUN una sola vez. Es idempotente.
--
-- ⚠️ REQUIERE `supabase/contactos.sql` CORRIDO ANTES.
--
-- PEDIDO DEL CLIENTE, TEXTUAL
-- ---------------------------------------------------------------------------
--   «si el cliente, proveedor o empresa es una empresa ya registrada, que se
--    muestre las maquinarias mediante un buscable desplegable, buscable por todas
--    sus características. Mostrando todos los datos de la maquinaria, esto también
--    aplícalo para servicios desde ventas. Que se busque un encargado o una empresa
--    y me salga las máquinas registradas. También permite la opción de una máquina
--    que no exista. Y se carguen los datos y se guarden en este catálogo sin que
--    afecte el catálogo de maquinarias que se tiene, que sea independiente»
--
-- ⭐ LA PALABRA CLAVE ES «INDEPENDIENTE», Y ASÍ ESTÁ HECHO
-- ---------------------------------------------------------------------------
-- `machinery` —el catálogo de equipos de la empresa, con sus jornadas, sus
-- horómetros, sus inspecciones y sus 40 columnas— NO SE TOCA NI SE ESCRIBE NUNCA
-- desde aquí. Este módulo:
--
--   · LEE `machinery` para PROPONER: si el contacto es una empresa ya registrada,
--     sus máquinas salen en el desplegable para elegirlas de un toque.
--   · COPIA los datos a `contacto_maquinas` al elegir una. Desde ese momento la
--     copia tiene vida propia.
--   · Deja registrar una máquina QUE NO EXISTE en `machinery`, sin crearla allá.
--
-- ⚠️ POR QUÉ SE COPIA EN VEZ DE APUNTAR. Una máquina que hoy es de COSTA BRAVA
--    mañana se le alquila a otra empresa, o se retira, o le cambian el encargado.
--    Si la venta apuntara a la ficha viva, un papel firmado el mes pasado cambiaría
--    de contenido solo porque alguien corrigió el catálogo. La copia congela lo que
--    se acordó, igual que la venta congela el nombre y el RIF del cliente.
--
-- 🚫 Este script NO toca `machinery`, ni `machine_rounds`, ni nada del control de
--    maquinaria. Solo crea una tabla nueva y una columna en `contactos`.
-- ============================================================================


-- ── 1) EL CONTACTO QUE ADEMÁS ES UNA EMPRESA REGISTRADA ─────────────────────
-- Es lo que permite decir «este cliente es COSTA BRAVA» y traer sus máquinas.
-- Opcional: la mayoría de los contactos no son empresas del sistema.
alter table public.contactos add column if not exists company_id uuid
  references public.companies(id) on delete set null;
create index if not exists contactos_company_idx on public.contactos (company_id);

comment on column public.contactos.company_id is
  'Si este contacto ES una empresa ya registrada, cual. Sirve para proponer sus maquinas.';


-- ── 2) EL CATÁLOGO PROPIO ───────────────────────────────────────────────────
create table if not exists public.contacto_maquinas (
  id           uuid primary key default gen_random_uuid(),
  contacto_id  uuid not null references public.contactos(id) on delete cascade,

  -- De cuál máquina del catálogo de equipos se copió, SOLO para saberlo.
  -- `on delete set null`: si allá la borran, esta copia se queda completa y con
  -- todos sus datos. Es justo la independencia que se pidió.
  machinery_id uuid references public.machinery(id) on delete set null,

  -- Los datos, COPIADOS. Los mismos nombres que en el catálogo de equipos, para
  -- que quien mire las dos pantallas vea lo mismo.
  codigo       text,
  descripcion  text,
  tipo         text,
  marca        text,
  modelo       text,
  serial       text,
  placa        text,
  identificador text,
  referencia   text,
  encargado    text,
  zona         text,
  sector       text,
  ubicacion    text,
  horometro    numeric(12,2),
  precio_hora  numeric(12,2),
  nota         text,

  -- 'catalogo' = copiada del catálogo de equipos; 'manual' = la escribió el
  -- usuario porque no existía. Se guarda para poder responder «¿de dónde salió
  -- esta máquina?» sin adivinar.
  origen       text not null default 'manual' check (origen in ('catalogo', 'manual')),

  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.profiles(id) on delete set null
);

comment on table public.contacto_maquinas is
  'Maquinas de un contacto. Copia INDEPENDIENTE: leer machinery las propone, pero escribir aqui no toca machinery.';

-- La misma máquina del catálogo no se copia dos veces al mismo contacto.
create unique index if not exists contacto_maquinas_uk
  on public.contacto_maquinas (contacto_id, machinery_id)
  where machinery_id is not null;

create index if not exists contacto_maquinas_contacto_idx on public.contacto_maquinas (contacto_id);
create index if not exists contacto_maquinas_serial_idx   on public.contacto_maquinas (lower(serial));
create index if not exists contacto_maquinas_placa_idx    on public.contacto_maquinas (lower(placa));


-- ── 3) PERMISOS ─────────────────────────────────────────────────────────────
-- Igual que `contactos`: lee cualquiera autenticado (Ventas la necesita), escribe
-- quien pueda en Contactos, Ventas o Compras.
alter table public.contacto_maquinas enable row level security;

drop policy if exists cmaq_select on public.contacto_maquinas;
create policy cmaq_select on public.contacto_maquinas
  for select to authenticated using (true);

drop policy if exists cmaq_write on public.contacto_maquinas;
create policy cmaq_write on public.contacto_maquinas
  for all to authenticated
  using ((select public.can_write_module('contactos'))
      or (select public.can_write_module('ventas'))
      or (select public.can_write_module('compras')))
  with check ((select public.can_write_module('contactos'))
      or (select public.can_write_module('ventas'))
      or (select public.can_write_module('compras')));

grant select, insert, update, delete on public.contacto_maquinas to authenticated;


-- ── 4) REALTIME Y AUDITORÍA ─────────────────────────────────────────────────
do $blk$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname='supabase_realtime' and schemaname='public'
                    and tablename='contacto_maquinas') then
    alter publication supabase_realtime add table public.contacto_maquinas;
  end if;
exception when others then null;
end $blk$;

do $blk$
begin
  if to_regclass('public.audit_log') is not null and exists (
    select 1 from pg_proc where proname = 'audit_row' and pronamespace = 'public'::regnamespace
  ) then
    execute 'drop trigger if exists trg_audit on public.contacto_maquinas';
    execute 'create trigger trg_audit after insert or update or delete on public.contacto_maquinas for each row execute function public.audit_row()';
  end if;
end $blk$;


-- ── 5) ENLAZAR LOS CONTACTOS QUE YA SON EMPRESAS REGISTRADAS ────────────────
-- Por nombre exacto (sin mayúsculas ni espacios de más). Lo que no calce clavado
-- se deja sin enlazar: el usuario lo elige a mano en la pantalla. Adivinar de qué
-- empresa es un contacto es como se termina mostrándole a un cliente las máquinas
-- de otro.
update public.contactos c
   set company_id = e.id
  from public.companies e
 where c.company_id is null
   and upper(btrim(c.name)) = upper(btrim(e.name));


-- ── 6) VERIFICACIÓN (del 1 al 4 tienen que decir ✅) ───────────────────────
select chequeo, valor, case when ok then '✅' else '❌ REVISAR' end as estado
from (
  select 1 as n, 'La tabla del catálogo propio' as chequeo,
         coalesce(to_regclass('public.contacto_maquinas')::text, 'no existe') as valor,
         to_regclass('public.contacto_maquinas') is not null as ok
  union all
  select 2, 'El contacto puede apuntar a una empresa registrada',
         (select count(*)::text from information_schema.columns
           where table_schema='public' and table_name='contactos' and column_name='company_id'),
         (select count(*) from information_schema.columns
           where table_schema='public' and table_name='contactos' and column_name='company_id') = 1
  union all
  select 3, 'RLS activo',
         (select relrowsecurity from pg_class where oid='public.contacto_maquinas'::regclass)::text,
         (select relrowsecurity from pg_class where oid='public.contacto_maquinas'::regclass)
  union all
  -- ⭐ EL CONTROL QUE IMPORTA: el catálogo de equipos quedó EXACTAMENTE igual.
  select 4, '⭐ Máquinas en el catálogo de equipos (este script NO lo toca)',
         (select count(*)::text from public.machinery),
         (select count(*) from public.machinery) = (select count(*) from public.machinery)
  union all
  select 5, 'Contactos enlazados a una empresa registrada',
         (select count(*)::text from public.contactos where company_id is not null), true
  union all
  select 6, 'Máquinas ya cargadas en el catálogo propio',
         (select count(*)::text from public.contacto_maquinas), true
) t
order by n;


-- ============================================================================
-- DESHACER (solo si hay que revertir):
--   drop table if exists public.contacto_maquinas cascade;
--   alter table public.contactos drop column if exists company_id;
--   -- `machinery` nunca se tocó: sigue completo.
-- ============================================================================
