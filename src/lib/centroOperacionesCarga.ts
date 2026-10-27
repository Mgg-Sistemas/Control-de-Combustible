// 🏭 CENTRO DE OPERACIONES — LA LIBRERÍA DE ✍️ CARGAR Y 📋 REGISTROS (24-oct-2026).
//
// Lo que las dos pestañas deciden y se puede probar sin pantalla:
//   · qué se SUGIERE en origen y destino según el tipo (entrada = frente/obra →
//     terraza; interno = terraza → terraza; salida = terraza → destino externo);
//   · la PLACA que se vincula sola a una unidad activa de la flota;
//   · cómo se leen la hora (00:00–23:59), los viajes (entero ≥ 0) y las cifras
//     (≥ 0, con punto o coma) mientras se escriben;
//   · el formulario: nuevo, «Guardar y otro», editar un renglón y armar lo que
//     se guarda;
//   · el rango rápido, las opciones de los filtros y las filas del Excel;
//   · cómo se dicen en estas listas la producción y las ventas de bloques del 📅 Parte
//     diario, y que no se corrigen acá (lote 5, A4);
//   · las coordenadas pegadas juntas («lat, lng») que ⚙️ Ajustes reparte (lote 5, B17).
//
// ⭐ NO TIENE REGLAS PROPIAS DE CÁLCULO: las cifras se leen con `numeroDeCampo`,
//    los m³ con `m3De`, los totales con `totalesDe` y `textoViajes`, las placas se
//    comparan con `clavePlaca` y de qué unidad es cada renglón lo decide
//    `unidadDeLosRenglones`. Todo eso vive en `centroOperaciones.ts`; acá solo se usa.
//
// PURA: sin React ni Supabase; lo único que importa es `./centroOperaciones` y
// `./text`. `scripts/test-centro-operaciones-carga.mjs` la prueba sola.
import {
  clavePlaca,
  fechaValida,
  m3De,
  numeroDeCampo,
  textoViajes,
  totalesDe,
  unidadDeLosRenglones,
} from './centroOperaciones';
import type { ClaseLista, EstadoMov, ItemLista, Movimiento, TipoMov, Unidad } from './centroOperaciones';
import { cmpText, norm } from './text';

// ═══════════════════════════ Etiquetas ═══════════════════════════

/** Los tipos que se ANOTAN en ✍️ Carga libre (sus pastillas). */
export const TIPOS_MOV: { key: TipoMov; label: string; ico: string }[] = [
  { key: 'entrada', label: 'Entrada', ico: '⬇️' },
  { key: 'interno', label: 'Interno', ico: '🔁' },
  { key: 'salida', label: 'Salida', ico: '⬆️' },
  { key: 'otro', label: 'Otro', ico: '✳️' },
];

/**
 * TODOS los tipos con su etiqueta (lote 5, A4): también la producción, que NO se anota
 * en ✍️ Carga libre (la anota 📅 Parte diario → 🧱 Bloques) pero sí sale en sus listas,
 * en 📋 Registros y en el Excel: «🧱 Producción», nunca la clave cruda «produccion».
 */
export const ETIQUETAS_TIPO: { key: TipoMov; label: string; ico: string }[] = [
  ...TIPOS_MOV,
  { key: 'produccion', label: 'Producción', ico: '🧱' },
];

/** Las pastillas del filtro por tipo de 📋 Registros: todas, con la producción. */
export const TIPOS_FILTRO = ETIQUETAS_TIPO;

export const ESTADOS_MOV: { key: EstadoMov; label: string; ico: string }[] = [
  { key: 'confirmado', label: 'Confirmado', ico: '✅' },
  { key: 'por_confirmar', label: 'Por confirmar', ico: '❓' },
  { key: 'esperando_pesaje', label: 'Esperando pesaje', ico: '⚖️' },
];

export const etiquetaTipo = (t: TipoMov): string => ETIQUETAS_TIPO.find((x) => x.key === t)?.label ?? String(t ?? '');
export const etiquetaEstado = (e: EstadoMov): string => ESTADOS_MOV.find((x) => x.key === e)?.label ?? String(e ?? '');

// ═══════════════════════════ Los bloques en las listas (lote 5, A4) ═══════════════════════════

/** Las piezas de un renglón (bloques producidos o vendidos), o null si no las trae. */
const piezasDe = (m: Movimiento): number | null =>
  typeof m?.cantidad === 'number' && Number.isFinite(m.cantidad) ? m.cantidad : null;

/** «1 bloque», «120 bloques», «1.500 bloques». */
export function textoBloques(n: number): string {
  return `${n.toLocaleString('es-VE', { maximumFractionDigits: 2 })} ${n === 1 ? 'bloque' : 'bloques'}`;
}

/** Los bloques (piezas) de un conjunto de renglones: la producción y las ventas que las traen. */
export function bloquesDe(movs: Movimiento[]): number {
  return (movs ?? []).reduce((s, m) => s + (piezasDe(m) ?? 0), 0);
}

/**
 * Los viajes de UN renglón, dichos en la lista: «3 viajes», «1 viaje»; sin viajes,
 * «viajes por confirmar» SOLO si el renglón está por confirmar (una producción o una
 * venta de bloques no lleva viajes y está confirmada: no se dice nada).
 */
export function textoViajesRenglon(m: Movimiento): string {
  const v = typeof m?.viajes === 'number' && Number.isFinite(m.viajes) ? m.viajes : null;
  if (v !== null) return `${v.toLocaleString('es-VE', { maximumFractionDigits: 2 })} ${v === 1 ? 'viaje' : 'viajes'}`;
  return m?.estado === 'por_confirmar' ? 'viajes por confirmar' : '';
}

/**
 * ¿Se puede corregir este renglón en ✍️ Carga libre? Una PRODUCCIÓN o una VENTA DE
 * BLOQUES (un renglón con piezas) no: su formulario no tiene piezas ni el tipo
 * «producción», y guardarlo allá la convertiría en otra cosa (una entrada con 120
 * piezas, una venta con 1 viaje inventado). Devuelve el aviso de dónde se corrige, o null.
 */
export function avisoEdicionBloques(m: Movimiento): string | null {
  if (!m) return null;
  if (m.tipo !== 'produccion' && piezasDe(m) === null) return null;
  return '🧱 Se anotó en 📅 Parte diario → 🧱 Bloques: se corrige allá, no aquí.';
}

// ═══════════════════════════ Utilidades internas ═══════════════════════════

/** Texto limpio: sin espacios a los lados y con los dobles colapsados. */
const limpia = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();

/** «2026-10-22» → «22/10/2026» ('' si no es una fecha). */
export function dmy(f: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(f ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Suma (o resta) días a «YYYY-MM-DD» sin pasar por la zona horaria del equipo. */
function sumarDias(f: string, n: number): string {
  const [a, m, d] = f.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Junta textos sin repetir (mayúsculas, tildes y espacios no cuentan: queda la
 *  PRIMERA forma escrita), sin vacíos, y los ordena A→Z con `cmpText`. */
function unicosAZ(textos: unknown[]): string[] {
  const vistos = new Map<string, string>();
  for (const t of textos) {
    const s = limpia(t);
    if (s && !vistos.has(norm(s))) vistos.set(norm(s), s);
  }
  return [...vistos.values()].sort(cmpText);
}

// ═══════════════════════════ Sugerencias ═══════════════════════════

/**
 * De qué listas sale cada campo según el tipo. La terraza no es una columna: es
 * una clase de lista que sirve de origen y de destino.
 *   · entrada → origen: frentes/obras + lista «origen»; destino: terrazas.
 *   · interno → terraza → terraza.
 *   · salida  → origen: terrazas; destino: lista «destino» (externo).
 *   · otro    → cualquiera de las dos cosas en cada lado.
 */
export function clasesOrigenDestino(tipo: TipoMov): { origen: ClaseLista[]; destino: ClaseLista[]; conFrentes: boolean } {
  switch (tipo) {
    case 'entrada': return { origen: ['origen'], destino: ['terraza'], conFrentes: true };
    case 'interno': return { origen: ['terraza'], destino: ['terraza'], conFrentes: false };
    case 'salida': return { origen: ['terraza'], destino: ['destino'], conFrentes: false };
    default: return { origen: ['origen', 'terraza'], destino: ['terraza', 'destino'], conFrentes: true };
  }
}

/** Los nombres ACTIVOS de esas clases, más los `extras` (lo que sugiere el sistema),
 *  sin repetir y A→Z. Primero va la lista: si se repite, queda la forma de la lista. */
export function sugerenciasDeLista(listas: ItemLista[], clases: ClaseLista[], extras: string[] = []): string[] {
  const deLista = (listas ?? []).filter((i) => i.activo && clases.includes(i.clase)).map((i) => i.nombre);
  return unicosAZ([...deLista, ...(extras ?? [])]);
}

/** Qué se sugiere en origen y en destino para este tipo. `frentes` = los frentes y
 *  obras del sistema (solo cuentan donde el origen puede ser un frente). */
export function sugerenciasOrigenDestino(tipo: TipoMov, listas: ItemLista[], frentes: string[]): { origen: string[]; destino: string[] } {
  const c = clasesOrigenDestino(tipo);
  return {
    origen: sugerenciasDeLista(listas, c.origen, c.conFrentes ? frentes : []),
    destino: sugerenciasDeLista(listas, c.destino),
  };
}

/** El nombre ACTIVO de la lista que se escribió igual (sin mirar mayúsculas, tildes
 *  ni espacios), o null. Así lo escrito idéntico a la lista queda vinculado a ella.
 *  ⭐ Si el mismo nombre está «para todos los sitios» Y en el sitio (lote 5, A8), manda el
 *     DEL SITIO: sus km y su factor son los de ese sitio. Antes decidía el orden en que
 *     llegaba de la base; ahora la sugerencia, las salidas y ✍️ Carga libre toman el mismo. */
export function itemDeLista(texto: string, items: ItemLista[]): ItemLista | null {
  const t = norm(limpia(texto));
  if (!t) return null;
  const iguales = (items ?? []).filter((i) => i && i.activo && norm(limpia(i.nombre)) === t);
  return iguales.find((i) => i.sitioId != null) ?? iguales[0] ?? null;
}

/**
 * Las coordenadas PEGADAS juntas en un solo campo, como las copia Google Maps
 * («10.6012, -66.9301»), repartidas en latitud y longitud (lote 5, B17), o null si lo
 * escrito no es un par. ⭐ Como la coma también es el decimal («10,6012»), el separador
 * del par es «coma + espacio» o «;»: una cifra sola con coma decimal NO se parte.
 * Solo reparte el texto: cada campo lo lee y lo valida su propio lector.
 */
export function parDeCoordenadas(txt: string): { lat: string; lng: string } | null {
  const t = String(txt ?? '').trim();
  if (!t) return null;
  const partes = t.includes(';') ? t.split(';') : t.split(/\s*,\s+/);
  if (partes.length !== 2) return null;
  const [lat, lng] = partes.map((p) => p.trim());
  const cifra = /^[-+−]?\d{1,3}([.,]\d+)?$/;
  return cifra.test(lat) && cifra.test(lng) ? { lat, lng } : null;
}

// ═══════════════════════════ La unidad ═══════════════════════════

/** La placa para COMPARAR. ⭐ Es `clavePlaca` de la librería (auditoría A3): la carga,
 *  la pertenencia a la unidad y 🚛 Flota usan UNA sola regla. Queda el nombre viejo
 *  para quien ya lo usa. */
export const normalizarPlaca: (placa: string | null | undefined) => string = clavePlaca;

/**
 * La unidad ACTIVA de la flota con esa placa (con `clavePlaca`: espacios, guiones,
 * tildes y mayúsculas no cuentan). Las dadas de baja no se vinculan. Si dos activas
 * llevan la misma placa no se adivina: null (la misma prudencia que
 * `unidadDeLosRenglones`).
 */
export function unidadPorPlaca(placa: string, unidades: Unidad[]): Unidad | null {
  const p = clavePlaca(placa);
  if (!p) return null;
  const hallados = (unidades ?? []).filter((u) => u.activo && clavePlaca(u.placa) === p);
  return hallados.length === 1 ? hallados[0] : null;
}

/**
 * La OTRA unidad ACTIVA de la flota que lleva esa placa (con `clavePlaca`), o null.
 * Sin placa no hay choque. 🚛 Flota la pregunta al guardar una unidad y al
 * REACTIVARLA (auditoría A8): con dos activas con la misma placa, `unidadPorPlaca` no
 * adivina y la placa dejaría de vincularse sola, sin ningún aviso.
 */
export function otraActivaConPlaca(placa: string | null | undefined, unidades: Unidad[], exceptoId: string | null): Unidad | null {
  const p = clavePlaca(placa);
  if (!p) return null;
  return (unidades ?? []).find((u) => u.activo && u.id !== exceptoId && clavePlaca(u.placa) === p) ?? null;
}

/** Cómo se llama una unidad de la flota en el renglón: su código; sin código, la
 *  descripción; sin nada, la placa. Es el texto que se CONGELA en el renglón. */
export function textoDeUnidad(u: Unidad): string {
  return limpia(u.codigo) || limpia(u.descripcion) || limpia(u.placa);
}

/** La capacidad de la unidad como texto del campo ('' si no tiene). */
const capacidadDe = (u: Unidad | null | undefined): string =>
  u && typeof u.capacidadM3 === 'number' && isFinite(u.capacidadM3) ? String(u.capacidadM3) : '';

// ═══════════════════════════ Lectura de los campos ═══════════════════════════

export type Lectura<T> = { valor: T | null; error: string | null };

/** La hora del campo: vacía = sin hora; si no, «H:MM» o «HH:MM» entre 00:00 y
 *  23:59 (los segundos que devuelve Postgres se aceptan y se descartan). */
export function horaDeCampo(txt: string): Lectura<string> {
  const t = String(txt ?? '').trim();
  if (!t) return { valor: null, error: null };
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
    return { valor: null, error: 'La hora va de 00:00 a 23:59 (por ejemplo 06:30 o 14:05).' };
  }
  return { valor: `${m[1].padStart(2, '0')}:${m[2]}`, error: null };
}

/** Los viajes: vacío = sin dato; si no, un número ENTERO ≥ 0. */
export function viajesDeCampo(txt: string): Lectura<number> {
  const n = numeroDeCampo(txt);
  if (n === null) return { valor: null, error: null };
  if (n < 0) return { valor: null, error: 'Los viajes no pueden ser negativos.' };
  if (!Number.isInteger(n)) return { valor: null, error: `Los viajes van en número entero (se leyó ${n.toLocaleString('es-VE')}).` };
  return { valor: n, error: null };
}

/** Una cifra ≥ 0 (toneladas, m³) o > 0 (capacidad), con punto o coma. Vacío = sin dato. */
export function cifraDeCampo(txt: string, op: { mayorQueCero?: boolean } = {}): Lectura<number> {
  const n = numeroDeCampo(txt);
  if (n === null) return { valor: null, error: null };
  if (n < 0) return { valor: null, error: 'No puede ser negativa.' };
  if (op.mayorQueCero && n === 0) return { valor: null, error: 'Tiene que ser mayor que cero.' };
  return { valor: n, error: null };
}

// ═══════════════════════════ El formulario ═══════════════════════════

/** Lo escrito en un campo con lista: el texto manda; el id, si salió de la lista. */
export type ValorLista = { texto: string; listaId: string | null };

/** Todo lo que se escribe en ✍️ Cargar, tal cual (los números como TEXTO). */
export type FormCarga = {
  tipo: TipoMov;
  fecha: string;
  hora: string;
  unidadId: string | null;
  unidadTexto: string;
  placa: string;
  transportista: ValorLista;
  origen: ValorLista;
  destino: ValorLista;
  material: ValorLista;
  capacidad: string;
  viajes: string;
  toneladas: string;
  m3: string;
  estado: EstadoMov;
  observacion: string;
};

/** Lo que `guardarMovimiento` necesita, sin `id` ni `sitioId` (los pone quien guarda).
 *  Sin los campos del 📅 Parte diario (chofer, km, vehículo, cantidad, unidad escrita y
 *  disponible desde): ✍️ Carga libre no los escribe, así que editar ahí un renglón que
 *  vino del Parte diario NO los borra (lo que no viaja no se toca). */
export type DatosCarga = Omit<Movimiento, 'id' | 'sitioId' | 'creadoPor' | 'creadoAt' | 'editadoPor' | 'editadoAt'
  | 'chofer' | 'km' | 'vehiculo' | 'cantidad' | 'unidadIngresada' | 'disponibleDesde'>;

const VACIO_LISTA: ValorLista = { texto: '', listaId: null };

/** Un formulario en blanco: entrada, viajes «1», confirmado, el día pedido. */
export function formularioNuevo(fecha: string): FormCarga {
  return {
    tipo: 'entrada', fecha, hora: '', unidadId: null, unidadTexto: '', placa: '',
    transportista: { ...VACIO_LISTA }, origen: { ...VACIO_LISTA }, destino: { ...VACIO_LISTA }, material: { ...VACIO_LISTA },
    capacidad: '', viajes: '1', toneladas: '', m3: '', estado: 'confirmado', observacion: '',
  };
}

/** «Guardar y otro»: todo se queda para cargar la serie rápido, menos viajes
 *  (vuelve a «1»), toneladas, m³ y observación. */
export function formularioParaOtro(f: FormCarga): FormCarga {
  return { ...f, viajes: '1', toneladas: '', m3: '', observacion: '' };
}

/**
 * El formulario que sigue a un guardado con éxito, armado con LO QUE SE GUARDÓ
 * (auditoría B1): una edición o un «Guardar» → en blanco, el mismo día; un renglón nuevo
 * con «Guardar y otro» → la serie sigue (`formularioParaOtro`). Quien guarda, además,
 * SIEMPRE sale de «editando»: así un ✏️ tocado mientras viajaba el guardado no deja
 * «Editando X» con los datos de otro renglón.
 */
export function formularioTrasGuardar(guardado: FormCarga, eraEdicion: boolean, otro: boolean): FormCarga {
  return !eraEdicion && otro ? formularioParaOtro(guardado) : formularioNuevo(guardado.fecha);
}

/**
 * El aviso de un guardado que falló (auditoría A14): nunca dice que quedó un borrador si
 * no quedó. Una edición no deja borrador (lo escrito sigue en pantalla); un renglón nuevo
 * dice si quedó en el equipo o, si el almacenamiento falló, pide no cerrar la pantalla.
 */
export function avisoFalloGuardar(motivo: string, eraEdicion: boolean, borradorGuardado: boolean): string {
  if (eraEdicion) return motivo;
  return borradorGuardado
    ? `${motivo} Lo escrito quedó como borrador en este equipo.`
    : `${motivo} Tampoco se pudo dejar como borrador en este equipo: no cierres esta pantalla, lo escrito sigue en el formulario.`;
}

const textoDeCifra = (n: number | null | undefined): string => (typeof n === 'number' && isFinite(n) ? String(n) : '');

/** Un renglón guardado → el formulario para editarlo. */
export function formularioDesdeMovimiento(m: Movimiento): FormCarga {
  const lista = (texto: string | null, id: string | null): ValorLista => ({ texto: texto ?? '', listaId: id ?? null });
  return {
    tipo: m.tipo,
    fecha: m.fecha,
    hora: horaDeCampo(m.hora ?? '').valor ?? '',
    unidadId: m.unidadId ?? null,
    unidadTexto: m.unidadTexto ?? '',
    placa: m.placa ?? '',
    transportista: lista(m.transportista, m.transportistaId),
    origen: lista(m.origen, m.origenId),
    destino: lista(m.destino, m.destinoId),
    material: lista(m.material, m.materialId),
    capacidad: textoDeCifra(m.capacidadM3),
    viajes: textoDeCifra(m.viajes),
    toneladas: textoDeCifra(m.toneladas),
    m3: textoDeCifra(m.m3),
    estado: m.estado,
    observacion: m.observacion ?? '',
  };
}

/** Elegir una unidad de la flota (o null para desvincular). Elegirla es explícito:
 *  copia su texto y su placa; la capacidad, si la unidad la tiene. Desvincular deja
 *  lo escrito y solo quita el vínculo. */
export function elegirUnidad(f: FormCarga, u: Unidad | null): FormCarga {
  if (!u) return { ...f, unidadId: null };
  return {
    ...f,
    unidadId: u.id,
    unidadTexto: textoDeUnidad(u),
    placa: limpia(u.placa),
    capacidad: capacidadDe(u) || f.capacidad,
  };
}

/**
 * Escribir la placa. Si coincide con UNA unidad activa (`unidadPorPlaca`), el
 * renglón se vincula solo a ella (también si estaba vinculado a otra). Lo que venía
 * de la unidad anterior (su texto, su capacidad) se cambia por lo de la nueva; lo
 * que ella escribió a mano no se pisa, y lo vacío se llena con la unidad.
 *
 * ⭐ Si la placa escrita no es de ninguna unidad activa, SOLO se desvincula cuando el
 *    vínculo vino de esa placa: la unidad vinculada está activa, tiene placa y la que
 *    estaba escrita era la suya (entonces cambiarla es cambiar de unidad, y se limpia
 *    lo que venía de ella). En cualquier otro caso el vínculo, el texto y la capacidad
 *    se QUEDAN (auditoría de pantallas, A2): una unidad elegida a mano que no tiene
 *    placa, el renglón de una unidad dada de baja que se está corrigiendo, el de una
 *    unidad que cambió de placa en la flota, o la flota que todavía no llegó.
 */
export function escribirPlaca(f: FormCarga, placa: string, unidades: Unidad[]): FormCarga {
  const nueva = unidadPorPlaca(placa, unidades);
  const anterior = f.unidadId ? (unidades ?? []).find((u) => u.id === f.unidadId) ?? null : null;
  if (nueva && anterior && nueva.id === anterior.id) return { ...f, placa };
  if (!nueva && !f.unidadId) return { ...f, placa };
  if (!nueva) {
    const vinoDeLaPlaca = !!anterior && anterior.activo && clavePlaca(anterior.placa) !== ''
      && clavePlaca(f.placa) === clavePlaca(anterior.placa);
    if (!vinoDeLaPlaca) return { ...f, placa };
  }

  const venia = (valor: string, deAnterior: string): boolean => !limpia(valor) || (!!anterior && limpia(valor) === deAnterior);
  const textoAnterior = anterior ? textoDeUnidad(anterior) : '';
  const capAnterior = capacidadDe(anterior);
  return {
    ...f,
    placa,
    unidadId: nueva ? nueva.id : null,
    unidadTexto: venia(f.unidadTexto, textoAnterior) ? (nueva ? textoDeUnidad(nueva) : '') : f.unidadTexto,
    capacidad: venia(f.capacidad, capAnterior) ? (nueva ? capacidadDe(nueva) : '') : f.capacidad,
  };
}

/** ¿Escribió toneladas con el renglón «esperando pesaje»? (Esas toneladas no suman
 *  hasta que se confirme: se avisa y se ofrece pasarlo a confirmado.) */
export function avisoPesaje(f: FormCarga): boolean {
  return f.estado === 'esperando_pesaje' && cifraDeCampo(f.toneladas).valor !== null;
}

/** Los m³ que va a contar el renglón: los escritos, o viajes × capacidad (la regla
 *  de `m3De`); null si falta un dato. */
export function m3Calculado(f: FormCarga): number | null {
  return m3De({
    m3: cifraDeCampo(f.m3).valor,
    viajes: viajesDeCampo(f.viajes).valor,
    capacidadM3: cifraDeCampo(f.capacidad, { mayorQueCero: true }).valor,
  } as Movimiento);
}

/**
 * Revisa el formulario y arma lo que se guarda. Con errores, `datos` no sirve.
 * Todo campo viaja (vacío = null): al editar, borrar un dato lo borra en la base.
 *   · viajes obligatorio salvo «por confirmar»; entero ≥ 0.
 *   · hora opcional, de 00:00 a 23:59.
 *   · toneladas y m³ ≥ 0; capacidad > 0 (así lo pide la base).
 *   · placa en mayúsculas; los textos sin espacios de más; el id de lista solo si
 *     hay texto.
 *   · con `hoy` (la jornada de hoy, `caracasBusinessToday()`), una jornada POSTERIOR no
 *     se acepta (revisión final B-M8): como en el 📅 Parte diario, una jornada que no ha
 *     empezado no existe todavía (ya hubo horas «del futuro» fantasma en el sistema).
 */
export function validarCarga(f: FormCarga, hoy?: string): { errores: string[]; datos: DatosCarga } {
  const errores: string[] = [];
  // La fecha con LA cota del módulo (años 2000 a 2100, `fechaValida` de la librería).
  if (!fechaValida(f.fecha)) {
    errores.push(/^\d{4}-\d{2}-\d{2}$/.test(String(f.fecha ?? ''))
      ? 'La fecha tiene que estar entre los años 2000 y 2100: elígela en el calendario.'
      : 'La fecha no se entiende: elígela en el calendario.');
  } else if (hoy && fechaValida(hoy) && f.fecha > hoy) {
    errores.push(`La jornada del ${dmy(f.fecha)} todavía no empieza: no se anota en una jornada futura (hoy es la del ${dmy(hoy)}).`);
  }
  if (!TIPOS_MOV.some((t) => t.key === f.tipo)) errores.push('Elige el tipo (entrada, interno, salida u otro).');
  if (!ESTADOS_MOV.some((e) => e.key === f.estado)) errores.push('Elige el estado.');

  const hora = horaDeCampo(f.hora);
  if (hora.error) errores.push(hora.error);
  const viajes = viajesDeCampo(f.viajes);
  if (viajes.error) errores.push(viajes.error);
  else if (viajes.valor === null && f.estado !== 'por_confirmar') {
    errores.push('Escribe los viajes (solo se dejan vacíos si el renglón está «por confirmar»).');
  }
  const toneladas = cifraDeCampo(f.toneladas);
  if (toneladas.error) errores.push(`Toneladas: ${toneladas.error}`);
  const m3 = cifraDeCampo(f.m3);
  if (m3.error) errores.push(`m³: ${m3.error}`);
  const capacidad = cifraDeCampo(f.capacidad, { mayorQueCero: true });
  if (capacidad.error) errores.push(`Capacidad: ${capacidad.error}`);

  const lista = (v: ValorLista): [string | null, string | null] => {
    const texto = limpia(v?.texto);
    return texto ? [texto, v.listaId || null] : [null, null];
  };
  const [transportista, transportistaId] = lista(f.transportista);
  const [origen, origenId] = lista(f.origen);
  const [destino, destinoId] = lista(f.destino);
  const [material, materialId] = lista(f.material);

  return {
    errores,
    datos: {
      fecha: f.fecha,
      hora: hora.valor,
      tipo: f.tipo,
      unidadId: f.unidadId || null,
      unidadTexto: limpia(f.unidadTexto),
      placa: limpia(f.placa).toUpperCase() || null,
      transportista, transportistaId,
      origen, origenId,
      destino, destinoId,
      material, materialId,
      capacidadM3: capacidad.valor,
      viajes: viajes.valor,
      toneladas: toneladas.valor,
      m3: m3.valor,
      estado: f.estado,
      observacion: String(f.observacion ?? '').trim() || null,
    },
  };
}

/** Los campos del formulario, para compararlos uno por uno. */
const CAMPOS_FORM: (keyof FormCarga)[] = [
  'tipo', 'fecha', 'hora', 'unidadId', 'unidadTexto', 'placa', 'transportista', 'origen', 'destino', 'material',
  'capacidad', 'viajes', 'toneladas', 'm3', 'estado', 'observacion',
];

/**
 * ¿Quedó algo escrito SIN GUARDAR? (revisión final B-M2): el formulario no es el de partida
 * (el que se puso al abrir, al tocar ✏️, al cancelar o tras guardar; tras «Guardar y otro»,
 * lo que quedó puesto para la serie). Antes de tirarlo (✏️ en otro renglón, «Cancelar»,
 * «← Volver a los registros») se pregunta. En un renglón NUEVO cambiar solo el día no
 * cuenta (la lista del día cambia con él); al EDITAR, sí.
 */
export function formularioSinGuardar(f: FormCarga, partida: FormCarga, editando: boolean): boolean {
  const valor = (v: unknown): string => (v && typeof v === 'object'
    ? JSON.stringify([(v as ValorLista).texto ?? '', (v as ValorLista).listaId ?? null])
    : JSON.stringify(v ?? null));
  return CAMPOS_FORM.some((k) => (k === 'fecha' && !editando ? false : valor(f?.[k]) !== valor(partida?.[k])));
}

// ═══════════════════════════ El sitio de la pantalla ═══════════════════════════

/**
 * Qué sitio queda elegido después de recargar la lista de sitios activos (auditoría R2):
 * el que ya estaba, si sigue activo; si no (o si todavía no había uno), el primero A→Z.
 * Así el sitio NO cambia solo cuando aparece otro que ordena antes (lo crea ella en ⚙️
 * o el administrador desde otro equipo): seguiría cargando en el sitio equivocado.
 */
export function sitioElegido(actualId: string | null, activos: { id: string }[]): string | null {
  if (actualId && (activos ?? []).some((s) => s.id === actualId)) return actualId;
  return activos?.[0]?.id ?? null;
}

// ═══════════════════════════ Pedidos que se cruzan ═══════════════════════════

/**
 * Una cuenta de pedidos para que una respuesta VIEJA no pise a la nueva (auditoría B7):
 * ella toca «Hoy» y enseguida «Este mes»; si «Hoy» llega último, la lista quedaría con
 * solo hoy bajo el título «del 01 al 24» (y el Excel saldría incompleto). Cada carga
 * pide `nuevo()` y, al volver, solo escribe si `vigente(n)`.
 */
export function secuenciaDePedidos(): { nuevo: () => number; vigente: (n: number) => boolean } {
  let ultimo = 0;
  return { nuevo: () => ++ultimo, vigente: (n) => n === ultimo };
}

// ═══════════════════════════ 📋 Registros ═══════════════════════════

export type RangoRapido = 'hoy' | 'semana' | 'mes';

/** Los renglones cargados y DE QUÉ RANGO son (📋 Registros). */
export type BaseDelRango = { desde: string; hasta: string; movs: Movimiento[] };

/**
 * ¿La base cargada sirve para el rango pedido? (revisión final B-I3) Solo si es de ESE
 * rango y la última carga no falló. Si no —tocó «Este mes» y todavía está la de hoy, o la
 * carga falló—, la pantalla dice «Cargando…» (o el error), apaga los totales y el 📥 Excel
 * espera: antes bajaba «… 01 a 31.xlsx» solo con lo de hoy.
 */
export function baseLista(b: BaseDelRango | null | undefined, rango: { desde: string; hasta: string }, error: string | null | undefined): boolean {
  return !!b && !error && b.desde === rango?.desde && b.hasta === rango?.hasta;
}

/** Hoy (la jornada), la semana desde el LUNES o el mes desde el día 1, hasta `hoy`. */
export function rangoRapido(q: RangoRapido, hoy: string): { desde: string; hasta: string } {
  if (q === 'semana') {
    const [a, m, d] = hoy.split('-').map(Number);
    const dow = new Date(Date.UTC(a, m - 1, d)).getUTCDay(); // 0 = domingo
    return { desde: sumarDias(hoy, -((dow + 6) % 7)), hasta: hoy };
  }
  if (q === 'mes') return { desde: `${hoy.slice(0, 8)}01`, hasta: hoy };
  return { desde: hoy, hasta: hoy };
}

/**
 * Las unidades para el filtro, sacadas de los renglones del período con LA regla
 * de la librería (`unidadDeLosRenglones`): un renglón suelto con la placa de una
 * vinculada cae en ella. `clave` es lo que espera `filtrarMovimientos` en
 * `unidadIds`. Etiqueta: «código · placa» de la flota, o el texto congelado. A→Z.
 */
export function opcionesUnidad(movs: Movimiento[], unidades: Unidad[]): { clave: string; etiqueta: string }[] {
  const unidadDe = unidadDeLosRenglones(movs);
  const porClave = new Map<string, string>();
  for (const m of movs) {
    const clave = unidadDe(m);
    // Un renglón sin unidad ni placa (clave vacía) no es una unidad: no se ofrece.
    if (!clave || porClave.has(clave)) continue;
    const u = (unidades ?? []).find((x) => x.id === clave);
    const partes = u ? [textoDeUnidad(u), limpia(u.placa)] : [limpia(m.unidadTexto), limpia(m.placa)];
    const etiqueta = partes.filter((p, i) => p && (i === 0 || norm(p) !== norm(partes[0]))).join(' · ');
    porClave.set(clave, etiqueta || clave);
  }
  return [...porClave.entries()]
    .map(([clave, etiqueta]) => ({ clave, etiqueta }))
    .sort((a, b) => cmpText(a.etiqueta, b.etiqueta));
}

/**
 * Antes de «Vincular a unidad» (auditoría A9/B3): de los `ids` elegidos, cuántos YA
 * están vinculados a OTRA unidad (el vínculo se les cambia: la fase 2 paga por vínculo)
 * y cuántos no se ven con los filtros de ahora (se eligieron antes de cambiarlos).
 * `base` = los renglones del período; `filtrados` = los que se ven.
 */
export function resumenVincular(ids: string[], base: Movimiento[], filtrados: Movimiento[], unidadId: string): { total: number; deOtraUnidad: number; ocultos: number } {
  const elegidos = new Set(ids ?? []);
  const visibles = new Set((filtrados ?? []).map((m) => m.id));
  return {
    total: elegidos.size,
    deOtraUnidad: (base ?? []).filter((m) => elegidos.has(m.id) && !!m.unidadId && m.unidadId !== unidadId).length,
    ocultos: [...elegidos].filter((id) => !visibles.has(id)).length,
  };
}

/** El texto del confirm de «Vincular a unidad», con los avisos de `resumenVincular`. */
export function mensajeVincular(r: { total: number; deOtraUnidad: number; ocultos: number }, unidad: string): string {
  const partes = [`¿Vincular ${r.total} ${r.total === 1 ? 'renglón' : 'renglones'} a ${unidad}? Lo escrito en cada renglón no cambia.`];
  if (r.deOtraUnidad > 0) {
    partes.push(`⚠️ ${r.deOtraUnidad} ${r.deOtraUnidad === 1 ? 'ya está vinculado' : 'ya están vinculados'} a otra unidad y ${r.deOtraUnidad === 1 ? 'pasará' : 'pasarán'} a ${unidad}.`);
  }
  if (r.ocultos > 0) {
    partes.push(`⚠️ ${r.ocultos} no se ${r.ocultos === 1 ? 've' : 'ven'} con los filtros de ahora (se ${r.ocultos === 1 ? 'eligió' : 'eligieron'} antes de cambiarlos).`);
  }
  return partes.join('\n');
}

/** Los transportistas / orígenes / destinos / materiales escritos en el período:
 *  sin repetir (queda la primera forma), sin vacíos, A→Z. */
export function opcionesTexto(movs: Movimiento[], campo: 'transportista' | 'origen' | 'destino' | 'material'): string[] {
  return unicosAZ(movs.map((m) => m[campo]));
}

type CeldaExcel = string | number;

/**
 * Las filas del 📥 Excel: encabezado, un renglón por fila y el TOTAL (con
 * `totalesDe` y `textoViajes`, así dice «(+N pendiente)» igual que la pantalla).
 * Las cifras van como NÚMERO; lo vacío, vacío. El texto va literal (el Excel lo
 * escapa al escribir el XML).
 * ⭐ Las celdas siguen LA regla del 📋 Listado y del TOTAL (revisión final A#4): las
 *    toneladas solo de lo CONFIRMADO (lo que espera pesaje aún no tiene peso neto) y los
 *    m³ vacíos en lo POR CONFIRMAR (no suma). Antes salían y la columna sumada en Excel
 *    no llegaba al TOTAL.
 */
export function filasExcel(movs: Movimiento[]): CeldaExcel[][] {
  const n = (v: number | null | undefined): CeldaExcel => (typeof v === 'number' && isFinite(v) ? v : '');
  const toneladasCelda = (m: Movimiento): CeldaExcel => (m.estado === 'confirmado' ? n(m.toneladas) : '');
  const m3Celda = (m: Movimiento): CeldaExcel => (m.estado === 'por_confirmar' ? '' : n(m3De(m)));
  // «Bloques» (lote 5, A4): las piezas de la producción y de las ventas de bloques; sin
  // esa columna, una producción de 120 salía sin ninguna cifra.
  const filas: CeldaExcel[][] = [[
    'Fecha', 'Hora', 'Tipo', 'Unidad', 'Placa', 'Transportista', 'Origen', 'Destino', 'Material',
    'Capacidad (m³)', 'Viajes', 'Toneladas', 'm³', 'Bloques', 'Estado', 'Observación', 'Cargó', 'Editó',
  ]];
  for (const m of movs) {
    filas.push([
      dmy(m.fecha), horaDeCampo(m.hora ?? '').valor ?? '', etiquetaTipo(m.tipo), m.unidadTexto ?? '', m.placa ?? '',
      m.transportista ?? '', m.origen ?? '', m.destino ?? '', m.material ?? '',
      n(m.capacidadM3), n(m.viajes), toneladasCelda(m), m3Celda(m), n(m.cantidad), etiquetaEstado(m.estado),
      m.observacion ?? '', m.creadoPor ?? '', m.editadoPor ?? '',
    ]);
  }
  const t = totalesDe(movs);
  // Los bloques no se totalizan: producidos y vendidos sumados no dirían nada.
  filas.push(['TOTAL', '', '', '', '', '', '', '', '', '', textoViajes(t), t.toneladas, t.m3, '', '', '', '', '']);
  return filas;
}
