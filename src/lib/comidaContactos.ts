// CONTACTOS DE COCINA (21-sep-2026). Regla pura, sin imports: la prueba la carga
// sola (scripts/test-comida-contactos.mjs).
//
// Pedido del cliente: «hay personas que vienen nuevas y piden n cantidad de comidas,
// esas personas se manejarán por facturas también desde el módulo de distribución de
// comidas […] es como crear un contacto, ese contacto sería solo para cocina».
//
// ⭐ ES UNA AGENDA APARTE, NO UNA FICHA DE NÓMINA. Vive en `comida_contactos` y no
//    tiene una sola llave hacia `employees`. No aparece en nómina, ni en asistencia,
//    ni en carnets, ni en usuarios: ahí está el «que nada de esos registros choquen
//    con nada» que pidió el cliente. Lo único que comparte con la nómina es el lugar
//    donde caen sus entregas (`food_distributions`), y ahí va por su propia columna.
//
// ⭐ LA CÉDULA ES LA LLAVE CONTRA LOS DUPLICADOS, y por eso se compara por sus
//    DÍGITOS: «V-12.345.678», «v12345678» y «12.345.678» son la misma persona. Si se
//    comparara el texto escrito, la misma persona entraría tres veces y su factura
//    saldría partida en tres pedazos.
//
// ⚠️ LA CÉDULA NO SE NEGOCIA (decisión del cliente, 21-sep-2026). Se había propuesto
//    una salida de emergencia —«no la tiene a la mano» + teléfono como llave— y el
//    cliente la descartó: «la cédula para esos contactos de cocina que sea obligatoria».
//    La BASE también la exige (`cedula not null` + al menos 5 dígitos), así que no
//    depende de que esta pantalla la pida bien: por ahí no entra nadie sin ella.

/** Una fila de `comida_contactos`. */
export type ContactoCocina = {
  id: string;
  nombre: string;
  apellido: string;
  /** Tal como se escribió («V-12.345.678»). Siempre está: la base la exige. */
  cedula: string | null;
  telefono1: string | null;
  telefono2: string | null;
  /** Empresa a la que pertenece, del catálogo `companies`. null = por su cuenta. */
  company_id: string | null;
  /** A quién se le cobra POR DEFECTO lo que pida. Solo manda si tiene empresa. */
  cobrar_a?: CobrarA | null;
  nota?: string | null;
  /** false = quitado de la lista. Sin el dato, se toma como activo. */
  activo?: boolean | null;
};

/** A quién se le cobra una entrega: a la empresa del contacto, o a él mismo. */
export type CobrarA = 'empresa' | 'independiente';

export const MAX_NOMBRE_CONTACTO = 60;
export const MAX_TELEFONO = 25;
export const MAX_NOTA_CONTACTO = 200;
/** Menos dígitos que esto no es una cédula, es un error de tecleo. Mismo criterio
 *  que la búsqueda por cédula que ya tenía la pantalla de Cocina. */
export const MIN_DIGITOS_CEDULA = 5;
/** Un teléfono venezolano tiene 11 dígitos; se admite desde 7 por si anotan el fijo
 *  sin el código de área. Menos que eso no sirve para llamar a nadie. */
export const MIN_DIGITOS_TELEFONO = 7;

/** Solo los números. La base de toda comparación de cédulas y teléfonos. */
export function soloDigitos(v: unknown): string {
  return String(v ?? '').replace(/[^0-9]/g, '');
}

/** Texto guardable: sin espacios de más y sin saltos de línea. */
export function limpiarTexto(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * LA CÉDULA PARA COMPARAR: solo sus dígitos.
 *
 * ⚠️ A propósito NO se guarda la letra. Un rato se escribe «V-12345678» y otro
 *    «12345678», y las dos veces es la misma persona parada en el mismo mostrador.
 *    La letra se conserva en lo que se escribió (`cedula`), que es lo que se imprime;
 *    para saber si ya existe manda esto.
 */
export function normalizarCedula(v: unknown): string {
  return soloDigitos(v);
}

/** La letra de la cédula si la escribieron (V, E, J, G, P). '' si no. */
export function prefijoCedula(v: unknown): string {
  const m = String(v ?? '').trim().match(/^([VvEeJjGgPp])/);
  return m ? m[1].toUpperCase() : '';
}

/** Cómo se muestra una cédula: «V-12.345.678». Sin dígitos, devuelve ''. */
export function formatearCedula(v: unknown): string {
  const d = normalizarCedula(v);
  if (!d) return '';
  const p = prefijoCedula(v);
  const conPuntos = d.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return p ? `${p}-${conPuntos}` : conPuntos;
}

/** El teléfono para comparar: solo dígitos. */
export function normalizarTelefono(v: unknown): string {
  return soloDigitos(v);
}

/** Los teléfonos que tiene cargados un contacto, normalizados y sin repetir. */
export function telefonosDe(c: ContactoCocina | null | undefined): string[] {
  const t = [normalizarTelefono(c?.telefono1), normalizarTelefono(c?.telefono2)].filter(Boolean);
  return Array.from(new Set(t));
}

/** Nombre completo, listo para mostrar e imprimir. */
export function nombreDeContacto(c: ContactoCocina | null | undefined): string {
  const n = `${limpiarTexto(c?.nombre)} ${limpiarTexto(c?.apellido)}`.trim();
  return n || 'Sin nombre';
}

/** Activo = sale en la lista de la cocina. Sin el dato, se toma como activo. */
export const contactoActivo = (c: ContactoCocina) => c?.activo !== false;

/**
 * A QUIÉN SE LE COBRA DE VERDAD.
 *
 * ⚠️ Sin empresa no hay a quién pasarle la cuenta: la preferencia «empresa» de un
 *    contacto que se quedó sin empresa no puede dejar la comida sin cobrar. Por eso
 *    acá manda el hecho (tiene o no tiene empresa) sobre lo que diga la ficha.
 */
export function cobrarAEfectivo(c: ContactoCocina | null | undefined): CobrarA {
  if (!c || !limpiarTexto(c.company_id)) return 'independiente';
  return c.cobrar_a === 'independiente' ? 'independiente' : 'empresa';
}

// ── BUSCAR SIN DUPLICAR ─────────────────────────────────────────────────────

/** El contacto que ya tiene esa cédula (por sus dígitos), o null. */
export function contactoConCedula(
  contactos: readonly ContactoCocina[] | null | undefined,
  cedula: unknown,
): ContactoCocina | null {
  const d = normalizarCedula(cedula);
  if (!d) return null;
  let inactivo: ContactoCocina | null = null;
  for (const c of contactos ?? []) {
    if (!c || normalizarCedula(c.cedula) !== d) continue;
    if (contactoActivo(c)) return c;
    inactivo = inactivo ?? c;
  }
  return inactivo;
}

/** Los contactos que ya tienen ese teléfono. Es un AVISO, no un impedimento: una
 *  familia comparte el mismo número y eso no los hace la misma persona. */
export function contactosConTelefono(
  contactos: readonly ContactoCocina[] | null | undefined,
  telefono: unknown,
): ContactoCocina[] {
  const d = normalizarTelefono(telefono);
  if (d.length < MIN_DIGITOS_TELEFONO) return [];
  return (contactos ?? []).filter((c) => c && telefonosDe(c).includes(d));
}

/** Los contactos que ya se llaman igual (nombre y apellido, sin mayúsculas). También
 *  es un aviso: hay dos José Pérez en cualquier obra del país. */
export function contactosConNombre(
  contactos: readonly ContactoCocina[] | null | undefined,
  nombre: unknown,
  apellido: unknown,
): ContactoCocina[] {
  const n = `${limpiarTexto(nombre)} ${limpiarTexto(apellido)}`.trim().toLowerCase();
  if (!n) return [];
  return (contactos ?? []).filter((c) => c && nombreDeContacto(c).toLowerCase() === n);
}

/**
 * POSIBLES REPETIDOS: lo que se le muestra a quien está creando, antes de guardar.
 *
 * No trancan nada (la cédula repetida sí, y eso lo hace `validarContacto`). Acá se
 * juntan los parecidos —mismo teléfono, mismo nombre— para que la persona decida
 * mirando, en vez de descubrirlo cuando la factura salga partida en dos.
 */
export function posiblesDuplicados(
  datos: { nombre?: unknown; apellido?: unknown; telefono1?: unknown; telefono2?: unknown },
  contactos: readonly ContactoCocina[] | null | undefined,
  idPropio?: string | null,
): ContactoCocina[] {
  const vistos = new Map<string, ContactoCocina>();
  const meter = (lista: ContactoCocina[]) => lista.forEach((c) => {
    if (c && c.id && c.id !== idPropio && !vistos.has(c.id)) vistos.set(c.id, c);
  });
  meter(contactosConNombre(contactos, datos.nombre, datos.apellido));
  meter(contactosConTelefono(contactos, datos.telefono1));
  meter(contactosConTelefono(contactos, datos.telefono2));
  return Array.from(vistos.values());
}

/**
 * EL BUSCADOR de la pestaña de Contactos.
 *
 * Pedido del cliente: «que cuente con un buscador para poder localizar más rápido el
 * registro». Busca por nombre, apellido, cédula y teléfono a la vez. Si lo escrito
 * tiene dígitos, MANDAN los dígitos: tecleando `12345678` aparece `V-12.345.678`, que
 * es como la gente busca de verdad (nadie escribe los puntos).
 */
export function buscarContactos(
  contactos: readonly ContactoCocina[] | null | undefined,
  texto: unknown,
): ContactoCocina[] {
  const lista = (contactos ?? []).filter(Boolean) as ContactoCocina[];
  const t = limpiarTexto(texto).toLowerCase();
  if (!t) return lista;
  const d = soloDigitos(t);
  return lista.filter((c) => {
    if (d && (normalizarCedula(c.cedula).includes(d) || telefonosDe(c).some((x) => x.includes(d)))) return true;
    return nombreDeContacto(c).toLowerCase().includes(t);
  });
}

/** Los contactos en el orden de la pantalla: primero los de la lista (A→Z), después
 *  los quitados. Mismo criterio que los platos, para que las dos pestañas se lean igual. */
export function ordenarContactos(contactos: readonly ContactoCocina[] | null | undefined): ContactoCocina[] {
  return [...(contactos ?? [])]
    .filter(Boolean)
    .sort((a, b) => Number(contactoActivo(b)) - Number(contactoActivo(a))
      || nombreDeContacto(a).localeCompare(nombreDeContacto(b), 'es'));
}

// ── VALIDAR ANTES DE GUARDAR ────────────────────────────────────────────────

export type DatosContacto = {
  nombre?: unknown;
  apellido?: unknown;
  cedula?: unknown;
  telefono1?: unknown;
  telefono2?: unknown;
  companyId?: unknown;
  nota?: unknown;
};

/** Revisa un teléfono escrito. Vacío es válido: los teléfonos no se exigen. */
function motivoTelefono(v: unknown, cual: string): string | null {
  const escrito = limpiarTexto(v);
  if (!escrito) return null;
  if (escrito.length > MAX_TELEFONO) return `El ${cual} es muy largo.`;
  if (/[^0-9+()\-. ]/.test(escrito)) return `El ${cual} solo lleva números.`;
  if (normalizarTelefono(escrito).length < MIN_DIGITOS_TELEFONO) return `El ${cual} está incompleto.`;
  return null;
}

/**
 * Revisa un contacto antes de crearlo o corregirlo. Devuelve el motivo del rechazo o
 * null. `idPropio` es el contacto que se está corrigiendo: puede quedarse con su
 * misma cédula.
 *
 * ⚠️ El orden de las revisiones es el orden en que se llena el formulario. Decirle a
 *    alguien «el teléfono está incompleto» cuando todavía no puso el nombre lo manda
 *    a buscar el error donde no está.
 */
export function validarContacto(
  datos: DatosContacto,
  contactos: readonly ContactoCocina[] | null | undefined,
  idPropio?: string | null,
): string | null {
  const nombre = limpiarTexto(datos.nombre);
  const apellido = limpiarTexto(datos.apellido);
  if (!nombre) return 'Escribe el nombre.';
  if (!apellido) return 'Escribe el apellido.';
  if (nombre.length > MAX_NOMBRE_CONTACTO) return `El nombre es muy largo (máximo ${MAX_NOMBRE_CONTACTO} letras).`;
  if (apellido.length > MAX_NOMBRE_CONTACTO) return `El apellido es muy largo (máximo ${MAX_NOMBRE_CONTACTO} letras).`;

  // ⭐ LA CÉDULA SIEMPRE. Es la única llave contra los duplicados, y la base la exige
  //    igual: pedirla acá es para decirlo en criollo, no para que sea la única barrera.
  const cedula = normalizarCedula(datos.cedula);
  if (!cedula) return 'Escribe la cédula.';
  if (cedula.length < MIN_DIGITOS_CEDULA) return 'La cédula está incompleta.';
  const otro = contactoConCedula(contactos, cedula);
  if (otro && otro.id !== idPropio) {
    return contactoActivo(otro)
      ? `Ya hay un contacto con esa cédula: ${nombreDeContacto(otro)}.`
      : `Ya hay un contacto con esa cédula, ${nombreDeContacto(otro)}, quitado de la lista: devuélvelo a la lista en vez de crear otro.`;
  }

  const t1 = motivoTelefono(datos.telefono1, 'teléfono');
  if (t1) return t1;
  const t2 = motivoTelefono(datos.telefono2, 'segundo teléfono');
  if (t2) return t2;

  if (limpiarTexto(datos.nota).length > MAX_NOTA_CONTACTO) {
    return `La nota es muy larga (máximo ${MAX_NOTA_CONTACTO} letras).`;
  }
  return null;
}

// ── EL RECONOCIMIENTO DE LA CÉDULA ──────────────────────────────────────────
//
// Pedido del cliente: «que ese apartado tenga reconocimiento de cédula o de datos por
// si el usuario o información ya existe en el sistema, para que no haya duplicados».
//
// Se busca en LOS DOS LADOS: la nómina (`employees`) y la agenda de cocina. Cada caso
// termina en una acción distinta, y por eso no alcanza con un sí/no.

/** Lo mínimo que hace falta de una ficha de nómina para reconocerla. */
export type FichaNomina = { id: string; nombre: string; empresa?: string | null; cargo?: string | null };

export type Hallazgo =
  /** No está en ningún lado: se puede crear. */
  | { tipo: 'libre' }
  /** Ya es de la nómina: NO se crea contacto, se atiende con su carnet. */
  | { tipo: 'nomina'; ficha: FichaNomina }
  /** Ya es un contacto de cocina: se abre ese, no se crea otro. */
  | { tipo: 'contacto'; contacto: ContactoCocina };

/**
 * Qué hacer con la cédula que acaban de escribir.
 *
 * ⚠️ LA NÓMINA MANDA SOBRE LA AGENDA. Si la persona está en las dos, se atiende por
 *    su carnet: su comida tiene que ir a la cuenta de su departamento o de su empresa,
 *    que es como se viene cobrando, y no a una cuenta suelta que nadie revisa.
 */
export function dictamenCedula(
  cedula: unknown,
  enNomina: FichaNomina | null | undefined,
  contactos: readonly ContactoCocina[] | null | undefined,
): Hallazgo {
  if (!normalizarCedula(cedula)) return { tipo: 'libre' };
  if (enNomina && limpiarTexto(enNomina.id)) return { tipo: 'nomina', ficha: enNomina };
  const c = contactoConCedula(contactos, cedula);
  return c ? { tipo: 'contacto', contacto: c } : { tipo: 'libre' };
}

/** El aviso en criollo de un hallazgo. '' cuando la cédula está libre. */
export function mensajeDeHallazgo(h: Hallazgo): string {
  if (h.tipo === 'nomina') {
    const emp = limpiarTexto(h.ficha.empresa);
    return `⚠️ Esa cédula ya es de ${limpiarTexto(h.ficha.nombre) || 'una persona'}${emp ? `, de ${emp}` : ' (nómina propia)'}. Atiéndelo con su carnet: no hace falta crear un contacto.`;
  }
  if (h.tipo === 'contacto') {
    const c = h.contacto;
    return contactoActivo(c)
      ? `ℹ️ ${nombreDeContacto(c)} ya está registrado. Se abre su ficha en vez de crear otra.`
      : `ℹ️ ${nombreDeContacto(c)} ya está registrado pero quitado de la lista. Devuélvelo a la lista en vez de crear otro.`;
  }
  return '';
}

/** ¿El hallazgo deja crear el contacto? Solo la nómina lo impide. */
export const dejaCrear = (h: Hallazgo): boolean => h.tipo === 'libre';

// ── LA ENTREGA ──────────────────────────────────────────────────────────────

export const MAX_COMIDAS_POR_ENTREGA = 200;

/**
 * Cuántas comidas se le entregan de una.
 *
 * Pedido del cliente: «una persona pide una cierta cantidad de comidas, o una persona
 * independiente viene a pedir solo la suya». Igual que una empresa, y SIN el candado
 * de «una comida por persona por día» que rige para el carnet de nómina: el contacto
 * paga lo que pida y puede volver a mediodía.
 */
export function validarCantidadComidas(v: unknown): string | null {
  const t = limpiarTexto(v).replace(',', '.');
  if (!t) return 'Escribe cuántas comidas.';
  const n = Number(t);
  if (!Number.isFinite(n)) return 'La cantidad tiene que ser un número.';
  if (!Number.isInteger(n)) return 'Las comidas se cuentan enteras.';
  if (n < 1) return 'Tiene que ser al menos una comida.';
  if (n > MAX_COMIDAS_POR_ENTREGA) return `Son demasiadas de una vez (máximo ${MAX_COMIDAS_POR_ENTREGA}). Regístralas en varias entregas.`;
  return null;
}
