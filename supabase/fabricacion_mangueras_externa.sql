-- Módulo de Fabricación (Taller) — Mangueras: permitir registrar una fabricación
-- para una MÁQUINA o EMPRESA EXTERNA (fuera de la flota), en vez de forzar siempre
-- una máquina interna (machinery_id). Idempotente: seguro de correr más de una vez.
--
-- - is_external:     true = la fabricación es para algo externo a la flota.
-- - external_client: nombre libre de esa máquina/empresa externa (solo si is_external).
--
-- machinery_id YA es opcional en el esquema (references ... on delete set null, sin
-- NOT NULL), así que no hace falta relajar ninguna restricción: cuando is_external es
-- true la app guarda machinery_id en null y llena external_client.

alter table public.hose_services
  add column if not exists is_external     boolean not null default false,
  add column if not exists external_client text;

-- Coherencia: si es externa DEBE tener nombre; si no es externa NO debe traer cliente
-- externo colgando. Se valida en BD para que ningún flujo (app o importación) deje
-- filas inconsistentes.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'hose_services_external_client_check'
  ) then
    alter table public.hose_services
      add constraint hose_services_external_client_check check (
        (is_external and external_client is not null and length(btrim(external_client)) > 0)
        or (not is_external and external_client is null)
      );
  end if;
end $$;
