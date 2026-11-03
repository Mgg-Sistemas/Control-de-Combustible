// 🙈 Lectura y escritura de las empresas ocultas en cocina (03-nov-2026).
// La regla vive en comidaEmpresasOcultas.ts. Nunca se borra una fila: ocultar y
// mostrar es poner `oculta` en true o false (queda quién y cuándo).
import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { FilaEmpresaOculta, esTablaFaltante, idsOcultas } from './comidaEmpresasOcultas';

export async function cargarEmpresasOcultas(): Promise<{ filas: FilaEmpresaOculta[]; ocultas: Set<string>; sinTabla: boolean }> {
  const { data, error } = await supabase
    .from('comida_empresas_ocultas')
    .select('company_id, oculta, updated_at, updated_by_nombre');
  if (error) {
    // Sin la tabla (falta el SQL) nada está oculto: la cocina sigue igual que antes.
    if (esTablaFaltante(error)) return { filas: [], ocultas: new Set(), sinTabla: true };
    throw new Error(error.message);
  }
  const filas = (data ?? []) as FilaEmpresaOculta[];
  return { filas, ocultas: idsOcultas(filas), sinTabla: false };
}

/** Oculta o vuelve a mostrar UNA empresa en cocina. El `.select` descubre el rechazo de la RLS. */
export async function ponerEmpresaOculta(companyId: string, oculta: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from('comida_empresas_ocultas')
    .upsert({ company_id: companyId, oculta } as any, { onConflict: 'company_id' })
    .select('company_id');
  if (error) {
    if (esTablaFaltante(error)) return { ok: false, error: 'Falta crear la tabla de empresas ocultas (SQL pendiente).' };
    return { ok: false, error: error.message };
  }
  if (!data || data.length === 0) return { ok: false, error: 'No se guardó: hace falta permiso completo de Distribución de comida.' };
  return { ok: true };
}

/** Las ocultas, al día (se actualiza sola si alguien oculta o muestra una en otro equipo). */
export function useEmpresasOcultasComida() {
  const [ocultas, setOcultas] = useState<Set<string>>(new Set());
  const [filas, setFilas] = useState<FilaEmpresaOculta[]>([]);
  const [sinTabla, setSinTabla] = useState(false);
  const recargar = useCallback(async () => {
    try {
      const r = await cargarEmpresasOcultas();
      setOcultas(r.ocultas);
      setFilas(r.filas);
      setSinTabla(r.sinTabla);
    } catch {
      // Si falla la lectura no se esconde nada: mejor ver una de más que perder una.
      setOcultas(new Set());
    }
  }, []);
  useEffect(() => { recargar(); }, [recargar]);
  useRealtimeRefresh(['comida_empresas_ocultas'], () => { recargar(); });
  return { ocultas, filas, sinTabla, recargar };
}
