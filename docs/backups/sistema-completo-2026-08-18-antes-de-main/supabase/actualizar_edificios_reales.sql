-- ============================================================================
-- ACTUALIZAR catálogo de EDIFICIOS con la lista REAL confirmada por el cliente
-- (07-ago-2026). Corrige nombres mal escritos/con prefijos de sobra y agrega
-- los que faltaban. Es la tabla `public.edificios` que ya usa TODO el sistema
-- (EdificioPicker, check-in, surtir combustible, reportes) — no hace falta
-- tocar código en las pantallas, con actualizar esta tabla se refleja solo en
-- todas las vistas.
--
-- SEGURO: los RENAME de abajo son UPDATE (no borran nada) y están protegidos
-- con `and not exists (...)` para no violar el `unique` de `name` si el nuevo
-- nombre ya existiera por algún motivo. Los INSERT usan `on conflict do nothing`.
-- No borra ni desactiva ningún edificio existente.
--
-- Corre una sola vez en Supabase → SQL Editor.
-- ============================================================================

-- 1) RENOMBRAR los que ya existían pero con nombre/ortografía distinta a la real.
update public.edificios set name = 'Santa Eduviges'
  where name = 'Santa Eduvigis' and not exists (select 1 from public.edificios where name = 'Santa Eduviges');
update public.edificios set name = 'Litoral Palace'
  where name = 'Hotel Litoral Palace' and not exists (select 1 from public.edificios where name = 'Litoral Palace');
update public.edificios set name = 'Las Palmas'
  where name = 'Residencias Las Palmas' and not exists (select 1 from public.edificios where name = 'Las Palmas');
update public.edificios set name = 'Rita Mar'
  where name = 'Residencias Rita Mar' and not exists (select 1 from public.edificios where name = 'Rita Mar');
update public.edificios set name = 'Club Caribe'
  where name = 'Residencia Club Caribe' and not exists (select 1 from public.edificios where name = 'Club Caribe');
update public.edificios set name = 'Residencia Tachiti'
  where name = 'Residencia Tahiti' and not exists (select 1 from public.edificios where name = 'Residencia Tachiti');
update public.edificios set name = 'OPP 26'
  where name = 'Opp 26' and not exists (select 1 from public.edificios where name = 'OPP 26');
update public.edificios set name = 'OPP 27'
  where name = 'Opp 27' and not exists (select 1 from public.edificios where name = 'OPP 27');
update public.edificios set name = 'OPP 33'
  where name = 'Opp 33' and not exists (select 1 from public.edificios where name = 'OPP 33');
update public.edificios set name = 'OPP 25'
  where name = 'Opp 25' and not exists (select 1 from public.edificios where name = 'OPP 25');

-- 2) AGREGAR los que faltaban en el catálogo.
insert into public.edificios (name) values
  ('Colinas de Catia la Mar'),
  ('Hospital de Catia la Mar'),
  ('Punta Piedra'),
  ('Coral Garden'),
  ('Coral Park'),
  ('Roca Park'),
  ('La Dolla'),
  ('Escuela Naval')
on conflict (name) do nothing;

-- 3) Ya existían y NO cambian (sin acción): Residencias Militares, Arichuna, Mar de Leva.

-- 4) NO tocados (existían en el catálogo pero el cliente NO los mencionó en la
--    lista real 07-ago-2026): 'La Iguana', 'Puente Caraballeda (Debajo)',
--    'Opp 22', 'Hotel Albatro', 'Playa escondida Tanaguarena'. Se dejan
--    ACTIVOS a propósito (por si algún reporte/máquina vieja los referencia) —
--    si el cliente confirma que ya no existen, desactivarlos así (no borrar,
--    para no perder el historial que los usa):
--      update public.edificios set active = false where name in
--        ('La Iguana','Puente Caraballeda (Debajo)','Opp 22','Hotel Albatro','Playa escondida Tanaguarena');
