// ── QUIÉN APRUEBA PAGOS Y QUIÉN CONFIGURA AL APROBADOR (30-oct-2026) ─────────
// Antes la pantalla lo decidía comparando el nombre, el usuario, la cédula o el
// correo de la persona (se podía suplantar y dejaba datos personales en el código
// público). Ahora lo decide la BASE por la cuenta conectada (auth.uid()):
//   · es_aprobador_cxp()            → administradores y los designados en la configuración
//   · es_admin_config_aprobacion()  → los responsables de sistemas
// La base además RECHAZA poner la marca «aprobado» o cambiar la configuración a
// quien no corresponda, así que esto solo sirve para mostrar u ocultar botones.
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface PermisosAprobacion {
  puedeAprobar: boolean;
  puedeConfigurar: boolean;
  cargado: boolean;
}

const SIN_PERMISOS: PermisosAprobacion = { puedeAprobar: false, puedeConfigurar: false, cargado: false };

// Se pregunta una sola vez por sesión (por usuario).
let cache: { uid: string; valor: PermisosAprobacion } | null = null;

export async function leerPermisosAprobacion(uid: string | null | undefined): Promise<PermisosAprobacion> {
  if (!uid) return { ...SIN_PERMISOS, cargado: true };
  if (cache && cache.uid === uid) return cache.valor;
  const [ap, cfg] = await Promise.all([
    supabase.rpc('es_aprobador_cxp'),
    supabase.rpc('es_admin_config_aprobacion'),
  ]);
  const valor: PermisosAprobacion = {
    puedeAprobar: ap.data === true,
    puedeConfigurar: cfg.data === true,
    cargado: true,
  };
  // Si la consulta falló no se guarda: se vuelve a intentar la próxima vez.
  if (!ap.error && !cfg.error) cache = { uid, valor };
  return valor;
}

export function usePermisosAprobacion(uid: string | null | undefined): PermisosAprobacion {
  const [permisos, setPermisos] = useState<PermisosAprobacion>(
    cache && uid && cache.uid === uid ? cache.valor : SIN_PERMISOS
  );
  useEffect(() => {
    let vivo = true;
    leerPermisosAprobacion(uid)
      .then((p) => { if (vivo) setPermisos(p); })
      .catch(() => { if (vivo) setPermisos({ ...SIN_PERMISOS, cargado: true }); });
    return () => { vivo = false; };
  }, [uid]);
  return permisos;
}
