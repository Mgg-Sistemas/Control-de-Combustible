-- ============================================================================
-- DIAGNÓSTICO — «el listero dice que registró 7 viajes y el sistema muestra 4»
--
-- 👉 CÓMO SE CORRE: copiar ESTE ARCHIVO COMPLETO, pegarlo en Supabase → SQL
--    Editor y darle RUN. Devuelve UNA SOLA tabla larga, dividida en bloques.
--
-- 🟢 ES SOLO DE LECTURA. No hay un solo insert, update, delete, alter ni create
--    en todo el archivo: es UNA consulta. Se puede correr las veces que haga
--    falta, en horario pico, sin riesgo y sin respaldo previo.
--
-- ⚠️ AJUSTAR ANTES DE CORRER: el nombre y las fechas, en el bloque 0 de abajo.
--    Por defecto busca «cardona» en los últimos 15 días.
--
-- CÓMO SE LEE
-- ---------------------------------------------------------------------------
-- Cada bloque descarta o confirma UNA causa distinta, para que al final quede
-- una sola en pie. Los renglones marcados con ⚠️ son los que hay que mirar.
--
--   1 · ¿Cuántos viajes hay de verdad?            → ¿faltan, o se están filtrando?
--   2 · ¿De qué días son?                          → ¿se está mirando otro día?
--  ⭐2b· LOS MISMOS, contados por JORNADA          → la noche partida a medianoche
--   3 · ¿El listero tiene DOS cuentas?             → 7 = 4 + 3 en dos renglones
--   4 · ¿Los viajes de la noche cambian de día?    → zona horaria
--   5 · ¿Llegaron tarde desde el teléfono?         → registró sin señal
--   6 · ¿Alguien los borró?                        → bitácora
--   7 · El detalle crudo, para cotejar con su libreta
--   8 · ¿La app tragó viajes por repetir la llave de la cola?
--   9 · Los demás listeros, para saber si el problema es de él o de todos
-- ============================================================================

with

-- ── 0) PARÁMETROS — cambiar SOLO esto ───────────────────────────────────────
-- El nombre se busca por pedazo y sin distinguir mayúsculas, así que 'cardona'
-- encuentra "Junior Cardona", "JUNIOR CARDONA" y "junior  cardona ".
p as (
  select
    'cardona'::text                     as nombre,
    (current_date - interval '15 days') as desde,
    (current_date + interval '1 day')   as hasta
),

-- Venezuela es UTC-4 y `registered_at` se guarda en UTC. La conversión se hace
-- UNA vez aquí para que ningún bloque compare fechas en la zona equivocada.
v as (
  select
    cv.*,
    (cv.registered_at at time zone 'America/Caracas') as reg_local,
    (cv.created_at    at time zone 'America/Caracas') as crea_local
  from public.camion_viajes cv, p
  where cv.listero_name ilike '%' || p.nombre || '%'
    and cv.registered_at >= p.desde
    and cv.registered_at <  p.hasta
),

bloques as (

  -- ── 1) EL TOTAL ───────────────────────────────────────────────────────────
  -- Si aquí sale 7, NO se perdió nada: el problema es de filtro o de pantalla.
  -- Si sale 4, sí faltan 3 y hay que seguir bajando.
  select 1::numeric as n, 0::numeric as orden,
    '1 · TOTAL'                                        as bloque,
    'Viajes encontrados en el período'                 as dato,
    count(*)::text                                     as valor,
    'cuentas distintas: ' || count(distinct listero_id)::text as detalle_1,
    coalesce('del ' || to_char(min(reg_local), 'DD/MM') || ' al ' || to_char(max(reg_local), 'DD/MM'), 'sin viajes') as detalle_2,
    ''                                                 as detalle_3
  from v

  union all

  -- ── 2) DÍA POR DÍA ────────────────────────────────────────────────────────
  -- Para ubicar el día exacto del que habla el cliente. Si algún día suma 7,
  -- el sistema SÍ los tiene y se están mirando dos días distintos.
  select 2, -extract(epoch from date_trunc('day', reg_local)),
    '2 · Por día',
    to_char(reg_local, 'DD/MM/YYYY'),
    count(*)::text || ' viajes',
    'día: ' || (count(*) filter (where shift = 'day'))::text
      || ' · noche: ' || (count(*) filter (where shift = 'night'))::text
      || ' · sin turno: ' || (count(*) filter (where shift is null))::text,
    'camiones: ' || string_agg(distinct machine_code, ', ' order by machine_code),
    ''
  from v
  group by date_trunc('day', reg_local), to_char(reg_local, 'DD/MM/YYYY')

  union all

  -- ── 2b) LOS MISMOS VIAJES, PERO CONTADOS POR JORNADA ──────────────────────
  -- ⭐ ESTE ES EL BLOQUE CLAVE si el listero trabaja de noche.
  --
  -- La pantalla y el reporte cortan el día a MEDIANOCHE (calendario), pero una
  -- jornada de noche va de 7pm a 7am, o sea que se parte en dos días distintos.
  -- Una noche de 7 viajes con 4 antes de las 12 y 3 después SE VE COMO «4 hoy»
  -- y «3 mañana», y el listero cuenta 7 porque para él fue una sola noche.
  --
  -- Acá se recuentan atribuyendo la madrugada a la noche que la originó.
  -- ⚠️ Si en este bloque aparece un renglón con 7 y en el bloque 2 no, ESA es la
  --    explicación: no se perdió ningún viaje, están contados en dos días.
  select 2.5, -extract(epoch from date_trunc('day', reg_local - interval '7 hours')),
    '2b · Por JORNADA (7am–7am)',
    'jornada del ' || to_char(date_trunc('day', reg_local - interval '7 hours'), 'DD/MM/YYYY'),
    count(*)::text || ' viajes',
    'antes de medianoche: ' || (count(*) filter (where extract(hour from reg_local) >= 7))::text
      || ' · madrugada: ' || (count(*) filter (where extract(hour from reg_local) < 7))::text,
    'días de calendario que abarca: '
      || count(distinct reg_local::date)::text,
    ''
  from v
  group by date_trunc('day', reg_local - interval '7 hours')

  union all

  -- ── 3) ¿DOS CUENTAS PARA LA MISMA PERSONA? ────────────────────────────────
  -- Causa clásica: un usuario viejo y uno nuevo, o el teléfono con una sesión y
  -- la web con otra. El reporte agrupa por CUENTA, así que 7 viajes se ven
  -- como 4 + 3 en dos renglones separados.
  -- ⚠️ Si aquí sale MÁS DE UNA fila, esta es casi seguro la explicación.
  select 3, -count(*)::numeric,
    '3 · Cuentas',
    v.listero_name,
    count(*)::text || ' viajes',
    'perfil actual: ' || coalesce(pr.full_name, '⚠️ el perfil YA NO EXISTE'),
    'cédula: ' || coalesce(pr.cedula, '—') || ' · rol: ' || coalesce(pr.role, '—'),
    v.listero_id::text
  from v
  left join public.profiles pr on pr.id = v.listero_id
  group by v.listero_name, v.listero_id, pr.full_name, pr.cedula, pr.role

  union all

  -- ── 4) LA ZONA HORARIA ────────────────────────────────────────────────────
  -- Un viaje de las 8 de la noche en Venezuela son las 00:00 UTC del DÍA
  -- SIGUIENTE. Si un filtro compara fechas sin convertir, esos viajes se van al
  -- día que no es.
  -- ⚠️ Cada 'SÍ' en `detalle_1` es un viaje que un filtro en UTC contaría mal.
  select 4, extract(epoch from registered_at),
    '4 · Hora y zona horaria',
    to_char(reg_local, 'DD/MM HH24:MI') || ' (Venezuela)',
    to_char(registered_at at time zone 'UTC', 'DD/MM HH24:MI') || ' (UTC)',
    'cambia de día: ' || case
      when reg_local::date <> (registered_at at time zone 'UTC')::date then 'SÍ ⚠️' else 'no' end,
    'turno guardado: ' || coalesce(shift, '—') || ' · por la hora: ' || case
      when extract(hour from reg_local) >= 19 or extract(hour from reg_local) < 7
        then 'noche' else 'día' end,
    machine_code
  from v

  union all

  -- ── 5) VIAJES QUE LLEGARON TARDE (registró sin señal) ─────────────────────
  -- `registered_at` es la hora del TOQUE en el teléfono; `created_at` es cuándo
  -- llegó de verdad a la base. Si hay días de diferencia, ese teléfono trabaja
  -- sin datos — y los viajes que nunca sincronizaron NO SALEN EN NINGÚN BLOQUE
  -- porque siguen guardados en el teléfono.
  select 5, -extract(epoch from (created_at - registered_at)),
    '5 · Sincronización',
    'tocó el botón: ' || to_char(reg_local, 'DD/MM HH24:MI'),
    'llegó al sistema: ' || to_char(crea_local, 'DD/MM HH24:MI'),
    case
      when created_at - registered_at < interval '2 minutes' then 'al instante'
      when created_at - registered_at < interval '1 hour'    then 'minutos'
      when created_at - registered_at < interval '1 day'     then 'HORAS ⚠️'
      else 'DÍAS ⚠️⚠️'
    end,
    machine_code,
    ''
  from v

  union all

  -- ── 6) ¿ALGUIEN BORRÓ VIAJES? ─────────────────────────────────────────────
  -- `camion_viajes` tiene bitácora desde que nació. Se filtra por ACCIÓN a
  -- propósito: sin ese filtro salen también los INSERT y el bloque no dice nada.
  -- ⚠️ Si aquí salen 3 renglones DELETE del día en cuestión, ahí está la
  --    respuesta — y con nombre y apellido de quién lo hizo.
  select 6, -extract(epoch from a.at),
    '6 · Borrados y ediciones',
    to_char(a.at at time zone 'America/Caracas', 'DD/MM HH24:MI'),
    a.action,
    'lo hizo: ' || coalesce(a.user_name, '(sin sesión / cron)'),
    'viaje: ' || a.row_id,
    ''
  from public.audit_log a, p
  where a.table_name = 'camion_viajes'
    and a.action in ('DELETE', 'UPDATE')
    and a.at >= p.desde

  union all

  -- 6-bis) CONTROL: si el trigger estuviera apagado, el bloque 6 saldría vacío
  -- aunque SÍ hubieran borrado. Esto distingue «no borró nadie» de «no se sabe».
  select 7, 0,
    '6b · ¿La bitácora está encendida?',
    tgname,
    case tgenabled
      when 'O' then 'ENCENDIDO ✅'
      when 'D' then 'APAGADO ❌ — el bloque 6 no prueba nada'
      else tgenabled::text
    end,
    '', '', ''
  from pg_trigger
  where tgrelid = 'public.camion_viajes'::regclass and not tgisinternal

  union all

  -- ── 7) EL DETALLE CRUDO ───────────────────────────────────────────────────
  -- La lista viaje por viaje para cotejarla con la libreta del listero. Aquí se
  -- ve si alguno quedó anotado al camión equivocado o a mano.
  select 8, extract(epoch from registered_at),
    '7 · Detalle',
    to_char(reg_local, 'DD/MM HH24:MI'),
    machine_code,
    case when fuera_catalogo then 'a mano (fuera de catálogo)' else 'del catálogo' end,
    'chofer: ' || coalesce(chofer_name, '—') || ' · estado: ' || coalesce(estado_maquina, '—'),
    coalesce(note, '')
  from v

  union all

  -- ── 8) LA LLAVE DE LA COLA OFFLINE ────────────────────────────────────────
  -- La cola sin señal manda un `client_action_id` para no duplicar. Si dos
  -- viajes DISTINTOS salieran con la MISMA llave, el segundo se rechazaría en
  -- silencio y el listero creería que lo registró.
  -- ⚠️ Que haya viajes sin llave es normal (se registraron con señal). Lo que
  --    NO puede pasar es que `llaves distintas` sea menor que `con llave`.
  select 9, 0,
    '8 · Llave de la cola offline',
    count(*)::text || ' viajes',
    'con llave: ' || count(client_action_id)::text
      || ' · sin llave: ' || (count(*) - count(client_action_id))::text,
    'llaves distintas: ' || count(distinct client_action_id)::text,
    case when count(distinct client_action_id) = count(client_action_id)
         then 'sin choques ✅' else 'HAY CHOQUES ❌' end,
    ''
  from v

  union all

  -- ── 9) LOS DEMÁS LISTEROS ─────────────────────────────────────────────────
  -- Para saber si el problema es de ESTE listero o de todo el módulo.
  select 10, -count(*)::numeric,
    '9 · Todos los listeros del período',
    cv.listero_name,
    count(*)::text || ' viajes',
    'días con registro: ' || count(distinct (cv.registered_at at time zone 'America/Caracas')::date)::text,
    '', ''
  from public.camion_viajes cv, p
  where cv.registered_at >= p.desde and cv.registered_at < p.hasta
  group by cv.listero_name
)

select bloque, dato, valor, detalle_1, detalle_2, detalle_3
from bloques
order by n, orden, dato;
