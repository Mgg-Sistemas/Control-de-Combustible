-- ============================================================================
-- AVERIADAS QUE QUEDARON MAL RETIRADAS — reparar la data vieja.
--
-- ⚠️ ESTE ARCHIVO TIENE DOS BLOQUES Y NO SE CORREN JUNTOS.
--    · BLOQUE 1 = solo mira, no cambia nada. Córrelo primero y REVISA la lista.
--    · BLOQUE 2 = arregla. Córrelo SOLO después de aprobar la lista del bloque 1.
--
-- QUÉ PASÓ
-- ---------------------------------------------------------------------------
-- El botón «⚠️ Marcar equipo averiado» de Control de Maquinaria ponía
-- `machinery.operational = false`. Esa columna significa RETIRADA — «la máquina
-- ya no está, queda el registro» (palabras del cliente, 20-ago-2026). Una máquina
-- DAÑADA sigue siendo de la flota.
--
-- Consecuencia medida: el «Reporte del día por empresa» SALTA a las retiradas con
-- 0 horas (porEmpresaReport.ts: `if (inactiva && dd <= 0 && nn <= 0) return;`),
-- pero el «Informe por jornada» SÍ las muestra. Por eso dos documentos del mismo
-- día daban números distintos (caso FERRECONSTRUCCIONES).
--
-- El código ya quedó arreglado: de ahora en adelante ese botón registra la avería
-- y NO toca `operational`. Esto es solo para la data que ya quedó torcida.
--
-- CÓMO SE RECONOCE UNA VÍCTIMA DE ESE BOTÓN
-- ---------------------------------------------------------------------------
--   · `machinery.operational = false`  (quedó retirada), Y
--   · tiene un expediente en `machinery_repairs` con `status='en_reparacion'`, Y
--   · tiene el marcador `maintenance_requests.material='MÁQUINA PARADA'` pendiente
-- Las tres juntas son la firma del botón. Una máquina retirada de verdad (desde
-- «⛔ Inactiva» del Catálogo) NO tiene el expediente de reparación abierto.
--
-- ⚠️ NO SE TOCA NINGUNA HORA. Este script solo mueve `operational` y agrega el
--    renglón de avería que faltaba. No borra nada.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 1 — SOLO MIRAR. No cambia nada. Correr y revisar la lista.
-- ════════════════════════════════════════════════════════════════════════════
select m.code                                  as maquina,
       coalesce(m.plate, m.serial, m.identifier) as placa_o_serial,
       c.name                                  as empresa,
       rep.out_at                              as entro_al_taller,
       rep.estimated_note                       as motivo_escrito,
       mp.created_at                           as marcada_el,
       -- ¿ya tiene el renglón de avería REAL? Si es `false`, el sistema la ve
       -- como PARADA, no como averiada.
       exists (select 1 from public.maintenance_requests a
                where a.machinery_id = m.id and a.status = 'pendiente'
                  and a.material <> 'MÁQUINA PARADA')          as ya_tiene_averia_real
from public.machinery m
left join public.companies c on c.id = m.company_id
join public.machinery_repairs rep
       on rep.machinery_id = m.id and rep.status = 'en_reparacion'
join public.maintenance_requests mp
       on mp.machinery_id = m.id and mp.status = 'pendiente'
      and mp.material = 'MÁQUINA PARADA'
where m.operational = false
order by c.name, m.code;

-- Si esta consulta devuelve 0 filas: no hay nada que reparar, no corras el bloque 2.


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 2 — ARREGLAR. Correr SOLO después de aprobar la lista de arriba.
-- Hace respaldo, arregla y verifica, todo de una.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  n_resp int; n_op int; n_av int;
begin
  -- ── 2.1) RESPALDO de las filas que se van a tocar ─────────────────────────
  -- Tabla nueva con fecha en el nombre: no pisa ningún respaldo anterior.
  create table if not exists public.bkp_averiadas_mal_retiradas_20260820 as
  select m.id, m.code, m.operational, m.en_espera, m.active, now() as respaldado_el
  from public.machinery m
  where m.operational = false
    and exists (select 1 from public.machinery_repairs r
                 where r.machinery_id = m.id and r.status = 'en_reparacion')
    and exists (select 1 from public.maintenance_requests p
                 where p.machinery_id = m.id and p.status = 'pendiente'
                   and p.material = 'MÁQUINA PARADA');
  get diagnostics n_resp = row_count;
  raise notice 'Respaldadas: %', n_resp;

  -- ── 2.2) El renglón de AVERÍA REAL que faltaba ────────────────────────────
  -- Sin esto la máquina sigue leyéndose como PARADA (el sistema define avería
  -- real como material <> 'MÁQUINA PARADA'). Se copia el motivo del expediente
  -- del taller, que es donde el botón lo dejaba enterrado.
  insert into public.maintenance_requests (machinery_id, material, notes, status, requested_by)
  select distinct on (b.id)
         b.id, 'otro',
         coalesce(nullif(btrim(rep.estimated_note), ''), 'Avería registrada desde Control'),
         'pendiente', rep.created_by
  from public.bkp_averiadas_mal_retiradas_20260820 b
  join public.machinery_repairs rep
        on rep.machinery_id = b.id and rep.status = 'en_reparacion'
  where not exists (select 1 from public.maintenance_requests a
                     where a.machinery_id = b.id and a.status = 'pendiente'
                       and a.material <> 'MÁQUINA PARADA')
  order by b.id, rep.out_at desc nulls last;
  get diagnostics n_av = row_count;
  raise notice 'Averías reales agregadas: %', n_av;

  -- ── 2.3) Devolverlas a la flota ───────────────────────────────────────────
  -- Averiada NO es retirada. Siguen apareciendo como AVERIADAS (por el renglón
  -- de arriba), pero vuelven a contar como parte de la flota y dejan de saltarse
  -- el reporte por empresa.
  update public.machinery m
     set operational = true
   from public.bkp_averiadas_mal_retiradas_20260820 b
  where m.id = b.id and m.operational = false;
  get diagnostics n_op = row_count;
  raise notice 'Devueltas a la flota: %', n_op;
end $$;

-- ── 2.4) VERIFICACIÓN. Todo tiene que decir ✅. ──────────────────────────────
select chequeo, valor, case when ok then '✅' else '❌ REVISAR' end as estado
from (
  select 1 as n, 'Máquinas respaldadas' as chequeo,
         (select count(*) from public.bkp_averiadas_mal_retiradas_20260820)::text as valor,
         true as ok
  union all
  select 2, 'Ya ninguna quedó retirada',
         (select count(*) from public.machinery m
           join public.bkp_averiadas_mal_retiradas_20260820 b on b.id = m.id
          where m.operational = false)::text,
         (select count(*) from public.machinery m
           join public.bkp_averiadas_mal_retiradas_20260820 b on b.id = m.id
          where m.operational = false) = 0
  union all
  select 3, 'Todas tienen su avería REAL (se ven averiadas, no paradas)',
         (select count(*) from public.bkp_averiadas_mal_retiradas_20260820 b
           where exists (select 1 from public.maintenance_requests a
                          where a.machinery_id = b.id and a.status = 'pendiente'
                            and a.material <> 'MÁQUINA PARADA'))::text,
         (select count(*) from public.bkp_averiadas_mal_retiradas_20260820 b
           where not exists (select 1 from public.maintenance_requests a
                              where a.machinery_id = b.id and a.status = 'pendiente'
                                and a.material <> 'MÁQUINA PARADA')) = 0
  union all
  -- CONTROL: no se tocó ni una hora. Anota este número ANTES de correr el bloque 2
  -- y compáralo después: tiene que ser idéntico.
  select 4, 'Jornadas en la base (este script NO las toca)',
         (select count(*) from public.machine_rounds)::text, true
) t order by n;


-- ============================================================================
-- DESHACER — devuelve todo como estaba. Descomentar y correr.
-- ============================================================================
-- update public.machinery m set operational = b.operational
--   from public.bkp_averiadas_mal_retiradas_20260820 b where m.id = b.id;
-- delete from public.maintenance_requests a
--  using public.bkp_averiadas_mal_retiradas_20260820 b
--  where a.machinery_id = b.id and a.status = 'pendiente'
--    and a.material = 'otro' and a.created_at >= b.respaldado_el;
