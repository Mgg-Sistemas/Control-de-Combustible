// 👤 QUIÉN LO SOLICITÓ, QUIÉN LO AUTORIZÓ, PARA QUÉ Y PARA QUÉ ÁREA (20-oct-2026).
//
// Pedido del cliente, textual: «para ese formato necesito colocar también quién
// lo solicitó y que sea de la lista de la nómina, pero SIN TOCAR NÓMINA NI NADA,
// y si no existe lo pueda escribir y se guarde en contactos. También quién lo
// autorizó. También seleccionar si es para vehículo o maquinaria. También poder
// seleccionar el área al que va dirigido, que si administración, cocina, etc. Y
// al final un espacio de observaciones».
//
// REGLA PURA: ni React ni Supabase. El formulario del requerimiento es el papel
// que firma el jefe; quién pidió y quién autorizó no pueden depender de que
// alguien lea bien un `useMemo`.
//
// LO QUE FIJA, Y POR QUÉ DUELE SI SE ROMPE:
//  · LA NÓMINA SOLO SE LEE. `employees` no se escribe nunca desde acá: la ficha
//    elegida se copia (nombre + id suelto, sin llave foránea). Si mañana sale de
//    nómina, el requerimiento viejo sigue diciendo quién lo pidió.
//  · EL NOMBRE ESCRITO A MANO VA A CONTACTOS, NO A NÓMINA. Es el catálogo de
//    Compras/Ventas, el mismo `filaContacto` que usa el formulario de contactos:
//    si cada puerta armara su fila, el mismo señor quedaría escrito distinto
//    según por dónde entró.
//  · NO SE DUPLICA A QUIEN YA ESTÁ. Antes de crear el contacto se compara el
//    nombre normalizado contra la nómina Y contra los contactos existentes.
//  · «SOLICITA» (el usuario que lo registró) Y «SOLICITADO POR» (la persona
//    declarada) SON DOS COSAS. El sistema ya guardaba el primero
//    (`requested_by_name`); este módulo agrega el segundo. Mezclarlos borraría
//    el dato que el jefe necesita: quién pidió el repuesto, no quién lo tecleó.
import { norm } from './text';
import { filaContacto, limpiarNombre, partirNombre, type ContactoRow } from './contactos';

// ── ¿PARA QUÉ ES? ────────────────────────────────────────────────────────────
export type DestinoReq = 'maquinaria' | 'vehiculo';

export const DESTINOS: { key: DestinoReq; chip: string; label: string }[] = [
  { key: 'maquinaria', chip: '🚜 Maquinaria', label: 'Maquinaria' },
  { key: 'vehiculo', chip: '🚐 Vehículo', label: 'Vehículo' },
];

/** Cómo se imprime el destino. Sin elegir, cadena vacía (el papel lo omite). */
export const destinoLabel = (k?: string | null): string =>
  DESTINOS.find((d) => d.key === k)?.label ?? '';

/** Lo que se guarda en la columna `destino_tipo` (o null si no eligió). */
export const destinoAGuardar = (k?: string | null): DestinoReq | null =>
  (DESTINOS.find((d) => d.key === k)?.key ?? null);

// ── LA GENTE DE LA NÓMINA (solo lectura) ─────────────────────────────────────
/** La fila de `employees` tal como la trae el select de este módulo. */
export type EmpleadoRow = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  cedula?: string | null;
  cargo?: string | null;
  department?: string | null;
  status?: string | null;
};

/** Una persona elegible, con lo poco que hace falta para buscarla y mostrarla. */
export type PersonaNomina = {
  id: string;
  nombre: string;
  cedula: string;
  cargo: string;
  area: string;
  activo: boolean;
};

/** El nombre que se imprime de una ficha: «NOMBRE APELLIDO», en mayúsculas. */
export const nombreEmpleado = (e: EmpleadoRow | null | undefined): string =>
  [limpiarNombre(e?.first_name), limpiarNombre(e?.last_name)].filter(Boolean).join(' ');

/**
 * La nómina lista para elegir: ACTIVOS primero (es a quien se le pide algo hoy),
 * y dentro de cada grupo A→Z. Las fichas sin nombre no entran: una pastilla en
 * blanco no se puede ni tocar ni entender.
 */
export function personasDeNomina(rows: readonly EmpleadoRow[] | null | undefined): PersonaNomina[] {
  const out: PersonaNomina[] = [];
  for (const e of rows ?? []) {
    const nombre = nombreEmpleado(e);
    if (!nombre || !e?.id) continue;
    out.push({
      id: String(e.id),
      nombre,
      cedula: String(e.cedula ?? '').trim(),
      cargo: limpiarNombre(e.cargo),
      area: limpiarNombre(e.department),
      activo: String(e.status ?? '').trim().toLowerCase() === 'activo',
    });
  }
  return out.sort((a, b) =>
    (a.activo === b.activo ? 0 : a.activo ? -1 : 1)
    || a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
}

/** Busca por nombre, cédula, cargo o área — sin distinguir mayúsculas ni acentos. */
export function buscarPersonas(
  lista: readonly PersonaNomina[] | null | undefined,
  texto?: string | null,
): PersonaNomina[] {
  const t = norm(String(texto ?? '').trim());
  const todas = [...(lista ?? [])];
  if (!t) return todas;
  return todas.filter((p) => norm(`${p.nombre} ${p.cedula} ${p.cargo} ${p.area}`).includes(t));
}

// ── EL ÁREA A LA QUE VA DIRIGIDO ─────────────────────────────────────────────
/**
 * Las áreas que se ofrecen: las de la nómina (`employees.department`) más las
 * que ya se usaron en requerimientos anteriores, sin repetir y A→Z.
 *
 * ⭐ NO HAY CATÁLOGO NUEVO: el área sale de lo que la empresa YA tiene escrito.
 *    Inventar una tabla de áreas habría obligado a mantener dos listas que se
 *    desincronizan en la primera semana.
 */
export function areasSugeridas(
  deNomina: readonly (string | null | undefined)[] | null | undefined,
  yaUsadas: readonly (string | null | undefined)[] | null | undefined = [],
): string[] {
  const vistas = new Set<string>();
  const out: string[] = [];
  for (const v of [...(deNomina ?? []), ...(yaUsadas ?? [])]) {
    const a = limpiarNombre(v);
    if (!a) continue;
    const k = norm(a);
    if (vistas.has(k)) continue;
    vistas.add(k);
    out.push(a);
  }
  return out.sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
}

// ── UN NOMBRE ESCRITO A MANO ─────────────────────────────────────────────────
/**
 * ¿Sirve como nombre de persona? Al menos dos letras seguidas y tres caracteres:
 * así «JP» o «12» no terminan de contacto en el catálogo de Compras.
 */
export function nombreEscritoValido(texto?: string | null): boolean {
  const n = limpiarNombre(texto);
  return n.length >= 3 && /[a-záéíóúüñ]{2}/i.test(n);
}

/** Lo mismo que ve el usuario: el nombre limpio que se guardaría. */
export const nombreEscrito = (texto?: string | null): string => limpiarNombre(texto);

/**
 * ¿Ese nombre YA está, en la nómina o en contactos? Devuelve de dónde, para
 * poder decirlo en pantalla en vez de crear un duplicado en silencio.
 */
export function nombreYaExiste(
  texto: string | null | undefined,
  personas: readonly PersonaNomina[] | null | undefined,
  contactos: readonly Pick<ContactoRow, 'id' | 'name'>[] | null | undefined,
): { donde: 'nomina'; persona: PersonaNomina } | { donde: 'contactos'; id: string; name: string } | null {
  const n = norm(limpiarNombre(texto));
  if (!n) return null;
  const p = (personas ?? []).find((x) => norm(x.nombre) === n);
  if (p) return { donde: 'nomina', persona: p };
  const c = (contactos ?? []).find((x) => norm(limpiarNombre(x.name)) === n);
  if (c) return { donde: 'contactos', id: String(c.id), name: String(c.name) };
  return null;
}

/**
 * La fila de `contactos` para un nombre escrito a mano. Va SIN documento (es
 * opcional en el catálogo) y sin marcar cliente ni proveedor: es una persona que
 * pidió algo, no alguien a quien se le compra o se le vende.
 *
 * ⭐ Usa `filaContacto` de contactos.ts — la MISMA función del formulario de
 *    contactos, para que el nombre quede escrito igual venga por donde venga.
 */
export function contactoDesdeNombre(texto?: string | null): ReturnType<typeof filaContacto> | null {
  if (!nombreEscritoValido(texto)) return null;
  const { nombre, apellido } = partirNombre(limpiarNombre(texto));
  return filaContacto({ letra: 'V', numero: '', nombre, apellido });
}

// ── LO QUE SE GUARDA EN EL REQUERIMIENTO ─────────────────────────────────────
/** Quién pidió / quién autorizó: el nombre impreso + la ficha, si salió de nómina. */
export type PersonaElegida = { nombre: string | null; employeeId: string | null };

export const SIN_PERSONA: PersonaElegida = { nombre: null, employeeId: null };

export const personaDeFicha = (p: PersonaNomina): PersonaElegida =>
  ({ nombre: p.nombre, employeeId: p.id });

export const personaEscrita = (texto?: string | null): PersonaElegida =>
  ({ nombre: limpiarNombre(texto) || null, employeeId: null });

/**
 * Los campos nuevos listos para el `insert`/`update`. Todo es OPCIONAL: un
 * requerimiento sin solicitante declarado se guarda igual que siempre.
 */
export function camposRequerimiento(d: {
  solicitante?: PersonaElegida | null;
  autorizado?: PersonaElegida | null;
  destino?: string | null;
  area?: string | null;
  observaciones?: string | null;
}): {
  solicitante_nombre: string | null;
  solicitante_employee_id: string | null;
  autorizado_nombre: string | null;
  autorizado_employee_id: string | null;
  destino_tipo: DestinoReq | null;
  area: string | null;
  observaciones: string | null;
} {
  const texto = (v: any) => String(v ?? '').trim() || null;
  return {
    solicitante_nombre: limpiarNombre(d.solicitante?.nombre) || null,
    solicitante_employee_id: d.solicitante?.employeeId ?? null,
    autorizado_nombre: limpiarNombre(d.autorizado?.nombre) || null,
    autorizado_employee_id: d.autorizado?.employeeId ?? null,
    destino_tipo: destinoAGuardar(d.destino),
    area: limpiarNombre(d.area) || null,
    observaciones: texto(d.observaciones),
  };
}

/** ¿El error de Supabase es «esa columna todavía no existe»? (falta correr el SQL) */
export const faltaColumnaNueva = (msg?: string | null): boolean =>
  /solicitante|autorizado|destino_tipo|observaciones|\barea\b/i.test(String(msg ?? ''))
  && /column|does not exist|schema cache|no existe/i.test(String(msg ?? ''));
