// CONTACTOS DE COCINA: lo que lee y escribe en la base (21-sep-2026).
// Las reglas (cédula, duplicados, validación, buscador) viven en comidaContactos.ts.
//
// ⚠️ Toda escritura pide .select() de vuelta: con RLS, un «no tienes permiso» llega
//    como 0 filas y SIN error. Sin contar las filas, la pantalla diría «✅ listo» a
//    algo que no se guardó.
//
// ⚠️ LA LECTURA LANZA si falla. Una lista vacía diría «no hay contactos», y con eso
//    alguien crearía de nuevo a una persona que ya está registrada — justo lo que
//    todo este módulo existe para evitar.
import { supabase, selectAllRows } from './supabase';
import {
  ContactoCocina, DatosContacto, FichaNomina, Hallazgo,
  dictamenCedula, limpiarTexto, normalizarCedula,
} from './comidaContactos';

/** Falta correr `sql-comida-contactos-2026-09-21.sql`. Se dice con esas palabras:
 *  «revisa la conexión» mandaría a mirar donde no está el problema. */
export const SIN_TABLA_CONTACTOS =
  'Falta correr el SQL de contactos de cocina en Supabase (sql-comida-contactos-2026-09-21.sql). Avisa al administrador.';

export const SIN_PERMISO_CONTACTOS =
  'No se guardó: hace falta permiso de escritura o completo en Distribución de comida.';

/** ¿El error es «esa tabla no existe»? Mismo criterio que el resto del sistema. */
export function faltaLaTablaContactos(e: any): boolean {
  const msg = String(e?.message ?? e).toLowerCase();
  const code = String(e?.code ?? '').toLowerCase();
  return code === '42p01' || code === 'pgrst205' || code === 'pgrst204'
    || msg.includes('does not exist') || msg.includes('schema cache');
}

const COLUMNAS = 'id, nombre, apellido, cedula, telefono1, telefono2, company_id, cobrar_a, nota, activo, created_at, created_by_nombre';

function aContacto(r: any): ContactoCocina {
  return {
    id: String(r.id),
    nombre: limpiarTexto(r.nombre),
    apellido: limpiarTexto(r.apellido),
    cedula: limpiarTexto(r.cedula) || null,
    telefono1: limpiarTexto(r.telefono1) || null,
    telefono2: limpiarTexto(r.telefono2) || null,
    company_id: r.company_id ? String(r.company_id) : null,
    cobrar_a: r.cobrar_a === 'independiente' ? 'independiente' : 'empresa',
    nota: limpiarTexto(r.nota) || null,
    activo: r.activo !== false,
  };
}

/** Lo que se manda a la base. Los vacíos van como NULL, no como '': una cadena vacía
 *  en la cédula haría que `cedula_norm` fuera nulo igual, pero un '' en el teléfono
 *  se vería como «tiene teléfono» en cualquier consulta futura. */
function aFila(d: DatosContacto) {
  return {
    nombre: limpiarTexto(d.nombre),
    apellido: limpiarTexto(d.apellido),
    cedula: d.sinCedula ? null : (limpiarTexto(d.cedula) || null),
    telefono1: limpiarTexto(d.telefono1) || null,
    telefono2: limpiarTexto(d.telefono2) || null,
    company_id: limpiarTexto(d.companyId) || null,
    nota: limpiarTexto(d.nota) || null,
  };
}

/**
 * Todos los contactos, también los quitados de la lista: sus entregas viejas se
 * siguen cobrando y su nombre tiene que poder mostrarse.
 *
 * `sinTabla` en vez de lanzar: la pantalla lo dice una vez y sigue funcionando para
 * todo lo demás, en vez de quedarse en blanco hasta que alguien corra el SQL.
 */
export async function cargarContactos(): Promise<{ contactos: ContactoCocina[]; sinTabla: boolean }> {
  try {
    const rows = await selectAllRows('comida_contactos', COLUMNAS);
    return { contactos: (rows as any[]).map(aContacto), sinTabla: false };
  } catch (e: any) {
    if (faltaLaTablaContactos(e)) return { contactos: [], sinTabla: true };
    throw e;
  }
}

/**
 * LA CÉDULA EN LA NÓMINA. Se consulta contra `employees`, no contra la agenda.
 *
 * ⚠️ Compara por los DÍGITOS y no por el texto: en `employees` la cédula está escrita
 *    a mano de mil maneras («V-12345678», «12.345.678»), y un `.eq()` solo encontraría
 *    la que coincida letra por letra. Por eso se pide el lote por el sufijo y se filtra
 *    acá. Devuelve null si no está, y LANZA si no se pudo leer: dar «no está» cuando
 *    en realidad no se supo es lo que crearía el contacto duplicado.
 */
export async function buscarEnNomina(cedula: unknown): Promise<FichaNomina | null> {
  const d = normalizarCedula(cedula);
  if (!d) return null;
  const { data, error } = await supabase
    .from('employees')
    .select('id, first_name, last_name, cedula, cargo, company:company_id(name)')
    .ilike('cedula', `%${d.slice(-7)}%`)
    .limit(50);
  if (error) throw new Error(error.message);
  const fila = (data as any[] | null)?.find((e) => normalizarCedula(e?.cedula) === d);
  if (!fila) return null;
  return {
    id: String(fila.id),
    nombre: `${limpiarTexto(fila.first_name)} ${limpiarTexto(fila.last_name)}`.trim() || 'Sin nombre',
    empresa: fila.company?.name ? limpiarTexto(fila.company.name) : null,
    cargo: limpiarTexto(fila.cargo) || null,
  };
}

/**
 * EL RECONOCIMIENTO COMPLETO: busca en la nómina y en la agenda, y dice qué hacer.
 *
 * La lista de contactos viene de afuera (ya cargada en la pantalla) para no volver a
 * leerla en cada tecla. La nómina sí se consulta, porque son miles de fichas.
 */
export async function reconocerCedula(
  cedula: unknown,
  contactos: readonly ContactoCocina[] | null | undefined,
): Promise<Hallazgo> {
  const enNomina = await buscarEnNomina(cedula);
  return dictamenCedula(cedula, enNomina, contactos);
}

/** El mensaje de un fallo al guardar, en criollo. La cédula repetida es el caso que
 *  de verdad se ve: dos personas creando al mismo tipo desde dos teléfonos. */
function motivoDeError(e: any): string {
  if (!e) return SIN_PERMISO_CONTACTOS;
  if (String(e.code ?? '') === '23505') {
    return 'Ya hay un contacto con esa cédula. Búscalo en la lista en vez de crear otro.';
  }
  if (String(e.code ?? '') === '23514') {
    return 'Faltan datos: sin cédula hace falta al menos un teléfono.';
  }
  if (faltaLaTablaContactos(e)) return SIN_TABLA_CONTACTOS;
  return String(e.message ?? e);
}

export async function crearContacto(
  d: DatosContacto,
  quien?: { id?: string | null; nombre?: string | null },
): Promise<{ contacto?: ContactoCocina; error?: string }> {
  const { data, error } = await supabase
    .from('comida_contactos')
    .insert({
      ...aFila(d),
      created_by: quien?.id || null,
      created_by_nombre: limpiarTexto(quien?.nombre) || null,
    })
    .select(COLUMNAS);
  if (error) return { error: motivoDeError(error) };
  const fila = (data as any[] | null)?.[0];
  if (!fila) return { error: SIN_PERMISO_CONTACTOS };
  return { contacto: aContacto(fila) };
}

export async function actualizarContacto(
  id: string,
  d: DatosContacto,
): Promise<{ contacto?: ContactoCocina; error?: string }> {
  const { data, error } = await supabase
    .from('comida_contactos')
    .update(aFila(d))
    .eq('id', id)
    .select(COLUMNAS);
  if (error) return { error: motivoDeError(error) };
  const fila = (data as any[] | null)?.[0];
  if (!fila) return { error: SIN_PERMISO_CONTACTOS };
  return { contacto: aContacto(fila) };
}

/**
 * A quién se le cobra por defecto lo que pida. Va aparte de `actualizarContacto`
 * porque es el interruptor de una sola cosa y así queda una fila propia en la
 * bitácora: «le cambiaron a quién se le cobra», que es lo que se va a ir a buscar
 * cuando alguien discuta una factura.
 */
export async function cambiarCobrarA(id: string, cobrarA: 'empresa' | 'independiente'): Promise<{ error?: string }> {
  const { data, error } = await supabase
    .from('comida_contactos')
    .update({ cobrar_a: cobrarA })
    .eq('id', id)
    .select('id');
  if (error) return { error: motivoDeError(error) };
  if (!data?.length) return { error: SIN_PERMISO_CONTACTOS };
  return {};
}

/** Quitar de la lista (false) o devolver a la lista (true). NUNCA se borra: la base
 *  tampoco deja, porque sus entregas quedarían sin dueño. */
export async function cambiarListaContacto(id: string, activo: boolean): Promise<{ error?: string }> {
  const { data, error } = await supabase
    .from('comida_contactos')
    .update({ activo })
    .eq('id', id)
    .select('id');
  if (error) return { error: motivoDeError(error) };
  if (!data?.length) return { error: SIN_PERMISO_CONTACTOS };
  return {};
}
