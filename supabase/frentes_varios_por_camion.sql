-- ============================================================================
-- ⛏️ UN CAMIÓN PUEDE TENER VARIOS FRENTES EL MISMO DÍA — 30-sep-2026.
--
-- Pedido del cliente, textual: «permite que un camion pueda tener varios
-- frentes y ademas permite que el usuario pueda borrar, editar y agregar mas
-- frentes o modificar lo que ya tiene el camion».
--
-- ── QUÉ LO IMPEDÍA ──────────────────────────────────────────────────────────
-- `viaje_frente_asignaciones` tenía UNIQUE (jornada, machinery_id): UNA fila
-- por camión y día. Ponerle un segundo frente no fallaba — el código hacía
-- `upsert` por esa misma llave, así que el frente nuevo PISABA al anterior en
-- silencio. El camión que recogía en dos frentes solo mostraba el último.
--
-- ── QUÉ QUEDA ───────────────────────────────────────────────────────────────
-- El único pasa a ser (jornada, machinery_id, frente_id): un camión puede tener
-- los frentes que haga falta ese día, pero no el MISMO dos veces (una repetida
-- contaría dos veces al camión en la hoja del día).
--
-- ⚠️ NO BORRA NI UNA FILA: las asignaciones que ya existen cumplen el único
--    nuevo (si eran únicas por jornada+camión, con más razón lo son por
--    jornada+camión+frente). Es solo quitar un candado.
--
-- ⚠️ ORDEN: la app funciona ANTES y DESPUÉS de correr esto. `asignarFrente` ya
--    no usa `upsert` (filtra lo que ya está asignado y hace `insert`), así que
--    no depende de que exista este índice. Lo único que NO se puede hacer
--    mientras el único viejo siga ahí es ponerle un SEGUNDO frente a un camión:
--    la app lo detecta y dice que falta correr este archivo.
--
-- Idempotente: se puede correr las veces que haga falta.
-- ============================================================================

-- 1) Fuera el candado viejo (una sola asignación por camión y día).
alter table public.viaje_frente_asignaciones
  drop constraint if exists viaje_frente_asignaciones_jornada_machinery_id_key;

-- 2) El nuevo: varios frentes sí, el mismo frente dos veces no.
create unique index if not exists vfa_jornada_camion_frente_key
  on public.viaje_frente_asignaciones (jornada, machinery_id, frente_id);

-- 3) Buscar «los frentes de ESTE camión ese día» es ahora la consulta normal
--    de la pantalla (antes devolvía una fila; ahora, varias).
create index if not exists vfa_jornada_camion_idx
  on public.viaje_frente_asignaciones (jornada, machinery_id);

-- ── Verificación ────────────────────────────────────────────────────────────
-- Debe quedar vfa_jornada_camion_frente_key y NO el ..._jornada_machinery_id_key:
-- select indexname from pg_indexes where tablename = 'viaje_frente_asignaciones';
--
-- Y ninguna repetida (tiene que dar 0 filas):
-- select jornada, machinery_id, frente_id, count(*)
-- from public.viaje_frente_asignaciones
-- group by 1,2,3 having count(*) > 1;
