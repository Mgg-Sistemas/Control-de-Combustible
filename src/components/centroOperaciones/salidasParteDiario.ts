// 🏭 CENTRO DE OPERACIONES — LAS SALIDAS DEL 📅 PARTE DIARIO (24-oct-2026).
//
// Lo que deciden los tres bloques de salidas y se puede probar sin pantalla:
//   · AGREGADOS (triturado, arrocillo, polvillo…): ella escribe UNA cifra en m³, t o kg
//     y el sistema saca las otras dos con el FACTOR del material (si el material no
//     tiene, 1,2: `FACTOR_AGREGADOS`). Destino de su lista con sus km (se CONGELAN en
//     el renglón). Vehículo NUESTRO (unidad de la flota: placa y chofer salen solos, el
//     chofer se puede corregir) o EXTERNO (solo el nombre de la compañía). Viajes: 1.
//   · ACERO: quién se lo lleva (una empresa de la lista de transportistas del sitio,
//     nosotros u otra), el camión y los m³. Las toneladas llegan DESPUÉS en la nota de
//     entrega: el renglón sale «esperando pesaje» y sin toneladas, y se completa desde
//     la lista «Pendientes de pesaje» (pasa a «confirmado»).
//   · ALUMINIO Y PLÁSTICO (y otros de la lista): t o kg (los kg se pasan a t), la
//     empresa (nosotros u otra) y el destino.
//
// ⭐ DE QUÉ BLOQUE ES CADA SALIDA lo decide UNA regla (`claseDeSalida`): así cada salida
//    del día sale en un solo bloque y ✏️ la abre en el formulario que la escribió.
// ⭐ LAS CUENTAS NO VIVEN ACÁ: la conversión es `convertirCantidad` (materiales), las
//    cifras se leen con `cifraDeCampo`/`viajesDeCampo`, los nombres de lista se
//    vinculan con `itemDeLista` y la placa con `unidadPorPlaca` (carga), y «es el
//    material de los bloques» con `materialDeBloques`/`esDeBloques`. Acá solo se usan.
// ⭐ Lo que un formulario no escribe NO viaja (Partial): editar una salida no le borra
//    la hora ni el origen que se le hayan puesto en ✍️ Carga libre.
// ⭐ LO DE ✍️ CARGA LIBRE (renglones sin `vehiculo`) se VE en estos bloques pero se
//    corrige allá (`editableEnParteDiario`): estos formularios no saben guardar todo lo
//    que esos renglones traen (lote 5 B4 y R1). Y AL REVÉS (revisión final A#1): lo de
//    estos bloques no se corrige en ✍️ Carga libre ni en 📋 Registros (`dondeSeCorrige`).
// ⭐ Una salida guardada CONSERVA sus m³ y toneladas mientras no se le cambie el material,
//    la cifra ni la unidad (revisión final A#3, como los km de `kmCongelado`): el factor
//    del material puede cambiar después en ⚙️ Ajustes y el papel cerrado no se mueve.
// ⭐ Ningún nombre de empresa vive en el código (repositorio público): las pastillas de
//    quién se lleva el acero salen de la lista del sitio (`pastillasQuienAcero`).
//
// PURA: sin React ni Supabase. `scripts/test-centro-operaciones-salidas.mjs` la prueba.
import { clavePlaca, cmpMovimientoJornada, fechaValida } from '../../lib/centroOperaciones';
import type { EstadoMov, ItemLista, Movimiento, Unidad, VehiculoMov } from '../../lib/centroOperaciones';
import { convertirCantidad, FACTOR_AGREGADOS, textoCantidades } from '../../lib/centroOperacionesMateriales';
import type { Cantidades, UnidadCantidad } from '../../lib/centroOperacionesMateriales';
import { avisoEdicionBloques, cifraDeCampo, itemDeLista, textoDeUnidad, unidadPorPlaca, viajesDeCampo } from '../../lib/centroOperacionesCarga';
import type { ValorLista } from '../../lib/centroOperacionesCarga';
import { esDeBloques, materialDeBloques } from '../../lib/centroOperacionesMaquinariaBloques';
import { cmpText, norm } from '../../lib/text';

// ═══════════════════════════ Nombres fijos ═══════════════════════════

export const MATERIAL_ACERO = 'Acero';
export const MATERIAL_ALUMINIO = 'Aluminio';
export const MATERIAL_PLASTICO = 'Plástico';
/** La opción rápida de «somos nosotros» (acero y aluminio). Las demás empresas salen de
 *  la lista de transportistas del sitio: ningún nombre real en el código. */
export const NOSOTROS = 'Nosotros';
/** Cuántas empresas de la lista se ofrecen como pastilla en «quién se lleva el acero». */
export const MAX_PASTILLAS_QUIEN = 4;

/** Los tres bloques de salidas del Parte diario. */
export type ClaseSalida = 'agregados' | 'acero' | 'aluminioPlastico';

/** Las unidades en que se escribe la cantidad de los agregados. */
export const UNIDADES_AGREGADOS: { key: UnidadCantidad; label: string }[] = [
  { key: 'm3', label: 'm³' },
  { key: 't', label: 't' },
  { key: 'kg', label: 'kg' },
];

// ═══════════════════════════ Utilidades internas ═══════════════════════════

/** Texto limpio: sin espacios a los lados y con los dobles colapsados. */
const limpia = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();
/** La llave para comparar nombres: sin mayúsculas, tildes ni espacios de más. */
const llave = (s: unknown): string => norm(limpia(s));
const esNumero = (n: unknown): n is number => typeof n === 'number' && isFinite(n);
const textoDeCifra = (n: number | null | undefined): string => (esNumero(n) ? String(n) : '');
const VACIO_LISTA = (): ValorLista => ({ texto: '', listaId: null });

const esAcero = (material: unknown): boolean => llave(material) === llave(MATERIAL_ACERO);
const esAluminioOPlastico = (material: unknown): boolean =>
  llave(material) === llave(MATERIAL_ALUMINIO) || llave(material) === llave(MATERIAL_PLASTICO);
/** Los bloques de la cantera tienen su propio bloque (🧱): no son una salida de estos.
 *  Solo por el NOMBRE «Bloques»: lo usa `claseDeSalida`, que no recibe las listas (y la
 *  venta de bloques ya se separa por su cantidad en piezas, 'u'). */
const esBloques = (material: unknown): boolean => llave(material) === 'bloques';
/**
 * ⭐ ¿Es el material de 🧱 Bloques? LA MISMA regla que el bloque de la cantera
 * (`materialDeBloques` + `esDeBloques`): el «Bloques» de la lista o, si no hay, el
 * material marcado con «días hasta estar disponible» (lote 5 A7). Con lo escrito y su id.
 */
function esMaterialDeBloques(material: string | null, materialId: string | null, listas: ItemLista[]): boolean {
  if (!limpia(material)) return false;
  return esDeBloques({ material, materialId }, materialDeBloques(listas ?? []));
}
/** ¿Lo escrito en la empresa es «Nosotros»? (sin mirar mayúsculas, tildes ni espacios) */
export const esNosotros = (texto: unknown): boolean => llave(texto) === llave(NOSOTROS);

/** El valor de un campo de lista: el texto limpio y el id solo si hay texto. */
const deLista = (v: ValorLista | null | undefined): [string | null, string | null] => {
  const texto = limpia(v?.texto);
  return texto ? [texto, v?.listaId || null] : [null, null];
};

// ═══════════════════════════ De qué bloque es cada salida ═══════════════════════════

/**
 * El bloque de una salida (null si no es una salida de estos bloques):
 *   · material «Acero» → acero;
 *   · material «Aluminio» o «Plástico», o una salida anotada en t/kg SIN m³ (así guarda
 *     el bloque de aluminio y plástico los «otros de la lista») → aluminio y plástico;
 *   · los bloques de la cantera (material «Bloques» o cantidad en piezas) → ninguno;
 *   · cualquier otra salida → agregados (también las de ✍️ Carga libre: así ninguna
 *     salida del día queda sin verse).
 */
export function claseDeSalida(m: Movimiento): ClaseSalida | null {
  if (!m || m.tipo !== 'salida') return null;
  if (esBloques(m.material) || m.unidadIngresada === 'u') return null;
  if (esAcero(m.material)) return 'acero';
  if (esAluminioOPlastico(m.material)) return 'aluminioPlastico';
  if ((m.unidadIngresada === 't' || m.unidadIngresada === 'kg') && m.m3 === null) return 'aluminioPlastico';
  return 'agregados';
}

/** Las salidas de ese bloque, en el orden de la jornada (7am a 7am). */
export function salidasDeClase(movs: Movimiento[], clase: ClaseSalida): Movimiento[] {
  return (movs ?? []).filter((m) => claseDeSalida(m) === clase).sort(cmpMovimientoJornada);
}

/**
 * «Pendientes de pesaje»: las salidas de ACERO del sitio, de CUALQUIER fecha, que
 * siguen «esperando pesaje» (la nota de entrega con las toneladas no ha llegado). De
 * la más vieja a la más nueva: la que más espera va primero.
 */
export function pendientesDePesaje(movs: Movimiento[], sitioId: string): Movimiento[] {
  return (movs ?? [])
    .filter((m) => m && m.sitioId === sitioId && m.tipo === 'salida' && m.estado === 'esperando_pesaje' && esAcero(m.material))
    .sort(cmpMovimientoJornada);
}

// ═══════════════════════════ Listas del sitio ═══════════════════════════

/** Los materiales ACTIVOS de la lista para cada bloque, A→Z y sin repetir.
 *  Agregados: todos menos acero, aluminio, plástico y el material de los bloques
 *  (tienen su bloque). Aluminio y plástico: los dos de siempre primero, y los demás de
 *  la lista (menos acero y el de los bloques). */
export function materialesPara(listas: ItemLista[], clase: 'agregados' | 'aluminioPlastico'): string[] {
  const vistos = new Map<string, string>();
  const agregar = (s: string) => { const t = limpia(s); if (t && !vistos.has(llave(t))) vistos.set(llave(t), t); };
  const deLaLista = (listas ?? [])
    .filter((i) => i.activo && i.clase === 'material' && !esAcero(i.nombre) && !esMaterialDeBloques(i.nombre, i.id, listas))
    .filter((i) => clase === 'aluminioPlastico' || !esAluminioOPlastico(i.nombre))
    .map((i) => i.nombre)
    .sort(cmpText);
  if (clase === 'aluminioPlastico') {
    agregar(MATERIAL_ALUMINIO);
    agregar(MATERIAL_PLASTICO);
    const resto = deLaLista.filter((n) => !esAluminioOPlastico(n));
    resto.forEach(agregar);
    return [...vistos.values()];
  }
  deLaLista.forEach(agregar);
  return [...vistos.values()];
}

/** El ítem de la lista de esa clase que corresponde a lo escrito: por id si salió de la
 *  lista (y sigue ahí), si no por el nombre escrito igual. */
function itemDe(v: ValorLista, listas: ItemLista[], clase: ItemLista['clase']): ItemLista | null {
  const items = (listas ?? []).filter((i) => i.clase === clase);
  const porId = v?.listaId ? items.find((i) => i.id === v.listaId) ?? null : null;
  if (porId && llave(porId.nombre) === llave(v.texto)) return porId;
  return itemDeLista(v?.texto ?? '', items);
}

/**
 * El factor (t por m³) del material escrito: el de su lista si tiene uno > 0; si no
 * (no está en la lista, o está sin factor), el de los agregados (1,2).
 */
export function factorDeMaterial(material: ValorLista, listas: ItemLista[]): { factor: number; deLista: boolean } {
  const item = itemDe(material, listas, 'material');
  const f = item?.factorTM3;
  return esNumero(f) && f > 0 ? { factor: f, deLista: true } : { factor: FACTOR_AGREGADOS, deLista: false };
}

/** Los km del destino escrito según su lista (null si no está o no tiene km). */
export function kmDeDestino(destino: ValorLista, listas: ItemLista[]): number | null {
  const km = itemDe(destino, listas, 'destino')?.km;
  return esNumero(km) && km >= 0 ? km : null;
}

/**
 * Los km que se CONGELAN en el renglón: los del destino AHORA. Al editar una salida
 * que ya tenía sus km y no se le cambió el destino, se quedan los que tenía (si el
 * destino cambió de km después, esa salida no cambia).
 */
export function kmCongelado(destino: ValorLista, listas: ItemLista[], editando: Movimiento | null): number | null {
  if (editando && esNumero(editando.km) && llave(editando.destino) === llave(destino?.texto)) return editando.km;
  return kmDeDestino(destino, listas);
}

/** «Planta Norte · 12,5 km» / «Planta Norte (sin km)» / '' sin destino. */
export function textoDestino(destino: string | null | undefined, km: number | null | undefined): string {
  const d = limpia(destino);
  if (!d) return '';
  return esNumero(km) ? `${d} · ${km.toLocaleString('es-VE', { maximumFractionDigits: 1 })} km` : `${d} (sin km)`;
}

// ═══════════════════════════ El vehículo (nuestro o externo) ═══════════════════════════

/** Lo que tienen en común los formularios con vehículo. */
type ConVehiculo = {
  vehiculo: VehiculoMov;
  unidadId: string | null;
  unidadTexto: string;
  placa: string;
  chofer: string;
};

/**
 * Elegir una unidad de NUESTRA flota: el vehículo pasa a «propio» y se copian su
 * nombre, su placa y su chofer. El chofer escrito a mano se respeta si la unidad no
 * trae uno; el que venía de la unidad anterior se cambia (era de otro camión).
 * Con null se suelta la unidad (lo escrito queda).
 */
export function elegirUnidadSalida<F extends ConVehiculo>(f: F, u: Unidad | null, unidades: Unidad[]): F {
  if (!u) return { ...f, unidadId: null };
  const anterior = f.unidadId ? (unidades ?? []).find((x) => x.id === f.unidadId) ?? null : null;
  const choferDeLaUnidad = limpia(u.chofer);
  const venia = !limpia(f.chofer) || (!!anterior && limpia(f.chofer) === limpia(anterior.chofer));
  return {
    ...f,
    vehiculo: 'propio',
    unidadId: u.id,
    unidadTexto: textoDeUnidad(u),
    placa: limpia(u.placa),
    chofer: choferDeLaUnidad || (venia ? '' : f.chofer),
  };
}

/** «Cambiar» de unidad: se suelta la elegida con su nombre y su placa; el chofer se va
 *  solo si era el de esa unidad (uno escrito a mano se queda). */
export function soltarUnidadSalida<F extends ConVehiculo>(f: F, unidades: Unidad[]): F {
  const anterior = f.unidadId ? (unidades ?? []).find((x) => x.id === f.unidadId) ?? null : null;
  const choferDeElla = !!anterior && !!limpia(f.chofer) && limpia(f.chofer) === limpia(anterior.chofer);
  return { ...f, unidadId: null, unidadTexto: '', placa: '', chofer: choferDeElla ? '' : f.chofer };
}

/**
 * Escribir la PLACA de «Vehículo nuestro» (lote 5 B3): la MISMA regla de ✍️ Carga libre
 * (`unidadPorPlaca`, con `clavePlaca`: espacios, guiones y mayúsculas no cuentan).
 *   · Si es la placa de UNA unidad activa del sitio → se vincula a ella y trae su chofer
 *     (como tocar su pastilla); lo tecleado queda tal cual en el campo.
 *   · Si se corrige la placa de la unidad vinculada y ya no es la suya → se suelta la
 *     unidad (y su chofer, si era el de ella); lo tecleado NO se vacía.
 *   · Una unidad elegida que no tiene placa en la flota no se suelta por escribirle una,
 *     y con dos unidades activas con la misma placa no se adivina.
 */
export function escribirPlacaSalida<F extends ConVehiculo>(f: F, placa: string, unidades: Unidad[]): F {
  const nueva = unidadPorPlaca(placa, unidades ?? []);
  const anterior = f.unidadId ? (unidades ?? []).find((x) => x.id === f.unidadId) ?? null : null;
  if (nueva && anterior && nueva.id === anterior.id) return { ...f, placa };
  if (nueva) return { ...elegirUnidadSalida(f, nueva, unidades), placa };
  if (!f.unidadId) return { ...f, placa };
  // La vinculada solo se suelta si el vínculo vino de SU placa (tiene una y era la escrita).
  const vinoDeLaPlaca = !!anterior && clavePlaca(anterior.placa) !== '' && clavePlaca(f.placa) === clavePlaca(anterior.placa);
  if (!vinoDeLaPlaca) return { ...f, placa };
  const choferDeLaUnidad = !!limpia(f.chofer) && limpia(f.chofer) === limpia(anterior?.chofer);
  return { ...f, placa, unidadId: null, unidadTexto: '', chofer: choferDeLaUnidad ? '' : f.chofer };
}

/** Lo que va a la base del vehículo: nuestro → unidad, placa y chofer (sin empresa);
 *  externo → solo la empresa (sin unidad, placa ni chofer). */
function vehiculoAFila(f: ConVehiculo, empresa: ValorLista): Partial<Movimiento> {
  const [transportista, transportistaId] = deLista(empresa);
  if (f.vehiculo === 'externo') {
    return { vehiculo: 'externo', unidadId: null, unidadTexto: '', placa: null, chofer: null, transportista, transportistaId };
  }
  return {
    vehiculo: 'propio',
    unidadId: f.unidadId || null,
    unidadTexto: limpia(f.unidadTexto),
    placa: limpia(f.placa).toUpperCase() || null,
    chofer: limpia(f.chofer) || null,
    transportista: null,
    transportistaId: null,
  };
}

/** Errores del vehículo: nuestro pide la unidad (o al menos la placa); externo, la empresa. */
function erroresVehiculo(f: ConVehiculo, empresa: ValorLista): string[] {
  if (f.vehiculo === 'externo') return limpia(empresa?.texto) ? [] : ['Escribe el nombre de la compañía del vehículo externo.'];
  if (f.vehiculo !== 'propio') return ['Elige el vehículo: nuestro o externo.'];
  return limpia(f.unidadTexto) || limpia(f.placa) ? [] : ['Elige la unidad de nuestra flota (o escribe su placa).'];
}

/** Viajes obligatorios: entero de 1 en adelante. */
function erroresViajes(txt: string): { valor: number | null; errores: string[] } {
  const v = viajesDeCampo(txt);
  if (v.error) return { valor: null, errores: [v.error] };
  if (v.valor === null || v.valor < 1) return { valor: null, errores: ['Los viajes van de 1 en adelante.'] };
  return { valor: v.valor, errores: [] };
}

function erroresFecha(fecha: string): string[] {
  return fechaValida(fecha) ? [] : ['La fecha de la jornada no es válida: elígela arriba en el Parte diario.'];
}

/** Lo que sale del formulario: `datos` solo sirve si no hay errores. */
export type Resultado = { errores: string[]; datos: Partial<Movimiento> };

/** Cuando una cifra > 0 se convierte en 0 (lote 5 A3): se dice y no se guarda. */
const TEXTO_DA_CERO = 'La cantidad convertida da 0: revisa la cifra y la unidad (¿1.500 kg son mil quinientos? escríbelo 1500, sin punto).';

/**
 * El aviso EN VIVO de una cifra en kg con decimales (lote 5 A3): con la regla de la casa,
 * un solo punto es el decimal, así que «12.500» se lee 12,5 kg. Se dice lo que se leyó
 * y, si parece un punto de miles, cómo escribirlo. null si no hace falta.
 */
export function avisoKg(txt: string, unidad: string): string | null {
  if (unidad !== 'kg') return null;
  const v = cifraDeCampo(txt).valor;
  if (v === null || Number.isInteger(v)) return null;
  const leido = `${v.toLocaleString('es-VE', { maximumFractionDigits: 3 })} kg`;
  if (/^\s*\d{1,3}\.\d{3}\s*$/.test(String(txt ?? ''))) {
    const miles = Math.round(v * 1000);
    return `⚠️ Se leyó ${leido}. Si son ${miles.toLocaleString('es-VE')} kg, escríbelo sin punto: ${miles}.`;
  }
  return `⚠️ Se leyó ${leido}, con decimales: revisa la cifra (en kg va un número entero).`;
}

// ═══════════════════════════ AGREGADOS ═══════════════════════════

/**
 * Lo que una salida YA GUARDADA dice de su cantidad (revisión final A#3): con qué material,
 * en qué unidad y con qué cifra se escribió, y los m³ y las toneladas que quedaron. Mientras
 * no cambien el material, la unidad ni la cifra, esos m³ y toneladas SE QUEDAN (como los km
 * de `kmCongelado`): el factor del material puede haber cambiado después en ⚙️ Ajustes, y el
 * papel de un período cerrado no puede moverse por corregir una observación.
 */
export type CantidadGuardada = { material: string; unidad: UnidadCantidad; cifra: number | null; m3: number; t: number };

export type FormAgregado = ConVehiculo & {
  material: ValorLista;
  cantidad: string;
  unidad: UnidadCantidad;
  destino: ValorLista;
  /** La compañía del vehículo externo. */
  empresa: ValorLista;
  viajes: string;
  observacion: string;
  /** Solo al EDITAR (lo pone `formAgregadoDesde`): lo que la salida ya tenía guardado. */
  guardada?: CantidadGuardada | null;
};

export function formAgregadoNuevo(): FormAgregado {
  return {
    material: VACIO_LISTA(), cantidad: '', unidad: 'm3', destino: VACIO_LISTA(),
    vehiculo: 'propio', unidadId: null, unidadTexto: '', placa: '', chofer: '',
    empresa: VACIO_LISTA(), viajes: '1', observacion: '',
  };
}

/** Lo guardado de una salida (`CantidadGuardada`), o null si no trae m³ y toneladas. */
function cantidadGuardadaDe(m: Movimiento | null | undefined, unidad: UnidadCantidad, cantidad: string): CantidadGuardada | null {
  if (!m || !esNumero(m.m3) || !esNumero(m.toneladas)) return null;
  return { material: limpia(m.material), unidad, cifra: cifraDeCampo(cantidad).valor, m3: m.m3, t: m.toneladas };
}

/**
 * Las tres cantidades en vivo (con el factor del material). Vacío o inválido → todo null.
 * ⭐ Al editar (revisión final A#3): con el MISMO material, la misma unidad y la misma cifra
 *    que la salida guardada, son SUS m³ y toneladas (no se recalculan con el factor de hoy);
 *    si cambia cualquiera de los tres, es una conversión nueva con el factor de ahora.
 */
export function cantidadesAgregado(f: FormAgregado, listas: ItemLista[]): Cantidades {
  const v = cifraDeCampo(f.cantidad).valor;
  const g = usaLoGuardado(f);
  if (g && v !== null) return { m3: g.m3, t: g.t, kg: f.unidad === 'kg' ? v : Math.round(g.t * 1000) };
  return convertirCantidad(v, f.unidad, factorDeMaterial(f.material, listas).factor);
}

/** Lo guardado de la salida que se edita, si SIGUE valiendo (el mismo material, la misma unidad
 *  y la misma cifra); si no, null (es una conversión nueva con el factor de ahora). */
function usaLoGuardado(f: FormAgregado): CantidadGuardada | null {
  const g = f?.guardada;
  if (!g) return null;
  const v = cifraDeCampo(f.cantidad).valor;
  return v !== null && v === g.cifra && f.unidad === g.unidad && llave(f.material?.texto) === llave(g.material) ? g : null;
}

/**
 * El factor (t por m³) que dice la pantalla debajo del material (pendiente de F2a, M4):
 *   · al EDITAR una salida con lo guardado intacto (mismo material, unidad y cifra), el de ESA
 *     salida: sus toneladas ÷ sus m³ (`guardado: true`), que es el que dan las cifras de abajo;
 *   · si no (salida nueva, o se cambió algo), el del material ahora (`factorDeMaterial`).
 */
export function factorDelFormulario(f: FormAgregado, listas: ItemLista[]): { factor: number; deLista: boolean; guardado: boolean } {
  const g = usaLoGuardado(f);
  if (g && g.m3 > 0 && g.t > 0) return { factor: g.t / g.m3, deLista: false, guardado: true };
  return { ...factorDeMaterial(f.material, listas), guardado: false };
}

/** «12,00 m³ · 14,40 t · 14.400 kg» de lo que se está escribiendo ('' si no hay cifra). */
export function textoEnVivoAgregado(f: FormAgregado, listas: ItemLista[]): string {
  return textoCantidades(cantidadesAgregado(f, listas));
}

/**
 * Revisa el formulario de agregados y arma la salida: tipo «salida», confirmada, con
 * m³ Y toneladas (calculadas desde la cifra escrita), la unidad en que se escribió,
 * el destino con sus km congelados y el vehículo.
 */
export function validarAgregado(f: FormAgregado, fecha: string, listas: ItemLista[], editando: Movimiento | null = null): Resultado {
  const errores: string[] = [...erroresFecha(fecha)];
  const [material, materialId] = deLista(f.material);
  if (!material) errores.push('Elige el material.');
  else if (esAcero(material)) errores.push('El acero se anota en su bloque «Acero».');
  else if (esAluminioOPlastico(material)) errores.push('El aluminio y el plástico se anotan en su bloque «Aluminio y plástico».');
  else if (esMaterialDeBloques(material, materialId, listas)) errores.push('Los bloques se anotan en su bloque «🧱 Bloques».');

  if (!UNIDADES_AGREGADOS.some((u) => u.key === f.unidad)) errores.push('Elige la unidad: m³, t o kg.');
  const cifra = cifraDeCampo(f.cantidad, { mayorQueCero: true });
  if (cifra.error) errores.push(`Cantidad: ${cifra.error}`);
  else if (cifra.valor === null) errores.push('Escribe la cantidad.');

  const [destino, destinoId] = deLista(f.destino);
  if (!destino) errores.push('Elige el destino.');
  errores.push(...erroresVehiculo(f, f.empresa));
  const viajes = erroresViajes(f.viajes);
  errores.push(...viajes.errores);

  // ⭐ Lo guardado manda mientras no cambien el material, la unidad ni la cifra (A#3). Sale
  //    de `editando` (la fuente es la salida, no lo que traiga el formulario): una salida
  //    NUEVA siempre convierte con el factor de ahora.
  const guardada = editando ? formAgregadoDesde(editando).guardada ?? null : null;
  const c = cantidadesAgregado({ ...f, guardada }, listas);
  // ⭐ Una cifra > 0 que al convertirse da 0 m³ o 0 t NO se guarda (lote 5 A3).
  if (!cifra.error && cifra.valor !== null && cifra.valor > 0 && (c.m3 === 0 || c.t === 0)) errores.push(TEXTO_DA_CERO);
  return {
    errores,
    datos: {
      tipo: 'salida',
      fecha: editando ? editando.fecha : fecha,
      estado: 'confirmado',
      material,
      materialId: material ? (itemDe(f.material, listas, 'material')?.id ?? materialId) : null,
      m3: c.m3,
      toneladas: c.t,
      unidadIngresada: f.unidad,
      destino,
      destinoId: destino ? (itemDe(f.destino, listas, 'destino')?.id ?? destinoId) : null,
      km: destino ? kmCongelado(f.destino, listas, editando) : null,
      ...vehiculoAFila(f, f.empresa),
      viajes: viajes.valor,
      observacion: String(f.observacion ?? '').trim() || null,
    },
  };
}

/** Una salida guardada → el formulario de agregados para editarla. La cantidad vuelve
 *  en la unidad en que se escribió (kg = toneladas × 1.000), y lleva lo GUARDADO
 *  (`guardada`): mientras no se cambie la cantidad, sus m³ y toneladas se quedan (A#3). */
export function formAgregadoDesde(m: Movimiento): FormAgregado {
  const unidad: UnidadCantidad = m.unidadIngresada === 't' || m.unidadIngresada === 'kg' || m.unidadIngresada === 'm3'
    ? m.unidadIngresada
    : esNumero(m.m3) ? 'm3' : 't';
  const cantidad = unidad === 'm3' ? textoDeCifra(m.m3)
    : unidad === 't' ? textoDeCifra(m.toneladas)
      : esNumero(m.toneladas) ? String(Math.round(m.toneladas * 1000)) : '';
  return {
    material: { texto: m.material ?? '', listaId: m.materialId ?? null },
    cantidad,
    unidad,
    destino: { texto: m.destino ?? '', listaId: m.destinoId ?? null },
    vehiculo: vehiculoDe(m),
    unidadId: m.unidadId ?? null,
    unidadTexto: m.unidadTexto ?? '',
    placa: m.placa ?? '',
    chofer: m.chofer ?? '',
    empresa: { texto: m.transportista ?? '', listaId: m.transportistaId ?? null },
    viajes: textoDeCifra(m.viajes) || '1',
    observacion: m.observacion ?? '',
    guardada: cantidadGuardadaDe(m, unidad, cantidad),
  };
}

/**
 * El vehículo de un renglón: el guardado; si no tiene (viene de ✍️ Carga libre), es
 * EXTERNO si trae una empresa que no es «Nosotros» — la unidad o la placa no deciden: la
 * flota también tiene camiones de otros dueños (lote 5 B4) — y nuestro en los demás
 * casos. (El 📄 Reporte completo la usa también: misma firma.)
 */
export function vehiculoDe(m: Movimiento): VehiculoMov {
  if (m.vehiculo === 'propio' || m.vehiculo === 'externo') return m.vehiculo;
  const empresa = limpia(m.transportista);
  return empresa && !esNosotros(empresa) ? 'externo' : 'propio';
}

/**
 * ¿Se corrige con ✏️ en el Parte diario? Solo lo que escribió el Parte diario (siempre
 * guarda el vehículo). Lo de ✍️ Carga libre (sin vehículo) se VE aquí pero se corrige
 * allá: estos formularios no saben guardar todo lo que trae (la empresa con la placa,
 * un «por confirmar» sin viajes…) y guardarlo aquí lo cambiaría (lote 5 B4 y R1).
 */
export function editableEnParteDiario(m: Movimiento): boolean {
  return !!m && (m.vehiculo === 'propio' || m.vehiculo === 'externo');
}

/** El bloque del 📅 Parte diario que escribió cada clase de salida (como lo titula la pestaña). */
const BLOQUE_DE_SALIDA: Record<ClaseSalida, string> = {
  agregados: '🚚 Salidas de agregados',
  acero: '🔩 Acero',
  aluminioPlastico: '♻️ Aluminio y plástico',
};

/**
 * ⭐ ¿DÓNDE SE CORRIGE este renglón, si NO es en ✍️ Carga libre ni en 📋 Registros? El aviso
 * que la fila pone en lugar del ✏️, o null si se corrige ahí (revisión final A#1 + B-M3).
 * Cada renglón se corrige DONDE NACIÓ:
 *   · la producción y las ventas de bloques → 📅 Parte diario → 🧱 Bloques
 *     (`avisoEdicionBloques`, lote 5 A4);
 *   · una salida del 📅 Parte diario (trae `vehiculo`: es el espejo exacto de
 *     `editableEnParteDiario`) → su bloque. El formulario de Carga libre no sabe de la unidad
 *     en que se escribió la cantidad (m³/t/kg), del chofer ni del vehículo: corregir ahí el
 *     m³ dejaba «20 m³ · 12 t» en los papeles, y la cifra dependía de dónde se corrigió.
 */
export function dondeSeCorrige(m: Movimiento | null | undefined): string | null {
  if (!m) return null;
  const bloques = avisoEdicionBloques(m);
  if (bloques) return bloques;
  if (!editableEnParteDiario(m)) return null;
  const clase = claseDeSalida(m);
  const bloque = clase ? BLOQUE_DE_SALIDA[clase] : null;
  return `${clase === 'acero' ? '🔩' : clase === 'aluminioPlastico' ? '♻️' : '🚚'} Se anotó en 📅 Parte diario${bloque ? ` → ${bloque}` : ''}: se corrige allá, no aquí.`;
}

// ═══════════════════════════ ACERO ═══════════════════════════

export type FormAcero = ConVehiculo & {
  /** Quién se lo lleva (una empresa de la lista, «Nosotros» u otra). */
  quien: ValorLista;
  m3: string;
  /** Solo al EDITAR una salida que ya tiene su pesaje: las toneladas de la nota. */
  toneladas: string;
  viajes: string;
  observacion: string;
};

export function formAceroNuevo(): FormAcero {
  return {
    quien: VACIO_LISTA(), vehiculo: 'externo', unidadId: null, unidadTexto: '', placa: '', chofer: '',
    m3: '', toneladas: '', viajes: '1', observacion: '',
  };
}

/** Elegir quién se lo lleva: «Nosotros» → vehículo nuestro (se elige la unidad); otro
 *  (una empresa de la lista o quien sea) → externo, y el camión se escribe. Si pasa de nuestro a externo
 *  (o al revés), el camión se vacía: una unidad nuestra no es el camión de otro, ni lo
 *  escrito como camión externo es una unidad nuestra. */
export function elegirQuienAcero(f: FormAcero, quien: ValorLista): FormAcero {
  const vehiculo: VehiculoMov = esNosotros(quien.texto) ? 'propio' : 'externo';
  if (vehiculo === f.vehiculo) return { ...f, quien };
  return { ...f, quien, vehiculo, unidadId: null, unidadTexto: '', placa: '', chofer: '' };
}

/**
 * Revisa el formulario de acero y arma la salida: material «Acero», sus m³ y, mientras
 * no llegue la nota de entrega, SIN toneladas y «esperando pesaje». (Si al editar ya
 * trae toneladas, queda «confirmado».) Con nosotros va la unidad, placa y chofer; con
 * otro, la empresa y el camión escrito.
 */
export function validarAcero(f: FormAcero, fecha: string, listas: ItemLista[], editando: Movimiento | null = null): Resultado {
  const errores: string[] = [...erroresFecha(fecha)];
  const [quien, quienId] = deLista(f.quien);
  if (!quien) errores.push('Escribe quién se lleva el acero (una empresa de la lista, nosotros u otra).');
  const nuestro = esNosotros(quien);
  const vehiculo: ConVehiculo = { ...f, vehiculo: nuestro ? 'propio' : 'externo' };
  if (nuestro && !limpia(f.unidadTexto) && !limpia(f.placa)) errores.push('Elige la unidad de nuestra flota (o escribe su placa).');
  if (!nuestro && !limpia(f.unidadTexto)) errores.push('Escribe el camión (placa o cómo se llama).');

  const m3 = cifraDeCampo(f.m3, { mayorQueCero: true });
  if (m3.error) errores.push(`m³: ${m3.error}`);
  else if (m3.valor === null) errores.push('Escribe los m³ del acero que salió.');
  const ton = cifraDeCampo(f.toneladas, { mayorQueCero: true });
  if (ton.error) errores.push(`Toneladas: ${ton.error}`);
  const viajes = erroresViajes(f.viajes);
  errores.push(...viajes.errores);

  const acero = (listas ?? []).find((i) => i.clase === 'material' && i.activo && esAcero(i.nombre)) ?? null;
  const fila = nuestro
    ? { ...vehiculoAFila(vehiculo, { texto: '', listaId: null }), transportista: NOSOTROS, transportistaId: quienId }
    : { vehiculo: 'externo' as const, unidadId: null, unidadTexto: limpia(f.unidadTexto), placa: null, chofer: null, transportista: quien, transportistaId: quienId };
  const conPeso = ton.valor !== null;
  const datos: Partial<Movimiento> = {
    tipo: 'salida',
    fecha: editando ? editando.fecha : fecha,
    estado: (conPeso ? 'confirmado' : 'esperando_pesaje') as EstadoMov,
    material: MATERIAL_ACERO,
    materialId: acero?.id ?? null,
    m3: m3.valor,
    toneladas: conPeso ? ton.valor : null,
    unidadIngresada: 'm3',
    ...fila,
    viajes: viajes.valor,
    observacion: String(f.observacion ?? '').trim() || null,
  };
  // ⭐ Corregir el camión o los m³ de una salida que ESPERABA pesaje, sin escribir
  //    toneladas, no toca el pesaje: si mientras tanto alguien la completó («Completar
  //    toneladas», otro equipo), guardar la corrección no la devuelve a «pendiente».
  if (editando && editando.estado === 'esperando_pesaje' && !conPeso) {
    delete datos.estado;
    delete datos.toneladas;
  }
  return { errores, datos };
}

export function formAceroDesde(m: Movimiento): FormAcero {
  const vehiculo = vehiculoDe(m);
  return {
    quien: vehiculo === 'propio'
      ? { texto: NOSOTROS, listaId: null }
      : { texto: m.transportista ?? '', listaId: m.transportistaId ?? null },
    vehiculo,
    unidadId: m.unidadId ?? null,
    unidadTexto: m.unidadTexto ?? '',
    placa: m.placa ?? '',
    chofer: m.chofer ?? '',
    m3: textoDeCifra(m.m3),
    toneladas: m.estado === 'confirmado' ? textoDeCifra(m.toneladas) : '',
    viajes: textoDeCifra(m.viajes) || '1',
    observacion: m.observacion ?? '',
  };
}

/**
 * «Completar toneladas» de una salida de acero que espera la nota de entrega: SOLO
 * cambia las toneladas y el estado (pasa a «confirmado»); lo demás no viaja.
 */
export function completarPesaje(m: Movimiento, txt: string): { error: string | null; cambio: Partial<Movimiento> | null } {
  if (!m || !m.id) return { error: 'No se encontró la salida.', cambio: null };
  const t = cifraDeCampo(txt, { mayorQueCero: true });
  if (t.error) return { error: `Toneladas: ${t.error}`, cambio: null };
  if (t.valor === null) return { error: 'Escribe las toneladas de la nota de entrega.', cambio: null };
  return { error: null, cambio: { id: m.id, toneladas: t.valor, estado: 'confirmado' } };
}

// ═══════════════════════════ ALUMINIO Y PLÁSTICO ═══════════════════════════

export type FormAluminio = {
  material: ValorLista;
  cantidad: string;
  unidad: 't' | 'kg';
  /** La empresa (compradora o la que se lo lleva): «Nosotros» u otra. */
  empresa: ValorLista;
  destino: ValorLista;
  viajes: string;
  observacion: string;
};

export function formAluminioNuevo(): FormAluminio {
  return { material: VACIO_LISTA(), cantidad: '', unidad: 't', empresa: VACIO_LISTA(), destino: VACIO_LISTA(), viajes: '1', observacion: '' };
}

/** Las toneladas de lo escrito (los kg se pasan a t); null si no hay cifra válida. */
export function toneladasAluminio(f: FormAluminio): number | null {
  return convertirCantidad(cifraDeCampo(f.cantidad).valor, f.unidad, null).t;
}

/**
 * Revisa el formulario de aluminio y plástico y arma la salida: confirmada, con las
 * toneladas (de t o de kg) y SIN m³ (no tienen factor), la empresa y el destino (con
 * sus km congelados, si está en la lista).
 */
export function validarAluminio(f: FormAluminio, fecha: string, listas: ItemLista[], editando: Movimiento | null = null): Resultado {
  const errores: string[] = [...erroresFecha(fecha)];
  const [material, materialId] = deLista(f.material);
  if (!material) errores.push('Elige el material (aluminio, plástico u otro).');
  else if (esAcero(material)) errores.push('El acero se anota en su bloque «Acero».');
  else if (esMaterialDeBloques(material, materialId, listas)) errores.push('Los bloques se anotan en su bloque «🧱 Bloques».');
  if (f.unidad !== 't' && f.unidad !== 'kg') errores.push('Elige la unidad: t o kg.');
  const cifra = cifraDeCampo(f.cantidad, { mayorQueCero: true });
  if (cifra.error) errores.push(`Cantidad: ${cifra.error}`);
  else if (cifra.valor === null) errores.push('Escribe la cantidad.');
  const toneladas = convertirCantidad(cifra.valor, f.unidad, null).t;
  // ⭐ Una cifra > 0 que al pasarse a toneladas da 0 NO se guarda (lote 5 A3).
  if (!cifra.error && cifra.valor !== null && cifra.valor > 0 && toneladas === 0) errores.push(TEXTO_DA_CERO);
  const [empresa, empresaId] = deLista(f.empresa);
  if (!empresa) errores.push('Escribe la empresa (nosotros u otra).');
  const [destino, destinoId] = deLista(f.destino);
  const viajes = erroresViajes(f.viajes);
  errores.push(...viajes.errores);

  return {
    errores,
    datos: {
      tipo: 'salida',
      fecha: editando ? editando.fecha : fecha,
      estado: 'confirmado',
      material,
      materialId: material ? (itemDe(f.material, listas, 'material')?.id ?? materialId) : null,
      m3: null,
      toneladas,
      unidadIngresada: f.unidad,
      transportista: empresa,
      transportistaId: empresaId,
      vehiculo: empresa ? (esNosotros(empresa) ? 'propio' : 'externo') : null,
      destino,
      destinoId: destino ? (itemDe(f.destino, listas, 'destino')?.id ?? destinoId) : null,
      km: destino ? kmCongelado(f.destino, listas, editando) : null,
      viajes: viajes.valor,
      observacion: String(f.observacion ?? '').trim() || null,
    },
  };
}

export function formAluminioDesde(m: Movimiento): FormAluminio {
  const unidad: 't' | 'kg' = m.unidadIngresada === 'kg' ? 'kg' : 't';
  return {
    material: { texto: m.material ?? '', listaId: m.materialId ?? null },
    cantidad: unidad === 'kg' ? (esNumero(m.toneladas) ? String(Math.round(m.toneladas * 1000)) : '') : textoDeCifra(m.toneladas),
    unidad,
    empresa: { texto: m.transportista ?? '', listaId: m.transportistaId ?? null },
    destino: { texto: m.destino ?? '', listaId: m.destinoId ?? null },
    viajes: textoDeCifra(m.viajes) || '1',
    observacion: m.observacion ?? '',
  };
}

// ═══════════════════════════ Cómo se ve una salida en la lista ═══════════════════════════

/**
 * Las líneas de una salida en la lista del día:
 *   titulo  → «Triturado mixto»
 *   cifras  → «12,00 m³ · 14,40 t · 14.400 kg · 1 viaje» (acero sin pesar: «8,00 m³ ·
 *             ⚖️ toneladas pendientes»)
 *   destino → «Planta Norte · 12,5 km»
 *   vehiculo→ «🚛 Volteo 3 · AB123CD · 👷 Pedro» / «🏢 Transportes X» / «🏢 Empresa · camión … · placa»
 *   estado  → «❓ Por confirmar (no suma)» / «⚖️ Esperando pesaje» / '' (confirmada, o el
 *             acero sin pesar, que ya lo dice en las cifras). Lo de ✍️ Carga libre puede
 *             venir así (lote 5 R1).
 */
export function lineasSalida(m: Movimiento): { titulo: string; cifras: string; destino: string; vehiculo: string; estado: string } {
  const clase = claseDeSalida(m);
  const viajes = esNumero(m.viajes) ? `${m.viajes.toLocaleString('es-VE')} ${m.viajes === 1 ? 'viaje' : 'viajes'}` : '';
  let cantidades: string;
  if (clase === 'acero') {
    const m3 = esNumero(m.m3) ? textoCantidades({ m3: m.m3, t: null, kg: null }) : '';
    const t = m.estado === 'esperando_pesaje' || !esNumero(m.toneladas)
      ? '⚖️ toneladas pendientes'
      : textoCantidades({ m3: null, t: m.toneladas, kg: m.toneladas * 1000 });
    cantidades = [m3, t].filter(Boolean).join(' · ');
  } else {
    const t = esNumero(m.toneladas) ? m.toneladas : null;
    cantidades = textoCantidades({ m3: esNumero(m.m3) ? m.m3 : null, t, kg: t === null ? null : t * 1000 });
  }
  const unidad = limpia(m.unidadTexto);
  const placa = limpia(m.placa);
  const chofer = limpia(m.chofer);
  const empresa = limpia(m.transportista);
  const propio = vehiculoDe(m) === 'propio';
  const partesVehiculo = propio
    ? [`🚛 ${unidad || placa || 'Unidad nuestra'}`, placa && llave(placa) !== llave(unidad) ? placa : '', chofer ? `👷 ${chofer}` : '']
    // Externo: la empresa, y el camión y la placa si los trae (lo de ✍️ Carga libre, B4).
    : [`🏢 ${empresa || 'Externo'}`, unidad ? `camión ${unidad}` : '', placa && llave(placa) !== llave(unidad) ? placa : ''];
  const estado = m.estado === 'por_confirmar'
    ? '❓ Por confirmar (no suma)'
    : m.estado === 'esperando_pesaje' && clase !== 'acero' ? '⚖️ Esperando pesaje' : '';
  return {
    titulo: limpia(m.material) || 'Sin material',
    cifras: [cantidades, viajes].filter(Boolean).join(' · '),
    destino: textoDestino(m.destino, m.km),
    vehiculo: partesVehiculo.filter(Boolean).join(' · '),
    estado,
  };
}

// ═══════════════════════════ Pastillas y resúmenes ═══════════════════════════

/**
 * Las pastillas de «quién se lleva el acero» (lote 5 B19): salen de la LISTA de
 * transportistas del sitio (las suyas y las generales, activas), nunca de un nombre
 * fijo en el código. Primero las que ya se llevaron acero (`usados`: los nombres de las
 * salidas de acero a la vista, las más repetidas primero), después las demás A→Z; sin
 * «Nosotros» (tiene su propia pastilla) y hasta `max`.
 */
export function pastillasQuienAcero(listas: ItemLista[], sitioId: string, usados: string[] = [], max: number = MAX_PASTILLAS_QUIEN): string[] {
  const deLaLista = new Map<string, string>();
  (listas ?? [])
    .filter((i) => i && i.activo && i.clase === 'transportista' && (i.sitioId === sitioId || i.sitioId === null) && limpia(i.nombre) && !esNosotros(i.nombre))
    .map((i) => limpia(i.nombre))
    .sort(cmpText)
    .forEach((n) => { if (!deLaLista.has(llave(n))) deLaLista.set(llave(n), n); });
  const veces = new Map<string, number>();
  for (const u of usados ?? []) {
    const k = llave(u);
    if (deLaLista.has(k)) veces.set(k, (veces.get(k) ?? 0) + 1);
  }
  const primero = [...veces.entries()]
    .sort((a, b) => b[1] - a[1] || cmpText(deLaLista.get(a[0]) ?? '', deLaLista.get(b[0]) ?? ''))
    .map(([k]) => k);
  const orden = [...primero, ...[...deLaLista.keys()].filter((k) => !veces.has(k))];
  return orden.slice(0, Math.max(0, max)).map((k) => deLaLista.get(k) as string);
}

/**
 * Lo que dice el encabezado PLEGADO de cada bloque de salidas (lote 5 B10): cuántas hay
 * ese día y, en el acero, cuántas esperan pesaje en este sitio (de cualquier día), con
 * tono de aviso si hay alguna.
 */
export function resumenSalidas(delDia: Movimiento[], pendientes: Movimiento[], clase: ClaseSalida, sitioId: string): { texto: string; alerta: boolean } {
  const n = salidasDeClase(delDia, clase).length;
  const deDia = n === 0 ? 'Ninguna salida ese día' : `${n.toLocaleString('es-VE')} ${n === 1 ? 'salida' : 'salidas'} ese día`;
  if (clase !== 'acero') return { texto: deDia, alerta: false };
  const p = pendientesDePesaje(pendientes, sitioId).length;
  const pend = p === 0 ? 'sin pendientes de pesaje' : `⚖️ ${p.toLocaleString('es-VE')} ${p === 1 ? 'pendiente' : 'pendientes'} de pesaje`;
  return { texto: `${deDia} · ${pend}`, alerta: p > 0 };
}

/** ¿Los dos formularios dicen lo mismo? (para saber si quedó algo «sin guardar»). */
export function mismoFormulario<F>(a: F, b: F): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
