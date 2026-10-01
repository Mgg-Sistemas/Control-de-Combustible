-- ============================================================================
-- NÓMINA — Dejar el CARGO de la ficha escrito COMO LO ESCRIBE EL TABULADOR.
-- 29-sep-2026. Idempotente: se puede correr las veces que haga falta.
--
-- ── QUÉ ARREGLA ─────────────────────────────────────────────────────────────
-- Tres fichas tenían el cargo con un PUNTO de más ("MECANICO.", "ELECTRICISTA.")
-- y el tabulador los tiene sin punto. Todo lo que enlaza a una persona con su
-- tarifa comparaba el texto sin ignorar los signos, así que esas fichas:
--   · NO recibían el sueldo del tabulador — "🔄 Sincronizar" cuenta y actualiza
--     por ese mismo texto, y no avisa de a quién deja fuera;
--   · no heredaban el DEPARTAMENTO de su cargo;
--   · y salían como un cargo aparte en el filtro de la nómina.
--
-- ── EL CRITERIO ─────────────────────────────────────────────────────────────
-- ⭐ SOLO SE TOCA LO QUE DIFIERE EN LA ESCRITURA. Se comparan por una CLAVE que
--    ignora mayúsculas, tildes, SIGNOS y espacios dobles — la misma que usa el
--    código en `claveCargo` (src/lib/personal.ts). Dos cargos con distinta clave
--    NO se igualan nunca: "OPERADOR" y "OPERADOR DE ROQUERO" son cargos
--    distintos y así se quedan. Esto renombra cargos de gente real; igualar por
--    parecido en vez de por escritura le cambiaría el puesto a alguien.
--
-- ⚠️ EL `btrim` DE AFUERA NO SOBRA (corregido el 30-sep-2026). Los signos se
--    cambian por un ESPACIO, no por nada, para no pegar palabras
--    ("OBRERO(CALETERO)" → "obrero caletero"). Pero entonces "MECANICO." queda
--    como «mecanico » CON ESPACIO AL FINAL y no pega con «mecanico»: sin ese
--    btrim este archivo no cambiaba NI UNA FILA y parecía que ya estaba todo
--    bien. `claveCargo` en el .ts sí recorta; ésta es la misma clave.
--
-- ⚠️ TOCA A TODOS, NO SOLO A LOS ACTIVOS: un inactivo que se reincorpore vuelve
--    con su cargo mal escrito y el problema regresa con él.
--
-- ⚠️ NO se toca `staff_pay_items.cargo`: ahí el cargo va CONGELADO a propósito,
--    como estaba el día que se cargó la nómina, para que un período ya cobrado
--    no cambie solo. El código ya los agrupa bien por la clave.
-- ============================================================================

-- La CLAVE de un cargo, igual que `claveCargo` en src/lib/personal.ts.
create or replace function public.nomina_clave_cargo(txt text)
returns text language sql immutable as $fn$
  select btrim(
    regexp_replace(
      regexp_replace(
        lower(translate(btrim(coalesce(txt, '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuaeiouu')),
        '[^a-z0-9ñ ]', ' ', 'g'),
      '\s+', ' ', 'g')
  );
$fn$;

-- ── Antes: qué se va a cambiar (correr primero para verlo) ──────────────────
-- select e.cargo as ficha, t.cargo as tabulador, e.status, count(*) as cuantos
-- from public.employees e
-- join public.staff_cargo_tariffs t
--   on public.nomina_clave_cargo(t.cargo) = public.nomina_clave_cargo(e.cargo)
-- where btrim(coalesce(e.cargo,'')) <> '' and btrim(e.cargo) <> btrim(t.cargo)
-- group by 1,2,3 order by 1;

update public.employees e
   set cargo = btrim(t.cargo)
  from public.staff_cargo_tariffs t
 where btrim(coalesce(e.cargo, '')) <> ''
   and btrim(coalesce(t.cargo, '')) <> ''
   -- Misma clave = mismo cargo, escrito por dos personas distintas.
   and public.nomina_clave_cargo(t.cargo) = public.nomina_clave_cargo(e.cargo)
   -- …y solo si está escrito DISTINTO: así no se reescriben 300 filas iguales.
   and btrim(e.cargo) <> btrim(t.cargo);

-- ── Verificación: no debe quedar ninguna fila ───────────────────────────────
-- select e.cargo as ficha, t.cargo as tabulador
-- from public.employees e
-- join public.staff_cargo_tariffs t
--   on public.nomina_clave_cargo(t.cargo) = public.nomina_clave_cargo(e.cargo)
-- where btrim(e.cargo) <> btrim(t.cargo);
