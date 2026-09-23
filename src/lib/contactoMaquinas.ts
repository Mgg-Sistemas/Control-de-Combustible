// 🚜 MÁQUINAS DE UN CONTACTO — catálogo propio e independiente (23-sep-2026).
//
// Pedido del cliente, textual: «si el cliente, proveedor o empresa es una empresa
// ya registrada, que se muestre las maquinarias mediante un buscable desplegable,
// buscable por todas sus características. Mostrando todos los datos de la
// maquinaria, esto también aplícalo para servicios desde ventas. Que se busque un
// encargado o una empresa y me salga las máquinas registradas. También permite la
// opción de una máquina que no exista. Y se carguen los datos y se guarden en este
// catálogo sin que afecte el catálogo de maquinarias que se tiene».
//
// ⭐ INDEPENDIENTE QUIERE DECIR QUE AQUÍ SE COPIA, NO SE APUNTA.
//    `machinery` se LEE para proponer; escribir en este catálogo NO lo toca. Una
//    máquina que hoy es de COSTA BRAVA mañana se le alquila a otro, o le cambian
//    el encargado: si la venta apuntara a la ficha viva, un papel firmado el mes
//    pasado cambiaría de contenido solo porque alguien corrigió el catálogo.
//
// Regla pura, sin React ni Supabase. Prueba: scripts/test-contacto-maquinas.mjs
import { norm, cmpText } from './text';

/** Una máquina del catálogo de equipos, con lo que hace falta para copiarla. */
export type MachineryRow = {
  id: string;
  code?: string | null;
  description?: string | null;
  machinery_type?: string | null;
  tipo?: string | null;
  marca?: string | null;
  modelo?: string | null;
  serial?: string | null;
  plate?: string | null;
  identifier?: string | null;
  referencia?: string | null;
  encargado?: string | null;
  zona?: string | null;
  sector?: string | null;
  location?: string | null;
  last_horometro?: number | string | null;
  price_per_hour?: number | string | null;
  company_id?: string | null;
  active?: boolean | null;
};

/** Una máquina del catálogo PROPIO de un contacto. */
export type MaquinaContacto = {
  id?: string;
  contacto_id?: string | null;
  machinery_id?: string | null;
  codigo?: string | null;
  descripcion?: string | null;
  tipo?: string | null;
  marca?: string | null;
  modelo?: string | null;
  serial?: string | null;
  placa?: string | null;
  identificador?: string | null;
  referencia?: string | null;
  encargado?: string | null;
  zona?: string | null;
  sector?: string | null;
  ubicacion?: string | null;
  horometro?: number | string | null;
  precio_hora?: number | string | null;
  nota?: string | null;
  origen?: 'catalogo' | 'manual' | string | null;
  active?: boolean | null;
};

const limpio = (v: any): string => String(v ?? '').replace(/\s+/g, ' ').trim();
const mayus = (v: any): string => limpio(v).toUpperCase();
const numeroONull = (v: any): number | null => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/**
 * COPIA una máquina del catálogo de equipos al catálogo del contacto.
 *
 * ⭐ Devuelve datos, no una referencia: desde aquí la copia tiene vida propia y lo
 *    que pase allá (que la retiren, que le cambien el encargado) ya no la mueve.
 *    `machinery_id` queda SOLO para poder decir de dónde salió.
 */
export function desdeMachinery(m: MachineryRow | null | undefined, contactoId?: string | null): MaquinaContacto {
  return {
    contacto_id: contactoId ?? null,
    machinery_id: m?.id ?? null,
    codigo: mayus(m?.code) || null,
    descripcion: mayus(m?.description) || null,
    // `tipo` y `machinery_type` conviven en el catálogo de equipos: se toma el que
    // tenga algo, empezando por el más específico.
    tipo: mayus(m?.tipo) || mayus(m?.machinery_type) || null,
    marca: mayus(m?.marca) || null,
    modelo: mayus(m?.modelo) || null,
    serial: mayus(m?.serial) || null,
    placa: mayus(m?.plate) || null,
    identificador: mayus(m?.identifier) || null,
    referencia: mayus(m?.referencia) || null,
    encargado: mayus(m?.encargado) || null,
    zona: mayus(m?.zona) || null,
    sector: mayus(m?.sector) || null,
    ubicacion: mayus(m?.location) || null,
    horometro: numeroONull(m?.last_horometro),
    precio_hora: numeroONull(m?.price_per_hour),
    origen: 'catalogo',
    active: true,
  };
}

/** La fila que se guarda cuando el usuario la escribe a mano. */
export function filaMaquina(datos: MaquinaContacto, contactoId?: string | null): MaquinaContacto {
  return {
    contacto_id: contactoId ?? datos.contacto_id ?? null,
    machinery_id: datos.machinery_id ?? null,
    codigo: mayus(datos.codigo) || null,
    descripcion: mayus(datos.descripcion) || null,
    tipo: mayus(datos.tipo) || null,
    marca: mayus(datos.marca) || null,
    modelo: mayus(datos.modelo) || null,
    serial: mayus(datos.serial) || null,
    placa: mayus(datos.placa) || null,
    identificador: mayus(datos.identificador) || null,
    referencia: mayus(datos.referencia) || null,
    encargado: mayus(datos.encargado) || null,
    zona: mayus(datos.zona) || null,
    sector: mayus(datos.sector) || null,
    ubicacion: mayus(datos.ubicacion) || null,
    horometro: numeroONull(datos.horometro),
    precio_hora: numeroONull(datos.precio_hora),
    nota: limpio(datos.nota) || null,
    origen: datos.machinery_id ? 'catalogo' : 'manual',
    active: datos.active !== false,
  };
}

/**
 * Revisa una máquina antes de guardarla. Devuelve el motivo del rechazo o null.
 *
 * ⚠️ Se pide MUY POCO a propósito: una sola cosa que la identifique. El pedido era
 *    poder cargar «una máquina que no exista», y una pantalla que exige diez campos
 *    para eso termina con diez campos llenos de «X» — que es peor que tenerlos
 *    vacíos, porque el vacío se nota y la «X» no.
 */
export function validarMaquina(datos: MaquinaContacto): string | null {
  const algo = [datos.codigo, datos.descripcion, datos.serial, datos.placa, datos.identificador]
    .some((v) => !!limpio(v));
  if (!algo) return 'Escribe al menos el código, la descripción, el serial o la placa.';
  if (datos.horometro != null && String(datos.horometro).trim() !== '' && numeroONull(datos.horometro) === null) {
    return 'El horómetro tiene que ser un número.';
  }
  if (datos.precio_hora != null && String(datos.precio_hora).trim() !== '' && numeroONull(datos.precio_hora) === null) {
    return 'El precio por hora tiene que ser un número.';
  }
  return null;
}

/** Cómo se nombra una máquina en una línea: «EX-012 · EXCAVADORA CAT 320». */
export function etiquetaMaquina(m: MaquinaContacto | null | undefined): string {
  const cabeza = limpio(m?.codigo) || limpio(m?.identificador) || limpio(m?.placa) || limpio(m?.serial);
  const cuerpo = [limpio(m?.descripcion) || limpio(m?.tipo), limpio(m?.marca), limpio(m?.modelo)]
    .filter(Boolean).join(' ');
  return [cabeza, cuerpo].filter(Boolean).join(' · ') || 'Máquina sin identificar';
}

/**
 * TODOS los datos de la máquina, en pares rótulo/valor, para mostrarlos. Solo los
 * que tienen algo: una ficha con ocho «—» no deja ver los tres datos que sí están.
 */
export function datosMaquina(m: MaquinaContacto | null | undefined): { rotulo: string; valor: string }[] {
  const pares: [string, any][] = [
    ['Código', m?.codigo], ['Descripción', m?.descripcion], ['Tipo', m?.tipo],
    ['Marca', m?.marca], ['Modelo', m?.modelo], ['Serial', m?.serial], ['Placa', m?.placa],
    ['Identificador', m?.identificador], ['Referencia', m?.referencia],
    ['Encargado', m?.encargado], ['Zona', m?.zona], ['Sector', m?.sector],
    ['Ubicación', m?.ubicacion],
    ['Horómetro', m?.horometro], ['Precio por hora', m?.precio_hora != null ? `$${m.precio_hora}` : null],
    ['Nota', m?.nota],
  ];
  return pares
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
    .map(([rotulo, valor]) => ({ rotulo, valor: String(valor) }));
}

/** Todo lo buscable de una máquina del catálogo propio. */
export const maquinaHaystack = (m: MaquinaContacto): string =>
  norm([
    m.codigo, m.descripcion, m.tipo, m.marca, m.modelo, m.serial, m.placa,
    m.identificador, m.referencia, m.encargado, m.zona, m.sector, m.ubicacion, m.nota,
    m.horometro, m.precio_hora,
  ].filter((v) => v !== null && v !== undefined && String(v).trim() !== '').join(' '));

/** Todo lo buscable de una máquina del catálogo de EQUIPOS (para proponerla). */
export const machineryHaystack = (m: MachineryRow): string =>
  norm([
    m.code, m.description, m.machinery_type, m.tipo, m.marca, m.modelo, m.serial,
    m.plate, m.identifier, m.referencia, m.encargado, m.zona, m.sector, m.location,
  ].filter((v) => v !== null && v !== undefined && String(v).trim() !== '').join(' '));

/**
 * Busca en el catálogo PROPIO por CUALQUIER característica: código, descripción,
 * tipo, marca, modelo, serial, placa, encargado, zona… Sin texto, devuelve todas.
 */
export function buscarMaquinas<T extends MaquinaContacto>(lista: T[] | null | undefined, texto?: string | null): T[] {
  const q = norm(texto ?? '');
  const rows = (lista ?? []).filter((m) => m && m.active !== false);
  if (!q) return rows;
  return rows.filter((m) => maquinaHaystack(m).includes(q));
}

/**
 * Las máquinas del catálogo de EQUIPOS que se le pueden proponer a un contacto.
 *
 * ⭐ «Que se busque un encargado o una empresa y me salga las máquinas
 *    registradas»: por eso filtra por empresa Y busca por texto libre (que incluye
 *    al encargado). Sin empresa, busca en todas — así se encuentra la máquina de un
 *    encargado aunque no se sepa de qué empresa es.
 *
 * ⚠️ Las ya copiadas a este contacto NO se vuelven a proponer: proponerlas otra vez
 *    es invitar a tener la misma máquina dos veces en la misma venta.
 */
export function proponerMaquinas<T extends MachineryRow>(
  machinery: T[] | null | undefined,
  opts: { companyId?: string | null; texto?: string | null; yaCopiadas?: (string | null | undefined)[] | null } = {},
): T[] {
  const q = norm(opts.texto ?? '');
  const copiadas = new Set((opts.yaCopiadas ?? []).filter(Boolean) as string[]);
  return (machinery ?? []).filter((m) => {
    if (!m || m.active === false) return false;
    if (copiadas.has(m.id)) return false;
    if (opts.companyId && m.company_id !== opts.companyId) return false;
    if (q && !machineryHaystack(m).includes(q)) return false;
    return true;
  });
}

/** Los encargados que aparecen en el catálogo de equipos, A→Z (para proponerlos). */
export function encargadosDe(machinery: MachineryRow[] | null | undefined): string[] {
  const s = new Set<string>();
  (machinery ?? []).forEach((m) => { const v = mayus(m?.encargado); if (v) s.add(v); });
  return [...s].sort((a, b) => a.localeCompare(b, 'es'));
}

/** Lo que se guarda en el renglón de la venta: nombre congelado + de dónde salió. */
export function maquinaDeRenglon(m: MaquinaContacto | null | undefined) {
  if (!m) return null;
  return {
    maquina_id: m.id ?? null,
    maquina: etiquetaMaquina(m),
    maquina_serial: limpio(m.serial) || null,
    maquina_placa: limpio(m.placa) || null,
  };
}

// ── 🏢 EMPRESA INTERNA · la lista buscable que destraba todo lo demás ────────
//
// Pedido del cliente, textual: «si es una empresa interna se muestra la lista, si
// es externa se agrega la maquina sin que afecte el catalogo […] estas listas
// vuelvelas buscable».
//
// ⚠️ LO QUE ESTO ARREGLA. Proponerle a un contacto las máquinas de su empresa
//    solo funciona si alguien dijo ANTES de cuál empresa es (`contactos.company_id`).
//    Ese enlace se hacía únicamente en la ficha completa del contacto, así que al
//    vender un servicio el desplegable salía vacío y no había manera de arreglarlo
//    sin abandonar la venta. Con esto la empresa se elige ahí mismo.

/** Una empresa del sistema, con lo que hace falta para buscarla y mostrarla. */
export type EmpresaRow = {
  id: string;
  name?: string | null;
  rif?: string | null;
  hidden?: boolean | null;
};

/** Cuántas máquinas activas tiene cada empresa en el catálogo de equipos. */
export function maquinasPorEmpresa(machinery: MachineryRow[] | null | undefined): Record<string, number> {
  const cuenta: Record<string, number> = {};
  (machinery ?? []).forEach((m) => {
    if (!m || m.active === false || !m.company_id) return;
    cuenta[m.company_id] = (cuenta[m.company_id] ?? 0) + 1;
  });
  return cuenta;
}

/** Todo lo buscable de una empresa: su nombre y su RIF. */
export const empresaHaystack = (e: EmpresaRow): string =>
  norm([e?.name, e?.rif].filter((v) => v !== null && v !== undefined && String(v).trim() !== '').join(' '));

/**
 * Las empresas internas, BUSCABLES, con cuántas máquinas tiene cada una.
 *
 * ⭐ Ordena por máquinas de mayor a menor y luego A→Z: quien está enlazando un
 *    contacto para verle las máquinas quiere arriba las que TIENEN máquinas. Una
 *    empresa con 0 igual sale —enlazarla no está prohibido— pero de última.
 *
 * ⚠️ Las ocultas NO salen: si no aparecen en ningún otro selector, aparecer aquí
 *    solo sirve para enlazar un contacto a una empresa que ya nadie usa.
 */
export function empresasConMaquinas(
  companies: EmpresaRow[] | null | undefined,
  machinery: MachineryRow[] | null | undefined,
  texto?: string | null,
): { empresa: EmpresaRow; maquinas: number }[] {
  const q = norm(texto ?? '');
  const cuenta = maquinasPorEmpresa(machinery);
  return (companies ?? [])
    .filter((e) => e && !e.hidden && (!q || empresaHaystack(e).includes(q)))
    .map((empresa) => ({ empresa, maquinas: cuenta[empresa.id] ?? 0 }))
    .sort((a, b) => (b.maquinas - a.maquinas) || cmpText(a.empresa.name, b.empresa.name));
}

// ── 🏢 LAS EMPRESAS DEL CATÁLOGO, PARA VENDERLES · CON SU ENCARGADO ─────────
//
// Pedido del cliente, textual: «coloca la opcion en ventas, de colocar el nombre
// de las empresas que se tiene en catalogo con su encargado».
//
// ⚠️ UNA EMPRESA DEL CATÁLOGO NO ES UN CONTACTO. Son dos cosas distintas: el
//    catálogo de empresas es con el que trabaja maquinaria (jornadas, reportes,
//    comidas) y el contacto es a quien se le factura, con su RIF y su cuenta por
//    cobrar. Elegir la empresa en la venta tiene que RESOLVER a qué contacto
//    corresponde, no crear uno nuevo cada vez: dos fichas de COSTA BRAVA es la
//    cuenta por cobrar de COSTA BRAVA partida en dos.

import { ContactoRow, docDigitos, filaContacto } from './contactos';

/** Los encargados de las máquinas de UNA empresa, A→Z y sin repetir. */
export function encargadosDeEmpresa(
  machinery: MachineryRow[] | null | undefined,
  companyId?: string | null,
): string[] {
  if (!companyId) return [];
  const s = new Set<string>();
  (machinery ?? []).forEach((m) => {
    if (!m || m.active === false || m.company_id !== companyId) return;
    const v = mayus(m.encargado);
    if (v) s.add(v);
  });
  return [...s].sort(cmpText);
}

/** Una empresa del catálogo lista para elegirla en una venta. */
export type EmpresaParaVenta = {
  empresa: EmpresaRow;
  maquinas: number;
  encargados: string[];
  /** El contacto que YA la representa, si alguien lo enlazó o lo creó antes. */
  contacto: ContactoRow | null;
};

/**
 * Las empresas del catálogo con su encargado, BUSCABLES por nombre, RIF **y
 * encargado** — que es como se acuerda la gente de una empresa cuando no recuerda
 * la razón social exacta.
 *
 * ⚠️ Van A→Z, no por cantidad de máquinas como en el enlazador: acá se está
 *    buscando un nombre para facturarle, y una lista de nombres se busca A→Z.
 *    Las ocultas no salen (no aparecen en ningún otro selector).
 */
export function empresasParaVenta(
  companies: EmpresaRow[] | null | undefined,
  machinery: MachineryRow[] | null | undefined,
  contactos: ContactoRow[] | null | undefined,
  texto?: string | null,
): EmpresaParaVenta[] {
  const q = norm(texto ?? '');
  const cuenta = maquinasPorEmpresa(machinery);
  const porEmpresa = new Map<string, ContactoRow>();
  (contactos ?? []).forEach((c) => {
    const id = (c as any)?.company_id;
    if (id && !porEmpresa.has(id)) porEmpresa.set(id, c);
  });
  return (companies ?? [])
    .filter((e) => e && !e.hidden)
    .map((empresa) => ({
      empresa,
      maquinas: cuenta[empresa.id] ?? 0,
      encargados: encargadosDeEmpresa(machinery, empresa.id),
      contacto: porEmpresa.get(empresa.id) ?? null,
    }))
    .filter((x) => !q || norm([empresaHaystack(x.empresa), x.encargados.join(' ')].join(' ')).includes(q))
    .sort((a, b) => cmpText(a.empresa.name, b.empresa.name));
}

/** La letra del RIF de una empresa («J-40111…» → 'J'). Por defecto J. */
const letraDeRif = (rif: any): string => {
  const l = String(rif ?? '').trim().charAt(0).toUpperCase();
  return l === 'G' ? 'G' : 'J';
};

/**
 * A qué contacto corresponde una empresa del catálogo, y qué hay que hacer.
 *
 * ⭐ EL ORDEN IMPORTA, y va del dato más duro al más blando:
 *    1. Ya hay un contacto enlazado a esa empresa → se usa.
 *    2. Hay uno con el MISMO RIF → es el mismo, solo le faltaba el enlace.
 *    3. Hay uno con el MISMO NOMBRE → lo mismo (es como se importaron).
 *    4. No hay → se crea, ya enlazado.
 *
 * ⚠️ Nunca «crear» si el RIF ya existe: el índice único lo rebotaría, y si no lo
 *    rebotara quedarían dos fichas de la misma empresa con la cuenta por cobrar
 *    partida en dos.
 */
export type ContactoDeEmpresa =
  | { accion: 'usar'; contacto: ContactoRow; deshabilitado: boolean }
  | { accion: 'enlazar'; contacto: ContactoRow; deshabilitado: boolean; motivo: 'rif' | 'nombre' }
  | { accion: 'crear'; fila: Record<string, any> };

export function contactoParaEmpresa(
  empresa: EmpresaRow | null | undefined,
  contactos: ContactoRow[] | null | undefined,
): ContactoDeEmpresa {
  const lista = contactos ?? [];
  const apagado = (c: ContactoRow) => c.active === false;

  const enlazado = empresa ? lista.find((c) => (c as any)?.company_id === empresa.id) : null;
  if (enlazado) return { accion: 'usar', contacto: enlazado, deshabilitado: apagado(enlazado) };

  const digitos = docDigitos(empresa?.rif);
  if (digitos) {
    const porRif = lista.find((c) => docDigitos(c.doc_number) === digitos);
    if (porRif) return { accion: 'enlazar', contacto: porRif, deshabilitado: apagado(porRif), motivo: 'rif' };
  }

  const nombre = norm(empresa?.name);
  if (nombre) {
    const porNombre = lista.find((c) => norm(c.name) === nombre);
    if (porNombre) return { accion: 'enlazar', contacto: porNombre, deshabilitado: apagado(porNombre), motivo: 'nombre' };
  }

  return {
    accion: 'crear',
    fila: {
      ...filaContacto({
        letra: letraDeRif(empresa?.rif),
        numero: empresa?.rif,
        razonSocial: empresa?.name,
        esCliente: true,
      }),
      company_id: empresa?.id ?? null,
    },
  };
}
