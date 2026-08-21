// ============================================================================
// BUSCADOR DE EMPLEADOS — qué se puede escribir en la caja de búsqueda.
//
// POR QUÉ EXISTE
// ---------------------------------------------------------------------------
// La condición estaba escrita a mano dentro de `EmpleadosScreen`, metida en un
// `useMemo` junto con el filtro de estado. Al reportar el cliente (21-ago-2026)
// que «el buscador solo me deja buscar empresas, pero no me deja buscar al
// empleado por alguna información de su ficha» no había forma de PROBARLO: había
// que abrir la app y teclear. Acá vive la regla sola, sin React ni Supabase, y
// `scripts/test-empleados-buscar.mjs` la amarra.
//
// QUÉ SE BUSCA
// ---------------------------------------------------------------------------
// TODO lo que identifica a la persona en su ficha, no solo el nombre: nombre y
// apellido (juntos o por separado, y en cualquier orden), cédula, número de
// ficha, cargo, departamento, grupo/zona, teléfono, correo y el titular de la
// cuenta bancaria — más las dos empresas (la real y la de filtro de nómina).
//
// La comparación pasa por `norm`, así que NO importan mayúsculas, tildes ni los
// espacios de más. "josé" encuentra a JOSE PEREZ.
// ============================================================================

import { norm } from './text';

/** Lo que el buscador necesita de un empleado. Todo opcional: una ficha a medio
 *  llenar tiene que poder buscarse igual por lo poco que tenga. */
export type EmpleadoBuscable = {
  first_name?: string | null;
  last_name?: string | null;
  cedula?: string | null;
  ficha_number?: string | null;
  cargo?: string | null;
  department?: string | null;
  grupo?: string | null;
  phone?: string | null;
  email?: string | null;
  bank_holder?: string | null;
  bank_account?: string | null;
};

/**
 * Texto contra el que se compara lo que se escribe. Se arma UNA sola cadena con
 * todo junto, en vez de comparar campo por campo, porque así "PEREZ JUAN"
 * encuentra a "JUAN PEREZ": los pedazos de la búsqueda se pueden buscar en
 * cualquier orden (ver `coincideEmpleado`).
 *
 * `empresas` son los nombres YA RESUELTOS (la pantalla los saca de sus tablas):
 * la empresa real y la de filtro de nómina.
 */
export function textoBuscableEmpleado(e: EmpleadoBuscable, empresas: (string | null | undefined)[] = []): string {
  const partes = [
    e.first_name, e.last_name,
    e.cedula, e.ficha_number,
    e.cargo, e.department, e.grupo,
    e.phone, e.email,
    e.bank_holder, e.bank_account,
    ...empresas,
  ];
  return norm(partes.filter(Boolean).join(' '));
}

/**
 * ¿Este empleado coincide con lo que se escribió?
 *
 * La búsqueda se parte en PALABRAS y tienen que estar TODAS (en cualquier orden
 * y en cualquier campo). O sea:
 *   · "juan perez"  → encuentra a JUAN PEREZ
 *   · "perez juan"  → también (antes NO: se comparaba la frase completa contra
 *                     "juan perez" y fallaba)
 *   · "perez 279"   → encuentra a PEREZ con cédula 27904754
 *   · "obrero 0207" → cruza cargo con número de ficha
 *
 * Sin texto escrito, pasa todo el mundo.
 */
export function coincideEmpleado(e: EmpleadoBuscable, query: string, empresas: (string | null | undefined)[] = []): boolean {
  const q = norm(String(query ?? '').trim());
  if (!q) return true;
  const heno = textoBuscableEmpleado(e, empresas);
  return q.split(/\s+/).filter(Boolean).every((palabra) => heno.includes(palabra));
}
