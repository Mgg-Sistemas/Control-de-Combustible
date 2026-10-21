// ⛏️ EL MISMO FRENTE, ESCRITO DE VARIAS MANERAS (21-oct-2026).
//
// Reporte del cliente, con el cuadro del consolidado delante: «me salen
// repetidos, acomoda los nombres para que se junten todos… que se agrupen los
// frentes como debería, sin que se pierda la información de viajes ni pesos».
//
// EL PORQUÉ. El frente de un viaje queda CONGELADO como texto en el viaje
// («RES. CORAL»), y el catálogo puede llamarse de otra forma («RESIDENCIAS
// CORAL»). Los dos nombres son correctos y ninguno se puede borrar: el
// congelado es el que vio el listero ese día. Lo que estaba mal era CRUZARLOS
// con una comparación que solo perdonaba mayúsculas y acentos, así que el
// costo quedaba de un lado y las toneladas del otro, y el papel imprimía dos
// renglones de lo mismo (uno con «$0,00 de maquinaria»).
//
// ⭐ ESTA LIB NO TOCA NI UN DATO. Solo decide, para el papel, cuáles nombres
//    son el mismo frente y con cuál de ellos se imprime el grupo.
//
// PURA (sin imports): se prueba sola en scripts/test-frentes-nombre.mjs.

/** Abreviaturas del mismo tipo de sitio, estiradas para poder comparar. */
const ABREVIATURAS: [RegExp, string][] = [
  [/\bres\b/g, 'residencia'],
  [/\bresid\b/g, 'residencia'],
  [/\bresidencias\b/g, 'residencia'],
  [/\burb\b/g, 'urbanizacion'],
  [/\burbanizaciones\b/g, 'urbanizacion'],
  [/\bedif\b/g, 'edificio'],
  [/\bedificios\b/g, 'edificio'],
  [/\bqta\b/g, 'quinta'],
  [/\bcjto\b/g, 'conjunto'],
  [/\bconj\b/g, 'conjunto'],
  [/\bconjuntos\b/g, 'conjunto'],
];

/** Palabras que solo dicen QUÉ CLASE de sitio es, no cuál. */
const TIPOS = ['residencia', 'urbanizacion', 'edificio', 'quinta', 'conjunto', 'torre', 'complejo', 'hotel'];

/**
 * Las palabras que convierten un nombre en un TRAMO («playa escondida AL cdf
 * santa eduvigis»): si lo que sobra empieza así, el nombre largo es otra cosa
 * —un recorrido—, no el mismo sitio con más detalle. No se funden.
 */
const DE_TRAMO = ['al', 'a', 'hacia', 'desde', 'hasta', 'para', 'por', 'y', 'e', 'con', 'entre'];

/** Apóstrofes y comillas que la gente escribe de cuatro formas distintas. */
const APOSTROFES = /[´‘’`']/g;

/**
 * La CLAVE de un nombre de frente: sin mayúsculas, sin acentos, sin puntuación,
 * con las abreviaturas estiradas y el plural de «residencias» en singular.
 * «RES. CORAL» y «Residencias Coral» dan la misma clave.
 */
export function claveFrente(nombre: unknown): string {
  let s = String(nombre ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // acentos fuera (comparar no necesita la ñ aparte)
    .replace(APOSTROFES, '')          // EDUARD´S = EDUARD'S = EDUARDS
    .replace(/&/g, ' y ')
    .replace(/[^a-z0-9ñ]+/g, ' ')     // puntos, comas y guiones: todo es separador
    .trim()
    .replace(/\s+/g, ' ');
  for (const [re, largo] of ABREVIATURAS) s = s.replace(re, largo);
  return s.replace(/\s+/g, ' ').trim();
}

const palabras = (clave: string): string[] => (clave ? clave.split(' ') : []);

/** ¿`corta` está dentro de `larga` como secuencia COMPLETA de palabras? */
function posicionDe(corta: string[], larga: string[]): number {
  if (!corta.length || corta.length >= larga.length) return -1;
  for (let i = 0; i + corta.length <= larga.length; i += 1) {
    let ok = true;
    for (let j = 0; j < corta.length; j += 1) if (larga[i + j] !== corta[j]) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}

/**
 * ¿El nombre corto es el MISMO sitio que el largo, con más detalle?
 * Sí cuando el corto aparece entero dentro del largo y lo que sobra es:
 *  · delante, solo palabras de TIPO («residencia coral garden» ⊃ «coral garden»);
 *  · detrás, cualquier detalle que NO sea de tramo («…rita sol» + «palace» sí;
 *    «…playa escondida» + «al cdf santa eduvigis» NO: eso es un recorrido).
 */
function esElMismoSitio(corta: string, larga: string): boolean {
  const c = palabras(corta);
  const l = palabras(larga);
  const i = posicionDe(c, l);
  if (i < 0) return false;
  const antes = l.slice(0, i);
  const despues = l.slice(i + c.length);
  if (antes.some((p) => !TIPOS.includes(p))) return false;
  if (despues.length && DE_TRAMO.includes(despues[0])) return false;
  return true;
}

/** Cuántas palabras de TIPO sobran DELANTE (sin catálogo, es lo único que se perdona). */
function contarTipoDelante(corta: string, larga: string): number {
  const i = posicionDe(palabras(corta), palabras(larga));
  return i < 0 ? -1 : i;
}

/**
 * El nombre con el que se imprime un grupo: el MÁS COMPLETO.
 * Primero el que dice más (más palabras: «RESIDENCIA RITA SOL PALACE» antes
 * que «res. rita sol»); a igualdad, el mejor escrito (más mayúsculas, que es
 * como se rotulan los frentes en el papel); después el más largo y, al final,
 * el alfabético para que la elección sea siempre la misma.
 */
function masCompleto(nombres: string[]): string {
  const mayusculas = (t: string) => (String(t).match(/[A-ZÁÉÍÓÚÑÜ]/g) ?? []).length;
  return nombres.slice().sort((a, b) => {
    const pa = palabras(claveFrente(a)).length;
    const pb = palabras(claveFrente(b)).length;
    if (pa !== pb) return pb - pa;
    const ma = mayusculas(a), mb = mayusculas(b);
    if (ma !== mb) return mb - ma;
    const la = String(a).trim().length, lb = String(b).trim().length;
    if (la !== lb) return lb - la;
    return String(a).localeCompare(String(b), 'es', { sensitivity: 'base' });
  })[0];
}

export type GrupoFrente = { canonico: string; clave: string; nombres: string[] };

/**
 * Junta todos los nombres que son EL MISMO frente y dice con cuál se imprime.
 *
 * ⚠️ NUNCA JUNTA POR LAS DUDAS: un nombre corto se funde en uno largo solo si
 *    ese largo es el ÚNICO candidato. Con «residencia coral» conviviendo con
 *    «coral mar», «coral park» y «coral garden», hay tres candidatos: se queda
 *    solo, porque juntarlo con cualquiera sería inventar.
 */
export function agruparNombresFrente(nombres: Iterable<string>, catalogo?: Iterable<string> | null): GrupoFrente[] {
  // ⭐ LOS FRENTES DEL CATÁLOGO SON INTOCABLES. Un nombre que existe como
  //    frente de verdad NUNCA se absorbe dentro de otro: «RESIDENCIAS CORAL»
  //    es un frente propio y no puede caer dentro de «RESIDENCIA CORAL MAR»
  //    por parecerse. Lo que sí se absorbe son las etiquetas CONGELADAS en
  //    viajes viejos, que ya no existen en ningún catálogo.
  const protegidas = new Set<string>();
  for (const n of catalogo ?? []) {
    const k = claveFrente(n);
    if (k) protegidas.add(k);
  }
  // Sin catálogo a la vista no se adivina: solo se juntan los nombres a los
  // que únicamente les falta el TIPO delante («coral garden» → «residencia
  // coral garden»), que no puede confundir dos frentes hermanos.
  const soloTipo = protegidas.size === 0;
  // 1) Misma clave = el mismo frente, sin discusión.
  const porClave = new Map<string, string[]>();
  for (const n of nombres) {
    const nombre = String(n ?? '').trim();
    if (!nombre) continue;
    const k = claveFrente(nombre);
    if (!k) continue;
    const l = porClave.get(k) ?? [];
    if (!l.includes(nombre)) l.push(nombre);
    porClave.set(k, l);
  }
  // 2) Un nombre corto se muda al largo que lo contiene, si hay UNO solo.
  const claves = Array.from(porClave.keys());
  const destino = new Map<string, string>(claves.map((k) => [k, k]));
  const raiz = (k: string): string => {
    let r = k;
    const visto = new Set<string>();
    while (destino.get(r) !== r && !visto.has(r)) { visto.add(r); r = destino.get(r) as string; }
    return r;
  };
  for (const corta of claves.slice().sort((a, b) => palabras(a).length - palabras(b).length)) {
    if (protegidas.has(corta)) continue; // es un frente de verdad: no se muda
    const candidatas = claves.filter((larga) => larga !== corta
      && esElMismoSitio(corta, larga)
      && (!soloTipo || palabras(larga).length - palabras(corta).length === contarTipoDelante(corta, larga)));
    if (candidatas.length === 1) destino.set(corta, candidatas[0]);
  }
  // 3) Cada grupo con todos sus nombres y el más completo al frente.
  const grupos = new Map<string, GrupoFrente>();
  for (const k of claves) {
    const r = raiz(k);
    const g = grupos.get(r) ?? { canonico: '', clave: r, nombres: [] };
    for (const n of porClave.get(k) ?? []) if (!g.nombres.includes(n)) g.nombres.push(n);
    grupos.set(r, g);
  }
  for (const g of grupos.values()) g.canonico = masCompleto(g.nombres);
  return Array.from(grupos.values());
}

/**
 * El índice listo para usar: `clave(nombre)` devuelve la MISMA cadena para
 * todos los nombres del mismo frente, y `nombre(nombre)` el que se imprime.
 * Lo que no estaba en la lista se responde a sí mismo (nada se pierde).
 */
export type IndiceFrentes = { clave: (nombre: unknown) => string; nombre: (nombre: unknown) => string };

export function indiceFrentes(nombres: Iterable<string>, catalogo?: Iterable<string> | null): IndiceFrentes {
  const aClave = new Map<string, string>();
  const aNombre = new Map<string, string>();
  for (const g of agruparNombresFrente(nombres, catalogo)) {
    for (const n of g.nombres) {
      aClave.set(claveFrente(n), g.clave);
      aNombre.set(claveFrente(n), g.canonico);
    }
  }
  return {
    clave: (n) => { const k = claveFrente(n); return aClave.get(k) ?? k; },
    nombre: (n) => { const k = claveFrente(n); return aNombre.get(k) ?? String(n ?? '').trim(); },
  };
}
