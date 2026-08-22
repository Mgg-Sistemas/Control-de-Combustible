-- ============================================================================
-- ALERTAS POR HORÓMETRO (mantenimiento preventivo de maquinaria)
-- ----------------------------------------------------------------------------
-- machinery.last_horometro YA existe (lectura viva, se arrastra jornada a
-- jornada). Este archivo agrega:
--   · machinery.horometro_base: la lectura del horómetro en el ÚLTIMO
--     mantenimiento confirmado. NO es el horómetro físico (ese sigue siendo
--     last_horometro): es solo la "marca cero" para calcular lo acumulado.
--     Horas acumuladas desde el último mantenimiento = last_horometro − horometro_base.
--   · Un trigger que, cada vez que cambia el horómetro (o se reinicia la base),
--     revisa si esas horas acumuladas cruzan un umbral:
--       200 h = BAJA · 220 h = MEDIA · 250 h = ALTA (MÁXIMA)
--     y si es así, avisa por la campana (tabla notifications) a 'admin' y a
--     'supervisor' (mismo rol que usa Mantenimiento/Inspecciones).
--   · Es "persistente diariamente": si la máquina sigue por encima del umbral
--     no duplica la notificación el mismo día (dedup por entity_id + fecha),
--     pero si al día siguiente el horómetro se sigue moviendo y no se confirmó
--     el mantenimiento, vuelve a avisar. Deja de generarse en cuanto se reinicia
--     horometro_base (botón "Confirmar mantenimiento" en Mantenimiento de
--     Maquinaria), porque ahí las horas acumuladas vuelven a 0.
-- Ejecutar en: Supabase Studio > SQL Editor. Idempotente (se puede correr varias veces).
-- ============================================================================

alter table public.machinery add column if not exists horometro_base numeric(12,2);
comment on column public.machinery.horometro_base is
  'Lectura del horómetro en el último mantenimiento confirmado. Horas acumuladas = last_horometro - horometro_base. Reiniciar el horómetro = horometro_base := last_horometro (NO se toca last_horometro).';

-- Backfill: las máquinas que YA tienen horómetro pero nunca tuvieron una base
-- registrada arrancan en 0 horas acumuladas (no en una alerta falsa por su
-- horómetro histórico). Solo aplica una vez (no pisa una base ya guardada).
update public.machinery
   set horometro_base = last_horometro
 where horometro_base is null
   and last_horometro is not null;

-- ── Notificación de alerta (dedup por máquina + día) ────────────────────────
create or replace function public.check_horometro_alerta()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_horas   numeric;
  v_level   text;
  v_label   text;
  v_company text;
  v_exists  boolean;
begin
  if NEW.last_horometro is null then return NEW; end if;

  v_horas := NEW.last_horometro - coalesce(NEW.horometro_base, NEW.last_horometro);
  if v_horas is null or v_horas < 200 then return NEW; end if;

  if v_horas >= 250 then v_level := 'ALTA'; v_label := '🔴 ALTA (máxima)';
  elsif v_horas >= 220 then v_level := 'MEDIA'; v_label := '🟠 MEDIA';
  else v_level := 'BAJA'; v_label := '🟡 BAJA';
  end if;

  -- Dedup diario: si YA se avisó de esta máquina hoy, no duplica.
  select exists(
    select 1 from public.notifications
     where type = 'horometro_alerta'
       and entity_id = NEW.id::text
       and created_at::date = (now() at time zone 'America/Caracas')::date
  ) into v_exists;
  if v_exists then return NEW; end if;

  select name into v_company from public.companies where id = NEW.company_id;

  insert into public.notifications (type, title, body, target_role, entity_type, entity_id, meta)
  values
    ('horometro_alerta', 'Próxima a mantenimiento · ' || v_label,
     concat_ws(' · ', NEW.code, case when v_company is not null then 'Empresa: ' || v_company end, 'Horas acumuladas: ' || round(v_horas, 1) || ' h'),
     'admin', 'machinery', NEW.id::text,
     jsonb_build_object('level', v_level, 'horas', round(v_horas, 1), 'code', NEW.code)),
    ('horometro_alerta', 'Próxima a mantenimiento · ' || v_label,
     concat_ws(' · ', NEW.code, case when v_company is not null then 'Empresa: ' || v_company end, 'Horas acumuladas: ' || round(v_horas, 1) || ' h'),
     'supervisor', 'machinery', NEW.id::text,
     jsonb_build_object('level', v_level, 'horas', round(v_horas, 1), 'code', NEW.code));

  return NEW;
end $$;

drop trigger if exists trg_check_horometro_alerta on public.machinery;
create trigger trg_check_horometro_alerta
  after update of last_horometro, horometro_base on public.machinery
  for each row
  when (NEW.last_horometro is distinct from OLD.last_horometro or NEW.horometro_base is distinct from OLD.horometro_base)
  execute function public.check_horometro_alerta();

-- Índice de apoyo para el dedup diario (type + entity_id + fecha).
create index if not exists notifications_type_entity_idx on public.notifications (type, entity_id, created_at);
