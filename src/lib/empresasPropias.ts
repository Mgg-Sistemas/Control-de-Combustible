// QUIÉN ES "NUESTRO" Y QUIÉN ES SUBCONTRATADA — la regla, en un solo lugar.
//
// Pedido del cliente (01-sep-2026): el reporte de Ubicaciones tácticas pasa a
// ser TRES informes, con el mismo botón:
//
//   1. Solo las nuestras     → Liccione y Golden Touch. Nada más.
//   2. Todas, sin separar    → el de siempre: las subcontratadas salen, pero
//                              metidas dentro del saco de GOLDEN TOUCH.
//   3. Todas, por empresa    → cada empresa con su nombre y su sección.
//
// Regla acordada, textual: «subcontratada es simplemente todo lo que no sea
// Liccione ni Golden Touch». No hay ningún campo en la base de datos que lo
// diga —ni una columna, ni una bandera, ni una tabla— así que la regla vive
// ACÁ y en ningún otro lado. Si mañana entra otra empresa propia, se agrega a
// `EMPRESAS_PROPIAS` y los tres informes se acomodan solos.
//
// ⚠️ SE DECIDE POR EL NOMBRE, y el nombre lo escribió una persona en el
//    catálogo. Si una empresa está cargada como "GOLDENTOUCH" junta, o con un
//    error de tipeo, cae en el saco equivocado y nadie se entera leyendo la
//    pantalla. Por eso el PDF imprime al pie QUÉ EMPRESAS ENTRARON y CUÁLES
//    QUEDARON FUERA: el error se ve en el papel, no en una reunión.
//
// Vive aparte de la pantalla para poder probarla de verdad (no a punta de
// buscar texto en el código). Ver `scripts/test-reporte-tactico-tres-informes.mjs`.
import { cmpText } from './text';

/** Cuál de los tres informes. */
export type AlcanceEmpresas = 'propias' | 'juntas' | 'porEmpresa';

/**
 * Las empresas PROPIAS, para mostrar. La comparación real la hace
 * `esEmpresaPropia` con `RE_PROPIA`, que aguanta variantes de escritura
 * ("LICCIONE C.A.", "Golden Touch, C.A.").
 */
export const EMPRESAS_PROPIAS = ['LICCIONE', 'GOLDEN TOUCH'];

/** Lo que se busca dentro del nombre de la empresa. Sin tildes de por medio:
 *  ni "liccion" ni "golden" las llevan. */
const RE_PROPIA = /liccion|golden/i;

/** El cajón de sastre de las máquinas sin empresa cargada. NO es una empresa. */
export const SIN_EMPRESA = 'Sin empresa';

/** ¿Esta empresa es de las nuestras? Todo lo demás es subcontratada. */
export function esEmpresaPropia(nombre?: string | null): boolean {
  const n = String(nombre ?? '').trim();
  if (!n) return false; // sin empresa cargada NO cuenta como propia
  return RE_PROPIA.test(n);
}

/** El nombre de la empresa de una fila, con el cajón de sastre por defecto. */
export function nombreEmpresa(m: any): string {
  return (m?.company?.name && String(m.company.name).trim()) || SIN_EMPRESA;
}

/**
 * ¿En qué sección del reporte cae esta máquina?
 *
 * En `porEmpresa`, su empresa de verdad. En los otros dos, los DOS sacos de
 * siempre — y en `propias` el saco de Golden Touch trae solo Golden Touch,
 * porque las demás ya no están en la lista.
 */
export function grupoDeEmpresa(nombre: string, alcance: AlcanceEmpresas): string {
  if (alcance === 'porEmpresa') return nombre;
  return /liccion/i.test(nombre) ? 'LICCIONE' : 'GOLDEN TOUCH';
}

/**
 * El orden de las secciones: las nuestras primero (Liccione, después Golden
 * Touch), luego las subcontratadas de la A a la Z, y "Sin empresa" al final de
 * todo — es un cajón de sastre y no merece salir antes que una empresa real.
 */
export function ordenGrupoEmpresa(g: string): number {
  if (/liccion/i.test(g)) return 0;
  if (/golden/i.test(g)) return 1;
  if (/^sin empresa$/i.test(g)) return 3;
  return 2;
}

/** Ordena los nombres de las secciones con esa regla. */
export function ordenarGrupos(nombres: string[]): string[] {
  return [...nombres].sort((a, b) => ordenGrupoEmpresa(a) - ordenGrupoEmpresa(b) || cmpText(a, b));
}

/**
 * Reparte las máquinas según el informe pedido.
 *
 * ⭐ El filtro se aplica UNA sola vez y todo el reporte sale de `list`: el
 *    resumen por empresa, el de tipo por zona, el conteo por clasificación, el
 *    de "a cargo de", las pick-up y el listado. Así los totales de arriba
 *    SIEMPRE cuadran con la lista de abajo. Si se filtrara solo el listado, el
 *    papel diría "296 equipos" arriba y listaría 180 — que es exactamente como
 *    se pierde la confianza en un reporte.
 */
export function repartirPorAlcance<T>(
  universo: T[],
  alcance: AlcanceEmpresas,
  nombreDe: (m: T) => string = nombreEmpresa as any,
): { list: T[]; empresasDentro: string[]; empresasFuera: string[] } {
  const soloPropias = alcance === 'propias';
  const list = soloPropias ? universo.filter((m) => esEmpresaPropia(nombreDe(m))) : universo;
  const todas = [...new Set(universo.map(nombreDe))];
  return {
    list,
    empresasDentro: ordenarGrupos(todas.filter((c) => !soloPropias || esEmpresaPropia(c))),
    empresasFuera: ordenarGrupos(todas.filter((c) => soloPropias && !esEmpresaPropia(c))),
  };
}

/**
 * Los tres informes, con su etiqueta para el chip, su nombre largo para el
 * subtítulo del PDF y su pedacito para el NOMBRE DEL ARCHIVO.
 *
 * ⚠️ Los tres `archivo` tienen que ser DISTINTOS entre sí: son tres papeles muy
 *    parecidos, y si dos se llaman igual el segundo pisa al primero en la
 *    carpeta de descargas sin decir nada.
 */
export const ALCANCES: { id: AlcanceEmpresas; chip: string; largo: string; archivo: string }[] = [
  { id: 'propias', chip: '🏢 Solo las nuestras', largo: 'Solo LICCIONE y GOLDEN TOUCH', archivo: 'solo Liccione y Golden Touch' },
  { id: 'juntas', chip: '🤝 Todas, sin separar', largo: 'Todas las empresas, sin separar las subcontratadas', archivo: 'todas sin separar' },
  { id: 'porEmpresa', chip: '🏗️ Todas, por empresa', largo: 'Todas las empresas, cada una por separado', archivo: 'por empresa' },
];

/** El informe pedido; si llega uno desconocido, el de siempre. */
export function alcanceInfoDe(alcance: AlcanceEmpresas) {
  return ALCANCES.find((a) => a.id === alcance) ?? ALCANCES[1];
}
