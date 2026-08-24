with base as (
  select
    m.id, m.code, m.plate, m.serial, m.clasificacion, m.tipo, m.marca, m.modelo,
    m.company_id, m.operational, m.en_espera,
    -- Sin acentos y en minúscula: en el catálogo conviven «CAMIÓN» y «CAMION».
    translate(lower(coalesce(m.code, '')), 'áéíóúü', 'aeiouu') as c_code,
    translate(lower(concat_ws(' ', m.clasificacion, m.tipo, m.marca, m.modelo, m.machinery_type)),
              'áéíóúü', 'aeiouu') as c_ficha
  from public.machinery m
  where m.active = true          -- las eliminadas del catálogo no cuentan
),
marcado as (
  select b.*,
    -- LA REGLA DE HOY, calcada de src/lib/equipos.ts:
    (b.c_code like '%volteo%' or b.c_code like '%volqueta%' or b.c_code like '%toronto%') as en_la_lista,
    -- Lo que PARECE un camión mirando toda la ficha, no solo el código.
    (b.c_code  ~ '(camion|volteo|volqueta|chuto|gandola|batea|tumba|dump|kodiak)'
     or b.c_ficha ~ '(camion|volteo|volqueta|chuto|gandola|batea|tumba|dump)') as parece_camion,
    -- Placa/serial que NO identifican nada. «000» es un relleno, no un serial.
    (upper(btrim(coalesce(b.plate, ''))) in ('', '0', '00', '000', '0000', '-', '--', 'N/A', 'NA', 'S/P', 'SIN', 'SIN PLACA', 'X', 'XX', 'XXX')) as placa_inservible,
    (upper(btrim(coalesce(b.serial, ''))) in ('', '0', '00', '000', '0000', '-', '--', 'N/A', 'NA', 'S/S', 'SIN', 'SIN SERIAL', 'X', 'XX', 'XXX')) as serial_inservible
  from base b
),
viajes as (
  select v.machinery_id, count(*) as n, max(v.registered_at) as ultimo
  from public.camion_viajes v
  where v.machinery_id is not null
  group by v.machinery_id
),
-- Placas repetidas entre los camiones que el módulo SÍ muestra: dos máquinas
-- con la misma placa son indistinguibles en el reporte, y el que lo recibe no
-- puede saber cuál de las dos hizo los viajes.
placas_dup as (
  select upper(btrim(plate)) as p, count(*) as n
  from marcado
  where en_la_lista and not placa_inservible
  group by 1 having count(*) > 1
),
seriales_dup as (
  select upper(btrim(serial)) as sr, count(*) as n
  from marcado
  where en_la_lista and not serial_inservible
  group by 1 having count(*) > 1
)

select seccion, detalle, valor
from (

  -- ── 1) EL RESUMEN ────────────────────────────────────────────────────────
  select 1 as orden, '1· RESUMEN' as seccion, 'Máquinas activas en el catálogo' as detalle,
         count(*)::text as valor from marcado
  union all
  select 1, '1· RESUMEN', 'Camiones que el módulo MUESTRA (código dice volteo/volqueta/toronto)',
         (count(*) filter (where en_la_lista))::text from marcado
  union all
  select 1, '1· RESUMEN', '   ... de esos, seleccionables por el listero (operativas y no en espera)',
         (count(*) filter (where en_la_lista and operational and not en_espera))::text from marcado
  union all
  select 1, '1· RESUMEN', '   ... retiradas (operational = false): el listero NO las ve',
         (count(*) filter (where en_la_lista and not operational))::text from marcado
  union all
  select 1, '1· RESUMEN', '   ... en espera de instrucciones: el listero NO las ve',
         (count(*) filter (where en_la_lista and operational and en_espera))::text from marcado
  union all
  select 1, '1· RESUMEN', '⭐ Parecen camión pero el módulo NO las muestra',
         (count(*) filter (where parece_camion and not en_la_lista))::text from marcado

  -- ── 2) LO GRAVE: camiones que YA tienen viajes y no están en la lista ────
  -- Si algo tiene viajes registrados, es un camión. Punto. Que no aparezca en
  -- la lista significa que alguien lo agregó a mano desde el buscador y que la
  -- alerta de «camión sin viajes» nunca lo va a vigilar.
  union all
  select 2, '2· ⭐ TIENEN VIAJES PERO NO ESTÁN EN LA LISTA',
         coalesce(m.code, '(sin código)') || '  ·  placa: ' || coalesce(nullif(btrim(m.plate), ''), '—')
           || '  ·  serial: ' || coalesce(nullif(btrim(m.serial), ''), '—')
           || '  ·  clasif: ' || coalesce(nullif(btrim(m.clasificacion), ''), '—'),
         v.n::text || ' viaje(s), último ' || to_char(v.ultimo at time zone 'America/Caracas', 'DD/MM/YYYY HH24:MI')
  from marcado m join viajes v on v.machinery_id = m.id
  where not m.en_la_lista

  -- ── 3) PARECEN CAMIÓN Y NO ESTÁN (aunque todavía no tengan viajes) ───────
  union all
  select 3, '3· PARECEN CAMIÓN Y NO ESTÁN EN LA LISTA',
         coalesce(m.code, '(sin código)') || '  ·  clasif: ' || coalesce(nullif(btrim(m.clasificacion), ''), '—')
           || '  ·  tipo: ' || coalesce(nullif(btrim(m.tipo), ''), '—')
           || '  ·  ' || coalesce(nullif(btrim(m.marca), ''), '—') || ' ' || coalesce(nullif(btrim(m.modelo), ''), ''),
         case when not m.operational then 'retirada'
              when m.en_espera then 'en espera'
              else 'operativa' end
  from marcado m
  where m.parece_camion and not m.en_la_lista
    and not exists (select 1 from viajes v where v.machinery_id = m.id)

  -- ── 4) PLACA Y SERIAL DE LOS QUE SÍ ESTÁN EN LA LISTA ────────────────────
  -- El código se repite en casi toda la flota («CAMION VOLTEO TORONTO» siete
  -- veces): la placa es lo ÚNICO que distingue uno de otro en el reporte.
  union all
  select 4, '4· ⭐ SIN PLACA NI SERIAL (no hay cómo distinguirlo)',
         coalesce(m.code, '(sin código)'),
         'placa: ' || coalesce(nullif(btrim(m.plate), ''), '(vacía)')
           || '  ·  serial: ' || coalesce(nullif(btrim(m.serial), ''), '(vacío)')
  from marcado m
  where m.en_la_lista and m.placa_inservible and m.serial_inservible

  union all
  select 5, '5· PLACA DE RELLENO O VACÍA (tiene serial, así que se identifica)',
         coalesce(m.code, '(sin código)') || '  ·  serial: ' || coalesce(nullif(btrim(m.serial), ''), '—'),
         'placa: ' || coalesce(nullif(btrim(m.plate), ''), '(vacía)')
  from marcado m
  where m.en_la_lista and m.placa_inservible and not m.serial_inservible

  union all
  select 6, '6· ⭐ PLACA REPETIDA (dos máquinas distintas, misma placa)',
         coalesce(m.code, '(sin código)') || '  ·  serial: ' || coalesce(nullif(btrim(m.serial), ''), '—'),
         'placa ' || upper(btrim(m.plate)) || ' la usan ' || d.n::text || ' máquinas'
  from marcado m join placas_dup d on d.p = upper(btrim(m.plate))
  where m.en_la_lista

  union all
  select 7, '7· SERIAL REPETIDO',
         coalesce(m.code, '(sin código)') || '  ·  placa: ' || coalesce(nullif(btrim(m.plate), ''), '—'),
         'serial ' || upper(btrim(m.serial)) || ' lo usan ' || d.n::text || ' máquinas'
  from marcado m join seriales_dup d on d.sr = upper(btrim(m.serial))
  where m.en_la_lista

  -- ── 8) SIN EMPRESA: caen todos juntos en «Sin empresa» del reporte ───────
  union all
  select 8, '8· CAMIÓN EN LA LISTA SIN EMPRESA ASIGNADA',
         coalesce(m.code, '(sin código)') || '  ·  placa: ' || coalesce(nullif(btrim(m.plate), ''), '—')
           || '  ·  serial: ' || coalesce(nullif(btrim(m.serial), ''), '—'),
         coalesce((select v.n::text || ' viaje(s)' from viajes v where v.machinery_id = m.id), 'sin viajes')
  from marcado m
  where m.en_la_lista and m.company_id is null

  -- ── 9) EL LISTADO COMPLETO, tal como lo ve el módulo hoy ─────────────────
  union all
  select 9, '9· LISTADO COMPLETO QUE MUESTRA EL MÓDULO',
         coalesce(m.code, '(sin código)') || '  ·  placa: ' || coalesce(nullif(btrim(m.plate), ''), '—')
           || '  ·  serial: ' || coalesce(nullif(btrim(m.serial), ''), '—'),
         (case when not m.operational then 'retirada' when m.en_espera then 'en espera' else 'operativa' end)
           || '  ·  ' || coalesce((select v.n::text || ' viaje(s)' from viajes v where v.machinery_id = m.id), 'sin viajes')
  from marcado m
  where m.en_la_lista

) t
order by orden, detalle;


/* ==========================================================================
   QUE ES ESTO Y POR QUE LA EXPLICACION QUEDO AL FINAL

   El 22-ago-2026 este archivo fallo al pegarlo en el SQL Editor con
   «syntax error at or near "-"» en la linea 1: al copiar se perdio UN
   guion y Postgres recibio «- ====» en vez de «-- ====». Por eso la
   consulta arranca en la linea 1 y toda la explicacion vive aca abajo:
   asi no hay 30 lineas de comentario invitando a una seleccion sucia.
   Si algo se corta ahora, el error salta en la consulta y se ve.

============================================================================
¿EL LISTADO DE CAMIONES DEL MÓDULO DE VIAJES ES EL QUE DEBE SER?

👉 CÓMO SE CORRE: copiar ESTE ARCHIVO COMPLETO, pegarlo en Supabase → SQL
   Editor y darle RUN. Devuelve UNA sola tabla con todo.

✅ SOLO LEE. Cero insert, cero update, cero delete, cero alter. Se puede
   correr en producción a cualquier hora, las veces que haga falta.

QUÉ PREGUNTA RESPONDE
---------------------------------------------------------------------------
La pantalla de Viajes de Camiones decide qué es un camión MIRANDO EL TEXTO
DEL CÓDIGO: si dice «volteo», «volqueta» o «toronto», entra a la lista; si
no, no entra (`isVolteoVolqueta` en src/lib/equipos.ts). Esa regla la
comparten otras tres pantallas (Asistencia de camiones, Supervisión y el
patio), así que NO se toca sin saber a quién más le mueve el piso.

El problema de una regla por texto es que no se puede auditar a ojo: un
camión cuyo código diga «CHUTO 04» o «KODIAK 12» es un camión de verdad y la
regla lo deja afuera en silencio — no aparece en la lista del listero, no
entra en la alerta de «camión sin viajes» y sus viajes quedan colgando.

Este diagnóstico pone lado a lado las dos preguntas:
  · ¿QUÉ VE HOY el módulo?
  · ¿QUÉ MÁS parece un camión según la ficha (clasificación, tipo, marca,
    modelo) o según los viajes que YA tiene registrados?
Y de paso revisa la calidad de placa/serial, que es lo único que distingue
un «CAMION VOLTEO TORONTO» de los otros seis que se llaman igual.

⚠️ ESTE ARCHIVO NO ARREGLA NADA. Solo dice qué hay. Cualquier corrección
   (cambiar un código, poner una placa, asignar la empresa) se hace desde
   Catálogo/Equipos, máquina por máquina, y es una decisión tuya.
============================================================================
   ========================================================================== */
