// Utilidades de texto para los buscadores.

/** Normaliza texto para BUSCAR: pasa a minúsculas y quita las tildes
 *  (á→a, é→e, í→i, ó→o, ú→u, ü→u), pero CONSERVA la ñ. Así "excavacion" y
 *  "excavación" —o "REMOCIÓN" y "remocion"— se consideran la misma palabra. */
export const norm = (s: any): string =>
  String(s ?? '')
    .toLowerCase()
    .replace(/ñ/g, '') // protege la ñ (su tilde no debe eliminarse)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(//g, 'ñ');

/** ¿alguno de los campos `hay` contiene el texto normalizado `q`? */
export const matchNorm = (q: string, ...hay: any[]): boolean =>
  !q || hay.some((v) => norm(v).includes(q));

/** Compara dos textos alfabéticamente (A→Z) SIN distinguir acentos ni
 *  mayúsculas y con NÚMEROS NATURALES (PAYLOADER 2 antes que PAYLOADER 10).
 *  Los vacíos van al final. Úsalo en TODOS los `.sort(...)` del sistema para que
 *  el orden A→Z sea idéntico en toda la app y en los reportes. */
export const cmpText = (a: any, b: any): number => {
  const na = norm(a), nb = norm(b);
  if (!na && !nb) return 0;
  if (!na) return 1;
  if (!nb) return -1;
  return na.localeCompare(nb, 'es', { numeric: true, sensitivity: 'base' });
};

/** Devuelve un comparador alfabético usando `sel(x)` como clave de texto.
 *  Ej.: `arr.sort(byText(e => e.name))`. */
export const byText = <T>(sel: (x: T) => any) => (a: T, b: T): number =>
  cmpText(sel(a), sel(b));

// ============================================================================
// CORRECTOR ORTOGRÁFICO interno (es-VE) para el texto que escribe el usuario en
// campos libres (referencia, sector, parroquia, encargado…). Solo corrige lo
// que está en el diccionario/las frases; lo demás se deja EXACTAMENTE igual.
// ============================================================================

/** Frases mal escritas → corregidas. Se aplican ANTES que el diccionario de
 *  palabras (capturan errores de varias palabras / contexto). */
const TYPO_PHRASES: [RegExp, string][] = [
  // "EL SU PATIO" → "EN SU PATIO"
  [/\bel\s+su\b/gi, 'EN SU'],
  // "SENTRO DE ACOPIIPIO" / "SENTRO SE ACOPIO" / "CENTRO DE ACOPIO" → "CENTRO DE ACOPIO"
  [/\b[sc]entro\s+(?:de|del|se)\s+acopi\w*/gi, 'CENTRO DE ACOPIO'],
];

/** Palabras mal escritas → correcta (MAYÚSCULA). Clave = palabra normalizada
 *  (minúscula, sin tildes). Solo se corrige la palabra EXACTA. */
const TYPO_WORDS: Record<string, string> = {
  sentro: 'CENTRO', sentros: 'CENTROS',
  acopiipio: 'ACOPIO', acopipio: 'ACOPIO', acopio: 'ACOPIO',
  edeficio: 'EDIFICIO', edeficios: 'EDIFICIOS', hedificio: 'EDIFICIO', edificiio: 'EDIFICIO',
  frnte: 'FRENTE', frentte: 'FRENTE', frene: 'FRENTE',
  galpon: 'GALPÓN', galpones: 'GALPONES',
  deposito: 'DEPÓSITO', depocito: 'DEPÓSITO',
  avenida: 'AVENIDA', avnida: 'AVENIDA',
};

/** Corrige la ortografía común del texto libre que escribe el usuario. Aplica
 *  frases y luego palabra por palabra según el diccionario; lo no listado se
 *  conserva igual. Colapsa espacios dobles. Pensado para engancharse al GUARDAR
 *  (no altera serial/placa/código, eso lo decide quien lo llama). */
export const corregirTexto = (input: any): string => {
  let s = String(input ?? '');
  if (!s.trim()) return s;
  for (const [re, rep] of TYPO_PHRASES) s = s.replace(re, rep);
  s = s.replace(/[A-Za-zÁÉÍÓÚÜáéíóúüÑñ]+/g, (w) => {
    const fix = TYPO_WORDS[norm(w)];
    return fix ?? w;
  });
  return s.replace(/[ \t]{2,}/g, ' ').trim();
};

/** Deja SOLO dígitos (para cédulas, teléfonos, fichas…). Quita letras y signos. */
export const onlyDigits = (s: any): string => String(s ?? '').replace(/[^0-9]/g, '');

/** Deja SOLO un número decimal válido (para dinero, horas, litros…): dígitos y
 *  un único separador decimal. Acepta coma o punto (se conserva el que escriba
 *  el usuario) y descarta letras y cualquier otro carácter. */
export const onlyDecimal = (s: any): string => {
  let t = String(s ?? '').replace(/[^0-9.,]/g, ''); // solo dígitos y separadores
  const sep = t.indexOf('.') >= 0 && (t.indexOf(',') < 0 || t.indexOf('.') < t.indexOf(',')) ? '.' : ',';
  // Conserva el primer separador; elimina los demás (incluye el otro tipo).
  let seen = false;
  t = t.replace(/[.,]/g, (c) => {
    if (c === sep && !seen) { seen = true; return sep; }
    return '';
  });
  return t;
};
