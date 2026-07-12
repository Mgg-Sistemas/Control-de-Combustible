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
 *  mayúsculas. Los vacíos van al final. Úsalo en todos los `.sort(...)`. */
export const cmpText = (a: any, b: any): number => {
  const na = norm(a), nb = norm(b);
  if (!na && !nb) return 0;
  if (!na) return 1;
  if (!nb) return -1;
  return na < nb ? -1 : na > nb ? 1 : 0;
};

/** Devuelve un comparador alfabético usando `sel(x)` como clave de texto.
 *  Ej.: `arr.sort(byText(e => e.name))`. */
export const byText = <T>(sel: (x: T) => any) => (a: T, b: T): number =>
  cmpText(sel(a), sel(b));
