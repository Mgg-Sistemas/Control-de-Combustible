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
};

export type ColSpec = { key: string; head: string; num?: boolean };

/** Columnas del reporte DETALLADO (una línea por viaje), en orden. Fecha, hora,
 *  empresa y camión no se pueden quitar: sin ellas la línea no identifica nada. */
export function columnasDetalle(op: OpcionesReporte): ColSpec[] {
  const c: ColSpec[] = [
    { key: 'fecha', head: 'Fecha' },
    { key: 'hora', head: 'Hora' },
    { key: 'empresa', head: 'Empresa' },
    { key: 'camion', head: 'Camión' },
  ];
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
export function columnasResumen(op: OpcionesReporte): ColSpec[] {
  const c: ColSpec[] = [{ key: 'camion', head: 'Camión' }];
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
