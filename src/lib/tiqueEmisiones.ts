// CONSTANCIA DE LOS TIQUES ENTREGADOS (12-sep-2026).
//
// Pedido del cliente: «cuando marcan el viaje, deben dar el ticket, y debe
// guardarse tanto lo que marcaron (que ya lo hace), como los ticket que en
// teoría imprimieron o dieron».
//
// ⭐ LO QUE SE GUARDA ES LA ENTREGA, NO EL VIAJE. El viaje ya vive en
//    `camion_viajes`. Acá queda UNA FILA POR PAPEL QUE SALIÓ: cuál, cuándo,
//    quién le dio a imprimir, desde qué CDT, y si fue la primera vez o una
//    reimpresión. Dos filas con el mismo folio significan dos papeles con el
//    mismo número dando vueltas, y eso hay que poder verlo.
//
// ⚠️ `tique_emisiones` ES UN LIBRO, NO UNA TABLA DE TRABAJO. Sus políticas solo
//    permiten INSERTAR y LEER: no hay UPDATE ni DELETE ni desde acá ni desde
//    ningún lado. Una constancia que se puede editar después no es constancia.
//    Por lo mismo NO lleva trigger de auditoría: duplicar un libro en otro libro
//    solo engorda `audit_log`, que ya viene creciendo.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { isOnline, isNetworkErrorMsg } from './offlineQueue';

const TABLA = 'tique_emisiones';
const PENDIENTES_KEY = 'tique_emisiones_pendientes_v1';

/** Cómo salió el papel. `imagen` está previsto en la base pero todavía no se usa
 *  desde la app: se reserva para cuando se pueda mandar el tique por WhatsApp. */
export type MedioTique = 'tiquetera' | 'hoja' | 'imagen';

export type EmisionNueva = {
  /** null solo si el viaje se borró entre imprimir y guardar. La constancia
   *  sobrevive igual: la FK es ON DELETE SET NULL a propósito, porque el papel
   *  ya está en la calle aunque el viaje se haya anulado. */
  viajeId: string | null;
  folio: string;
  /** Todos los tiques de un mismo mandado comparten este número. Un tique suelto
   *  también lleva el suyo: un mandado de uno sigue siendo un mandado. */
  loteId: string;
  medio: MedioTique;
  ubicacionId: string | null;
  ubicacionNombre: string | null;
  emitidoPor: string | null;
  emitidoPorNombre: string;
  /** Clave de idempotencia. Si el mismo papel se reintenta al volver la señal, la
   *  base lo rechaza por `uq_tique_emisiones_client_action` y no se duplica. */
  clientActionId: string;
};

/** ¿El error es «esa tabla no existe»? Mismo criterio que el resto del módulo. */
function faltaLaTabla(e: any): boolean {
  const msg = String(e?.message ?? e).toLowerCase();
  const code = String(e?.code ?? '').toLowerCase();
  return code === '42p01' || code === 'pgrst205' || msg.includes('does not exist') || msg.includes('schema cache');
}

/** ¿Ya estaba guardada? Clave duplicada = el reintento llegó dos veces. No es un
 *  fallo: es exactamente lo que la clave de idempotencia tenía que provocar. */
function yaEstaba(e: any): boolean {
  return String(e?.code ?? '') === '23505';
}

/**
 * UN UUID.
 *
 * `lote_id` es una columna `uuid`, así que no vale cualquier texto. Se usa
 * `crypto.randomUUID` donde exista y una versión 4 a mano donde no — en
 * Android/iOS el navegador embebido no siempre la trae, y en un teléfono viejo
 * tampoco. Para agrupar un mandado de tiques, `Math.random` alcanza de sobra:
 * no es una clave de seguridad, es un número de fajo.
 */
export function nuevoUuid(): string {
  const g: any = globalThis as any;
  try {
    if (g?.crypto?.randomUUID) return String(g.crypto.randomUUID());
  } catch {
    // Sigue por el camino de abajo.
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function aFila(e: EmisionNueva) {
  return {
    viaje_id: e.viajeId,
    folio: e.folio,
    lote_id: e.loteId,
    medio: e.medio,
    ubicacion_id: e.ubicacionId,
    ubicacion_nombre: e.ubicacionNombre,
    emitido_por: e.emitidoPor,
    emitido_por_nombre: e.emitidoPorNombre,
    client_action_id: e.clientActionId,
    // `reimpresion` NO se manda: lo decide el trigger `marcar_reimpresion_tique`
    // mirando si ya hay una fila con ese folio. Calcularlo acá haría que dos
    // dispositivos imprimiendo a la vez se declararan los dos «primera vez».
  };
}

// ── LO QUE NO PUDO SUBIR ────────────────────────────────────────────────────
//
// ⚠️ EL PAPEL YA SALIÓ. Cuando la impresión funciona pero el guardado no, la
//    constancia no se puede perder: el camionero ya tiene su tique en la mano.
//    Se aparta en el teléfono y se sube sola cuando vuelva la señal. Es una
//    lista chiquita a propósito —son los tiques de un rato sin señal— así que
//    no lleva ni cuarentena ni reintentos contados como la cola de viajes.

async function leerPendientes(): Promise<EmisionNueva[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDIENTES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as EmisionNueva[]) : [];
  } catch {
    return [];
  }
}

async function escribirPendientes(lista: EmisionNueva[]): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDIENTES_KEY, JSON.stringify(lista));
  } catch {
    // Si ni el teléfono puede guardar, no hay nada más que hacer acá. Quien
    // llama ya le dijo al usuario que la constancia no se guardó.
  }
}

/** Cuántas constancias están esperando señal. La pantalla lo muestra: un número
 *  distinto de cero significa que hay papeles entregados que la oficina no ve. */
export async function contarEmisionesPendientes(): Promise<number> {
  return (await leerPendientes()).length;
}

/**
 * Sube lo que quedó pendiente, de a una.
 *
 * De a una y no en bloque porque acá SÍ puede haber repetidos: si el intento
 * anterior llegó al servidor y se perdió la respuesta, la fila ya está. En
 * bloque, ese único repetido tumbaría el insert de todos los demás. Una clave
 * duplicada se cuenta como subida, que es lo que es.
 */
export async function flushEmisionesPendientes(): Promise<{ subidas: number; quedan: number }> {
  const lista = await leerPendientes();
  if (lista.length === 0) return { subidas: 0, quedan: 0 };
  if (!isOnline()) return { subidas: 0, quedan: lista.length };

  const restantes: EmisionNueva[] = [];
  let subidas = 0;
  for (const e of lista) {
    const { error } = await supabase.from(TABLA).insert(aFila(e));
    if (!error || yaEstaba(error)) { subidas++; continue; }
    // Sin tabla no se reintenta en bucle: se deja quieto hasta que exista.
    restantes.push(e);
  }
  await escribirPendientes(restantes);
  return { subidas, quedan: restantes.length };
}

/**
 * GUARDA LA CONSTANCIA DE LOS TIQUES QUE ACABAN DE SALIR.
 *
 * Se llama DESPUÉS de que el usuario confirmó la impresión, nunca antes: un
 * tique que se canceló en la vista previa no se entregó, y anotarlo como
 * entregado sería mentir en el único registro que hay.
 */
export async function registrarEmisiones(
  lista: EmisionNueva[],
): Promise<{ guardadas: number; pendientes: number; sinTabla: boolean; error?: string }> {
  if (lista.length === 0) return { guardadas: 0, pendientes: 0, sinTabla: false };

  const apartar = async (): Promise<number> => {
    const previas = await leerPendientes();
    await escribirPendientes([...previas, ...lista]);
    return lista.length;
  };

  if (!isOnline()) {
    return { guardadas: 0, pendientes: await apartar(), sinTabla: false };
  }

  const { error } = await supabase.from(TABLA).insert(lista.map(aFila));
  if (!error) return { guardadas: lista.length, pendientes: 0, sinTabla: false };

  // Falta el SQL: no se aparta nada. Reintentar contra una tabla que no existe
  // llena el teléfono de basura que nunca va a subir, y el aviso correcto es
  // «avisa al administrador», no «esperá señal».
  if (faltaLaTabla(error)) {
    return { guardadas: 0, pendientes: 0, sinTabla: true, error: error.message };
  }

  // Se cayó la señal en el medio, o el servidor no respondió: se aparta y se
  // sube solo. Cualquier otro error también se aparta —el papel ya salió— y se
  // avisa igual, para que no quede solo en la lista silenciosa del teléfono.
  const pendientes = await apartar();
  return {
    guardadas: 0,
    pendientes,
    sinTabla: false,
    error: isNetworkErrorMsg(error.message) ? undefined : error.message,
  };
}

/**
 * CUÁNTAS VECES SE IMPRIMIÓ CADA TIQUE.
 *
 * ⭐ Es lo que permite avisar ANTES de mandar: «este tique ya se entregó, lo que
 *    va a salir es una reimpresión». Sin esto, alguien reimprime sin querer y
 *    quedan dos papeles con el mismo número en el patio; el que cobra ve dos.
 *
 * ⚠️ Se consulta por lote de folios y no de a uno. Una lista de un mes son
 *    cientos de viajes, y cientos de consultas sueltas tumban la pantalla en un
 *    teléfono con señal de patio.
 */
export async function contarEmisionesPorFolio(
  folios: string[],
): Promise<{ porFolio: Map<string, number>; sinTabla: boolean; error?: string }> {
  const porFolio = new Map<string, number>();
  const limpios = Array.from(new Set(folios.map((f) => String(f ?? '').trim()).filter(Boolean)));
  if (limpios.length === 0) return { porFolio, sinTabla: false };

  // De a 300 folios por consulta: un `in.(...)` con mil valores se pasa del
  // largo de URL que aguanta PostgREST y vuelve como un error que no dice eso.
  const TROZO = 300;
  try {
    for (let i = 0; i < limpios.length; i += TROZO) {
      const trozo = limpios.slice(i, i + TROZO);
      const { data, error } = await supabase.from(TABLA).select('folio').in('folio', trozo);
      if (error) throw error;
      (data ?? []).forEach((r: any) => {
        const f = String(r?.folio ?? '').trim();
        if (f) porFolio.set(f, (porFolio.get(f) ?? 0) + 1);
      });
    }
    return { porFolio, sinTabla: false };
  } catch (e: any) {
    if (faltaLaTabla(e)) return { porFolio, sinTabla: true };
    return { porFolio, sinTabla: false, error: String(e?.message ?? e) };
  }
}
