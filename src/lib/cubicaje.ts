// CUBICAJE Y REPORTE VOLUMÉTRICO (09-sep-2026).
//
// Pedido del cliente: en «Ruta de viajes de camiones» poder decir cuántos METROS
// CÚBICOS cargó cada camión —para un día o para un rango— y poder armar el
// reporte quitando y poniendo columnas, para que sirva tanto al que quiere el
// detalle como al que solo quiere el volumen.
//
// ⚠️ ESTE ARCHIVO NO TOCA LA BASE DE DATOS, Y ES A PROPÓSITO.
//    El catálogo de vehículos (`machinery`) se lee y NADA MÁS. Una volqueta que
//    se mide a mano en el formulario vive en el teléfono de quien la midió y no
//    entra al catálogo: no aparece en Control de Maquinaria, ni en Mantenimiento,
//    ni le llega a los inspectores. Es el mismo criterio del camión «fuera de
//    catálogo» que ya usa la pantalla para registrar un viaje.
//
// Puro a propósito: sin React, sin supabase y sin un solo import. Todo lo que
// decide un número o una regla vive acá y se prueba en scripts/test-cubicaje.mjs.

// ── LO QUE SE MIDE ──────────────────────────────────────────────────────────

/** Una volqueta medida. `truckId` la ata a una ficha del catálogo; en null es
 *  una unidad que alguien midió a mano y que solo existe en este teléfono. */
export type Medida = {
  id: string;
  truckId: string | null;
  ident: string;
  marca: string;
  modelo: string;
  alto: number;
  largo: number;
  ancho: number;
  /**
   * `true` cuando la medida NO está guardada: sale de la hoja de cubicaje que
   * entregó el cliente, reconocida por el texto del equipo (`medidasFlota`).
   *
   * ⚠️ Se marca para poder DECIRLO en pantalla. Un número deducido de un nombre
   *    parecido no vale lo mismo que uno tomado con cinta, y quien lee el papel
   *    tiene derecho a saber cuál es cuál. Al confirmarla se guarda de verdad y
   *    la marca desaparece.
   */
  deLaHoja?: boolean;
};

/** Dos decimales. Un camión no se mide al milímetro y un m³ con seis decimales
 *  en un reporte impreso se lee como precisión que nadie tiene. */
export const DECIMALES = 2;

export function redondear(n: number, d: number = DECIMALES): number {
  if (!Number.isFinite(n)) return 0;
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

/**
 * Lee un número escrito a mano.
 *
 * ⚠️ Acepta la COMA como separador decimal: acá se escribe «2,5», no «2.5», y
 *    `Number('2,5')` es NaN. Sin esto, medir 2,5 m de alto daba 0 m³ en
 *    silencio y el reporte salía en cero sin decir por qué.
 */
export function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const t = String(v ?? '').trim().replace(',', '.');
  if (!t) return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

/** Alto × largo × ancho. Una medida en cero o negativa da 0: no existe media
 *  volqueta, y un negativo multiplicado por dos negativos daría un positivo
 *  perfectamente creíble en el reporte. */
export function volumen(alto: unknown, largo: unknown, ancho: unknown): number {
  const a = num(alto), l = num(largo), n = num(ancho);
  if (a <= 0 || l <= 0 || n <= 0) return 0;
  return redondear(a * l * n);
}

export const volumenDe = (m: Pick<Medida, 'alto' | 'largo' | 'ancho'>): number =>
  volumen(m.alto, m.largo, m.ancho);

// ── CLASIFICACIÓN ───────────────────────────────────────────────────────────

export type Clase = 'compacto' | 'media' | 'gran';

/** Los cortes los dio el cliente: <18, 18–25 y >25. Los bordes son INCLUSIVOS
 *  en «media capacidad»: 18 y 25 exactos son media, no compacto ni gran. */
export const CLASES: { key: Clase; label: string; ico: string; desde: number; hasta: number | null }[] = [
  { key: 'compacto', label: 'Compacto / Estándar', ico: '🔹', desde: 0, hasta: 18 },
  { key: 'media', label: 'Media capacidad', ico: '🔸', desde: 18, hasta: 25 },
  { key: 'gran', label: 'Gran capacidad', ico: '🔶', desde: 25, hasta: null },
];

/** `null` cuando todavía no hay medida: pintar «Compacto» con 0 m³ diría que la
 *  volqueta es chiquita, cuando lo cierto es que nadie la ha medido. */
export function clasificar(m3: number): Clase | null {
  if (!Number.isFinite(m3) || m3 <= 0) return null;
  if (m3 < 18) return 'compacto';
  if (m3 <= 25) return 'media';
  return 'gran';
}

export function etiquetaClase(m3: number): string {
  const c = clasificar(m3);
  if (!c) return 'Sin medir';
  const meta = CLASES.find((x) => x.key === c)!;
  return `${meta.ico} ${meta.label}`;
}

// ── LOS INDICADORES DE LA FLOTA SELECCIONADA ────────────────────────────────

export type Kpis = { n: number; mayor: number; menor: number; promedio: number };

/**
 * Mayor, menor y promedio de la flota que se está viendo.
 *
 * ⚠️ Las unidades SIN MEDIR se dejan fuera del cálculo, no se cuentan como 0.
 *    Un solo camión sin medir arrastraría el «menor» a 0 y hundiría el promedio,
 *    y el panel diría que la flota carga la mitad de lo que carga.
 */
export function kpis(m3s: number[]): Kpis {
  const v = m3s.filter((x) => Number.isFinite(x) && x > 0);
  if (!v.length) return { n: 0, mayor: 0, menor: 0, promedio: 0 };
  const suma = v.reduce((a, b) => a + b, 0);
  return {
    n: v.length,
    mayor: redondear(Math.max(...v)),
    menor: redondear(Math.min(...v)),
    promedio: redondear(suma / v.length),
  };
}

// ── LA UNIDAD QUE NO VA EN ESTE APARTADO ────────────────────────────────────

/**
 * «Carbozulia Sinotruk (HOWO)» queda fuera de los desplegables y de los
 * indicadores de cubicaje por pedido del cliente.
 *
 * ⚠️ NO se borra ni se esconde del resto del sistema: sus viajes se siguen
 *    registrando y contando igual que siempre. Esto solo la deja fuera de ESTE
 *    apartado, y hay un interruptor en pantalla para volver a mostrarla — un
 *    filtro que no se puede quitar es indistinguible de un dato que falta.
 */
export const SENAS_OCULTAS = ['sinotruk', 'howo'];

export function esUnidadOculta(...textos: (string | null | undefined)[]): boolean {
  const t = textos.map((x) => String(x ?? '')).join(' ').toLowerCase();
  return SENAS_OCULTAS.some((s) => t.includes(s));
}

// ── CÓMO SE LE APLICAN LOS m³ A LOS VIAJES ──────────────────────────────────

export type ModoVolumen = 'tolva' | 'proporcional' | 'manual';

export const MODOS: { key: ModoVolumen; label: string; ayuda: string }[] = [
  {
    key: 'tolva',
    label: '📦 Por capacidad de tolva',
    ayuda: 'Cada viaje carga lo que mide la tolva. Total del camión = viajes × m³ de su tolva.',
  },
  {
    key: 'proporcional',
    label: '⚖️ Repartir un total',
    ayuda: 'Escribes UN total para todo el rango y se reparte entre los camiones según cuántos viajes hizo cada uno.',
  },
  {
    key: 'manual',
    label: '✍️ Total escrito a mano',
    ayuda: 'Le escribes el total del rango a cada camión. Manda lo que escribas, no la medida.',
  },
];

export type FilaVolumen = {
  key: string;
  viajes: number;
  /** m³ de la tolva de ese camión. 0 = sin medir. */
  m3Tolva: number;
  /** Solo se usa en modo 'manual'. */
  manual?: number;
};

export type VolumenCamion = { total: number; porViaje: number };

/**
 * Reparte el volumen entre los camiones del rango.
 *
 * · tolva        → viajes × m³ de su tolva. El camión sin medir queda en 0.
 * · proporcional → `totalGlobal` repartido POR VIAJES: quien hizo más viajes se
 *                  lleva más. Con 0 viajes en total, todos quedan en 0 en vez de
 *                  dividir entre cero y sacar Infinity al reporte.
 * · manual       → lo que se escribió para ese camión, y de ahí se deduce el
 *                  por-viaje. Sin nada escrito queda en 0, no cae a la tolva:
 *                  «escrito a mano» significa que manda la mano.
 *
 * `porViaje` siempre se deriva del total. Así la columna de cada viaje y la
 * sumatoria del reporte no pueden dejar de cuadrar entre sí.
 */
export function repartirVolumen(
  modo: ModoVolumen,
  filas: FilaVolumen[],
  totalGlobal: number = 0,
): Map<string, VolumenCamion> {
  const out = new Map<string, VolumenCamion>();
  const viajesTotales = filas.reduce((a, f) => a + Math.max(0, f.viajes || 0), 0);
  const global = Math.max(0, num(totalGlobal));

  for (const f of filas) {
    const viajes = Math.max(0, f.viajes || 0);
    let total = 0;
    if (modo === 'tolva') total = viajes * Math.max(0, f.m3Tolva || 0);
    else if (modo === 'proporcional') total = viajesTotales > 0 ? (global * viajes) / viajesTotales : 0;
    else total = Math.max(0, num(f.manual));
    total = redondear(total);
    out.set(f.key, { total, porViaje: viajes > 0 ? redondear(total / viajes) : 0 });
  }

  // ⚠️ EL CENTÍMETRO CÚBICO QUE SOBRA. Repartir 50,5 m³ entre 3 y 1 viajes da
  //    37,875 y 12,625; redondeados, 37,88 + 12,63 = 50,51. El reporte diría
  //    que se repartió UN TOTAL y cerraría con otro, y quien lo lea va a pensar
  //    que la cuenta está mal — no que le sobró un céntimo al redondeo.
  //    La diferencia se le da al camión de más viajes, que es donde menos pesa.
  if (modo === 'proporcional' && viajesTotales > 0 && out.size > 0) {
    const delta = redondear(global - sumaVolumen(out));
    if (delta !== 0) {
      const mayor = filas.reduce((a, b) => (b.viajes > a.viajes ? b : a), filas[0]);
      const v = out.get(mayor.key);
      const viajes = Math.max(0, mayor.viajes || 0);
      if (v && viajes > 0) {
        const total = redondear(v.total + delta);
        out.set(mayor.key, { total, porViaje: redondear(total / viajes) });
      }
    }
  }
  return out;
}

/** Suma de los totales, para la línea de cierre del reporte. Se suma lo mismo
 *  que se imprimió, no se recalcula por otro camino: si se recalculara, el pie
 *  podría no cuadrar con las filas de arriba por el redondeo. */
export function sumaVolumen(v: Map<string, VolumenCamion>): number {
  let s = 0;
  v.forEach((x) => { s += x.total; });
  return redondear(s);
}

// ── QUÉ COLUMNAS LLEVA EL REPORTE ───────────────────────────────────────────

export type OpcionesReporte = {
  /** Columna de m³ y su sumatoria. */
  m3: boolean;
  /** El conteo de viajes: en el resumido, las columnas Día/Noche/Viajes. */
  viajes: boolean;
  marcaModelo: boolean;
  /** Alto, largo y ancho de la tolva. */
  dimensiones: boolean;
  clasificacion: boolean;
  placa: boolean;
  chofer: boolean;
  listero: boolean;
  turno: boolean;
  estado: boolean;
  /**
   * A qué EMPRESA pertenece el camión.
   *
   * En el detallado ya salía siempre y no se podía quitar; ahora se puede. En el
   * resumido es nueva: agrupando por listero o por obra, el papel enseñaba los
   * camiones sin decir de quién eran.
   */
  empresa: boolean;
  /** En qué OBRA se registró el viaje (la que tenía el listero ese día). */
  ubicacion: boolean;
};

/**
 * ⚠️ EL VALOR POR DEFECTO REPRODUCE EL REPORTE DE SIEMPRE, COLUMNA POR COLUMNA.
 *    Lo nuevo (m³, marca/modelo, dimensiones, clasificación) entra APAGADO. Quien
 *    no toque nada tiene que seguir sacando exactamente el mismo PDF que sacaba
 *    ayer; si lo nuevo entrara encendido, todos los reportes del sistema
 *    cambiarían de forma sin que nadie lo pidiera.
 */
export const OPCIONES_POR_DEFECTO: OpcionesReporte = {
  m3: false,
  viajes: true,
  marcaModelo: false,
  dimensiones: false,
  clasificacion: false,
  placa: true,
  chofer: true,
  listero: true,
  turno: true,
  estado: true,
  // ENCENDIDA porque el detallado YA traía la empresa y no se podía quitar:
  // apagarla por defecto le quitaría una columna al reporte de siempre. En el
  // resumido no aparece salvo que se agrupe por otra cosa (ver `columnasResumen`).
  empresa: true,
  // APAGADA porque es nueva. Quien no la encienda saca el mismo papel de ayer.
  ubicacion: false,
};

export type ColSpec = { key: string; head: string; num?: boolean };

/**
 * Columnas del reporte DETALLADO (una línea por viaje), en orden.
 *
 * Fecha, hora y camión no se pueden quitar: sin ellas la línea no identifica
 * nada. La EMPRESA sí se puede desde el 12-sep-2026, a pedido — antes era fija.
 *
 * `eje` es por cuál se está agrupando el reporte: la columna de ese eje se omite
 * porque su valor ya está en el encabezado del grupo y repetirlo en cada fila
 * solo gasta ancho de página.
 */
export function columnasDetalle(op: OpcionesReporte, eje: 'empresa' | 'listero' | 'ubicacion' = 'empresa'): ColSpec[] {
  const c: ColSpec[] = [
    { key: 'fecha', head: 'Fecha' },
    { key: 'hora', head: 'Hora' },
  ];
  if (op.empresa) c.push({ key: 'empresa', head: 'Empresa' });
  c.push({ key: 'camion', head: 'Camión' });
  if (op.ubicacion && eje !== 'ubicacion') c.push({ key: 'ubicacion', head: 'Obra' });
  if (op.placa) c.push({ key: 'placa', head: 'Placa / Serial' });
  if (op.marcaModelo) c.push({ key: 'marcaModelo', head: 'Marca / Modelo' });
  if (op.dimensiones) c.push({ key: 'dims', head: 'Alto × Largo × Ancho (m)' });
  if (op.m3) c.push({ key: 'm3', head: 'm³', num: true });
  if (op.clasificacion) c.push({ key: 'clase', head: 'Clasificación' });
  if (op.chofer) c.push({ key: 'chofer', head: 'Chofer' });
  if (op.listero) c.push({ key: 'listero', head: 'Listero' });
  if (op.turno) c.push({ key: 'turno', head: 'Turno' });
  if (op.estado) c.push({ key: 'estado', head: 'Estado' });
  return c;
}

/** Columnas del reporte RESUMIDO (una línea por camión). Apagar «viajes» deja
 *  el reporte puramente volumétrico: camión, medida y m³. */
export function columnasResumen(op: OpcionesReporte, eje: 'empresa' | 'listero' | 'ubicacion' = 'empresa'): ColSpec[] {
  const c: ColSpec[] = [{ key: 'camion', head: 'Camión' }];
  // La columna del EJE no va: su valor ya está en el encabezado del grupo. Por
  // eso agrupando por empresa —que es como se abre— el resumido sale idéntico a
  // como salía antes de que esta columna existiera.
  //
  // Un camión pertenece a UNA empresa, así que la columna tiene un valor claro.
  if (op.empresa && eje !== 'empresa') c.push({ key: 'empresa', head: 'Empresa' });
  //
  // ⚠️ Y NO HAY COLUMNA DE OBRA EN EL RESUMIDO, a propósito: cada fila es un
  //    CAMIÓN, y el mismo camión puede haber hecho viajes en dos obras dentro
  //    del rango. Poner una sola obra ahí obligaría a elegir cuál mostrar, y
  //    cualquier elección sería mentira la mitad de las veces. La obra se ve en
  //    el detallado —donde cada fila ES un viaje— y en el encabezado del grupo
  //    cuando se agrupa por obra.
  if (op.placa) c.push({ key: 'placa', head: 'Placa / Serial' });
  if (op.marcaModelo) c.push({ key: 'marcaModelo', head: 'Marca / Modelo' });
  if (op.dimensiones) c.push({ key: 'dims', head: 'Alto × Largo × Ancho (m)' });
  if (op.clasificacion) c.push({ key: 'clase', head: 'Clasificación' });
  if (op.viajes) {
    c.push({ key: 'dia', head: '☀️ Día', num: true });
    c.push({ key: 'noche', head: '🌙 Noche', num: true });
    c.push({ key: 'viajes', head: 'Viajes', num: true });
  }
  if (op.m3) c.push({ key: 'm3', head: 'm³', num: true });
  return c;
}

/**
 * Un reporte SIN NADA que contar no se emite.
 *
 * Apagar a la vez el conteo de viajes y los m³ en el modo resumido deja una
 * tabla de camiones sin una sola cifra: parece un reporte y no dice nada. Es
 * mejor decirlo antes de generarlo que entregar la hoja vacía.
 */
export function reporteSinCifras(op: OpcionesReporte, modoResumen: boolean): boolean {
  return modoResumen && !op.viajes && !op.m3;
}

/** Toma los valores de una fila en el ORDEN de las columnas visibles. El que
 *  arma la fila entrega todos los valores posibles; acá se elige y se ordena,
 *  que es lo único que hay que probar. */
export function valoresEnOrden(cols: ColSpec[], fila: Record<string, string | number>): string[] {
  return cols.map((c) => {
    const v = fila[c.key];
    return v === undefined || v === null ? '—' : String(v);
  });
}

/** «2.50 × 5.00 × 2.30» — o vacío si la unidad no está medida. */
export function dimsTexto(m?: Pick<Medida, 'alto' | 'largo' | 'ancho'> | null): string {
  if (!m) return '';
  const a = num(m.alto), l = num(m.largo), n = num(m.ancho);
  if (a <= 0 || l <= 0 || n <= 0) return '';
  return `${a.toFixed(2)} × ${l.toFixed(2)} × ${n.toFixed(2)}`;
}

/** Un m³ para imprimir. Cero se muestra como raya: un «0.00» en la columna de
 *  volumen se lee como «cargó nada», y lo cierto es que no está medido. */
export function m3Texto(n: number): string {
  return Number.isFinite(n) && n > 0 ? n.toFixed(DECIMALES) : '—';
}

// ── LO GUARDADO MANDA SOBRE LO CALCULADO ────────────────────────────────────
//
// Desde el 09-sep-2026 los m³ se pueden GUARDAR por camión y por jornada
// (tabla `camion_cubicaje_carga`, ver src/lib/cubicajeDatos.ts). Eso abre una
// pregunta que hay que contestar de una sola forma en todo el sistema: cuando
// hay un valor guardado Y uno calculado para el mismo día, ¿cuál sale?
//
// ⭐ MANDA EL GUARDADO, por jornada.
//    Un reporte de un mes viejo tiene que salir HOY con los mismos números que
//    salió aquel día. Si mandara el cálculo, cambiar el modo o corregir una
//    medida reescribiría el pasado en silencio, y dos impresiones del mismo mes
//    no coincidirían. Lo que no se guardó se sigue calculando al vuelo, como
//    antes: así el sistema funciona igual sin haber guardado nada.

/** La clave con la que se cruzan las dos fuentes. Camión + jornada. */
export const claveCarga = (truckId: string, jornada: string): string => `${truckId}|${jornada}`;

export type CargaMin = { m3: number; viajes: number };

export type VolumenDetalle = VolumenCamion & {
  /** Cuántas jornadas salieron de lo guardado. */
  guardados: number;
  /** Cuántas se calcularon al vuelo. */
  calculados: number;
  /**
   * Jornadas guardadas a las que HOY les corresponden otros viajes que los que
   * tenían al guardarse. No se corrige solo: se avisa. Corregirlo en silencio
   * cambiaría un número por el que ya se cobró.
   */
  desactualizados: number;
};

/**
 * El volumen de cada camión en el rango, jornada por jornada, con lo guardado
 * mandando sobre lo calculado.
 *
 * `porViaje` es lo que devolvió `repartirVolumen` para el rango completo, y
 * `viajesPorDia` dice cuántos viajes hizo cada camión cada jornada. Los dos los
 * arma la pantalla: acá no se sabe (ni hace falta saber) cómo se corta un día.
 */
export function volumenConGuardado(
  porViaje: Map<string, number>,
  viajesPorDia: Map<string, Map<string, number>>,
  guardadas: Map<string, CargaMin>,
): Map<string, VolumenDetalle> {
  const out = new Map<string, VolumenDetalle>();
  viajesPorDia.forEach((dias, truckId) => {
    const pv = porViaje.get(truckId) ?? 0;
    let total = 0, viajes = 0, guardados = 0, calculados = 0, desactualizados = 0;
    dias.forEach((n, jornada) => {
      viajes += n;
      const g = guardadas.get(claveCarga(truckId, jornada));
      if (g) {
        total += Math.max(0, g.m3 || 0);
        guardados += 1;
        if ((g.viajes || 0) !== n) desactualizados += 1;
      } else {
        total += pv * n;
        calculados += 1;
      }
    });
    total = redondear(total);
    out.set(truckId, {
      total,
      porViaje: viajes > 0 ? redondear(total / viajes) : 0,
      guardados, calculados, desactualizados,
    });
  });
  return out;
}

export type FilaGuardable = {
  machinery_id: string;
  jornada: string;
  m3: number;
  viajes: number;
};

/**
 * Las filas que hay que guardar para congelar el cálculo actual del rango.
 *
 * ⚠️ Una por camión y JORNADA, no una por camión y rango. Guardar «540 m³ del 1
 *    al 30» haría imposible la pregunta que motivó todo esto («¿cuánto cargó el
 *    día 3?»), y al pedir un sub-rango habría que repartirlo otra vez a ojo.
 *
 * ⚠️ Las jornadas SIN VIAJES no se guardan. Una fila en cero dice «ese día ese
 *    camión cargó nada», y lo cierto es que ese día ese camión no trabajó: son
 *    dos cosas distintas y el histórico no debe confundirlas.
 */
export function filasParaGuardar(
  porViaje: Map<string, number>,
  viajesPorDia: Map<string, Map<string, number>>,
): FilaGuardable[] {
  const out: FilaGuardable[] = [];
  viajesPorDia.forEach((dias, machinery_id) => {
    const pv = porViaje.get(machinery_id) ?? 0;
    dias.forEach((viajes, jornada) => {
      if (viajes > 0) out.push({ machinery_id, jornada, m3: redondear(pv * viajes), viajes });
    });
  });
  return out.sort((a, b) => (a.jornada < b.jornada ? -1 : a.jornada > b.jornada ? 1 : 0));
}

// ── BUSCAR EN EL HISTÓRICO: POR DÍA, POR MES O POR CAMIÓN ───────────────────
//
// Las tres preguntas que pidió el cliente, resueltas sobre las MISMAS filas.
// Que salgan de una sola lista es lo que garantiza que los tres cortes sumen
// igual: si cada uno consultara por su cuenta, podrían dejar de cuadrar.

export type CargaHist = {
  machinery_id: string;
  machine_code: string;
  jornada: string;
  m3: number;
  viajes: number;
};

export type TotalCargas = { m3: number; viajes: number; dias: number; camiones: number };

export function totalCargas(rows: CargaHist[]): TotalCargas {
  let m3 = 0, viajes = 0;
  const dias = new Set<string>(), camiones = new Set<string>();
  for (const r of rows) {
    m3 += Number(r.m3) || 0;
    viajes += Number(r.viajes) || 0;
    dias.add(r.jornada);
    camiones.add(r.machinery_id);
  }
  return { m3: redondear(m3), viajes, dias: dias.size, camiones: camiones.size };
}

export type GrupoCarga = { key: string; label: string; m3: number; viajes: number; n: number };

/** Agrupa por el eje que se le pida. `n` es cuántas cosas distintas hay dentro:
 *  días en un camión, camiones en un día. Ordena de más volumen a menos, salvo
 *  por fecha, donde manda el calendario: un histórico se lee en orden. */
function agrupar(
  rows: CargaHist[],
  clave: (r: CargaHist) => string,
  etiqueta: (r: CargaHist) => string,
  dentro: (r: CargaHist) => string,
  porFecha: boolean,
): GrupoCarga[] {
  const m = new Map<string, { label: string; m3: number; viajes: number; d: Set<string> }>();
  for (const r of rows) {
    const k = clave(r);
    const g = m.get(k) ?? { label: etiqueta(r), m3: 0, viajes: 0, d: new Set<string>() };
    g.m3 += Number(r.m3) || 0;
    g.viajes += Number(r.viajes) || 0;
    g.d.add(dentro(r));
    m.set(k, g);
  }
  const out = Array.from(m.entries()).map(([key, g]) => ({
    key, label: g.label, m3: redondear(g.m3), viajes: g.viajes, n: g.d.size,
  }));
  return porFecha
    ? out.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0))   // más reciente arriba
    : out.sort((a, b) => b.m3 - a.m3 || (a.label < b.label ? -1 : 1));
}

export const cargasPorCamion = (rows: CargaHist[]): GrupoCarga[] =>
  agrupar(rows, (r) => r.machinery_id, (r) => r.machine_code, (r) => r.jornada, false);

export const cargasPorDia = (rows: CargaHist[]): GrupoCarga[] =>
  agrupar(rows, (r) => r.jornada, (r) => r.jornada, (r) => r.machinery_id, true);

/** Por mes, para la pregunta «cuánto se movió en septiembre». La clave es
 *  `YYYY-MM`, que ordena bien como texto y no depende de zona horaria. */
export const cargasPorMes = (rows: CargaHist[]): GrupoCarga[] =>
  agrupar(rows, (r) => String(r.jornada).slice(0, 7), (r) => String(r.jornada).slice(0, 7), (r) => r.jornada, true);

export type EjeHistorico = 'dia' | 'mes' | 'camion';

export const EJES_HISTORICO: { key: EjeHistorico; label: string }[] = [
  { key: 'dia', label: '📅 Por día' },
  { key: 'mes', label: '🗓️ Por mes' },
  { key: 'camion', label: '🚛 Por camión' },
];

export function agruparHistorico(rows: CargaHist[], eje: EjeHistorico): GrupoCarga[] {
  return eje === 'camion' ? cargasPorCamion(rows) : eje === 'mes' ? cargasPorMes(rows) : cargasPorDia(rows);
}

/** `2026-09-03` → `03/09/2026`. Se escribe acá y no se importa de otro lado
 *  para que el archivo siga sin un solo import. */
export function fechaCorta(iso: string): string {
  const t = String(iso ?? '').slice(0, 10);
  const p = t.split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : t;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** `2026-09` → `septiembre 2026`. */
export function mesLargo(iso: string): string {
  const p = String(iso ?? '').split('-');
  const i = Number(p[1]) - 1;
  return p.length >= 2 && MESES[i] ? `${MESES[i]} ${p[0]}` : String(iso ?? '');
}

// ── SEGMENTAR LA FLOTA: VOLTEOS vs. VOLQUETAS / CHUTOS ──────────────────
//
// El reporte volumétrico que pidió el cliente sale partido en dos tablas: las
// unidades RÍGIDAS de volteo por un lado y las VOLQUETAS / CHUTOS por otro. No
// es cosmético: son dos familias con capacidades de otro orden (un volteo anda
// por 14-17 m³ y un chuto pasa de 21), y mezclarlas en una sola tabla hace que
// el promedio no describa a ninguna de las dos.
//
// ⚠️ Se decide por el TEXTO del equipo, que es lo único que hay: en esta flota
//    la familia no está en ninguna columna. Misma regla y mismo motivo que
//    `isVolteoVolqueta` en src/lib/equipos.ts.

export type Segmento = 'volteo' | 'volqueta';

const SENAS_VOLQUETA = ['chuto', 'volqueta', 'semirremolque', 'batea', 'tolva'];

/**
 * A qué familia pertenece una unidad.
 *
 * ⚠️ Manda VOLQUETA cuando el texto dice las dos cosas. "Chuto con Volqueta
 *    Iveco Trakker" y "Volteo Toronto Iveco Trakker" comparten marca y modelo;
 *    lo que decide es el chuto. Si mandara "volteo", el chuto de 21,90 m³
 *    entraría en la tabla de los rígidos y le subiría el máximo a una familia
 *    que no llega ahí.
 */
export function segmentoDe(...textos: (string | null | undefined)[]): Segmento {
  const t = textos.map((x) => String(x ?? '')).join(' ').toLowerCase();
  return SENAS_VOLQUETA.some((s) => t.includes(s)) ? 'volqueta' : 'volteo';
}

export const SEGMENTOS: { key: Segmento; titulo: string; columna: string }[] = [
  { key: 'volteo', titulo: 'Tabla de Unidades de Volteo', columna: 'MODELO / UNIDAD DE VOLTEO' },
  { key: 'volqueta', titulo: 'Tabla de Unidades de Volqueta y Chutos con Volqueta', columna: 'MODELO / UNIDAD DE VOLQUETA' },
];

/** La pastilla de color de la clasificación, como en el reporte del cliente. */
export type Pastilla = { texto: string; tono: 'azul' | 'naranja' | 'verde' | 'gris' };

export function pastillaClase(m3: number, ident?: string | null, seg?: Segmento): Pastilla {
  const c = clasificar(m3);
  if (!c) return { texto: 'SIN MEDIR', tono: 'gris' };
  if (c === 'gran') return { texto: 'GRAN CAPACIDAD', tono: 'verde' };
  if (c === 'media') return { texto: 'MEDIA CAPACIDAD', tono: 'naranja' };
  // Los Toronto llevan etiqueta propia: son la familia más numerosa de la flota
  // y se señalan aparte para poder contarlos de un vistazo.
  if (/toronto/i.test(String(ident ?? ''))) return { texto: 'TORONTO', tono: 'azul' };
  // Por debajo de 18 m³ el rótulo cambia según la FAMILIA, tal como salen los
  // reportes que mandó el cliente: entre los volteos rígidos lo normal es
  // «ESTÁNDAR», y una volqueta que baja de 18 es «COMPACTO», porque para su
  // familia sí es chica. El mismo número dice cosas distintas según con quién
  // se compare, y por eso el rótulo no puede salir solo del número.
  return { texto: seg === 'volqueta' ? 'COMPACTO' : 'ESTÁNDAR', tono: 'azul' };
}

