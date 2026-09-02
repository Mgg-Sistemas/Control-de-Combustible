import { jornadaDeFecha } from './caracasDay';
import { turnoDeViaje, TURNO_NOMBRE, type Turno } from './viajesTurno';

/**
 * EDICIÓN DE VIAJES POR LA JEFA (nivel `full` del módulo `viajes_camiones`).
 *
 * Pedido del cliente 31-ago-2026: «que el que tenga permiso full pueda modificar
 * cualquier información de cualquier camión para un día en específico, ya sea
 * hora de viaje, cantidad de viajes, tanto colocarle como quitarle, responsable
 * o chofer».
 *
 * Hasta ahora la pantalla solo dejaba:
 *   · BORRAR viajes de cualquier día (ya existía, en el panel de la jefa), y
 *   · corregir la HORA — pero NUNCA la fecha: `saveEdit` reusaba el día del
 *     viaje original, así que un viaje mal cargado se quedaba en su día para
 *     siempre.
 * Y no había ninguna forma de AGREGAR un viaje a un día pasado: el único botón
 * de registrar sella `new Date()`, la hora del toque.
 *
 * ⚠️ ESTE ARCHIVO NO TOCA LA BASE. Es solo el cálculo —fechas, avisos y
 *    validaciones— para poder probarlo sin Supabase (`scripts/test-viajes-edicion.mjs`).
 *    Lo que escribe es `./camionViajes`.
 *
 * ⚠️ Y NO TOCA LAS MÁQUINAS. Un viaje es una fila de `camion_viajes` y nada
 *    más: no mueve el estado del camión, ni su horómetro, ni sus jornadas.
 */

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Venezuela es UTC-4 TODO EL AÑO (no hay horario de verano), así que el desfase
 * se escribe fijo — igual que en el resto del módulo. Si algún día eso cambiara,
 * este es el único lugar del archivo donde está.
 */
const DESFASE_CARACAS = '-04:00';

export type HoraPartes = { hh: number; mm: number };

/**
 * Lo que se tecleó en las cajitas de hora, convertido a números válidos.
 *
 * Acota en vez de rechazar (`25` → 23, `99` → 59) por la misma razón que ya lo
 * hacía la pantalla: quien está corrigiendo un día entero no quiere pelear con
 * un formulario, y una hora acotada se ve al instante en la fila.
 */
export function normalizarHora(hhRaw: string | number, mmRaw: string | number): HoraPartes {
  const n = (v: string | number) => {
    const x = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
    return Number.isFinite(x) ? x : 0;
  };
  return {
    hh: Math.min(23, Math.max(0, n(hhRaw))),
    mm: Math.min(59, Math.max(0, n(mmRaw))),
  };
}

/** Un instante en hora de Caracas, a partir de una fecha DE CALENDARIO y una hora. */
export function isoDeFechaHora(fechaISO: string, hh: number, mm: number): string {
  return `${fechaISO}T${pad2(hh)}:${pad2(mm)}:00${DESFASE_CARACAS}`;
}

/** La jornada arranca a las 7am — mismo corte que todo el módulo (`caracasDay`). */
const HORA_CORTE_JORNADA = 7;

/** El día siguiente de una fecha `YYYY-MM-DD`, sin pasar por la zona local. */
function diaSiguiente(fechaISO: string): string {
  const [y, m, d] = fechaISO.split('-').map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * ⭐ EL DÍA QUE SE ELIGE EN LA PANTALLA ES UNA **JORNADA**, NO UNA FECHA DE
 *    CALENDARIO. Esta función es la que traduce lo uno a lo otro.
 *
 * En este negocio el día va de 7am a 7am (ver `jornadaDeFecha`), así que la
 * madrugada de la jornada del 20 cae en el CALENDARIO del 21. Armar el instante
 * pegando la hora a la fecha elegida —que es lo que hace `isoDeFechaHora`—
 * mandaba los viajes de madrugada a la jornada ANTERIOR a la que se pidió:
 *
 *     elegí "día 20" + 02:00  →  20 de calendario 02:00  →  jornada 19  ✗
 *     elegí "día 20" + 02:00  →  21 de calendario 02:00  →  jornada 20  ✓
 *
 * Y peor: sin esto, la madrugada de la jornada EN CURSO era imposible de
 * cargar, porque habría que elegir la fecha de calendario de mañana y el
 * selector no deja pasar de hoy.
 */
export function isoDeJornadaHora(jornadaISO: string, hh: number, mm: number): string {
  const calendario = hh < HORA_CORTE_JORNADA ? diaSiguiente(jornadaISO) : jornadaISO;
  return isoDeFechaHora(calendario, hh, mm);
}

/**
 * ¿Los dos instantes caen en el mismo MINUTO?
 *
 * ⚠️ NO se comparan las cadenas ni los milisegundos. Un viaje registrado en
 *    campo trae segundos y milisegundos (`new Date().toISOString()`), pero el
 *    formulario solo tiene horas y minutos: rearmarlo siempre da `:00`. Comparar
 *    los instantes pelados daba SIEMPRE "cambió", así que abrir «Editar» y darle
 *    Guardar sin tocar nada movía el viaje hasta 59 segundos hacia atrás y
 *    escribía una fila de auditoría por un cambio que nadie pidió.
 */
export function mismoMinuto(aISO: string, bISO: string): boolean {
  const min = (iso: string) => Math.floor(new Date(iso).getTime() / 60000);
  return min(aISO) === min(bISO);
}

/** Tope de viajes que se pueden cargar de un solo golpe. */
export const MAX_CARGA = 30;

/** Minutos entre un viaje y el siguiente cuando se cargan varios de una vez. */
export const SEPARACION_MIN = 5;

/**
 * Las horas de N viajes cargados de una sola vez.
 *
 * ⭐ NO SE APILAN TODOS EN EL MISMO MINUTO. Se separan `SEPARACION_MIN` minutos
 *    a partir de la hora indicada, por dos razones prácticas:
 *      · la lista se ordena por hora, y N filas idénticas no se pueden
 *        distinguir para corregirle la hora a UNA sola después;
 *      · un camión no hace dos viajes en el mismo instante, así que apilarlos
 *        sería un dato que se sabe falso.
 *    Las horas siguen siendo aproximadas —la jefa las puede corregir una por
 *    una— pero al menos son coherentes entre sí.
 *
 * Si la cuenta se pasa de la medianoche, los viajes SIGUEN de largo al día
 * siguiente del calendario. Es lo correcto: la jornada va de 7am a 7am, así que
 * un viaje de las 00:05 pertenece a la jornada del día ANTERIOR, que es justo
 * el día que se está cargando.
 *
 * `jornadaISO` es la JORNADA elegida, no la fecha de calendario — ver
 * `isoDeJornadaHora`.
 */
export function horariosDeCarga(
  jornadaISO: string,
  hh: number,
  mm: number,
  cantidad: number,
  gapMin: number = SEPARACION_MIN,
): string[] {
  const base = new Date(isoDeJornadaHora(jornadaISO, hh, mm)).getTime();
  const n = Math.max(0, Math.floor(cantidad));
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(new Date(base + i * gapMin * 60000).toISOString());
  return out;
}

/**
 * Las jornadas DISTINTAS que toca una tanda, en orden.
 *
 * ⚠️ Una tanda puede DESBORDARSE a la jornada siguiente sin que se note: empezar
 *    a las 6:50am y cargar cuatro deja dos en la jornada elegida y dos en la que
 *    arranca a las 7. No se prohíbe —a veces es exactamente lo que pasó— pero
 *    hay que decírselo a quien carga, o esos viajes aparecen en un día que no es
 *    el que eligió y parecen perdidos.
 */
export function jornadasDeCarga(horariosISO: string[]): string[] {
  const out: string[] = [];
  for (const iso of horariosISO) {
    const j = jornadaDeFecha(new Date(iso));
    if (!out.includes(j)) out.push(j);
  }
  return out;
}

/** El turno que le toca a un viaje según su hora, para guardarlo en `shift`. */
export function turnoParaGuardar(registeredAtISO: string): Turno {
  return turnoDeViaje(registeredAtISO);
}

/**
 * Los turnos DISTINTOS que toca una tanda, en orden. Hermano de
 * `jornadasDeCarga`, y hace falta por la misma razón: una tanda se puede
 * DESBORDAR de turno sin que se note.
 *
 * ⚠️ Empezar a las 6:50pm y cargar cuatro deja dos en el turno de DÍA y dos en
 *    el de NOCHE, aunque quien carga haya elegido «noche». Como el turno se
 *    deduce de la hora (ver la cabecera de `viajesTurno.ts`), esos viajes salen
 *    en el turno que dice su hora y no en el que se pidió: si no se avisa,
 *    parecen perdidos al filtrar por turno.
 */
export function turnosDeCarga(horariosISO: string[]): Turno[] {
  const out: Turno[] = [];
  for (const iso of horariosISO) {
    const t = turnoDeViaje(iso);
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * QUÉ HAY QUE AVISARLE A QUIEN EDITA, ANTES DE GUARDAR.
 *
 * ⚠️ Cambiar la hora de un viaje puede MUDARLO DE DÍA sin que nadie lo pida,
 *    porque el corte del negocio son las 7am y no la medianoche. Corregir un
 *    viaje de las 8am a las 5am lo manda a la jornada anterior: desaparece del
 *    día que se está mirando y aparece en otro. Sin este aviso no habría forma
 *    de entender por qué se esfumó.
 *
 * ⚠️ Y cruzar las 7pm NO cambia de jornada pero sí de TURNO. Si la jefa tiene
 *    marcado un turno en los filtros, el viaje se le desaparece igual.
 *
 * Devuelve la lista de avisos (vacía = no hay nada que preguntar). Antes esto
 * vivía suelto dentro de `saveEdit` en la pantalla, en dos `confirm` seguidos;
 * acá se puede probar y sirve igual para la edición de FECHA, que es nueva.
 */
export function avisosDeCambio(antesISO: string, despuesISO: string): string[] {
  const avisos: string[] = [];
  const jornadaAntes = jornadaDeFecha(new Date(antesISO));
  const jornadaDespues = jornadaDeFecha(new Date(despuesISO));
  if (jornadaAntes !== jornadaDespues) {
    avisos.push(`El viaje pasa de la jornada del ${jornadaAntes} a la del ${jornadaDespues}, así que va a salir en otro día.`);
  }
  const turnoAntes = turnoDeViaje(antesISO);
  const turnoDespues = turnoDeViaje(despuesISO);
  if (turnoAntes !== turnoDespues) {
    avisos.push(`El viaje pasa del turno de ${TURNO_NOMBRE[turnoAntes].toLowerCase()} al de ${TURNO_NOMBRE[turnoDespues].toLowerCase()}.`);
  }
  return avisos;
}

export type FormularioCarga = {
  /** `null` = no se eligió camión todavía. */
  machineryId: string | null;
  /** La JORNADA elegida (`YYYY-MM-DD`), no la fecha de calendario — ver `isoDeJornadaHora`. */
  fechaISO: string;
  hh: number;
  mm: number;
  cantidad: number;
};

/**
 * ¿Se puede guardar este formulario de carga manual?
 *
 * `hoyISO` es la JORNADA de hoy (no la fecha del calendario), y se recibe como
 * parámetro en vez de calcularlo adentro para que la prueba no dependa de qué
 * día se corra.
 *
 * Devuelve el motivo en palabras, o `null` si está todo bien.
 */
export function validarCargaManual(f: FormularioCarga, hoyISO: string): string | null {
  if (!f.machineryId) return 'Elige primero el camión.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.fechaISO || '')) return 'Elige la fecha del viaje.';
  // ⭐ NO SE CARGAN VIAJES A FUTURO. Esta pantalla es para corregir lo que ya
  //    pasó; un viaje con fecha de mañana se cuenta en los reportes como
  //    trabajo hecho, y no lo es.
  if (f.fechaISO > hoyISO) return 'Esa fecha todavía no llega. Solo se pueden cargar viajes de hoy o de días pasados.';
  const n = Math.floor(f.cantidad);
  if (!Number.isFinite(n) || n < 1) return 'La cantidad tiene que ser 1 o más.';
  if (n > MAX_CARGA) return `Son demasiados de una vez (máximo ${MAX_CARGA}). Cárgalos en varias tandas.`;
  return null;
}

/**
 * La marca que queda en el viaje para que NO se confunda con uno registrado en
 * campo. Va en la columna `note`, que hasta ahora siempre iba en null.
 *
 * Sin esto, un viaje cargado a mano tres días después es indistinguible de uno
 * que un listero tocó en el patio, y el reporte deja de poder responder «¿esto
 * lo contó alguien, o lo cuadró la oficina?».
 */
export const MARCA_CARGA_MANUAL = 'Cargado a mano';

export function notaCargaManual(nombre: string): string {
  const quien = (nombre || '').trim();
  return quien ? `${MARCA_CARGA_MANUAL} por ${quien}` : MARCA_CARGA_MANUAL;
}

export function esCargaManual(note: string | null | undefined): boolean {
  return String(note ?? '').startsWith(MARCA_CARGA_MANUAL);
}

// ============================================================================
// LA CLAVE QUE IMPIDE EL VIAJE DUPLICADO (02-sep-2026)
//
// `client_action_id` tiene un índice ÚNICO en la base: dos filas con la misma
// clave no pueden existir, y el segundo insert rebota con un 23505 que la app ya
// sabe leer como «ese viaje ya estaba, no pasa nada».
//
// EL PROBLEMA ERA DE DÓNDE SALÍA LA CLAVE. `nuevoClientActionId()` la arma con
// `Date.now()` + azar, o sea NUEVA EN CADA TOQUE. Así el candado solo servía
// para los reintentos automáticos del propio código (que reusan la clave), y no
// para lo que de verdad pasa en el patio:
//
//   · el listero toca dos veces porque «no pasó nada» → dos claves distintas,
//     no chocan, quedan DOS viajes de verdad y nadie avisa;
//   · la carga a mano de la jefa falla a la mitad, ella vuelve a cargar la misma
//     tanda → claves nuevas para todos, y los que ya habían entrado se repiten.
//
// La clave estable se arma con la INTENCIÓN, no con el reloj: qué camión, quién
// lo registra y de qué minuto es el viaje. Dos toques del mismo listero, sobre
// el mismo camión, dentro del mismo minuto, son EL MISMO VIAJE — y la base lo
// hace cumplir aunque el segundo toque venga de otro teléfono.
//
// Es texto legible a propósito (la columna es `text`, sin límite): cuando haya
// que revisar un duplicado en la base, se lee qué pasó sin descifrar un hash.
// ============================================================================

/**
 * Normaliza el código del camión para la clave: sin acentos que dependan del
 * teclado, sin espacios de más, en mayúsculas. La Ñ se preserva (es parte del
 * código, no un acento) — mismo criterio que `claveCamion` en `viajesResumen`.
 */
function codigoParaClave(code: string): string {
  // Deliberadamente SIMPLE: sin `String.normalize` (no todos los motores de
  // React Native lo traen) y sin bytes de control de por medio. El codigo no lo
  // teclea nadie aca: sale del catalogo (`selectedTruck.code`) tanto en el toque
  // del listero como en la carga a mano, asi que ya viene identico byte a byte.
  // Mayusculas y espacios colapsados alcanzan, y no arrastran ninguna
  // dependencia fragil a una clave que la base va a hacer cumplir para siempre.
  return String(code ?? '').toUpperCase().trim().replace(/\s+/g, ' ');
}

/**
 * La clave de idempotencia de UN viaje, derivada de la intención.
 *
 * Sirve igual para el toque del listero en el patio y para cada renglón de una
 * tanda cargada a mano: en la tanda los horarios van de 5 en 5 minutos, así que
 * cada viaje cae en un minuto distinto y su clave es distinta — pero volver a
 * cargar LA MISMA tanda regenera LAS MISMAS claves, y la base rechaza sola los
 * que ya habían entrado.
 *
 * Devuelve cadena vacía si le falta algo esencial: quien llama debe caer
 * entonces en `nuevoClientActionId()`, porque una clave a medias podría chocar
 * con la de otro viaje legítimo y hacerlo desaparecer en silencio — que sería
 * mucho peor que el duplicado que estamos evitando.
 */
export function claveViajeEstable(p: {
  /**
   * ⚠️⚠️ LA IDENTIDAD DEL CAMIÓN, **NO** SU CÓDIGO. Y no es una sutileza: es la
   *      diferencia entre evitar un duplicado y BORRAR UN VIAJE REAL.
   *
   *      En esta flota casi todos los camiones se llaman igual («Camion Volteo
   *      Toronto» y parecidos) — por eso el resto del módulo arrastra la placa a
   *      todas partes. Si acá entrara el código pelado, dos camiones DISTINTOS
   *      del mismo listero en el mismo minuto darían LA MISMA clave, la base
   *      rechazaría el segundo por el índice único, y ese viaje —que ocurrió de
   *      verdad— desaparecería sin que nadie viera un error. En una tanda
   *      cargada a mano el estropicio es mayor: la tanda entera del segundo
   *      camión rebota.
   *
   *      Manda algo ÚNICO por camión: el `id` del catálogo. Para los de fuera de
   *      catálogo, que no tienen `id`, el texto que se tecleó ya distingue.
   */
  identidadCamion: string;
  listeroId: string;
  registeredAtISO: string;
}): string {
  const code = codigoParaClave(p.identidadCamion);
  const listero = String(p.listeroId ?? '').trim();
  // Al MINUTO: el segundo y los milisegundos son ruido del reloj, no intención.
  const minuto = String(p.registeredAtISO ?? '').trim().slice(0, 16); // AAAA-MM-DDTHH:MM
  if (!code || !listero || minuto.length !== 16) return '';
  return `v1|${code}|${listero}|${minuto}`;
}

// ============================================================================
// EDITAR UN VIAJE FUERA DE SU JORNADA (02-sep-2026)
//
// Antes: pasadas las 7am no se podía tocar ni un viaje de la noche que acababa
// de terminar. La corrección de la madrugada se hace POR LA MAÑANA — la regla
// llegaba tarde justo cuando más falta hacía.
//
// Ahora: quien tiene acceso FULL puede corregir cualquier día. Pero eso no puede
// ser invisible, así que la edición excepcional DEJA RASTRO.
//
// ⚠️ SOLO LA EXCEPCIONAL. Las ediciones del día corriente no generan nada: para
//    eso ya está el trigger `trg_audit` de `camion_viajes`, que registra insert,
//    update y delete solo. Escribir además desde la app sería duplicar el rastro
//    y llenar la bitácora de ruido — pedido explícito del cliente: «que no se
//    dañe ni abuse el módulo de auditoría, y que no se tumbe ni consuma en
//    exceso». Por eso acá se decide, con una función pura y probada, CUÁNDO vale
//    la pena escribir una fila.
// ============================================================================

/** ¿Este viaje cae fuera de la jornada que está corriendo ahora? */
export function fueraDeJornada(
  registeredAtISO: string,
  ventana: { startMs: number; endMs: number },
): boolean {
  const t = Date.parse(String(registeredAtISO ?? ''));
  if (!isFinite(t)) return false;   // sin fecha legible no se acusa a nadie
  return t < ventana.startMs || t >= ventana.endMs;
}

/**
 * ¿Hay que dejar rastro en Auditoría por esta edición?
 *
 * Las tres condiciones, y las tres importan:
 *  1. el viaje es de otra jornada (si es de hoy, el trigger ya lo cubre),
 *  2. de verdad cambió algo (abrir y cerrar el editor no ensucia la bitácora),
 *  3. y hubo quien la hiciera.
 */
export function requiereRastroDeEdicion(p: {
  registeredAtAntesISO: string;
  registeredAtDespuesISO: string;
  ventana: { startMs: number; endMs: number };
  huboCambios: boolean;
}): boolean {
  if (!p.huboCambios) return false;
  // Fuera de jornada por donde ESTABA o por donde QUEDA: mover un viaje de hoy
  // hacia el mes pasado es exactamente el movimiento que hay que poder rastrear.
  return fueraDeJornada(p.registeredAtAntesISO, p.ventana)
      || fueraDeJornada(p.registeredAtDespuesISO, p.ventana);
}

/** La acción con la que sale en Auditoría. Propia, para poder filtrarla de un
 *  vistazo entre miles de filas. */
export const ACCION_EDIT_FUERA_JORNADA = 'EDIT_VIAJE_FUERA_JORNADA';

/**
 * ⭐ LA DECISIÓN Y EL TEXTO, EN UNA SOLA RESPUESTA: o hay rastro que escribir, o
 *    no hay nada. `null` significa «no escribas nada en Auditoría».
 *
 * Por qué existe teniendo ya `requiereRastroDeEdicion` y `detalleRastroEdicion`
 * por separado: porque cuando la pantalla decide por un lado y arma el texto por
 * otro, la única forma de comprobar que no audita de más es leer el código con
 * una expresión regular — y eso es exactamente lo que se rompe cuando alguien
 * refactoriza bien y deja pasar cuando alguien refactoriza mal (probado: sacar
 * el `logAudit` fuera del `if` no lo agarraba ninguna guardia de texto).
 *
 * Con esto la regla se prueba POR COMPORTAMIENTO: si la función devuelve `null`,
 * no hay nada que escribir. La pantalla se limita a obedecer, y una sola guardia
 * corta —que el `logAudit` salga de acá— alcanza.
 */
export function rastroDeEdicion(p: {
  registeredAtAntesISO: string;
  registeredAtDespuesISO: string;
  ventana: { startMs: number; endMs: number };
  huboCambios: boolean;
  machineCode: string;
  placa?: string | null;
  cambios?: string[] | null;
}): { accion: string; detalle: string } | null {
  if (!requiereRastroDeEdicion({
    registeredAtAntesISO: p.registeredAtAntesISO,
    registeredAtDespuesISO: p.registeredAtDespuesISO,
    ventana: p.ventana,
    huboCambios: p.huboCambios,
  })) return null;
  return {
    accion: ACCION_EDIT_FUERA_JORNADA,
    detalle: detalleRastroEdicion({
      machineCode: p.machineCode,
      placa: p.placa,
      antesISO: p.registeredAtAntesISO,
      despuesISO: p.registeredAtDespuesISO,
      cambios: p.cambios,
    }),
  };
}

/**
 * El texto que se lee en Auditoría. Tiene que bastarse solo: quien lo lee no va
 * a ir a cruzarlo con otra tabla.
 */
export function detalleRastroEdicion(p: {
  machineCode: string;
  /**
   * ⚠️ LA PLACA NO ES UN ADORNO: sin ella el rastro NO IDENTIFICA AL CAMIÓN.
   *
   *    En esta flota casi todos se llaman igual («Camion Volteo Toronto»), así
   *    que una fila que dijera solo el código deja a quien la lee sin saber cuál
   *    de los treinta fue — y el cliente pidió esto precisamente para «poder
   *    identificar fácilmente esos cambios». Es la misma trampa que obligó a que
   *    la clave de idempotencia use la identidad y no el nombre; acá se coló por
   *    la puerta de al lado. El resto del módulo ya arrastra la placa por esto.
   */
  placa?: string | null;
  antesISO: string;
  despuesISO: string;
  cambios?: string[] | null;
}): string {
  const soloCode = codigoParaClave(p.machineCode) || '(sin código)';
  const placa = String(p.placa ?? '').trim();
  const code = placa ? `${soloCode} · ${placa}` : soloCode;
  const a = String(p.antesISO ?? '').slice(0, 16).replace('T', ' ');
  const b = String(p.despuesISO ?? '').slice(0, 16).replace('T', ' ');
  const movio = a && b && a !== b ? `${a} → ${b}` : (a || b || 'sin fecha');
  const extra = (p.cambios ?? []).filter(Boolean);
  return `🚚 ${code} · ${movio}${extra.length ? ` · ${extra.join(', ')}` : ''}`;
}
