-- ============================================================================
-- MOTIVO OBLIGATORIO AL RETIRAR UNA MÁQUINA (sacar de servicio)
-- ----------------------------------------------------------------------------
-- Cuando el administrador marca una máquina como RETIRADA (operational=false)
-- desde el Catálogo, ahora debe escribir POR QUÉ. El motivo se guarda en esta
-- columna, se ve en la ficha del Catálogo ("🔴 Inactivada el DD/MM · motivo")
-- y queda en Auditoría junto a "Retirada por / el".
--
-- La app ya escribe/lee esta columna (machinery.* con select '*'), así que basta
-- con crearla. Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================================

alter table public.machinery
  add column if not exists inactivated_reason text;

comment on column public.machinery.inactivated_reason is
  'Motivo por el que la máquina se retiró de servicio (operational=false). Obligatorio en la UI del Catálogo al retirar; se limpia/actualiza en cada retiro.';
