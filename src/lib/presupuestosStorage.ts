// ============================================================================
// 💼 ALMACENAMIENTO Y GESTIÓN DE PRESUPUESTOS DE MAQUINARIA
//
// - Respaldo dual: intenta consultar en Supabase (tabla `machinery_quotes`), y si
//   la tabla aún no ha sido migrada o está offline, respalda automáticamente en
//   AsyncStorage (`@machinery_quotes_list`).
// - Generación de correlativos únicos (PRES-0001, PRES-0002...).
// - Conversión automática a Venta / Cuenta por cobrar cuando se acepta.
// ============================================================================
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { Presupuesto, PresupuestoEstado, PresupuestoItem, CondicionesAlquiler } from '../types/presupuesto';

const STORAGE_KEY = '@machinery_quotes_list';

export async function listarPresupuestos(): Promise<Presupuesto[]> {
  try {
    const { data, error } = await supabase
      .from('machinery_quotes')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && Array.isArray(data)) {
      // Normalizar datos de Supabase
      const list: Presupuesto[] = data.map((d: any) => ({
        ...d,
        items: typeof d.items === 'string' ? JSON.parse(d.items) : (d.items || []),
        conditions: typeof d.conditions === 'string' ? JSON.parse(d.conditions) : (d.conditions || {}),
        logos: typeof d.logos === 'string' ? JSON.parse(d.logos) : (d.logos || []),
        incluir_logos: d.incluir_logos !== false,
      }));
      // Guardar copia local en AsyncStorage como caché
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list)).catch(() => {});
      return list;
    }
  } catch {
    // Si la tabla no existe en Supabase o falla la red, lee de AsyncStorage
  }

  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function siguienteCorrelativoPresupuesto(): Promise<string> {
  const lista = await listarPresupuestos();
  let maxNum = 0;
  for (const p of lista) {
    const m = String(p.code || '').match(/PRES-(\d+)/i);
    if (m && m[1]) {
      const n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  const next = maxNum + 1;
  return `PRES-${String(next).padStart(4, '0')}`;
}

export async function guardarPresupuesto(p: Presupuesto): Promise<Presupuesto> {
  const now = new Date().toISOString();
  const presupuestoConFecha: Presupuesto = {
    ...p,
    updated_at: now,
  };

  // 1) Guardar en AsyncStorage de inmediato
  const lista = await listarPresupuestos();
  const idx = lista.findIndex((x) => x.id === p.id);
  let nuevaLista: Presupuesto[];
  if (idx >= 0) {
    nuevaLista = [...lista];
    nuevaLista[idx] = presupuestoConFecha;
  } else {
    nuevaLista = [presupuestoConFecha, ...lista];
  }
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nuevaLista)).catch(() => {});

  // 2) Intentar guardar en Supabase si la tabla existe
  try {
    const payload = {
      id: p.id,
      code: p.code,
      company_id: p.company_id,
      company_name: p.company_name,
      company_rif: p.company_rif,
      client_id: p.client_id,
      client_name: p.client_name,
      client_doc: p.client_doc,
      client_phone: p.client_phone,
      client_email: p.client_email,
      client_address: p.client_address,
      client_contact_person: p.client_contact_person,
      project_name: p.project_name,
      date: p.date,
      valid_until: p.valid_until,
      items: p.items,
      subtotal: p.subtotal,
      con_iva: p.con_iva,
      iva_pct: p.iva_pct,
      iva_monto: p.iva_monto,
      total: p.total,
      rate_bs: p.rate_bs,
      total_bs: p.total_bs,
      conditions: p.conditions,
      status: p.status,
      status_note: p.status_note,
      logos: p.logos || [],
      incluir_logos: p.incluir_logos !== false,
      created_by: p.created_by,
      created_by_name: p.created_by_name,
      created_at: p.created_at,
      updated_at: now,
    };
    await supabase.from('machinery_quotes').upsert(payload);
  } catch {
    // Si la tabla no existe o falla la red, el registro local ya quedó a salvo
  }

  return presupuestoConFecha;
}

export async function cambiarEstadoPresupuesto(
  id: string,
  nuevoEstado: PresupuestoEstado,
  nota?: string | null
): Promise<boolean> {
  const lista = await listarPresupuestos();
  const p = lista.find((x) => x.id === id);
  if (!p) return false;

  const actualizado: Presupuesto = {
    ...p,
    status: nuevoEstado,
    status_note: nota !== undefined ? nota : p.status_note,
    updated_at: new Date().toISOString(),
  };

  await guardarPresupuesto(actualizado);
  return true;
}

export async function eliminarPresupuesto(id: string): Promise<boolean> {
  // 1) En local
  const lista = await listarPresupuestos();
  const filtrada = lista.filter((x) => x.id !== id);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(filtrada)).catch(() => {});

  // 2) En Supabase
  try {
    await supabase.from('machinery_quotes').delete().eq('id', id);
  } catch {
    // ignorar error de tabla inexistente
  }
  return true;
}

/**
 * Plantilla por defecto de condiciones de alquiler comercial
 */
export function condicionesPorDefecto(): CondicionesAlquiler {
  return {
    incluye_operador: true,
    detalle_operador: 'Operador calificado y certificado incluido en la tarifa.',
    incluye_combustible: false,
    detalle_combustible: 'Combustible Diesel por cuenta del cliente en el frente de obra.',
    horas_minimas_dia: 8,
    horas_minimas_mes: null,
    flete_incluido: false,
    detalle_flete: 'Movilización y desmovilización en Lowboy por cuenta del cliente.',
    mantenimiento: 'Mantenimiento preventivo rutinario a cargo de la arrendadora. Averías por mal uso o combustible contaminado a cargo del cliente.',
    forma_pago: '50% de anticipo al reservar equipo y 50% al completar las primeras 100 horas trabajadas.',
    vigencia_dias: 7,
    observaciones_generales: '',
  };
}
