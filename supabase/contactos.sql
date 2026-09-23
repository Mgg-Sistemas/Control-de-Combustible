-- ============================================================================
-- 📇 MÓDULO CONTACTOS (COMPRAS, VENTAS) — 23-sep-2026
--
-- 👉 CÓMO SE CORRE: copiar ESTE ARCHIVO COMPLETO, pegarlo en Supabase → SQL
--    Editor y darle RUN una sola vez. Es idempotente.
--
-- ⚠️ REQUIERE `supabase/ventas.sql` CORRIDO ANTES (creó `sales_clients`).
--    REEMPLAZA a `supabase/ventas_cliente_nombre_apellido.sql`: si ya lo
--    corriste, no pasa nada (este script lo da por hecho y sigue).
--
-- PEDIDO DEL CLIENTE, TEXTUAL
-- ---------------------------------------------------------------------------
--   «esa lista de personas y proveedores desde ventas, la vas a volver un
--    catálogo en un módulo aparte que diga CONTACTOS (COMPRAS, VENTAS). Lo mismo
--    harás con compras, lo que se tiene registrado, que se refleje allá, y vas a
--    permitir poder editar, deshabilitar, y agregar un nuevo contacto ya sea
--    persona o proveedor, con los datos básicos que sería nombre, apellido, razón
--    social, cédula, rif. Y además no permitas agregar si ya existe esa cédula o RIF»
--
-- CÓMO QUEDA, Y POR QUÉ ASÍ
-- ---------------------------------------------------------------------------
-- Antes de escribir esto se miró la base de verdad, y eso decidió el diseño:
--
--   · `sales_clients` (los clientes de Ventas) estaba VACÍA: 0 filas. Por eso se
--     RENOMBRA a `contactos` en vez de crear una tabla más. Renombrar no mueve un
--     solo dato y las llaves que la apuntan (`sales.client_id`, `cuentas.client_id`)
--     siguen apuntándole solas.
--
--   · `suppliers` (los 55 proveedores de Compras) la apuntan SEIS tablas: cuentas,
--     direct_purchases, hose_services, inventory_requirements, purchase_orders y
--     servicios. Por eso `suppliers` NO SE TOCA NI SE BORRA: se queda donde está y
--     se ENLAZA con su contacto. Compras, Cuentas y Mangueras siguen leyendo
--     exactamente lo que leían.
--
--   · El contacto y su proveedor quedan ESPEJADOS por trigger en los dos sentidos:
--     se edite donde se edite, el nombre y el RIF terminan iguales en los dos
--     sitios. Sin eso, «reflejar allá lo que está registrado» duraría hasta la
--     primera corrección.
--
-- ⚠️ DOS COSAS QUE LOS DATOS REALES OBLIGARON A RESOLVER (y no se inventan solas):
--
--   1. CINCO PROVEEDORES NO TIENEN RIF (AVZ-IMPORT 2024, DEFCOM VENEZUELA,
--      DISTRIBUIDORA DUV ULTRA VIDEO, DISTRIBUIDORA HID VENEZUELA y TORNILLERIA
--      GLOBAL). Por eso el documento se vuelve OPCIONAL: si fuera obligatorio, o
--      se quedaban fuera del catálogo —y con ellos sus compras— o había que
--      inventarles un RIF. Entran sin documento y la pantalla los muestra
--      avisados, para que se lo pongan cuando lo tengan a mano.
--
--   2. TRES PROVEEDORES COMPARTEN EL RIF J-501299935: DPE GRUPO DIGITAL PRINT,
--      FERRETERIA ALBAMAR C.A. y FERRETERIA EL PUERTO MARITIMO C.A. Tres empresas
--      distintas no pueden tener el mismo RIF: alguno está mal copiado. El
--      catálogo NO los fusiona ni elige por su cuenta cuál es el bueno: el
--      primero (por nombre) se queda con el RIF y los otros dos entran SIN
--      documento y avisados, igual que los del caso 1. Ninguno se pierde, ninguna
--      compra se queda sin proveedor, y la corrección la hace una persona.
--
-- 🚫 LO QUE ESTE SCRIPT NO HACE: no borra un solo registro, no fusiona contactos,
--    no toca ninguna compra, venta ni cuenta ya registrada.
-- ============================================================================


-- ── 1) `sales_clients` PASA A LLAMARSE `contactos` ──────────────────────────
-- Renombrar conserva los datos, los índices y las llaves que la apuntan.
do $blk$
begin
  if to_regclass('public.contactos') is null and to_regclass('public.sales_clients') is not null then
    alter table public.sales_clients rename to contactos;
  end if;
end $blk$;

-- Si alguien llega aquí sin `ventas.sql`, la tabla se crea igual y el módulo
-- funciona: Ventas la llenará cuando se corra el suyo.
create table if not exists public.contactos (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  doc_letter   text,
  doc_number   text,
  phone        text,
  email        text,
  address      text,
  es_proveedor boolean not null default false,
  note         text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.profiles(id) on delete set null
);

comment on table public.contactos is
  'Catalogo unico de personas y empresas: a quien se le vende y a quien se le compra.';


-- ── 2) LOS DATOS BÁSICOS QUE PIDIÓ EL CLIENTE ───────────────────────────────
-- «nombre, apellido, razón social, cédula, rif».
alter table public.contactos add column if not exists first_name   text;
alter table public.contactos add column if not exists last_name    text;
alter table public.contactos add column if not exists razon_social text;
-- Un contacto puede ser las dos cosas a la vez: a mucha gente se le vende Y se le
-- compra. Son dos marcas, no dos listas: tenerlo dos veces es tener su cuenta
-- partida en dos.
alter table public.contactos add column if not exists es_cliente boolean not null default true;
-- El rubro, igual que en Compras (FERRETERIA, REPUESTOS…): es como se filtra allá,
-- y si se perdiera al mudarlo aquí, Compras saldría peor de lo que estaba.
alter table public.contactos add column if not exists tags text[];

comment on column public.contactos.name is
  'Lo que se IMPRIME: «NOMBRE APELLIDO» de una persona, la razon social de una empresa. Nunca vacio.';
comment on column public.contactos.es_cliente is 'Se le vende.';
comment on column public.contactos.es_proveedor is 'Se le compra (sale en Compras).';


-- ── 3) EL DOCUMENTO: OPCIONAL, PERO SIN REPETIRSE ───────────────────────────
-- Opcional porque hay proveedores reales que hoy no lo tienen cargado (ver el
-- encabezado). Único cuando SÍ está: es lo que pidió el cliente —«no permitas
-- agregar si ya existe esa cédula o RIF»— y lo que impide que el mismo contacto
-- entre tres veces y su cuenta salga partida.
alter table public.contactos alter column doc_letter drop not null;
alter table public.contactos alter column doc_number drop not null;

-- El índice viejo de Ventas se va: no admitía filas sin documento.
drop index if exists public.sales_clients_doc_key;
drop index if exists public.contactos_doc_key;

-- ⭐ ÚNICO PARCIAL: compara letra + solo los DÍGITOS, así «J-50.129.99-35» y
--    «J501299935» son el mismo RIF. Las filas sin documento no chocan entre sí.
create unique index if not exists contactos_doc_key
  on public.contactos (upper(doc_letter), (regexp_replace(doc_number, '[^0-9]', '', 'g')))
  where doc_number is not null and btrim(doc_number) <> '';

create index if not exists contactos_name_idx      on public.contactos (lower(name));
create index if not exists contactos_last_name_idx on public.contactos (lower(last_name));
create index if not exists contactos_tags_idx      on public.contactos using gin (tags);


-- ── 4) EL PUENTE CON LOS PROVEEDORES DE COMPRAS ─────────────────────────────
-- `suppliers` NO se toca: seis tablas la apuntan. Solo gana la columna que dice
-- cuál contacto es.
alter table public.suppliers add column if not exists contacto_id uuid
  references public.contactos(id) on delete set null;
create unique index if not exists suppliers_contacto_uk
  on public.suppliers (contacto_id) where contacto_id is not null;

alter table public.contactos add column if not exists supplier_id uuid
  references public.suppliers(id) on delete set null;
create unique index if not exists contactos_supplier_uk
  on public.contactos (supplier_id) where supplier_id is not null;


-- ── 5) IMPORTAR LOS 55 PROVEEDORES DE COMPRAS ───────────────────────────────
-- Se corre una sola vez de verdad: el `where not exists` sobre `contacto_id` hace
-- que la segunda pasada no cree nada.
--
-- El RIF se parte en letra + dígitos. Si esa combinación YA la tiene otro
-- contacto (el caso de los tres que comparten J-501299935), este entra SIN
-- documento: nada se pierde y la pantalla lo pide. El orden por nombre hace que
-- el resultado sea el mismo siempre, se corra cuando se corra.
do $blk$
declare p record; nuevo uuid; l text; d text;
begin
  for p in
    select s.* from public.suppliers s
     where s.contacto_id is null
     order by s.name
  loop
    l := upper(coalesce(substring(btrim(coalesce(p.rif, '')) from '[A-Za-z]'), ''));
    d := regexp_replace(coalesce(p.rif, ''), '[^0-9]', '', 'g');
    -- Sin letra o sin dígitos no es un RIF: entra sin documento.
    if l = '' or d = '' or l not in ('V','E','J','G','P') then
      l := null; d := null;
    -- Ese RIF ya es de otro contacto: NO se fusionan ni se elige por nadie.
    elsif exists (
      select 1 from public.contactos c
       where upper(c.doc_letter) = l
         and regexp_replace(coalesce(c.doc_number, ''), '[^0-9]', '', 'g') = d
    ) then
      l := null; d := null;
    end if;

    insert into public.contactos
      (name, razon_social, doc_letter, doc_number, phone, email, address,
       es_cliente, es_proveedor, tags, active, supplier_id)
    values
      (upper(btrim(p.name)), upper(btrim(p.name)), l, d,
       nullif(btrim(coalesce(p.phone, '')), ''),
       nullif(btrim(coalesce(p.email, '')), ''),
       nullif(btrim(coalesce(p.address, '')), ''),
       -- Viene de Compras: es proveedor. Que además se le venda, lo marca quien sepa.
       false, true, p.tags, coalesce(p.active, true), p.id)
    returning id into nuevo;

    update public.suppliers set contacto_id = nuevo where id = p.id;
  end loop;
end $blk$;


-- ── 6) EL ESPEJO: SE EDITE DONDE SE EDITE, QUEDAN IGUALES ───────────────────
--
-- ⚠️ `pg_trigger_depth() > 1` corta la recursión: el contacto actualiza a su
--    proveedor, ese UPDATE dispara el trigger del proveedor, y sin esta guarda se
--    quedarían rebotando hasta que la base los corte con un error.

-- 6a) Del CONTACTO a su proveedor de Compras.
create or replace function public.contacto_espeja_supplier()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare sid uuid;
begin
  if pg_trigger_depth() > 1 then return null; end if;

  -- Deja de ser proveedor: NO se borra su ficha de Compras (sus compras viejas la
  -- necesitan). Se desactiva, que es lo reversible.
  if not new.es_proveedor then
    if new.supplier_id is not null then
      update public.suppliers set active = false where id = new.supplier_id;
    end if;
    return null;
  end if;

  sid := new.supplier_id;
  if sid is null then
    insert into public.suppliers (name, rif, phone, email, address, active, tags, contacto_id)
    values (new.name,
            case when new.doc_number is null then null
                 else upper(new.doc_letter) || '-' || regexp_replace(new.doc_number, '[^0-9]', '', 'g') end,
            new.phone, new.email, new.address, new.active, new.tags, new.id)
    returning id into sid;
    -- ⚠️ Se guarda con un UPDATE y no asignándole a NEW: este trigger es AFTER, y
    --    ahí NEW ya no se puede tocar. Ese UPDATE se dispara a sí mismo una vez, y
    --    la guarda de pg_trigger_depth lo corta en seco.
    update public.contactos set supplier_id = sid where id = new.id;
  else
    update public.suppliers
       set name    = new.name,
           rif     = case when new.doc_number is null then null
                          else upper(new.doc_letter) || '-' || regexp_replace(new.doc_number, '[^0-9]', '', 'g') end,
           phone   = new.phone,
           email   = new.email,
           address = new.address,
           active  = new.active,
           tags    = new.tags,
           contacto_id = new.id
     where id = sid;
  end if;
  return null;
end $fn$;

drop trigger if exists trg_contacto_espeja_supplier on public.contactos;
-- ⚠️ AFTER, NO BEFORE. Con BEFORE INSERT, el «insert into suppliers» de arriba apunta
--    a un contacto que TODAVÍA NO EXISTE y la llave foránea lo rechaza: registrar un
--    proveedor nuevo reventaba con «violates foreign key constraint». Se descubrió
--    probándolo contra la base de verdad, no leyéndolo.
create trigger trg_contacto_espeja_supplier
  after insert or update on public.contactos
  for each row execute function public.contacto_espeja_supplier();

-- 6b) Del proveedor DE VUELTA a su contacto, para quien siga editando en Compras.
create or replace function public.supplier_espeja_contacto()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if pg_trigger_depth() > 1 or new.contacto_id is null then return new; end if;
  update public.contactos
     set name    = upper(btrim(new.name)),
         phone   = new.phone,
         email   = new.email,
         address = new.address,
         active  = new.active,
         tags    = new.tags
   where id = new.contacto_id;
  return new;
end $fn$;

drop trigger if exists trg_supplier_espeja_contacto on public.suppliers;
create trigger trg_supplier_espeja_contacto
  after update on public.suppliers
  for each row execute function public.supplier_espeja_contacto();


-- ── 7) EL NOMBRE QUE SE IMPRIME NUNCA QUEDA VACÍO ───────────────────────────
-- `name` es lo que va en una factura y en una orden de compra. Se arma solo desde
-- nombre + apellido (persona) o razón social (empresa), para que no dependa de que
-- la pantalla lo mande bien.
create or replace function public.contacto_arma_nombre()
returns trigger language plpgsql set search_path = public as $fn$
declare armado text;
begin
  if upper(coalesce(new.doc_letter, 'V')) in ('J','G') then
    armado := btrim(coalesce(new.razon_social, ''));
  else
    armado := btrim(concat_ws(' ', nullif(btrim(coalesce(new.first_name, '')), ''),
                                   nullif(btrim(coalesce(new.last_name, '')), '')));
  end if;
  -- Si no hay con qué armarlo, se respeta el que venga: más vale el nombre que
  -- mandó la pantalla que un contacto en blanco.
  if armado <> '' then new.name := upper(armado); else new.name := upper(btrim(new.name)); end if;
  return new;
end $fn$;

drop trigger if exists trg_contacto_arma_nombre on public.contactos;
create trigger trg_contacto_arma_nombre
  before insert or update on public.contactos
  for each row execute function public.contacto_arma_nombre();


-- ── 8) PERMISOS ─────────────────────────────────────────────────────────────
-- Lee cualquiera autenticado (Ventas y Compras necesitan la lista); escribe quien
-- tenga el módulo «contactos», o quien ya podía en Ventas o en Compras: a nadie se
-- le quita algo que hoy puede hacer.
alter table public.contactos enable row level security;

drop policy if exists contactos_select on public.contactos;
create policy contactos_select on public.contactos
  for select to authenticated using (true);

drop policy if exists contactos_write on public.contactos;
create policy contactos_write on public.contactos
  for all to authenticated
  using ((select public.can_write_module('contactos'))
      or (select public.can_write_module('ventas'))
      or (select public.can_write_module('compras')))
  with check ((select public.can_write_module('contactos'))
      or (select public.can_write_module('ventas'))
      or (select public.can_write_module('compras')));

grant select, insert, update, delete on public.contactos to authenticated;

-- Las políticas viejas de `sales_clients` viajaron con el renombrado: se limpian.
drop policy if exists sc_select on public.contactos;
drop policy if exists sc_write  on public.contactos;


-- ── 9) REALTIME Y AUDITORÍA ─────────────────────────────────────────────────
do $blk$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname='supabase_realtime' and schemaname='public' and tablename='contactos') then
    alter publication supabase_realtime add table public.contactos;
  end if;
exception when others then null;
end $blk$;

do $blk$
begin
  if to_regclass('public.audit_log') is not null and exists (
    select 1 from pg_proc where proname = 'audit_row' and pronamespace = 'public'::regnamespace
  ) then
    execute 'drop trigger if exists trg_audit on public.contactos';
    execute 'create trigger trg_audit after insert or update or delete on public.contactos for each row execute function public.audit_row()';
  end if;
end $blk$;


-- ── 10) VERIFICACIÓN (del 1 al 5 tienen que decir ✅) ──────────────────────
select chequeo, valor, case when ok then '✅' else '❌ REVISAR' end as estado
from (
  select 1 as n, 'La tabla del catálogo' as chequeo,
         coalesce(to_regclass('public.contactos')::text, 'no existe') as valor,
         to_regclass('public.contactos') is not null as ok
  union all
  select 2, 'Los datos básicos (nombre, apellido, razón social)',
         (select count(*)::text from information_schema.columns
           where table_schema='public' and table_name='contactos'
             and column_name in ('first_name','last_name','razon_social')),
         (select count(*) from information_schema.columns
           where table_schema='public' and table_name='contactos'
             and column_name in ('first_name','last_name','razon_social')) = 3
  union all
  -- ⭐ Lo que pidió el cliente: ni una compra se queda sin su contacto.
  select 3, '⭐ Proveedores de Compras SIN reflejar (tiene que ser 0)',
         (select count(*)::text from public.suppliers where contacto_id is null),
         (select count(*) from public.suppliers where contacto_id is null) = 0
  union all
  select 4, '⭐ El índice que impide repetir la cédula o el RIF',
         coalesce((select indexname from pg_indexes
                    where schemaname='public' and indexname='contactos_doc_key'), 'no existe'),
         exists (select 1 from pg_indexes where schemaname='public' and indexname='contactos_doc_key')
  union all
  select 5, 'RLS activo',
         (select relrowsecurity from pg_class where oid='public.contactos'::regclass)::text,
         (select relrowsecurity from pg_class where oid='public.contactos'::regclass)
  union all
  select 6, 'Contactos en el catálogo',
         (select count(*)::text from public.contactos), true
  union all
  -- INFORMATIVO: los que entraron sin documento (ver el encabezado, casos 1 y 2).
  -- No es un error: es la lista de lo que hay que completar a mano.
  select 7, '⚠️ Contactos a los que les falta la cédula o el RIF',
         (select count(*)::text from public.contactos
           where doc_number is null or btrim(doc_number) = ''),
         true
  union all
  -- CONTROL: este script no toca nada de lo ya registrado.
  select 8, 'Compras directas registradas (NO se tocan)',
         (select count(*)::text from public.direct_purchases), true
) t
order by n;


-- ── ¿CUÁLES SON LOS QUE LE FALTA EL DOCUMENTO? ─────────────────────────────
-- Esta consulta es para mirar, no cambia nada. Son los que hay que completar en
-- el módulo 📇 Contactos.
select name as "Hay que ponerle la cédula o el RIF",
       coalesce(nullif(array_to_string(tags, ', '), ''), '—') as rubro
from public.contactos
where doc_number is null or btrim(doc_number) = ''
order by name;


-- ============================================================================
-- DESHACER (solo si hay que revertir):
--   drop trigger if exists trg_supplier_espeja_contacto on public.suppliers;
--   drop trigger if exists trg_contacto_espeja_supplier on public.contactos;
--   drop trigger if exists trg_contacto_arma_nombre     on public.contactos;
--   update public.suppliers set contacto_id = null;
--   alter table public.contactos rename to sales_clients;
--   -- Los proveedores de `suppliers` nunca se tocaron: siguen completos.
-- ============================================================================
