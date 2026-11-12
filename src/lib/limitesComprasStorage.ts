// ============================================================================
// ☁️ PERSISTENCIA EN NUBE + REALTIME PARA LÍMITES DE COMPRAS Y SOLICITUDES
//
// Lee y guarda `ConfigLimitesCompras` en `public.feature_toggles` bajo la clave
// `compras_limites_usuarios` (columna `config` JSONB + `enabled`), con caché
// síncrono en `limitesCompras.ts` y suscripción a `subscribeRealtime` para que
// cualquier ajuste del administrador se refleje al instante en todos los
// teléfonos y computadoras abiertos.
// ============================================================================
import { supabase } from './supabase';
import { subscribeRealtime } from './realtimeBus';
import {
  ConfigLimitesCompras,
  KEY_FEATURE_LIMITES_COMPRAS,
  guardarConfigLimitesComprasLocal,
  normalizarConfigLimitesCompras,
  obtenerConfigLimitesCompras,
} from './limitesCompras';

/** Carga desde Supabase la configuración vigente de límites para todos los usuarios. */
export async function cargarConfigLimitesComprasDesdeDB(): Promise<ConfigLimitesCompras> {
  try {
    const { data, error } = await supabase
      .from('feature_toggles')
      .select('key, enabled, config')
      .eq('key', KEY_FEATURE_LIMITES_COMPRAS)
      .maybeSingle();

    if (error || !data) {
      return obtenerConfigLimitesCompras();
    }

    const rawCfg =
      (data as any).config && typeof (data as any).config === 'object'
        ? (data as any).config
        : {};
    const fusionada = normalizarConfigLimitesCompras({
      ...rawCfg,
      activo: typeof data.enabled === 'boolean' ? data.enabled : rawCfg.activo !== false,
    });
    return guardarConfigLimitesComprasLocal(fusionada);
  } catch {
    return obtenerConfigLimitesCompras();
  }
}

/**
 * Guarda en Supabase el nuevo límite máximo configurado por el administrador.
 * Usa `.select('key')` para detectar si la política RLS rechazó la escritura
 * (0 filas afectadas) y devuelve siempre un resultado explícito `{ ok, config, error }`.
 */
export async function guardarConfigLimitesComprasEnDB(
  parcial: Partial<ConfigLimitesCompras>,
  userId?: string | null,
): Promise<{ ok: boolean; config: ConfigLimitesCompras; error?: string }> {
  const actual = obtenerConfigLimitesCompras();
  const nueva = normalizarConfigLimitesCompras({
    ...actual,
    ...parcial,
  });

  try {
    const { data, error } = await supabase
      .from('feature_toggles')
      .upsert(
        {
          key: KEY_FEATURE_LIMITES_COMPRAS,
          enabled: nueva.activo,
          extra_user_ids: [],
          config: nueva as any,
          updated_at: new Date().toISOString(),
          updated_by: userId ?? null,
        } as any,
        { onConflict: 'key' },
      )
      .select('key');

    if (error) {
      return {
        ok: false,
        config: actual,
        error: error.message || 'No se pudo guardar el límite en la base de datos.',
      };
    }

    if (!data || data.length === 0) {
      return {
        ok: false,
        config: actual,
        error: 'No tienes permiso para modificar el límite global de usuarios.',
      };
    }

    const guardada = guardarConfigLimitesComprasLocal(nueva);
    return { ok: true, config: guardada };
  } catch (e: any) {
    return {
      ok: false,
      config: actual,
      error: e?.message || 'Error de conexión al guardar el límite.',
    };
  }
}

/**
 * Suscribe un componente React a los cambios en vivo de `feature_toggles`
 * para que todos los usuarios vean el nuevo máximo apenas el administrador lo cambie.
 */
export function suscribirConfigLimitesCompras(
  onUpdate: (cfg: ConfigLimitesCompras) => void,
): () => void {
  let activo = true;
  const recargar = () => {
    cargarConfigLimitesComprasDesdeDB().then((cfg) => {
      if (activo) onUpdate(cfg);
    });
  };
  recargar();
  const unsub = subscribeRealtime(['feature_toggles'], recargar);
  return () => {
    activo = false;
    unsub();
  };
}

