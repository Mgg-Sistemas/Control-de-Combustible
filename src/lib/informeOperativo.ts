// 📊 INFORME OPERATIVO DE TRANSPORTE Y CARGA (09-oct-2026).
//
// Pedido del cliente, con un informe de otra empresa en la mano (JHENZAEN):
// «¿cómo puedo sacar un reporte como ese desde el módulo de viajes de camiones?
//  constrúyelo, y con todas las opciones posibles por si necesito quitar una
//  columna o necesito colocar o quitar logos».
//
// Es el consolidado EJECUTIVO del rango: una fila por jornada con la flota que
// trabajó, los viajes, las toneladas movidas y las toneladas por viaje; los
// cuadros grandes de arriba (totales, flota máxima con su pico, eficiencia) y
// el gráfico de barras (carga) con la línea de camiones.
//
// TRES REGLAS QUE LO DISTINGUEN DE LOS PAPELES DE PAGO:
//  1. NO HAY DINERO. Ni un monto, ni una tarifa. Es operación, no cobro — y la
//     prueba lo blinda: acá no se importa nada de pagoViajes/pagoPeso.
//  2. ENTRAN TODOS LOS VIAJES, sin mirar el modo de pago del camión ni marcas
//     de «no facturó»: un viaje registrado es un viaje que la operación hizo.
//  3. NADA SE INVENTA. Las toneladas salen SOLO de los viajes con peso de
//     romana (bruto − tara congelados en el viaje); un viaje sin pesar cuenta
//     como viaje pero suma 0 kg, y el papel DICE cuántos quedaron sin peso.
//     Por lo mismo, las T/Viaje se calculan sobre los viajes CON peso: dividir
//     entre todos haría ver «menos eficiente» al día que más viajes sin romana
//     tuvo, que es un problema de registro, no de carga.
//
// La jornada es la de SIEMPRE: 7am a 7am Caracas (ver jornada-es-el-dia). Si se
// compara contra un papel ajeno que corta a medianoche, los días pueden no
// cuadrar exactos — es el corte, no los datos.
//
// ⭐ SIN IMPORTS, a propósito: se prueba sola (scripts/test-informe-operativo.mjs).

/** Lo que el informe necesita de cada fila de camion_viajes. */
export type ViajeOperativo = {
  id: string;
  machinery_id: string | null;
  machine_code?: string | null;
  company_id: string | null;
  zona_pago: string | null;
  registered_at: string;
  peso_neto_kg?: number | string | null;
  ubicacion_nombre?: string | null;
  placa_snap?: string | null;
  fuera_catalogo?: boolean | null;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const dia = (v: unknown): string => String(v ?? '').slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Jornada (7am a 7am, Caracas UTC−4 fijo) de un instante ISO. Misma fórmula
 *  que pagoViajes.jornadaDeInstante — copiada, no importada, para que la
 *  librería siga siendo pura. La prueba de paridad vigila que no se separen. */
export function jornadaOperativa(iso: string | null | undefined): string {
  const t = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(t)) return '';
  return new Date(t - 11 * 3600 * 1000).toISOString().slice(0, 10);
}

const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/** «Lunes», «Martes»… de una jornada ISO. Mediodía UTC para que el huso no
 *  corra la fecha ni un día para ningún lado. */
export function diaSemanaDe(jornadaIso: string): string {
  const t = Date.parse(`${dia(jornadaIso)}T12:00:00Z`);
  if (!Number.isFinite(t)) return '';
  return DIAS_SEMANA[new Date(t).getUTCDay()];
}

/** dd/mm/aaaa. */
const dmy = (iso: string): string => {
  const [y, m, d] = dia(iso).split('-');
  return y && m && d ? `${d}/${m}/${y}` : '—';
};

/** Números a la venezolana: miles con punto, decimales con coma. */
export function nro(n: number, decimales = 2): string {
  const v = Number.isFinite(n) ? n : 0;
  const [ent, dec] = Math.abs(v).toFixed(decimales).split('.');
  const miles = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${v < 0 ? '−' : ''}${miles}${decimales > 0 ? `,${dec}` : ''}`;
}

/** El camión detrás de un viaje: su id de catálogo, o el código si vino de
 *  fuera (mismo criterio que maquinaDeLinea en el pago). */
export const camionDeViaje = (v: ViajeOperativo): string =>
  String(v.machinery_id ?? '').trim() || `code:${String(v.machine_code ?? '').trim() || '—'}`;

export const SIN_OBRA_OP = 'Sin obra';
export const SIN_ZONA_OP = 'Sin zona';
export const SIN_EMPRESA_OP = '(sin empresa)';

export const obraDeViaje = (v: ViajeOperativo): string => String(v.ubicacion_nombre ?? '').trim() || SIN_OBRA_OP;
export const zonaDeViaje = (v: ViajeOperativo): string => {
  const z = String(v.zona_pago ?? '').trim().toLowerCase();
  return z === 'este' ? 'Este' : z === 'oeste' ? 'Oeste' : SIN_ZONA_OP;
};
export const empresaDeViaje = (v: ViajeOperativo): string => String(v.company_id ?? '').trim() || SIN_EMPRESA_OP;

// ── FILTROS (vacío = todas, igual que en los papeles de pago) ───────────────

export type FiltroOperativo = { empresas: string[]; obras: string[]; zonas: string[]; camiones: string[] };
export const FILTRO_OPERATIVO_TODO: FiltroOperativo = { empresas: [], obras: [], zonas: [], camiones: [] };

const pasa = (lista: string[] | null | undefined, clave: string) => !lista || lista.length === 0 || lista.includes(clave);

export function filtrarViajesOperativo(viajes: ViajeOperativo[] | null | undefined, f: FiltroOperativo): ViajeOperativo[] {
  return (viajes ?? []).filter((v) =>
    pasa(f.empresas, empresaDeViaje(v)) && pasa(f.obras, obraDeViaje(v))
    && pasa(f.zonas, zonaDeViaje(v)) && pasa(f.camiones, camionDeViaje(v)));
}

/** El filtro, acotado a lo que de verdad hay en el rango: una empresa marcada
 *  que ya no está seguiría filtrando sin verse y sin poder desmarcarse. */
export function acotarFiltroOperativo(
  f: FiltroOperativo,
  hay: { empresas: string[]; obras: string[]; zonas: string[]; camiones: string[] },
): FiltroOperativo {
  const e = new Set(hay.empresas); const o = new Set(hay.obras);
  const z = new Set(hay.zonas); const c = new Set(hay.camiones);
  return {
    empresas: f.empresas.filter((k) => e.has(k)),
    obras: f.obras.filter((k) => o.has(k)),
    zonas: f.zonas.filter((k) => z.has(k)),
    camiones: f.camiones.filter((k) => c.has(k)),
  };
}

export type OpcionDisponible = { id: string; name: string; viajes: number };

function disponibles(viajes: ViajeOperativo[] | null | undefined, claveDe: (v: ViajeOperativo) => string, ultimo: string): OpcionDisponible[] {
  const m = new Map<string, number>();
  (viajes ?? []).forEach((v) => { const k = claveDe(v); m.set(k, (m.get(k) ?? 0) + 1); });
  return Array.from(m, ([id, viajes2]) => ({ id, name: id, viajes: viajes2 }))
    .sort((a, b) => Number(a.id === ultimo) - Number(b.id === ultimo) || a.name.localeCompare(b.name, 'es', { numeric: true }));
}

export const obrasOperativo = (v: ViajeOperativo[] | null | undefined) => disponibles(v, obraDeViaje, SIN_OBRA_OP);
export const zonasOperativo = (v: ViajeOperativo[] | null | undefined) => disponibles(v, zonaDeViaje, SIN_ZONA_OP);
export const empresasOperativo = (v: ViajeOperativo[] | null | undefined) => disponibles(v, empresaDeViaje, SIN_EMPRESA_OP);

/** Camiones del rango, con su código y placa congelada, para el buscador. */
export function camionesOperativo(viajes: ViajeOperativo[] | null | undefined): { id: string; code: string; placa: string | null; viajes: number }[] {
  const m = new Map<string, { id: string; code: string; placa: string | null; viajes: number }>();
  (viajes ?? []).forEach((v) => {
    const id = camionDeViaje(v);
    const c = m.get(id) ?? { id, code: String(v.machine_code ?? '—'), placa: v.placa_snap ?? null, viajes: 0 };
    c.viajes += 1;
    if (!c.placa && v.placa_snap) c.placa = v.placa_snap;
    m.set(id, c);
  });
  return Array.from(m.values()).sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true }) || String(a.placa ?? '').localeCompare(String(b.placa ?? ''), 'es'));
}

// ── EL CÁLCULO ──────────────────────────────────────────────────────────────

export type DiaOperativo = {
  jornada: string;
  diaSemana: string;
  /** Camiones DISTINTOS que registraron viajes esa jornada. */
  flota: number;
  viajes: number;
  conPeso: number;
  sinPeso: number;
  toneladas: number;
  /** Toneladas ÷ viajes CON peso. null = ese día no se pesó ninguno. */
  tPorViaje: number | null;
};

export type ResumenOperativo = {
  dias: DiaOperativo[];
  toneladas: number;
  viajes: number;
  conPeso: number;
  sinPeso: number;
  /** Camiones distintos de TODO el rango (no la suma de los picos diarios). */
  flotaRango: number;
  flotaMax: number;
  /** Jornadas donde se tocó el pico de flota, para el «Pico: 02 y 03 de…». */
  flotaMaxJornadas: string[];
  tPorViajeProm: number | null;
  viajesPorDiaProm: number;
};

/**
 * Una fila por jornada del rango [desde, hasta] (ambos incluidos). Los días del
 * rango SIN viajes no salen (igual que en el papel de muestra): un informe de
 * un mes no arrastra filas de ceros de los domingos sin operación.
 */
export function resumenOperativo(viajes: ViajeOperativo[] | null | undefined, desde: string, hasta: string): ResumenOperativo {
  const d0 = dia(desde); const d1 = dia(hasta);
  const porDia = new Map<string, { camiones: Set<string>; viajes: number; conPeso: number; kg: number }>();
  const flotaRango = new Set<string>();

  (viajes ?? []).forEach((v) => {
    if (!v?.id) return;
    const j = jornadaOperativa(v.registered_at);
    if (!j || j < d0 || j > d1) return;
    const g = porDia.get(j) ?? { camiones: new Set<string>(), viajes: 0, conPeso: 0, kg: 0 };
    const cam = camionDeViaje(v);
    g.camiones.add(cam);
    flotaRango.add(cam);
    g.viajes += 1;
    const kg = num(v.peso_neto_kg);
    if (kg > 0) { g.conPeso += 1; g.kg += kg; }
    porDia.set(j, g);
  });

  const dias: DiaOperativo[] = Array.from(porDia.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([j, g]) => ({
      jornada: j,
      diaSemana: diaSemanaDe(j),
      flota: g.camiones.size,
      viajes: g.viajes,
      conPeso: g.conPeso,
      sinPeso: g.viajes - g.conPeso,
      toneladas: r2(g.kg / 1000),
      tPorViaje: g.conPeso > 0 ? r2(g.kg / 1000 / g.conPeso) : null,
    }));

  const toneladas = r2(dias.reduce((a, x) => a + x.toneladas, 0));
  const viajesTot = dias.reduce((a, x) => a + x.viajes, 0);
  const conPeso = dias.reduce((a, x) => a + x.conPeso, 0);
  const flotaMax = dias.reduce((a, x) => Math.max(a, x.flota), 0);
  return {
    dias,
    toneladas,
    viajes: viajesTot,
    conPeso,
    sinPeso: viajesTot - conPeso,
    flotaRango: flotaRango.size,
    flotaMax,
    flotaMaxJornadas: dias.filter((x) => x.flota === flotaMax && flotaMax > 0).map((x) => x.jornada),
    tPorViajeProm: conPeso > 0 ? r2(toneladas / conPeso) : null,
    viajesPorDiaProm: dias.length > 0 ? r2(viajesTot / dias.length) : 0,
  };
}

/** Viajes y toneladas agrupados (por empresa o por camión, los cuadros extra). */
export type ConteoOperativo = { clave: string; flota: number; viajes: number; sinPeso: number; toneladas: number };

export function conteoOperativoPor(viajes: ViajeOperativo[] | null | undefined, claveDe: (v: ViajeOperativo) => string): ConteoOperativo[] {
  const m = new Map<string, { camiones: Set<string>; viajes: number; conPeso: number; kg: number }>();
  (viajes ?? []).forEach((v) => {
    const k = claveDe(v);
    const g = m.get(k) ?? { camiones: new Set<string>(), viajes: 0, conPeso: 0, kg: 0 };
    g.camiones.add(camionDeViaje(v));
    g.viajes += 1;
    const kg = num(v.peso_neto_kg);
    if (kg > 0) { g.conPeso += 1; g.kg += kg; }
    m.set(k, g);
  });
  return Array.from(m.entries())
    .map(([clave, g]) => ({ clave, flota: g.camiones.size, viajes: g.viajes, sinPeso: g.viajes - g.conPeso, toneladas: r2(g.kg / 1000) }))
    .sort((a, b) => b.toneladas - a.toneladas || b.viajes - a.viajes || a.clave.localeCompare(b.clave, 'es', { numeric: true }));
}

// ── LAS OPCIONES DEL PAPEL (todas, como pidió el cliente) ───────────────────

export type OpcionesInformeOperativo = {
  /** Sin los cuadros grandes de arriba (toneladas, viajes, flota, eficiencia). */
  sinKpis: boolean;
  /** Sin el gráfico de barras (carga) con la línea de camiones. */
  sinGrafico: boolean;
  /** Sin la tabla diaria completa (queda el resumen y el gráfico). */
  sinTabla: boolean;
  // Columnas de la tabla diaria, una a una:
  sinDiaSemana: boolean;
  sinFlota: boolean;
  sinSinPeso: boolean;
  sinToneladas: boolean;
  sinTPorViaje: boolean;
  /** Cuadro extra: totales por empresa (nace apagado). */
  sinPorEmpresa: boolean;
  /** Cuadro extra: totales por camión (nace apagado). */
  sinPorCamion: boolean;
  /** Sin el NOMBRE de las empresas: «Empresa 1», «Empresa 2»… */
  sinEmpresas: boolean;
  /** Sin el cuadro de alcance del final. Filtrado, se enciende a la fuerza. */
  sinAlcance: boolean;
};

/** Cómo nace el papel: igual al informe de muestra (KPIs + tabla + gráfico),
 *  con los cuadros extra apagados — lo nuevo entra apagado. */
export const OPCIONES_OPERATIVO_INICIAL: OpcionesInformeOperativo = {
  sinKpis: false, sinGrafico: false, sinTabla: false,
  sinDiaSemana: false, sinFlota: false, sinSinPeso: false, sinToneladas: false, sinTPorViaje: false,
  sinPorEmpresa: true, sinPorCamion: true, sinEmpresas: false, sinAlcance: true,
};

export const PASTILLAS_OPERATIVO: { key: keyof OpcionesInformeOperativo; chip: string; largo: string; archivo: string }[] = [
  { key: 'sinKpis', chip: '🚫 Resumen ejecutivo', largo: 'resumen ejecutivo', archivo: 'sin resumen' },
  { key: 'sinGrafico', chip: '🚫 Gráfico', largo: 'gráfico', archivo: 'sin grafico' },
  { key: 'sinTabla', chip: '🚫 Tabla diaria', largo: 'tabla diaria', archivo: 'solo resumen' },
  { key: 'sinDiaSemana', chip: '🚫 Día de la semana', largo: 'día de la semana', archivo: 'sin dia' },
  { key: 'sinFlota', chip: '🚫 Flota', largo: 'columna de flota', archivo: 'sin flota' },
  { key: 'sinSinPeso', chip: '🚫 Viajes sin peso', largo: 'columna de viajes sin peso', archivo: 'sin col sin peso' },
  { key: 'sinToneladas', chip: '🚫 Toneladas', largo: 'columna de toneladas', archivo: 'sin toneladas' },
  { key: 'sinTPorViaje', chip: '🚫 T/Viaje', largo: 'columna T/viaje', archivo: 'sin t-viaje' },
  { key: 'sinPorEmpresa', chip: '🚫 Cuadro por empresa', largo: 'cuadro por empresa', archivo: 'con empresas' },
  { key: 'sinPorCamion', chip: '🚫 Cuadro por camión', largo: 'cuadro por camión', archivo: 'con camiones' },
  { key: 'sinEmpresas', chip: '🚫 Nombre de empresas', largo: 'nombres de empresas', archivo: 'sin nombres' },
  { key: 'sinAlcance', chip: '🚫 Alcance del informe', largo: 'cuadro de alcance', archivo: 'con alcance' },
];

export function alternarOperativo(o: OpcionesInformeOperativo, key: keyof OpcionesInformeOperativo): OpcionesInformeOperativo {
  return { ...o, [key]: !o[key] };
}

export function ocultosOperativoEnPalabras(o: OpcionesInformeOperativo): string {
  const l = PASTILLAS_OPERATIVO.filter((p) => o[p.key] !== OPCIONES_OPERATIVO_INICIAL[p.key]).map((p) => (o[p.key] ? `sin ${p.largo}` : `con ${p.largo}`));
  return l.length === 0 ? 'Sale como el informe de muestra.' : `Cambiado: ${l.join(', ')}.`;
}

/** Sufijo del nombre del archivo, con el rango y lo que se cambió. */
export function sufijoArchivoOperativo(desde: string, hasta: string, o: OpcionesInformeOperativo, filtrado: boolean): string {
  const partes: string[] = [`${dia(desde)} a ${dia(hasta)}`];
  if (filtrado) partes.push('filtrado');
  PASTILLAS_OPERATIVO.filter((p) => o[p.key] !== OPCIONES_OPERATIVO_INICIAL[p.key]).forEach((p) => partes.push(p.archivo));
  return partes.join(' · ');
}

// ── EL GRÁFICO (SVG puro: barras = toneladas · línea = camiones) ────────────

const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Hasta cuántos días cabe el gráfico sin volverse una pulpa ilegible. */
export const MAX_DIAS_GRAFICO = 62;

/**
 * El gráfico del informe de muestra: barras con la carga del día y una línea
 * con los camiones, cada punto rotulado «18c». SVG a mano: los PDF de la casa
 * son HTML impreso y ahí no hay librerías de gráficos.
 */
export function graficoOperativoSvg(dias: DiaOperativo[]): string {
  if (!dias.length || dias.length > MAX_DIAS_GRAFICO) return '';
  const W = 900; const H = 260;
  const m = { izq: 54, der: 16, arr: 26, aba: 34 };
  const aw = W - m.izq - m.der;
  const ah = H - m.arr - m.aba;
  const maxT = Math.max(1, ...dias.map((d) => d.toneladas));
  const maxF = Math.max(1, ...dias.map((d) => d.flota));
  const paso = aw / dias.length;
  const barW = Math.min(26, Math.max(3, paso * 0.5));
  const xDe = (i: number) => m.izq + paso * i + paso / 2;
  const yT = (t: number) => m.arr + ah - (t / maxT) * ah;
  const yF = (f: number) => m.arr + ah - (f / maxF) * ah * 0.9; // la línea no pisa el techo

  const grid = [0, 0.5, 1].map((p) => {
    const y = m.arr + ah - ah * p;
    return `<line x1="${m.izq}" y1="${y}" x2="${W - m.der}" y2="${y}" stroke="#d8dee9" stroke-width="1"/>`
      + `<text x="${m.izq - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#5b6472">${nro(maxT * p, 0)}t</text>`;
  }).join('');

  const barras = dias.map((d, i) =>
    `<rect x="${(xDe(i) - barW / 2).toFixed(1)}" y="${yT(d.toneladas).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, m.arr + ah - yT(d.toneladas)).toFixed(1)}" rx="2" fill="#2E86C1"/>`,
  ).join('');

  const puntosLinea = dias.map((d, i) => `${xDe(i).toFixed(1)},${yF(d.flota).toFixed(1)}`).join(' ');
  // Con muchos días, rotular cada punto «18c» se vuelve una nube: se rotula
  // salteado para que siempre haya como máximo ~15 rótulos.
  const cada = Math.max(1, Math.ceil(dias.length / 15));
  const puntos = dias.map((d, i) =>
    `<circle cx="${xDe(i).toFixed(1)}" cy="${yF(d.flota).toFixed(1)}" r="2.6" fill="#17202A"/>`
    + (i % cada === 0 || i === dias.length - 1
      ? `<text x="${xDe(i).toFixed(1)}" y="${(yF(d.flota) - 7).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="700" fill="#17202A">${d.flota}c</text>`
      : ''),
  ).join('');

  const fechas = dias.map((d, i) => {
    if (i % cada !== 0 && i !== dias.length - 1) return '';
    const [, mm, dd] = d.jornada.split('-');
    return `<text x="${xDe(i).toFixed(1)}" y="${H - 14}" text-anchor="middle" font-size="9" fill="#5b6472">${dd}/${mm}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:#fff">`
    + grid + barras
    + `<polyline points="${puntosLinea}" fill="none" stroke="#17202A" stroke-width="2"/>`
    + puntos + fechas
    + `<text x="${m.izq}" y="${H - 2}" font-size="9" fill="#5b6472">■ Barra: carga (t) · ● Línea: camiones</text>`
    + '</svg>';
}

// ── EL PAPEL ────────────────────────────────────────────────────────────────

// La base de tabla es la MISMA de los papeles de pago (que el módulo entero se
// vea de la misma mano), más los cuadros grandes (.tiles) y el marco del gráfico.
export const CSS_INFORME_OPERATIVO = `
  table{width:100%;border-collapse:collapse;font-size:11px;margin:4px 0 10px}
  th,td{border:1px solid #ccc;padding:4px 7px;text-align:left}
  th{background:#1E3A5F;color:#fff}
  td.r,th.r{text-align:right}td.c{text-align:center}td.b{font-weight:700}
  h3{font-size:13px;color:#1E3A5F;margin:14px 0 2px}
  p.n{font-size:10px;color:#666;margin:0 0 8px}
  .tiles{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 10px}
  .tiles .tile{flex:1 1 150px;border:1px solid #ccc;border-left:4px solid #2E86C1;border-radius:6px;padding:6px 9px}
  .tiles b{display:block;font-size:16px;color:#1E3A5F;margin-top:2px}
  .tiles .t{font-size:10px;color:#444;text-transform:uppercase;letter-spacing:.03em}
  .tiles .s{color:#666;font-size:9px;display:block;margin-top:2px}
  .marco{border:1px solid #ccc;border-radius:6px;padding:8px;margin:4px 0 10px}
  tr.total td{font-weight:800;border-top:2px solid #1E3A5F;background:#f0f3f7}`;

export type DatosPapelOperativo = {
  resumen: ResumenOperativo;
  /** Las MISMAS líneas con que se armó el resumen, para los cuadros extra. */
  viajes: ViajeOperativo[];
  desde: string;
  hasta: string;
  opciones: OpcionesInformeOperativo;
  filtro: FiltroOperativo;
  nombresEmpresa?: Map<string, string> | null;
};

/** «Pico: 02 y 03 de octubre», con las jornadas del pico de flota. */
export function textoPicoFlota(jornadas: string[]): string {
  if (!jornadas.length) return '';
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const porMes = new Map<string, string[]>();
  jornadas.slice(0, 6).forEach((j) => {
    const [, m, d] = dia(j).split('-');
    const mes = MESES[Number(m) - 1] ?? m;
    porMes.set(mes, [...(porMes.get(mes) ?? []), d]);
  });
  const partes = Array.from(porMes.entries()).map(([mes, ds]) =>
    `${ds.join(' y ')} de ${mes}`);
  return `Pico: ${partes.join(' · ')}${jornadas.length > 6 ? '…' : ''}`;
}

export function cuerpoInformeOperativo(d: DatosPapelOperativo): string {
  const o = d.opciones;
  const r = d.resumen;
  const partes: string[] = [];

  const nombreEmpresa = (() => {
    // «Sin nombres»: se numeran DESPUÉS de ordenar, igual que en los pagos,
    // para poder cruzar el mismo papel con y sin nombres.
    const reales = (k: string) => (k === SIN_EMPRESA_OP ? 'Sin empresa (fuera del catálogo)' : d.nombresEmpresa?.get(k) || 'Empresa');
    if (!o.sinEmpresas) return reales;
    const orden = conteoOperativoPor(d.viajes, empresaDeViaje).map((c) => c.clave);
    const idx = new Map(orden.map((k, i) => [k, `Empresa ${i + 1}`]));
    return (k: string) => idx.get(k) ?? 'Empresa';
  })();

  if (!o.sinKpis) {
    const pico = textoPicoFlota(r.flotaMaxJornadas);
    partes.push(`<div class="tiles">
      <div class="tile"><span class="t">Toneladas totales</span><b>${nro(r.toneladas)} t</b><span class="s">${r.sinPeso > 0 ? `de ${nro(r.conPeso, 0)} viaje(s) pesados` : 'carga global transportada'}</span></div>
      <div class="tile"><span class="t">Viajes totales</span><b>${nro(r.viajes, 0)}</b><span class="s">Promedio de ${nro(r.viajesPorDiaProm, 1)} viajes/día</span></div>
      <div class="tile"><span class="t">Flota activa máxima</span><b>${nro(r.flotaMax, 0)} camion(es)</b><span class="s">${esc(pico) || `${nro(r.flotaRango, 0)} en todo el rango`}</span></div>
      <div class="tile"><span class="t">Eficiencia de carga</span><b>${r.tPorViajeProm == null ? '—' : nro(r.tPorViajeProm)} t/viaje</b><span class="s">sobre los viajes con peso</span></div>
    </div>`);
  }

  if (!o.sinTabla) {
    const cols: { k: string; th: string; num: boolean; celda: (x: DiaOperativo) => string }[] = [
      { k: 'fecha', th: 'Fecha', num: false, celda: (x) => dmy(x.jornada) },
      ...(!o.sinDiaSemana ? [{ k: 'dia', th: 'Día', num: false, celda: (x: DiaOperativo) => esc(x.diaSemana) }] : []),
      ...(!o.sinFlota ? [{ k: 'flota', th: 'Flota', num: true, celda: (x: DiaOperativo) => nro(x.flota, 0) }] : []),
      { k: 'viajes', th: 'Viajes', num: true, celda: (x) => nro(x.viajes, 0) },
      ...(!o.sinSinPeso ? [{ k: 'sinpeso', th: 'Sin peso', num: true, celda: (x: DiaOperativo) => (x.sinPeso > 0 ? nro(x.sinPeso, 0) : '—') }] : []),
      ...(!o.sinToneladas ? [{ k: 'ton', th: 'Toneladas (t)', num: true, celda: (x: DiaOperativo) => nro(x.toneladas) }] : []),
      ...(!o.sinTPorViaje ? [{ k: 'tv', th: 'T/Viaje', num: true, celda: (x: DiaOperativo) => (x.tPorViaje == null ? '—' : nro(x.tPorViaje)) }] : []),
    ];
    const totalCelda = (k: string): string =>
      k === 'fecha' ? 'TOTAL / PROM.' : k === 'dia' ? '—'
        : k === 'flota' ? `${nro(r.flotaMax, 0)} (máx)` : k === 'viajes' ? nro(r.viajes, 0)
          : k === 'sinpeso' ? (r.sinPeso > 0 ? nro(r.sinPeso, 0) : '—') : k === 'ton' ? nro(r.toneladas)
            : r.tPorViajeProm == null ? '—' : nro(r.tPorViajeProm);
    partes.push(`<h3>Tabla operativa diaria</h3>
      <table><thead><tr>${cols.map((c) => `<th${c.num ? ' class="r"' : ''}>${c.th}</th>`).join('')}</tr></thead>
      <tbody>${r.dias.map((x) => `<tr>${cols.map((c) => `<td${c.num ? ' class="r"' : ''}>${c.celda(x)}</td>`).join('')}</tr>`).join('')
      || `<tr><td colspan="${cols.length}" class="c">Sin viajes en el rango</td></tr>`}
      ${r.dias.length ? `<tr class="total">${cols.map((c) => `<td${c.num ? ' class="r"' : ''}>${totalCelda(c.k)}</td>`).join('')}</tr>` : ''}</tbody></table>`);
    if (r.sinPeso > 0 && !o.sinSinPeso) {
      partes.push(`<p class="n">${nro(r.sinPeso, 0)} viaje(s) del rango no tienen peso de romana: cuentan como viajes pero no suman toneladas, y el T/Viaje se calcula solo sobre los pesados. Nada se inventa.</p>`);
    }
  }

  if (!o.sinGrafico) {
    const svg = graficoOperativoSvg(r.dias);
    if (svg) partes.push(`<h3>Evolución visual de la operación</h3><div class="marco">${svg}</div>`);
    else if (r.dias.length > MAX_DIAS_GRAFICO) partes.push(`<p class="n">El gráfico no sale con más de ${MAX_DIAS_GRAFICO} días (serían barras ilegibles). Acorta el rango para verlo.</p>`);
  }

  const cuadro = (titulo: string, col: string, filas: ConteoOperativo[], nombre?: (k: string) => string) =>
    `<h3>${titulo}</h3><table><thead><tr><th>${col}</th><th class="r">Flota</th><th class="r">Viajes</th><th class="r">Sin peso</th><th class="r">Toneladas (t)</th></tr></thead>
    <tbody>${filas.map((c) => `<tr><td>${esc(nombre ? nombre(c.clave) : c.clave)}</td><td class="r">${nro(c.flota, 0)}</td><td class="r">${nro(c.viajes, 0)}</td><td class="r">${c.sinPeso > 0 ? nro(c.sinPeso, 0) : '—'}</td><td class="r b">${nro(c.toneladas)}</td></tr>`).join('')}</tbody></table>`;

  if (!o.sinPorEmpresa) partes.push(cuadro('Totales por empresa', 'Empresa', conteoOperativoPor(d.viajes, empresaDeViaje), nombreEmpresa));
  if (!o.sinPorCamion) {
    const porCamion = conteoOperativoPor(d.viajes, camionDeViaje);
    const fichas = new Map(camionesOperativo(d.viajes).map((c) => [c.id, c]));
    partes.push(cuadro('Totales por camión', 'Camión', porCamion, (k) => {
      const f = fichas.get(k);
      return f ? `${f.code}${f.placa ? ` · ${f.placa}` : ''}` : k;
    }));
  }

  const filtrado = d.filtro.empresas.length > 0 || d.filtro.obras.length > 0 || d.filtro.zonas.length > 0 || d.filtro.camiones.length > 0;
  if (!o.sinAlcance || filtrado) {
    const l: string[] = [`Jornadas del ${dmy(d.desde)} al ${dmy(d.hasta)} (7am a 7am).`];
    l.push('Entran TODOS los viajes registrados, sin mirar modos de pago ni marcas de facturación: es un informe operativo, no de cobro.');
    if (filtrado) {
      const f = d.filtro;
      if (f.zonas.length) l.push(`Solo zona(s): ${f.zonas.join(', ')}.`);
      if (f.obras.length) l.push(`Solo obra(s): ${f.obras.map(esc).join(', ')}.`);
      if (f.empresas.length) l.push(`Solo ${f.empresas.length} empresa(s) elegida(s).`);
      if (f.camiones.length) l.push(`Solo ${f.camiones.length} camión(es) elegido(s).`);
      l.unshift('FILTRADO: este papel NO es toda la operación.');
    }
    partes.push(`<h3>Alcance del informe</h3><p class="n">${l.join(' ')}</p>`);
  }

  return partes.join('\n');
}
