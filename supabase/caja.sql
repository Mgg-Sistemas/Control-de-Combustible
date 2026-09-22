-- ============================================================================
-- MÓDULO DE CAJA (22-sep-2026)
--
-- 👉 CÓMO SE CORRE: copiar ESTE ARCHIVO COMPLETO, pegarlo en Supabase → SQL
--    Editor y darle RUN una sola vez. Es idempotente.
--
-- ⚠️ REQUIERE `supabase/ventas.sql` CORRIDO PRIMERO (usa `sales` y `cuentas.sale_id`).
--
-- LA REGLA QUE MANDA (textual del cliente): «todo lo que entra es por ventas».
-- ---------------------------------------------------------------------------
-- Acá NO se puede escribir un ingreso a mano. Está prohibido por un CHECK en la
-- base, no por buena voluntad de la pantalla:
--
--     ingreso  ⇒ origen ∈ (venta, cobranza)   ← los ponen TRIGGERS, nadie más
--     egreso   ⇒ origen = manual              ← esto sí lo carga una persona
--
-- Si el ingreso se pudiera teclear, la caja dejaría de cuadrar con Ventas el
-- primer día y nadie sabría cuál de los dos números creer.
--
-- DE DÓNDE ENTRA EL DINERO — y CUÁNDO
-- ---------------------------------------------------------------------------
--   • VENTA DE CONTADO → entra COMPLETA el día de la venta, por su método de pago.
--   • VENTA A CRÉDITO  → NO entra al vender. Entra el día que se registra el
--     ABONO en el módulo Cuentas, y SOLO por lo abonado. Así la caja refleja
--     plata real: si el cliente no paga, la caja no miente.
--
-- ⚠️ Solo entran los abonos de cuentas por cobrar NACIDAS DE UNA VENTA
--    (`cuentas.sale_id is not null`). Las otras cuentas por cobrar del sistema
--    —mangueras, alquiler de maquinaria a las empresas— NO tocan la caja,
--    porque el cliente dijo que lo que entra es lo de VENTAS. Para incluirlas
--    algún día basta con quitar esa condición en `abono_apply_caja()`.
--
-- LA SESIÓN (apertura → movimientos → cierre con arqueo)
-- ---------------------------------------------------------------------------
-- Hay UNA SOLA caja abierta a la vez (índice único parcial). Al cerrar se
-- cuenta el efectivo y queda la diferencia contra lo esperado, por método.
-- ============================================================================


-- ── 1) CATÁLOGO DE CATEGORÍAS DE EGRESO ─────────────────────────────────────
-- Se llena solo desde la pantalla, igual que los tipos de intervención de
-- Servicio. «Borrar» = desactivar: un egreso viejo no puede quedarse sin
-- nombre porque alguien limpió el catálogo.
create table if not exists public.caja_categorias (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  icon       text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists caja_categorias_name_key on public.caja_categorias (lower(name));

insert into public.caja_categorias (name, icon) values
  ('Compra menor',            '🛒'),
  ('Combustible',             '⛽'),
  ('Viático',                 '🍽️'),
  ('Transporte / flete',      '🚚'),
  ('Repuesto / ferretería',   '🔩'),
  ('Pago a proveedor',        '🏭'),
  ('Retiro a bóveda / banco', '🏦'),
  ('Otro',                    '✏️')
on conflict do nothing;


-- ── 2) SESIONES DE CAJA ─────────────────────────────────────────────────────
create table if not exists public.caja_sesiones (
  id             uuid primary key default gen_random_uuid(),
  code           text not null,                       -- CAJA-0001 (trigger)

  opened_at      timestamptz not null default now(),
  opened_by      uuid references public.profiles(id) on delete set null,
  opened_by_name text,

  -- FONDO DE CAJA: el efectivo con el que se abre. Solo hay dos, porque solo el
  -- efectivo está físicamente en la gaveta; una transferencia no se "abre con
  -- saldo", se concilia contra el banco.
  apertura_usd   numeric(14,2) not null default 0 check (apertura_usd >= 0),
  apertura_bs    numeric(16,2) not null default 0 check (apertura_bs  >= 0),

  closed_at      timestamptz,
  closed_by      uuid references public.profiles(id) on delete set null,
  closed_by_name text,

  -- LO CONTADO al cerrar, por método: {"efectivo_usd":120.5,"bs":4500,...}.
  -- Va en jsonb y no en columnas sueltas a propósito: los métodos de pago los
  -- define Ventas (`src/lib/ventas.ts`), y agregar uno no puede exigir una
  -- migración de la caja.
  conteo         jsonb not null default '{}'::jsonb,

  -- Tasa BCV del cierre, para el equivalente en Bs del acta. Se congela: un
  -- acta firmada no puede cambiar de monto porque mañana cambió el dólar.
  rate_bs        numeric(14,4) not null default 0,

  estado         text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
  nota           text,
  created_at     timestamptz not null default now()
);
create unique index if not exists caja_sesiones_code_key on public.caja_sesiones (code);
create index if not exists caja_sesiones_abierta_idx on public.caja_sesiones (opened_at desc);

-- ⭐ UNA SOLA CAJA ABIERTA A LA VEZ. Es un índice y no una validación de la
--    pantalla porque dos cajas abiertas en paralelo hacen que el mismo ingreso
--    caiga en una o en otra según el azar de la red, y ninguno de los dos
--    arqueos cuadra después.
create unique index if not exists caja_sesiones_una_abierta
  on public.caja_sesiones ((estado)) where estado = 'abierta';

create or replace function public.assign_caja_code()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare n int;
begin
  if new.code is null or new.code = '' then
    perform pg_advisory_xact_lock(hashtext('caja_sesiones_code'));
    select coalesce(max((regexp_replace(code, '[^0-9]', '', 'g'))::int), 0) + 1
      into n from public.caja_sesiones where code ~ '^CAJA-[0-9]+$';
    new.code := 'CAJA-' || lpad(n::text, 4, '0');
  end if;
  return new;
end $fn$;

drop trigger if exists trg_assign_caja_code on public.caja_sesiones;
create trigger trg_assign_caja_code
  before insert on public.caja_sesiones
  for each row execute function public.assign_caja_code();


-- ── 3) MOVIMIENTOS ──────────────────────────────────────────────────────────
create table if not exists public.caja_movimientos (
  id          uuid primary key default gen_random_uuid(),

  -- La sesión a la que pertenece. NULA A PROPÓSITO: una venta puede entrar con
  -- la caja cerrada (se vendió un domingo, nadie abrió caja). Ese movimiento NO
  -- se pierde ni se rechaza — queda suelto y lo absorbe la próxima apertura
  -- (ver `caja_absorber_pendientes`). Rechazarlo sería perder plata real por un
  -- trámite; ignorarlo sería un faltante que nadie puede explicar.
  sesion_id   uuid references public.caja_sesiones(id) on delete set null,

  tipo        text not null check (tipo in ('ingreso', 'egreso')),
  origen      text not null check (origen in ('venta', 'cobranza', 'manual')),

  -- ⭐ LA REGLA DEL CLIENTE, EN LA BASE: lo que entra es por ventas.
  constraint caja_origen_segun_tipo check (
    (tipo = 'ingreso' and origen in ('venta', 'cobranza'))
    or
    (tipo = 'egreso'  and origen = 'manual')
  ),

  fecha       date not null default current_date,
  concepto    text not null,
  categoria   text,                                   -- solo egresos (texto libre del catálogo)
  metodo      text not null
              check (metodo in ('bs','transferencia','pago_movil','zelle','usdt','efectivo_usd')),

  -- Montos en $ (la moneda en la que piensa todo el sistema) + el equivalente
  -- en Bs congelado con la tasa del momento, igual que en `sales`.
  monto       numeric(14,2) not null check (monto > 0),
  rate_bs     numeric(14,4) not null default 0,
  monto_bs    numeric(16,2) not null default 0,

  -- De dónde salió, para poder volver al papel.
  sale_id     uuid references public.sales(id)         on delete cascade,
  cuenta_id   uuid references public.cuentas(id)       on delete set null,
  abono_id    uuid references public.cuenta_abonos(id) on delete cascade,

  nota        text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists caja_mov_sesion_idx on public.caja_movimientos (sesion_id);
create index if not exists caja_mov_fecha_idx  on public.caja_movimientos (fecha desc);
create index if not exists caja_mov_sueltos_idx on public.caja_movimientos (created_at) where sesion_id is null;

-- ⭐ UNA VENTA ENTRA UNA SOLA VEZ, Y UN ABONO TAMBIÉN. Sin estos dos índices,
--    un trigger que se reintenta (o alguien que corre este archivo dos veces)
--    duplicaría el ingreso y la caja quedaría con plata que no existe.
create unique index if not exists caja_mov_venta_uk on public.caja_movimientos (sale_id)  where sale_id  is not null;
create unique index if not exists caja_mov_abono_uk on public.caja_movimientos (abono_id) where abono_id is not null;


-- ── 4) LA CAJA ABIERTA, Y LO QUE ENTRÓ CON ELLA CERRADA ─────────────────────
create or replace function public.caja_abierta()
returns uuid language sql stable security definer set search_path = public as $fn$
  select id from public.caja_sesiones where estado = 'abierta' limit 1;
$fn$;

-- Al ABRIR caja, todo lo que entró mientras estuvo cerrada se mete en esta
-- sesión. Así nada queda huérfano y el arqueo incluye hasta lo del domingo.
create or replace function public.caja_absorber_pendientes()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  update public.caja_movimientos set sesion_id = new.id where sesion_id is null;
  return new;
end $fn$;

drop trigger if exists trg_caja_absorber on public.caja_sesiones;
create trigger trg_caja_absorber
  after insert on public.caja_sesiones
  for each row execute function public.caja_absorber_pendientes();


-- ── 5) LA VENTA DE CONTADO ENTRA SOLA ───────────────────────────────────────
-- Por TRIGGER y no desde la pantalla, por el mismo motivo que la cuenta por
-- cobrar de Ventas: escribir en caja exigiría permiso del módulo Caja, y quien
-- vende no tiene por qué tenerlo. Si se hiciera desde la app, la venta quedaría
-- grabada y el dinero NO — que es la peor de las dos mitades.
create or replace function public.sale_apply_caja()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.condicion = 'contado' and coalesce(new.total, 0) > 0 then
    insert into public.caja_movimientos
      (sesion_id, tipo, origen, fecha, concepto, metodo, monto, rate_bs, monto_bs, sale_id, created_by)
    values
      (public.caja_abierta(), 'ingreso', 'venta', new.sale_date,
       'Venta ' || coalesce(new.code, '') || ' · ' || coalesce(new.client_name, ''),
       coalesce(new.payment_method, 'efectivo_usd'),
       new.total, coalesce(new.rate_bs, 0), coalesce(new.total_bs, 0),
       new.id, new.created_by)
    on conflict (sale_id) where sale_id is not null do nothing;
  end if;
  return new;
end $fn$;

-- Al EDITAR la venta se re-sincroniza el movimiento. Los tres casos posibles:
--   contado → contado : se ajusta monto/método/fecha.
--   contado → crédito : el ingreso SE BORRA (el dinero ya no entró; entrará
--                       cuando se abone).
--   crédito → contado : se crea el ingreso.
create or replace function public.sale_reapply_caja()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.condicion = 'contado' and coalesce(new.total, 0) > 0 then
    update public.caja_movimientos
       set fecha    = new.sale_date,
           concepto = 'Venta ' || coalesce(new.code, '') || ' · ' || coalesce(new.client_name, ''),
           metodo   = coalesce(new.payment_method, 'efectivo_usd'),
           monto    = new.total,
           rate_bs  = coalesce(new.rate_bs, 0),
           monto_bs = coalesce(new.total_bs, 0)
     where sale_id = new.id;
    if not found then
      insert into public.caja_movimientos
        (sesion_id, tipo, origen, fecha, concepto, metodo, monto, rate_bs, monto_bs, sale_id, created_by)
      values
        (public.caja_abierta(), 'ingreso', 'venta', new.sale_date,
         'Venta ' || coalesce(new.code, '') || ' · ' || coalesce(new.client_name, ''),
         coalesce(new.payment_method, 'efectivo_usd'),
         new.total, coalesce(new.rate_bs, 0), coalesce(new.total_bs, 0),
         new.id, new.created_by)
      on conflict (sale_id) where sale_id is not null do nothing;
    end if;
  else
    delete from public.caja_movimientos where sale_id = new.id;
  end if;
  return new;
end $fn$;

drop trigger if exists trg_sale_apply_caja on public.sales;
create trigger trg_sale_apply_caja
  after insert on public.sales
  for each row execute function public.sale_apply_caja();

drop trigger if exists trg_sale_reapply_caja on public.sales;
create trigger trg_sale_reapply_caja
  after update on public.sales
  for each row execute function public.sale_reapply_caja();


-- ── 6) EL COBRO DE UNA VENTA A CRÉDITO ENTRA SOLO ───────────────────────────
-- Solo los abonos de cuentas POR COBRAR nacidas de una VENTA. Ver la nota del
-- encabezado: mangueras y alquiler de maquinaria no son ventas.
--
-- El método del abono se traduce al vocabulario de Ventas: en Cuentas el campo
-- `metodo` es texto libre ('efectivo', 'transferencia', 'cheque'…), acá tiene
-- que caer en uno de los seis del check. Lo que no se reconoce entra como
-- transferencia, que es lo más común en una cobranza, y queda la palabra
-- original en la nota para no perder el dato.
create or replace function public.abono_metodo_caja(v text)
returns text language sql immutable set search_path = public as $fn$
  select case
    when v is null or btrim(v) = ''           then 'transferencia'
    when lower(v) like '%pago%movil%'         then 'pago_movil'
    when lower(v) like '%pago m%vil%'         then 'pago_movil'
    when lower(v) like '%zelle%'              then 'zelle'
    when lower(v) like '%usdt%'               then 'usdt'
    when lower(v) like '%bolivar%'
      or lower(v) like '%bol%var%'
      or lower(v) = 'bs'                      then 'bs'
    when lower(v) like '%efectivo%'
      or lower(v) like '%dolar%'
      or lower(v) like '%d%lar%'              then 'efectivo_usd'
    else 'transferencia'
  end;
$fn$;

create or replace function public.abono_apply_caja()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare c record;
begin
  select tipo, sale_id, concepto into c from public.cuentas where id = new.cuenta_id;
  if not found or c.tipo <> 'por_cobrar' or c.sale_id is null then
    return new;                      -- no es cobranza de una venta: no toca caja
  end if;

  insert into public.caja_movimientos
    (sesion_id, tipo, origen, fecha, concepto, metodo, monto, sale_id, cuenta_id, abono_id, nota, created_by)
  values
    (public.caja_abierta(), 'ingreso', 'cobranza', coalesce(new.fecha, current_date),
     'Cobro · ' || coalesce(c.concepto, 'venta a crédito'),
     public.abono_metodo_caja(new.metodo), new.monto,
     c.sale_id, new.cuenta_id, new.id,
     nullif(btrim(coalesce(new.metodo, '') || ' ' || coalesce(new.referencia, '')), ''),
     new.created_by)
  on conflict (abono_id) where abono_id is not null do nothing;
  return new;
end $fn$;

drop trigger if exists trg_abono_apply_caja on public.cuenta_abonos;
create trigger trg_abono_apply_caja
  after insert on public.cuenta_abonos
  for each row execute function public.abono_apply_caja();


-- ── 7) RLS ──────────────────────────────────────────────────────────────────
-- Lectura para cualquier autenticado; escritura por permiso del módulo 'caja'.
-- Mismo criterio que Ventas y Compras.
alter table public.caja_sesiones     enable row level security;
alter table public.caja_movimientos  enable row level security;
alter table public.caja_categorias   enable row level security;

drop policy if exists caja_sesiones_select on public.caja_sesiones;
create policy caja_sesiones_select on public.caja_sesiones for select to authenticated using (true);
drop policy if exists caja_sesiones_write on public.caja_sesiones;
create policy caja_sesiones_write on public.caja_sesiones for all to authenticated
  using (public.can_write_module('caja')) with check (public.can_write_module('caja'));

-- ⚠️ EL INGRESO NO SE ESCRIBE A MANO, NI SIQUIERA TENIENDO EL MÓDULO. La
--    política de escritura solo admite EGRESOS; los ingresos los meten los
--    triggers, que corren como `security definer` y no pasan por RLS. Es el
--    segundo candado de la regla «todo lo que entra es por ventas»: el CHECK
--    dice qué forma tiene un ingreso, esto dice quién puede crearlo.
drop policy if exists caja_mov_select on public.caja_movimientos;
create policy caja_mov_select on public.caja_movimientos for select to authenticated using (true);
drop policy if exists caja_mov_insert on public.caja_movimientos;
create policy caja_mov_insert on public.caja_movimientos for insert to authenticated
  with check (public.can_write_module('caja') and tipo = 'egreso');
drop policy if exists caja_mov_update on public.caja_movimientos;
create policy caja_mov_update on public.caja_movimientos for update to authenticated
  using (public.can_write_module('caja') and tipo = 'egreso')
  with check (public.can_write_module('caja') and tipo = 'egreso');
drop policy if exists caja_mov_delete on public.caja_movimientos;
create policy caja_mov_delete on public.caja_movimientos for delete to authenticated
  using (public.can_write_module('caja') and tipo = 'egreso');

drop policy if exists caja_categorias_select on public.caja_categorias;
create policy caja_categorias_select on public.caja_categorias for select to authenticated using (true);
drop policy if exists caja_categorias_write on public.caja_categorias;
create policy caja_categorias_write on public.caja_categorias for all to authenticated
  using (public.can_write_module('caja')) with check (public.can_write_module('caja'));

grant select, insert, update, delete on public.caja_sesiones    to authenticated;
grant select, insert, update, delete on public.caja_movimientos to authenticated;
grant select, insert, update, delete on public.caja_categorias  to authenticated;


-- ── 8) REALTIME ─────────────────────────────────────────────────────────────
do $blk$
declare t text;
begin
  foreach t in array array['caja_sesiones', 'caja_movimientos', 'caja_categorias'] loop
    begin
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    exception when others then null;
    end;
  end loop;
end $blk$;


-- ── 9) AUDITORÍA ────────────────────────────────────────────────────────────
do $blk$
declare t text;
begin
  if to_regclass('public.audit_log') is not null and exists (
    select 1 from pg_proc where proname = 'audit_row' and pronamespace = 'public'::regnamespace
  ) then
    foreach t in array array['caja_sesiones', 'caja_movimientos', 'caja_categorias'] loop
      execute format('drop trigger if exists trg_audit on public.%I', t);
      execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
    end loop;
  end if;
end $blk$;


-- ── 10) CARGA INICIAL: las ventas de contado que YA existen ─────────────────
-- Sin esto la caja arrancaría en cero ignorando lo que ya se vendió. Entran
-- SUELTAS (sesion_id NULL) y las absorbe la primera apertura de caja.
-- El `on conflict` hace que correr el archivo dos veces no duplique nada.
insert into public.caja_movimientos
  (sesion_id, tipo, origen, fecha, concepto, metodo, monto, rate_bs, monto_bs, sale_id, created_by)
select null, 'ingreso', 'venta', s.sale_date,
       'Venta ' || coalesce(s.code, '') || ' · ' || coalesce(s.client_name, ''),
       coalesce(s.payment_method, 'efectivo_usd'),
       s.total, coalesce(s.rate_bs, 0), coalesce(s.total_bs, 0), s.id, s.created_by
  from public.sales s
 where s.condicion = 'contado' and coalesce(s.total, 0) > 0
on conflict (sale_id) where sale_id is not null do nothing;

-- Y los abonos ya registrados de ventas a crédito.
insert into public.caja_movimientos
  (sesion_id, tipo, origen, fecha, concepto, metodo, monto, sale_id, cuenta_id, abono_id, created_by)
select null, 'ingreso', 'cobranza', coalesce(a.fecha, current_date),
       'Cobro · ' || coalesce(c.concepto, 'venta a crédito'),
       public.abono_metodo_caja(a.metodo), a.monto,
       c.sale_id, c.id, a.id, a.created_by
  from public.cuenta_abonos a
  join public.cuentas c on c.id = a.cuenta_id
 where c.tipo = 'por_cobrar' and c.sale_id is not null
on conflict (abono_id) where abono_id is not null do nothing;


-- ── 11) VERIFICACIÓN (todo tiene que decir ✅) ──────────────────────────────
select chequeo, valor, case when ok then '✅' else '❌ REVISAR' end as estado
from (
  select 1 as n, 'Las 3 tablas de Caja' as chequeo,
         (select count(*)::text from information_schema.tables
           where table_schema = 'public'
             and table_name in ('caja_sesiones','caja_movimientos','caja_categorias')) as valor,
         (select count(*) from information_schema.tables
           where table_schema = 'public'
             and table_name in ('caja_sesiones','caja_movimientos','caja_categorias')) = 3 as ok
  union all
  select 2, 'Categorías de egreso sembradas (mínimo 8)',
         (select count(*)::text from public.caja_categorias),
         (select count(*) from public.caja_categorias) >= 8
  union all
  select 3, '⭐ El ingreso a mano está PROHIBIDO (check)',
         (select count(*)::text from pg_constraint
           where conrelid = 'public.caja_movimientos'::regclass
             and conname = 'caja_origen_segun_tipo'),
         (select count(*) from pg_constraint
           where conrelid = 'public.caja_movimientos'::regclass
             and conname = 'caja_origen_segun_tipo') = 1
  union all
  select 4, '⭐ Una sola caja abierta a la vez (índice único)',
         (select count(*)::text from pg_indexes
           where schemaname = 'public' and indexname = 'caja_sesiones_una_abierta'),
         (select count(*) from pg_indexes
           where schemaname = 'public' and indexname = 'caja_sesiones_una_abierta') = 1
  union all
  select 5, 'Triggers de venta y de cobranza (deben ser 3)',
         (select count(*)::text from pg_trigger
           where tgname in ('trg_sale_apply_caja','trg_sale_reapply_caja','trg_abono_apply_caja')
             and not tgisinternal),
         (select count(*) from pg_trigger
           where tgname in ('trg_sale_apply_caja','trg_sale_reapply_caja','trg_abono_apply_caja')
             and not tgisinternal) = 3
  union all
  select 6, 'Ingresos cargados de lo que ya estaba vendido',
         (select count(*)::text from public.caja_movimientos where tipo = 'ingreso'),
         true
  union all
  -- CONTROL: este script NO toca ninguna venta.
  select 7, 'Ventas registradas (este script NO las toca)',
         (select count(*)::text from public.sales),
         true
) t
order by n;


-- ============================================================================
-- DESHACER (solo si hay que revertir). Descomentar y correr aparte.
-- No toca `sales` ni `cuentas`: solo se lleva la caja.
-- ============================================================================
-- drop trigger if exists trg_sale_apply_caja   on public.sales;
-- drop trigger if exists trg_sale_reapply_caja on public.sales;
-- drop trigger if exists trg_abono_apply_caja  on public.cuenta_abonos;
-- drop table if exists public.caja_movimientos cascade;
-- drop table if exists public.caja_sesiones    cascade;
-- drop table if exists public.caja_categorias  cascade;
