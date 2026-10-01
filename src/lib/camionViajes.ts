import { supabase, selectAllRows } from './supabase';
import { esRolListero } from './rolListero';
import { jornadaDeFecha } from './caracasDay';
import {
  CAMPOS_VIAJE_ROW, completarFrentes, mapaAsignaciones, rangoJornadas, type AsignacionDia,
} from './frentesAuto';

/**
 * VIAJES DE CAMIONES: bitácora de viajes (regreso/entrada = un viaje) registrada
 * por listeros en campo, sobre camiones de volteo (filas de `machinery`). Ver
 * `supabase/viajes_camiones.sql`.
 *
 * El chofer/responsable NO se duplica a mano en cada viaje: se resuelve desde
 * `machine_operators` (la asignación planeada por turno que ya administra el
 * Coordinador de Operadores, ver `src/lib/machineOperators.ts`) y se copia como
 * snapshot (`chofer_name`) al momento del viaje — si luego cambia el chofer
 * asignado, los viajes ya registrados conservan el nombre de quién iba en ese
 * momento.
 *
 * RLS de `camion_viajes`/`camion_viajes_config` está abierta a 'authenticated'
 * (using(true)): el control de quién puede registrar/editar/borrar se hace en
 * la UI/módulo (mismo criterio que `machine_operators`/`coordinator_*_scope`),
 * no aquí. Las funciones que dicen "se valida en la pantalla" NO repiten ese
 * chequeo — confían en que quien las llama ya lo hizo.
 */

/**
 * ¿El error es «todavía no se corrió el .sql», o es un error de verdad?
 *
 * ⚠️ La versión anterior hacía match con **el nombre de la tabla**
 * (`/camion_viajes|relation|.../`), y como CASI TODO error de PostgREST sobre
 * esta tabla lleva su nombre en el mensaje, clasificaba como «falta la tabla»
 * una violación de clave foránea, del CHECK `cv_fuera_catalogo_coherente` o de
 * RLS. Al listero le salía «Falta configurar la tabla en la base de datos.
 * Avisa al administrador» cuando el problema era otro y él podía resolverlo.
 *
 * Ahora se clasifica por CÓDIGO, que es un dato, no una adivinanza sobre texto.
 */
function isMissingTable(msg: string, code?: string): boolean {
  // 42P01 tabla inexistente · 42703 columna inexistente · PGRST205 fuera del schema cache
  if (code === '42P01' || code === '42703' || code === 'PGRST205') return true;
  return /does not exist|schema cache|could not find the (table|column)/i.test(String(msg || ''));
}

export type CamionViajeRow = {
  id: string;
  /** null SOLO cuando `fueraCatalogo` es true: ese camión no existe en `machinery`. */
  machineryId: string | null;
  machineCode: string;
  /** El listero anotó un camión que NO está en el catálogo. Vive solo en esta fila:
   *  no se crea nada en `machinery` ni en ningún otro módulo. Ver
   *  `supabase/viajes_camion_fuera_catalogo.sql`. */
  fueraCatalogo: boolean;
  /** Referencia libre del camión de fuera (placa, empresa, seña). Nota de campo. */
  camionRef: string | null;
  listeroId: string;
  listeroName: string;
  choferName: string | null;
  shift: 'day' | 'night' | null;
  estadoMaquina: string | null;
  note: string | null;
  registeredAt: string; // ISO
  /** Clave de idempotencia del registro. Sirve para saber si una fila que está
   *  en la cola local YA llegó al servidor, y no pintarla dos veces. */
  clientActionId: string | null;
  /** OBRA donde se registró el viaje. Ver `ubicacionNombre`. */
  ubicacionId: string | null;
  /** Nombre de la obra, CONGELADO al registrar (foto, como `listeroName`).
   *  Si mañana se borra la obra del catálogo, `ubicacionId` queda en null pero
   *  este texto sigue diciendo dónde fue ese viaje. */
  ubicacionNombre: string | null;
  /**
   * NÚMERO DEL TICKET (`CDT-000001`). Lo pone la base con un trigger, nunca la
   * app: dos listeros registrando en el mismo segundo se llevarían el mismo
   * número si lo calculara el teléfono.
   *
   * ⚠️ `null` en los 3.384 viajes ANTERIORES a la ticketera (19-ago al 1-sep) y
   *    en cualquiera que todavía esté en la cola offline: el folio existe
   *    cuando la fila llega al servidor, no antes. Un viaje sin folio no tiene
   *    ticket que entregar, y la pantalla tiene que decirlo, no inventarlo.
   */
  folio: string | null;
  /**
   * Placa y empresa CONGELADAS al registrar, igual que `listeroName`.
   *
   * ⭐ POR QUÉ SE CONGELAN. Antes se resolvían del catálogo cada vez que se
   *    pintaba un reporte. Si mañana alguien le corrige la placa a un camión,
   *    un ticket reimpreso saldría con una placa DISTINTA a la del papel que ya
   *    está firmado en el CDT.
   *
   * ⚠️ `null` = resolver del catálogo, que es lo que se hacía siempre. Los
   *    viajes viejos se quedan así a propósito: rellenarlos hacia atrás con la
   *    ficha de HOY sería afirmar que ese camión tenía esa placa aquel día.
   */
  placa: string | null;
  empresa: string | null;
  /**
   * PESO DE ROMANA (26-sep-2026). CONGELADO al registrar, como la placa: el
   * bruto lo tecleó el listero en el CDT, la tara es la copia de la tara del
   * camión EN ESE MOMENTO (re-pesarla mañana no cambia este viaje) y el neto
   * lo calculó LA BASE (columna generada bruto − tara, nunca el teléfono).
   * `null` = viaje anterior al peso; no se rellena hacia atrás.
   */
  pesoBrutoKg: number | null;
  pesoTaraKg: number | null;
  pesoNetoKg: number | null;
  /** La tara NO salió del catálogo: la tecleó una persona (camión sin tara
   *  cargada, o fuera de catálogo). `taraManualNombre` dice quién fue. */
  taraManual: boolean;
  taraManualNombre: string | null;
  /** Foto de la romana con el bruto — la evidencia obligatoria del peso. */
  pesoFotoUrl: string | null;
  /**
   * CÓMO ENTRÓ el viaje (28-sep-2026, leído al fin): 'campo' (tocado en el
   * patio), 'cola' (subió sin señal) o 'manual' (cargado a mano por la
   * oficina). Se lee junto a las columnas del peso porque decide si el peso
   * se puede AGREGAR después en ✏️ Editar: a un viaje del patio sin peso no
   * se le inventa (nadie miró la romana), a uno cargado a mano sí — la
   * oficina lo cuadra con el papel de la romana en la mano.
   */
  origen: 'campo' | 'cola' | 'manual' | null;
  /**
   * TIPO DE VIAJE (26-sep-2026): la tarifa con nombre («Oeste → Este», lo que
   * inventen después). CONGELADOS al registrar, nombre Y tarifa: cambiar el
   * precio del tipo mañana no toca este viaje. `null` = viaje normal, se paga
   * con la tarifa de zona de siempre.
   */
  tipoViajeId: string | null;
  tipoViajeNombre: string | null;
  tipoViajeTarifa: number | null;
  /**
   * FRENTE DE TRABAJO (28-sep-2026): de DÓNDE recogió el camión el material
   * que llevó al CDT/CDF. Se asigna por jornada a cada camión (o a un grupo)
   * en ⚙️ Obras y ubicaciones, y se CONGELA en el viaje al registrarlo —
   * reasignar el camión mañana no toca los viajes de hoy. `null` = sin frente
   * (viajes viejos, o camión sin asignación ese día); se puede completar
   * después en ✏️ Editar (full).
   */
  frenteId: string | null;
  frenteNombre: string | null;
};

function mapRow(r: any): CamionViajeRow {
  return {
    id: r.id as string,
    machineryId: (r.machinery_id ?? null) as string | null,
    machineCode: (r.machine_code ?? '—') as string,
    // `?? false` y no `as boolean`: si todavía no se corrió
    // supabase/viajes_camion_fuera_catalogo.sql la columna no existe y llega
    // `undefined`. Todo lo viejo es del catálogo, así que false es lo correcto.
    fueraCatalogo: r.fuera_catalogo === true,
    camionRef: (r.camion_ref ?? null) as string | null,
    listeroId: r.listero_id as string,
    listeroName: (r.listero_name ?? '—') as string,
    choferName: (r.chofer_name ?? null) as string | null,
    shift: (r.shift === 'night' ? 'night' : r.shift === 'day' ? 'day' : null) as 'day' | 'night' | null,
    estadoMaquina: (r.estado_maquina ?? null) as string | null,
    note: (r.note ?? null) as string | null,
    registeredAt: r.registered_at as string,
    clientActionId: (r.client_action_id ?? null) as string | null,
    ubicacionId: (r.ubicacion_id ?? null) as string | null,
    ubicacionNombre: (r.ubicacion_nombre ?? null) as string | null,
    folio: (r.folio ?? null) as string | null,
    placa: (r.placa_snap ?? null) as string | null,
    empresa: (r.empresa_snap ?? null) as string | null,
    // `== null` y no `?? null` pelado: un 0 guardado sería un dato corrupto
    // (el CHECK no lo deja entrar), pero si llegara, Number(0) lo conserva y
    // la pantalla lo enseña en vez de esconderlo.
    pesoBrutoKg: r.peso_bruto_kg == null ? null : Number(r.peso_bruto_kg),
    pesoTaraKg: r.peso_tara_kg == null ? null : Number(r.peso_tara_kg),
    pesoNetoKg: r.peso_neto_kg == null ? null : Number(r.peso_neto_kg),
    taraManual: r.tara_manual === true,
    taraManualNombre: (r.tara_manual_nombre ?? null) as string | null,
    pesoFotoUrl: (r.peso_foto_url ?? null) as string | null,
    origen: (r.origen === 'campo' || r.origen === 'cola' || r.origen === 'manual' ? r.origen : null),
    tipoViajeId: (r.tipo_viaje_id ?? null) as string | null,
    tipoViajeNombre: (r.tipo_viaje_nombre ?? null) as string | null,
    tipoViajeTarifa: r.tipo_viaje_tarifa == null ? null : Number(r.tipo_viaje_tarifa),
    frenteId: (r.frente_id ?? null) as string | null,
    frenteNombre: (r.frente_nombre ?? null) as string | null,
  };
}

const SELECT_COLS = 'id, machinery_id, machine_code, fuera_catalogo, camion_ref, listero_id, listero_name, chofer_name, shift, estado_maquina, note, registered_at, client_action_id';

/**
 * ── EL MÓDULO TIENE QUE SEGUIR FUNCIONANDO ANTES DE QUE SE CORRA EL SQL ─────
 *
 * El código se despliega y el `.sql` de las obras se corre a mano, después. En
 * ese hueco —minutos u horas— las columnas `ubicacion_id` y `ubicacion_nombre`
 * NO existen todavía, y PostgREST no las ignora: devuelve 42703 y REVIENTA LA
 * CONSULTA ENTERA. Sin esto, el listero abriría la pantalla y vería «no hay
 * viajes» con sus viajes intactos en la base, y no podría registrar ninguno.
 *
 * Así que se intenta con las columnas nuevas y, si la base dice que no existen,
 * se reintenta SIN ellas y se recuerda para el resto de la sesión. En cuanto el
 * SQL se corra, la próxima sesión las vuelve a pedir.
 *
 * `null` = todavía no se sabe · `true` = están · `false` = no están.
 */
let hayColumnasDeObra: boolean | null = null;

/**
 * Lo mismo, para las columnas de la TICKETERA (`05_tiquetera_viajes.sql`).
 *
 * Son DOS interruptores y no uno solo a propósito. Las dos migraciones se
 * corrieron el mismo día, pero en ese orden: hubo —y puede volver a haber, si
 * alguien restaura un respaldo de esa mañana— una base CON obras y SIN ticket.
 * Con un interruptor único, esa base perdería también las obras, que sí están.
 */
let hayColumnasDeTique: boolean | null = null;

/** Y el tercero, para las columnas del PESO DE ROMANA (26-sep-2026). Mismo
 *  motivo que los otros dos: el código se despliega antes de que el `.sql`
 *  corra en una base restaurada, y sin el escalón el listero no podría ni
 *  LEER sus viajes. */
let hayColumnasDePeso: boolean | null = null;

/** Y el cuarto, para el TIPO DE VIAJE (26-sep-2026, mismo día que el peso pero
 *  horas después: un respaldo de esta misma tarde tiene peso y no tiene tipo). */
let hayColumnasDeTipo: boolean | null = null;

/** Y el quinto, para el FRENTE DE TRABAJO (28-sep-2026). Mismo motivo que los
 *  otros cuatro: un respaldo de esta mañana tiene tipo y no tiene frente. */
let hayColumnasDeFrente: boolean | null = null;

const COLS_OBRA = 'ubicacion_id, ubicacion_nombre';
const COLS_TIQUE = 'folio, placa_snap, empresa_snap';
// `origen` viaja con el grupo del peso: la columna existe desde el 14-sep y
// toda base que ya tenga peso (26-sep) la tiene — y si el peso falta, el
// origen tampoco hace falta (sin columnas de peso no hay peso que agregar).
const COLS_PESO = 'peso_bruto_kg, peso_tara_kg, peso_neto_kg, tara_manual, tara_manual_nombre, peso_foto_url, origen';
const COLS_TIPO = 'tipo_viaje_id, tipo_viaje_nombre, tipo_viaje_tarifa';
const COLS_FRENTE = 'frente_id, frente_nombre';

/** Las columnas que se piden, según lo que se sepa que existe. */
const colsViaje = () =>
  [SELECT_COLS,
   hayColumnasDeObra === false ? null : COLS_OBRA,
   hayColumnasDeTique === false ? null : COLS_TIQUE,
   hayColumnasDePeso === false ? null : COLS_PESO,
   hayColumnasDeTipo === false ? null : COLS_TIPO,
   hayColumnasDeFrente === false ? null : COLS_FRENTE,
  ].filter(Boolean).join(', ');

/** ¿El error es «esa columna no existe»? Solo eso: una tabla que falta es otra cosa. */
function esColumnaQueFalta(e: any): boolean {
  if (e?.code === '42703') return true;
  return /column .* does not exist|could not find the .*column/i.test(String(e?.message ?? e));
}

/**
 * Lee viajes pidiendo las columnas de obra, y si no están, sin ellas.
 *
 * El interruptor solo se apaga cuando el SEGUNDO intento funciona: si fallara
 * también, el problema no eran las columnas y apagarlo dejaría el módulo sin
 * obras el resto de la sesión por un error que no tenía nada que ver.
 */
async function leerViajes(filtro?: (q: any) => any): Promise<any[]> {
  try {
    const data = await selectAllRows('camion_viajes', colsViaje(), filtro);
    if (hayColumnasDeObra === null) hayColumnasDeObra = true;
    if (hayColumnasDeTique === null) hayColumnasDeTique = true;
    if (hayColumnasDePeso === null) hayColumnasDePeso = true;
    if (hayColumnasDeTipo === null) hayColumnasDeTipo = true;
    if (hayColumnasDeFrente === null) hayColumnasDeFrente = true;
    return data as any[];
  } catch (e: any) {
    if (!esColumnaQueFalta(e)) throw e;

    // ESCALÓN -2: sin el frente de trabajo, que es lo más nuevo de todo.
    if (hayColumnasDeFrente !== false) {
      try {
        const data = await selectAllRows('camion_viajes', `${SELECT_COLS}, ${COLS_OBRA}, ${COLS_TIQUE}, ${COLS_PESO}, ${COLS_TIPO}`, filtro);
        hayColumnasDeFrente = false;
        hayColumnasDeTipo = true;
        hayColumnasDePeso = true;
        hayColumnasDeTique = true;
        hayColumnasDeObra = true;
        return data as any[];
      } catch (eF: any) {
        if (!esColumnaQueFalta(eF)) throw eF;
      }
    }

    // ESCALÓN -1: sin el tipo de viaje (ni el frente, que llegó después).
    if (hayColumnasDeTipo !== false) {
      try {
        const data = await selectAllRows('camion_viajes', `${SELECT_COLS}, ${COLS_OBRA}, ${COLS_TIQUE}, ${COLS_PESO}`, filtro);
        hayColumnasDeFrente = false;
        hayColumnasDeTipo = false;
        hayColumnasDePeso = true;
        hayColumnasDeTique = true;
        hayColumnasDeObra = true;
        return data as any[];
      } catch (eT: any) {
        if (!esColumnaQueFalta(eT)) throw eT;
      }
    }

    // ESCALÓN 0: sin el peso (26-sep-2026, y sin el tipo ni el frente, que
    // llegaron después). Obra y ticketera pueden estar perfectamente.
    if (hayColumnasDePeso !== false) {
      try {
        const data = await selectAllRows('camion_viajes', `${SELECT_COLS}, ${COLS_OBRA}, ${COLS_TIQUE}`, filtro);
        hayColumnasDePeso = false;
        hayColumnasDeTipo = false;
        hayColumnasDeFrente = false;
        hayColumnasDeTique = true;
        hayColumnasDeObra = true;
        return data as any[];
      } catch (e0: any) {
        if (!esColumnaQueFalta(e0)) throw e0;
      }
    }

    // ESCALÓN 1: sin la ticketera (y sin peso: sin ticketera no hay peso,
    // llegaron en ese orden). La obra puede estar.
    if (hayColumnasDeTique !== false) {
      try {
        const data = await selectAllRows('camion_viajes', `${SELECT_COLS}, ${COLS_OBRA}`, filtro);
        hayColumnasDeTique = false;
        hayColumnasDePeso = false;
        hayColumnasDeTipo = false;
        hayColumnasDeFrente = false;
        hayColumnasDeObra = true;
        return data as any[];
      } catch (e2: any) {
        if (!esColumnaQueFalta(e2)) throw e2;
      }
    }

    // ESCALÓN 2: pelado. Si esto también falla, el problema no eran las columnas.
    const data = await selectAllRows('camion_viajes', SELECT_COLS, filtro);
    hayColumnasDeObra = false;
    hayColumnasDeTique = false;
    hayColumnasDePeso = false;
    hayColumnasDeTipo = false;
    hayColumnasDeFrente = false;
    return data as any[];
  }
}

/** Para que la pantalla pueda avisar que la obra todavía no está en la base. */
export function faltaCorrerSqlDeObras(): boolean {
  return hayColumnasDeObra === false;
}

/** Lo mismo para la ticketera: sin esto no hay folio que imprimir. */
export function faltaCorrerSqlDeTique(): boolean {
  return hayColumnasDeTique === false;
}

/** Y para el peso de romana: sin las columnas, el peso que teclee el listero
 *  se perdería en silencio — la pantalla tiene que avisar, no fingir. */
export function faltaCorrerSqlDePeso(): boolean {
  return hayColumnasDePeso === false;
}

// ── LA FOTO DE LA ROMANA ─────────────────────────────────────────────────────
//
// La evidencia obligatoria del peso bruto. Con señal se sube al momento; SIN
// señal viaja DENTRO de la cola offline como data-url (base64) y se sube acá,
// justo antes del insert, cuando el vaciado de la cola la trae de vuelta.
//
// ⚠️ El nombre del archivo sale del `client_action_id` del viaje (saneado), con
//    `upsert: true`: cada reintento reescribe EL MISMO archivo en vez de dejar
//    un huérfano por intento, y el viaje duplicado (23505) apunta a la misma
//    foto que su original.

/** Decodifica base64 a bytes. Copia mínima de la de `photo.ts` — importar ese
 *  archivo arrastraría expo-image-picker a todo el que importe esta librería. */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function bytesDeBase64(b64: string): Uint8Array {
  const str = b64.replace(/=+$/, '');
  const bytes = new Uint8Array((str.length * 3) >> 2);
  let p = 0, buffer = 0, bits = 0;
  for (let i = 0; i < str.length; i++) {
    buffer = (buffer << 6) | B64.indexOf(str[i]);
    bits += 6;
    if (bits >= 8) { bits -= 8; bytes[p++] = (buffer >> bits) & 0xff; }
  }
  return bytes;
}

/** Sube la foto de la romana (data-url jpeg) al bucket 'machinery' y devuelve
 *  la URL pública. El error se DEVUELVE: quien llama decide si encola. */
export async function subirFotoRomana(dataUrl: string, clave: string): Promise<{ url?: string; error?: string }> {
  const coma = dataUrl.indexOf(',');
  const b64 = coma >= 0 ? dataUrl.slice(coma + 1) : dataUrl;
  if (!b64) return { error: 'La foto quedó vacía. Vuelve a tomarla.' };
  const nombre = String(clave || Date.now()).replace(/[^a-zA-Z0-9._-]/g, '-');
  const path = `viajes-peso/${nombre}.jpg`;
  const up = await supabase.storage.from('machinery').upload(path, bytesDeBase64(b64), {
    contentType: 'image/jpeg', upsert: true,
  });
  if (up.error) return { error: up.error.message };
  const { data } = supabase.storage.from('machinery').getPublicUrl(path);
  return { url: data.publicUrl };
}

/** Registra un viaje. `registeredAt` ya viene calculado por quien llama (la hora
 *  REAL del toque en el teléfono) — se inserta TAL CUAL, nunca `now()` del
 *  servidor (necesario para que un viaje registrado sin señal conserve su hora
 *  exacta al sincronizarse después, ver `src/lib/viajesOfflineQueue.ts`). */
export async function registrarViaje(params: {
  /** null SOLO si `fueraCatalogo` es true. */
  machineryId: string | null;
  machineCode: string;
  /** Camión anotado a mano por el listero, que NO está en el catálogo. */
  fueraCatalogo?: boolean;
  camionRef?: string | null;
  listeroId: string;
  listeroName: string;
  choferName: string | null;
  shift: 'day' | 'night' | null;
  estadoMaquina: string | null;
  note?: string | null;
  registeredAt: string; // ISO
  clientActionId?: string;
  /** OBRA del listero en el momento de registrar. Opcional: un viaje que salió
   *  de la cola offline de antes de esta función no la trae, y eso está bien. */
  ubicacionId?: string | null;
  ubicacionNombre?: string | null;
  /** Placa y empresa del camión, para CONGELARLAS en el viaje. Ver la nota de
   *  `CamionViajeRow.placa`. Opcional por lo mismo que la obra: un viaje viejo
   *  de la cola offline no las trae. */
  placa?: string | null;
  empresa?: string | null;
  /** Cómo entró el viaje (14-sep-2026): tocado en el patio, subido desde la cola sin
   *  señal, o cargado a mano por la oficina. Si no viene, la base lo deduce. */
  origen?: 'campo' | 'cola' | 'manual';
  /** PESO DE ROMANA (26-sep-2026), ya en KILOS. Opcionales en el tipo porque
   *  un viaje viejo de la cola no los trae; la OBLIGATORIEDAD la exige la
   *  pantalla del listero, que es donde se puede corregir en el momento. */
  pesoBrutoKg?: number | null;
  pesoTaraKg?: number | null;
  taraManual?: boolean;
  taraManualNombre?: string | null;
  /** La foto YA subida (registro con señal)… */
  pesoFotoUrl?: string | null;
  /** …o la foto CRUDA (data-url) esperando señal en la cola: se sube acá,
   *  justo antes del insert. Si la subida falla, el viaje NO se inserta y el
   *  error vuelve a la cola, que reintenta las dos cosas juntas. */
  pesoFotoDataUrl?: string | null;
  /** TIPO DE VIAJE, ya congelado por la pantalla (nombre y tarifa del catálogo
   *  AL MOMENTO de registrar). Ausente = viaje normal (tarifa de zona). */
  tipoViajeId?: string | null;
  tipoViajeNombre?: string | null;
  tipoViajeTarifa?: number | null;
  /** FRENTE DE TRABAJO, ya resuelto por la pantalla (la asignación del camión
   *  en ESA jornada, o el elegido a mano en la carga manual). Ausente = sin
   *  frente; se puede completar después en ✏️ Editar. */
  frenteId?: string | null;
  frenteNombre?: string | null;
}): Promise<{ error?: string; missing?: boolean }> {
  // La foto primero: un viaje con peso no puede entrar sin su evidencia. El
  // insert de abajo solo corre cuando ya hay URL (o cuando el viaje es viejo
  // y no trae peso, que también es válido).
  let pesoFotoUrl = params.pesoFotoUrl ?? null;
  if (!pesoFotoUrl && params.pesoFotoDataUrl) {
    const up = await subirFotoRomana(params.pesoFotoDataUrl, params.clientActionId ?? '');
    if (up.error) return { error: `No se pudo subir la foto de la romana: ${up.error}` };
    pesoFotoUrl = up.url ?? null;
  }
  // Las dos clases de viaje son EXCLUYENTES y la BD lo exige con un CHECK
  // (`cv_fuera_catalogo_coherente`). Se normaliza acá para que un error de quien
  // llama no llegue a la base como una violación de constraint sin explicación.
  const fuera = params.fueraCatalogo === true;
  const base = {
    machinery_id: fuera ? null : params.machineryId,
    machine_code: params.machineCode,
    fuera_catalogo: fuera,
    camion_ref: fuera ? (params.camionRef ?? null) : null,
    listero_id: params.listeroId,
    listero_name: params.listeroName,
    chofer_name: params.choferName,
    shift: params.shift,
    estado_maquina: params.estadoMaquina,
    note: params.note ?? null,
    registered_at: params.registeredAt,
    ...(params.clientActionId ? { client_action_id: params.clientActionId } : {}),
  };
  const camposObra = {
    ubicacion_id: params.ubicacionId ?? null,
    ubicacion_nombre: params.ubicacionNombre ?? null,
  };
  // ⚠️ El `folio` NO va acá. Lo pone la base con su trigger: si lo mandara el
  //    teléfono, dos listeros que registran en el mismo segundo se llevarían el
  //    mismo número.
  // ⚠️ La EMPRESA (`company_id`) y la ZONA DE PAGO tampoco van acá (14-sep-2026):
  //    las copia la base al insertar, desde el catálogo y desde la obra, y no se
  //    pueden cambiar después. Son los datos con los que se cobra: no pueden
  //    salir del teléfono. El `origen` sí lo manda la app (solo ella sabe si el
  //    viaje salió de la cola); va con la ticketera porque se agregó después.
  const camposTique = {
    placa_snap: params.placa ?? null,
    empresa_snap: params.empresa ?? null,
    ...(params.origen ? { origen: params.origen } : {}),
  };
  // ⚠️ El NETO no va: es columna GENERADA, lo calcula la base. Mandarlo sería
  //    un error de PostgREST, y calcularlo acá sería tener la regla en dos sitios.
  const camposPeso = {
    peso_bruto_kg: params.pesoBrutoKg ?? null,
    peso_tara_kg: params.pesoTaraKg ?? null,
    tara_manual: params.taraManual === true,
    tara_manual_nombre: params.taraManualNombre ?? null,
    peso_foto_url: pesoFotoUrl,
  };
  const camposTipo = {
    tipo_viaje_id: params.tipoViajeId ?? null,
    tipo_viaje_nombre: params.tipoViajeNombre ?? null,
    tipo_viaje_tarifa: params.tipoViajeTarifa ?? null,
  };
  const camposFrente = {
    frente_id: params.frenteId ?? null,
    frente_nombre: params.frenteNombre ?? null,
  };

  // Mismo respaldo que en la lectura, y por la misma razón: si un `.sql` todavía
  // no se corrió, el insert con esas columnas rebota con 42703 y EL LISTERO NO
  // PODRÍA REGISTRAR NI UN VIAJE. Se baja un escalón y se reintenta; el viaje
  // entra igual y lo único que pierde es lo que esa base todavía no sabe
  // guardar, que se puede rellenar después.
  //
  // ⚠️ El `client_action_id` es EL MISMO en todos los intentos, así que si uno
  //    llegó a entrar, el siguiente rebota con 23505 y quien llama ya lee eso
  //    como «ese viaje ya estaba». No se puede duplicar por reintentar.
  const escalones: { cuerpo: Record<string, any>; obra: boolean; ticket: boolean; peso: boolean; tipo: boolean; frente: boolean }[] = [];
  if (hayColumnasDeObra !== false && hayColumnasDeTique !== false && hayColumnasDePeso !== false && hayColumnasDeTipo !== false && hayColumnasDeFrente !== false) {
    escalones.push({ cuerpo: { ...base, ...camposObra, ...camposTique, ...camposPeso, ...camposTipo, ...camposFrente }, obra: true, ticket: true, peso: true, tipo: true, frente: true });
  }
  if (hayColumnasDeObra !== false && hayColumnasDeTique !== false && hayColumnasDePeso !== false && hayColumnasDeTipo !== false) {
    escalones.push({ cuerpo: { ...base, ...camposObra, ...camposTique, ...camposPeso, ...camposTipo }, obra: true, ticket: true, peso: true, tipo: true, frente: false });
  }
  if (hayColumnasDeObra !== false && hayColumnasDeTique !== false && hayColumnasDePeso !== false) {
    escalones.push({ cuerpo: { ...base, ...camposObra, ...camposTique, ...camposPeso }, obra: true, ticket: true, peso: true, tipo: false, frente: false });
  }
  if (hayColumnasDeObra !== false && hayColumnasDeTique !== false) {
    // ⚠️ Sin las columnas de peso el viaje ENTRA IGUAL y el peso se pierde en
    //    ESA base (misma filosofía de siempre: mejor un viaje sin peso que un
    //    listero que no puede registrar). La pantalla avisa con
    //    `faltaCorrerSqlDePeso()` para que el admin corra el `.sql`.
    escalones.push({ cuerpo: { ...base, ...camposObra, ...camposTique }, obra: true, ticket: true, peso: false, tipo: false, frente: false });
  }
  if (hayColumnasDeObra !== false) {
    escalones.push({ cuerpo: { ...base, ...camposObra }, obra: true, ticket: false, peso: false, tipo: false, frente: false });
  }
  escalones.push({ cuerpo: base, obra: false, ticket: false, peso: false, tipo: false, frente: false });

  let error: any = null;
  for (const paso of escalones) {
    const r = await supabase.from('camion_viajes').insert(paso.cuerpo);
    error = r.error;
    if (!error) {
      // Solo se AFIRMA lo que este intento acaba de demostrar. Un escalón que
      // funciona prueba que sus columnas están; no dice nada de las de arriba
      // — salvo que para LLEGAR a este escalón, el de arriba tuvo que fallar
      // por columna que falta, y eso sí se anota.
      if (paso.obra) hayColumnasDeObra = true;
      if (paso.ticket) hayColumnasDeTique = true;
      if (paso.peso) hayColumnasDePeso = true;
      if (paso.tipo) hayColumnasDeTipo = true;
      else if (paso.peso) hayColumnasDeTipo = false;
      if (paso.frente) hayColumnasDeFrente = true;
      else if (paso.tipo) hayColumnasDeFrente = false;
      if (!paso.peso && paso.ticket) { hayColumnasDePeso = false; hayColumnasDeTipo = false; hayColumnasDeFrente = false; }
      if (!paso.ticket && paso.obra) { hayColumnasDeTique = false; hayColumnasDePeso = false; hayColumnasDeTipo = false; hayColumnasDeFrente = false; }
      if (!paso.obra) { hayColumnasDeObra = false; hayColumnasDeTique = false; hayColumnasDePeso = false; hayColumnasDeTipo = false; hayColumnasDeFrente = false; }
      return {};
    }
    if (!esColumnaQueFalta(error)) break;
  }
  if (error) return { error: error.message, missing: isMissingTable(error.message, (error as any).code) };
  return {};
}

/**
 * `selectAllRows` pagina ordenando por `id` (orden estable, obligatorio para que
 * el `.range()` no salte ni repita filas), así que el orden cronológico se
 * pierde y hay que rehacerlo acá. Mismo criterio que MantenimientoMaquinaria.
 */
function porFechaDesc(a: CamionViajeRow, b: CamionViajeRow): number {
  return new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime();
}

/**
 * Traduce lo que lanza `selectAllRows` al contrato de estas funciones.
 *
 * ⚠️ `error` se DEVUELVE, no se tira. Antes las dos listas hacían
 * `if (error) return { rows: [] }` y se comían el mensaje: una consulta que
 * reventaba se veía EXACTAMENTE igual que «no hay viajes». El listero leía
 * «Todavía no registras viajes hoy» con sus viajes intactos en la base.
 */
function fallo(e: any): { rows: CamionViajeRow[]; missing: boolean; error: string } {
  const msg = String(e?.message ?? e);
  return { rows: [], missing: isMissingTable(msg, e?.code), error: msg };
}

/** Viajes del listero indicado dentro de un rango (normalmente "hoy", según su
 *  jornada) — para su propia pantalla de registro. Más reciente primero. */
export async function listMisViajesHoy(
  listeroId: string,
  desdeISO: string,
  /** ⚠️ EXCLUSIVO: se compara con `<`, no con `<=`. Es el inicio del día
   *  siguiente, no las 23:59:59 — con `23:59:59` un viaje entre .001 y .999
   *  no caía en NINGÚN día. */
  hastaExclusivoISO: string,
): Promise<{ rows: CamionViajeRow[]; missing: boolean; error?: string }> {
  if (!listeroId) return { rows: [], missing: false };
  try {
    // PAGINADO: un `.select()` pelado corta en ~1000 filas y, como el orden era
    // descendente, se comía los viajes MÁS VIEJOS del rango sin avisar.
    const data = await leerViajes((q: any) =>
      q.eq('listero_id', listeroId)
        .gte('registered_at', desdeISO)
        .lt('registered_at', hastaExclusivoISO));
    return { rows: await conFrenteDelDia(data.map(mapRow).sort(porFechaDesc)), missing: false };
  } catch (e: any) {
    return fallo(e);
  }
}

/** TODOS los viajes en un rango, con filtros opcionales por listero y/o
 *  máquina — para la pantalla de la jefa/admin (reporte general). */
export async function listTodosLosViajes(filtro: {
  desdeISO: string;
  /** ⚠️ EXCLUSIVO (`<`). Omitirlo = sin tope superior, que es lo correcto para
   *  la alerta de «camión sin viajes»: acotar con "ahora" dejaba fuera el viaje
   *  de un teléfono con el reloj adelantado. */
  hastaExclusivoISO?: string;
  listeroIds?: string[];
  machineryIds?: string[];
}): Promise<{ rows: CamionViajeRow[]; missing: boolean; error?: string }> {
  try {
    const data = await leerViajes((q: any) => {
      let qq = q.gte('registered_at', filtro.desdeISO);
      if (filtro.hastaExclusivoISO) qq = qq.lt('registered_at', filtro.hastaExclusivoISO);
      if (filtro.listeroIds && filtro.listeroIds.length > 0) qq = qq.in('listero_id', filtro.listeroIds);
      if (filtro.machineryIds && filtro.machineryIds.length > 0) qq = qq.in('machinery_id', filtro.machineryIds);
      return qq;
    });
    return { rows: await conFrenteDelDia(data.map(mapRow).sort(porFechaDesc)), missing: false };
  } catch (e: any) {
    return fallo(e);
  }
}

/**
 * Cambios que la JEFA (nivel `full`) puede hacerle a un viaje ya registrado.
 * Todos son opcionales: se manda solo lo que se tocó.
 *
 * ⚠️ NO incluye el camión. Cambiar de camión un viaje no es una corrección, es
 *    otro viaje: hay que borrar este y cargar el bueno, y así la auditoría
 *    conserva las dos cosas por separado en vez de una fila que mutó.
 */
export type CambiosViaje = {
  /** Fecha Y hora. Ver `src/lib/viajesEdicion.ts` — puede mudar el viaje de día. */
  registeredAtISO?: string;
  /** El chofer/responsable que iba en el camión. `null` = sin chofer anotado. */
  choferName?: string | null;
  /** Reasignar a otro listero. Los DOS campos van juntos: `listero_name` es el
   *  nombre congelado que se muestra en el reporte, y dejarlo sin actualizar
   *  mostraría al listero viejo con el id del nuevo. */
  listeroId?: string;
  listeroName?: string;
  shift?: 'day' | 'night' | null;
  note?: string | null;
  /** Otro CDT para ESTE viaje. La base pone el nombre y la zona de pago del CDT
   *  nuevo, y solo lo acepta de quien tiene permiso completo de viajes. */
  ubicacionId?: string;
  /** Corregir el PESO BRUTO de un viaje ya registrado (solo la jefa/full, se
   *  valida en la pantalla). El neto lo recalcula LA BASE sola (columna
   *  generada). */
  pesoBrutoKg?: number;
  /** Corregir la TARA CONGELADA de un viaje ya registrado (27-sep-2026, pedido
   *  explícito: «por si cargaron mal la tara»). Antes la regla era borrar el
   *  viaje y recargarlo; el dueño del módulo decidió que se corrige acá, con
   *  rastro en Auditoría. El neto lo recalcula LA BASE sola, y el candado
   *  `cv_peso_coherente` (bruto > tara > 0) rebota una tara imposible. */
  pesoTaraKg?: number;
  /** Al AGREGARLE peso a un viaje cargado a mano (28-sep-2026), la tara que se
   *  teclea queda marcada como manual, con el nombre de quien la puso — la
   *  misma marca «✍️ tara manual» del registro del listero. */
  taraManual?: boolean;
  taraManualNombre?: string | null;
  /** Corregir el TIPO DE VIAJE (solo full). Se manda el snapshot COMPLETO —
   *  id, nombre y tarifa del catálogo al momento de la corrección— o los tres
   *  en null para volverlo viaje normal. Congela en la corrección, igual que
   *  congeló el registro. */
  tipoViaje?: { id: string | null; nombre: string | null; tarifa: number | null };
  /** Ponerle o corregirle el FRENTE DE TRABAJO a un viaje ya registrado
   *  (28-sep-2026, pedido: «el histórico debería poder agregarle frentes a los
   *  que ya se hicieron»). Snapshot completo, o los dos en null para quitarlo. */
  frente?: { id: string | null; nombre: string | null };
};

/**
 * Corrige un viaje ya registrado. El listero solo debe poder tocar la HORA de
 * sus PROPIOS viajes; la jefa puede tocarlo todo — se valida en la pantalla, no
 * aquí (mismo criterio que el resto del módulo, ver la cabecera del archivo).
 */
export async function editarViaje(id: string, cambios: CambiosViaje): Promise<{ error?: string }> {
  const patch: Record<string, any> = {};
  if (cambios.registeredAtISO !== undefined) patch.registered_at = cambios.registeredAtISO;
  if (cambios.choferName !== undefined) patch.chofer_name = cambios.choferName;
  if (cambios.listeroId !== undefined) patch.listero_id = cambios.listeroId;
  if (cambios.listeroName !== undefined) patch.listero_name = cambios.listeroName;
  if (cambios.shift !== undefined) patch.shift = cambios.shift;
  if (cambios.note !== undefined) patch.note = cambios.note;
  if (cambios.ubicacionId) patch.ubicacion_id = cambios.ubicacionId;
  if (cambios.pesoBrutoKg !== undefined) patch.peso_bruto_kg = cambios.pesoBrutoKg;
  if (cambios.pesoTaraKg !== undefined) patch.peso_tara_kg = cambios.pesoTaraKg;
  if (cambios.taraManual !== undefined) patch.tara_manual = cambios.taraManual;
  if (cambios.taraManualNombre !== undefined) patch.tara_manual_nombre = cambios.taraManualNombre;
  if (cambios.tipoViaje !== undefined) {
    patch.tipo_viaje_id = cambios.tipoViaje.id;
    patch.tipo_viaje_nombre = cambios.tipoViaje.nombre;
    patch.tipo_viaje_tarifa = cambios.tipoViaje.tarifa;
  }
  if (cambios.frente !== undefined) {
    patch.frente_id = cambios.frente.id;
    patch.frente_nombre = cambios.frente.nombre;
  }
  // Un update vacío en PostgREST devuelve la fila sin cambiar nada: parecería
  // que se guardó algo. Mejor decirlo.
  if (Object.keys(patch).length === 0) return { error: 'No cambiaste nada.' };
  // `.select('id')` para distinguir «actualizado» de «no había fila que actualizar»:
  // sin él, corregir un viaje que otro usuario ya borró devolvía ÉXITO y la
  // corrección se perdía sin que nadie lo notara.
  const { data, error } = await supabase.from('camion_viajes').update(patch).eq('id', id).select('id');
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: 'Ese viaje ya no existe (puede haberlo borrado otro usuario). Refresca la lista.' };
  return {};
}

// Acá vivía `editarHoraViaje(id, iso)`. Se quitó el 31-ago-2026 al abrirse la
// edición completa: los tres llamadores pasaron a `editarViaje`, y dejarla
// habría sido una segunda puerta a la misma tabla — la clase de duplicado que
// termina desincronizándose. Si buscas ese nombre en un comentario viejo, es
// esta función.

/** Borrado real (hard delete) — la auditoría automática (`trg_audit`) conserva
 *  el registro completo igual. Solo debe quedar accesible desde la UI para
 *  nivel "full" del módulo (jefa/admin) — se valida en la pantalla, no aquí. */
export async function borrarViaje(id: string): Promise<{ error?: string }> {
  const { data, error } = await supabase.from('camion_viajes').delete().eq('id', id).select('id');
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: 'Ese viaje ya no existe (puede haberlo borrado otro usuario). Refresca la lista.' };
  return {};
}

/** Meta de viajes/día por camión (columna `machinery.meta_viajes_diarios`,
 *  NULL = sin meta definida). Batch por lista de IDs. */
export async function getMetasPorCamion(machineryIds: string[]): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  if (!machineryIds || machineryIds.length === 0) return out;
  try {
    const data = await selectAllRows('machinery', 'id, meta_viajes_diarios', (q: any) => q.in('id', machineryIds));
    (data as any[]).forEach((r) => { out[r.id as string] = (r.meta_viajes_diarios ?? null) as number | null; });
  } catch (e: any) {
    // Antes era `if (error) return out;`: las metas desaparecían de la pantalla
    // sin ninguna señal, indistinguible de «ningún camión tiene meta puesta».
    console.warn('[camionViajes] getMetasPorCamion falló:', String(e?.message ?? e));
  }
  return out;
}

export async function setMetaCamion(machineryId: string, meta: number | null): Promise<{ error?: string }> {
  const { error } = await supabase.from('machinery').update({ meta_viajes_diarios: meta }).eq('id', machineryId);
  if (error) return { error: error.message };
  return {};
}

// ── LA TARA OFICIAL POR CAMIÓN (tabla `camion_taras`, 26-sep-2026) ───────────
//
// La administra quien tiene FULL en viajes_camiones (RLS lo exige, probado por
// suplantación); el listero solo la LEE, que la necesita para calcular el neto
// en pantalla. NO vive en `machinery`: esa tabla solo la escriben staff/permiso
// de equipos, y la tara es un dato del módulo de viajes.

export type TaraCamion = {
  /** null = este camión no tiene tara cargada (la fila existe por la exención). */
  pesoTaraKg: number | null;
  updatedAt: string;
  /** Nombre CONGELADO de quien la cargó/actualizó — para el «¿quién puso esta
   *  tara?» de dentro de seis meses, aunque esa cuenta ya no exista. */
  updatedByNombre: string | null;
  /**
   * 🚫 NO PASA POR ROMANA (26-sep-2026): a este camión no se le exige peso ni
   * foto — al listero ni le aparece la tarjeta. Sus viajes entran sin peso y
   * salen con raya. `exentoPorNombre` dice quién lo marcó.
   */
  exentoRomana: boolean;
  exentoPorNombre: string | null;
};

/** Todas las taras/exenciones cargadas. `missing` = falta correr el `.sql`. */
export async function listTaras(): Promise<{ taras: Map<string, TaraCamion>; missing: boolean; error?: string }> {
  const taras = new Map<string, TaraCamion>();
  // Las columnas de exención llegaron horas después de la tabla: se piden con
  // respaldo para que un restore de esta misma tarde no deje la lista vacía.
  // ⚠️ `camion_taras` NO tiene columna `id` (la llave es machinery_id): hay que
  //    decírselo al paginador o su `order('id')` por defecto revienta con 42703
  //    y la pantalla lo confunde con «falta correr el SQL» (pasó el 26-sep).
  const leerFilas = async () => {
    try {
      return await selectAllRows('camion_taras', 'machinery_id, peso_tara_kg, updated_at, updated_by_nombre, exento_romana, exento_por_nombre', undefined, 'machinery_id');
    } catch (e: any) {
      if (e?.code !== '42703' && !/column .* does not exist|could not find the .*column/i.test(String(e?.message ?? e))) throw e;
      return await selectAllRows('camion_taras', 'machinery_id, peso_tara_kg, updated_at, updated_by_nombre', undefined, 'machinery_id');
    }
  };
  try {
    const data = await leerFilas();
    (data as any[]).forEach((r) => {
      const n = Number(r.peso_tara_kg);
      const tara = r.peso_tara_kg != null && isFinite(n) && n > 0 ? n : null;
      const exento = r.exento_romana === true;
      if (tara == null && !exento) return; // fila vacía: no dice nada
      taras.set(r.machinery_id as string, {
        pesoTaraKg: tara,
        updatedAt: String(r.updated_at ?? ''),
        updatedByNombre: (r.updated_by_nombre ?? null) as string | null,
        exentoRomana: exento,
        exentoPorNombre: (r.exento_por_nombre ?? null) as string | null,
      });
    });
    return { taras, missing: false };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    return { taras, missing: isMissingTable(msg, e?.code), error: msg };
  }
}

/** Carga o corrige la tara de un camión (upsert). Solo full — lo exige el RLS,
 *  la pantalla solo evita el error feo. */
export async function setTaraCamion(
  machineryId: string, pesoTaraKg: number, userId: string | null, userName: string | null,
): Promise<{ error?: string }> {
  if (!machineryId || !isFinite(pesoTaraKg) || pesoTaraKg <= 0) return { error: 'La tara tiene que ser un peso mayor que cero.' };
  const { error } = await supabase.from('camion_taras').upsert({
    machinery_id: machineryId,
    peso_tara_kg: pesoTaraKg,
    updated_at: new Date().toISOString(),
    updated_by: userId,
    updated_by_nombre: userName,
  });
  if (error) return { error: error.message };
  return {};
}

/** Quita la tara de un camión. ⚠️ Los viajes YA registrados conservan la suya
 *  (congelada); esto solo hace que los PRÓXIMOS pidan tara manual.
 *  Si el camión está EXENTO de romana, la fila se conserva (con tara en null):
 *  quitar la tara no puede borrar la exención de rebote. */
export async function quitarTaraCamion(machineryId: string): Promise<{ error?: string }> {
  // Primero el caso simple: fila SIN exención → se borra entera.
  const del = await supabase.from('camion_taras').delete()
    .eq('machinery_id', machineryId).eq('exento_romana', false).select('machinery_id');
  if (del.error) return { error: del.error.message };
  if (del.data && del.data.length > 0) return {};
  // Fila exenta (o vieja sin columna): se vacía solo la tara.
  const up = await supabase.from('camion_taras').update({ peso_tara_kg: null })
    .eq('machinery_id', machineryId).select('machinery_id');
  if (up.error) return { error: up.error.message };
  if (!up.data || up.data.length === 0) return { error: 'Ese camión no tenía tara cargada.' };
  return {};
}

/**
 * 🚫 MARCA O DESMARCA «no pasa por romana» (26-sep-2026). Solo full (RLS).
 *
 * ⚠️ NO toca la tara guardada: si el camión tenía tara y se marca exento, la
 *    tara queda esperando por si vuelve a pasar por romana. Desmarcar un
 *    camión SIN tara borra la fila (una fila sin tara ni exención no dice
 *    nada, y la base tiene un CHECK que no la deja existir).
 */
export async function setExentoRomana(
  machineryId: string, exento: boolean, userName: string | null,
): Promise<{ error?: string }> {
  if (!machineryId) return { error: 'Falta el camión.' };
  if (exento) {
    const { error } = await supabase.from('camion_taras').upsert({
      machinery_id: machineryId,
      exento_romana: true,
      exento_at: new Date().toISOString(),
      exento_por_nombre: userName,
    });
    if (error) return { error: error.message };
    return {};
  }
  // Desmarcar: si hay tara, la fila se queda con ella; si no, se borra.
  const up = await supabase.from('camion_taras')
    .update({ exento_romana: false, exento_at: new Date().toISOString(), exento_por_nombre: userName })
    .eq('machinery_id', machineryId).not('peso_tara_kg', 'is', null).select('machinery_id');
  if (up.error) return { error: up.error.message };
  if (up.data && up.data.length > 0) return {};
  const del = await supabase.from('camion_taras').delete()
    .eq('machinery_id', machineryId).is('peso_tara_kg', null).select('machinery_id');
  if (del.error) return { error: del.error.message };
  return {};
}

// ── EL CATÁLOGO DE TIPOS DE VIAJE (tabla `viaje_tipos`, 26-sep-2026) ─────────
//
// Las tarifas con NOMBRE: «Oeste → Este» y las que inventen después. Las
// administra quien tiene full (RLS probado); el listero solo las LEE para
// marcar el tipo al registrar. El viaje congela nombre Y tarifa: cambiar el
// precio del tipo mañana no toca lo ya registrado.

export type TipoViaje = {
  id: string;
  nombre: string;
  /** null = sin precio todavía: sus viajes salen «tipo sin tarifa» en el pago. */
  tarifaUsd: number | null;
  activo: boolean;
  updatedByNombre: string | null;
};

export async function listTiposViaje(): Promise<{ tipos: TipoViaje[]; missing: boolean; error?: string }> {
  try {
    const data = await selectAllRows('viaje_tipos', 'id, nombre, tarifa_usd, activo, updated_by_nombre');
    const tipos = (data as any[]).map((r) => ({
      id: r.id as string,
      nombre: String(r.nombre ?? '').trim(),
      tarifaUsd: r.tarifa_usd == null ? null : Number(r.tarifa_usd),
      activo: r.activo !== false,
      updatedByNombre: (r.updated_by_nombre ?? null) as string | null,
    })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base', numeric: true }));
    return { tipos, missing: false };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    return { tipos: [], missing: isMissingTable(msg, e?.code), error: msg };
  }
}

/** Crea un tipo nuevo. La tarifa puede venir después. */
export async function crearTipoViaje(nombre: string, tarifaUsd: number | null, userId: string | null, userName: string | null): Promise<{ error?: string }> {
  const n = nombre.replace(/\s+/g, ' ').trim();
  if (n.length < 2) return { error: 'Ponle un nombre al tipo (p. ej. «Oeste → Este»).' };
  if (tarifaUsd != null && !(tarifaUsd > 0)) return { error: 'La tarifa tiene que ser mayor que 0 (o déjala vacía para ponerla después).' };
  const { error } = await supabase.from('viaje_tipos').insert({
    nombre: n, tarifa_usd: tarifaUsd, updated_by: userId, updated_by_nombre: userName,
  });
  if (error) {
    if (/uq_viaje_tipos_nombre_activo|duplicate key/i.test(error.message)) return { error: `Ya existe un tipo activo llamado «${n}».` };
    return { error: error.message };
  }
  return {};
}

/** Cambia la tarifa (o el nombre) de un tipo. ⚠️ SOLO afecta a los viajes que
 *  vengan: los registrados llevan su tarifa congelada. */
export async function editarTipoViaje(id: string, cambios: { nombre?: string; tarifaUsd?: number | null }, userId: string | null, userName: string | null): Promise<{ error?: string }> {
  const patch: Record<string, any> = { updated_at: new Date().toISOString(), updated_by: userId, updated_by_nombre: userName };
  if (cambios.nombre !== undefined) {
    const n = cambios.nombre.replace(/\s+/g, ' ').trim();
    if (n.length < 2) return { error: 'El nombre del tipo no puede quedar vacío.' };
    patch.nombre = n;
  }
  if (cambios.tarifaUsd !== undefined) {
    if (cambios.tarifaUsd != null && !(cambios.tarifaUsd > 0)) return { error: 'La tarifa tiene que ser mayor que 0.' };
    patch.tarifa_usd = cambios.tarifaUsd;
  }
  const { data, error } = await supabase.from('viaje_tipos').update(patch).eq('id', id).select('id');
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: 'No se guardó: hace falta permiso completo en Viajes de camiones.' };
  return {};
}

/** Apaga o prende un tipo. Apagado deja de ofrecerse al listero; los viajes que
 *  ya lo llevan no cambian (el nombre viaja congelado en cada fila). */
export async function setActivoTipoViaje(id: string, activo: boolean, userId: string | null, userName: string | null): Promise<{ error?: string }> {
  const { data, error } = await supabase.from('viaje_tipos')
    .update({ activo, updated_at: new Date().toISOString(), updated_by: userId, updated_by_nombre: userName })
    .eq('id', id).select('id');
  if (error) {
    if (/uq_viaje_tipos_nombre_activo|duplicate key/i.test(error.message)) return { error: 'Ya hay un tipo ACTIVO con ese mismo nombre.' };
    return { error: error.message };
  }
  if (!data || data.length === 0) return { error: 'No se guardó: hace falta permiso completo en Viajes de camiones.' };
  return {};
}

// ── LOS FRENTES DE TRABAJO (tablas `viaje_frentes` y asignaciones, 28-sep) ───
//
// El FRENTE es de DÓNDE recogen los camiones el material que llevan a los
// CDT/CDF (las obras/ubicaciones son el destino; el frente, el origen). La
// oficina asigna diariamente un frente a cada camión —o a un grupo—, y cada
// viaje CONGELA el frente que su camión tenía esa jornada. Administra quien
// tiene full (RLS probado por suplantación); el listero solo LEE.

export type FrenteTrabajo = {
  id: string;
  nombre: string;
  activo: boolean;
};

export async function listFrentes(): Promise<{ frentes: FrenteTrabajo[]; missing: boolean; error?: string }> {
  try {
    const data = await selectAllRows('viaje_frentes', 'id, nombre, activo');
    const frentes = (data as any[]).map((r) => ({
      id: r.id as string,
      nombre: String(r.nombre ?? '').trim(),
      activo: r.activo !== false,
    })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base', numeric: true }));
    return { frentes, missing: false };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    return { frentes: [], missing: isMissingTable(msg, e?.code), error: msg };
  }
}

export async function crearFrente(nombre: string, userId: string | null, userName: string | null): Promise<{ error?: string }> {
  const n = nombre.replace(/\s+/g, ' ').trim();
  if (n.length < 2) return { error: 'Ponle un nombre al frente (p. ej. «Frente norte»).' };
  const { data, error } = await supabase.from('viaje_frentes')
    .insert({ nombre: n, created_by: userId, created_by_nombre: userName }).select('id');
  if (error) {
    if (/vf_nombre_activo_key|duplicate key/i.test(error.message)) return { error: `Ya existe un frente activo llamado «${n}».` };
    return { error: error.message };
  }
  if (!data || data.length === 0) return { error: 'No se guardó: hace falta permiso completo en Viajes de camiones.' };
  return {};
}

/**
 * ✏️ RENOMBRA un frente (30-sep-2026, a pedido: «que el usuario pueda borrar,
 * editar y agregar más frentes»). Corrige el nombre en el catálogo y en las
 * asignaciones, que lo leen por `frente_id`.
 *
 * ⚠️ NO toca los viajes YA registrados: cada uno guardó el NOMBRE congelado el
 *    día que se grabó. Es a propósito —igual que la obra y la placa—: un papel
 *    ya impreso y un pago ya hecho no pueden cambiar porque alguien corrigió
 *    una letra hoy. Si el nombre viejo estaba mal, se corrige en ✏️ Editar del
 *    viaje, que es donde se ve a quién le cambia la cuenta.
 */
export async function renombrarFrente(id: string, nombre: string): Promise<{ error?: string }> {
  const n = nombre.replace(/\s+/g, ' ').trim();
  if (n.length < 2) return { error: 'Ponle un nombre al frente (p. ej. «Frente norte»).' };
  const { data, error } = await supabase.from('viaje_frentes').update({ nombre: n }).eq('id', id).select('id');
  if (error) {
    if (/vf_nombre_activo_key|duplicate key/i.test(error.message)) return { error: `Ya existe un frente activo llamado «${n}».` };
    return { error: error.message };
  }
  if (!data || data.length === 0) return { error: 'No se guardó: hace falta permiso completo en Viajes de camiones.' };
  return {};
}

/** Cuántas asignaciones se llevaría por delante borrar este frente. Se pregunta
 *  ANTES de borrar para poder decírselo al usuario con un número, no en vago. */
export async function contarAsignacionesFrente(id: string): Promise<number> {
  const { count } = await supabase.from('viaje_frente_asignaciones')
    .select('id', { count: 'exact', head: true }).eq('frente_id', id);
  return count ?? 0;
}

/**
 * 🗑️ BORRA un frente del catálogo, con sus asignaciones (la base las borra en
 * cascada).
 *
 * ⚠️ LOS VIAJES NO SE PIERDEN: cada viaje guardó el NOMBRE del frente, no su
 *    id, así que los reportes y los papeles ya hechos siguen diciendo de dónde
 *    salió cada carga. Lo que desaparece es el frente del catálogo y a qué
 *    camiones estaba asignado.
 *
 * ⚠️ Si lo que se quiere es dejar de ofrecerlo sin tocar nada, eso es
 *    DESACTIVAR (`setActivoFrente`), no borrar. La pantalla avisa cuántas
 *    asignaciones se van antes de preguntar.
 */
export async function borrarFrente(id: string): Promise<{ error?: string }> {
  const { data, error } = await supabase.from('viaje_frentes').delete().eq('id', id).select('id');
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: 'No se borró: hace falta permiso completo en Viajes de camiones.' };
  return {};
}

/** Apaga o prende un frente. Apagado deja de ofrecerse al asignar; los viajes
 *  que ya lo llevan no cambian (el nombre viaja congelado en cada fila). */
export async function setActivoFrente(id: string, activo: boolean, userName: string | null): Promise<{ error?: string }> {
  const { data, error } = await supabase.from('viaje_frentes')
    .update(activo
      ? { activo: true, desactivado_at: null, desactivado_por_nombre: null }
      : { activo: false, desactivado_at: new Date().toISOString(), desactivado_por_nombre: userName })
    .eq('id', id).select('id');
  if (error) {
    if (/vf_nombre_activo_key|duplicate key/i.test(error.message)) return { error: 'Ya hay un frente ACTIVO con ese mismo nombre.' };
    return { error: error.message };
  }
  if (!data || data.length === 0) return { error: 'No se guardó: hace falta permiso completo en Viajes de camiones.' };
  return {};
}

/** La asignación de UNA jornada: camión → frente. */
export type AsignacionFrente = {
  machineryId: string;
  frenteId: string;
  frenteNombre: string;
};

/** Las asignaciones de una jornada (AAAA-MM-DD), con el nombre del frente ya
 *  pegado — es lo que el teléfono del listero congela en cada viaje. */
export async function listAsignacionesFrente(jornada: string): Promise<{ asignaciones: AsignacionFrente[]; missing: boolean; error?: string }> {
  try {
    const data = await selectAllRows(
      'viaje_frente_asignaciones',
      'machinery_id, frente_id, frente:frente_id(nombre)',
      (q: any) => q.eq('jornada', jornada),
      'machinery_id'
    );
    return {
      asignaciones: (data as any[]).map((r) => ({
        machineryId: r.machinery_id as string,
        frenteId: r.frente_id as string,
        frenteNombre: String(r.frente?.nombre ?? '').trim(),
      })),
      missing: false,
    };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    return { asignaciones: [], missing: isMissingTable(msg, e?.code), error: msg };
  }
}

/**
 * Las asignaciones de un RANGO de jornadas (ambos extremos inclusive). Sirve
 * para dos cosas: el 🕘 historial del apartado de frentes, y que los viajes de
 * un día tomen SOLOS el frente asignado a su camión (ver `conFrenteDelDia`).
 */
export async function listAsignacionesFrenteRango(
  desde: string, hasta: string,
): Promise<{ asignaciones: AsignacionDia[]; missing: boolean; error?: string }> {
  try {
    const data = await selectAllRows(
      'viaje_frente_asignaciones',
      'jornada, machinery_id, frente_id, frente:frente_id(nombre)',
      // Sin orderBy explícito: pagina por `id`, que es único. `jornada` se
      // repite (un camión por fila) y paginar por una columna repetida puede
      // saltar o duplicar filas al pasar de página.
      (q: any) => q.gte('jornada', desde).lte('jornada', hasta),
    );
    return {
      asignaciones: (data as any[]).map((r) => ({
        jornada: String(r.jornada ?? '').slice(0, 10),
        machineryId: r.machinery_id as string,
        frenteId: r.frente_id as string,
        frenteNombre: String(r.frente?.nombre ?? '').trim(),
      })),
      missing: false,
    };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    return { asignaciones: [], missing: isMissingTable(msg, e?.code), error: msg };
  }
}

/**
 * ⛏️ EL FRENTE DEL DÍA SE TOMA SOLO (29-sep-2026, pedido: «los frentes
 * asignados para un día deben tomarlo automáticamente los viajes de ese día,
 * estén registrados o no estén registrados»).
 *
 * A los viajes que vienen SIN frente se les completa con el que su camión tenía
 * asignado esa jornada. No se toca la base: se completa al leer (ver
 * `src/lib/frentesAuto.ts`, que explica por qué). Lo congelado manda: un viaje
 * que ya trae su frente se queda con el suyo.
 *
 * Si todos los viajes ya traen frente —o la tabla todavía no existe— NO se hace
 * ninguna consulta extra.
 */
async function conFrenteDelDia(rows: CamionViajeRow[]): Promise<CamionViajeRow[]> {
  const sinFrente = rows.filter((r) => r.machineryId && !CAMPOS_VIAJE_ROW.tieneFrente(r));
  const rango = rangoJornadas(sinFrente.map((r) => jornadaDeFecha(new Date(r.registeredAt))));
  if (!rango) return rows;
  const { asignaciones } = await listAsignacionesFrenteRango(rango.desde, rango.hasta);
  if (asignaciones.length === 0) return rows;
  const { filas } = completarFrentes(
    rows, mapaAsignaciones(asignaciones),
    (iso) => jornadaDeFecha(new Date(iso)), CAMPOS_VIAJE_ROW,
  );
  return filas;
}

/**
 * ⭐ ASIGNAR SUMA, NO PISA (30-sep-2026, a pedido: «permite que un camion pueda
 *    tener varios frentes»). Antes era un upsert por jornada+camión: ponerle un
 *    segundo frente BORRABA el primero. Ahora se agrega, y un camión puede
 *    recoger en varios frentes la misma jornada.
 *
 * Los viajes YA registrados conservan su frente congelado. Los que no tienen
 * frente lo toman solos al leerse (`conFrenteDelDia`), pero SOLO si el camión
 * tiene UN frente ese día: con varios no se adivina (ver `frentesAuto.ts`).
 *
 * ⚠️ NO USA `upsert`: un upsert necesita que exista el índice único de
 *    jornada+camión+frente, y así esto funciona ANTES y DESPUÉS de correr
 *    `supabase/frentes_varios_por_camion.sql`. Lo que ya está asignado se
 *    filtra leyendo primero; si aun así se cuela una repetida (dos pantallas
 *    asignando a la vez), el único de la base la rechaza y acá se dice «ya
 *    estaba» en vez de un error de llave duplicada que nadie entiende.
 */
export async function asignarFrente(
  jornada: string, machineryIds: string[], frenteId: string,
  userId: string | null, userName: string | null
): Promise<{ error?: string; agregados?: number; yaEstaban?: number }> {
  if (!machineryIds.length) return { error: 'Marca al menos un camión.' };
  const { data: previas } = await supabase.from('viaje_frente_asignaciones')
    .select('machinery_id').eq('jornada', jornada).eq('frente_id', frenteId)
    .in('machinery_id', machineryIds);
  const ya = new Set((previas ?? []).map((r: any) => String(r.machinery_id)));
  const nuevos = machineryIds.filter((m) => !ya.has(m));
  if (nuevos.length === 0) return { agregados: 0, yaEstaban: machineryIds.length };

  const filas = nuevos.map((m) => ({
    jornada, machinery_id: m, frente_id: frenteId, created_by: userId, created_by_nombre: userName,
  }));
  const { data, error } = await supabase.from('viaje_frente_asignaciones').insert(filas).select('id');
  if (error) {
    // El único de jornada+camión (el VIEJO) todavía existe: falta correr el SQL.
    if (/viaje_frente_asignaciones_jornada_machinery_id_key/i.test(error.message)) {
      return { error: 'Ese camión ya tiene otro frente ese día. Para poder ponerle varios, falta correr supabase/frentes_varios_por_camion.sql.' };
    }
    if (/duplicate key/i.test(error.message)) return { agregados: 0, yaEstaban: machineryIds.length };
    return { error: error.message };
  }
  if (!data || data.length === 0) return { error: 'No se guardó: hace falta permiso completo en Viajes de camiones.' };
  return { agregados: data.length, yaEstaban: ya.size };
}

/**
 * Quita UNA asignación: ese camión, esa jornada, ESE frente. Sin `frenteId` le
 * quita todos los frentes de ese día.
 *
 * ⚠️ `frenteId` no es opcional por comodidad: desde que un camión puede tener
 *    varios, borrar «el frente del camión» sin decir cuál se llevaría por
 *    delante los otros. Los viajes ya registrados conservan el suyo congelado.
 */
export async function quitarAsignacionFrente(
  jornada: string, machineryId: string, frenteId?: string,
): Promise<{ error?: string }> {
  let q = supabase.from('viaje_frente_asignaciones')
    .delete().eq('jornada', jornada).eq('machinery_id', machineryId);
  if (frenteId) q = q.eq('frente_id', frenteId);
  const { data, error } = await q.select('id');
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: 'Esa asignación ya no existe.' };
  return {};
}

const DEFAULT_ALERTA_HORAS = 6;

/** Umbral configurable de "camión sin viajes hace X horas" (singleton
 *  `camion_viajes_config`). Si falla o falta la tabla, usa el default (6h)
 *  para no bloquear la alerta por un problema de configuración. */
export async function getAlertaHoras(): Promise<number> {
  const { data, error } = await supabase.from('camion_viajes_config').select('alerta_horas_sin_viaje').eq('id', true).maybeSingle();
  if (error || !data) return DEFAULT_ALERTA_HORAS;
  const n = Number((data as any).alerta_horas_sin_viaje);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ALERTA_HORAS;
}

export async function setAlertaHoras(horas: number, userId: string): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('camion_viajes_config')
    .update({ alerta_horas_sin_viaje: horas, updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', true);
  if (error) return { error: error.message };
  return {};
}

/**
 * LOS LISTEROS a los que se le puede atribuir un viaje: perfiles cuyo rol
 * dinámico (`app_roles.modules`) o permiso por-usuario (`module_permissions`)
 * incluye `viajes_camiones`. Mismo criterio que `listLavadoWorkers` en
 * `src/lib/lavadoMaquinaria.ts` y `listOpSupervisors` en obras públicas.
 *
 * Hace falta para la carga manual de la jefa: cuando cuadra un día pasado tiene
 * que poder dejar el viaje a nombre del listero que de verdad estaba, no al
 * suyo. Si quedara siempre a su nombre, el resumen por listero diría que ella
 * contó viajes en el patio.
 */
/**
 * Una persona de la lista de listeros.
 *
 * `esListero` dice si tiene el ROL de listero. La lista trae además a quien entra al
 * módulo por un permiso sin tener ese rol, porque la carga a mano y «Lo registró»
 * los necesitan: un viaje que ya registró un almacenista tiene que seguir mostrando
 * a quién pertenece. «Listeros y su obra» filtra con este campo.
 */
export type ListeroConRol = { id: string; full_name: string; ubicacion_id: string | null; esListero: boolean };

export async function listListeros(): Promise<ListeroConRol[]> {
  const [rolesRes, permsRes] = await Promise.all([
    supabase.from('app_roles').select('id, modules'),
    supabase.from('module_permissions').select('user_id, level').eq('module', 'viajes_camiones').neq('level', 'none'),
  ]);
  if (rolesRes.error) throw rolesRes.error;
  if (permsRes.error) throw permsRes.error;
  const roleIds = (rolesRes.data ?? [])
    .filter((r: any) => r?.modules && r.modules['viajes_camiones'] && r.modules['viajes_camiones'] !== 'none')
    .map((r: any) => r.id as string);
  // Quién tiene el ROL de listero, con la misma regla que el menú. Ver rolListero.ts.
  const rolesListero = new Set(
    (rolesRes.data ?? []).filter((r: any) => esRolListero(r?.modules)).map((r: any) => r.id as string),
  );
  const permUserIds = (permsRes.data ?? []).map((p: any) => p.user_id as string);
  if (!roleIds.length && !permUserIds.length) return [];
  // Mismo respaldo que en los viajes: mientras el `.sql` de obras no se corra,
  // `profiles.ubicacion_id` no existe y pedirla dejaría a la jefa SIN LISTEROS
  // en el desplegable de carga manual, que es mucho peor que no saber su obra.
  const COLS_PERFIL = 'id, full_name, active, app_role_id';
  const perfiles = async (filtro: (q: any) => any) => {
    try {
      const r = await filtro(supabase.from('profiles').select(`${COLS_PERFIL}, ubicacion_id`));
      if (!r.error) return r;
      if (!esColumnaQueFalta(r.error)) return r;
    } catch { /* se reintenta abajo */ }
    return filtro(supabase.from('profiles').select(COLS_PERFIL));
  };
  const [byRole, byPerm] = await Promise.all([
    roleIds.length ? perfiles((q: any) => q.in('app_role_id', roleIds)) : Promise.resolve({ data: [] as any[], error: null }),
    permUserIds.length ? perfiles((q: any) => q.in('id', permUserIds)) : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  if (byRole.error) throw byRole.error;
  if (byPerm.error) throw byPerm.error;
  const seen = new Set<string>();
  const out: ListeroConRol[] = [];
  [...(byRole.data ?? []), ...(byPerm.data ?? [])].forEach((p: any) => {
    if (p.active === false || seen.has(p.id)) return;
    seen.add(p.id);
    out.push({
      id: p.id,
      full_name: p.full_name ?? '(sin nombre)',
      ubicacion_id: (p.ubicacion_id ?? null) as string | null,
      esListero: rolesListero.has(p.app_role_id),
    });
  });
  out.sort((a, b) => a.full_name.localeCompare(b.full_name, 'es', { sensitivity: 'base' }));
  return out;
}

/**
 * Pone (o quita) la OBRA de un listero. `null` = sin obra asignada.
 *
 * ⚠️ SOLO AFECTA A LOS VIAJES QUE VENGAN, nunca a los ya registrados: cada viaje
 *    se llevó su obra puesta al grabarse. Mover a alguien de obra no puede
 *    cambiar un reporte que ya se entregó.
 */
export async function asignarObraAListero(listeroId: string, ubicacionId: string | null): Promise<{ error?: string; falta?: boolean }> {
  const { error } = await supabase.from('profiles').update({ ubicacion_id: ubicacionId }).eq('id', listeroId);
  if (error) {
    // Se distingue «falta correr el SQL» de cualquier otro fallo: son dos avisos
    // muy distintos, y el primero lo resuelve el administrador en un minuto.
    if (esColumnaQueFalta(error)) return { error: error.message, falta: true };
    return { error: error.message };
  }
  return {};
}

/** Chofer PLANEADO del turno (tabla `machine_operators`, ya administrada por el
 *  Coordinador de Operadores — NO se modifica aquí, solo se lee, mismo patrón
 *  de `listOperatorAssignments` en `src/lib/machineOperators.ts`: nombre VIVO
 *  desde `employees` si hay `employee_id`, si no el `operator_name` congelado).
 *  `null` si no hay nadie asignado a esa máquina en ese turno (o si falla). */
export async function resolveChoferActual(machineryId: string, shift: 'day' | 'night'): Promise<string | null> {
  if (!machineryId) return null;
  const { data, error } = await supabase
    .from('machine_operators')
    .select('employee_id, operator_name')
    .eq('machinery_id', machineryId)
    .eq('shift', shift)
    .eq('active', true)
    .maybeSingle();
  // Se devuelve `null` en los dos casos —falla la consulta o no hay nadie
  // asignado— porque el viaje NO se puede bloquear por esto. Pero el fallo se
  // deja anotado: sin el aviso, un viaje guardado sin chofer por un problema de
  // red se ve idéntico a uno de un camión que de verdad no tiene chofer
  // asignado, y ese dato ya no se recupera (queda congelado en la fila).
  if (error) { console.warn('[camionViajes] no se pudo leer el chofer del turno:', error.message); return null; }
  if (!data) return null;
  const employeeId = (data as any).employee_id as string | null;
  const operatorName = (data as any).operator_name as string | null;
  if (employeeId) {
    const { data: emp } = await supabase.from('employees').select('first_name, last_name').eq('id', employeeId).maybeSingle();
    const nm = emp ? `${(emp as any).first_name ?? ''} ${(emp as any).last_name ?? ''}`.trim() : '';
    if (nm) return nm;
  }
  return operatorName ?? null;
}
