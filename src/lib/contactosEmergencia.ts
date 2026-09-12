// VARIOS CONTACTOS DE EMERGENCIA POR TRABAJADOR (08-sep-2026).
//
// Pedido del cliente: «necesito que las personas puedan tener más de un contacto
// de emergencia». Hasta hoy la ficha tenía UN solo contacto, en tres columnas
// planas de `employees`: emergency_contact_name / _phone / _relation.
//
// CÓMO SE GUARDA, Y POR QUÉ ASÍ
// ---------------------------------------------------------------------------
// La lista completa va en UNA columna nueva `employees.emergency_contacts` (jsonb),
// y el PRIMER contacto se sigue copiando a las tres columnas viejas.
//
// Esa copia no es redundancia por descuido: las tres columnas viejas las leen la
// vista/RPC de nómina (supabase/fix_rls_anon_nomina.sql:199-217 y
// supabase/schema.sql:2380-2386) y el PDF de la ficha. Si se dejaran de escribir,
// esos reportes empezarían a salir en blanco sin que nadie se entere. Mientras se
// escriban las dos cosas, todo lo viejo sigue funcionando igual.
//
// Y AL REVÉS: los ~200 empleados que YA existen tienen su contacto en las columnas
// viejas y `emergency_contacts` vacío. `leerContactos` los reconstruye AL LEER, así
// que no hace falta ninguna migración de datos: el día que se corra el SQL, todo el
// mundo ya tiene su contacto nº 1 sin haber tocado una sola fila.
//
// Si el SQL todavía no se corrió, la app guarda igual: el formulario reintenta sin
// la columna nueva y solo se conserva el primer contacto (lo mismo que había antes).

export type ContactoEmergencia = {
  nombre: string;
  telefono: string;
  parentesco: string;
};

/** Tope de contactos por persona. Más que esto ya no es una ficha, es una agenda. */
export const MAX_CONTACTOS = 5;

/** La columna nueva. La agrega supabase/empleados_varios_contactos_emergencia.sql. */
export const COLUMNA_CONTACTOS = 'emergency_contacts';

/** Las tres columnas viejas, que se siguen escribiendo con el contacto nº 1. */
export const COLUMNAS_LEGADO = ['emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relation'] as const;

const txt = (v: unknown): string => String(v ?? '').trim();

export const contactoVacio = (c: ContactoEmergencia | null | undefined): boolean =>
  !c || (!txt(c.nombre) && !txt(c.telefono) && !txt(c.parentesco));

/** Un contacto con sus tres campos normalizados (sin nulos ni espacios sobrantes). */
export function normalizarContacto(c: any): ContactoEmergencia {
  return { nombre: txt(c?.nombre), telefono: txt(c?.telefono), parentesco: txt(c?.parentesco) };
}

/** Quita los vacíos, normaliza y corta al tope. */
export function limpiarContactos(lista: any): ContactoEmergencia[] {
  if (!Array.isArray(lista)) return [];
  return lista.map(normalizarContacto).filter((c) => !contactoVacio(c)).slice(0, MAX_CONTACTOS);
}

export type EmpleadoConContactos = {
  emergency_contacts?: any;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  emergency_contact_relation?: string | null;
};

/**
 * TODOS los contactos de una persona, en orden.
 *
 * Si la columna nueva trae algo, manda ella. Si viene vacía (empleado viejo, o el
 * SQL sin correr), se reconstruye el contacto nº 1 con las tres columnas de antes.
 * Acepta también la columna como TEXTO, porque PostgREST puede devolver el jsonb
 * ya parseado o como cadena según cómo se pida.
 */
export function leerContactos(emp: EmpleadoConContactos | null | undefined): ContactoEmergencia[] {
  if (!emp) return [];
  let crudo: any = emp.emergency_contacts;
  if (typeof crudo === 'string') {
    try { crudo = JSON.parse(crudo); } catch { crudo = null; }
  }
  const nuevos = limpiarContactos(crudo);
  if (nuevos.length) return nuevos;
  const viejo = normalizarContacto({
    nombre: emp.emergency_contact_name,
    telefono: emp.emergency_contact_phone,
    parentesco: emp.emergency_contact_relation,
  });
  return contactoVacio(viejo) ? [] : [viejo];
}

/**
 * Lo que hay que ESCRIBIR en la fila: la lista completa en la columna nueva y el
 * contacto nº 1 espejado en las tres viejas (null si ya no hay ninguno, para que
 * borrar el último contacto de verdad lo borre y no deje el rastro anterior).
 */
export function contactosParaGuardar(lista: any): Record<string, any> {
  const cs = limpiarContactos(lista);
  const primero = cs[0];
  return {
    emergency_contacts: cs,
    emergency_contact_name: primero ? primero.nombre || null : null,
    emergency_contact_phone: primero ? primero.telefono || null : null,
    emergency_contact_relation: primero ? primero.parentesco || null : null,
  };
}

/** Una línea legible: "MARÍA PÉREZ · 0412-1234567 (Madre)". */
export function contactoEnPalabras(c: ContactoEmergencia): string {
  const n = txt(c.nombre) || 'Sin nombre';
  const t = txt(c.telefono);
  const p = txt(c.parentesco);
  return n + (t ? ' · ' + t : '') + (p ? ' (' + p + ')' : '');
}

/** Rótulo del contacto nº i: el primero es el principal. */
export function tituloContacto(i: number, total: number): string {
  if (total <= 1) return 'Contacto de emergencia';
  return i === 0 ? 'Contacto principal' : 'Contacto ' + (i + 1);
}

/**
 * Columnas que llegaron por migración y pueden faltar en la base. Si el insert falla
 * por una de ellas, la pantalla reintenta sin esa columna. Mismo patrón que
 * src/lib/salidaVehiculo.ts.
 */
export const PASOS_SIN_MIGRACION: { archivo: string; detecta: RegExp; columnas: string[] }[] = [
  { archivo: 'supabase/empleados_varios_contactos_emergencia.sql', detecta: /emergency_contacts|column/i, columnas: ['emergency_contacts'] },
];

/** Copia del objeto sin esas columnas (no toca el original). */
export function quitarColumnas(fila: Record<string, unknown>, columnas: string[]): Record<string, unknown> {
  const fuera = new Set(columnas);
  const copia: Record<string, unknown> = {};
  for (const k of Object.keys(fila)) if (!fuera.has(k)) copia[k] = fila[k];
  return copia;
}
