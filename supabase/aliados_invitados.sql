-- ============================================================================
-- ALIADOS · APARTADO "INVITADOS" — 2026-09-12
--
-- Pedido del cliente: en Aliados, un apartado con la MISMA información pero cuyo
-- carnet diga "INVITADO" y lleve la empresa GOLDEN TOUCH 1127. Los invitados
-- tienen su PROPIA numeración de ficha, empezando en 0001 (secuencial).
--
-- Cambios:
--   1) `aliados.tipo`: 'aliado' (por defecto) | 'invitado'. Distingue el apartado.
--   2) N° de ficha por TIPO: los invitados numeran 0001, 0002… (secuencial); los
--      aliados siguen con su 4 dígitos ALEATORIO único (como hasta ahora).
--   3) Unicidad de ficha AHORA por (tipo, ficha) → aliado 0001 e invitado 0001
--      pueden coexistir sin chocar.
--
-- Idempotente. Correr en Supabase → SQL Editor.
-- ============================================================================

-- ── 1) Columna tipo ─────────────────────────────────────────────────────────
alter table public.aliados
  add column if not exists tipo text not null default 'aliado';
-- Los registros existentes quedan como 'aliado' (default). Endurecemos el dominio:
alter table public.aliados drop constraint if exists aliados_tipo_check;
alter table public.aliados
  add constraint aliados_tipo_check check (tipo in ('aliado', 'invitado'));

-- ── 2) Unicidad de ficha POR TIPO ───────────────────────────────────────────
-- (antes era global; ahora aliado 0001 e invitado 0001 no colisionan)
drop index if exists public.uq_aliados_ficha;
create unique index if not exists uq_aliados_ficha
  on public.aliados (coalesce(tipo, 'aliado'), lower(btrim(ficha_number)))
  where ficha_number is not null and btrim(ficha_number) <> '';

-- ── 3) Trigger de asignación de ficha según el tipo ─────────────────────────
create or replace function public.set_aliado_ficha() returns trigger language plpgsql as $fn$
declare cand text; tries int := 0; n int;
begin
  if new.ficha_number is null or btrim(new.ficha_number) = '' then
    if coalesce(new.tipo, 'aliado') = 'invitado' then
      -- INVITADOS: numeración propia y SECUENCIAL, empezando en 0001.
      -- Advisory lock: dos altas simultáneas no calculan el mismo máximo.
      perform pg_advisory_xact_lock(hashtext('aliados_invitado_ficha'));
      select coalesce(max((regexp_replace(ficha_number, '\D', '', 'g'))::int), 0) + 1
        into n
        from public.aliados
        where coalesce(tipo, 'aliado') = 'invitado' and ficha_number ~ '^[0-9]+$';
      new.ficha_number := lpad(n::text, 4, '0');
    else
      -- ALIADOS: 4 dígitos ALEATORIO único (comportamiento de siempre).
      loop
        cand := lpad((floor(random() * 10000))::int::text, 4, '0');
        exit when not exists (
          select 1 from public.aliados
          where coalesce(tipo, 'aliado') <> 'invitado' and ficha_number = cand
        );
        tries := tries + 1;
        if tries > 300 then
          select lpad(g::text, 4, '0') into cand
            from generate_series(0, 9999) g
           where not exists (
             select 1 from public.aliados a
             where coalesce(a.tipo, 'aliado') <> 'invitado'
               and a.ficha_number = lpad(g::text, 4, '0'))
           order by g limit 1;
          exit;
        end if;
      end loop;
      new.ficha_number := cand;
    end if;
  end if;
  return new;
end $fn$;

drop trigger if exists trg_aliado_ficha on public.aliados;
create trigger trg_aliado_ficha before insert on public.aliados
  for each row execute function public.set_aliado_ficha();

-- ── 4) VERIFICACIÓN ─────────────────────────────────────────────────────────
select 'columna tipo' as chequeo,
       exists(select 1 from information_schema.columns
              where table_schema='public' and table_name='aliados' and column_name='tipo') as ok
union all
select 'indice unico por tipo',
       exists(select 1 from pg_indexes where schemaname='public' and indexname='uq_aliados_ficha');

-- Conteo por tipo (referencia).
select coalesce(tipo,'aliado') as tipo, count(*) from public.aliados group by 1 order by 1;
