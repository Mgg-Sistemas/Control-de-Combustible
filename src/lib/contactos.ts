// 📇 CONTACTOS (COMPRAS, VENTAS) — el catálogo único, 23-sep-2026.
//
// Pedido del cliente, textual: «esa lista de personas y proveedores desde ventas,
// la vas a volver un catálogo en un módulo aparte que diga CONTACTOS (COMPRAS,
// VENTAS) […] lo mismo harás con compras, lo que se tiene registrado, que se
// refleje allá, y vas a permitir poder editar, deshabilitar, y agregar un nuevo
// contacto ya sea persona o proveedor, con los datos básicos que sería nombre,
// apellido, razón social, cédula, rif. Y además no permitas agregar si ya existe
// esa cédula o RIF».
//
// Regla pura, sin React ni Supabase: la plata de una factura y de una orden de
// compra no puede depender de que alguien lea bien un `useMemo` de 300 líneas.
// Prueba: scripts/test-contactos.mjs
//
// LO QUE FIJA, Y POR QUÉ DUELE SI SE ROMPE:
//  · UNA CÉDULA O UN RIF NO ENTRA DOS VECES. Se comparan solo los DÍGITOS, así
//    «J-50.129.99-35» y «J501299935» son el mismo. Es lo único que impide que el
//    mismo proveedor entre tres veces y su cuenta por pagar salga partida.
//  · EL DOCUMENTO ES OPCIONAL. En la base real hay proveedores que hoy no lo
//    tienen cargado; exigirlo los dejaba fuera del catálogo —y con ellos, sus
//    compras— o había que inventárselo. Entran sin él, avisados.
//  · `name` ES LO QUE SE IMPRIME y nunca queda vacío: de una persona, «NOMBRE
//    APELLIDO»; de una empresa, su razón social.
//  · CLIENTE Y PROVEEDOR SON DOS MARCAS, NO DOS LISTAS. A mucha gente se le vende
//    Y se le compra; tenerla dos veces es tener su cuenta partida en dos.
import { norm } from './text';

// ── El documento ─────────────────────────────────────────────────────────────
export const DOC_LETRAS = ['V', 'E', 'J', 'G', 'P'] as const;
export type DocLetra = (typeof DOC_LETRAS)[number];

/** V/E/P identifican PERSONA (cédula); J/G identifican EMPRESA (RIF). */
export const esRif = (letra?: string | null): boolean => letra === 'J' || letra === 'G';
export const docTipoLabel = (letra?: string | null): string => (esRif(letra) ? 'RIF' : 'Cédula');
/** V/E/P es una PERSONA (se le piden nombre y apellido); J/G es una EMPRESA. */
export const esPersona = (letra?: string | null): boolean => !esRif(letra);

/** Solo los dígitos: así «V-12.345.678» y «V12345678» comparan igual. */
export const docDigitos = (v: any): string => String(v ?? '').replace(/[^0-9]/g, '');

/** Como se imprime y se guarda: «V-12345678». Sin documento, cadena vacía. */
export const docCanonico = (letra?: string | null, numero?: any): string => {
  const d = docDigitos(numero);
  const l = String(letra ?? '').toUpperCase();
  return d ? `${l}-${d}` : '';
};

/** Un documento sirve si tiene letra válida y al menos 6 dígitos. */
export const docValido = (letra?: string | null, numero?: any): boolean =>
  (DOC_LETRAS as readonly string[]).includes(String(letra ?? '').toUpperCase()) && docDigitos(numero).length >= 6;

/**
 * ¿Escribió ALGO en el documento? Distinto de `docValido`: sirve para separar
 * «lo dejó en blanco a propósito» de «lo escribió mal».
 *
 * ⚠️ Esta diferencia es la que deja entrar a los proveedores que hoy no tienen
 *    RIF cargado sin por eso tragarse un RIF de 3 dígitos.
 */
export const docEscrito = (letra?: string | null, numero?: any): boolean => docDigitos(numero).length > 0;

// ── El contacto ──────────────────────────────────────────────────────────────
export type ContactoRow = {
  id: string;
  /** Lo que se IMPRIME. Nunca vacío. */
  name: string;
  first_name?: string | null;
  last_name?: string | null;
  razon_social?: string | null;
  doc_letter?: string | null;
  doc_number?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  es_cliente?: boolean | null;
  es_proveedor?: boolean | null;
  tags?: string[] | null;
  note?: string | null;
  active?: boolean | null;
  supplier_id?: string | null;
};

/** Limpia un nombre: sin espacios de más y en MAYÚSCULAS, como el resto del módulo. */
export const limpiarNombre = (v: any): string => String(v ?? '').replace(/\s+/g, ' ').trim().toUpperCase();

/**
 * El nombre que se imprime. De una persona, «NOMBRE APELLIDO»; de una empresa, su
 * razón social. Si falta una de las dos partes se usa la que haya: más vale un
 * nombre a medias que un contacto llamado «undefined» en una factura.
 */
export function componerNombre(
  letra: string | null | undefined,
  nombre: any,
  apellido: any,
  razonSocial?: any,
): string {
  if (!esPersona(letra)) return limpiarNombre(razonSocial);
  return [limpiarNombre(nombre), limpiarNombre(apellido)].filter(Boolean).join(' ');
}

/**
 * Parte en nombre y apellido el `name` de un contacto que no tiene desglose (los
 * 55 que vinieron de Compras, por ejemplo), para PROPONERLO en el formulario.
 * Corta por el ÚLTIMO espacio.
 *
 * ⭐ ES REVERSIBLE, Y ESO ES TODO EL PUNTO: volver a componer lo que esto devuelve
 *    da EXACTAMENTE el mismo nombre. Así, quien entre a cambiarle el teléfono a
 *    «JUAN CARLOS PEREZ GOMEZ» y guarde sin tocar los nombres, lo deja llamándose
 *    igual. La alternativa —dejar el apellido vacío— terminaba en «PEDRO PEREZ» +
 *    apellido «PEREZ» = «PEDRO PEREZ PEREZ» en la próxima factura.
 */
export function partirNombre(name: any): { nombre: string; apellido: string } {
  const limpio = limpiarNombre(name);
  if (!limpio) return { nombre: '', apellido: '' };
  const corte = limpio.lastIndexOf(' ');
  if (corte < 0) return { nombre: limpio, apellido: '' };
  return { nombre: limpio.slice(0, corte), apellido: limpio.slice(corte + 1) };
}

/**
 * Lo que se escribió en el buscador, repartido: si son puros dígitos es el
 * documento; si son letras, el nombre. Es el detalle que evita que alguien busque
 * «PEDRO», no lo encuentre, y tenga que volver a escribir «PEDRO» en el formulario.
 */
export function repartirBusqueda(texto?: string | null): { nombre: string; numero: string } {
  const t = String(texto ?? '').trim();
  if (!t) return { nombre: '', numero: '' };
  const digitos = docDigitos(t);
  // «V-12345678», «12.345.678» o «J309876543»: lo que queda sin dígitos es, a lo
  // sumo, la letra del documento. Con más letras que eso, es un nombre.
  if (digitos.length >= 6 && t.replace(/[^a-zA-ZñÑ]/g, '').length <= 1) {
    return { nombre: '', numero: digitos };
  }
  return { nombre: limpiarNombre(t), numero: '' };
}

/**
 * ¿Ya existe ese documento en la lista? Compara letra + DÍGITOS, e ignora al
 * propio registro cuando se está editando (`exceptoId`).
 *
 * ⭐ Un contacto SIN documento nunca choca con otro: si «sin documento» contara
 *    como repetido, los proveedores que hoy no tienen RIF se bloquearían entre sí
 *    y no se podría registrar ninguno.
 */
export function docDuplicado<T extends ContactoRow>(
  lista: T[] | null | undefined,
  letra?: string | null,
  numero?: any,
  exceptoId?: string | null,
): T | null {
  const l = String(letra ?? '').toUpperCase();
  const d = docDigitos(numero);
  if (!l || !d) return null;
  return (lista ?? []).find(
    (c) => c.id !== exceptoId && String(c.doc_letter ?? '').toUpperCase() === l && docDigitos(c.doc_number) === d,
  ) ?? null;
}

/**
 * Revisa un contacto ANTES de guardarlo. Devuelve el motivo del rechazo o null.
 *
 * ⚠️ El documento NO es obligatorio (hay proveedores reales sin RIF cargado), pero
 *    si se escribe TIENE que servir y no puede estar repetido. «No permitas
 *    agregar si ya existe esa cédula o RIF», textual del cliente.
 */
export function validarContacto<T extends ContactoRow>(
  datos: {
    letra?: string | null; numero?: any;
    nombre?: any; apellido?: any; razonSocial?: any;
    esCliente?: boolean | null; esProveedor?: boolean | null;
  },
  lista?: T[] | null,
  exceptoId?: string | null,
): string | null {
  const persona = esPersona(datos.letra);
  if (persona) {
    if (!limpiarNombre(datos.nombre)) return 'Escribe el nombre.';
    if (!limpiarNombre(datos.apellido)) return 'Escribe el apellido.';
  } else if (!limpiarNombre(datos.razonSocial)) {
    return 'Escribe la razón social.';
  }
  // Escrito a medias: es un error de tecleo, no un «no lo tengo».
  if (docEscrito(datos.letra, datos.numero) && !docValido(datos.letra, datos.numero)) {
    return `${docTipoLabel(datos.letra)} incompleto: tiene que llevar al menos 6 dígitos.`;
  }
  const choca = docDuplicado(lista, datos.letra, datos.numero, exceptoId);
  if (choca) return `Ese ${docTipoLabel(datos.letra).toLowerCase()} ya está registrado a nombre de «${choca.name}».`;
  // Sin ninguna de las dos marcas el contacto no aparecería en ningún lado.
  if (!datos.esCliente && !datos.esProveedor) {
    return 'Marca si se le vende, se le compra, o las dos cosas.';
  }
  return null;
}

/**
 * La fila que se guarda en `contactos`. Un solo sitio la arma: si la pantalla del
 * módulo y el «＋» de la venta la armaran cada una por su lado, el mismo contacto
 * quedaría escrito distinto según por dónde se creó.
 */
export function filaContacto(datos: {
  letra?: string | null; numero?: any;
  nombre?: any; apellido?: any; razonSocial?: any;
  telefono?: any; correo?: any; direccion?: any;
  esCliente?: boolean | null; esProveedor?: boolean | null;
  rubros?: string[] | null;
}) {
  const persona = esPersona(datos.letra);
  const limpio = (v: any) => String(v ?? '').trim() || null;
  const digitos = docDigitos(datos.numero);
  return {
    name: componerNombre(datos.letra, datos.nombre, datos.apellido, datos.razonSocial),
    // De una empresa no se parte en nombre y apellido; de una persona no hay razón social.
    first_name: persona ? limpiarNombre(datos.nombre) || null : null,
    last_name: persona ? limpiarNombre(datos.apellido) || null : null,
    razon_social: persona ? null : limpiarNombre(datos.razonSocial) || null,
    // Sin documento van los DOS en null: media llave no sirve para nada y el
    // índice único la ignora solo si `doc_number` está vacío.
    doc_letter: digitos ? String(datos.letra ?? 'V').toUpperCase() : null,
    doc_number: digitos || null,
    phone: limpio(datos.telefono),
    email: limpio(datos.correo),
    address: limpio(datos.direccion),
    es_cliente: !!datos.esCliente,
    es_proveedor: !!datos.esProveedor,
    tags: limpiarRubros(datos.rubros),
  };
}

/** Los rubros (FERRETERIA, REPUESTOS…), en MAYÚSCULAS, sin repetidos ni vacíos. */
export function limpiarRubros(rubros?: string[] | null): string[] | null {
  const vistos = new Set<string>();
  const out: string[] = [];
  (rubros ?? []).forEach((r) => {
    const v = limpiarNombre(r);
    if (v && !vistos.has(v)) { vistos.add(v); out.push(v); }
  });
  return out.length ? out : null;
}

// ── Búsqueda y orden ─────────────────────────────────────────────────────────
/** Todo lo buscable de un contacto, junto. */
export const contactoHaystack = (c: ContactoRow): string =>
  norm([
    c.name, c.first_name, c.last_name, c.razon_social,
    docCanonico(c.doc_letter, c.doc_number), c.doc_number,
    c.phone, c.email, c.address, c.note,
    (c.tags ?? []).join(' '),
    c.es_cliente ? 'cliente' : '', c.es_proveedor ? 'proveedor' : '',
    c.active === false ? 'deshabilitado inactivo' : '',
  ].filter(Boolean).join(' '));

/** Busca contactos por CUALQUIER característica. Sin texto, devuelve todos. */
export function buscarContactos<T extends ContactoRow>(lista: T[] | null | undefined, texto?: string | null): T[] {
  const q = norm(texto ?? '');
  const rows = lista ?? [];
  if (!q) return [...rows];
  return rows.filter((c) => contactoHaystack(c).includes(q));
}

export type RolContacto = 'todos' | 'clientes' | 'proveedores' | 'sin_documento' | 'deshabilitados';

/** Le falta el documento: es la lista de lo que hay que completar a mano. */
export const sinDocumento = (c: ContactoRow): boolean => !docDigitos(c.doc_number);

/**
 * Filtra por el rol elegido en la pantalla.
 *
 * ⚠️ «Deshabilitados» es el ÚNICO filtro que los muestra. En todos los demás, un
 *    contacto deshabilitado NO sale: deshabilitar tiene que servir de algo, o la
 *    lista sigue igual de larga y nadie lo usa.
 */
export function filtrarContactos<T extends ContactoRow>(lista: T[] | null | undefined, rol: RolContacto = 'todos'): T[] {
  const rows = lista ?? [];
  if (rol === 'deshabilitados') return rows.filter((c) => c.active === false);
  const vivos = rows.filter((c) => c.active !== false);
  if (rol === 'clientes') return vivos.filter((c) => !!c.es_cliente);
  if (rol === 'proveedores') return vivos.filter((c) => !!c.es_proveedor);
  if (rol === 'sin_documento') return vivos.filter(sinDocumento);
  return vivos;
}

/** Cuántos hay de cada cosa, para las pastillas de la pantalla. */
export function conteoContactos(lista: ContactoRow[] | null | undefined) {
  const rows = lista ?? [];
  const vivos = rows.filter((c) => c.active !== false);
  return {
    todos: vivos.length,
    clientes: vivos.filter((c) => !!c.es_cliente).length,
    proveedores: vivos.filter((c) => !!c.es_proveedor).length,
    sin_documento: vivos.filter(sinDocumento).length,
    deshabilitados: rows.filter((c) => c.active === false).length,
  };
}

/** Cómo se rotula un contacto: «👤 Cliente», «🏭 Proveedor» o las dos. */
export function rolesDe(c: ContactoRow): string {
  const r: string[] = [];
  if (c.es_cliente) r.push('👤 Cliente');
  if (c.es_proveedor) r.push('🏭 Proveedor');
  return r.join(' · ') || '— sin marcar';
}

/** Todos los rubros que ya se usaron, A→Z (para proponerlos sin reescribirlos). */
export function rubrosUsados(lista: ContactoRow[] | null | undefined): string[] {
  const s = new Set<string>();
  (lista ?? []).forEach((c) => (c.tags ?? []).forEach((t) => { const v = limpiarNombre(t); if (v) s.add(v); }));
  return [...s].sort((a, b) => a.localeCompare(b, 'es'));
}
