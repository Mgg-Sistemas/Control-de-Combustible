// QUÉ SALE EN EL TICKET · el acceso a la base (12-sep-2026).
//
// Va aparte de `tiqueConfig.ts` a propósito, igual que `cubicajeDatos.ts` está
// aparte de `cubicaje.ts`: las REGLAS son puras y se prueban solas, sin red y
// sin pantalla; acá vive lo único que habla con Supabase.
//
// ⚠️ ESTA TABLA LA CREA `05_tiquetera_viajes.sql`, que NO está en el repositorio
//    porque es público. Y todo tiene que funcionar antes de que se corra: si la
//    tabla no existe, se usa la configuración de fábrica y la pantalla lo AVISA.
//    Nunca se queda en blanco.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import {
  CONFIG_POR_DEFECTO,
  normalizarConfig,
  normalizarFormatos,
  crearFormatoDefecto,
  type FormatoTique,
  type TiqueConfig,
} from './tiqueConfig';

const TABLA = 'tique_config';

/** ¿El error es «esa tabla no existe»? Mismo criterio que el cubicaje: PostgREST
 *  y Postgres la reportan de tres formas distintas según por dónde entre. */
function faltaLaTabla(e: any): boolean {
  const msg = String(e?.message ?? e).toLowerCase();
  const code = String(e?.code ?? '').toLowerCase();
  return code === '42p01' || code === 'pgrst205' || msg.includes('does not exist');
}

export type LecturaConfigTique = {
  config: TiqueConfig;
  formatos: FormatoTique[];
  asignaciones: Record<string, string>;
  foliosFormatos: Record<string, string>;
  sinTabla: boolean;
  error?: string;
};

/**
 * Lee la configuración entera del ticket, incluyendo todos los formatos
 * disponibles y a qué listeros están asignados.
 */
export async function leerConfigTique(): Promise<LecturaConfigTique> {
  try {
    const { data, error } = await supabase.from(TABLA).select('campos, logos, papel').eq('id', true).maybeSingle();
    if (error) throw error;
    const configBase = normalizarConfig(data);
    const { formatos, asignaciones, foliosFormatos } = normalizarFormatos(data, configBase);
    return {
      config: configBase,
      formatos,
      asignaciones,
      foliosFormatos,
      sinTabla: false,
    };
  } catch (e: any) {
    const configDef = CONFIG_POR_DEFECTO;
    const { formatos, asignaciones, foliosFormatos } = normalizarFormatos(null, configDef);
    if (faltaLaTabla(e)) {
      return { config: configDef, formatos, asignaciones, foliosFormatos, sinTabla: true };
    }
    return { config: configDef, formatos, asignaciones, foliosFormatos, sinTabla: false, error: String(e?.message ?? e) };
  }
}

/**
 * Guarda la configuración entera. Es UNA sola fila para todo el sistema, así que
 * es un upsert sobre `id = true`.
 *
 * Se normaliza otra vez antes de escribir: así el folio no se puede apagar ni
 * mandando la fila a mano desde otro sitio.
 */
export async function guardarConfigTique(
  c: TiqueConfig,
  uid: string | null,
  opciones?: {
    formatos?: FormatoTique[];
    asignaciones?: Record<string, string>;
    foliosFormatos?: Record<string, string>;
  },
): Promise<{ error?: string; sinTabla?: boolean }> {
  const limpia = normalizarConfig(c);

  // Asegurar formatos y asignaciones normalizadas
  const fmtsLimpios = (opciones?.formatos && opciones.formatos.length > 0)
    ? opciones.formatos.map((f, idx) => ({
        id: String(f.id || `fmt_${Date.now()}_${idx}`).trim(),
        nombre: String(f.nombre || `Formato ${idx + 1}`).trim(),
        esDefecto: f.esDefecto === true,
        config: normalizarConfig(f.config),
        listeroIds: Array.isArray(f.listeroIds) ? f.listeroIds.map(String).map((s) => s.trim()).filter(Boolean) : [],
      }))
    : [crearFormatoDefecto(limpia)];

  // El formato por defecto siempre sincronizado con las columnas raíz de forma segura
  const def = fmtsLimpios.find((f) => f.esDefecto) || fmtsLimpios[0];
  def.config = normalizarConfig(def.config);

  // Preservar datos adicionales en `campos` (como combustibleTarasDia) si ya existen
  let extraCampos: Record<string, any> = {};
  try {
    const { data: prev } = await supabase.from(TABLA).select('campos').eq('id', true).maybeSingle();
    if (prev?.campos && typeof prev.campos === 'object' && (prev.campos as any).combustibleTarasDia) {
      extraCampos.combustibleTarasDia = (prev.campos as any).combustibleTarasDia;
    }
  } catch { /* ignorar */ }

  const fila = {
    id: true,
    // ⚠️ LOS TEXTOS A MANO VIAJAN DENTRO DEL MISMO JSONB `campos` (clave
    //    `textos`), a propósito: la tabla no necesita columna nueva ni SQL, y
    //    una app vieja los ignora sin romperse (solo lee las claves conocidas).
    //    `normalizarConfig` los saca de ahí al leer. Si algún día se mudan a su
    //    columna, la lectura ya acepta las dos formas.
    campos: { ...extraCampos, ...limpia.campos, textos: limpia.textos, pesosUnidad: limpia.pesosUnidad } as any,
    logos: limpia.logos,
    papel: limpia.papel,
    updated_by: uid,
    updated_at: new Date().toISOString(),
  };
  fila.campos.formatos = fmtsLimpios;
  fila.campos.asignaciones = opciones?.asignaciones ?? {};
  fila.campos.foliosFormatos = opciones?.foliosFormatos ?? {};

  const { error } = await supabase.from(TABLA).upsert(fila, { onConflict: 'id' });
  if (error) return { error: error.message, sinTabla: faltaLaTabla(error) };
  return {};
}

/**
 * Registra o actualiza de forma liviana el formato con el que se emitieron
 * ciertos tickets (por folio), sin tener que reescribir toda la configuración.
 */
export async function registrarFoliosFormatosEnBase(
  pares: { folio: string; formatoNombreOId: string }[],
  uid: string | null,
): Promise<void> {
  if (!pares || pares.length === 0) return;
  try {
    const { data } = await supabase.from(TABLA).select('campos, logos, papel').eq('id', true).maybeSingle();
    if (!data) return;
    const dc = (data.campos && typeof data.campos === 'object') ? { ...data.campos } : {};
    const actuales: Record<string, string> = (dc.foliosFormatos && typeof dc.foliosFormatos === 'object')
      ? { ...dc.foliosFormatos }
      : {};
    let huboCambio = false;
    pares.forEach(({ folio, formatoNombreOId }) => {
      const f = String(folio ?? '').trim();
      const fmt = String(formatoNombreOId ?? '').trim();
      if (f && fmt && actuales[f] !== fmt) {
        actuales[f] = fmt;
        huboCambio = true;
      }
    });
    if (!huboCambio) return;
    dc.foliosFormatos = actuales;
    await supabase.from(TABLA).update({
      campos: dc,
      updated_by: uid,
      updated_at: new Date().toISOString(),
    }).eq('id', true);
  } catch {
    // Si falla no bloquea la impresión
  }
}

// ── ⛽ COMBUSTIBLE POR DÍA EN TARA DE ROMANA / REPORTE DE TARAS ──────────────
const CLAVE_COMBUSTIBLE_TARAS = 'taras.combustible.porDia.v1';

export type CombustibleTaraEntry = {
  litros: number;
  updatedByNombre?: string | null;
  updatedAt?: string;
};

type MapaCombustiblePorDia = Record<string, Record<string, CombustibleTaraEntry>>;

async function leerMapaLocalCombustible(): Promise<MapaCombustiblePorDia> {
  try {
    const raw = await AsyncStorage.getItem(CLAVE_COMBUSTIBLE_TARAS);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function guardarMapaLocalCombustible(mapa: MapaCombustiblePorDia): Promise<void> {
  try {
    await AsyncStorage.setItem(CLAVE_COMBUSTIBLE_TARAS, JSON.stringify(mapa));
  } catch { /* ignorar */ }
}

function normalizarDiaCombustible(rawDia: any): Record<string, CombustibleTaraEntry> {
  const out: Record<string, CombustibleTaraEntry> = {};
  if (!rawDia || typeof rawDia !== 'object') return out;
  Object.entries(rawDia).forEach(([machineryId, val]: [string, any]) => {
    const litros = typeof val === 'number' ? val : Number(val?.litros);
    if (Number.isFinite(litros) && litros > 0) {
      out[machineryId] = {
        litros: Math.round(litros * 10) / 10,
        updatedByNombre: val?.updatedByNombre ?? null,
        updatedAt: val?.updatedAt ?? undefined,
      };
    }
  });
  return out;
}

/**
 * Lee las cantidades de combustible (L) asignadas a cada maquinaria para `fechaISO` (AAAA-MM-DD).
 * Combina lo guardado en el dispositivo y lo sincronizado en `tique_config.campos.combustibleTarasDia`.
 */
export async function leerCombustibleTarasDia(
  fechaISO: string,
): Promise<Record<string, CombustibleTaraEntry>> {
  const localMapa = await leerMapaLocalCombustible();
  const localDia = normalizarDiaCombustible(localMapa[fechaISO]);
  try {
    const { data, error } = await supabase.from(TABLA).select('campos').eq('id', true).maybeSingle();
    if (!error && data?.campos && typeof data.campos === 'object') {
      const remotos = (data.campos as any).combustibleTarasDia;
      if (remotos && typeof remotos === 'object') {
        const remotoDia = normalizarDiaCombustible(remotos[fechaISO]);
        const combinado = { ...localDia, ...remotoDia };
        localMapa[fechaISO] = combinado;
        await guardarMapaLocalCombustible(localMapa);
        return combinado;
      }
    }
  } catch {
    // Si falla la red, devolvemos lo local
  }
  return localDia;
}

/**
 * Guarda o quita (`litros === null` o `<= 0`) la cantidad de combustible en litros
 * de una maquinaria para un día específico (`fechaISO`, AAAA-MM-DD).
 */
export async function guardarCombustibleTaraCamion(
  fechaISO: string,
  machineryId: string,
  litros: number | null,
  uid: string | null,
  userName: string | null,
): Promise<{ error?: string }> {
  if (!fechaISO || !/^\d{4}-\d{2}-\d{2}$/.test(fechaISO)) {
    return { error: 'Selecciona una fecha válida (AAAA-MM-DD).' };
  }
  if (!machineryId) {
    return { error: 'Falta seleccionar la maquinaria.' };
  }
  const nowISO = new Date().toISOString();
  const entry: CombustibleTaraEntry | null =
    litros != null && Number.isFinite(litros) && litros > 0
      ? { litros: Math.round(litros * 10) / 10, updatedByNombre: userName, updatedAt: nowISO }
      : null;

  const localMapa = await leerMapaLocalCombustible();
  const diaActual = normalizarDiaCombustible(localMapa[fechaISO]);
  if (entry) {
    diaActual[machineryId] = entry;
  } else {
    delete diaActual[machineryId];
  }
  localMapa[fechaISO] = diaActual;
  await guardarMapaLocalCombustible(localMapa);

  try {
    const { data } = await supabase.from(TABLA).select('campos').eq('id', true).maybeSingle();
    if (data) {
      const dc = (data.campos && typeof data.campos === 'object') ? { ...(data.campos as any) } : {};
      const todosDias = (dc.combustibleTarasDia && typeof dc.combustibleTarasDia === 'object')
        ? { ...dc.combustibleTarasDia }
        : {};
      const remotoDia = normalizarDiaCombustible(todosDias[fechaISO]);
      if (entry) {
        remotoDia[machineryId] = entry;
      } else {
        delete remotoDia[machineryId];
      }
      todosDias[fechaISO] = remotoDia;
      dc.combustibleTarasDia = todosDias;
      await supabase.from(TABLA).update({
        campos: dc,
        updated_by: uid,
        updated_at: nowISO,
      }).eq('id', true);
    }
  } catch {
    // Queda guardado localmente en el dispositivo aunque falle la red
  }
  return {};
}

