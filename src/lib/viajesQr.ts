// ESCANEAR EL QR DEL CAMIÓN para registrar un viaje (13-sep-2026).
//
// Pedido del cliente: «además de que sea por escrito, que puedan escanear el QR
// también, sin que dañe ni rompa nada; el QR lo que permite es seleccionar el
// vehículo más rápido». O sea: el listero escribe la placa o escanea, y las dos
// cosas terminan en el MISMO sitio, con el camión elegido.
//
// ⭐ ESTE ARCHIVO NO TOCA LA CÁMARA, NI LA BASE, NI LA PANTALLA. Recibe el texto
//    que leyó el lector y el catálogo que la pantalla ya tiene cargado, y dice
//    cuál camión es o por qué no. Así se prueba entero sin teléfono.
//
// ⚠️ EL QR NO ES UNA VÍA APARTE DE SELECCIÓN: es un atajo al mismo toque. Lo que
//    pase después —chofer del turno, estado, registrar, cola sin señal— es lo
//    mismo que si el listero hubiera tocado el camión en la lista. Si el QR
//    tuviera su propio camino, cada arreglo del buscador habría que hacerlo dos
//    veces, y el segundo se olvidaría.

/** Lo mínimo que hace falta de la ficha del catálogo para resolver un QR. */
export type FichaParaQr = {
  id: string;
  serial?: string | null;
  /** `false` = retirada del catálogo. Es el mismo criterio del buscador. */
  operational?: boolean | null;
};

export type MotivoQr = 'no_es_maquina' | 'no_en_catalogo' | 'retirada' | 'vencido';

export type ResultadoQr<T extends FichaParaQr> =
  | { ok: true; ficha: T; fueraDeLista: boolean }
  | { ok: false; motivo: MotivoQr };

/** Lo que se le dice al listero en cada caso. Corto: lo lee parado en el patio. */
export const MENSAJE_QR: Record<MotivoQr, string> = {
  no_es_maquina: 'Ese QR no es el de una máquina del sistema. Escanea el QR pegado en el camión.',
  no_en_catalogo: 'Ese camión no está en el catálogo, o ya no está activo. Búscalo por escrito o avisa al administrador.',
  retirada: 'Ese camión figura RETIRADO de la obra. Si de verdad hizo el viaje, avísale a la jefa para que lo cargue.',
  vencido: 'Ese QR está vencido: el serial impreso ya no es el de ese camión. Pide un QR nuevo y, mientras, búscalo por escrito.',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * EL ID DE LA MÁQUINA que trae el QR. `null` si no es el QR de una máquina.
 *
 * Los QR impresos son una URL a soslaguaira.com con `?maquina=<id>&s=<serial>`.
 * Se acepta también un id suelto, por si alguien escaneó un QR viejo o de
 * prueba. Refleja la regla de `parseMachineId` en `ScanQrScreen.tsx`; vive
 * aparte para que se pueda probar sin cargar una pantalla.
 */
export function idDeQrDeMaquina(texto: unknown): string | null {
  const t = String(texto ?? '').trim();
  if (!t) return null;
  try {
    const u = new URL(t);
    const id = u.searchParams.get('maquina');
    if (id) return id;
  } catch {
    // No era una URL. Se sigue con los otros dos formatos.
  }
  const m = t.match(/maquina=([\w-]+)/i);
  if (m) return m[1];
  if (UUID.test(t)) return t;
  return null;
}

/** El SERIAL con el que se selló el QR. `null` si el QR es viejo y no lo trae. */
export function serialDeQrDeMaquina(texto: unknown): string | null {
  const t = String(texto ?? '').trim();
  if (!t) return null;
  try {
    const u = new URL(t);
    const s = u.searchParams.get('s');
    if (s) return s;
  } catch {
    // No era una URL.
  }
  const m = t.match(/[?&]s=([^&\s]+)/i);
  if (m) {
    try { return decodeURIComponent(m[1]); } catch { return m[1]; }
  }
  return null;
}

const serialLimpio = (v: unknown): string => String(v ?? '').trim().toUpperCase();

/**
 * QUÉ CAMIÓN ES.
 *
 * `catalogo` son TODAS las máquinas activas que la pantalla ya tiene; `enLista`
 * son las que el listero ve en su buscador sin escribir nada (los volteos). Un
 * camión del catálogo que no está en su lista SÍ se selecciona —igual que hoy se
 * selecciona al buscarlo por escrito— y se avisa con `fueraDeLista` para que la
 * pantalla lo sume a la lista, que es lo que hace el buscador.
 *
 * ⚠️ EL SELLO DEL SERIAL SE RESPETA. Cada QR impreso lleva el serial de la máquina
 *    en ese momento, y el diseño del QR dice que si el serial cambia, el papel
 *    viejo queda vencido. Nadie lo comprobaba, y acá importa: un QR viejo pegado
 *    en el camión equivocado registraría viajes al camión que no es, y esos
 *    viajes se cobran. Un QR SIN sello (los primeros que se imprimieron) se
 *    acepta, por compatibilidad. Si la máquina hoy no tiene serial cargado, no
 *    hay contra qué comparar y también se acepta.
 */
export function resolverCamionDeQr<T extends FichaParaQr>(
  texto: unknown,
  catalogo: readonly T[],
  enLista: readonly T[] | ReadonlySet<string>,
): ResultadoQr<T> {
  const id = idDeQrDeMaquina(texto);
  if (!id) return { ok: false, motivo: 'no_es_maquina' };

  const ficha = catalogo.find((t) => t.id === id);
  if (!ficha) return { ok: false, motivo: 'no_en_catalogo' };
  if (ficha.operational === false) return { ok: false, motivo: 'retirada' };

  const sello = serialLimpio(serialDeQrDeMaquina(texto));
  const actual = serialLimpio(ficha.serial);
  if (sello && actual && sello !== actual) return { ok: false, motivo: 'vencido' };

  const ids = enLista instanceof Set
    ? (enLista as ReadonlySet<string>)
    : new Set((enLista as readonly T[]).map((t) => t.id));
  return { ok: true, ficha, fueraDeLista: !ids.has(ficha.id) };
}
