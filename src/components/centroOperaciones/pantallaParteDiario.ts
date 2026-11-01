// 🏭 CENTRO DE OPERACIONES — 📅 PARTE DIARIO: LAS REGLAS DE LA PANTALLA (revisión final F2b, 25-oct-2026).
//
// Lo que CentroOperacionesScreen y los bloques del Parte diario deciden, sin React ni la
// base (se prueba solo en scripts/test-centro-operaciones-pantallas.mjs):
//   · B-I1/B-M7 QUÉ QUEDÓ SIN GUARDAR: los bloques con algo escrito y sin guardar, en el
//     orden de su hoja, y la pregunta antes de salir del Parte diario (otra pestaña u otro
//     sitio desmontan la pestaña: lo escrito se pierde). No se deja montada y escondida
//     (lote 5: rompía el refresco al volver de ⚙️ Ajustes): se pregunta.
//   · B-I4 LA JORNADA QUE SIGUE A HOY: si ella estaba «en hoy» y cambió el día (la pantalla
//     quedó abierta, o la app en segundo plano), pasa sola al nuevo hoy. Una fecha elegida a
//     propósito se respeta; y con algo sin guardar NO se muda (lo escrito caería en otro
//     día): se queda y lo dice.
//   · B-M5 A QUIÉN PEDÍRSELO: los avisos que mandan a ⚙️ Ajustes o a cambiar la 🚛 Flota le
//     dicen a quien no tiene Full que lo pida (esa pestaña no le aparece, o no lo deja).
//
//   · 🚜 LO QUE PINTA LA MAQUINARIA (mesa de maquinaria, M4, 26-oct-2026; lote 6 F3): las
//     líneas de cada fila (lo que manda, la línea 🔎, la nota), el editor (nota o marca nueva,
//     con `modoAlTocar`; a ciegas si no se leyó; «no coincide» al decidir), la REFERENCIA DE LA
//     GUARDIA (hasta cuándo ella ya vio lo de inspección), el diálogo de soltar la marca, la hora
//     de la lectura, el «cambió el turno» y el 🔧 del selector de unidad de las salidas. LA REGLA
//     no vive acá: es `estadoDelSitio` (src/lib/centroOperacionesMaquinariaBloques.ts), y qué se
//     le pregunta a inspección tampoco (`vinculadasParaInspeccion`, misma librería); esto solo lo dice.
//
// Vive junto a los componentes (no en src/lib) porque solo lo usa esta pantalla; el
// candado de aislamiento revisa igual todo lo que hay en esta carpeta.
import { fechaValida, momentoCaracas } from '../../lib/centroOperaciones';
import type { EstadoUnidad, MotivoGuardia, Unidad } from '../../lib/centroOperaciones';
import { dmy } from '../../lib/centroOperacionesCarga';
import { MARCA_INFO, estadoDelSitio, modoAlTocar, textoDesde } from '../../lib/centroOperacionesMaquinariaBloques';
import type { EdicionEstado, EstadoDelSitio, FilaDelSitio, GrupoSitio } from '../../lib/centroOperacionesMaquinariaBloques';
import { levelMeets } from '../../lib/permissions';
import type { PermLevel } from '../../lib/permissions';

// ═══════════════════════════ B-I1 / B-M7 · Lo que quedó sin guardar ═══════════════════════════

/** Los bloques del Parte diario que pueden quedar con algo escrito y sin guardar. */
export type ClaveSinGuardar = 'reporte' | 'patios' | 'agregados' | 'acero' | 'aluminio' | 'maquinaria' | 'bloques';

/** Cómo se llama cada bloque: los MISMOS títulos de ParteDiarioTab (la prueba lo vigila). */
export const ETIQUETAS_SIN_GUARDAR: Record<ClaveSinGuardar, string> = {
  reporte: '1 · 📊 Reporte General',
  patios: '2 · 🚪 Entrada por patio',
  agregados: '3 · 🚚 Salidas de agregados',
  acero: '4 · 🔩 Acero',
  aluminio: '5 · ♻️ Aluminio y plástico',
  maquinaria: '6 · 🚜 Maquinaria',
  bloques: '7 · 🧱 Bloques',
};

/** El orden de la hoja. */
const ORDEN: ClaveSinGuardar[] = ['reporte', 'patios', 'agregados', 'acero', 'aluminio', 'maquinaria', 'bloques'];

/** Los bloques marcados «sin guardar», en el orden de la hoja (no en el que se marcaron). */
export function bloquesSinGuardar(sucios: Partial<Record<ClaveSinGuardar, boolean>> | null | undefined): ClaveSinGuardar[] {
  return ORDEN.filter((k) => !!sucios?.[k]);
}

/** La pregunta antes de salir del Parte diario: qué bloques tienen algo sin guardar. */
export function textoSalirSinGuardar(claves: ClaveSinGuardar[]): string {
  const nombres = (claves ?? []).map((k) => ETIQUETAS_SIN_GUARDAR[k]).filter(Boolean);
  return `En el 📅 Parte diario quedó algo escrito sin guardar${nombres.length ? `: ${nombres.join(', ')}` : ''}. `
    + 'Si sales ahora, se pierde. ¿Descartarlo?';
}

/**
 * Los patios escritos y sin guardar en OTRA jornada que la que se ve (lo tecleado se guarda
 * por jornada: no se ve, pero también se pierde al salir). En orden de fecha.
 */
export function jornadasConPatiosEscritos(editados: Record<string, Record<string, string>> | null | undefined, fecha: string): string[] {
  return Object.entries(editados ?? {})
    .filter(([f, porPatio]) => f !== fecha && !!porPatio && Object.keys(porPatio).length > 0)
    .map(([f]) => f)
    .sort();
}

// ═══════════════════════════ B-I4 · La jornada que sigue a hoy ═══════════════════════════

export type DecisionJornada =
  | { accion: 'nada' }
  /** Pasa a `fecha` (hoy) y lo dice. */
  | { accion: 'pasar'; fecha: string; aviso: string }
  /** Se queda en la suya (hay algo sin guardar) y lo dice: desde ahora es una fecha elegida. */
  | { accion: 'quedarse'; aviso: string };

/**
 * Al volver a la pantalla (o al pasar el tiempo): ¿la jornada del Parte diario pasa sola a hoy?
 *   · `enHoy` = la fecha era la de hoy cuando se puso (no la eligió a propósito).
 *   · Una jornada FUTURA nunca se queda (el reloj del equipo se atrasó: B7): pasa a hoy.
 *   · Con algo sin guardar, NO se muda: lo escrito se anotaría en otro día sin que lo note.
 */
export function jornadaAlVolver(p: { fecha: string; enHoy: boolean; hoy: string; sinGuardar: boolean }): DecisionJornada {
  const { fecha, enHoy, hoy, sinGuardar } = p;
  if (!fechaValida(hoy) || fecha === hoy) return { accion: 'nada' };
  const futura = fechaValida(fecha) && fecha > hoy;
  if (!futura && !enHoy) return { accion: 'nada' };
  if (!futura && sinGuardar) {
    return {
      accion: 'quedarse',
      aviso: `Empezó la jornada del ${dmy(hoy)}. El 📅 Parte diario sigue en la del ${dmy(fecha)} porque quedó algo escrito sin guardar `
        + '(se anota en esa jornada); al terminar, toca «↩ Volver a hoy».',
    };
  }
  return { accion: 'pasar', fecha: hoy, aviso: `Empezó la jornada del ${dmy(hoy)}: el 📅 Parte diario pasó a hoy.` };
}

// ═══════════════════════════ B-M5 · A quién pedírselo ═══════════════════════════

/** Para agregar después de un aviso que manda a ⚙️ Ajustes o a cambiar la 🚛 Flota (solo Full puede). */
export function pideloAQuienAdministra(nivel: PermLevel): string {
  return levelMeets(nivel, 'full') ? '' : ' Pídeselo a quien administra el módulo.';
}

// ═══════════════════════════ 🚜 Maquinaria: lo que pinta el bloque ═══════════════════════════

// Qué se le pregunta a inspección (`vinculadasParaInspeccion`) vive en la librería pura, junto a la
// regla: UNA definición para la pantalla y el papel (lote 6, A5/B15).

/** Cómo va la lectura de inspección en la pantalla. */
export type LecturaInspeccion = 'sin_vinculadas' | 'cargando' | 'ok' | 'error';

/** Cuánto espera el bloque 🚜 a la lectura de inspección antes de darla por fallida (lote 6, R1):
 *  el cliente de Supabase no tiene tiempo máximo y, con mala señal, «Leyendo…» duraría minutos. */
export const TOPE_LECTURA_BLOQUE_MS = 15000;

/** Hasta cuándo se puede reutilizar la última lectura BUENA de inspección sin volver a leer (lote
 *  6, B10): al volver a la pantalla la flota se recarga y el bloque leería inspección dos veces. */
export const FRESCURA_LECTURA_MS = 10000;

/**
 * ⭐ LA REFERENCIA DE LA GUARDIA (D2, lote 6 B1): hasta cuándo ella YA VIO lo de inspección de esa
 * máquina. Es la MÁS NUEVA de: la lectura vigente (`insp.leidaAt`), la última lectura buena
 * (aunque la relectura de ahora haya fallado), el último hecho que la guardia ya le mostró
 * (`vistoHasta`, la hora del HECHO: con el reloj del equipo atrasado no se traba otra vez por lo
 * mismo) y su marca anterior (`u.estadoAt`, si tiene marca y nunca se leyó). Con eso la guardia
 * corre también sin lectura, nunca pisa en silencio un hecho que no vio y frena como mucho una
 * vez por hecho. Sin ninguna (vinculada sin marca que nunca se leyó) → null: no hay hecho «que
 * no vio»; se marca a ciegas y el editor lo dice (B2).
 */
export function referenciaDeGuardia(
  u: Pick<Unidad, 'estadoAt' | 'estado'> | null | undefined,
  insp: { leidaAt: string } | null | undefined,
  ultimaLeidaBuena: string | null | undefined,
  vistoHasta: string | null | undefined,
): { leidaAt: string; motivo: MotivoGuardia } | null {
  const candidatos: { ms: number; motivo: MotivoGuardia }[] = [];
  const poner = (iso: string | null | undefined, motivo: MotivoGuardia) => {
    const ms = msDe(iso);
    if (Number.isFinite(ms)) candidatos.push({ ms, motivo });
  };
  poner(insp?.leidaAt, 'pantalla');
  poner(ultimaLeidaBuena, 'pantalla');
  poner(vistoHasta, 'visto');
  if (u && (u.estado === 'disponible' || u.estado === 'averiada')) poner(u.estadoAt, 'marca');
  if (candidatos.length === 0) return null;
  // La más nueva; a igual hora gana la primera anotada (la pantalla antes que lo visto o la marca).
  const mejor = candidatos.reduce((a, b) => (b.ms > a.ms ? b : a));
  return { leidaAt: new Date(mejor.ms).toISOString(), motivo: mejor.motivo };
}

/** «hoy 06:10 a. m.» o «el 20/10 06:10 a. m.» ('' sin fecha). */
function cuandoFue(ms: number | null | undefined, ahoraMs: number): string {
  const m = momentoCaracas(typeof ms === 'number' ? ms : null);
  if (!m) return '';
  const hoy = momentoCaracas(ahoraMs);
  return hoy && hoy.dia === m.dia ? `hoy ${m.hora}` : `el ${m.diaMes} ${m.hora}`;
}

const limpia = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();
const msDe = (iso: string | null | undefined): number => {
  const t = Date.parse(String(iso ?? '').trim());
  return Number.isFinite(t) ? t : NaN;
};

type DichoInspeccion = NonNullable<EstadoDelSitio['inspeccion']>;

/** El motivo y el «desde» de una avería o parada de inspección: «, desde hoy 08:38 a. m. — falla». */
function motivoYDesde(insp: DichoInspeccion, ahoraMs: number): string {
  const desde = cuandoFue(insp.desdeMs, ahoraMs);
  const motivo = limpia(insp.motivo);
  return `${desde ? `, desde ${desde}` : ''}${motivo ? ` — ${motivo}` : ''}`;
}

/** La pista en vivo de una Operativa, sin horas: « · 🟢 trabajando ahora» / « · trabajó hoy». */
function enVivoDe(insp: DichoInspeccion, sinJornada: string): string {
  return insp.enVivo === 'trabajando' ? ' · 🟢 trabajando ahora' : insp.enVivo === 'trabajo_hoy' ? ' · trabajó hoy' : sinJornada;
}

/** Lo que dice inspección de una máquina, en una línea: «🔴 Averiada, desde hoy 08:38 a. m. — falla
 *  hidráulica» / «✅ Operativa · 🟢 trabajando ahora» / «⏳ Esperando instrucciones». Sin horas
 *  trabajadas ni nombres de inspectores. */
function dichoDeInspeccion(insp: DichoInspeccion, ahoraMs: number): string {
  const base = `${insp.icono ? `${insp.icono} ` : ''}${insp.etiqueta ?? 'Sin dato'}`;
  if (insp.estado === 'averiada' || insp.estado === 'parada') return `${base}${motivoYDesde(insp, ahoraMs)}`;
  if (insp.estado === 'operativa') return `${base}${enVivoDe(insp, ' · sin jornada hoy')}`;
  return base;
}

/** Las líneas de UNA fila del bloque 🚜 (texto plano; la pantalla solo las pinta). */
export type LineasDeFila = {
  /** «📚 catálogo» (vinculada) o «✍️ solo del sitio». */
  origen: string;
  /** Lo que MANDA, con su fuente: «🔧 Averiada · la marcó el sitio hoy 06:10 a. m.», «🔴 Averiada ·
   *  según inspección, desde…», «✅ Disponible · desde el 22/10/2026, …», «❔ Sin dato…». */
  estado: string;
  /** La línea 🔎 cuando manda la marca del sitio en una vinculada (para comparar), o el aviso de
   *  que ya no está en el catálogo. null si no hace falta. */
  inspeccion: string | null;
  /** «↪️ Tu marca … quedó atrás: …» / «🏭 Tu marca … está en pausa…» (de la regla). */
  aviso: string | null;
  /** La nota de la marca que MANDA (la de una marca que quedó atrás o en pausa no sale). */
  nota: string | null;
  /** Por qué no se le puede poner ✅/🔧 (lo maneja la oficina). */
  porQueNo: string | null;
};

/**
 * ⭐ Las líneas de una fila, de lo que decidió `estadoDelSitio` (nunca de `u.estado`). Nunca dice
 * «Disponible» ni «Operativa» de una vinculada que no se pudo leer: «❔ Sin dato» (o «cargando…»).
 */
export function lineasDeFila(fila: FilaDelSitio, ahoraMs: number, lectura: LecturaInspeccion): LineasDeFila {
  const u = fila.unidad;
  const e = fila.estado;
  const sinLeer = lectura === 'cargando' ? '🔎 Inspección: cargando…' : '❔ Sin dato · no se pudo leer inspección';
  let estado: string;
  let inspeccion: string | null = null;
  if (e.encendida) {
    const m = MARCA_INFO[e.encendida];
    if (!e.vinculada) {
      const desde = textoDesde(u.estadoAt);
      estado = `${m.icono} ${m.etiqueta}${desde ? ` · ${desde}` : ''}`;
    } else {
      const c = cuandoFue(msDe(u.estadoAt), ahoraMs);
      estado = `${m.icono} ${m.etiqueta} · la marcó el sitio${c ? ` ${c}` : ''}`;
      if (e.fueraDelCatalogo) inspeccion = '⚠️ Ya no está en el catálogo del sistema: manda tu marca.';
      else if (!e.inspeccion) {
        inspeccion = lectura === 'cargando' ? '🔎 Inspección: cargando…' : '🔎 Inspección: no se pudo leer · tu marca, sin verificar';
      } else {
        inspeccion = `🔎 Inspección: ${dichoDeInspeccion(e.inspeccion, ahoraMs)}${e.sinVerificar ? ' · tu marca no tiene hora: sin verificar' : ''}`;
      }
    }
  } else if (!e.vinculada) {
    estado = '❔ Sin dato'; // una del sitio siempre tiene marca (la base lo exige): no se inventa.
  } else if (e.fueraDelCatalogo) {
    estado = '❔ Sin dato';
    inspeccion = '⚠️ Ya no está en el catálogo del sistema.';
  } else if (!e.inspeccion || !e.inspeccion.encontrada) {
    estado = sinLeer;
  } else {
    const i = e.inspeccion;
    if (e.grupo === 'disponible') {
      const extra = i.estado === 'parada' ? ` · 🟡 parada${motivoYDesde(i, ahoraMs).replace(/^,/, '')}` : enVivoDe(i, '');
      estado = `✅ Disponible · según inspección${extra}`;
    } else if (e.grupo === 'averiada') {
      estado = `${i.icono ? `${i.icono} ` : ''}${i.etiqueta ?? 'Averiada'} · según inspección${motivoYDesde(i, ahoraMs)}`;
    } else if (e.grupo === 'oficina') {
      estado = `${dichoDeInspeccion(i, ahoraMs)} — lo maneja la oficina (Control de Maquinaria)`;
    } else {
      estado = sinLeer;
    }
  }
  return {
    origen: e.vinculada ? '📚 catálogo' : '✍️ solo del sitio',
    estado,
    inspeccion,
    aviso: e.avisoMarca,
    nota: e.encendida ? limpia(u.estadoNota) || null : null,
    porQueNo: e.puedeMarcar ? null : e.porQueNo,
  };
}

/** Lo que se abre al tocar ✅ / 🔧: si edita la nota o pone una marca nueva, cómo se titula, qué
 *  avisa y con qué nota empieza. `modo` null = no se puede (las pastillas van apagadas). */
export type EditorMarca = { modo: 'nota' | 'marca' | null; titulo: string; aviso: string | null; nota: string };

/**
 * ⭐ El editor de una fila (reserva del Analista 3): lo decide `modoAlTocar` por la marca VIGENTE.
 *   · 'nota': la misma pastilla con la marca vigente → solo la nota (no mueve su hora);
 *   · 'marca': otra pastilla, una vinculada sin marca, o la misma con la marca que quedó atrás
 *     (o sin verificar) → una marca NUEVA, que vale desde ahora; si es la misma pastilla, trae la
 *     nota vieja como sugerencia.
 */
export function editorDeMarca(fila: FilaDelSitio, estado: EstadoUnidad, soloNota = false): EditorMarca {
  const e = fila.estado;
  const codigo = limpia(fila.unidad.codigo) || 'la unidad';
  const m = MARCA_INFO[estado];
  const modo = modoAlTocar(e, estado, soloNota);
  const notaGuardada = String(fila.unidad.estadoNota ?? '');
  if (modo === 'nota') {
    return { modo, titulo: `📝 Nota de ${codigo}`, aviso: 'Solo cambia la nota: la marca sigue con su misma hora.', nota: notaGuardada };
  }
  // «📝 nota» abierto y, con una relectura, la marca dejó de mandar (quedó atrás o la oficina la tiene): el
  // enlace NUNCA se convierte en una marca nueva. Se cierra y, si hace falta, se vuelve a marcar.
  if (soloNota) {
    return { modo: null, titulo: `📝 Nota de ${codigo}`, aviso: 'Tu marca ya no manda (inspección registró algo nuevo, o la oficina la tiene): cierra y, si hace falta, vuelve a marcarla.', nota: notaGuardada };
  }
  if (modo === 'marca') {
    const misma = e.marca === estado;
    let aviso: string | null = null;
    if (misma && e.marcaEstado === 'superada') aviso = 'Tu marca anterior quedó atrás: esto la vuelve a poner desde ahora.';
    else if (misma && e.sinVerificar) aviso = 'No se pudo comparar con inspección: esto la vuelve a poner desde ahora.';
    // B2: una vinculada sin leer se marca A CIEGAS (puede tener una avería de ayer): que lo sepa al decidir.
    else if (e.vinculada && !e.inspeccion && !e.fueraDelCatalogo) aviso = 'No se pudo leer inspección: marcas sin saber lo que dice. Vale desde ahora; cuando se lea, si no coincide, lo verás con ⚠️.';
    else if (e.vinculada) aviso = 'Vale desde ahora y hasta que inspección registre algo nuevo de esta máquina.';
    // B11 (§10.1): si lo que va a marcar no coincide con inspección, que avise: el resto del sistema no se entera.
    const dice = noCoincidiria(e, estado);
    if (dice) aviso = `${aviso ? `${aviso} ` : ''}Inspección la tiene ${dice}: esto no le llega; avísales con 📲.`;
    return { modo, titulo: `Marcar ${codigo} como ${m.icono} ${m.etiqueta}`, aviso, nota: misma ? notaGuardada : '' };
  }
  return { modo: null, titulo: `${codigo}: ${m.icono} ${m.etiqueta}`, aviso: e.porQueNo, nota: '' };
}

/**
 * B11: ¿la marca `estado` NO coincidiría con lo que dice inspección? La MISMA regla del ⚠️ de la
 * fila (el grupo de la marca contra `grupoInspeccion`), solo con inspección leída y en una
 * vinculada del catálogo. Devuelve lo que dice inspección («✅ Operativa») o null si coincide o no
 * hay con qué comparar.
 */
export function noCoincidiria(e: EstadoDelSitio, estado: EstadoUnidad): string | null {
  if (!e?.vinculada || e.fueraDelCatalogo || !e.inspeccion || !e.grupoInspeccion) return null;
  if (e.grupoInspeccion !== 'disponible' && e.grupoInspeccion !== 'averiada') return null;
  if (e.grupoInspeccion === estado) return null;
  const i = e.inspeccion;
  return `${i.icono ? `${i.icono} ` : ''}${i.etiqueta ?? 'otra cosa'}`;
}

/** El toast al guardar una marca (B11): «UNI-03: 🔧 Averiada.» o, si no coincide con inspección,
 *  «UNI-03: 🔧 Averiada · no coincide con inspección: toca 📲 Avisar a inspección.». */
export function textoExitoMarca(fila: FilaDelSitio, estado: EstadoUnidad): string {
  const codigo = limpia(fila.unidad.codigo) || 'La unidad';
  const m = MARCA_INFO[estado];
  const base = `${codigo}: ${m.icono} ${m.etiqueta}`;
  return noCoincidiria(fila.estado, estado) ? `${base} · no coincide con inspección: toca 📲 Avisar a inspección.` : `${base}.`;
}

/** Lo que se le dice al soltar una marca (B5, B8): el texto del enlace y el diálogo. */
export type DialogoSoltar = { enlace: string; titulo: string; mensaje: string; confirmar: string };

/**
 * ⭐ «↩️ Que mande inspección» según cómo esté la marca (P1: siempre que haya marca en una vinculada):
 *   · SUPERADA (otra jornada, sin la línea «quedó atrás»): ya manda inspección, así que no se
 *     promete nada: «Tu marca 🔧 del 20/10 ya no cuenta · 🧹 Quitarla» y el diálogo solo limpia (B5);
 *   · FUERA DEL CATÁLOGO: inspección ya no la ve: quedará «❔ Sin dato» hasta que la vuelva a
 *     marcar, y el diálogo lo dice en vez de prometer inspección (B8);
 *   · vigente o en pausa: «desde ahora su estado es el que registre inspección».
 * Sin marca → null.
 */
export function dialogoSoltar(fila: FilaDelSitio, ahoraMs: number): DialogoSoltar | null {
  const e = fila.estado;
  if (!e.marca || !e.puedeSoltar) return null;
  const m = MARCA_INFO[e.marca];
  const codigo = limpia(fila.unidad.codigo) || 'la unidad';
  if (e.marcaEstado === 'superada') {
    const c = momentoCaracas(msDe(fila.unidad.estadoAt));
    const hoy = momentoCaracas(ahoraMs);
    const cuando = c ? (hoy && hoy.dia === c.dia ? ` de hoy ${c.hora}` : ` del ${c.diaMes}`) : '';
    const porque = e.superadaPor ? ` (${e.superadaPor.texto})` : '';
    return {
      enlace: `Tu marca ${m.icono}${cuando} ya no cuenta · 🧹 Quitarla`,
      titulo: '🧹 Quitar la marca',
      mensaje: `Tu marca ${m.icono} ${m.etiqueta} de ${codigo}${cuando} ya no cuenta: inspección ya manda${porque}. Se quita de la lista junto con su nota; no cambia el estado. ¿Seguir?`,
      confirmar: '🧹 Quitarla',
    };
  }
  if (e.fueraDelCatalogo) {
    return {
      enlace: '↩️ Que mande inspección',
      titulo: '↩️ Quitar tu marca',
      mensaje: `Se quita tu marca ${m.icono} ${m.etiqueta} de ${codigo} (y su nota). Como ya no está en el catálogo del sistema, inspección no la ve: quedará «❔ Sin dato» hasta que la vuelvas a marcar. ¿Seguir?`,
      confirmar: '↩️ Quitar la marca',
    };
  }
  return {
    enlace: '↩️ Que mande inspección',
    titulo: '↩️ Que mande inspección',
    mensaje: `Se quita tu marca ${m.icono} ${m.etiqueta} de ${codigo} (y su nota): desde ahora su estado es el que registre inspección. ¿Seguir?`,
    confirmar: '↩️ Que mande inspección',
  };
}

/**
 * B-M2: ¿hay una NOTA escrita que se perdería al cerrar el editor o al abrir el de otra máquina?
 * Sí si escribió algo y no es la nota guardada (sin contar espacios). Elegir una pastilla sin
 * escribir no pregunta (no hay nada escrito que perder).
 */
export function notaEscritaSinGuardar(edicion: EdicionEstado | null | undefined, unidades: Unidad[] | null | undefined): boolean {
  if (!edicion) return false;
  const u = (unidades ?? []).find((x) => x && x.id === edicion.id);
  if (!u) return false;
  const t = limpia(edicion.nota);
  return t !== '' && t !== limpia(u.estadoNota);
}

/** «🔎 Inspección leída a las 06:42 a. m.» (o «el 25/10 a las …» si no es de hoy). Sin hora → ''. */
export function textoInspeccionLeida(leidaAt: string | null | undefined, ahoraMs: number): string {
  const m = momentoCaracas(msDe(leidaAt));
  if (!m) return '';
  const hoy = momentoCaracas(ahoraMs);
  return `🔎 Inspección leída ${hoy && hoy.dia === m.dia ? '' : `el ${m.diaMes} `}a las ${m.hora}`;
}

/** El turno (7 a. m. a 7 p. m. y 7 p. m. a 7 a. m., hora de Caracas) de un instante, como número. */
export function turnoDe(ms: number): number {
  // 7 a. m. en Caracas (UTC−4, todo el año) = 11:00 UTC: los turnos empiezan a las 11:00 y a las 23:00 UTC.
  return Math.floor((ms - 11 * 3600 * 1000) / (12 * 3600 * 1000));
}

/** ¿Cambió el turno desde que se leyó inspección? (la vigencia en vivo depende del turno: hay que actualizar) */
export function cambioElTurno(leidaAt: string | null | undefined, ahoraMs: number): boolean {
  const t = msDe(leidaAt);
  return Number.isFinite(t) && Number.isFinite(ahoraMs) && turnoDe(t) !== turnoDe(ahoraMs);
}

/** El grupo de cada unidad (por id) que el bloque 🚜 le pasa al Parte diario para las salidas (M8). */
export function gruposParaSalidas(filas: FilaDelSitio[] | null | undefined): Record<string, GrupoSitio> {
  const out: Record<string, GrupoSitio> = {};
  for (const f of filas ?? []) if (f?.unidad?.id) out[f.unidad.id] = f.estado.grupo;
  return out;
}

/**
 * ⭐ M8: ¿el selector de unidad de las salidas le pone 🔧? Por el estado EFECTIVO que le pasó el
 * bloque 🚜 (`gruposParaSalidas`). Sin ese dato (bloque suelto, o todavía cargando) solo las del
 * sitio o las marcadas 🔧 (la regla sin inspección leída): nunca se supone nada de inspección.
 */
export function averiadaEnSalidas(u: Unidad, grupos?: Record<string, GrupoSitio> | null): boolean {
  if (!u) return false;
  const g = grupos?.[u.id];
  if (g) return g === 'averiada';
  return estadoDelSitio(u, null, 0).grupo === 'averiada';
}
