-- ============================================================================
-- CUENTAS POR PAGAR Y POR COBRAR — tablas nuevas para el módulo `cuentas`.
--
-- POR QUÉ EXISTE ESTE ARCHIVO
-- ---------------------------------------------------------------------------
-- El cliente pidió, textual: "en compras hay que hacer el apartado o una forma
-- de cuentas por pagar y cuentas por cobrar".
--
-- Hoy el sistema sabe QUÉ se compró (`purchase_requests` → `purchase_orders`)
-- pero NO sabe qué se DEBE ni qué le DEBEN. Lo único parecido que existe son
-- ledgers ya cerrados y de otro dominio:
--   • `company_payments`  → pagos YA hechos a empresas contratistas.
--   • `staff_payments` / `staff_pay_payments` → pagos YA hechos a personas.
-- Ninguno modela una DEUDA VIVA con fecha de vencimiento y saldo. Eso es lo que
-- agregan estas dos tablas.
--
-- QUÉ SE REUSA (no se duplica nada de lo que ya hay)
-- ---------------------------------------------------------------------------
--   • `public.suppliers`       → el proveedor al que se le debe (cuenta por pagar).
--   • `public.companies`       → la empresa que nos debe (cuenta por cobrar).
--   • `public.purchase_orders` → la orden de compra que originó la deuda.
--   • `public.profiles`        → quién registró y quién marcó pagada.
-- NO se crea tabla de proveedores ni de empresas: ya existen y se referencian.
--
-- POR QUÉ **UNA SOLA TABLA** CON UN CAMPO `tipo`
-- ---------------------------------------------------------------------------
-- Una cuenta por pagar y una por cobrar tienen EXACTAMENTE los mismos campos
-- (contraparte, concepto, monto, moneda, emisión, vencimiento, estado) y
-- exactamente la misma aritmética (saldo = monto − abonos; vencida si la fecha
-- de vencimiento ya pasó y el saldo es > 0). Lo único que cambia es de qué lado
-- del dinero está la fila. Partirlo en dos tablas obligaría a duplicar cada
-- índice, cada política de RLS, cada consulta y cada total del panel, para no
-- ganar absolutamente nada. Con `tipo` la pantalla es UN componente que recibe
-- el tipo como parámetro, y un reporte de "posición neta" (lo que me deben
-- menos lo que debo) es un solo `select` con un `group by tipo`.
--
-- POR QUÉ LA CONTRAPARTE ES UN **ID OBLIGATORIO** (y no un nombre en texto)
-- ---------------------------------------------------------------------------
-- Se verificó contra la base de PRODUCCIÓN antes de decidir esto:
--   suppliers = 6 filas · companies = 11 filas
--   purchase_orders = 0 · purchase_requests = 0
-- Es decir: los dos maestros que hacen falta YA EXISTEN y YA tienen datos
-- reales. No hay ninguna razón para duplicar el nombre en texto.
--
--   • 'por_pagar'  → `supplier_id`, obligatorio (a quién le debemos).
--   • 'por_cobrar' → `company_id`, obligatorio (quién nos debe).
--
-- Un CHECK obliga a que la fila traiga EXACTAMENTE el id que le toca según su
-- `tipo`, y que el otro venga NULL. Así es imposible grabar una cuenta huérfana
-- o con las dos contrapartes a la vez. El nombre se resuelve por JOIN (o, en la
-- app, con el catálogo que ya tiene cargado), de modo que si mañana corrigen el
-- nombre de un proveedor, TODAS sus deudas quedan corregidas solas — que es
-- justo lo que NO pasa cuando el nombre se copia en texto.
--
-- ⚠️ ON DELETE **RESTRICT** (a propósito, y cambia un comportamiento existente)
-- Las dos FK de contraparte son RESTRICT: la base NO deja borrar un proveedor
-- ni una empresa que tenga cuentas registradas. Es lo correcto en dinero — no
-- se puede hacer desaparecer a quien te debe o a quien le debes — pero implica
-- que, si alguien intenta borrar un proveedor desde Compras → Proveedores y ese
-- proveedor tiene cuentas, le saldrá un error en vez de borrarse. Para poder
-- borrarlo hay que anular/eliminar antes sus cuentas. Es intencional: se prefiere
-- el error visible a perder el rastro de una deuda.
--
-- El enlace a `purchase_orders` sí es opcional (`order_id`, ON DELETE SET NULL):
-- hoy esa tabla está VACÍA en producción, y además hay deudas que no nacen de
-- una orden de compra (un servicio, un alquiler, una factura suelta).
--
-- POR QUÉ UNA TABLA DE ABONOS APARTE
-- ---------------------------------------------------------------------------
-- El cliente cobra y paga en partes (es lo normal aquí: mismo patrón que
-- `staff_pay_payments`). Guardar solo un booleano "pagada" perdería el
-- histórico de cada abono. Con `cuenta_abonos` el saldo es
-- `monto − sum(abonos)` y queda el rastro de cada pago parcial con su fecha,
-- método y referencia.
--
-- QUÉ **NO** HACE ESTE SCRIPT (a propósito)
-- ---------------------------------------------------------------------------
--   • NO altera NINGUNA tabla existente. Cero ALTER sobre `suppliers`,
--     `companies`, `purchase_orders`, `profiles` ni nada más. Solo CREATE.
--   • NO borra ni actualiza ningún dato. Cero DROP de tablas, cero DELETE,
--     cero UPDATE.
--   • NO toca `can_write_module()` ni ninguna otra función que ya exista. La
--     seguridad del módulo se resuelve con una función NUEVA y propia
--     (`public.cuentas_nivel()`, punto 1) — ver la nota de seguridad ahí.
--
-- ⚠️ HAY QUE CORRERLO A MANO
-- ---------------------------------------------------------------------------
-- Editar este .sql NO lo aplica. Abrir Supabase → SQL Editor, pegar el archivo
-- completo, ejecutarlo, y DESPUÉS correr el bloque 7 (VERIFICACIÓN) para
-- confirmar que las tablas, los índices, las políticas y el realtime quedaron.
-- Es idempotente: se puede volver a correr sin romper nada.
-- ============================================================================


-- ── 1) NIVEL DE PERMISO DEL MÓDULO `cuentas` (función NUEVA) ────────────────
-- ⚠️ SEGURIDAD — LEER ANTES DE CAMBIAR ESTO.
-- Lo natural sería usar `public.can_write_module('cuentas')`, como hacen las
-- tablas de Compras. NO SIRVE AQUÍ: esa función, cuando el usuario no tiene
-- fila de permiso, devuelve TRUE salvo que el módulo esté en una lista negra
-- que está CABLEADA DENTRO de la función. Como 'cuentas' es un módulo nuevo, no
-- está en esa lista, así que `can_write_module('cuentas')` daría escritura a
-- CUALQUIER usuario logueado — la tabla nacería ABIERTA en la base aunque la
-- app la esconda. Y meter 'cuentas' en esa lista exigiría un
-- `create or replace` de una función de seguridad compartida por todo el
-- sistema, que es justo lo que este script tiene prohibido tocar.
--
-- Por eso se define una función PROPIA que replica, del lado de la base, la
-- misma resolución que hace la app en `AuthContext.moduleLevel()`:
--   admin → 'full'; si hay fila en `module_permissions` → ese nivel;
--   si no, el nivel que traiga el rol dinámico (`app_roles.modules`);
--   si tampoco → 'none'.
-- El default es 'none': EL MÓDULO NACE CERRADO. Nadie ve ni escribe una cuenta
-- hasta que un administrador le dé el permiso desde Usuarios.
create or replace function public.cuentas_nivel()
returns text
language sql
stable
security definer
set search_path = public as $$
  select case
    when public.is_anon() then 'none'
    when public.is_admin() then 'full'
    else coalesce(
      (select mp.level
         from public.module_permissions mp
        where mp.user_id = auth.uid() and mp.module = 'cuentas'
        limit 1),
      (select ar.modules ->> 'cuentas'
         from public.profiles p
         join public.app_roles ar on ar.id = p.app_role_id
        where p.id = auth.uid()
        limit 1),
      'none')
  end
$$;

-- ¿puede LEER el módulo? (lectura, escritura o full)
create or replace function public.cuentas_puede_leer()
returns boolean language sql stable set search_path = public as $$
  select public.cuentas_nivel() in ('lectura', 'escritura', 'full')
$$;

-- ¿puede ESCRIBIR en el módulo? (escritura o full)
create or replace function public.cuentas_puede_escribir()
returns boolean language sql stable set search_path = public as $$
  select public.cuentas_nivel() in ('escritura', 'full')
$$;


-- ── 2) TABLA DE CUENTAS ─────────────────────────────────────────────────────
-- Una fila = una deuda. `tipo` dice de qué lado está el dinero.
create table if not exists public.cuentas (
  id                uuid primary key default gen_random_uuid(),

  -- de qué lado del dinero está la fila:
  --   'por_pagar'  → nosotros le debemos a un proveedor/tercero.
  --   'por_cobrar' → un cliente/empresa nos debe a nosotros.
  tipo              text not null
                    check (tipo in ('por_pagar', 'por_cobrar')),

  -- A QUIÉN. Siempre por ID contra los maestros que ya existen (ver la
  -- justificación del encabezado). RESTRICT: no se puede borrar un proveedor
  -- o una empresa que tenga cuentas vivas.
  --   por_pagar  → supplier_id (obligatorio), company_id NULL
  --   por_cobrar → company_id  (obligatorio), supplier_id NULL
  supplier_id       uuid references public.suppliers(id) on delete restrict,
  company_id        uuid references public.companies(id) on delete restrict,

  -- La contraparte que corresponde al `tipo` es OBLIGATORIA, y la otra tiene
  -- que venir NULL. Sin esto se podrían grabar cuentas huérfanas (sin nadie a
  -- quién cobrarle/pagarle) o contradictorias (proveedor Y empresa a la vez).
  constraint cuentas_contraparte_segun_tipo check (
    (tipo = 'por_pagar'  and supplier_id is not null and company_id  is null)
    or
    (tipo = 'por_cobrar' and company_id  is not null and supplier_id is null)
  ),

  -- TRAZABILIDAD CON COMPRAS: si la deuda nació de una orden de compra, aquí
  -- queda el enlace. ON DELETE SET NULL para que borrar la orden no borre la
  -- deuda (el dinero se sigue debiendo aunque el papel desaparezca).
  order_id          uuid references public.purchase_orders(id) on delete set null,

  -- QUÉ se debe y por cuál papel.
  concepto          text not null,
  documento         text,                                  -- Nº de factura / control / recibo

  -- CUÁNTO. numeric(14,2) + moneda: misma convención que `company_payments`,
  -- `payroll_periods` y `haul_expenses` en este mismo proyecto.
  monto             numeric(14,2) not null default 0 check (monto >= 0),
  moneda            text not null default 'USD',

  -- CUÁNDO. `fecha_vencimiento` es lo que hace que una cuenta esté VENCIDA.
  -- Se deja NULL-able a propósito: hay deudas sin fecha pactada.
  fecha_emision     date not null default current_date,
  fecha_vencimiento date,

  -- EN QUÉ VA:
  --   'pendiente' → viva, suma a los totales y puede vencerse.
  --   'pagada'    → saldada (se marca a mano o al cubrirla con abonos).
  --   'anulada'   → se registró por error / se dejó sin efecto. NO suma en
  --                 ningún total; se conserva la fila por auditoría en vez de
  --                 borrarla.
  estado            text not null default 'pendiente'
                    check (estado in ('pendiente', 'pagada', 'anulada')),

  nota              text,

  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  settled_by        uuid references public.profiles(id) on delete set null,
  settled_at        timestamptz                            -- cuándo se marcó pagada
);


-- ── 2b) COLUMNAS AÑADIDAS (17-ago-2026) ─────────────────────────────────────
-- A pedido del cliente: poder ADJUNTAR LA FACTURA (archivo imagen/PDF) y marcar
-- un GRADO DE PRIORIDAD. Son ALTER idempotentes (add column if not exists) para
-- que re-correr el script las aplique también sobre la tabla ya creada.
--   • factura_url → URL pública del archivo de la factura en el bucket 'machinery'
--     (subcarpeta facturas/), igual patrón que los formatos de requerimientos.
--   • prioridad   → 'alta' | 'media' | 'baja', NULL = sin prioridad (opcional).
alter table public.cuentas
  add column if not exists factura_url text,
  add column if not exists prioridad   text check (prioridad in ('alta', 'media', 'baja'));
create index if not exists cuentas_prioridad_idx on public.cuentas (prioridad);


-- ── 3) TABLA DE ABONOS (pagos parciales) ────────────────────────────────────
-- Una fila = un abono contra una cuenta. El SALDO de la cuenta es
-- `cuentas.monto − sum(cuenta_abonos.monto)`; se calcula en la app (mismo
-- criterio que el resto del proyecto, que suma los renglones en pantalla).
-- ON DELETE CASCADE: si se borra la cuenta, sus abonos no tienen sentido solos.
create table if not exists public.cuenta_abonos (
  id          uuid primary key default gen_random_uuid(),
  cuenta_id   uuid not null references public.cuentas(id) on delete cascade,
  monto       numeric(14,2) not null check (monto > 0),
  fecha       date not null default current_date,
  metodo      text,                                        -- efectivo / transferencia / cheque…
  referencia  text,                                        -- Nº de transferencia, cheque, etc.
  nota        text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);


-- ── 4) ÍNDICES ──────────────────────────────────────────────────────────────
-- El panel siempre filtra por tipo y por estado, y ordena por vencimiento
-- (lo más vencido arriba). Estos tres índices cubren esas consultas.
create index if not exists cuentas_tipo_estado_idx  on public.cuentas (tipo, estado);
create index if not exists cuentas_vencimiento_idx  on public.cuentas (fecha_vencimiento);
create index if not exists cuentas_created_idx      on public.cuentas (created_at desc);

-- Búsqueda/agrupación por contraparte y enlaces con los maestros.
create index if not exists cuentas_supplier_idx     on public.cuentas (supplier_id);
create index if not exists cuentas_company_idx      on public.cuentas (company_id);
create index if not exists cuentas_order_idx        on public.cuentas (order_id);

-- Los abonos SIEMPRE se leen por cuenta (para calcular el saldo).
create index if not exists cuenta_abonos_cuenta_idx on public.cuenta_abonos (cuenta_id);
create index if not exists cuenta_abonos_fecha_idx  on public.cuenta_abonos (fecha);


-- ── 5) RLS ──────────────────────────────────────────────────────────────────
-- Este módulo maneja DINERO, así que NO lleva la política laxa
-- `for all to authenticated using (true)` de los módulos operativos
-- (`lavado_maquinaria.sql`, `servicio_maquinaria_tabla_propia.sql`). Sigue el
-- patrón de las tablas de Compras — permiso por módulo — pero con la función
-- propia del punto 1, que cierra por defecto en vez de abrir por defecto.
--
--   LEER    → nivel lectura, escritura o full en el módulo 'cuentas'.
--   ESCRIBIR→ nivel escritura o full.
--   Sin permiso → no ve NADA (la tabla se comporta como si estuviera vacía).
alter table public.cuentas       enable row level security;
alter table public.cuenta_abonos enable row level security;

drop policy if exists cuentas_select on public.cuentas;
create policy cuentas_select on public.cuentas
  for select to authenticated
  using (public.cuentas_puede_leer());

drop policy if exists cuentas_write on public.cuentas;
create policy cuentas_write on public.cuentas
  for all to authenticated
  using (public.cuentas_puede_escribir())
  with check (public.cuentas_puede_escribir());

drop policy if exists cuenta_abonos_select on public.cuenta_abonos;
create policy cuenta_abonos_select on public.cuenta_abonos
  for select to authenticated
  using (public.cuentas_puede_leer());

drop policy if exists cuenta_abonos_write on public.cuenta_abonos;
create policy cuenta_abonos_write on public.cuenta_abonos
  for all to authenticated
  using (public.cuentas_puede_escribir())
  with check (public.cuentas_puede_escribir());

grant select, insert, update, delete on public.cuentas       to authenticated;
grant select, insert, update, delete on public.cuenta_abonos to authenticated;
grant execute on function public.cuentas_nivel()           to authenticated;
grant execute on function public.cuentas_puede_leer()      to authenticated;
grant execute on function public.cuentas_puede_escribir()  to authenticated;


-- ── 6) REALTIME ─────────────────────────────────────────────────────────────
-- Una tabla NO emite eventos si no está en la publicación `supabase_realtime`.
-- Sin esto el panel de Cuentas no se refrescaría solo cuando otro usuario
-- registra un abono. Idempotente: no falla si ya estaba publicada.
do $$
begin
  begin execute 'alter publication supabase_realtime add table public.cuentas';       exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.cuenta_abonos'; exception when others then null; end;
end $$;


-- ── 6b) NOTA PARA LA APP (no se ejecuta, es contrato) ───────────────────────
-- Con estas tablas en pie, `src/screens/CuentasScreen.tsx`:
--   • LEE `cuentas` y `cuenta_abonos` (y `suppliers` / `companies` para
--     RESOLVER EL NOMBRE de la contraparte, que en la base solo vive como id).
--     Nunca escribe en `suppliers`, `companies`, `purchase_orders` ni en
--     ninguna tabla de otro módulo.
--   • Al crear una cuenta, la contraparte se ELIGE de la lista (no se teclea):
--     proveedor si es 'por_pagar', empresa si es 'por_cobrar'.
--   • Calcula el SALDO en pantalla: monto − Σ abonos de esa cuenta.
--   • VENCIDA = estado 'pendiente' + `fecha_vencimiento` < hoy + saldo > 0.
--   • "Marcar como pagada" = UPDATE de `cuentas` poniendo estado = 'pagada',
--     settled_by y settled_at. No borra abonos ni toca la orden de compra.
--   • El permiso se llama 'cuentas' y NACE CERRADO en los dos lados: en la app
--     (`defaultLevel` de `src/lib/permissions.ts`) y en la base (punto 1).


-- ============================================================================
-- 7) VERIFICACIÓN — correr DESPUÉS de aplicar el script.
-- ============================================================================

-- 7.1 · Las columnas quedaron como se esperan.
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name in ('cuentas', 'cuenta_abonos')
order by table_name, ordinal_position;

-- 7.2 · Los CHECK de `tipo`, `estado` y los montos existen.
select rel.relname as tabla, con.conname, pg_get_constraintdef(con.oid) as definicion
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace ns on ns.oid = rel.relnamespace
where ns.nspname = 'public'
  and rel.relname in ('cuentas', 'cuenta_abonos')
  and con.contype = 'c'
order by rel.relname, con.conname;

-- 7.3 · Las FK apuntan a las tablas que ya existían (suppliers, companies,
--       purchase_orders, profiles) y ninguna es ON DELETE CASCADE salvo la de
--       abonos → cuenta.
select rel.relname as tabla, con.conname, pg_get_constraintdef(con.oid) as definicion
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace ns on ns.oid = rel.relnamespace
where ns.nspname = 'public'
  and rel.relname in ('cuentas', 'cuenta_abonos')
  and con.contype = 'f'
order by rel.relname, con.conname;

-- 7.4 · Los índices quedaron creados (6 en cuentas + 2 en cuenta_abonos,
--       más las PK).
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename in ('cuentas', 'cuenta_abonos')
order by tablename, indexname;

-- 7.5 · RLS activo en las dos tablas (debe devolver true en ambas).
select relname as tabla, relrowsecurity as rls_activo
from pg_class
where oid in ('public.cuentas'::regclass, 'public.cuenta_abonos'::regclass);

select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename in ('cuentas', 'cuenta_abonos')
order by tablename, policyname;

-- 7.6 · Las funciones de permiso del módulo existen.
select routine_name, data_type as retorna, security_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('cuentas_nivel', 'cuentas_puede_leer', 'cuentas_puede_escribir')
order by routine_name;

-- 7.7 · EL MÓDULO NACE CERRADO. Corriendo esto como un usuario NO admin y SIN
--       permiso de 'cuentas', debe devolver: none / false / false.
select public.cuentas_nivel()          as nivel,
       public.cuentas_puede_leer()     as puede_leer,
       public.cuentas_puede_escribir() as puede_escribir;

-- 7.8 · Las dos tablas están publicadas en realtime (debe devolver 2 filas).
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename in ('cuentas', 'cuenta_abonos')
order by tablename;

-- 7.9 · Conteo inicial por tipo y estado (recién creadas: 0 filas).
select tipo, estado, count(*) as total, coalesce(sum(monto), 0) as monto_total
from public.cuentas
group by tipo, estado
order by tipo, estado;

-- 7.10 · CONTROL DE NO-INVASIÓN: este script no tocó nada de lo que ya existía.
--        Los conteos deben ser IDÉNTICOS a los de antes de correrlo.
select 'suppliers'       as tabla, count(*) as filas from public.suppliers
union all select 'companies',       count(*) from public.companies
union all select 'purchase_orders', count(*) from public.purchase_orders
union all select 'purchase_requests', count(*) from public.purchase_requests;

-- 7.11 · Vista rápida del saldo (así es como la app lo calcula). El nombre de
--        la contraparte sale por JOIN — en la tabla solo vive el id.
--        Recién creado devuelve 0 filas; sirve para probar con datos de prueba.
select c.tipo,
       coalesce(s.name, e.name)            as contraparte,
       c.concepto, c.monto, c.moneda,
       c.fecha_vencimiento, c.estado,
       coalesce(sum(a.monto), 0)           as abonado,
       c.monto - coalesce(sum(a.monto), 0) as saldo,
       (c.estado = 'pendiente'
        and c.fecha_vencimiento is not null
        and c.fecha_vencimiento < current_date
        and c.monto - coalesce(sum(a.monto), 0) > 0) as vencida
from public.cuentas c
left join public.suppliers s on s.id = c.supplier_id
left join public.companies e on e.id = c.company_id
left join public.cuenta_abonos a on a.cuenta_id = c.id
group by c.id, s.name, e.name
order by c.fecha_vencimiento nulls last;

-- 7.12 · INTEGRIDAD DE LA CONTRAPARTE: el CHECK impide filas huérfanas o
--        contradictorias. Esta consulta debe devolver SIEMPRE 0 filas.
select id, tipo, supplier_id, company_id
from public.cuentas
where (tipo = 'por_pagar'  and (supplier_id is null or company_id  is not null))
   or (tipo = 'por_cobrar' and (company_id  is null or supplier_id is not null));


-- ============================================================================
-- 8) DESHACER (rollback manual) — descomentar y correr SOLO si hay que revertir.
--    Borra las dos tablas nuevas, sus datos y las tres funciones nuevas.
--    NO toca `suppliers`, `companies`, `purchase_orders`, `purchase_requests`,
--    `profiles`, `module_permissions` ni `app_roles` porque este script nunca
--    los modificó.
-- ============================================================================
-- do $$
-- begin
--   begin execute 'alter publication supabase_realtime drop table public.cuenta_abonos'; exception when others then null; end;
--   begin execute 'alter publication supabase_realtime drop table public.cuentas';       exception when others then null; end;
-- end $$;
--
-- drop table if exists public.cuenta_abonos cascade;
-- drop table if exists public.cuentas       cascade;
--
-- drop function if exists public.cuentas_puede_escribir();
-- drop function if exists public.cuentas_puede_leer();
-- drop function if exists public.cuentas_nivel();
