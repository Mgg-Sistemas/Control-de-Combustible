// CICLO DE VIDA DE UNA CUENTA: NO SE BORRA, SE APAGA Y SE ARCHIVA (09-sep-2026).
//
// Pedido del cliente: «en los usuarios, se eliminan, esa opción ya no va, hay que
// trabajar como en el PDF: que no se eliminen, que se activen o desactiven, y que
// se puedan archivar».
//
// POR QUÉ BORRAR NO ERA UNA OPCIÓN
// ---------------------------------------------------------------------------
// Hay 33 claves foráneas hacia `public.profiles`. Ocho no tienen cascada
// (authorizations, dispatches, fuel_intakes, transfers, supervisor_visits,
// food_*): un solo registro bloquea el borrado para siempre. Las otras 25 son
// `on delete set null`, que es peor: el borrado SÍ pasa y deja sin autor las
// nóminas, las reparaciones, la asistencia y las dotaciones, en silencio.
// O sea que el botón de eliminar o fallaba o rompía el historial.
//
// LOS TRES ESTADOS, Y LA REGLA
// ---------------------------------------------------------------------------
//   activa  ⇄  inactiva  ⇄  archivada
// Solo se avanza de uno en uno. No se salta de activa a archivada, ni se vuelve
// de archivada a activa. Y no existe «borrada»: la fila nunca sale de la tabla.
//
// «Archivado» NO es un tercer estado paralelo a activo/inactivo: es información
// añadida a una cuenta que YA está apagada. La marca es la fecha `archivado_en`;
// no hay booleano nuevo. Eso es lo que abarata todo, porque cualquier regla que
// ya mire `active` deja fuera al archivado sin enterarse de que existe.
//
// OJO CON ESTE PROYECTO — LO QUE NO ES COMO EN EL PDF
// ---------------------------------------------------------------------------
// En el sistema del PDF las nueve funciones de autorización ya miraban `activo`.
// Aquí NO: `current_role()`, `is_staff()`, `is_admin()` y `can_write_module()`
// no consultan `profiles.active`, ni lo hace ninguna política RLS ni el login.
// Hoy un usuario «desactivado» entra igual y conserva todos sus permisos.
// Eso se cierra aparte, en el SQL 02, porque cambia comportamiento: cualquier
// cuenta que hoy esté apagada se queda sin permisos en el momento de correrlo.
//
// Mientras ese SQL no se corra, desactivar sirve para ORDENAR la lista, no para
// quitar permisos. La pantalla lo dice con esas palabras en vez de prometer algo
// que no cumple.

/** Un perfil, con lo que hace falta para saber en qué estado está. */
export type CuentaCicloVida = {
  id: string;
  full_name?: string | null;
  active?: boolean | null;
  archivado_en?: string | null;
  archivado_por?: string | null;
  archivado_motivo?: string | null;
};

export type EstadoCuenta = 'activa' | 'inactiva' | 'archivada';

/** Mínimo del motivo, en caracteres ya recortados. Igual que en el PDF. */
export const MOTIVO_MINIMO = 4;

/** Las tres columnas nuevas. Las agrega el SQL 01, que va fuera del repositorio. */
export const COLUMNAS_ARCHIVO = ['archivado_en', 'archivado_por', 'archivado_motivo'] as const;

const txt = (v: unknown): string => String(v ?? '').trim();

/**
 * En qué estado está la cuenta.
 *
 * El archivo manda sobre el resto: una cuenta archivada está SIEMPRE inactiva
 * (lo garantiza un CHECK en la base), así que si llegara una fila archivada y
 * encendida —que no puede— se lee como archivada igual, nunca como activa.
 */
export function estadoDeCuenta(u: CuentaCicloVida | null | undefined): EstadoCuenta {
  if (!u) return 'inactiva';
  if (txt(u.archivado_en)) return 'archivada';
  return u.active === false ? 'inactiva' : 'activa';
}

export const estaArchivada = (u: CuentaCicloVida | null | undefined): boolean => estadoDeCuenta(u) === 'archivada';

/** Rótulo corto del estado, para la pastilla de la fila. */
export function etiquetaEstado(u: CuentaCicloVida | null | undefined): string {
  const e = estadoDeCuenta(u);
  return e === 'archivada' ? 'Archivada' : e === 'inactiva' ? 'Inactiva' : 'Activa';
}

/** El motivo sirve si, ya recortado, dice algo. */
export const motivoValido = (m: string | null | undefined): boolean => txt(m).length >= MOTIVO_MINIMO;

/**
 * ¿Se puede archivar? Solo lo que YA está apagado, y nunca uno mismo.
 *
 * Archivar no es una forma escondida de desactivar: son dos pasos, y el de
 * apagar es el que de verdad le quita el sistema a la persona.
 */
export function puedeArchivar(u: CuentaCicloVida | null | undefined, yoId: string | null | undefined): boolean {
  if (!u) return false;
  if (u.id === txt(yoId)) return false;
  return estadoDeCuenta(u) === 'inactiva';
}

/** Por qué NO se puede archivar. Vacío si sí se puede. */
export function razonNoArchivable(u: CuentaCicloVida | null | undefined, yoId: string | null | undefined): string {
  if (!u) return 'No existe esa cuenta.';
  if (u.id === txt(yoId)) return 'No puedes archivar tu propia cuenta.';
  const e = estadoDeCuenta(u);
  if (e === 'archivada') return 'Ya está archivada.';
  if (e === 'activa') return 'Primero hay que desactivarla. Se archiva lo que ya está apagado.';
  return '';
}

/** Solo se saca del archivo lo que está archivado. */
export const puedeDesarchivar = (u: CuentaCicloVida | null | undefined): boolean => estadoDeCuenta(u) === 'archivada';

/**
 * ¿Se puede encender? Lo archivado, no: primero hay que sacarlo del archivo.
 * Es el arco prohibido del diagrama, y la base lo rechaza con un CHECK.
 */
export const puedeActivar = (u: CuentaCicloVida | null | undefined): boolean => estadoDeCuenta(u) === 'inactiva';

/** Y apagar solo tiene sentido sobre lo encendido; nunca sobre uno mismo. */
export function puedeDesactivar(u: CuentaCicloVida | null | undefined, yoId: string | null | undefined): boolean {
  if (!u) return false;
  if (u.id === txt(yoId)) return false;
  return estadoDeCuenta(u) === 'activa';
}

/**
 * Dos listas, no un filtro. Lo archivado no se mezcla con lo que trabaja: ese
 * es justamente el punto de archivar.
 */
export function partirUsuarios<T extends CuentaCicloVida>(lista: T[] | null | undefined): { enUso: T[]; archivados: T[] } {
  const enUso: T[] = [], archivados: T[] = [];
  (Array.isArray(lista) ? lista : []).forEach((u) => (estaArchivada(u) ? archivados : enUso).push(u));
  return { enUso, archivados };
}

/** Fecha corta y legible (dd/mm/aaaa). Vacío si no hay fecha o no se entiende. */
export function fechaCorta(iso: string | null | undefined): string {
  const s = txt(iso);
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * La línea que se lee dentro de un año: cuándo, quién y por qué.
 * `porNombre` lo resuelve la pantalla, porque la base guarda solo el uuid.
 */
export function lineaArchivo(u: CuentaCicloVida | null | undefined, porNombre?: string | null): string {
  if (!estaArchivada(u)) return '';
  const f = fechaCorta(u!.archivado_en);
  const quien = txt(porNombre);
  const motivo = txt(u!.archivado_motivo);
  return [
    'Archivada' + (f ? ' el ' + f : ''),
    quien ? 'por ' + quien : '',
    motivo,
  ].filter(Boolean).join(' · ');
}

/**
 * El SQL 01 crea las funciones `archivar_usuario` / `desarchivar_usuario`. Si
 * todavía no se corrió, PostgREST responde que no encuentra la función. Se
 * reconoce para poder decirlo con palabras en vez de soltar el error crudo.
 */
export function faltaElSql(mensaje: string | null | undefined): boolean {
  const m = txt(mensaje);
  if (!m) return false;
  return /archivar_usuario|desarchivar_usuario|archivado_en/i.test(m)
    && /could not find|does not exist|schema cache|no existe|404/i.test(m);
}

/** Lo que se le dice al usuario cuando falta correr el SQL. */
export const AVISO_SIN_SQL =
  'Falta correr en Supabase el SQL «01_usuarios_archivar.sql». Mientras tanto se puede activar y desactivar, pero no archivar.';

// ── PASO 06 DEL PATRÓN: quién MÁS lista usuarios ────────────────────────────
// Es la parte que se olvida. Este sistema no tiene una fuente única de usuarios:
// 48 sitios consultan `profiles` por su cuenta. Se revisaron los 48 y se
// clasificaron en tres grupos, que NO se tratan igual:
//
//   · Diccionarios id → nombre (quién firmó, quién registró): NO deben filtrar
//     nunca. Si se les añade el filtro, los documentos viejos empiezan a decir
//     «—» y se pierde el rastro. Son la mayoría, y se dejan como están.
//   · Búsquedas de uno mismo (`eq('id', uid)`): no aplica.
//   · Selectores de GENTE ELEGIBLE (asignar un supervisor, un inspector): estos
//     sí, porque ofrecer a alguien archivado es ofrecer a quien ya no trabaja.
//     Son cinco, y todos preguntan lo mismo: supervisores y coordinadores.

/** Filas que siguen en uso. Lo archivado se cae; lo que no trae la columna se queda. */
export function soloEnUso<T extends { archivado_en?: string | null }>(filas: T[] | null | undefined): T[] {
  return (Array.isArray(filas) ? filas : []).filter((f) => !txt(f?.archivado_en));
}

/**
 * ¿El error es «esa columna todavía no existe»? Pasa mientras no se corra el
 * SQL 01. Las pantallas reintentan sin la columna en vez de quedarse en blanco.
 */
export function faltaColumnaArchivo(mensaje: string | null | undefined): boolean {
  const m = txt(mensaje);
  return /archivado_en/i.test(m) && /column|schema cache|does not exist|no existe/i.test(m);
}
