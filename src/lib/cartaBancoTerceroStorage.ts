// Persistencia y sincronización multi-dispositivo de la Carta de Autorización de Banco de Tercero.
//
// Reglas de seguridad y no-regresión:
// 1. Al guardar, actualiza SIEMPRE las 4 columnas bancarias estándar de `employees`
//    (`bank_name`, `bank_account`, `bank_holder`, `bank_cedula`) con `.select('id')` para
//    verificar que la RLS permitió el cambio y para que Pago a Personal, Pago por Persona,
//    Excel y Recibos sigan funcionando sin tocar su estructura.
// 2. Guarda el expediente completo de la carta (`CartaBancoTerceroData`: parentesco, tipo de cuenta,
//    Pago Móvil, motivo, firmas digitales y soportes PDF/fotos) en una fila oculta por empleado
//    en `payroll_companies` (`__carta_banco_tercero__:<employeeId>:<json>`, `active = false`),
//    más caché en `AsyncStorage` e intento opcional en `employees.carta_banco_tercero`.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import {
  PREFIX_CARTA_BANCO_TERCERO,
  CartaBancoTerceroData,
  MapaCartasBancoTercero,
  normalizarCartaBancoTercero,
  construirPayloadCartaEmpresa,
  extraerMapaCartasDeEmpresas,
} from './cartaBancoTercero';

const STORAGE_KEY = '@nomina_cartas_banco_tercero_v1';

async function leerLocal(): Promise<MapaCartasBancoTercero> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: MapaCartasBancoTercero = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (k && v && typeof v === 'object') {
        out[k] = normalizarCartaBancoTercero(v);
      }
    }
    return out;
  } catch {
    return {};
  }
}

async function guardarLocal(mapa: MapaCartasBancoTercero): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(mapa));
  } catch {}
}

/**
 * Lee el mapa completo `{ [employeeId]: CartaBancoTerceroData }` combinando
 * `payroll_companies` (filas `__carta_banco_tercero__:<id>:`) y `AsyncStorage`.
 */
export async function leerMapaCartasBancoTercero(): Promise<MapaCartasBancoTercero> {
  const local = await leerLocal();
  try {
    const { data, error } = await supabase
      .from('payroll_companies')
      .select('id, name')
      .ilike('name', `${PREFIX_CARTA_BANCO_TERCERO}%`)
      .order('created_at', { ascending: true });

    if (!error && Array.isArray(data)) {
      const remoto = extraerMapaCartasDeEmpresas(data);
      const combinado: MapaCartasBancoTercero = { ...local, ...remoto };
      await guardarLocal(combinado);
      return combinado;
    }
  } catch {}
  return local;
}

/**
 * Guarda la Carta de Autorización de Banco de Tercero de un empleado y sincroniza
 * los datos bancarios (`bank_name`, `bank_account`, `bank_holder`, `bank_cedula`) en `employees`.
 */
export async function guardarCartaBancoTerceroEmpleado(params: {
  employeeId: string;
  carta: CartaBancoTerceroData;
  sincronizarColumnasBanco?: boolean;
}): Promise<{ ok: boolean; carta: CartaBancoTerceroData; mapa: MapaCartasBancoTercero; error?: string }> {
  const id = String(params.employeeId ?? '').trim();
  const normalizada = normalizarCartaBancoTercero({
    ...params.carta,
    updatedAt: new Date().toISOString(),
  });

  if (!id) {
    return { ok: false, carta: normalizada, mapa: {}, error: 'Falta el identificador del empleado.' };
  }

  // 1. Si se pide sincronizar las columnas bancarias del empleado en `employees`,
  //    actualizamos con `.select('id')` para comprobar que la RLS no rechazó en silencio.
  if (params.sincronizarColumnasBanco !== false) {
    const updateBank: Record<string, any> = {
      bank_name: normalizada.bancoNombre || null,
      bank_account: normalizada.numeroCuenta || null,
      bank_holder: normalizada.titularNombre || null,
      bank_cedula: normalizada.titularCedula || null,
    };

    const { data: empUpd, error: empErr } = await supabase
      .from('employees')
      .update(updateBank)
      .eq('id', id)
      .select('id');

    if (empErr) {
      return {
        ok: false,
        carta: normalizada,
        mapa: await leerLocal(),
        error: `No se pudieron actualizar los datos bancarios del empleado: ${empErr.message}`,
      };
    }
    if (!empUpd || empUpd.length === 0) {
      return {
        ok: false,
        carta: normalizada,
        mapa: await leerLocal(),
        error: 'No tienes permiso para modificar los datos bancarios de este empleado (RLS).',
      };
    }
  }

  // 2. Intento opcional de guardar también en `employees.carta_banco_tercero` si la columna existe.
  try {
    await supabase
      .from('employees')
      .update({ carta_banco_tercero: normalizada } as any)
      .eq('id', id);
  } catch {}

  // 3. Guardar fila oculta por empleado en `payroll_companies` (`__carta_banco_tercero__:<id>:<json>`)
  const prefixEmp = `${PREFIX_CARTA_BANCO_TERCERO}${id}:`;
  const payload = construirPayloadCartaEmpresa(id, normalizada);
  try {
    const { data: existentes } = await supabase
      .from('payroll_companies')
      .select('id')
      .ilike('name', `${prefixEmp}%`)
      .order('created_at', { ascending: false });

    if (existentes && existentes.length > 0) {
      await supabase
        .from('payroll_companies')
        .update({ name: payload, active: false })
        .eq('id', existentes[0].id)
        .select('id');
    } else {
      await supabase
        .from('payroll_companies')
        .insert({ name: payload, active: false })
        .select('id');
    }
  } catch {}

  // 4. Actualizar caché local
  const actual = await leerLocal();
  const nuevo: MapaCartasBancoTercero = { ...actual, [id]: normalizada };
  await guardarLocal(nuevo);

  return { ok: true, carta: normalizada, mapa: nuevo };
}

