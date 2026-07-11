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
