-- ============================================================================
-- REQUERIMIENTOS — formato adjunto (imagen o PDF).
-- Agrega las columnas para guardar el archivo subido (se aloja en el bucket
-- público de Storage 'machinery', carpeta requerimientos/<id>/).
-- Idempotente.
-- ============================================================================
alter table public.inventory_requirements add column if not exists attachment_url  text;  -- URL pública del formato
alter table public.inventory_requirements add column if not exists attachment_type text;  -- 'image' | 'pdf'
alter table public.inventory_requirements add column if not exists attachment_name text;  -- nombre original del archivo

-- NOTA sobre Storage: los formatos se suben al bucket 'machinery' (el mismo de las
-- fotos). Si el bucket tiene restringidos los tipos MIME a solo imágenes, hay que
-- PERMITIR también 'application/pdf' (o dejar los tipos sin restricción) para que
-- se puedan subir PDFs. Storage → bucket 'machinery' → Allowed MIME types.
