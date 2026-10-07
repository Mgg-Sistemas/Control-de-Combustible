// PESO DE ROMANA EN VIAJES DE CAMIONES (26-sep-2026).
//
// Pedido de la encargada del módulo: los listeros meten el PESO BRUTO en la
// romana del CDT, el sistema resta la TARA de esa placa y arroja el PESO NETO
// (el peso a pagar), con FOTO obligatoria de la romana como evidencia. En el
// ticket sale como en el papel de muestra que mandó:
//
//   Peso entrada (bruto): 32.540,00 Kg
//   Peso salida (tara):   11.340,00 Kg
//   Peso a pagar (neto):  21.200,00 Kg
//
// ⭐ ESTE ARCHIVO NO TOCA LA BASE NI LA PANTALLA (como `tique.ts`): es la
//    matemática y los textos del peso, probados solos en
//    `scripts/test-viajes-peso.mjs`.
//
// ⚠️ LA REGLA QUE LO ORDENA TODO: **el neto lo calcula la BASE** (columna
//    generada `peso_neto_kg = bruto − tara`). Lo que hay acá es el MISMO
//    cálculo para mostrarlo en vivo mientras el listero teclea; el número que
//    vale es el del servidor. Y la TARA SE CONGELA en el viaje al registrarlo:
//    re-pesar la tara de una placa mañana no puede cambiar un ticket ya
//    firmado en el CDT (misma regla que la placa y la empresa).

import { leerNumero } from './numeros';

/** El listero teclea principalmente en kilos, pero la romana de alguna
 *  contrata puede cantar toneladas: se ofrece el interruptor «por si acaso»
 *  (pedido explícito). TODO se guarda en KILOS, siempre. */
export type UnidadPeso = 'kg' | 't';

export const UNIDADES_PESO: { k: UnidadPeso; label: string }[] = [
  { k: 'kg', label: 'Kg' },
  { k: 't', label: 'Toneladas' },
];

/**
 * Lee lo que tecleó el listero (punto o coma, da igual — misma regla única de
 * `leerNumero` que ya usa Compras) y lo pasa a KILOS según la unidad elegida.
 * Lo ilegible vale 0, que abajo se trata como «falta el peso».
 */
export function pesoTecleadoAKg(texto: unknown, unidad: UnidadPeso): number {
  const n = leerNumero(texto);
  if (!isFinite(n) || n <= 0) return 0;
  return unidad === 't' ? n * 1000 : n;
}

/**
 * EL FORMATO DEL PAPEL: miles con punto, decimales con coma, dos decimales,
 * «Kg» al final — calcado del ticket de muestra («32.540,00 Kg»).
 * Sin `Intl` a propósito: el formato del papel no puede depender del idioma
 * del teléfono que imprime.
 *
 * ⭐ LOS REPORTES VAN CON UN DECIMAL (07-oct-2026, pedido: «en los reportes
 *    de viajes redondea la cifra» → «que sea un solo decimal» → «déjale un
 *    solo decimal como el ejemplo»). El cliente mandó el papel de otro sistema
 *    como patrón: UNA cifra decimal en todo el reporte, sin importar la
 *    unidad. Se probó con cero el mismo día y lo devolvió.
 *
 * ⚠️ UN DECIMAL EN TODAS LAS UNIDADES ES LO QUE SE PIDIÓ. El argumento de que
 *    la romana canta kilos enteros es cierto y aun así no manda: lo que se
 *    busca es que TODA la columna del papel se lea igual, y una tabla con
 *    «32.540 Kg» arriba y «22,6 Ton» abajo no se lee igual.
 *
 *    Por eso `decimales` es un PARÁMETRO con el 2 por defecto — el TIQUE, que
 *    se firma en el CDT, no se toca. Mismo criterio que el de `tonTexto`.
 */
export function kgTexto(valorKg: number, decimales: 0 | 1 | 2 = 2): string {
  const n = Number(valorKg);
  if (!isFinite(n)) return decimales ? `0,${'0'.repeat(decimales)} Kg` : '0 Kg';
  const negativo = n < 0;
  const [entero, dec] = Math.abs(n).toFixed(decimales).split('.');
  const miles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  // ⚠️ Con 0 decimales `toFixed` no deja parte decimal y `dec` es undefined:
  //    sin esta guarda el papel imprimía «11.340,undefined Kg».
  return `${negativo ? '-' : ''}${miles}${dec ? `,${dec}` : ''} Kg`;
}

/** El mismo texto pero para un dato que puede no existir (viajes viejos,
 *  anteriores al peso): null se queda null y el ticket pinta su raya. */
export function kgTextoOpcional(valorKg: number | null | undefined, decimales: 0 | 1 | 2 = 2): string | null {
  const n = Number(valorKg);
  return valorKg == null || !isFinite(n) ? null : kgTexto(n, decimales);
}

/**
 * EL MISMO PESO PERO EN TONELADAS, para el papel (27-sep-2026, a pedido: el
 * admin elige en qué unidad salen los pesos del ticket).
 *
 * ⚠️ EL TICKET VA CON TRES DECIMALES y ese es el valor por defecto: una romana
 *    marca de a 5–10 kg, y con dos decimales «32.545 kg» se imprimiría
 *    «32,55 Ton» — un redondeo en un papel que se FIRMA en el CDT.
 *
 * ⭐ EL REPORTE VA CON DOS (28-sep-2026, pedido: «ese reporte con toneladas,
 *    que sean 2 decimales y no 3»). Es un papel de control, se lee de un
 *    vistazo y no lo firma nadie: ahí el tercer decimal solo estorba. Por eso
 *    es un PARÁMETRO y no un cambio global — el ticket no se toca.
 *
 * ⭐ Y DESDE EL 07-oct-2026 VA REDONDEADO (pedido: «en los reportes de viajes
 *    redondea la cifra»): los papeles de viajes piden UN decimal.
 *
 * ⚠️ UN DECIMAL, NO CERO. Se probó con cero el mismo día y el cliente lo
 *    devolvió en el acto («que sea un solo decimal»): una tonelada son MIL
 *    KILOS, así que «38,30 → 38» borra 300 kg de la vista en una columna que
 *    se usa para cobrar. En KILOS sí se dejó entero, porque ahí el decimal es
 *    relleno: la romana canta kilos enteros.
 *
 *    Se mantiene el mismo criterio de siempre — parámetro, no cambio global,
 *    porque el tiquete sigue con 3.
 *
 * El dato guardado sigue siendo kilos, siempre.
 */
export function tonTexto(valorKg: number, decimales: 0 | 1 | 2 | 3 = 3): string {
  const n = Number(valorKg);
  const cero = decimales ? `0,${'0'.repeat(decimales)} Ton` : '0 Ton';
  if (!isFinite(n)) return cero;
  const negativo = n < 0;
  const [entero, dec] = (Math.abs(n) / 1000).toFixed(decimales).split('.');
  const miles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  // ⚠️ Igual que en `kgTexto`: con 0 decimales no hay parte decimal que pegar.
  return `${negativo ? '-' : ''}${miles}${dec ? `,${dec}` : ''} Ton`;
}

export function tonTextoOpcional(valorKg: number | null | undefined, decimales: 0 | 1 | 2 | 3 = 3): string | null {
  const n = Number(valorKg);
  return valorKg == null || !isFinite(n) ? null : tonTexto(n, decimales);
}

/** El neto EN VIVO para la pantalla. `null` = todavía no se puede calcular. */
export function netoDe(brutoKg: number | null | undefined, taraKg: number | null | undefined): number | null {
  const b = Number(brutoKg), t = Number(taraKg);
  if (!brutoKg || !taraKg || !isFinite(b) || !isFinite(t) || b <= 0 || t <= 0) return null;
  return b - t;
}

/**
 * ¿SE PUEDE REGISTRAR ESTE PESO? Devuelve el motivo en el idioma del listero,
 * o null si está todo bien. La base tiene el mismo candado
 * (`cv_peso_coherente`), pero el listero merece el aviso ANTES de tocar el
 * botón, no un error de constraint.
 *
 * ⚠️ El peso y la foto son OBLIGATORIOS (pedido del 26-sep-2026): un viaje sin
 *    peso ya no se registra. Los viajes VIEJOS quedan sin peso y eso está bien
 *    — rellenarlos hacia atrás sería inventar cuánto pesaron.
 */
export function motivoPesoInvalido(p: {
  brutoKg: number;
  taraKg: number;
  fotoLista: boolean;
}): string | null {
  if (!p.brutoKg || p.brutoKg <= 0) return 'Falta el peso bruto de la romana.';
  if (!p.taraKg || p.taraKg <= 0) return 'Este camión no tiene tara cargada: teclea la tara para poder registrar.';
  if (p.brutoKg <= p.taraKg) {
    return `El bruto (${kgTexto(p.brutoKg)}) no supera la tara (${kgTexto(p.taraKg)}): el neto saldría en cero o negativo. Revisa el número.`;
  }
  if (!p.fotoLista) return 'Falta la foto de la romana (es obligatoria: es la evidencia del peso bruto).';
  return null;
}

/** Un bruto 100 veces la tara casi seguro es la coma corrida («32540» tecleado
 *  como toneladas, o un cero de más). No bloquea: avisa, que el listero está
 *  mirando la romana y nosotros no. */
export function avisoPesoSospechoso(brutoKg: number, taraKg: number): string | null {
  if (!brutoKg || !taraKg || brutoKg <= taraKg) return null;
  if (brutoKg > taraKg * 20) {
    return `⚠️ Ese bruto es ${Math.round(brutoKg / taraKg)} veces la tara. Revisa que no sea un cero de más o la unidad equivocada.`;
  }
  return null;
}

/** Los tres renglones del ticket, ya como texto, en la unidad que el admin
 *  eligió para el papel (Kg de fábrica: sin tocar nada, sale igual que
 *  siempre). Un viaje sin peso devuelve nulls y el papel pinta rayas. */
export function pesosParaTique(v: {
  pesoBrutoKg: number | null;
  pesoTaraKg: number | null;
  pesoNetoKg: number | null;
}, unidad: UnidadPeso = 'kg'): { pesoBruto: string | null; pesoTara: string | null; pesoNeto: string | null } {
  // El neto impreso sale del guardado (lo calculó la base); si un viaje viejo
  // trajera bruto y tara sin neto, se calcula igual que la base para no
  // imprimir una raya teniendo los dos números.
  const neto = v.pesoNetoKg ?? netoDe(v.pesoBrutoKg, v.pesoTaraKg);
  const texto = unidad === 't' ? tonTextoOpcional : kgTextoOpcional;
  return {
    pesoBruto: texto(v.pesoBrutoKg),
    pesoTara: texto(v.pesoTaraKg),
    pesoNeto: texto(neto),
  };
}
