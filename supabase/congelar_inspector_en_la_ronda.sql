-- ============================================================================
-- CONGELAR EL INSPECTOR DENTRO DE LA RONDA  (17-ago-2026)
--
-- EL PROBLEMA
-- -----------
-- `machine_inspectors` guarda SOLO el estado de HOY: qué máquina tiene asignada
-- cada inspector ahora mismo. No tiene fechas de "desde/hasta". Por eso, cuando
-- se le reasignan las máquinas a alguien, TODOS los reportes que atribuyen por
-- asignación reescriben el pasado: las horas de ayer aparecen bajo el inspector
-- nuevo, y el que de verdad cubrió el turno desaparece.
--
-- Eso descuadra dos documentos que deberían decir lo mismo:
--   · Inspectores → reporte diario ....... usa la asignación ACTUAL
--   · Reportes → Reporte por inspector ... usa los check-in (supervisor_visits)
--
-- LA SOLUCIÓN
-- -----------
-- Guardar en CADA RONDA quién era el inspector de esa máquina ese día, por
-- turno. Una vez escrito, reasignar la máquina ya no toca el pasado.
--
--   machine_rounds.inspector_day    ← quién la tenía en el turno de DÍA
--   machine_rounds.inspector_night  ← quién la tenía en el turno de NOCHE
--
-- Son DOS columnas porque una misma máquina puede tener un inspector de día y
-- otro de noche el mismo día. Se guarda el NOMBRE (no un id) porque es la llave
-- con la que ya trabajan `machine_inspectors.inspector_name` y
-- `supervisor_visits.supervisor_name`, y así los tres hablan el mismo idioma.
--
-- LO VIEJO NO SE PIERDE
-- ---------------------
-- La historia real YA EXISTE en `supervisor_visits`: cada check-in guarda quién
-- lo hizo y a qué hora, congelado desde siempre. El relleno la copia a las
-- rondas. Solo donde NO hubo ningún check-in se cae a la asignación actual, que
-- es lo mejor disponible — y esas filas quedan marcadas para que se sepa.
--
-- ⚠️ AFECTA PAGOS. Correr BLOQUE POR BLOQUE, en orden, leyendo cada resultado.
--    El editor de Supabase solo muestra el resultado de la última consulta.
--    Los bloques 1 y 2 son de solo lectura: pégalos y míralos con calma.
-- ============================================================================
set time zone 'America/Caracas';


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 1 · ¿CUÁNTA HISTORIA SE PUEDE RECUPERAR?  (solo lectura)
-- ════════════════════════════════════════════════════════════════════════════
-- Por día: cuántas rondas hay, para cuántas existe un check-in que diga quién
-- estuvo de verdad, y cuántas van a tener que caer a la asignación actual.
with visitas as (
  -- UNA fila por (máquina, día). NO se agrupa por turno a propósito: si se
  -- agrupara, una máquina revisada de día Y de noche daría DOS filas, el LEFT
  -- JOIN de abajo contaría esa ronda dos veces y tanto `rondas` como el
  -- porcentaje saldrían inflados. (Error detectado el 17-ago-2026 al ver que la
  -- suma de 60 días daba 11.137 rondas y el respaldo COMPLETO de la tabla solo
  -- 9.735 — imposible.) El bloque 5, que sí escribe, nunca tuvo este problema:
  -- colapsa con `group by r.id` antes de actualizar.
  select distinct sv.machinery_id, sv.visit_date
  from public.supervisor_visits sv
)
select
  r.round_date,
  count(*)                                                     as rondas,
  count(*) filter (where v.machinery_id is not null)           as con_historia_real,
  count(*) filter (where v.machinery_id is null)               as sin_check_in,
  round(100.0 * count(*) filter (where v.machinery_id is not null) / nullif(count(*), 0), 1) as pct_recuperable
from public.machine_rounds r
left join visitas v
       on v.machinery_id = r.machinery_id
      and v.visit_date   = r.round_date
where r.round_date >= (current_date - 60)
group by r.round_date
order by r.round_date desc;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 2 · CÓMO QUEDARÍA UN DÍA CONCRETO  (solo lectura, no escribe nada)
-- ════════════════════════════════════════════════════════════════════════════
-- Cambia la fecha y mira máquina por máquina qué nombre se va a congelar y de
-- dónde sale. REVISA ESTO ANTES DE APLICAR.
with visitas as (
  select
    sv.machinery_id, sv.visit_date,
    case when extract(hour from (sv.visited_at at time zone 'America/Caracas')) between 7 and 18
         then 'day' else 'night' end as turno,
    -- Si dos personas marcaron la misma máquina en el mismo turno, gana quien
    -- hizo MÁS check-in; a igualdad, el primero. No se inventa un empate.
    sv.supervisor_name,
    count(*) as marcas,
    min(sv.visited_at) as primera
  from public.supervisor_visits sv
  where sv.supervisor_name is not null and btrim(sv.supervisor_name) <> ''
  group by 1, 2, 3, 4
),
ganador as (
  select distinct on (machinery_id, visit_date, turno)
         machinery_id, visit_date, turno, supervisor_name
  from visitas
  order by machinery_id, visit_date, turno, marcas desc, primera asc
)
select
  m.code                                        as maquina,
  r.round_date,
  coalesce(gd.supervisor_name, mid.inspector_name) as inspector_dia,
  case when gd.supervisor_name is not null then 'check-in (historia real)'
       when mid.inspector_name is not null then 'asignación de hoy (aproximado)'
       else 'sin dato' end                      as origen_dia,
  coalesce(gn.supervisor_name, min_.inspector_name) as inspector_noche,
  case when gn.supervisor_name is not null then 'check-in (historia real)'
       when min_.inspector_name is not null then 'asignación de hoy (aproximado)'
       else 'sin dato' end                      as origen_noche
from public.machine_rounds r
join public.machinery m on m.id = r.machinery_id
left join ganador gd on gd.machinery_id = r.machinery_id and gd.visit_date = r.round_date and gd.turno = 'day'
left join ganador gn on gn.machinery_id = r.machinery_id and gn.visit_date = r.round_date and gn.turno = 'night'
left join public.machine_inspectors mid  on mid.machinery_id  = r.machinery_id and mid.shift  = 'day'   and mid.active  = true
left join public.machine_inspectors min_ on min_.machinery_id = r.machinery_id and min_.shift = 'night' and min_.active = true
where r.round_date = date '2026-08-16'          -- ← la fecha a revisar
order by m.code;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 3 · RESPALDO — obligatorio antes de escribir
-- ════════════════════════════════════════════════════════════════════════════
-- Copia COMPLETA de machine_rounds. El bloque 8 la usa para volver atrás.
create table if not exists public.backup_rounds_congelar_20260817 as
select r.*, now() as respaldado_en from public.machine_rounds r;

-- Verifica que tenga filas ANTES de seguir:
select count(*) as filas_respaldadas from public.backup_rounds_congelar_20260817;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 4 · LAS COLUMNAS NUEVAS  (aditivo: no toca ni un dato existente)
-- ════════════════════════════════════════════════════════════════════════════
-- Nacen en NULL. Mientras estén en NULL, la app se sigue comportando como hoy
-- (cae a la asignación actual), así que este bloque por sí solo NO cambia nada
-- de lo que se ve en pantalla. Es seguro correrlo y detenerse aquí.
alter table public.machine_rounds add column if not exists inspector_day   text;
alter table public.machine_rounds add column if not exists inspector_night text;

comment on column public.machine_rounds.inspector_day   is
  'Inspector del turno de DÍA de esta máquina ESE día, congelado. Se escribe una vez y no se toca al reasignar: es la historia. NULL = todavía sin congelar, la app cae a machine_inspectors.';
comment on column public.machine_rounds.inspector_night is
  'Igual que inspector_day, para el turno de NOCHE.';

-- Para filtrar reportes por inspector sin recorrer la tabla entera.
create index if not exists machine_rounds_inspector_day_idx
  on public.machine_rounds (round_date, inspector_day)   where inspector_day   is not null;
create index if not exists machine_rounds_inspector_night_idx
  on public.machine_rounds (round_date, inspector_night) where inspector_night is not null;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 4b · ENSAYO EN SECO — escribe y se deshace solo  (opcional)
-- ════════════════════════════════════════════════════════════════════════════
-- Para verlo funcionar SIN comprometerse. Hace el relleno de verdad dentro de
-- una transacción, te muestra cuántas filas quedarían con inspector y con qué
-- nombres, y al final hace ROLLBACK: la base queda EXACTAMENTE como estaba.
--
-- Pégalo COMPLETO de una vez (desde el `begin;` hasta el `rollback;`). Si lo
-- corres por pedazos, la transacción queda abierta y el `rollback` no llega.
--
-- Requiere haber corrido el BLOQUE 4 (las columnas tienen que existir).
begin;

  with visitas as (
    select
      sv.machinery_id, sv.visit_date,
      case when extract(hour from (sv.visited_at at time zone 'America/Caracas')) between 7 and 18
           then 'day' else 'night' end as turno,
      sv.supervisor_name,
      count(*) as marcas,
      min(sv.visited_at) as primera
    from public.supervisor_visits sv
    where sv.supervisor_name is not null and btrim(sv.supervisor_name) <> ''
    group by 1, 2, 3, 4
  ),
  ganador as (
    select distinct on (machinery_id, visit_date, turno)
           machinery_id, visit_date, turno, supervisor_name
    from visitas
    order by machinery_id, visit_date, turno, marcas desc, primera asc
  ),
  porRonda as (
    select r.id,
           max(case when g.turno = 'day'   then g.supervisor_name end) as insp_dia,
           max(case when g.turno = 'night' then g.supervisor_name end) as insp_noche
    from public.machine_rounds r
    join ganador g on g.machinery_id = r.machinery_id and g.visit_date = r.round_date
    group by r.id
  )
  update public.machine_rounds r
     set inspector_day   = coalesce(r.inspector_day,   p.insp_dia),
         inspector_night = coalesce(r.inspector_night, p.insp_noche)
    from porRonda p
   where p.id = r.id
     and (r.inspector_day is null or r.inspector_night is null);

  -- Cómo quedaría, día por día:
  select round_date,
         count(*)               as rondas,
         count(inspector_day)   as quedarian_con_inspector_dia,
         count(inspector_night) as quedarian_con_inspector_noche
  from public.machine_rounds
  where round_date >= (current_date - 15)
  group by round_date order by round_date desc;

rollback;   -- ← NADA de lo de arriba queda. Vuelve todo a como estaba.

-- Después del rollback, esto DEBE dar 0 en las dos columnas (comprueba que el
-- ensayo no dejó rastro). Córrelo aparte, ya fuera de la transacción:
--   select count(inspector_day) as dia, count(inspector_night) as noche
--   from public.machine_rounds;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 5 · RELLENO 1/2 — LA HISTORIA REAL, desde los check-in
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ ESTO SÍ ESCRIBE. Solo rellena lo que esté en NULL: nunca pisa un valor ya
--    congelado, así que se puede correr más de una vez sin hacer daño.
with visitas as (
  select
    sv.machinery_id, sv.visit_date,
    case when extract(hour from (sv.visited_at at time zone 'America/Caracas')) between 7 and 18
         then 'day' else 'night' end as turno,
    sv.supervisor_name,
    count(*) as marcas,
    min(sv.visited_at) as primera
  from public.supervisor_visits sv
  where sv.supervisor_name is not null and btrim(sv.supervisor_name) <> ''
  group by 1, 2, 3, 4
),
ganador as (
  select distinct on (machinery_id, visit_date, turno)
         machinery_id, visit_date, turno, supervisor_name
  from visitas
  order by machinery_id, visit_date, turno, marcas desc, primera asc
),
porRonda as (
  select r.id,
         max(case when g.turno = 'day'   then g.supervisor_name end) as insp_dia,
         max(case when g.turno = 'night' then g.supervisor_name end) as insp_noche
  from public.machine_rounds r
  join ganador g on g.machinery_id = r.machinery_id and g.visit_date = r.round_date
  group by r.id
)
update public.machine_rounds r
   set inspector_day   = coalesce(r.inspector_day,   p.insp_dia),
       inspector_night = coalesce(r.inspector_night, p.insp_noche)
  from porRonda p
 where p.id = r.id
   and (r.inspector_day is null or r.inspector_night is null);


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 6 · RELLENO 2/2 — lo que no tuvo check-in, desde la asignación de hoy
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ ESCRIBE. Esto es lo MEJOR DISPONIBLE, no la verdad: si esa máquina fue
--    reasignada desde entonces, congelará al inspector equivocado. Por eso va
--    DESPUÉS del bloque 5, que ya tomó todo lo que sí era historia real.
--
--    Si prefieres NO aproximar y dejar esas filas en NULL, SÁLTATE este bloque:
--    la app cae sola a la asignación actual, que da el mismo resultado, con la
--    ventaja de que no queda escrito como si fuera un hecho.
update public.machine_rounds r
   set inspector_day = mi.inspector_name
  from public.machine_inspectors mi
 where mi.machinery_id = r.machinery_id
   and mi.shift = 'day' and mi.active = true
   and r.inspector_day is null;

update public.machine_rounds r
   set inspector_night = mi.inspector_name
  from public.machine_inspectors mi
 where mi.machinery_id = r.machinery_id
   and mi.shift = 'night' and mi.active = true
   and r.inspector_night is null;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 7 · QUE SE CONGELE SOLO DE AQUÍ EN ADELANTE
-- ════════════════════════════════════════════════════════════════════════════
-- Al crear una ronda, se estampa la asignación vigente EN ESE MOMENTO. Después
-- nadie la mueve: el trigger solo actúa en INSERT y solo si viene en NULL.
create or replace function public.stamp_inspector_en_ronda()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.inspector_day is null then
    select mi.inspector_name into new.inspector_day
    from public.machine_inspectors mi
    where mi.machinery_id = new.machinery_id and mi.shift = 'day' and mi.active = true
    limit 1;
  end if;
  if new.inspector_night is null then
    select mi.inspector_name into new.inspector_night
    from public.machine_inspectors mi
    where mi.machinery_id = new.machinery_id and mi.shift = 'night' and mi.active = true
    limit 1;
  end if;
  return new;
end $$;

drop trigger if exists trg_stamp_inspector_en_ronda on public.machine_rounds;
create trigger trg_stamp_inspector_en_ronda
  before insert on public.machine_rounds
  for each row execute function public.stamp_inspector_en_ronda();


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 8 · VERIFICACIÓN  (solo lectura)
-- ════════════════════════════════════════════════════════════════════════════
-- (a) Cobertura por día: cuántas rondas quedaron con inspector congelado.
select round_date,
       count(*)                                          as rondas,
       count(inspector_day)                              as con_inspector_dia,
       count(inspector_night)                            as con_inspector_noche
from public.machine_rounds
where round_date >= (current_date - 15)
group by round_date order by round_date desc;

-- (b) Horas del 16/08 por inspector CONGELADO — compáralas con lo que muestran
--     el reporte diario de Inspectores y el Reporte por inspector. Deben coincidir.
select coalesce(inspector_day, '(sin inspector)') as inspector,
       count(*)                                   as maquinas,
       round(sum(coalesce(day_hours, 0))::numeric, 2) as horas_dia
from public.machine_rounds
where round_date = date '2026-08-16'
group by 1 order by 3 desc;

select coalesce(inspector_night, '(sin inspector)') as inspector,
       count(*)                                     as maquinas,
       round(sum(coalesce(night_hours, 0))::numeric, 2) as horas_noche
from public.machine_rounds
where round_date = date '2026-08-16'
group by 1 order by 3 desc;

-- (c) El trigger quedó puesto:
select tgname, tgenabled from pg_trigger where tgname = 'trg_stamp_inspector_en_ronda';


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 9 · DESHACER  (solo si algo salió mal)
-- ════════════════════════════════════════════════════════════════════════════
-- Volver los datos como estaban (las columnas nuevas se quedan, vacías):
-- update public.machine_rounds r
--    set inspector_day = null, inspector_night = null;
--
-- Quitar el automatismo:
-- drop trigger if exists trg_stamp_inspector_en_ronda on public.machine_rounds;
-- drop function if exists public.stamp_inspector_en_ronda();
--
-- Quitar las columnas del todo (⚠️ pierde lo congelado):
-- alter table public.machine_rounds drop column if exists inspector_day;
-- alter table public.machine_rounds drop column if exists inspector_night;
--
-- Restaurar TODA la tabla desde el respaldo del bloque 3:
-- update public.machine_rounds r
--    set day_hours = b.day_hours, night_hours = b.night_hours,
--        jornada_start_at = b.jornada_start_at, status = b.status
--   from public.backup_rounds_congelar_20260817 b
--  where b.id = r.id;
