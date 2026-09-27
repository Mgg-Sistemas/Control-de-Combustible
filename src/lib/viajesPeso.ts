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
 */
export function kgTexto(valorKg: number): string {
  const n = Number(valorKg);
  if (!isFinite(n)) return '0,00 Kg';
  const negativo = n < 0;
  const [entero, dec] = Math.abs(n).toFixed(2).split('.');
  const miles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negativo ? '-' : ''}${miles},${dec} Kg`;
}

/** El mismo texto pero para un dato que puede no existir (viajes viejos,
 *  anteriores al peso): null se queda null y el ticket pinta su raya. */
export function kgTextoOpcional(valorKg: number | null | undefined): string | null {
  const n = Number(valorKg);
  return valorKg == null || !isFinite(n) ? null : kgTexto(n);
}

/**
 * EL MISMO PESO PERO EN TONELADAS, para el papel (27-sep-2026, a pedido: el
 * admin elige en qué unidad salen los pesos del ticket). Mismo formato manual
 * es-VE y TRES decimales, no dos: una romana marca de a 5–10 kg y con dos
 * decimales «32.545 kg» se imprimiría «32,55 Ton» — un redondeo en un papel
 * que se firma. El dato guardado sigue siendo kilos, siempre.
 */
export function tonTexto(valorKg: number): string {
  const n = Number(valorKg);
  if (!isFinite(n)) return '0,000 Ton';
  const negativo = n < 0;
  const [entero, dec] = (Math.abs(n) / 1000).toFixed(3).split('.');
  const miles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negativo ? '-' : ''}${miles},${dec} Ton`;
}

export function tonTextoOpcional(valorKg: number | null | undefined): string | null {
  const n = Number(valorKg);
  return valorKg == null || !isFinite(n) ? null : tonTexto(n);
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
